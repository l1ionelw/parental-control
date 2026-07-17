import { clearSession } from './api'

// A full reload re-mounts main.jsx's Root, which re-checks getToken() and falls
// back to the Auth screen - simpler than lifting auth state into the router.
export function useLogout() {
  return () => {
    clearSession()
    window.location.href = '/'
  }
}
