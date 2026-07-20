import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { createRequire } from 'module'

const require = createRequire(import.meta.url)
const ttsMiddleware = require('./server/ttsMiddleware.cjs')

/** Vite plugin: mounts the silent SAPI TTS middleware on the dev server */
function ttsOfflinePlugin() {
  return {
    name: 'tts-offline-sapi',
    configureServer(server) {
      server.middlewares.use(ttsMiddleware)
      console.log('[TTS-offline] SAPI middleware ready: /offline/voices, /offline/synthesize')
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), ttsOfflinePlugin()],
  server: {
    watch: {
      ignored: ['**/filesach/**', '**/*.pdf', '**/*.epub']
    },
    proxy: {
      // Proxy Google TTS requests to bypass CORS (for Online mode)
      '/api/tts': {
        target: 'https://translate.google.com',
        changeOrigin: true,
        secure: false,
        rewrite: (path) => path.replace(/^\/api\/tts/, '/translate_tts'),
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Referer': 'https://translate.google.com/',
          'Accept': 'audio/mpeg, audio/*, */*',
        },
      },
    },
  }
})
