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
const sb = syncEnabled ? createClient(URL, KEY, { auth: { persistSession: false } }) : null

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
