import { NavLink, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase.js'

export default function StaffLayout({ children }) {
  const navigate = useNavigate()

  async function logout() {
    await supabase.auth.signOut()
    navigate('/login', { replace: true })
  }

  return (
    <>
      <div className="topbar">
        <span className="brand">RUHFEST</span>
        <button
          className="btn-sm"
          style={{ width: 'auto' }}
          onClick={logout}
          type="button"
        >
          Выйти
        </button>
      </div>

      <nav className="navrow">
        <NavLink to="/admin">Билеты</NavLink>
        <NavLink to="/scan-in">ВХОД</NavLink>
        <NavLink to="/scan-out">ВЫХОД</NavLink>
      </nav>

      {children}
    </>
  )
}
