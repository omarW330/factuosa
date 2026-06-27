#!/usr/bin/env node
/**
 * Limpia public/data para que el repo no crezca con tandas antiguas.
 *
 * Uso:
 *   node scripts/clean-data.js --list                 # ver tandas y tamaño
 *   node scripts/clean-data.js --before 2026-06-01    # borra tandas con fecha anterior
 *   node scripts/clean-data.js --keep 3               # conserva solo las 3 más recientes
 *   node scripts/clean-data.js --file 2026-06-25.json # borra una tanda concreta
 *   node scripts/clean-data.js --all                  # borra TODAS las tandas
 *   (añade --dry para simular sin borrar)
 *
 * Siempre actualiza index.json al terminar.
 */
import { readFileSync, writeFileSync, existsSync, rmSync, statSync, readdirSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const dataDir = resolve(dirname(fileURLToPath(import.meta.url)), '../public/data')
const idxPath = resolve(dataDir, 'index.json')
const args = process.argv.slice(2)
const has = f => args.includes(f)
const val = f => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : null }
const dry = has('--dry')

const readIndex = () => existsSync(idxPath) ? JSON.parse(readFileSync(idxPath, 'utf8')) : { tandas: [] }
const kb = n => (n / 1024).toFixed(0) + ' KB'
const sizeOf = archivo => { const p = resolve(dataDir, archivo); return existsSync(p) ? statSync(p).size : 0 }

let idx = readIndex()
let tandas = [...(idx.tandas || [])].sort((a, b) => (a.fecha < b.fecha ? 1 : -1)) // recientes primero

if (has('--list') || args.length === 0) {
  let total = 0
  console.log(`\nTandas en ${dataDir}:\n`)
  for (const t of tandas) { const s = sizeOf(t.archivo); total += s; console.log(`  ${t.fecha}  ${t.archivo.padEnd(20)} ${String(t.n).padStart(3)} fact.  ${kb(s)}`) }
  console.log(`\n  Total: ${tandas.length} tandas · ${kb(total)}\n`)
  if (args.length === 0) console.log('Opciones: --before <fecha> | --keep <n> | --file <archivo> | --all   (+ --dry)\n')
  process.exit(0)
}

let toDelete = []
if (has('--all')) toDelete = tandas.slice()
else if (val('--file')) toDelete = tandas.filter(t => t.archivo === val('--file'))
else if (val('--before')) toDelete = tandas.filter(t => t.fecha < val('--before'))
else if (val('--keep')) toDelete = tandas.slice(Number(val('--keep')))
else { console.error('Indica qué borrar: --before / --keep / --file / --all'); process.exit(1) }

if (toDelete.length === 0) { console.log('Nada que borrar con ese criterio.'); process.exit(0) }

console.log(`\n${dry ? '[DRY] ' : ''}Borrando ${toDelete.length} tanda(s):`)
for (const t of toDelete) {
  const p = resolve(dataDir, t.archivo)
  console.log(`  - ${t.archivo} (${kb(sizeOf(t.archivo))})`)
  if (!dry && existsSync(p)) rmSync(p)
}
const del = new Set(toDelete.map(t => t.archivo))
idx.tandas = (idx.tandas || []).filter(t => !del.has(t.archivo))
if (!dry) writeFileSync(idxPath, JSON.stringify(idx, null, 2))
console.log(`\n${dry ? '[DRY] ' : ''}index.json → ${idx.tandas.length} tanda(s) restante(s).\n`)
