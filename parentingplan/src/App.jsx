import { Routes, Route } from 'react-router-dom'
import PlanPage from './pages/PlanPage'

export default function App() {
  return (
    <Routes>
      <Route path="/*" element={<PlanPage />} />
    </Routes>
  )
}
