import { createBrowserRouter, Navigate } from 'react-router-dom'
import DevicesPage from './screens/DevicesPage'
import AppsPage from './screens/AppsPage'
import ScreenTimePage from './screens/ScreenTimePage'
import BrowserScreenTimePage from './screens/BrowserScreenTimePage'
import LimitsPage from './screens/LimitsPage'
import BrowsersPage from './screens/BrowsersPage'
import ScreenSharePage from './screens/ScreenSharePage'

// Auth is gated in main.jsx (renders <Auth/> instead of this router at all when
// there's no token), so every route here can assume it's already authenticated.
export const router = createBrowserRouter([
  { path: '/', element: <Navigate to="/devices" replace /> },
  { path: '/devices', Component: DevicesPage },
  { path: '/apps', Component: AppsPage },
  // App screen time and browser (tab) screen time are separate routes rather than
  // client-side-only state, so each is directly linkable/bookmarkable and the
  // home screen's tiles can point at one or the other.
  { path: '/screentime', Component: ScreenTimePage },
  { path: '/screentime/browser', Component: BrowserScreenTimePage },
  { path: '/limits', Component: LimitsPage },
  { path: '/browsers', Component: BrowsersPage },
  { path: '/screenshare', Component: ScreenSharePage },
  { path: '*', element: <Navigate to="/devices" replace /> },
])
