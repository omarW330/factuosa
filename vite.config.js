import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// base './' → rutas relativas, funciona en GitHub Pages bajo /<repo>/
export default defineConfig({
  base: './',
  plugins: [react(), tailwindcss()],
})
