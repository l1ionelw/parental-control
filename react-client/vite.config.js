import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// No dev proxy: the server URL is entered explicitly at runtime (see
// ApiUrlSetup.jsx / lib/apiConfig.js) and requests go straight to it, cross-origin
// - identical behavior in dev and in any deployment. The Flask server needs CORS
// enabled for this (see server/server.py).
export default defineConfig({
  plugins: [react(), tailwindcss()],
})
