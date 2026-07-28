// Звук + вибрация после сканирования — там, где браузер разрешает.

let ctx = null

function beep(frequency, duration) {
  try {
    const AudioCtx = window.AudioContext || window.webkitAudioContext
    if (!AudioCtx) return
    if (!ctx) ctx = new AudioCtx()
    if (ctx.state === 'suspended') ctx.resume()

    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.type = 'square'
    osc.frequency.value = frequency
    gain.gain.value = 0.12
    osc.connect(gain)
    gain.connect(ctx.destination)
    osc.start()
    osc.stop(ctx.currentTime + duration)
  } catch {
    /* звук недоступен — не критично */
  }
}

function vibrate(pattern) {
  try {
    if (navigator.vibrate) navigator.vibrate(pattern)
  } catch {
    /* вибрация недоступна */
  }
}

export function feedbackSuccess() {
  beep(880, 0.15)
  vibrate(120)
}

export function feedbackError() {
  beep(220, 0.35)
  vibrate([90, 70, 90, 70, 90])
}

// Вызвать при первом клике пользователя, чтобы iOS разрешил звук
export function unlockAudio() {
  try {
    const AudioCtx = window.AudioContext || window.webkitAudioContext
    if (!AudioCtx) return
    if (!ctx) ctx = new AudioCtx()
    if (ctx.state === 'suspended') ctx.resume()
  } catch {
    /* ignore */
  }
}
