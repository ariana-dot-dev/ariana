import { createContext, useContext, useState, useEffect, type ReactNode } from 'react'

interface AuthContextType {
  token: string | null
  login: () => void
  logout: () => void
  isLoading: boolean
}

const AuthContext = createContext<AuthContextType | undefined>(undefined)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    // SECURITY NOTE: JWT tokens are stored in localStorage for simplicity
    // This is vulnerable to XSS attacks. If an attacker can inject JavaScript
    // into the dashboard, they can steal the token and gain admin access.
    //
    // Mitigation strategies:
    // 1. Never render user-supplied content without sanitization
    // 2. Use Content-Security-Policy headers (implemented on backend)
    // 3. Keep dependencies updated to avoid XSS vulnerabilities
    // 4. Consider implementing token refresh mechanism for shorter token lifetimes
    //
    // Alternative: Use httpOnly cookies (requires backend changes to set cookies)
    const storedToken = localStorage.getItem('auth_token')
    if (storedToken) {
      setToken(storedToken)
    }
    setIsLoading(false)
  }, [])

  const login = async () => {
    try {
      // Get GitHub OAuth URL from backend with redirect back to dashboard
      const apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:3000'
      const dashboardUrl = window.location.origin + '/dashboard'
      const response = await fetch(
        `${apiUrl}/api/auth/sign-in/github?redirect=${encodeURIComponent(dashboardUrl)}`,
        {
          method: 'GET',
        }
      )

      if (!response.ok) {
        throw new Error('Failed to get GitHub OAuth URL')
      }

      const data = await response.json()

      // Redirect to GitHub OAuth URL
      window.location.href = data.url
    } catch (error) {
      console.error('Login failed:', error)
    }
  }

  const logout = () => {
    localStorage.removeItem('auth_token')
    setToken(null)
  }

  const storeToken = (newToken: string) => {
    localStorage.setItem('auth_token', newToken)
    setToken(newToken)
  }

  return (
    <AuthContext.Provider value={{ token, login, logout, isLoading }}>
      {children}
      {/* Hidden component to handle token storage */}
      <TokenHandler onTokenReceived={storeToken} />
    </AuthContext.Provider>
  )
}

// Component to handle token from URL
function TokenHandler({ onTokenReceived }: { onTokenReceived: (token: string) => void }) {
  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search)
    const token = urlParams.get('token')

    if (token) {
      // SECURITY WARNING: Token is passed via URL query parameter after OAuth callback
      // This exposes the token in:
      // - Browser history
      // - Server access logs
      // - Referrer headers if user navigates away
      // - Browser extensions with URL access
      //
      // We immediately clean it from the URL, but the token may have already been logged.
      // This is a common OAuth pattern but not ideal for security.
      onTokenReceived(token)

      // Remove token from URL for security
      const newUrl = window.location.pathname
      window.history.replaceState({}, document.title, newUrl)
    }
  }, [onTokenReceived])

  return null
}

export function useAuth() {
  const context = useContext(AuthContext)
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider')
  }
  return context
}
