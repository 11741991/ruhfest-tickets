import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase.js'
import { formatDateTime, ticketUrl } from '../lib/token.js'

export default function Admin() {
  const [tickets, setTickets] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  const [showForm, setShowForm] = useState(false)
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [creating, setCreating] = useState(false)
  const [created, setCreated] = useState(null)

  const [query, setQuery] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    const { data, error: err } = await supabase
      .from('tickets')
      .select('*')
      .order('created_at', { ascending: false })

    setLoading(false)

    if (err) {
      setError('Не удалось загрузить билеты: ' + err.message)
      return
    }
    setError('')
    setTickets(data || [])
  }, [])

  useEffect(() => {
    load()
  }, [load])

  async function createTicket(e) {
    e.preventDefault()
    setError('')
    setNotice('')

    if (!name.trim() || !phone.trim()) {
      setError('Заполните имя и номер телефона')
      return
    }

    setCreating(true)

    // ticket_number и token генерирует база (sequence + gen_random_bytes)
    const { data, error: err } = await supabase
      .from('tickets')
      .insert({ name: name.trim(), phone: phone.trim() })
      .select()
      .single()

    setCreating(false)

    if (err) {
      setError('Не удалось создать билет: ' + err.message)
      return
    }

    setCreated(data)
    setName('')
    setPhone('')
    setShowForm(false)
    setTickets((prev) => [data, ...prev])
  }

  async function toggleBlock(t) {
    setError('')
    const { data, error: err } = await supabase
      .from('tickets')
      .update({ is_blocked: !t.is_blocked })
      .eq('id', t.id)
      .select()
      .single()

    if (err) {
      setError('Не удалось изменить билет: ' + err.message)
      return
    }
    setTickets((prev) => prev.map((x) => (x.id === data.id ? data : x)))
    if (created?.id === data.id) setCreated(data)
  }

  function openTicket(token) {
    window.open(ticketUrl(token), '_blank', 'noopener,noreferrer')
  }

  async function copyLink(token) {
    const url = ticketUrl(token)
    try {
      await navigator.clipboard.writeText(url)
    } catch {
      // Fallback для старых мобильных браузеров
      const ta = document.createElement('textarea')
      ta.value = url
      ta.style.position = 'fixed'
      ta.style.opacity = '0'
      document.body.appendChild(ta)
      ta.select()
      try {
        document.execCommand('copy')
      } catch {
        /* ignore */
      }
      document.body.removeChild(ta)
    }
    setNotice('Ссылка скопирована')
    setTimeout(() => setNotice(''), 2000)
  }

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return tickets
    const digits = q.replace(/\D/g, '')
    return tickets.filter((t) => {
      const byNumber = t.ticket_number.toLowerCase().includes(q)
      const byPhone =
        digits.length > 0 && t.phone.replace(/\D/g, '').includes(digits)
      const byName = t.name.toLowerCase().includes(q)
      return byNumber || byPhone || byName
    })
  }, [tickets, query])

  return (
    <div className="page">
      <h1>Билеты</h1>

      {error && <div className="error">{error}</div>}
      {notice && <div className="notice">{notice}</div>}

      {!showForm && (
        <button
          className="btn-primary"
          type="button"
          onClick={() => {
            setShowForm(true)
            setCreated(null)
          }}
        >
          Создать билет
        </button>
      )}

      {showForm && (
        <form className="card" onSubmit={createTicket}>
          <h2>Новый билет</h2>

          <div className="field">
            <label htmlFor="n">Имя посетителя</label>
            <input
              id="n"
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoComplete="off"
              required
            />
          </div>

          <div className="field">
            <label htmlFor="p">Номер телефона</label>
            <input
              id="p"
              type="tel"
              inputMode="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="+7 700 000 00 00"
              autoComplete="off"
              required
            />
          </div>

          <div className="btn-row">
            <button className="btn-primary" type="submit" disabled={creating}>
              {creating ? 'Создание…' : 'Создать билет'}
            </button>
            <button type="button" onClick={() => setShowForm(false)}>
              Отмена
            </button>
          </div>
        </form>
      )}

      {created && (
        <div className="card" style={{ borderColor: 'var(--green)' }}>
          <h2>Билет создан</h2>
          <div className="ticket-name">{created.name}</div>
          <div className="ticket-no" style={{ marginBottom: 10 }}>
            {created.ticket_number} · {created.phone}
          </div>
          <div
            className="muted"
            style={{ wordBreak: 'break-all', marginBottom: 12 }}
          >
            {ticketUrl(created.token)}
          </div>
          <div className="btn-row">
            <button
              className="btn-primary btn-sm"
              type="button"
              onClick={() => copyLink(created.token)}
            >
              Копировать ссылку
            </button>
            <button
              className="btn-sm"
              type="button"
              onClick={() => openTicket(created.token)}
            >
              Открыть билет
            </button>
          </div>
        </div>
      )}

      <div className="field" style={{ marginTop: 18 }}>
        <label htmlFor="q">Поиск по номеру билета, телефону или имени</label>
        <input
          id="q"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="RUH-000001 или 7700…"
          autoComplete="off"
        />
      </div>

      <div className="btn-row" style={{ marginBottom: 16 }}>
        <button className="btn-sm" type="button" onClick={load}>
          Обновить список
        </button>
      </div>

      {loading && <div className="center">Загрузка…</div>}

      {!loading && filtered.length === 0 && (
        <div className="center">Билетов не найдено</div>
      )}

      {filtered.map((t) => (
        <div className="card" key={t.id}>
          <div className="card-head">
            <div>
              <div className="ticket-name">{t.name}</div>
              <div className="ticket-no">
                {t.ticket_number} · {t.phone}
              </div>
            </div>
            <span
              className={
                'badge ' +
                (t.is_blocked
                  ? 'badge-blocked'
                  : t.status === 'inside'
                    ? 'badge-inside'
                    : 'badge-outside')
              }
            >
              {t.is_blocked
                ? 'Заблокирован'
                : t.status === 'inside'
                  ? 'Внутри'
                  : 'Снаружи'}
            </span>
          </div>

          <div className="muted" style={{ marginBottom: 12 }}>
            Вход: {formatDateTime(t.last_entry_at)} · Выход:{' '}
            {formatDateTime(t.last_exit_at)}
          </div>

          <div className="btn-row">
            <button
              className="btn-sm"
              type="button"
              onClick={() => openTicket(t.token)}
            >
              Открыть билет
            </button>
            <button
              className="btn-sm"
              type="button"
              onClick={() => copyLink(t.token)}
            >
              Копировать ссылку
            </button>
            <button
              className={t.is_blocked ? 'btn-sm' : 'btn-sm btn-danger'}
              type="button"
              onClick={() => toggleBlock(t)}
              style={{ flex: '1 1 100%' }}
            >
              {t.is_blocked ? 'Разблокировать' : 'Заблокировать'}
            </button>
          </div>
        </div>
      ))}
    </div>
  )
}
