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

// Lee el estado de UNA tanda. Devuelve { marks, updatedAt } o null.
export async function loadRemote(tanda) {
  if (!sb) return null
  const { data, error } = await sb.from('review_state').select('marks, updated_at').eq('tanda', tanda).maybeSingle()
  if (error || !data) return null
  return { marks: data.marks || {}, updatedAt: data.updated_at }
}

// Lee el estado de TODAS las tandas (para el panel). Devuelve { [tanda]: marks }.
export async function loadAllRemote() {
  if (!sb) return {}
  const { data, error } = await sb.from('review_state').select('tanda, marks')
  if (error || !data) return {}
  const out = {}
  for (const r of data) out[r.tanda] = r.marks || {}
  return out
}

// Guarda (upsert) el estado de una tanda.
export async function saveRemote(tanda, marks) {
  if (!sb) return false
  const { error } = await sb.from('review_state').upsert(
    { tanda, marks, updated_at: new Date().toISOString() },
    { onConflict: 'tanda' }
  )
  return !error
}

// Borra el estado remoto de una tanda (al eliminar la tanda).
export async function deleteRemote(tanda) {
  if (!sb) return false
  const { error } = await sb.from('review_state').delete().eq('tanda', tanda)
  return !error
}

/* ---------- datos (facturas/tandas) en Supabase ---------- */

// Lista de tandas desde la vista `tandas`. Devuelve null si no hay sync.
export async function listTandas() {
  if (!sb) return null
  const { data, error } = await sb.from('tandas').select('tanda, n, creado').order('tanda', { ascending: false })
  if (error || !data) return null
  return data.map(r => ({ fecha: r.tanda, archivo: r.tanda, n: r.n, creado: r.creado }))
}

// Facturas de una tanda, con la imagen como URL firmada del Storage.
// Devuelve el mismo shape que los items del JSON (id, img, rot0, ...).
export async function loadFacturas(tanda) {
  if (!sb) return null
  const { data, error } = await sb.from('facturas').select('*').eq('tanda', tanda).order('item_id', { ascending: true })
  if (error || !data) return null
  const paths = data.map(r => r.img_path).filter(Boolean)
  const urls = {}
  if (paths.length) {
    const { data: signed } = await sb.storage.from('facturas').createSignedUrls(paths, 86400)
    if (signed) for (const s of signed) if (s && s.signedUrl) urls[s.path] = s.signedUrl
  }
  return data.map(r => ({
    id: r.item_id, img: urls[r.img_path] || '', rot0: r.rot0 ?? 0,
    fecha: r.fecha, proveedor: r.proveedor, num: r.num,
    base: r.base, iva: r.iva, total: r.total, timp: r.timp,
    conf: r.conf, flag: r.flag, obs: r.obs,
  }))
}

// Todas las facturas (sin imágenes) para estadísticas.
export async function loadAllFacturas() {
  if (!sb) return null
  const { data, error } = await sb.from('facturas')
    .select('tanda,item_id,fecha,proveedor,base,iva,total,conf,flag')
    .order('tanda', { ascending: false })
  if (error || !data) return null
  return data
}

// Borra una tanda completa (filas + imágenes del Storage).
export async function deleteTandaData(tanda) {
  if (!sb) return false
  const { data: files } = await sb.from('facturas').select('img_path').eq('tanda', tanda)
  const paths = (files || []).map(f => f.img_path).filter(Boolean)
  if (paths.length) await sb.storage.from('facturas').remove(paths)
  const { error } = await sb.from('facturas').delete().eq('tanda', tanda)
  return !error
}
