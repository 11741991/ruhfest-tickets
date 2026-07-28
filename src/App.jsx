import { Navigate, Route, Routes } from 'react-router-dom'
import ProtectedRoute from './components/ProtectedRoute.jsx'
import StaffLayout from './components/StaffLayout.jsx'
import Login from './pages/Login.jsx'
import Admin from './pages/Admin.jsx'
import TicketPage from './pages/TicketPage.jsx'
import ScanIn from './pages/ScanIn.jsx'
import ScanOut from './pages/ScanOut.jsx'

function Staff({ children }) {
  return (
    <ProtectedRoute>
      <StaffLayout>{children}</StaffLayout>
    </ProtectedRoute>
  )
}

export default function App() {
  return (
    <Routes>
      {/* Публичная страница билета — без авторизации */}
      <Route path="/ticket/:token" element={<TicketPage />} />

      {/* Авторизация сотрудников */}
      <Route path="/login" element={<Login />} />

      {/* Закрытые страницы */}
      <Route
        path="/admin"
        element={
          <Staff>
            <Admin />
          </Staff>
        }
      />
      <Route
        path="/scan-in"
        element={
          <Staff>
            <ScanIn />
          </Staff>
        }
      />
      <Route
        path="/scan-out"
        element={
          <Staff>
            <ScanOut />
          </Staff>
        }
      />

      <Route path="/" element={<Navigate to="/admin" replace />} />
      <Route path="*" element={<Navigate to="/admin" replace />} />
    </Routes>
  )
}
