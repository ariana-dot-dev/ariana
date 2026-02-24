import { useAuth } from '@/contexts/AuthContext'
import { Login } from '@/pages/Login'
import { Dashboard } from '@/pages/Dashboard'

function App() {
  const { token, isLoading } = useAuth()

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-lg">Loading...</div>
      </div>
    )
  }

  return token ? <Dashboard /> : <Login />
}

export default App
