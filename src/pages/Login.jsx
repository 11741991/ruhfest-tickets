import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase.js'
import { useAuth } from '../context/AuthContext.jsx'

export default function Login() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const navigate = useNavigate()
  const { session, loading } = useAuth()

  useEffect(() => {
    if (!loading && session) navigate('/admin', { replace: true })
  }, [session, loading, navigate])

  async function onSubmit(e) {
    e.preventDefault()
    setError('')
    setBusy(true)

    const { error: err } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password
    })

    setBusy(false)

    if (err) {
      setError('Неверный email или пароль')
      return
    }

    navigate('/admin', { replace: true })
  }

  return (
    <div className="page">
      <div style={{ textAlign: 'center', margin: '40px 0 28px' }}>
        <div className="ticket-logo">RUHFEST</div>
        <div className="ticket-sub">вход для сотрудников</div>
      </div>

      <form onSubmit={onSubmit}>
        {error && <div className="error">{error}</div>}

        <div className="field">
          <label htmlFor="email">Email</label>
          <input
            id="email"
            type="email"
            inputMode="email"
            autoComplete="username"
            autoCapitalize="none"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </div>

        <div className="field">
          <label htmlFor="password">Пароль</label>
          <input
            id="password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </div>

        <button className="btn-primary" type="submit" disabled={busy}>
          {busy ? 'Вход…' : 'Войти'}
        </button>
      </form>
    </div>
  )
}
