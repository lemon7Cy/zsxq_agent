import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { ToastProvider } from './components/Toast'
import Layout from './Layout'
import Login from './pages/Login'
import Groups from './pages/Groups'
import Topics from './pages/Topics'
import Refine from './pages/Refine'
import Skills from './pages/Skills'
import SkillDetail from './pages/SkillDetail'
import Config from './pages/Config'

function App() {
  return (
    <ToastProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route element={<Layout />}>
            <Route path="/groups" element={<Groups />} />
            <Route path="/groups/:groupId/topics" element={<Topics />} />
            <Route path="/refine" element={<Refine />} />
            <Route path="/skills" element={<Skills />} />
            <Route path="/skills/:skillId" element={<SkillDetail />} />
            <Route path="/config" element={<Config />} />
          </Route>
          <Route path="*" element={<Navigate to="/groups" replace />} />
        </Routes>
      </BrowserRouter>
    </ToastProvider>
  )
}

export default App
