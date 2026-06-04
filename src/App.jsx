import { Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider } from './context/AuthContext'
import { FamilyProvider } from './context/FamilyContext'
import ProtectedRoute from './components/layout/ProtectedRoute'
import AppLayout from './components/layout/AppLayout'
import AdminRoute from './components/admin/AdminRoute'
import AdminLayout from './components/admin/AdminLayout'
import LoginPage from './pages/LoginPage'
import ResetPasswordPage from './pages/ResetPasswordPage'
import JoinPage from './pages/JoinPage'
import AdminLoginPage from './pages/admin/AdminLoginPage'
import AdminDashboardPage from './pages/admin/AdminDashboardPage'
import CalendarPage from './pages/CalendarPage'
import NoticeBoardPage from './pages/NoticeBoardPage'
import MediaPage from './pages/MediaPage'
import ConfigPage from './pages/ConfigPage'
import InvitePage from './pages/InvitePage'
import RequestsPage from './pages/RequestsPage'
import InfoBankPage from './pages/InfoBankPage'

export default function App() {
  return (
    <AuthProvider>
      <FamilyProvider>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/reset-password" element={<ResetPasswordPage />} />
          <Route path="/join/:code" element={<JoinPage />} />

          {/* Admin — completely separate from the customer app */}
          <Route path="/admin/login" element={<AdminLoginPage />} />
          <Route path="/admin" element={<AdminRoute><AdminLayout /></AdminRoute>}>
            <Route index element={<Navigate to="/admin/dashboard" replace />} />
            <Route path="dashboard" element={<AdminDashboardPage />} />
          </Route>
          <Route
            element={
              <ProtectedRoute>
                <AppLayout />
              </ProtectedRoute>
            }
          >
            <Route index element={<Navigate to="/calendar" replace />} />
            <Route path="/calendar" element={<CalendarPage />} />
            <Route path="/board" element={<NoticeBoardPage />} />
            <Route path="/board/media" element={<MediaPage />} />
            <Route path="/config" element={<ConfigPage />} />
            <Route path="/invite" element={<InvitePage />} />
            <Route path="/requests" element={<RequestsPage />} />
            <Route path="/info" element={<InfoBankPage />} />
          </Route>
        </Routes>
      </FamilyProvider>
    </AuthProvider>
  )
}
