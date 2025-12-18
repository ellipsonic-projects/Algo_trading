import AppRouter from './router/AppRouter'
import { AngelConnectionProvider } from './shared/angel/AngelConnectionProvider'
import { ThemeProvider } from './shared/theme/ThemeProvider'

export default function App() {
  return (
    <ThemeProvider>
      <AngelConnectionProvider>
        <AppRouter />
      </AngelConnectionProvider>
    </ThemeProvider>
  )
}
