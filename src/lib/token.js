// QR содержит полную ссылку вида https://домен/ticket/<token>.
// Но сканер должен корректно принимать и «голый» токен.
export function extractToken(raw) {
  if (!raw) return ''
  const value = String(raw).trim()

  const marker = '/ticket/'
  const idx = value.lastIndexOf(marker)
  if (idx !== -1) {
    return value
      .slice(idx + marker.length)
      .split(/[?#/]/)[0]
      .trim()
  }

  return value
}

export function ticketUrl(token) {
  return `${window.location.origin}/ticket/${token}`
}

export function formatTime(iso) {
  const d = iso ? new Date(iso) : new Date()
  return d.toLocaleTimeString('ru-RU', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  })
}

export function formatDateTime(iso) {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  })
}
