import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs'
import { resolve } from 'node:path'

// base './' → rutas relativas, funciona en GitHub Pages bajo /<repo>/

// Plugin de desarrollo: permite que el botón "Eliminar" de la web borre de verdad
// el .json de public/data y lo quite de index.json (solo durante `npm run dev`).
// En producción (GitHub Pages, sin servidor) este endpoint no existe y la web
// hace un borrado "local" (oculta la tanda y limpia su estado en el navegador).
function dataApi() {
  const dataDir = resolve(process.cwd(), 'public/data')
  return {
    name: 'agm-data-api',
    configureServer(server) {
      server.middlewares.use('/__api/delete-tanda', (req, res) => {
        if (req.method !== 'POST') { res.statusCode = 405; return res.end('Method Not Allowed') }
        let body = ''
        req.on('data', c => (body += c))
        req.on('end', () => {
          try {
            const { archivo } = JSON.parse(body || '{}')
            if (!archivo || archivo.includes('/') || archivo.includes('..')) throw new Error('archivo inválido')
            const idxPath = resolve(dataDir, 'index.json')
            const filePath = resolve(dataDir, archivo)
            if (existsSync(filePath)) rmSync(filePath)
            if (existsSync(idxPath)) {
              const idx = JSON.parse(readFileSync(idxPath, 'utf8'))
              idx.tandas = (idx.tandas || []).filter(t => t.archivo !== archivo)
              writeFileSync(idxPath, JSON.stringify(idx, null, 2))
            }
            res.setHeader('Content-Type', 'application/json')
            res.end(JSON.stringify({ ok: true }))
          } catch (e) {
            res.statusCode = 400
            res.setHeader('Content-Type', 'application/json')
            res.end(JSON.stringify({ ok: false, error: String(e.message || e) }))
          }
        })
      })
    },
  }
}

export default defineConfig({
  base: './',
  plugins: [react(), tailwindcss(), dataApi()],
})
