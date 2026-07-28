import { useCallback, useEffect, useRef, useState } from 'react'
import { Html5Qrcode } from 'html5-qrcode'
import { supabase } from '../lib/supabase.js'
import { extractToken, formatTime } from '../lib/token.js'
import { feedbackError, feedbackSuccess, unlockAudio } from '../lib/feedback.js'

const READER_ID = 'reader'

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

/**
 * mode: 'in'  → регистрация входа  (register_ticket_entry)
 * mode: 'out' → регистрация выхода (register_ticket_exit)
 */
export default function Scanner({ mode }) {
  const title = mode === 'in' ? 'ВХОД' : 'ВЫХОД'
  const rpcName =
    mode === 'in' ? 'register_ticket_entry' : 'register_ticket_exit'

  const [scanning, setScanning] = useState(false)
  const [processing, setProcessing] = useState(false)
  const [result, setResult] = useState(null)
  const [cameraError, setCameraError] = useState('')
  const [cameras, setCameras] = useState([])
  const [deviceId, setDeviceId] = useState('')

  const instRef = useRef(null)
  const lockRef = useRef(false)
  const deviceRef = useRef('')
  // Все операции старт/стоп выполняются строго по очереди —
  // иначе html5-qrcode ломается при быстрых переключениях.
  const chainRef = useRef(Promise.resolve())

  const enqueue = useCallback((fn) => {
    chainRef.current = chainRef.current.then(fn).catch(() => {})
    return chainRef.current
  }, [])

  const stopScanner = useCallback(async () => {
    const inst = instRef.current
    instRef.current = null
    if (!inst) return
    try {
      if (inst.isScanning) await inst.stop()
    } catch {
      /* уже остановлен */
    }
    try {
      inst.clear()
    } catch {
      /* ignore */
    }
  }, [])

  const handleDecoded = useCallback(
    async (decodedText) => {
      if (lockRef.current) return
      lockRef.current = true

      // Камера останавливается сразу, чтобы один QR не считался дважды
      enqueue(stopScanner)
      setScanning(false)
      setProcessing(true)

      const token = extractToken(decodedText)

      const { data, error } = await supabase.rpc(rpcName, {
        ticket_token: token
      })

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
    [enqueue, rpcName, stopScanner]
  )

  const startScanner = useCallback(async () => {
    setCameraError('')
    await stopScanner()

    if (!document.getElementById(READER_ID)) return

    try {
      const inst = new Html5Qrcode(READER_ID, { verbose: false })
      instRef.current = inst
      lockRef.current = false

      const config = {
        fps: 10,
        qrbox: (w, h) => {
          const size = Math.floor(Math.min(w, h) * 0.75)
          return { width: size, height: size }
        },
        aspectRatio: 1.0
      }

      // По умолчанию — задняя камера смартфона
      const cameraConfig = deviceRef.current
        ? { deviceId: { exact: deviceRef.current } }
        : { facingMode: { exact: 'environment' } }

      try {
        await inst.start(cameraConfig, config, handleDecoded, () => {})
      } catch {
        // Не на всех устройствах есть камера с exact:'environment'
        await inst.start({ facingMode: 'environment' }, config, handleDecoded, () => {})
      }

      setScanning(true)

      // Список камер доступен только после выданного разрешения
      try {
        const list = await Html5Qrcode.getCameras()
        setCameras(list || [])
      } catch {
        setCameras([])
      }
    } catch (e) {
      instRef.current = null
      setScanning(false)
      setCameraError(
        'Не удалось включить камеру. Разрешите доступ к камере в настройках браузера ' +
          'и убедитесь, что сайт открыт по HTTPS. ' +
          (e?.message ? `(${e.message})` : '')
      )
    }
  }, [handleDecoded, stopScanner])

  useEffect(() => {
    enqueue(startScanner)
    return () => {
      enqueue(stopScanner)
    }
  }, [enqueue, startScanner, stopScanner])

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

  function restart() {
    unlockAudio()
    setResult(null)
    lockRef.current = false
    enqueue(startScanner)
  }

  function changeCamera(id) {
    setDeviceId(id)
    deviceRef.current = id
    setResult(null)
    lockRef.current = false
    enqueue(startScanner)
  }

  return (
    <div className="page">
      <div className="scan-title">{title}</div>

      {cameraError && <div className="error">{cameraError}</div>}

      <div id={READER_ID} />

      <div style={{ marginTop: 14 }}>
        <button type="button" onClick={restart} disabled={processing}>
          {scanning ? 'Перезапустить сканер' : 'Включить камеру'}
        </button>
      </div>

      {cameras.length > 1 && (
        <div className="field" style={{ marginTop: 12 }}>
          <label htmlFor="cam">Камера</label>
          <select
            id="cam"
            value={deviceId}
            onChange={(e) => changeCamera(e.target.value)}
            style={{
              width: '100%',
              fontSize: 17,
              padding: 14,
              borderRadius: 12,
              background: 'var(--card)',
              color: 'var(--text)',
              border: '1px solid var(--border)'
            }}
          >
            <option value="">Задняя камера (по умолчанию)</option>
            {cameras.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label || c.id}
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
