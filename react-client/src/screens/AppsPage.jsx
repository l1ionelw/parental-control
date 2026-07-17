import TopBar from '../components/TopBar'
import Apps from './Apps'
import { getUser } from '../lib/api'
import { useLogout } from '../lib/useLogout'
import { useTheme } from '../lib/useTheme'

export default function AppsPage() {
  const user = getUser()
  const onLogout = useLogout()
  const [theme, toggleTheme] = useTheme()

  return (
    <div className="min-h-full flex flex-col">
      <TopBar user={user} theme={theme} onToggleTheme={toggleTheme} onLogout={onLogout} />
      <main className="flex-1 w-full max-w-[680px] mx-auto px-5 pt-8 pb-16">
        <Apps onLogout={onLogout} />
      </main>
    </div>
  )
}
