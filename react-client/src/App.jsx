import { useState } from 'react'
import { getToken, getUser, clearSession } from './lib/api'
import Auth from './screens/Auth'
import Home from './screens/Home'

export default function App() {
  // Restore session from localStorage on first load.
  const [user, setUser] = useState(() => (getToken() ? getUser() : null))

  function handleLogout() {
    clearSession()
    setUser(null)
  }

  return user ? (
    <Home user={user} onLogout={handleLogout} />
  ) : (
    <Auth onAuthed={setUser} />
  )
}
