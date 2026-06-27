#!/usr/bin/env node
/**
 * Migra los datos de public/data/ a Supabase:
 *   - sube cada imagen (base64) al bucket Storage 'facturas'
 *   - inserta/actualiza cada factura en la tabla 'facturas'
 *
 * Uso:
 *   node scripts/import-to-supabase.js            # importa todas las tandas de index.json
 *   node scripts/import-to-supabase.js 2026-06-25.json   # solo un fichero
 *   node scripts/import-to-supabase.js --dry      # simula sin escribir
 *
 * Lee las claves de .env (VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY).
 */
import { readFileSync, existsSync, readdirSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createClient } from '@supabase/supabase-js'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const dataDir = resolve(root, 'public/data')

// .env mínimo (sin dependencias)
const env = {}
if (existsSync(resolve(root, '.env'))) {
  for (const line of readFileSync(resolve(root, '.env'), 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
    if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '')
  }
}
const URL = env.VITE_SUPABASE_URL || process.env.VITE_SUPABASE_URL
const KEY = env.VITE_SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY
if (!URL || !KEY) { console.error('Faltan VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY en .env'); process.exit(1) }

const args = process.argv.slice(2)
const dry = args.includes('--dry')
const only = args.find(a => a.endsWith('.json'))
const sb = createClient(URL, KEY, { auth: { persistSession: false } })

const EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif' }

async function importTanda(archivo) {
  const path = resolve(dataDir, archivo)
  if (!existsSync(path)) { console.error('  no existe', archivo); return }
  const j = JSON.parse(readFileSync(path, 'utf8'))
  const tanda = j.fecha || archivo.replace(/\.json$/, '')
  const items = j.items || []
  console.log(`\nTanda ${tanda} — ${items.length} facturas`)
  let okImg = 0, okRow = 0
  for (const it of items) {
    const rowBase = {
      tanda, item_id: it.id, rot0: it.rot0 ?? 0,
      fecha: it.fecha ?? null, proveedor: it.proveedor ?? null, num: it.num ?? null,
      base: it.base ?? null, iva: it.iva ?? null, total: it.total ?? null,
      timp: it.timp ?? null, conf: it.conf ?? null, flag: !!it.flag, obs: it.obs ?? null,
    }
    let img_path = null
    const m = String(it.img || '').match(/^data:(image\/[a-z+]+);base64,(.+)$/i)
    if (m) {
      const ext = EXT[m[1].toLowerCase()] || 'jpg'
      img_path = `${tanda}/${it.id}.${ext}`
      if (!dry) {
        const buf = Buffer.from(m[2], 'base64')
        const { error } = await sb.storage.from('facturas').upload(img_path, buf, { contentType: m[1], upsert: true })
        if (error) { console.error('  ✗ img', it.id, error.message); img_path = null } else okImg++
      } else okImg++
    }
    if (!dry) {
      const { error } = await sb.from('facturas').upsert({ ...rowBase, img_path }, { onConflict: 'tanda,item_id' })
      if (error) { console.error('  ✗ fila', it.id, error.message) } else okRow++
    } else okRow++
  }
  console.log(`  ${dry ? '[DRY] ' : ''}imágenes: ${okImg}/${items.length} · filas: ${okRow}/${items.length}`)
}

const idxPath = resolve(dataDir, 'index.json')
let archivos = []
if (only) archivos = [only]
else if (existsSync(idxPath)) archivos = (JSON.parse(readFileSync(idxPath, 'utf8')).tandas || []).map(t => t.archivo)
else archivos = readdirSync(dataDir).filter(f => f.endsWith('.json') && f !== 'index.json')

if (!archivos.length) { console.log('Nada que importar.'); process.exit(0) }
for (const a of archivos) await importTanda(a)
console.log('\nListo.')
