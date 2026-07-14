import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// The Flask server (websocket + /api) runs on 5002. Proxy /api there so the
// frontend can call it same-origin in dev (no CORS needed).
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    proxy: {
      '/api': 'http://127.0.0.1:5002',
    },
  },
})
