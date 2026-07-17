import { createBrowserRouter, Navigate } from 'react-router-dom'
import DevicesPage from './screens/DevicesPage'
import AppsPage from './screens/AppsPage'
import ScreenTimePage from './screens/ScreenTimePage'
import LimitsPage from './screens/LimitsPage'

// Auth is gated in main.jsx (renders <Auth/> instead of this router at all when
// there's no token), so every route here can assume it's already authenticated.
export const router = createBrowserRouter([
  { path: '/', element: <Navigate to="/devices" replace /> },
  { path: '/devices', Component: DevicesPage },
  { path: '/apps', Component: AppsPage },
  { path: '/screentime', Component: ScreenTimePage },
  { path: '/limits', Component: LimitsPage },
  { path: '*', element: <Navigate to="/devices" replace /> },
])
