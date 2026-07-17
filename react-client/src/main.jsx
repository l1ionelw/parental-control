import React, { useState } from 'react'
import ReactDOM from 'react-dom/client'
import { RouterProvider } from 'react-router-dom'
import { router } from './router.jsx'
import { getToken } from './lib/api'
import Auth from './screens/Auth'
import './index.css'

function Root() {
  const [authed, setAuthed] = useState(() => !!getToken())

  if (!authed) return <Auth onAuthed={() => setAuthed(true)} />
  return <RouterProvider router={router} />
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>,
)
