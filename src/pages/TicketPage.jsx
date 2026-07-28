import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { QRCodeCanvas } from 'qrcode.react'
import { supabase } from '../lib/supabase.js'
import { ticketUrl } from '../lib/token.js'

export default function TicketPage() {
  const { token } = useParams()
  const [ticket, setTicket] = useState(null)
  const [state, setState] = useState('loading') // loading | ok | notfound | error
  const [qrSize, setQrSize] = useState(260)

  useEffect(() => {
    // QR должен быть крупным на любом телефоне
    function resize() {
      const size = Math.min(320, Math.max(200, window.innerWidth - 110))
      setQrSize(size)
    }
    resize()
    window.addEventListener('resize', resize)
    return () => window.removeEventListener('resize', resize)
  }, [])

  useEffect(() => {
    let mounted = true

    async function load() {
      // Публичный доступ идёт только через SECURITY DEFINER функцию,
      // которая отдаёт лишь имя, номер и токен.
      const { data, error } = await supabase.rpc('get_public_ticket', {
        ticket_token: token
      })

      if (!mounted) return

      if (error) {
        setState('error')
        return
      }

      const row = Array.isArray(data) ? data[0] : data
      if (!row) {
        setState('notfound')
        return
      }

      setTicket(row)
      setState('ok')
    }

    load()
    return () => {
      mounted = false
    }
  }, [token])

  if (state === 'loading') {
    return <div className="center">Загрузка билета…</div>
  }

  if (state === 'notfound') {
    return (
      <div className="ticket-page">
        <div className="ticket-logo">RUHFEST</div>
        <p className="ticket-hint" style={{ marginTop: 20 }}>
          Билет не найден. Проверьте ссылку или свяжитесь с организаторами.
        </p>
      </div>
    )
  }

  if (state === 'error') {
    return (
      <div className="ticket-page">
        <div className="ticket-logo">RUHFEST</div>
        <p className="ticket-hint" style={{ marginTop: 20 }}>
          Не удалось загрузить билет. Проверьте интернет и обновите страницу.
        </p>
      </div>
    )
  }

  return (
    <div className="ticket-page">
      <div className="ticket-logo">RUHFEST</div>
      <div className="ticket-sub">электронный билет</div>

      <div className="qr-box">
        <QRCodeCanvas
          value={ticketUrl(ticket.token)}
          size={qrSize}
          level="M"
          includeMargin={false}
          bgColor="#ffffff"
          fgColor="#000000"
        />
      </div>

      <div className="ticket-visitor">{ticket.name}</div>
      <div className="ticket-number-big">{ticket.ticket_number}</div>

      <p className="ticket-hint">
        Покажите этот QR-код сотруднику на входе и выходе
      </p>
    </div>
  )
}
