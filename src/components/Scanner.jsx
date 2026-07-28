import { useCallback, useEffect, useRef, useState } from 'react'
import jsQR from 'jsqr'
import { supabase } from '../lib/supabase.js'
import { extractToken, formatTime } from '../lib/token.js'
import { feedbackError, feedbackSuccess, unlockAudio } from '../lib/feedback.js'
import {
  cameraErrorText,
  detachVideo,
  listVideoDevices,
  startBackCamera,
  stopStream
} from '../lib/camera.js'

// Цвет экрана результата по коду ответа RPC
function screenClass(code) {
  switch (code) {
    case 'ENTRY_SUCCESS':
      return 'result-green'
    case 'EXIT_SUCCESS':
      return 'result-blue'
    case 'ALREADY_INSIDE':
    case 'ALREADY_OUTSIDE':
    case 'BLOCKED':
    case 'NOT_FOUND':
    case 'NOT_AUTHORIZED':
      return 'result-red'
    default:
      return 'result-amber'
  }
}

const DECODE_INTERVAL_MS = 100 // ~10 попыток распознавания в секунду
const MAX_DECODE_SIDE = 640 // кадр уменьшается — так распознавание быстрее

/**
 * mode: 'in'  → регистрация входа  (register_ticket_entry)
 * mode: 'out' → регистрация выхода (register_ticket_exit)
 */
export default function Scanner({ mode }) {
  const title = mode === 'in' ? 'ВХОД' : 'ВЫХОД'
  const rpcName =
    mode === 'in' ? 'register_ticket_entry' : 'register_ticket_exit'

  const [scanning, setScanning] = useState(false)
  const [starting, setStarting] = useState(false)
  const [processing, setProcessing] = useState(false)
  const [result, setResult] = useState(null)
  const [cameraError, setCameraError] = useState('')
  const [warning, setWarning] = useState('')
  const [cameras, setCameras] = useState([])
  const [deviceId, setDeviceId] = useState('')

  const videoRef = useRef(null)
  const streamRef = useRef(null)
  const canvasRef = useRef(null)
  const ctxRef = useRef(null)
  const rafRef = useRef(0)
  const lastDecodeRef = useRef(0)
  const lockRef = useRef(false)
  const deviceRef = useRef('')
  const aliveRef = useRef(true)
  // Все операции старт/стоп идут строго по очереди
  const chainRef = useRef(Promise.resolve())

  const enqueue = useCallback((fn) => {
    chainRef.current = chainRef.current.then(fn).catch(() => {})
    return chainRef.current
  }, [])

  // ----------------------------------------------------------
  // Остановка камеры и цикла распознавания
  // ----------------------------------------------------------
  const stopCamera = useCallback(async () => {
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current)
      rafRef.current = 0
    }
    if (streamRef.current) {
      stopStream(streamRef.current)
      streamRef.current = null
    }
    detachVideo(videoRef.current)
    setScanning(false)
  }, [])

  // ----------------------------------------------------------
  // Обработка распознанного QR
  // ----------------------------------------------------------
  const handleDecoded = useCallback(
    async (decodedText) => {
      if (lockRef.current) return
      lockRef.current = true

      // Камера гасится сразу, чтобы один QR не считался дважды
      enqueue(stopCamera)
      setProcessing(true)

      const token = extractToken(decodedText)

      const { data, error } = await supabase.rpc(rpcName, {
        ticket_token: token
      })

      if (!aliveRef.current) return
      setProcessing(false)

      if (error) {
        setResult({
          success: false,
          code: 'ERROR',
          message: 'ОШИБКА СВЯЗИ. ПОВТОРИТЕ',
          ticket_number: null,
          name: null,
          timestamp: new Date().toISOString()
        })
        feedbackError()
        return
      }

      setResult(data)
      if (data?.success) feedbackSuccess()
      else feedbackError()
    },
    [enqueue, rpcName, stopCamera]
  )

  // ----------------------------------------------------------
  // Цикл распознавания: кадр видео → canvas → jsQR
  // ----------------------------------------------------------
  const startDecodeLoop = useCallback(() => {
    if (!canvasRef.current) {
      canvasRef.current = document.createElement('canvas')
      ctxRef.current = canvasRef.current.getContext('2d', {
        willReadFrequently: true
      })
    }

    const tick = () => {
      rafRef.current = requestAnimationFrame(tick)

      if (lockRef.current) return

      const video = videoRef.current
      if (!video || video.readyState < 2 || !video.videoWidth) return

      const now = performance.now()
      if (now - lastDecodeRef.current < DECODE_INTERVAL_MS) return
      lastDecodeRef.current = now

      const scale = Math.min(
        1,
        MAX_DECODE_SIDE / Math.max(video.videoWidth, video.videoHeight)
      )
      const w = Math.max(1, Math.floor(video.videoWidth * scale))
      const h = Math.max(1, Math.floor(video.videoHeight * scale))

      const canvas = canvasRef.current
      const ctx = ctxRef.current
      if (canvas.width !== w) canvas.width = w
      if (canvas.height !== h) canvas.height = h

      try {
        ctx.drawImage(video, 0, 0, w, h)
        const image = ctx.getImageData(0, 0, w, h)
        const code = jsQR(image.data, w, h, {
          inversionAttempts: 'dontInvert'
        })
        if (code && code.data) handleDecoded(code.data)
      } catch {
        // кадр ещё не готов — пропускаем
      }
    }

    if (rafRef.current) cancelAnimationFrame(rafRef.current)
    lastDecodeRef.current = 0
    rafRef.current = requestAnimationFrame(tick)
  }, [handleDecoded])

  // ----------------------------------------------------------
  // Запуск камеры
  // ----------------------------------------------------------
  const startCamera = useCallback(async () => {
    if (!aliveRef.current) return

    setCameraError('')
    setWarning('')
    setStarting(true)

    await stopCamera()

    const video = videoRef.current
    if (!video) {
      setStarting(false)
      return
    }

    try {
      const { stream, deviceId: usedId, warning: warn } = await startBackCamera(
        video,
        { deviceId: deviceRef.current }
      )

      if (!aliveRef.current) {
        stopStream(stream)
        detachVideo(video)
        return
      }

      streamRef.current = stream
      lockRef.current = false
      if (usedId) {
        deviceRef.current = usedId
        setDeviceId(usedId)
      }
      if (warn) setWarning(warn)

      // Если поток оборвался (звонок, блокировка экрана) — перезапуск вручную
      const track = stream.getVideoTracks()[0]
      if (track) {
        track.addEventListener('ended', () => {
          if (!aliveRef.current) return
          setScanning(false)
          setWarning('Поток камеры прерван. Нажмите «Включить камеру».')
        })
      }

      setScanning(true)
      startDecodeLoop()

      // Метки камер доступны только после выданного разрешения
      const list = await listVideoDevices()
      if (aliveRef.current) setCameras(list)
    } catch (e) {
      if (!aliveRef.current) return
      await stopCamera()
      setCameraError(cameraErrorText(e))
    } finally {
      if (aliveRef.current) setStarting(false)
    }
  }, [startDecodeLoop, stopCamera])

  // ----------------------------------------------------------
  // Монтирование / размонтирование
  // ----------------------------------------------------------
  useEffect(() => {
    aliveRef.current = true
    enqueue(startCamera)
    return () => {
      aliveRef.current = false
      enqueue(stopCamera)
    }
  }, [enqueue, startCamera, stopCamera])

  // iOS замораживает камеру при уходе со страницы —
  // возвращаясь, поток нужно «разбудить».
  useEffect(() => {
    function onVisible() {
      if (document.visibilityState !== 'visible') return
      const video = videoRef.current
      if (!video || !streamRef.current || lockRef.current) return

      const track = streamRef.current.getVideoTracks()[0]
      if (!track || track.readyState === 'ended') {
        enqueue(startCamera)
        return
      }
      video.play().catch(() => enqueue(startCamera))
    }

    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('pageshow', onVisible)
    return () => {
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('pageshow', onVisible)
    }
  }, [enqueue, startCamera])

  // Разблокировка звука на iOS требует жеста пользователя
  useEffect(() => {
    const onFirstTouch = () => unlockAudio()
    window.addEventListener('touchstart', onFirstTouch, { once: true })
    window.addEventListener('click', onFirstTouch, { once: true })
    return () => {
      window.removeEventListener('touchstart', onFirstTouch)
      window.removeEventListener('click', onFirstTouch)
    }
  }, [])

  // ----------------------------------------------------------
  // Действия пользователя
  // ----------------------------------------------------------
  function restart() {
    unlockAudio()
    setResult(null)
    lockRef.current = false
    enqueue(startCamera)
  }

  function changeCamera(id) {
    setDeviceId(id)
    deviceRef.current = id
    setResult(null)
    lockRef.current = false
    enqueue(startCamera)
  }

  function nextCamera() {
    if (cameras.length < 2) return
    const idx = cameras.findIndex((c) => c.deviceId === deviceRef.current)
    const next = cameras[(idx + 1 + cameras.length) % cameras.length]
    if (next) changeCamera(next.deviceId)
  }

  return (
    <div className="page">
      <div className="scan-title">{title}</div>

      {cameraError && <div className="error">{cameraError}</div>}
      {warning && !cameraError && <div className="warning">{warning}</div>}

      <div className="video-wrap">
        <video
          ref={videoRef}
          className="scan-video"
          playsInline
          autoPlay
          muted
          disablePictureInPicture
        />
        <div className="scan-frame" />
        {!scanning && !starting && (
          <div className="video-placeholder">Камера выключена</div>
        )}
        {starting && <div className="video-placeholder">Включение камеры…</div>}
      </div>

      <div className="btn-row" style={{ marginTop: 14 }}>
        <button
          type="button"
          className={scanning ? '' : 'btn-primary'}
          onClick={restart}
          disabled={processing || starting}
          style={{ flex: '1 1 100%' }}
        >
          {starting
            ? 'Включение…'
            : scanning
              ? 'Перезапустить сканер'
              : 'Включить камеру'}
        </button>

        {cameras.length > 1 && (
          <button
            type="button"
            className="btn-sm"
            onClick={nextCamera}
            disabled={starting}
            style={{ flex: '1 1 100%' }}
          >
            Сменить камеру
          </button>
        )}
      </div>

      {cameras.length > 1 && (
        <div className="field" style={{ marginTop: 12 }}>
          <label htmlFor="cam">Камера</label>
          <select
            id="cam"
            className="select"
            value={deviceId}
            onChange={(e) => changeCamera(e.target.value)}
          >
            <option value="">Задняя камера (автовыбор)</option>
            {cameras.map((c, i) => (
              <option key={c.deviceId || i} value={c.deviceId}>
                {c.label || `Камера ${i + 1}`}
              </option>
            ))}
          </select>
        </div>
      )}

      <p className="muted" style={{ marginTop: 12 }}>
        Наведите камеру на QR-код билета. После результата камера
        останавливается — нажмите кнопку, чтобы сканировать следующий билет.
      </p>

      {processing && (
        <div className="result-screen result-amber">
          <div className="result-message">ПРОВЕРКА…</div>
        </div>
      )}

      {result && !processing && (
        <div className={`result-screen ${screenClass(result.code)}`}>
          <div className="result-message">{result.message}</div>

          {result.name && <div className="result-info">{result.name}</div>}
          {result.ticket_number && (
            <div className="result-meta">{result.ticket_number}</div>
          )}
          <div className="result-meta">{formatTime(result.timestamp)}</div>

          <div className="result-actions">
            <button type="button" onClick={restart}>
              Сканировать следующий билет
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
