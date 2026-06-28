// Sincronización del estado de revisión entre dispositivos (Supabase).
// Si no hay claves configuradas, todo queda deshabilitado y la app usa solo
// localStorage (funciona igual, sin sincronizar).
//
// Tabla esperada (ver README / SQL):
//   review_state(tanda text primary key, marks jsonb, updated_at timestamptz)
import { createClient } from '@supabase/supabase-js'

const URL = import.meta.env.VITE_SUPABASE_URL
const KEY = import.meta.env.VITE_SUPABASE_ANON_KEY

export const syncEnabled = Boolean(URL && KEY)
const sb = syncEnabled ? createClient(URL, KEY, { auth: { persistSession: true, autoRefreshToken: true } }) : null

/* ---------- autenticación (usuario + contraseña) ---------- */
// El "usuario" se convierte en un email interno usuario@factuosa.local.
// Si el usuario ya incluye '@', se usa tal cual (permite email + contraseña).
const toEmail = u => (String(u).includes('@') ? String(u).trim() : `${String(u).toLowerCase().trim()}@factuosa.com`)

export async function getSession() { if (!sb) return null; const { data } = await sb.auth.getSession(); return data.session }
export function onAuth(cb) { if (!sb) return () => {}; const { data } = sb.auth.onAuthStateChange((_e, s) => cb(s)); return () => data.subscription.unsubscribe() }
export async function signIn(usuario, password) {
  if (!sb) return { error: 'sin backend' }
  const { error } = await sb.auth.signInWithPassword({ email: toEmail(usuario), password })
  return { error: error ? error.message : null }
}
export async function signOut() { if (sb) await sb.auth.signOut() }
export function userLabel(session) {
  const e = session?.user?.email || ''
  return e.endsWith('@factuosa.com') ? e.replace('@factuosa.com', '') : e
}

/* ---------- datos en Supabase ---------- */

// Todas las facturas (sin imágenes) para estadísticas.
export async function loadAllFacturas() {
  if (!sb) return null
  const { data, error } = await sb.from('facturas')
    .select('id,job_id,tanda,item_id,fecha,proveedor,base,iva,total,conf,flag')
    .order('job_id', { ascending: false })
  if (error || !data) return null
  return data
}

// Todas las revisiones (mapa factura_id -> {status, ...correcciones}).
export async function loadAllRevisiones() {
  if (!sb) return {}
  const { data, error } = await sb.from('revisiones').select('factura_id,status,correcciones')
  if (error || !data) return {}
  const out = {}
  for (const r of data) out[r.factura_id] = { status: r.status, ...(r.correcciones || {}) }
  return out
}

// Conteo por job: { [jobId]: { n, ver, rev } } (para el panel).
export async function loadJobStats() {
  if (!sb) return {}
  const [{ data: f }, { data: rev }] = await Promise.all([
    sb.from('facturas').select('id,job_id'),
    sb.from('revisiones').select('factura_id,status'),
  ])
  const byFact = {}; for (const r of (rev || [])) byFact[r.factura_id] = r.status
  const out = {}
  for (const row of (f || [])) {
    const j = row.job_id; if (!j) continue
    out[j] = out[j] || { n: 0, ver: 0, rev: 0 }
    out[j].n++
    const s = byFact[row.id]; if (s === 'ver') out[j].ver++; else if (s === 'rev') out[j].rev++
  }
  return out
}

// Borra un job completo: imágenes (facturas + uploads) y la fila job (cascade).
export async function deleteJob(job) {
  if (!sb) return false
  const { data: files } = await sb.from('facturas').select('img_path').eq('job_id', job.id)
  const paths = (files || []).map(f => f.img_path).filter(Boolean)
  if (paths.length) await sb.storage.from('facturas').remove(paths)
  try {
    const { data: ups } = await sb.storage.from('uploads').list(`${job.empresa}/${job.id}`)
    if (ups?.length) await sb.storage.from('uploads').remove(ups.map(u => `${job.empresa}/${job.id}/${u.name}`))
  } catch (e) {}
  const { error } = await sb.from('jobs').delete().eq('id', job.id)  // cascade: facturas + revisiones
  return !error
}

/* ================= v2: empresas / jobs / status / revisiones / subida ================= */

export async function listEmpresas() {
  if (!sb) return []
  const { data, error } = await sb.from('empresas').select('id, nombre').order('nombre')
  return error ? [] : (data || [])
}

// Jobs (lotes). Devuelve también, para los 'listo', el conteo real de facturas.
export async function listJobs() {
  if (!sb) return null
  const { data, error } = await sb.from('jobs').select('*').order('creado', { ascending: false })
  if (error || !data) return null
  return data
}

/* memoria de correcciones de proveedor (aprendizaje) */
export const normProv = s => String(s || '').trim().replace(/\s+/g, ' ').toUpperCase()
export async function loadAliases() {
  if (!sb) return {}
  const { data, error } = await sb.from('proveedores_alias').select('original, corregido')
  if (error || !data) return {}
  const out = {}; for (const r of data) out[r.original] = r.corregido; return out
}
export async function saveAlias(originalRaw, corregido) {
  if (!sb) return false
  const original = normProv(originalRaw)
  if (!original || !corregido || normProv(corregido) === original) return false
  const { error } = await sb.from('proveedores_alias').upsert(
    { original, muestra: originalRaw, corregido, updated_at: new Date().toISOString() },
    { onConflict: 'original' }
  )
  return !error
}

export async function createJob({ empresa, n_facturas = 0, estado = 'en_cola' }) {
  if (!sb) return null
  const { data, error } = await sb.from('jobs').insert({ empresa, n_facturas, estado }).select().single()
  return error ? null : data
}

export async function setJobEstado(id, estado) {
  if (!sb) return false
  const patch = { estado }
  if (estado === 'listo' || estado === 'error') patch.terminado = new Date().toISOString()
  const { error } = await sb.from('jobs').update(patch).eq('id', id)
  return !error
}

// Facturas de un job (con imagen firmada), mismo shape que loadFacturas.
export async function loadFacturasByJob(jobId) {
  if (!sb) return null
  const { data, error } = await sb.from('facturas').select('*').eq('job_id', jobId).order('item_id')
  if (error || !data) return null
  const paths = data.map(r => r.img_path).filter(Boolean)
  const urls = {}
  if (paths.length) {
    const { data: signed } = await sb.storage.from('facturas').createSignedUrls(paths, 86400)
    if (signed) for (const s of signed) if (s && s.signedUrl) urls[s.path] = s.signedUrl
  }
  return data.map(r => ({
    id: r.id, item_id: r.item_id, img: urls[r.img_path] || '', rot0: r.rot0 ?? 0,
    fecha: r.fecha, proveedor: r.proveedor, num: r.num,
    base: r.base, iva: r.iva, total: r.total, timp: r.timp,
    conf: r.conf, flag: r.flag, obs: r.obs,
  }))
}

// Latido de Cowork.
export async function loadStatus() {
  if (!sb) return null
  const { data, error } = await sb.from('status').select('*').eq('id', 1).maybeSingle()
  return error ? null : data
}

// Revisiones: cargar (mapa factura_id -> {status, ...correcciones}) y guardar.
export async function loadRevisiones(facturaIds) {
  if (!sb || !facturaIds?.length) return {}
  const { data, error } = await sb.from('revisiones').select('*').in('factura_id', facturaIds)
  if (error || !data) return {}
  const out = {}
  for (const r of data) out[r.factura_id] = { status: r.status, ...(r.correcciones || {}), updated_at: r.updated_at }
  return out
}

export async function saveRevision(factura_id, { status, correcciones }) {
  if (!sb) return false
  const { error } = await sb.from('revisiones').upsert(
    { factura_id, status: status ?? null, correcciones: correcciones || {}, user_id: undefined, updated_at: new Date().toISOString() },
    { onConflict: 'factura_id' }
  )
  return !error
}

// Subida (atajo): sube ficheros al bucket 'uploads' en <empresa>/<jobId>/<nombre>.
export async function uploadFiles(empresa, jobId, files, onProgress) {
  if (!sb) return { ok: false, paths: [] }
  const paths = []
  let done = 0
  for (const file of files) {
    const safe = file.name.replace(/[^\w.\-]+/g, '_')
    const path = `${empresa}/${jobId}/${safe}`
    const { error } = await sb.storage.from('uploads').upload(path, file, { upsert: true, contentType: file.type || undefined })
    if (!error) paths.push(path)
    done++; onProgress && onProgress(done, files.length)
  }
  return { ok: paths.length === files.length, paths }
}

// Realtime: avisa cuando cambian los jobs o el status.
export function subscribeJobs(cb) {
  if (!sb) return () => {}
  const ch = sb.channel('jobs-rt')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'jobs' }, cb)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'status' }, cb)
    .subscribe()
  return () => sb.removeChannel(ch)
}
