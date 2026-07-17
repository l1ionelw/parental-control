import TopBar from '../components/TopBar'
import ScreenShare from './ScreenShare'
import { getUser } from '../lib/api'
import { useDevices } from '../lib/useDevices'
import { useLogout } from '../lib/useLogout'
import { useTheme } from '../lib/useTheme'

export default function ScreenSharePage() {
  const user = getUser()
  const onLogout = useLogout()
  const [theme, toggleTheme] = useTheme()
  const { devices } = useDevices(onLogout)

  return (
    <div className="min-h-full flex flex-col">
      <TopBar user={user} theme={theme} onToggleTheme={toggleTheme} onLogout={onLogout} />
      <main className="flex-1 w-full max-w-[680px] mx-auto px-5 pt-8 pb-16">
        <ScreenShare devices={devices} />
      </main>
    </div>
  )
}
