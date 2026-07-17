import React, { useState } from 'react'
import ReactDOM from 'react-dom/client'
import { RouterProvider } from 'react-router-dom'
import { router } from './router.jsx'
import { getToken } from './lib/api'
import { getApiUrl } from './lib/apiConfig'
import Auth from './screens/Auth'
import ApiUrlSetup from './screens/ApiUrlSetup'
import './index.css'

function Root() {
  const [apiUrl, setApiUrl] = useState(getApiUrl)
  const [authed, setAuthed] = useState(() => !!getToken())

  if (!apiUrl) return <ApiUrlSetup onSaved={setApiUrl} />
  if (!authed) return <Auth onAuthed={() => setAuthed(true)} />
  return <RouterProvider router={router} />
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>,
)
