import AppRouter from './router/AppRouter'
import { AngelConnectionProvider } from './shared/angel/AngelConnectionProvider'
import { ThemeProvider } from './shared/theme/ThemeProvider'

import { AuthProvider } from './context/AuthContext'

export default function App() {
  return (
    <ThemeProvider>
      <AuthProvider>
        <AngelConnectionProvider>
          <AppRouter />
        </AngelConnectionProvider>
      </AuthProvider>
    </ThemeProvider>
  )
}
