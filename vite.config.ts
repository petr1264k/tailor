import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { crx } from '@crxjs/vite-plugin'
import { fileURLToPath, URL } from 'node:url'
import manifest from './manifest.config.ts'

// Chrome extension (MV3) built with Vite + @crxjs/vite-plugin.
// `npm run dev` writes an unpacked extension to dist/ with HMR; `npm run build` writes the final bundle.
export default defineConfig({
  plugins: [react(), crx({ manifest })],
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  server: { port: 5173, strictPort: true, hmr: { port: 5173 } },
})
