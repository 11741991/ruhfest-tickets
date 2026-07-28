// ============================================================
// Работа с камерой. Написано под iOS Safari.
//
// Почему не библиотечный запуск камеры:
//   html5-qrcode вызывал getUserMedia сам и на iPhone нередко
//   попадал на вспомогательную заднюю камеру (Back Ultra Wide /
//   Back Telephoto). Такой трек существует и активен, но кадров
//   не отдаёт — пользователь видит чёрный экран с рамкой.
//
// Что здесь сделано:
//   • constraints facingMode: { ideal: 'environment' } — на iOS
//     'exact' часто приводит к OverconstrainedError или к чёрному
//     потоку, 'ideal' работает стабильно;
//   • старый поток всегда останавливается ДО открытия нового;
//   • stream привязывается к нашему <video> с playsinline /
//     autoplay / muted, выставленными и атрибутом, и свойством;
//   • video.play() вызывается строго после loadedmetadata;
//   • после запуска поток проверяется на реальные кадры —
//     если кадры чёрные, автоматически перебираются другие
//     задние камеры по deviceId.
// ============================================================

const IDEAL_SIZE = {
  width: { ideal: 1280 },
  height: { ideal: 720 },
  frameRate: { ideal: 30 }
}

const RE_BACK = /(back|rear|environment|задн|тыл)/i
// Вспомогательные модули iPhone — частая причина чёрного кадра
const RE_SECONDARY = /(ultra|tele|macro|depth|сверхшир|телефото|макро)/i

export function isIOS() {
  const ua = navigator.userAgent || ''
  return (
    /iPad|iPhone|iPod/.test(ua) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
  )
}

export function cameraSupported() {
  return Boolean(navigator.mediaDevices && navigator.mediaDevices.getUserMedia)
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms))
}

// ------------------------------------------------------------
// Освобождение потока. Без этого следующий getUserMedia на iOS
// возвращает чёрный кадр, потому что камера ещё занята.
// ------------------------------------------------------------
export function stopStream(stream) {
  if (!stream) return
  try {
    stream.getTracks().forEach((t) => {
      try {
        t.stop()
      } catch {
        /* ignore */
      }
    })
  } catch {
    /* ignore */
  }
}

export function detachVideo(video) {
  if (!video) return
  try {
    video.pause()
  } catch {
    /* ignore */
  }
  try {
    video.srcObject = null
  } catch {
    /* ignore */
  }
  try {
    video.removeAttribute('src')
    video.load()
  } catch {
    /* ignore */
  }
}

// ------------------------------------------------------------
// Список камер. Метки (label) доступны только после того,
// как пользователь один раз выдал разрешение.
// ------------------------------------------------------------
export async function listVideoDevices() {
  if (!navigator.mediaDevices?.enumerateDevices) return []
  try {
    const devices = await navigator.mediaDevices.enumerateDevices()
    return devices.filter((d) => d.kind === 'videoinput')
  } catch {
    return []
  }
}

// Задние камеры в порядке предпочтения: сначала основная,
// вспомогательные модули — в самом конце.
export function rankBackDevices(devices) {
  const backs = devices.filter((d) => RE_BACK.test(d.label || ''))
  const pool = backs.length ? backs : devices
  const primary = pool.filter((d) => !RE_SECONDARY.test(d.label || ''))
  const secondary = pool.filter((d) => RE_SECONDARY.test(d.label || ''))
  return [...primary, ...secondary]
}

// ------------------------------------------------------------
// Привязка потока к <video> + корректный запуск на iOS
// ------------------------------------------------------------
async function attachStream(video, stream) {
  // Атрибуты обязаны стоять ДО назначения srcObject,
  // иначе iOS Safari уходит в полноэкранный плеер или блокирует autoplay.
  video.setAttribute('playsinline', 'true')
  video.setAttribute('webkit-playsinline', 'true')
  video.setAttribute('autoplay', 'true')
  video.setAttribute('muted', 'true')
  video.playsInline = true
  video.autoplay = true
  video.muted = true
  video.defaultMuted = true
  video.controls = false

  video.srcObject = stream

  // Ждём метаданные — раньше play() вызывать нельзя
  await new Promise((resolve, reject) => {
    let done = false

    const cleanup = () => {
      video.removeEventListener('loadedmetadata', onMeta)
      video.removeEventListener('error', onErr)
      clearTimeout(timer)
    }
    const finish = (err) => {
      if (done) return
      done = true
      cleanup()
      err ? reject(err) : resolve()
    }

    const onMeta = () => finish()
    const onErr = () => finish(new Error('Ошибка видеоэлемента'))
    const timer = setTimeout(
      () => finish(new Error('Видеопоток не запустился (таймаут метаданных)')),
      8000
    )

    if (video.readyState >= 1) {
      finish()
      return
    }
    video.addEventListener('loadedmetadata', onMeta)
    video.addEventListener('error', onErr)
  })

  // play() строго после loadedmetadata
  try {
    await video.play()
  } catch (e) {
    // NotAllowedError — нужен жест пользователя, пробрасываем наверх
    throw new Error(
      'Не удалось запустить воспроизведение видео: ' + (e?.message || e)
    )
  }
}

// ------------------------------------------------------------
// Проверка, что камера реально отдаёт кадры (а не чёрный экран)
// ------------------------------------------------------------
async function probeVideo(video, timeoutMs = 2200) {
  const canvas = document.createElement('canvas')
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  const deadline = Date.now() + timeoutMs
  let sawFrame = false

  while (Date.now() < deadline) {
    if (video.readyState >= 2 && video.videoWidth > 0) {
      sawFrame = true
      const w = Math.min(160, video.videoWidth)
      const h = Math.max(
        1,
        Math.round((video.videoHeight / video.videoWidth) * w)
      )
      canvas.width = w
      canvas.height = h
      try {
        ctx.drawImage(video, 0, 0, w, h)
        const { data } = ctx.getImageData(0, 0, w, h)
        for (let i = 0; i < data.length; i += 4) {
          const luma =
            (data[i] * 299 + data[i + 1] * 587 + data[i + 2] * 114) / 1000
          if (luma > 12) return { alive: true, black: false }
        }
      } catch {
        // getImageData может упасть до первого кадра — просто ждём дальше
      }
    }
    await sleep(150)
  }

  return { alive: sawFrame, black: sawFrame }
}

async function tryOpen(video, videoConstraints) {
  let stream = null
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: videoConstraints,
      audio: false
    })
  } catch (e) {
    return { error: e }
  }

  if (!stream || stream.getVideoTracks().length === 0) {
    stopStream(stream)
    return { error: new Error('Поток без видеодорожки') }
  }

  try {
    await attachStream(video, stream)
  } catch (e) {
    detachVideo(video)
    stopStream(stream)
    return { error: e }
  }

  const probe = await probeVideo(video)
  if (!probe.alive) {
    detachVideo(video)
    stopStream(stream)
    return { error: new Error('Камера не отдаёт кадры') }
  }

  const track = stream.getVideoTracks()[0]
  const settings = typeof track.getSettings === 'function' ? track.getSettings() : {}

  return { stream, black: probe.black, deviceId: settings.deviceId || '' }
}

/**
 * Запускает заднюю камеру в переданный <video>.
 *
 * @returns {Promise<{stream: MediaStream, deviceId: string, warning: string}>}
 */
export async function startBackCamera(video, { deviceId = '' } = {}) {
  if (!cameraSupported()) {
    throw new Error(
      'Браузер не поддерживает доступ к камере. Откройте сайт в Safari (iPhone) или Chrome (Android).'
    )
  }
  if (!video) throw new Error('Видеоэлемент не готов')

  // Любой предыдущий поток обязан быть освобождён
  if (video.srcObject) {
    stopStream(video.srcObject)
    detachVideo(video)
    await sleep(120)
  }

  let lastError = null

  // --- 1. Камера, выбранная сотрудником вручную ---
  if (deviceId) {
    const r = await tryOpen(video, {
      deviceId: { exact: deviceId },
      ...IDEAL_SIZE
    })
    if (r.stream && !r.black) {
      return { stream: r.stream, deviceId: r.deviceId || deviceId, warning: '' }
    }
    if (r.stream) {
      stopStream(r.stream)
      detachVideo(video)
      await sleep(120)
    }
    lastError = r.error || null
  }

  // --- 2. Основной путь: facingMode ideal environment ---
  // На iOS 'exact' даёт OverconstrainedError или чёрный поток, 'ideal' — нет.
  let fallback = null
  const env = await tryOpen(video, {
    facingMode: { ideal: 'environment' },
    ...IDEAL_SIZE
  })

  if (env.stream && !env.black) {
    return { stream: env.stream, deviceId: env.deviceId, warning: '' }
  }

  if (env.stream) {
    // Поток есть, но кадры чёрные — типичная беда iPhone.
    // Запоминаем как запасной вариант и перебираем задние камеры поимённо.
    fallback = env
    stopStream(env.stream)
    detachVideo(video)
    await sleep(150)
  } else {
    lastError = env.error || lastError
  }

  // --- 3. Перебор задних камер по deviceId ---
  // Метки доступны, потому что разрешение уже выдано на шаге 2.
  const devices = await listVideoDevices()
  const ranked = rankBackDevices(devices).filter(
    (d) => d.deviceId && d.deviceId !== fallback?.deviceId
  )

  for (const d of ranked) {
    const r = await tryOpen(video, {
      deviceId: { exact: d.deviceId },
      ...IDEAL_SIZE
    })
    if (r.stream && !r.black) {
      return { stream: r.stream, deviceId: d.deviceId, warning: '' }
    }
    if (r.stream) {
      stopStream(r.stream)
      detachVideo(video)
      await sleep(120)
    } else {
      lastError = r.error || lastError
    }
  }

  // --- 4. Ни одна камера не дала светлого кадра ---
  // Возможно, просто темно. Возвращаем основной поток с предупреждением,
  // на переднюю камеру автоматически НЕ переключаемся.
  const retry = await tryOpen(video, {
    facingMode: { ideal: 'environment' },
    ...IDEAL_SIZE
  })
  if (retry.stream) {
    return {
      stream: retry.stream,
      deviceId: retry.deviceId,
      warning:
        'Камера включена, но изображение очень тёмное. Уберите палец с объектива, ' +
        'проверьте освещение или выберите другую камеру в списке ниже.'
    }
  }

  // --- 5. Последняя попытка: любая доступная камера ---
  const any = await tryOpen(video, true)
  if (any.stream) {
    return {
      stream: any.stream,
      deviceId: any.deviceId,
      warning:
        'Не удалось включить заднюю камеру — используется камера по умолчанию. ' +
        'Выберите нужную камеру в списке ниже.'
    }
  }

  throw lastError || any.error || new Error('Камера недоступна')
}

// ------------------------------------------------------------
// Понятный текст ошибки вместо DOMException
// ------------------------------------------------------------
export function cameraErrorText(e) {
  const name = e?.name || ''
  if (name === 'NotAllowedError' || name === 'SecurityError') {
    return (
      'Доступ к камере запрещён. iPhone: Настройки → Safari → Камера → «Спросить», ' +
      'затем обновите страницу. Android Chrome: значок замка в адресной строке → ' +
      'Разрешения → Камера → Разрешить.'
    )
  }
  if (name === 'NotFoundError' || name === 'DevicesNotFoundError') {
    return 'Камера не найдена на этом устройстве.'
  }
  if (name === 'NotReadableError' || name === 'TrackStartError') {
    return (
      'Камера занята другим приложением или вкладкой. Закройте другие приложения ' +
      'с камерой и нажмите «Включить камеру».'
    )
  }
  if (name === 'OverconstrainedError') {
    return 'Выбранная камера недоступна. Выберите другую камеру в списке.'
  }
  if (!window.isSecureContext) {
    return 'Камера работает только по HTTPS. Откройте сайт по адресу https://…'
  }
  return 'Не удалось включить камеру. ' + (e?.message || '')
}
