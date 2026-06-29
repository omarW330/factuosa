import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react'
import { buildXlsx, tsvTable } from './xlsx.js'
import { syncEnabled, getSession, onAuth, signIn, signOut, userLabel,
  listJobs, loadFacturasByJob, loadJobStats, deleteJob, loadRevisiones, saveRevision,
  loadAllFacturas, loadAllRevisiones, listEmpresas, createJob, uploadFiles, loadStatus, subscribeJobs,
  loadAliases, saveAlias, normProv } from './supabase.js'

/* ---------- helpers de datos ---------- */
const rotOf = (it, m) => (((m[it.id]?.rot ?? it.rot0) % 360) + 360) % 360
const F = (it, m, k) => { const s = m[it.id]; return s && s[k] != null ? s[k] : it[k] }
const Nv = (it, m, k) => { const v = F(it, m, k); return typeof v === 'number' ? v : (parseFloat(String(v).replace(',', '.')) || 0) }
const rank = (it, m) => { const s = m[it.id]?.status; if (s === 'ver') return 4; if (it.flag || it.conf === 'baja') return 0; if (it.conf === 'media') return 1; return 2 }
const isoFromDMY = s => { const p = String(s).split('/'); return p.length === 3 ? `${p[2]}-${p[1].padStart(2, '0')}-${p[0].padStart(2, '0')}` : (/^\d{4}-\d{2}-\d{2}$/.test(s) ? s : '') }
const dmyFromIso = s => { const p = String(s).split('-'); return p.length === 3 ? `${p[2].padStart(2, '0')}/${p[1].padStart(2, '0')}/${p[0]}` : s }
const fmtT = ms => { const s = Math.floor(ms / 1000); return String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0') }
const eur = n => Number(n || 0).toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €'
const cuadraOf = (it, m) => Math.abs((Nv(it, m, 'base') + Nv(it, m, 'iva')) - Nv(it, m, 'total')) <= 0.02
const norm = s => String(s || '').trim().replace(/\s+/g, ' ').toUpperCase()
// Set de ids de facturas que parecen duplicadas (mismo proveedor+nº, o mismo total+fecha)
const dupSetFrom = rows => {
  const byKey = {}; const add = (k, id) => { if (k) (byKey[k] = byKey[k] || []).push(id) }
  for (const r of (rows || [])) {
    const num = norm(r.num)
    if (num) add('N|' + norm(r.proveedor) + '|' + num, r.id)
    const t = r.total != null ? Number(r.total).toFixed(2) : ''
    if (t && t !== '0.00') add('T|' + t + '|' + (r.fecha || ''), r.id)
  }
  const dup = new Set()
  for (const k in byKey) if (byKey[k].length > 1) byKey[k].forEach(id => dup.add(id))
  return dup
}

/* ---------- localStorage seguro (Safari bloquea en file://) ---------- */
const lsGet = (k, fb) => { try { return JSON.parse(localStorage.getItem(k) || '') ?? fb } catch (e) { return fb } }
const lsSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)) } catch (e) {} }
const lsDel = k => { try { localStorage.removeItem(k) } catch (e) {} }

/* ---------- tema (claro/oscuro) y usuarios recordados ---------- */
const getTheme = () => { try { return localStorage.getItem('agm_theme') || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light') } catch (e) { return 'light' } }
const applyTheme = t => { try { document.documentElement.classList.toggle('dark', t === 'dark'); localStorage.setItem('agm_theme', t) } catch (e) {} }
const getUsers = () => { try { return JSON.parse(localStorage.getItem('agm_users') || '[]') } catch (e) { return [] } }
const rememberUser = u => { try { const n = String(u).toLowerCase().trim(); if (!n) return; const next = [n, ...getUsers().filter(x => x !== n)].slice(0, 5); localStorage.setItem('agm_users', JSON.stringify(next)) } catch (e) {} }
const cheer = name => { const m = name ? [`¡Bien hecho, ${name}!`, `¡Genial, ${name}!`, `¡Crack, ${name}!`, `¡Vas que vuelas, ${name}!`] : ['¡Bien hecho!']; return m[Math.floor(Date.now() / 1000) % m.length] }

/* ---------- iconos SVG (sin dependencias) ---------- */
const I = {
  check: <path d="M20 6 9 17l-5-5" />,
  flag: <path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1zM4 22v-7" />,
  back: <path d="m15 18-6-6 6-6" />,
  trash: <><path d="M3 6h18" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /></>,
  download: <><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><path d="M7 10l5 5 5-5" /><path d="M12 15V3" /></>,
  copy: <><rect x="9" y="9" width="13" height="13" rx="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></>,
  play: <path d="m6 3 14 9-14 9V3z" />,
  search: <><circle cx="11" cy="11" r="8" /><path d="m21 21-4.3-4.3" /></>,
  rotate: <><path d="M3 12a9 9 0 1 0 3-6.7L3 8" /><path d="M3 3v5h5" /></>,
  zoomIn: <><circle cx="11" cy="11" r="8" /><path d="m21 21-4.3-4.3" /><path d="M11 8v6M8 11h6" /></>,
  zoomOut: <><circle cx="11" cy="11" r="8" /><path d="m21 21-4.3-4.3" /><path d="M8 11h6" /></>,
  fit: <><path d="M3 8V5a2 2 0 0 1 2-2h3M21 8V5a2 2 0 0 0-2-2h-3M3 16v3a2 2 0 0 0 2 2h3M21 16v3a2 2 0 0 1-2 2h-3" /></>,
  x: <path d="M18 6 6 18M6 6l12 12" />,
  reset: <><path d="M3 2v6h6" /><path d="M3 13a9 9 0 1 0 3-7.7L3 8" /></>,
  refresh: <><path d="M21 12a9 9 0 1 1-2.64-6.36" /><path d="M21 3v6h-6" /></>,
  grid: <><rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" /></>,
  doc: <><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6" /></>,
  chevR: <path d="m9 18 6-6-6-6" />,
  edit: <><path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" /></>,
  chart: <><path d="M3 3v18h18" /><rect x="7" y="11" width="3" height="6" /><rect x="12" y="7" width="3" height="10" /><rect x="17" y="13" width="3" height="4" /></>,
  cloud: <path d="M17.5 19a4.5 4.5 0 0 0 .5-8.97A6 6 0 0 0 6.34 9 4 4 0 0 0 7 17h10.5z" />,
  cloudOff: <><path d="M2 2l20 20" /><path d="M17.5 19a4.5 4.5 0 0 0 1.9-8.58M9 5.5A6 6 0 0 1 18 9a4.5 4.5 0 0 1 .5.03M6.3 9A4 4 0 0 0 7 17h9" /></>,
  user: <><circle cx="12" cy="8" r="4" /><path d="M4 21v-1a6 6 0 0 1 6-6h4a6 6 0 0 1 6 6v1" /></>,
  logout: <><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><path d="m16 17 5-5-5-5" /><path d="M21 12H9" /></>,
  lock: <><rect x="3" y="11" width="18" height="11" rx="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></>,
  clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
  upload: <><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><path d="M7 9l5-5 5 5" /><path d="M12 4v12" /></>,
  sun: <><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></>,
  moon: <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />,
  spark: <path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z" />,
  camera: <><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" /><circle cx="12" cy="13" r="4" /></>,
  files: <><path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" /><path d="M13 2v7h7" /></>,
  copies: <><path d="M8 4h10a2 2 0 0 1 2 2v10" /><rect x="4" y="8" width="12" height="12" rx="2" /></>,
  wand: <><path d="M15 4V2M15 10V8M11 6H9M21 6h-2M18.5 3.5l-1.4 1.4M18.5 8.5l-1.4-1.4M4 20l9-9" /></>,
  alert: <><path d="M12 9v4M12 17h.01" /><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" /></>,
}

/* aviso automático cuando hay una versión nueva desplegada (evita quedarse cacheado en iOS) */
function UpdateBanner() {
  const [show, setShow] = useState(false)
  useEffect(() => {
    const cur = [...document.scripts].map(s => s.src).find(s => /assets\/index-.*\.js/.test(s))
    if (!cur) return
    let alive = true
    const check = () => fetch('index.html?cc=' + Date.now(), { cache: 'no-store' })
      .then(r => r.text())
      .then(html => { if (!alive) return; const m = html.match(/assets\/index-[A-Za-z0-9_-]+\.js/); if (m && !cur.includes(m[0])) setShow(true) })
      .catch(() => {})
    check()
    const i = setInterval(check, 5 * 60 * 1000)   // re-chequea cada 5 min
    return () => { alive = false; clearInterval(i) }
  }, [])
  if (!show) return null
  return (
    <div className="fixed top-0 inset-x-0 z-[90] safe-t brand-grad text-white text-sm font-semibold flex items-center justify-center gap-3 py-2 px-4 shadow-lg">
      <span>✨ Nueva versión disponible</span>
      <button onClick={() => location.replace(location.pathname + '?r=' + Date.now())} className="px-3 py-1 rounded-lg bg-white/25 hover:bg-white/40 transition">Actualizar</button>
    </div>
  )
}

function ThemeToggle({ theme, onToggle, className = '' }) {
  return (
    <button onClick={onToggle} title={theme === 'dark' ? 'Modo claro' : 'Modo oscuro'}
      className={'grid place-items-center w-9 h-9 rounded-xl border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition ' + className}>
      <Icon d={theme === 'dark' ? I.sun : I.moon} className="w-[18px] h-[18px]" />
    </button>
  )
}

/* ===================== LOGIN (Fase B) ===================== */
function Login({ theme, onToggleTheme }) {
  const recientes = getUsers()
  const [u, setU] = useState(recientes[0] || '')
  const [p, setP] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const pwRef = useRef(null)
  const pick = name => { setU(name); setErr(''); if (pwRef.current) pwRef.current.focus() }
  const submit = async e => {
    e.preventDefault(); setErr(''); setBusy(true)
    const { error } = await signIn(u, p)
    setBusy(false)
    if (error) setErr('Usuario o contraseña incorrectos')
    else rememberUser(u)
  }
  const inp = 'w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 dark:text-slate-100 px-3 py-2.5 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200 dark:focus:ring-indigo-500/30 outline-none'
  return (
    <div className="relative min-h-full grid place-items-center px-4 overflow-hidden">
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute -top-24 -left-20 w-80 h-80 rounded-full bg-indigo-400/30 dark:bg-indigo-500/20 blur-3xl" />
        <div className="absolute top-1/4 -right-24 w-80 h-80 rounded-full bg-fuchsia-400/25 dark:bg-fuchsia-500/15 blur-3xl" />
        <div className="absolute -bottom-24 left-1/4 w-80 h-80 rounded-full bg-emerald-300/25 dark:bg-emerald-500/10 blur-3xl" />
      </div>
      <form onSubmit={submit} className="relative z-10 w-full max-w-sm rounded-3xl bg-white/90 dark:bg-slate-900/90 backdrop-blur-xl border border-slate-200 dark:border-slate-800 shadow-2xl p-7 card-in">
        <div className="flex items-start justify-between mb-4">
          <div className="grid place-items-center w-12 h-12 rounded-2xl brand-grad text-white shadow-lg shadow-indigo-600/30"><Icon d={I.lock} /></div>
          <ThemeToggle theme={theme} onToggle={onToggleTheme} />
        </div>
        <h1 className="text-xl font-bold text-slate-900 dark:text-slate-100 dark:text-slate-100">Revisión de facturas <span className="brand-text">AGM</span></h1>
        <p className="text-[13px] text-slate-500 dark:text-slate-400 dark:text-slate-400 mt-0.5 mb-5">Acceso restringido</p>

        {recientes.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mb-4">
            {recientes.map(n => (
              <button key={n} type="button" onClick={() => pick(n)}
                className={'flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[13px] font-medium transition ' + (u === n ? 'bg-indigo-600 text-white' : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700')}>
                <span className="grid place-items-center w-5 h-5 rounded-full bg-white/20"><Icon d={I.user} className="w-3 h-3" /></span>{n}
              </button>
            ))}
          </div>
        )}

        <label className="block text-[13px] font-medium text-slate-600 dark:text-slate-300 dark:text-slate-300 mb-1">Usuario</label>
        <input autoFocus={!recientes.length} value={u} onChange={e => setU(e.target.value)} autoCapitalize="none" autoCorrect="off" className={inp + ' mb-3'} />
        <label className="block text-[13px] font-medium text-slate-600 dark:text-slate-300 dark:text-slate-300 mb-1">Contraseña</label>
        <input ref={pwRef} type="password" autoFocus={recientes.length > 0} value={p} onChange={e => setP(e.target.value)} className={inp} />
        {err && <p className="text-[13px] text-rose-600 dark:text-rose-400 mt-3">{err}</p>}
        <button type="submit" disabled={busy || !u || !p} className="mt-5 w-full py-3 rounded-xl brand-grad hover:opacity-90 disabled:opacity-50 text-white font-semibold transition">{busy ? 'Entrando…' : 'Entrar'}</button>
      </form>
    </div>
  )
}

/* indicador de sincronización entre dispositivos */
function SyncBadge({ sync }) {
  if (sync === 'off') return <span className="flex items-center gap-1 text-[12px] text-slate-400" title="Sincronización desactivada (solo este navegador)"><Icon d={I.cloudOff} className="w-4 h-4" /> Solo local</span>
  const map = {
    idle: { c: 'text-slate-400', t: 'Sincronizado entre dispositivos', l: 'En la nube' },
    saving: { c: 'text-indigo-500', t: 'Guardando…', l: 'Guardando…' },
    saved: { c: 'text-emerald-600', t: 'Guardado en la nube', l: 'Guardado' },
    error: { c: 'text-rose-500', t: 'Error al sincronizar (guardado en este equipo)', l: 'Sin conexión' },
  }
  const s = map[sync] || map.idle
  return <span className={'flex items-center gap-1 text-[12px] ' + s.c} title={s.t}><Icon d={I.cloud} className="w-4 h-4" /> {s.l}</span>
}
const Icon = ({ d, className = 'w-5 h-5', sw = 2 }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round" className={className}>{d}</svg>
)

/* esqueleto de carga */
const Skel = ({ className = '' }) => <div className={'animate-pulse rounded-2xl bg-slate-200/70 dark:bg-slate-800/80 ' + className} />

/* anillo de progreso */
function Ring({ pct, size = 76, stroke = 8 }) {
  const r = (size - stroke) / 2, c = 2 * Math.PI * r
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={stroke} className="stroke-slate-200 dark:stroke-slate-700" />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={stroke} strokeLinecap="round" stroke="url(#ringg)" strokeDasharray={c} strokeDashoffset={c * (1 - pct / 100)} style={{ transition: 'stroke-dashoffset .5s ease' }} />
        <defs><linearGradient id="ringg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#34d399" /><stop offset="1" stopColor="#059669" /></linearGradient></defs>
      </svg>
      <div className="absolute inset-0 grid place-items-center"><span className="text-base font-extrabold text-slate-900 dark:text-slate-100 tabular-nums">{pct}%</span></div>
    </div>
  )
}

/* ================================================================= */
export default function App() {
  const [jobs, setJobs] = useState([])
  const [stats, setStats] = useState({})             // {jobId: {n,ver,rev}}
  const [heartbeat, setHeartbeat] = useState(null)   // latido de Cowork (status)
  const [empresas, setEmpresas] = useState([])
  const [view, setView] = useState('dashboard')      // 'dashboard' | 'list' | 'stats'
  const [sel, setSel] = useState(null)               // job activo
  const [items, setItems] = useState([])
  const [marks, setMarks] = useState({})             // {facturaId: {status, ...correcciones}}
  const [upload, setUpload] = useState(false)
  const [confirm, setConfirm] = useState(null)       // job a eliminar
  const [sync, setSync] = useState(syncEnabled ? 'idle' : 'off') // 'off'|'idle'|'saving'|'saved'|'error'
  const [session, setSession] = useState(null)
  const [authReady, setAuthReady] = useState(!syncEnabled)
  const [theme, setTheme] = useState(getTheme)
  const [loaded, setLoaded] = useState(false)         // datos del panel cargados
  const [itemsLoading, setItemsLoading] = useState(false)
  const [aliases, setAliases] = useState({})          // memoria de correcciones de proveedor
  const [dupSet, setDupSet] = useState(() => new Set()) // facturas posibles duplicadas
  const cacheKeyRef = useRef('')
  const saveTimers = useRef({})

  const toggleTheme = () => setTheme(t => { const n = t === 'dark' ? 'light' : 'dark'; applyTheme(n); return n })
  useEffect(() => { applyTheme(theme) }, [])
  const userName = userLabel(session) || ''

  /* sesión (login usuario+contraseña) */
  useEffect(() => {
    if (!syncEnabled) return
    getSession().then(s => { setSession(s); setAuthReady(true) })
    return onAuth(s => setSession(s))
  }, [])

  /* jobs + stats + latido + empresas (Supabase, requiere sesión) */
  const refresh = useCallback(async () => {
    if (!syncEnabled) return
    const [j, s, hb, emp, al, allF] = await Promise.all([listJobs(), loadJobStats(), loadStatus(), listEmpresas(), loadAliases(), loadAllFacturas()])
    if (j) setJobs(j); setStats(s || {}); setHeartbeat(hb); setEmpresas(emp || []); setAliases(al || {}); setDupSet(dupSetFrom(allF)); setLoaded(true)
  }, [])
  /* aprende una corrección de proveedor (original IA → corregido) */
  const onAlias = useCallback((origRaw, corr) => {
    if (!origRaw || !corr || normProv(origRaw) === normProv(corr)) return
    setAliases(a => ({ ...a, [normProv(origRaw)]: corr }))
    saveAlias(origRaw, corr).catch(() => {})
  }, [])
  useEffect(() => { if (session) refresh() }, [session, refresh])
  /* Realtime: recarga cuando cambian los jobs o el latido */
  useEffect(() => { if (!session) return; return subscribeJobs(() => refresh()) }, [session, refresh])

  /* carga de un job (facturas + revisiones desde Supabase) */
  const openJob = useCallback(async job => {
    setSel(job); setView('list'); setItems([]); setItemsLoading(true)
    cacheKeyRef.current = 'agm_revj_' + job.id
    setMarks(lsGet(cacheKeyRef.current, {}))   // cache local primero (instantáneo)
    window.scrollTo(0, 0)
    const its = (await loadFacturasByJob(job.id)) || []
    setItems(its); setItemsLoading(false)
    const rev = await loadRevisiones(its.map(x => x.id))
    const m = {}
    for (const id in rev) { const { updated_at, ...rest } = rev[id]; m[id] = rest }
    setMarks(m); lsSet(cacheKeyRef.current, m); setSync('saved')
  }, [])

  /* persistencia: marcas → tabla revisiones (debounce por factura) + cache local */
  const update = useCallback((id, patch) => setMarks(prev => {
    const entry = { ...prev[id], ...patch }
    const m = { ...prev, [id]: entry }
    lsSet(cacheKeyRef.current, m)
    if (syncEnabled) {
      setSync('saving')
      clearTimeout(saveTimers.current[id])
      saveTimers.current[id] = setTimeout(() => {
        const { status = null, ...correcciones } = entry
        saveRevision(id, { status, correcciones }).then(ok => setSync(ok ? 'saved' : 'error')).catch(() => setSync('error'))
      }, 600)
    }
    return m
  }), [])
  const setField = (id, k, raw, num) => { update(id, { [k]: k === 'fecha' ? dmyFromIso(raw) : raw }) }   // guarda en crudo; Nv() parsea al leer
  const mark = (id, status) => update(id, { status })
  const rotate = id => { const it = items.find(x => x.id === id); update(id, { rot: (rotOf(it, marks) + 90) % 360 }) }
  const reset = id => update(id, { status: undefined, base: undefined, iva: undefined, total: undefined, fecha: undefined, proveedor: undefined, num: undefined, obs: undefined })

  /* borrar un job (facturas + imágenes + revisiones) */
  const removeJob = async job => {
    if (syncEnabled) { try { await deleteJob(job) } catch (e) {} }
    lsDel('agm_revj_' + job.id)
    setConfirm(null)
    if (sel && sel.id === job.id) { setView('dashboard'); setSel(null) }
    refresh()
  }

  /* export (usa la tanda cargada) */
  const approvedRows = (onlyVer) => [...items].filter(it => !onlyVer || marks[it.id]?.status === 'ver').sort((a, b) => isoFromDMY(F(a, marks, 'fecha')) < isoFromDMY(F(b, marks, 'fecha')) ? -1 : 1).map(it => {
    const s = marks[it.id]; const st = s?.status === 'ver' ? 'Verificada' : s?.status === 'rev' ? 'A revisar' : 'Pendiente'
    return { fecha: F(it, marks, 'fecha'), proveedor: F(it, marks, 'proveedor'), num: F(it, marks, 'num'), base: Nv(it, marks, 'base'), iva: Nv(it, marks, 'iva'), total: Nv(it, marks, 'total'), estado: st, obs: F(it, marks, 'obs'), amber: s?.status === 'rev' || it.flag }
  })
  const exportXlsx = (onlyVer) => { const blob = buildXlsx(approvedRows(onlyVer === true)); const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = (sel?.empresa || 'AGM') + (onlyVer === true ? '_verificadas' : '_revisado') + '.xlsx'; a.click(); URL.revokeObjectURL(a.href) }
  const copyTable = async () => { try { await navigator.clipboard.writeText(tsvTable(approvedRows())); alert(`${cheer(userName)} Tabla copiada, pégala en Excel.`) } catch (e) { alert('No se pudo copiar automáticamente.') } }

  if (syncEnabled && !authReady) return <div className="min-h-full grid place-items-center text-slate-400">Cargando…</div>
  if (syncEnabled && !session) return <><UpdateBanner /><Login theme={theme} onToggleTheme={toggleTheme} /></>

  return (
    <div className="min-h-full">
      <UpdateBanner />
      {view === 'dashboard' &&
        <Dashboard jobs={jobs} stats={stats} heartbeat={heartbeat} sync={sync} session={session} userName={userName} loaded={loaded}
          theme={theme} onToggleTheme={toggleTheme}
          onOpen={openJob} onDelete={setConfirm} onStats={() => setView('stats')} onUpload={() => setUpload(true)} />}
      {view === 'stats' &&
        <StatsView onBack={() => setView('dashboard')} />}
      {view === 'list' &&
        <ListView sel={sel} items={items} marks={marks} setField={setField} mark={mark} reset={reset} rotate={rotate} sync={sync} userName={userName} itemsLoading={itemsLoading}
          aliases={aliases} onAlias={onAlias} dupSet={dupSet} exportXlsx={exportXlsx} copyTable={copyTable} update={update}
          onBack={() => { setView('dashboard'); refresh() }} onDelete={() => setConfirm(sel)} />}

      {upload && <UploadModal empresas={empresas} userName={userName} onClose={() => setUpload(false)} onDone={() => { setUpload(false); refresh() }} />}
      {confirm && <ConfirmDelete job={confirm} onCancel={() => setConfirm(null)} onConfirm={() => removeJob(confirm)} />}
    </div>
  )
}

/* ===================== PANEL (dashboard) ===================== */
const ESTADO = {
  en_cola:    { l: 'En cola',    c: 'bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300' },
  procesando: { l: 'Procesando', c: 'bg-indigo-100 text-indigo-700' },
  listo:      { l: 'Listo',      c: 'bg-emerald-100 text-emerald-700' },
  error:      { l: 'Error',      c: 'bg-rose-100 text-rose-700' },
}
const relDay = iso => { try { return new Date(iso).toLocaleDateString('es-ES') } catch (e) { return '—' } }
const relTime = iso => {
  if (!iso) return '—'
  const d = (Date.now() - new Date(iso).getTime()) / 1000
  if (d < 60) return 'hace un momento'
  if (d < 3600) return `hace ${Math.floor(d / 60)} min`
  if (d < 86400) return `hace ${Math.floor(d / 3600)} h`
  return `hace ${Math.floor(d / 86400)} d`
}

function StatusBar({ heartbeat }) {
  if (!heartbeat) return null
  const last = heartbeat.last_run ? new Date(heartbeat.last_run).getTime() : null
  const intMin = heartbeat.interval_min || 15
  const sinceMin = last != null ? Math.round((Date.now() - last) / 60000) : null
  const sinceTxt = sinceMin == null ? null : sinceMin < 1 ? 'hace un momento' : sinceMin < 60 ? `hace ${sinceMin} min` : sinceMin < 1440 ? `hace ${Math.round(sinceMin / 60)} h` : `hace ${Math.round(sinceMin / 1440)} d`
  const paused = sinceMin != null && sinceMin > Math.max(60, intMin * 3)   // bastante más que el intervalo
  return (
    <div className="rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-4 shadow-sm flex items-center gap-3">
      <div className={'grid place-items-center w-10 h-10 rounded-xl ' + (heartbeat.procesando ? 'bg-indigo-100 text-indigo-600' : 'bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400')}><Icon d={I.clock} /></div>
      <div className="min-w-0">
        <div className="text-sm font-semibold text-slate-700 dark:text-slate-200">Automática (IA){heartbeat.procesando ? ' · procesando…' : ''}</div>
        <div className="text-[12px] text-slate-500 dark:text-slate-400">
          {last == null ? 'aún no se ha ejecutado' : <>última ejecución {sinceTxt} · se ejecuta de forma periódica</>}
        </div>
      </div>
      {paused && <span className="ml-auto text-[12px] text-amber-600 font-medium text-right leading-tight">⚠ puede estar<br />pausada</span>}
    </div>
  )
}

function Dashboard({ jobs, stats, heartbeat, sync, session, userName, loaded, theme, onToggleTheme, onOpen, onDelete, onStats, onUpload }) {
  const g = Object.values(stats).reduce((a, s) => ({ n: a.n + s.n, ver: a.ver + s.ver, rev: a.rev + s.rev }), { n: 0, ver: 0, rev: 0 })
  g.pend = Math.max(0, g.n - g.ver - g.rev)
  const pct = g.n ? Math.round((g.ver / g.n) * 100) : 0
  const hora = new Date().getHours()
  const saludo = hora < 6 ? 'Buenas noches' : hora < 13 ? 'Buenos días' : hora < 21 ? 'Buenas tardes' : 'Buenas noches'
  return (
    <div className="mx-auto max-w-5xl px-4 pb-16">
      <header className="safe-t pt-7 pb-5">
        <div className="flex items-center gap-2.5">
          <div className="grid place-items-center w-10 h-10 rounded-xl brand-grad text-white shadow-lg shadow-indigo-600/30"><Icon d={I.doc} /></div>
          <div className="min-w-0">
            <h1 className="text-xl font-bold tracking-tight text-slate-900 dark:text-slate-100 dark:text-slate-100">Revisión de facturas <span className="brand-text">AGM</span></h1>
            <p className="text-[13px] text-slate-500 dark:text-slate-400">{jobs.length} {jobs.length === 1 ? 'lote' : 'lotes'}</p>
          </div>
          <div className="ml-auto self-start flex items-center gap-2">
            <button onClick={() => location.replace(location.pathname + '?r=' + Date.now())} title="Actualizar la app (recarga sin caché)"
              className="grid place-items-center w-9 h-9 rounded-xl border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition"><Icon d={I.refresh} className="w-[18px] h-[18px]" /></button>
            <ThemeToggle theme={theme} onToggle={onToggleTheme} />
            <div className="flex flex-col items-end gap-1.5">
              <SyncBadge sync={sync} />
              {session && <button onClick={signOut} className="flex items-center gap-1.5 text-[12px] text-slate-500 dark:text-slate-400 hover:text-rose-600 transition" title="Cerrar sesión"><Icon d={I.user} className="w-3.5 h-3.5" /> {userName} <Icon d={I.logout} className="w-3.5 h-3.5" /></button>}
            </div>
          </div>
        </div>
        {userName && (
          <div className="mt-4 flex items-center gap-2">
            <span className="text-2xl">👋</span>
            <h2 className="text-lg font-semibold text-slate-800 dark:text-slate-100">{saludo}, <span className="brand-text capitalize">{userName}</span></h2>
          </div>
        )}
      </header>

      <div className="mb-3"><StatusBar heartbeat={heartbeat} /></div>

      {!loaded ? (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">{[0, 1, 2, 3].map(i => <Skel key={i} className="h-[104px]" />)}</div>
          <h2 className="mt-8 mb-3 text-sm font-semibold uppercase tracking-wide text-slate-400">Lotes</h2>
          <div className="grid sm:grid-cols-2 gap-3">{[0, 1].map(i => <Skel key={i} className="h-[150px]" />)}</div>
        </>
      ) : (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <Kpi n={g.n} label="Facturas" tone="slate" icon={I.doc} />
            <Kpi n={g.ver} label="Verificadas" tone="emerald" icon={I.check} />
            <Kpi n={g.rev} label="A revisar" tone="amber" icon={I.flag} />
            <Kpi n={g.pend} label="Pendientes" tone="indigo" icon={I.clock} />
          </div>

          {g.n > 0 && (
            <div className="mt-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-4 shadow-sm flex items-center gap-4">
              <Ring pct={pct} />
              <div className="flex-1 min-w-0">
                <div className="font-semibold text-slate-700 dark:text-slate-200">Progreso global</div>
                <div className="text-[13px] text-slate-500 dark:text-slate-400">{g.ver} de {g.n} verificadas · {g.pend} pendientes</div>
                <div className="mt-2 h-2 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden"><div className="h-full bg-gradient-to-r from-emerald-400 to-emerald-600 transition-all" style={{ width: pct + '%' }} /></div>
              </div>
            </div>
          )}

          <div className="mt-8 mb-3 flex items-center justify-between gap-2">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-400">Lotes</h2>
            <div className="flex items-center gap-2">
              <button onClick={onStats} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm font-semibold text-slate-700 dark:text-slate-200 hover:border-indigo-300 hover:text-indigo-600 transition"><Icon d={I.chart} className="w-4 h-4" /> <span className="hidden sm:inline">Estadísticas</span></button>
              <button onClick={onUpload} className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg brand-grad text-white text-sm font-semibold shadow shadow-indigo-600/30 hover:opacity-90 transition"><Icon d={I.upload} className="w-4 h-4" /> Subir facturas</button>
            </div>
          </div>
          {jobs.length === 0
            ? <div className="rounded-2xl border border-dashed border-slate-300 dark:border-slate-700 bg-white/60 dark:bg-slate-900/50 p-10 text-center text-slate-500 dark:text-slate-400">No hay lotes todavía. Pulsa <b>Subir facturas</b> para crear el primero.</div>
            : <div className="grid sm:grid-cols-2 gap-3">
                {jobs.map(j => <JobCard key={j.id} job={j} s={stats[j.id]} onOpen={() => onOpen(j)} onDelete={() => onDelete(j)} />)}
              </div>}
        </>
      )}
    </div>
  )
}

const Kpi = ({ n, label, tone, icon }) => {
  const t = {
    slate: ['text-slate-900 dark:text-slate-100', 'bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-300'],
    emerald: ['text-emerald-600 dark:text-emerald-400', 'bg-emerald-100 dark:bg-emerald-500/15 text-emerald-600 dark:text-emerald-400'],
    amber: ['text-amber-600 dark:text-amber-400', 'bg-amber-100 dark:bg-amber-500/15 text-amber-600 dark:text-amber-400'],
    indigo: ['text-indigo-600 dark:text-indigo-400', 'bg-indigo-100 dark:bg-indigo-500/15 text-indigo-600 dark:text-indigo-400'],
  }[tone] || ['text-slate-900 dark:text-slate-100', 'bg-slate-100 dark:bg-slate-800']
  return (
    <div className="rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-4 shadow-sm">
      {icon && <div className={'grid place-items-center w-9 h-9 rounded-xl mb-2 ' + t[1]}><Icon d={icon} className="w-[18px] h-[18px]" /></div>}
      <div className={'text-3xl font-extrabold tabular-nums ' + t[0]}>{n}</div>
      <div className="text-[13px] text-slate-500 dark:text-slate-400 mt-0.5">{label}</div>
    </div>
  )
}

function JobCard({ job, s, onOpen, onDelete }) {
  const est = ESTADO[job.estado] || ESTADO.en_cola
  const subidas = job.n_facturas ?? 0
  const n = s?.n ?? subidas                      // extraídas
  const ver = s?.ver ?? 0, rev = s?.rev ?? 0
  const pend = Math.max(0, n - ver - rev)
  const pct = n ? Math.round((ver / n) * 100) : 0
  const done = n > 0 && ver === n
  const faltan = job.estado === 'listo' && subidas > n ? subidas - n : 0
  return (
    <div className="group rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-sm hover:shadow-md hover:border-indigo-300 transition overflow-hidden">
      <button onClick={onOpen} className="w-full text-left p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-bold text-slate-900 dark:text-slate-100">{job.empresa || '—'}</span>
              <span className={'px-1.5 py-0.5 rounded text-[10px] font-bold ' + est.c}>{est.l.toUpperCase()}</span>
              {done && <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-emerald-100 text-emerald-700">COMPLETA</span>}
            </div>
            <div className="text-[12px] text-slate-400 mt-0.5">{n} facturas{faltan ? <span className="text-amber-600 font-semibold"> · ⚠ faltan {faltan}</span> : ''} · {relDay(job.creado)} · {relTime(job.terminado || job.creado)}</div>
          </div>
          <Icon d={I.chevR} className="w-5 h-5 text-slate-300 group-hover:text-indigo-500 transition shrink-0" />
        </div>
        {job.estado === 'listo'
          ? <>
              <div className="mt-3 h-2 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden"><div className="h-full bg-emerald-500 transition-all" style={{ width: pct + '%' }} /></div>
              <div className="mt-2.5 flex flex-wrap gap-x-4 gap-y-1 text-[12px]">
                <span className="text-emerald-600 font-semibold">{ver} verif.</span>
                <span className="text-amber-600 font-semibold">{rev} a revisar</span>
                <span className="text-slate-500 dark:text-slate-400 font-semibold">{pend} pend.</span>
                <span className="ml-auto text-slate-400">{pct}%</span>
              </div>
            </>
          : <div className="mt-3 text-[12px] text-slate-400">{job.estado === 'error' ? 'Error al procesar' : 'Esperando a la automática…'}</div>}
      </button>
      <div className="flex border-t border-slate-100 dark:border-slate-800">
        <button onClick={onOpen} className="flex-1 py-2.5 text-sm font-semibold text-indigo-600 dark:text-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-500/10 transition">Abrir</button>
        <div className="w-px bg-slate-100 dark:bg-slate-800" />
        <button onClick={onDelete} className="px-4 py-2.5 text-sm font-semibold text-rose-500 hover:bg-rose-50 transition flex items-center gap-1.5"><Icon d={I.trash} className="w-4 h-4" /> Eliminar</button>
      </div>
    </div>
  )
}

function UploadModal({ empresas, userName, onClose, onDone }) {
  const [emp, setEmp] = useState('')
  const [files, setFiles] = useState([])
  const [busy, setBusy] = useState(false)
  const [prog, setProg] = useState([0, 0])
  const [done, setDone] = useState(false)
  const [drag, setDrag] = useState(false)
  const addFiles = list => setFiles(prev => { const m = new Map(prev.map(f => [f.name + f.size, f])); for (const f of list) if (f.type.startsWith('image/') || f.type === 'application/pdf') m.set(f.name + f.size, f); return [...m.values()] })
  useEffect(() => { if (!emp && empresas.length) setEmp(empresas[0].id) }, [empresas])
  const previews = useMemo(() => files.map(f => ({ key: f.name + f.size, name: f.name, url: f.type.startsWith('image/') ? URL.createObjectURL(f) : null })), [files])
  useEffect(() => () => previews.forEach(p => p.url && URL.revokeObjectURL(p.url)), [previews])
  const onDrop = e => { e.preventDefault(); setDrag(false); if (e.dataTransfer?.files?.length) addFiles([...e.dataTransfer.files]) }
  const submit = async () => {
    if (!emp || !files.length) return
    setBusy(true)
    const job = await createJob({ empresa: emp, n_facturas: files.length, estado: 'en_cola' })
    if (!job) { setBusy(false); alert('No se pudo crear el lote.'); return }
    await uploadFiles(emp, job.id, files, (d, t) => setProg([d, t]))
    setBusy(false); setDone(true)
  }
  return (
    <div className="fixed inset-0 z-[60] bg-slate-950/60 flex items-center justify-center p-5" onClick={busy ? undefined : (done ? onDone : onClose)}>
      <div className="w-full max-w-md rounded-3xl bg-white dark:bg-slate-900 p-6 card-in" onClick={e => e.stopPropagation()}>
        {done ? (
          <div className="text-center py-3">
            <div className="text-5xl mb-2">🚀</div>
            <h2 className="text-lg font-bold text-slate-900 dark:text-slate-100 dark:text-slate-100">{cheer(userName)}</h2>
            <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">{files.length} factura(s) subida(s). La IA las procesará en breve y te avisaremos cuando estén listas. ¡A por la siguiente! 💪</p>
            <button onClick={onDone} className="mt-5 w-full py-3 rounded-xl brand-grad hover:opacity-90 text-white font-semibold transition">Hecho</button>
          </div>
        ) : (<>
          <div className="grid place-items-center w-12 h-12 rounded-2xl bg-indigo-100 dark:bg-indigo-500/20 text-indigo-600 dark:text-indigo-300 mb-3"><Icon d={I.upload} /></div>
          <h2 className="text-lg font-bold text-slate-900 dark:text-slate-100 dark:text-slate-100">Subir conjunto de facturas</h2>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">Se suben las imágenes/PDF y la IA las procesará en la próxima ejecución.</p>

          <label className="block text-[13px] font-medium text-slate-600 dark:text-slate-300 dark:text-slate-300 mt-4 mb-1">Empresa</label>
          <select value={emp} onChange={e => setEmp(e.target.value)} className="w-full rounded-xl border border-slate-300 dark:border-slate-700 px-3 py-2.5 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 dark:text-slate-100 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200 outline-none">
            {empresas.length === 0 && <option value="">(sin empresas)</option>}
            {empresas.map(e => <option key={e.id} value={e.id}>{e.nombre || e.id}</option>)}
          </select>

          <label className="block text-[13px] font-medium text-slate-600 dark:text-slate-300 mt-4 mb-1">Facturas</label>
          <div onDragOver={e => { e.preventDefault(); setDrag(true) }} onDragLeave={() => setDrag(false)} onDrop={onDrop}
            className={'rounded-xl border-2 border-dashed p-3 transition ' + (drag ? 'border-indigo-500 bg-indigo-50 dark:bg-indigo-500/10' : 'border-slate-300 dark:border-slate-700')}>
            <div className="grid grid-cols-2 gap-2">
              <label className="cursor-pointer flex items-center justify-center gap-1.5 py-2.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 transition">
                <Icon d={I.camera} className="w-4 h-4" /> Hacer fotos
                <input type="file" accept="image/*" capture="environment" multiple className="hidden" onChange={e => addFiles([...e.target.files])} />
              </label>
              <label className="cursor-pointer flex items-center justify-center gap-1.5 py-2.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 transition">
                <Icon d={I.files} className="w-4 h-4" /> Elegir
                <input type="file" accept="image/*,application/pdf" multiple className="hidden" onChange={e => addFiles([...e.target.files])} />
              </label>
            </div>
            <p className="hidden sm:block text-[12px] text-center text-slate-400 mt-2 pointer-events-none">o arrastra y suelta aquí las imágenes/PDF</p>
            {previews.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-1.5">
                {previews.slice(0, 12).map(p => (
                  <div key={p.key} className="w-12 h-12 rounded-lg overflow-hidden bg-slate-100 dark:bg-slate-800 grid place-items-center shrink-0" title={p.name}>
                    {p.url ? <img src={p.url} alt="" className="w-full h-full object-cover" /> : <Icon d={I.doc} className="w-5 h-5 text-slate-400" />}
                  </div>
                ))}
                {previews.length > 12 && <div className="w-12 h-12 rounded-lg bg-slate-100 dark:bg-slate-800 grid place-items-center text-[12px] font-semibold text-slate-500 dark:text-slate-400 shrink-0">+{previews.length - 12}</div>}
              </div>
            )}
          </div>
          {files.length > 0 && <p className="text-[12px] text-slate-500 dark:text-slate-400 mt-1.5">{files.length} fichero(s) · <button type="button" onClick={() => setFiles([])} className="underline hover:text-rose-600">vaciar</button></p>}

          {busy && <div className="mt-4"><div className="h-2 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden"><div className="h-full bg-indigo-500 transition-all" style={{ width: (prog[1] ? (prog[0] / prog[1]) * 100 : 0) + '%' }} /></div><p className="text-[12px] text-slate-500 dark:text-slate-400 mt-1">Subiendo {prog[0]}/{prog[1]}…</p></div>}

          <div className="flex gap-2 mt-5">
            <button onClick={onClose} disabled={busy} className="flex-1 py-3 rounded-xl bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 font-semibold text-slate-700 dark:text-slate-200 dark:text-slate-200 disabled:opacity-50">Cancelar</button>
            <button onClick={submit} disabled={busy || !emp || !files.length} className="flex-1 py-3 rounded-xl brand-grad hover:opacity-90 text-white font-semibold disabled:opacity-50">{busy ? 'Subiendo…' : 'Subir'}</button>
          </div>
        </>)}
      </div>
    </div>
  )
}

/* ===================== ESTADÍSTICAS (Fase C) ===================== */
function StatsView({ onBack }) {
  const [rows, setRows] = useState(null)
  const [allMarks, setAllMarks] = useState({})

  useEffect(() => {
    let alive = true
    Promise.all([loadAllFacturas(), loadAllRevisiones()]).then(([r, m]) => {
      if (!alive) return
      setRows(r || []); setAllMarks(m || {})
    }).catch(() => { if (alive) setRows([]) })
    return () => { alive = false }
  }, [])

  const ov = (row, k) => { const mk = allMarks[row.id]; return mk && mk[k] != null ? mk[k] : row[k] }
  const num = (row, k) => { const v = ov(row, k); return typeof v === 'number' ? v : (parseFloat(String(v).replace(',', '.')) || 0) }
  const statusOf = row => allMarks[row.id]?.status || null

  const st = useMemo(() => {
    const r = rows || []
    let ver = 0, rev = 0, base = 0, iva = 0, total = 0
    const prov = {}, mes = {}
    for (const row of r) {
      const s = statusOf(row); if (s === 'ver') ver++; else if (s === 'rev') rev++
      const b = num(row, 'base'), i = num(row, 'iva'), t = num(row, 'total')
      base += b; iva += i; total += t
      const p = (ov(row, 'proveedor') || '—').trim()
      prov[p] = prov[p] || { n: 0, total: 0 }; prov[p].n++; prov[p].total += t
      const iso = isoFromDMY(ov(row, 'fecha') || ''); const mm = iso ? iso.slice(0, 7) : '—'
      mes[mm] = mes[mm] || { n: 0, total: 0 }; mes[mm].n++; mes[mm].total += t
    }
    const topProv = Object.entries(prov).map(([k, v]) => ({ k, ...v })).sort((a, b) => b.total - a.total).slice(0, 8)
    const byMes = Object.entries(mes).map(([k, v]) => ({ k, ...v })).sort((a, b) => a.k < b.k ? -1 : 1)
    return { n: r.length, ver, rev, pend: r.length - ver - rev, base, iva, total, topProv, byMes }
  }, [rows, allMarks])

  const MES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic']
  const mesLabel = k => k === '—' ? '—' : `${MES[+k.slice(5, 7) - 1]} ${k.slice(0, 4)}`
  const maxMes = Math.max(1, ...st.byMes.map(m => m.total))
  const maxProv = Math.max(1, ...st.topProv.map(p => p.total))

  return (
    <div className="mx-auto max-w-5xl px-4 pb-16">
      <header className="safe-t pt-6 pb-5 flex items-center gap-3">
        <button onClick={onBack} className="grid place-items-center w-9 h-9 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-300 transition"><Icon d={I.back} /></button>
        <div>
          <h1 className="text-xl font-bold tracking-tight text-slate-900 dark:text-slate-100">Estadísticas</h1>
          <p className="text-[13px] text-slate-500 dark:text-slate-400">Sobre todos los lotes</p>
        </div>
      </header>

      {rows === null
        ? <div className="space-y-3"><div className="grid grid-cols-2 sm:grid-cols-4 gap-3">{[0, 1, 2, 3].map(i => <Skel key={i} className="h-[104px]" />)}</div><Skel className="h-40" /><Skel className="h-40" /></div>
        : rows.length === 0
        ? <p className="text-slate-400 py-10 text-center">Sin datos todavía.</p>
        : <>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <Kpi n={st.n} label="Facturas" tone="slate" icon={I.doc} />
            <Kpi n={st.ver} label="Verificadas" tone="emerald" icon={I.check} />
            <Kpi n={st.rev} label="A revisar" tone="amber" icon={I.flag} />
            <Kpi n={st.pend} label="Pendientes" tone="indigo" icon={I.clock} />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-3">
            <Money label="Base imponible" v={st.base} />
            <Money label="IVA / IPSI acumulado" v={st.iva} accent="indigo" />
            <Money label="Total facturado" v={st.total} accent="emerald" />
          </div>

          {/* por mes */}
          <h2 className="mt-8 mb-3 text-sm font-semibold uppercase tracking-wide text-slate-400">Por mes</h2>
          <div className="rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-4 shadow-sm space-y-2.5">
            {st.byMes.map(m => (
              <div key={m.k} className="flex items-center gap-3">
                <span className="w-16 shrink-0 text-[13px] text-slate-500 dark:text-slate-400">{mesLabel(m.k)}</span>
                <div className="flex-1 h-5 rounded-md bg-slate-100 dark:bg-slate-800 overflow-hidden"><div className="h-full bg-gradient-to-r from-indigo-400 to-indigo-600 rounded-md" style={{ width: Math.max(3, (m.total / maxMes) * 100) + '%' }} /></div>
                <span className="w-24 shrink-0 text-right text-[13px] font-semibold tabular-nums text-slate-700 dark:text-slate-200">{eur(m.total)}</span>
                <span className="w-8 shrink-0 text-right text-[12px] text-slate-400">{m.n}</span>
              </div>
            ))}
          </div>

          {/* top proveedores */}
          <h2 className="mt-8 mb-3 text-sm font-semibold uppercase tracking-wide text-slate-400">Top proveedores</h2>
          <div className="rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-4 shadow-sm space-y-2.5">
            {st.topProv.map(p => (
              <div key={p.k} className="flex items-center gap-3">
                <span className="w-40 shrink-0 text-[13px] text-slate-600 dark:text-slate-300 truncate" title={p.k}>{p.k}</span>
                <div className="flex-1 h-5 rounded-md bg-slate-100 dark:bg-slate-800 overflow-hidden"><div className="h-full bg-gradient-to-r from-emerald-400 to-emerald-600 rounded-md" style={{ width: Math.max(3, (p.total / maxProv) * 100) + '%' }} /></div>
                <span className="w-24 shrink-0 text-right text-[13px] font-semibold tabular-nums text-slate-700 dark:text-slate-200">{eur(p.total)}</span>
                <span className="w-8 shrink-0 text-right text-[12px] text-slate-400">{p.n}</span>
              </div>
            ))}
          </div>
        </>}
    </div>
  )
}
const Money = ({ label, v, accent }) => (
  <div className="rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-4 shadow-sm">
    <div className="text-[13px] text-slate-500 dark:text-slate-400">{label}</div>
    <div className={'text-2xl font-extrabold tabular-nums mt-0.5 ' + (accent === 'emerald' ? 'text-emerald-600' : accent === 'indigo' ? 'text-indigo-600' : 'text-slate-900 dark:text-slate-100')}>{eur(v)}</div>
  </div>
)

/* ===================== editor de campos (estable, no remonta) ===================== */
const INP = 'rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-2.5 py-1.5 text-sm text-slate-900 dark:text-slate-100 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200 dark:focus:ring-indigo-500/30 outline-none transition'
function Row({ label, children }) {
  return (
    <div className="flex items-center justify-between gap-3 py-1.5 border-b border-dashed border-slate-200/70 dark:border-slate-700/50">
      <span className="text-[13px] text-slate-500 dark:text-slate-400 whitespace-nowrap">{label}</span>{children}
    </div>
  )
}
function Fields({ it, marks, setField, aliases, onAlias, dup, compact }) {
  const cuadra = cuadraOf(it, marks)
  const s = marks[it.id] || {}
  // importes: formatea (2 decimales) cuando viene de la IA sin tocar; deja el texto en crudo mientras se edita
  const nv = k => { const v = F(it, marks, k); return v == null || v === '' ? '' : (typeof v === 'number' ? v.toFixed(2) : v) }
  const provVal = F(it, marks, 'proveedor') || ''
  const sug = aliases ? aliases[normProv(it.proveedor)] : null
  const showSug = sug && sug !== provVal && provVal === (it.proveedor || '')   // original sin tocar y hay corrección aprendida
  const saveProvAlias = () => { const v = F(it, marks, 'proveedor'); if (onAlias && v && v !== it.proveedor) onAlias(it.proveedor, v) }
  const cuadrar = () => {
    const base = Nv(it, marks, 'base'), iva = Nv(it, marks, 'iva')
    const m = String(it.timp || '').match(/(\d+(?:[.,]\d+)?)\s*%/)
    if (m && base > 0) {           // hay % → recalcula IVA desde la base y total = base+IVA
      const pct = parseFloat(m[1].replace(',', '.'))
      const niva = Math.round(base * pct) / 100
      setField(it.id, 'iva', niva.toFixed(2), true)
      setField(it.id, 'total', (base + niva).toFixed(2), true)
    } else {                       // sin % → total = base + IVA
      setField(it.id, 'total', (base + iva).toFixed(2), true)
    }
  }
  return (
    <div className={compact ? '' : 'space-y-0.5'}>
      <div className="flex flex-wrap items-center gap-1.5 mb-2.5">
        <span className={'px-2 py-0.5 rounded-md text-[11px] font-semibold ' + (it.conf === 'alta' ? 'bg-emerald-100 text-emerald-700' : it.conf === 'media' ? 'bg-amber-100 text-amber-700' : 'bg-rose-100 text-rose-700')}>confianza {it.conf}</span>
        {cuadra
          ? <span className="px-2 py-0.5 rounded-md text-[11px] font-semibold bg-emerald-100 text-emerald-700">✓ cuadra</span>
          : <button type="button" onClick={cuadrar} title="Ajustar IVA/total para que cuadre" className="px-2 py-0.5 rounded-md text-[11px] font-semibold bg-rose-100 text-rose-700 hover:bg-rose-200 flex items-center gap-1 transition"><Icon d={I.wand} className="w-3 h-3" /> no cuadra · ajustar</button>}
        {dup && <span className="px-2 py-0.5 rounded-md text-[11px] font-semibold bg-rose-100 text-rose-700 flex items-center gap-1" title="Otra factura tiene el mismo proveedor+nº o total+fecha"><Icon d={I.copies} className="w-3 h-3" /> posible duplicado</span>}
        {it.flag && <span className="px-2 py-0.5 rounded-md text-[11px] font-semibold bg-orange-100 text-orange-700">⚑ marcada</span>}
        {s.status === 'ver' && <span className="px-2 py-0.5 rounded-md text-[11px] font-bold bg-emerald-600 text-white">✓ VERIFICADA</span>}
        {s.status === 'rev' && <span className="px-2 py-0.5 rounded-md text-[11px] font-bold bg-amber-500 text-white">⚑ A REVISAR</span>}
      </div>
      <Row label="Fecha"><input type="date" className={INP + ' w-[150px]'} value={isoFromDMY(F(it, marks, 'fecha'))} onChange={e => setField(it.id, 'fecha', e.target.value, false)} /></Row>
      <Row label="Proveedor"><input className={INP + ' flex-1 min-w-0'} value={provVal} onChange={e => setField(it.id, 'proveedor', e.target.value, false)} onBlur={saveProvAlias} /></Row>
      {showSug && (
        <div className="flex items-center gap-2 -mt-0.5 mb-1 pl-1">
          <span className="text-[12px] text-indigo-600 dark:text-indigo-400 flex items-center gap-1 min-w-0"><Icon d={I.spark} className="w-3.5 h-3.5 shrink-0" /> <span className="truncate">Sugerencia: «{sug}»</span></span>
          <button type="button" onClick={() => setField(it.id, 'proveedor', sug, false)} className="shrink-0 px-2 py-0.5 rounded-md text-[12px] font-semibold bg-indigo-600 text-white hover:bg-indigo-700 transition">Aplicar</button>
        </div>
      )}
      <Row label="Nº factura"><input className={INP + ' flex-1 min-w-0'} value={F(it, marks, 'num') || ''} onChange={e => setField(it.id, 'num', e.target.value, false)} /></Row>
      <Row label="Base"><input inputMode="decimal" className={INP + ' w-28 text-right tabular-nums'} value={nv('base')} onChange={e => setField(it.id, 'base', e.target.value, true)} /></Row>
      <Row label={'IVA/IPSI · ' + (it.timp || '')}><input inputMode="decimal" className={INP + ' w-28 text-right tabular-nums'} value={nv('iva')} onChange={e => setField(it.id, 'iva', e.target.value, true)} /></Row>
      <Row label="Total"><input inputMode="decimal" className={INP + ' w-28 text-right tabular-nums font-semibold'} value={nv('total')} onChange={e => setField(it.id, 'total', e.target.value, true)} /></Row>
      <div className="pt-2">
        <span className="text-[13px] text-slate-500 dark:text-slate-400">Observaciones</span>
        <textarea className={INP + ' w-full mt-1 min-h-[44px] resize-y'} value={F(it, marks, 'obs') || ''} onChange={e => setField(it.id, 'obs', e.target.value, false)} />
      </div>
    </div>
  )
}

/* ===================== LISTA (una tanda) ===================== */
function ListView({ sel, items, marks, setField, mark, reset, rotate, sync, userName, itemsLoading, aliases, onAlias, dupSet, exportXlsx, copyTable, onBack, onDelete }) {
  const [filter, setFilter] = useState('todas')
  const [q, setQ] = useState('')
  const [modalId, setModalId] = useState(null)
  const [review, setReview] = useState(false)
  const [showDone, setShowDone] = useState(false)

  const ver = items.filter(it => marks[it.id]?.status === 'ver').length
  const rev = items.filter(it => marks[it.id]?.status === 'rev').length
  useEffect(() => { if (items.length && ver === items.length) setShowDone(true) }, [ver, items.length])
  /* precarga TODAS las fotos del lote en caché al entrar (sin esperas en revisión) */
  useEffect(() => { const pre = items.map(it => { const im = new Image(); im.src = it.img; return im }); return () => pre.forEach(im => { im.src = '' }) }, [items])

  const totalLote = items.reduce((a, it) => a + Nv(it, marks, 'total'), 0)
  const subidas = sel?.n_facturas ?? items.length
  const faltan = Math.max(0, subidas - items.length)
  const autoOk = items.filter(it => cuadraOf(it, marks) && it.conf === 'alta' && marks[it.id]?.status !== 'ver')
  const quickVerify = () => { if (autoOk.length && window.confirm(`Verificar ${autoOk.length} factura(s) que cuadran y son de confianza alta?`)) autoOk.forEach(it => mark(it.id, 'ver')) }
  const needsAttn = it => !cuadraOf(it, marks) || it.conf === 'baja' || it.flag || !F(it, marks, 'num') || Nv(it, marks, 'total') <= 0 || (dupSet && dupSet.has(it.id))
  const atnCount = items.filter(needsAttn).length

  const ordered = [...items].sort((a, b) => rank(a, marks) - rank(b, marks))
  const ql = q.trim().toLowerCase()
  const visible = ordered.filter(it => {
    const s = marks[it.id]?.status
    if (filter === 'pend' && s === 'ver') return false
    if (filter === 'ver' && s !== 'ver') return false
    if (filter === 'flag' && !(it.flag || s === 'rev')) return false
    if (filter === 'aten' && !needsAttn(it)) return false
    if (ql) { const hay = [F(it, marks, 'proveedor'), F(it, marks, 'num'), F(it, marks, 'obs')].join(' ').toLowerCase(); if (!hay.includes(ql)) return false }
    return true
  })

  const FilterBtn = ({ id, label, n }) => (
    <button onClick={() => setFilter(id)} className={'px-3 py-1.5 rounded-full text-[13px] font-medium whitespace-nowrap transition ' + (filter === id ? 'bg-indigo-600 text-white shadow' : 'bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-700 hover:border-indigo-300')}>{label}{n != null && <span className="ml-1 opacity-70">{n}</span>}</button>
  )

  return (
    <div>
      {/* cabecera sticky */}
      <div className="sticky top-0 z-20 bg-white/90 dark:bg-slate-900/90 backdrop-blur border-b border-slate-200 dark:border-slate-800">
        <div className="mx-auto max-w-5xl px-4 safe-t">
          <div className="flex items-center gap-3 py-3">
            <button onClick={onBack} className="grid place-items-center w-9 h-9 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-300 transition"><Icon d={I.back} /></button>
            <div className="min-w-0">
              <h1 className="font-bold text-slate-900 dark:text-slate-100 leading-tight truncate">{sel?.empresa || 'Lote'} · {relDay(sel?.creado)}</h1>
              <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                <p className="text-[12px] text-slate-500 dark:text-slate-400">{ver} verif · {rev} a revisar · {items.length - ver - rev} pend · Total <b className="text-slate-700 dark:text-slate-200">{eur(totalLote)}</b></p>
                <SyncBadge sync={sync} />
                {faltan > 0 && <span className="text-[12px] font-semibold text-amber-600" title="La IA extrajo menos facturas de las que subiste">⚠ subidas {subidas} · extraídas {items.length}</span>}
              </div>
            </div>
            <div className="ml-auto flex items-center gap-2">
              <button onClick={() => setReview(true)} className="hidden sm:flex items-center gap-1.5 px-3.5 py-2 rounded-xl brand-grad text-white text-sm font-semibold shadow-lg shadow-indigo-600/30 hover:opacity-90 transition"><Icon d={I.play} className="w-4 h-4" /> Revisar</button>
              <button onClick={copyTable} className="grid place-items-center w-9 h-9 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 transition" title="Copiar tabla"><Icon d={I.copy} className="w-[18px] h-[18px]" /></button>
              <button onClick={() => exportXlsx(false)} className="grid place-items-center w-9 h-9 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 transition" title="Exportar Excel (todas)"><Icon d={I.download} className="w-[18px] h-[18px]" /></button>
              {ver > 0 && <button onClick={() => exportXlsx(true)} className="grid place-items-center w-9 h-9 rounded-lg border border-emerald-200 dark:border-emerald-500/30 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-500/10 transition" title="Exportar solo verificadas"><Icon d={I.check} className="w-[18px] h-[18px]" /></button>}
              <button onClick={onDelete} className="grid place-items-center w-9 h-9 rounded-lg border border-rose-200 text-rose-500 hover:bg-rose-50 transition" title="Eliminar tanda"><Icon d={I.trash} className="w-[18px] h-[18px]" /></button>
            </div>
          </div>
          <div className="flex items-center gap-2 pb-3 overflow-x-auto thin-sb">
            <FilterBtn id="todas" label="Todas" n={items.length} />
            <FilterBtn id="pend" label="Pendientes" n={items.length - ver} />
            <FilterBtn id="ver" label="Verificadas" n={ver} />
            <FilterBtn id="flag" label="A revisar" n={rev} />
            {atnCount > 0 && <button onClick={() => setFilter('aten')} title="Facturas que requieren atención" className={'flex items-center gap-1 px-3 py-1.5 rounded-full text-[13px] font-semibold whitespace-nowrap transition ' + (filter === 'aten' ? 'bg-amber-500 text-white shadow' : 'bg-amber-50 dark:bg-amber-500/15 text-amber-700 dark:text-amber-400 border border-amber-200 dark:border-amber-500/30')}><Icon d={I.alert} className="w-3.5 h-3.5" /> Atención {atnCount}</button>}
            {autoOk.length > 0 && <button onClick={quickVerify} title="Verifica las que cuadran y son de confianza alta" className="flex items-center gap-1 px-3 py-1.5 rounded-full text-[13px] font-semibold whitespace-nowrap bg-emerald-600 text-white hover:bg-emerald-700 transition"><Icon d={I.check} className="w-3.5 h-3.5" /> {autoOk.length} OK</button>}
            <div className="relative ml-auto flex-1 min-w-[140px] max-w-[260px]">
              <Icon d={I.search} className="w-4 h-4 absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
              <input value={q} onChange={e => setQ(e.target.value)} placeholder="Buscar…" className="w-full pl-8 pr-2 py-1.5 rounded-full border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 text-[13px] focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200 outline-none" />
            </div>
          </div>
        </div>
      </div>

      {/* tarjetas */}
      <div className="mx-auto max-w-5xl px-4 py-5 space-y-4">
        {itemsLoading && items.length === 0 && [0, 1, 2].map(i => <Skel key={i} className="h-56 sm:h-64" />)}
        {!itemsLoading && items.length === 0 && <p className="text-slate-400 py-10 text-center">{sel?.estado === 'listo' ? 'Este lote no tiene facturas.' : 'El lote aún se está procesando…'}</p>}
        {items.length > 0 && visible.length === 0 && <p className="text-slate-400 py-10 text-center">Sin resultados para este filtro.</p>}
        {visible.map(it => <InvoiceCard key={it.id} it={it} marks={marks} setField={setField} aliases={aliases} onAlias={onAlias} dup={dupSet && dupSet.has(it.id)} mark={mark} reset={reset} rotate={rotate} onZoom={() => setModalId(it.id)} />)}
      </div>

      {/* botón flotante de revisión en móvil */}
      <button onClick={() => setReview(true)} className="sm:hidden fixed right-4 bottom-4 z-30 flex items-center gap-2 px-5 py-3.5 rounded-full brand-grad text-white font-semibold shadow-xl shadow-indigo-600/40 active:scale-95 transition"><Icon d={I.play} className="w-5 h-5" /> Revisar</button>

      {modalId && <Modal it={items.find(x => x.id === modalId)} marks={marks} setField={setField} aliases={aliases} onAlias={onAlias} dup={dupSet && dupSet.has(modalId)} onClose={() => setModalId(null)} onRotate={rotate} mark={mark} />}
      {review && <ReviewMode items={ordered} marks={marks} setField={setField} aliases={aliases} onAlias={onAlias} dupSet={dupSet} setReview={setReview} mark={mark} rotate={rotate} exportXlsx={exportXlsx} userName={userName} />}
      {showDone && <DoneOverlay ver={ver} total={items.length} userName={userName} onExport={exportXlsx} onClose={() => setShowDone(false)} onBack={onBack} />}
    </div>
  )
}

function InvoiceCard({ it, marks, setField, aliases, onAlias, dup, mark, reset, rotate, onZoom }) {
  const s = marks[it.id] || {}
  const done = s.status === 'ver'
  return (
    <div className={'rounded-2xl bg-white dark:bg-slate-900 border shadow-sm overflow-hidden grid sm:grid-cols-[300px_1fr] transition ' + (done ? 'opacity-60 border-slate-200 dark:border-slate-800' : it.flag || s.status === 'rev' ? 'border-amber-300 dark:border-amber-500/50' : 'border-slate-200 dark:border-slate-800')}>
      <div className="relative bg-slate-900 h-56 sm:h-auto sm:min-h-[260px] flex items-center justify-center overflow-hidden cursor-zoom-in" onClick={onZoom}>
        <img src={it.img} alt="" className="max-w-full max-h-full object-contain" style={{ transform: `rotate(${rotOf(it, marks)}deg)`, maxWidth: rotOf(it, marks) % 180 ? '70%' : '100%' }} />
        <div className="absolute top-2 right-2 flex gap-1.5">
          <button onClick={e => { e.stopPropagation(); rotate(it.id) }} className="grid place-items-center w-8 h-8 rounded-lg bg-white/90 text-slate-700 dark:text-slate-200 hover:bg-white shadow"><Icon d={I.rotate} className="w-4 h-4" /></button>
          <button onClick={e => { e.stopPropagation(); onZoom() }} className="grid place-items-center w-8 h-8 rounded-lg bg-white/90 text-slate-700 dark:text-slate-200 hover:bg-white shadow"><Icon d={I.zoomIn} className="w-4 h-4" /></button>
        </div>
      </div>
      <div className="p-4">
        <div className="text-base font-bold text-slate-900 dark:text-slate-100 mb-0.5">{F(it, marks, 'proveedor') || '—'}</div>
        <Fields it={it} marks={marks} setField={setField} aliases={aliases} onAlias={onAlias} dup={dup} />
        <div className="flex flex-wrap gap-2 mt-3">
          <button onClick={() => mark(it.id, 'ver')} className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-emerald-600 text-white text-sm font-semibold hover:bg-emerald-700 transition"><Icon d={I.check} className="w-4 h-4" /> Verificado</button>
          <button onClick={() => mark(it.id, 'rev')} className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-amber-500 text-white text-sm font-semibold hover:bg-amber-600 transition"><Icon d={I.flag} className="w-4 h-4" /> A revisar</button>
          <button onClick={() => reset(it.id)} className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 text-sm font-semibold hover:bg-slate-200 dark:hover:bg-slate-700 transition"><Icon d={I.reset} className="w-4 h-4" /> Reset</button>
        </div>
      </div>
    </div>
  )
}

/* ===================== MODAL zoom ===================== */
function Modal({ it, marks, setField, aliases, onAlias, dup, onClose, onRotate, mark }) {
  const [z, setZ] = useState(1)
  return (
    <div className="fixed inset-0 z-50 bg-slate-950/95 flex flex-col md:grid md:grid-cols-[1fr_380px]">
      <button onClick={onClose} className="absolute top-3 left-3 z-10 grid place-items-center w-10 h-10 rounded-xl bg-white/90 text-slate-700 dark:text-slate-200 hover:bg-white shadow"><Icon d={I.x} /></button>
      <div className="flex-1 min-h-0 overflow-auto grid place-items-center p-4 thin-sb">
        <img src={it.img} alt="" className="transition-transform" style={{ transform: `rotate(${rotOf(it, marks)}deg) scale(${z})` }} />
      </div>
      <div className="bg-white/95 dark:bg-slate-900/95 backdrop-blur p-5 overflow-auto thin-sb max-h-[45vh] md:max-h-none safe-b">
        <div className="flex gap-2 mb-3">
          <button onClick={() => setZ(z * 1.25)} className="grid place-items-center w-10 h-10 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800"><Icon d={I.zoomIn} /></button>
          <button onClick={() => setZ(z * 0.8)} className="grid place-items-center w-10 h-10 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800"><Icon d={I.zoomOut} /></button>
          <button onClick={() => onRotate(it.id)} className="grid place-items-center w-10 h-10 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800"><Icon d={I.rotate} /></button>
        </div>
        <Fields it={it} marks={marks} setField={setField} aliases={aliases} onAlias={onAlias} dup={dup} />
        <div className="flex gap-2 mt-4">
          <button onClick={() => mark(it.id, 'ver')} className="flex-1 flex items-center justify-center gap-1.5 py-3 rounded-xl bg-emerald-600 text-white font-semibold"><Icon d={I.check} className="w-4 h-4" /> Verificado</button>
          <button onClick={() => mark(it.id, 'rev')} className="flex-1 flex items-center justify-center gap-1.5 py-3 rounded-xl bg-amber-500 text-white font-semibold"><Icon d={I.flag} className="w-4 h-4" /> A revisar</button>
        </div>
      </div>
    </div>
  )
}

/* ===================== MODO REVISIÓN (Tinder) ===================== */
function ReviewMode({ items, marks, setField, aliases, onAlias, dupSet, setReview, mark, rotate, exportXlsx, userName }) {
  const [idx, setIdx] = useState(0)
  const [done, setDone] = useState(false)
  const [sheet, setSheet] = useState(false)   // bottom sheet de datos (móvil)
  const imgRef = useRef(null), vpRef = useRef(null), toastRef = useRef(null), iconRef = useRef(null), tintRef = useRef(null), stampRef = useRef(null)
  const tf = useRef({ tx: 0, ty: 0, sc: 1, rot: 0, fit: 1 })
  const it = items[idx]
  const t0 = useRef(Date.now()), [clock, setClock] = useState('00:00'), countRef = useRef(0)
  const [swipeMode, setSwipeMode] = useState(() => { try { return localStorage.getItem('agm_swipe') !== '0' } catch (e) { return true } })
  const swipeRef = useRef(swipeMode)
  useEffect(() => { swipeRef.current = swipeMode; try { localStorage.setItem('agm_swipe', swipeMode ? '1' : '0') } catch (e) {} }, [swipeMode])

  useEffect(() => { const i = setInterval(() => setClock(fmtT(Date.now() - t0.current)), 500); return () => clearInterval(i) }, [])
  const apply = () => { const t = tf.current; if (imgRef.current) imgRef.current.style.transform = `translate(-50%,-50%) translate(${t.tx}px,${t.ty}px) rotate(${t.rot}deg) scale(${t.sc})` }
  const fit = () => { const im = imgRef.current, vp = vpRef.current; if (!im || !im.naturalWidth) return; const s = (Math.min(vp.clientWidth / im.naturalWidth, vp.clientHeight / im.naturalHeight) || 1) * .95; tf.current = { ...tf.current, tx: 0, ty: 0, sc: s, fit: s }; apply() }
  const setStamp = () => { const st = marks[it?.id]?.status; if (stampRef.current) { stampRef.current.style.display = st ? 'block' : 'none'; stampRef.current.className = 'absolute top-5 left-1/2 -translate-x-1/2 -rotate-6 px-5 py-2 rounded-xl border-4 font-black text-2xl z-20 ' + (st === 'ver' ? 'text-emerald-600 border-emerald-500 bg-emerald-50/90' : 'text-amber-600 border-amber-500 bg-amber-50/90'); stampRef.current.textContent = st === 'ver' ? '✓ VERIFICADA' : st === 'rev' ? '⚑ PENDIENTE' : '' } }
  useEffect(() => {
    if (!it) return
    tf.current.rot = ((marks[it.id]?.rot ?? it.rot0) % 360 + 360) % 360
    tf.current.tx = 0; tf.current.ty = 0   // resetea posición (no arrastra el zoom del anterior)
    const im = imgRef.current
    if (im) {
      im.style.transition = 'none'; im.style.opacity = '0'
      const show = () => { fit(); requestAnimationFrame(() => { im.style.transition = 'opacity .16s ease'; im.style.opacity = '1' }) }
      im.onload = show; im.src = it.img
      if (im.complete && im.naturalWidth) show()
    }
    setStamp()
  }, [idx, it])
  useEffect(() => { setStamp() })

  const zoom = f => { tf.current.sc = Math.min(10, Math.max(.1, tf.current.sc * f)); apply() }
  const rot90 = () => { rotate(it.id); tf.current.rot = (tf.current.rot + 90) % 360; apply() }
  const next = () => { if (idx < items.length - 1) setIdx(idx + 1); else setDone(true) }
  const prev = () => { if (idx > 0) setIdx(idx - 1) }
  const doMark = (st, silent) => {
    mark(it.id, st); countRef.current++; setStamp()
    if (silent) { next(); return }
    const el = toastRef.current; el.textContent = st === 'ver' ? '✓' : '⚑'; el.style.color = st === 'ver' ? '#22c55e' : '#f59e0b'
    el.style.opacity = 1; el.style.transform = 'translate(-50%,-50%) scale(1)'
    setTimeout(() => { el.style.opacity = 0 }, 180)
    setTimeout(next, 160)
  }

  /* gestos: pinch (2 dedos) = zoom · 1 dedo = swipe (modo Tinder) o paneo */
  useEffect(() => {
    const vp = vpRef.current; if (!vp) return
    const pts = new Map()
    let mode = null, sx = 0, sy = 0, bx = 0, by = 0, sdx = 0
    let sd = 0, ssc = 1, smx = 0, smy = 0, btx = 0, bty = 0   // estado del pinch
    const arr = () => [...pts.values()]
    const dist = () => { const p = arr(); return Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y) }
    const mid = () => { const p = arr(); return [(p[0].x + p[1].x) / 2, (p[0].y + p[1].y) / 2] }
    const swipe = dx => {
      const im = imgRef.current; im.style.transition = 'none'; const t = tf.current
      im.style.transform = `translate(-50%,-50%) translate(${t.tx + dx}px,${t.ty}px) rotate(${t.rot + dx * 0.04}deg) scale(${t.sc})`
      const k = Math.max(-1, Math.min(1, dx / 160))
      const ic = iconRef.current; ic.textContent = dx > 0 ? '✓' : '⚑'; ic.style.color = dx > 0 ? '#22c55e' : '#f59e0b'; ic.style.opacity = Math.abs(k); ic.style.left = dx < 0 ? '24px' : 'auto'; ic.style.right = dx > 0 ? '24px' : 'auto'
      const tn = tintRef.current; tn.style.opacity = Math.abs(k) * 0.55; tn.style.background = dx > 0 ? 'radial-gradient(circle at 80% 50%, rgba(34,197,94,.9), transparent 70%)' : 'radial-gradient(circle at 20% 50%, rgba(245,158,11,.9), transparent 70%)'
    }
    const clear = () => { const im = imgRef.current; im.style.transition = 'transform .2s'; apply(); iconRef.current.style.opacity = 0; tintRef.current.style.opacity = 0; setTimeout(() => { im.style.transition = 'none' }, 210) }
    const fly = dir => { const im = imgRef.current; im.style.transition = 'transform .26s ease-out'; const t = tf.current; im.style.transform = `translate(-50%,-50%) translate(${dir * window.innerWidth}px,${t.ty}px) rotate(${dir * 20}deg) scale(${t.sc})`; iconRef.current.style.opacity = 0; tintRef.current.style.opacity = 0; setTimeout(() => { im.style.transition = 'none'; doMark(dir > 0 ? 'ver' : 'rev', true) }, 240) }
    const down = e => {
      if (e.target.closest('.vpctrl')) return
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY })
      try { vp.setPointerCapture(e.pointerId) } catch (_) {}
      e.preventDefault()
      if (pts.size === 2) { mode = 'pinch'; sd = dist(); ssc = tf.current.sc;[smx, smy] = mid(); btx = tf.current.tx; bty = tf.current.ty; iconRef.current.style.opacity = 0; tintRef.current.style.opacity = 0 }
      else if (pts.size === 1) { sx = e.clientX; sy = e.clientY; bx = tf.current.tx; by = tf.current.ty; sdx = 0; mode = (swipeRef.current && tf.current.sc <= tf.current.fit * 1.18) ? 'swipe' : 'pan' }
    }
    const move = e => {
      if (!pts.has(e.pointerId)) return
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY })
      if (mode === 'pinch' && pts.size >= 2) {
        const d = dist(), [mx, my] = mid()
        tf.current.sc = Math.min(10, Math.max(0.1, ssc * (d / (sd || 1))))
        tf.current.tx = btx + (mx - smx); tf.current.ty = bty + (my - smy); apply(); return
      }
      if (mode == null) return
      const dx = e.clientX - sx
      if (mode === 'pan') { tf.current.tx = bx + dx; tf.current.ty = by + (e.clientY - sy); apply() }
      else if (mode === 'swipe') { sdx = dx; swipe(dx) }
    }
    const up = e => {
      pts.delete(e.pointerId)
      if (mode === 'pinch') {
        if (pts.size < 2) {
          if (tf.current.sc <= tf.current.fit * 1.02) fit()
          if (pts.size === 1) { const p = arr()[0]; sx = p.x; sy = p.y; bx = tf.current.tx; by = tf.current.ty; mode = 'pan' } else mode = null
        }
        return
      }
      if (mode === 'swipe') { const TH = Math.min(150, vp.clientWidth * 0.26); if (sdx > TH) fly(1); else if (sdx < -TH) fly(-1); else clear() }
      if (pts.size === 0) mode = null
    }
    const wheel = e => { e.preventDefault(); zoom(e.deltaY < 0 ? 1.12 : 0.89) }
    vp.addEventListener('pointerdown', down); vp.addEventListener('pointermove', move); vp.addEventListener('pointerup', up); vp.addEventListener('pointercancel', up); vp.addEventListener('wheel', wheel, { passive: false })
    return () => { vp.removeEventListener('pointerdown', down); vp.removeEventListener('pointermove', move); vp.removeEventListener('pointerup', up); vp.removeEventListener('pointercancel', up); vp.removeEventListener('wheel', wheel) }
  }, [idx])

  useEffect(() => {
    const h = e => { if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return; if (e.key === 'ArrowRight') next(); else if (e.key === 'ArrowLeft') prev(); else if (e.key === 'v' || e.key === 'V') doMark('ver'); else if (e.key === 'p' || e.key === 'P') doMark('rev'); else if (e.key === 'Escape') setReview(false); else if (e.key === '+' || e.key === '=') zoom(1.2); else if (e.key === '-') zoom(.8) }
    window.addEventListener('keydown', h); return () => window.removeEventListener('keydown', h)
  }, [idx])

  if (done) {
    let ver = 0, rev = 0, pen = 0; items.forEach(x => { const s = marks[x.id]?.status; if (s === 'ver') ver++; else if (s === 'rev') rev++; else pen++ })
    const ms = Date.now() - t0.current
    return (
      <div className="fixed inset-0 z-50 bg-slate-950 text-slate-100 flex items-center justify-center p-5">
        <div className="w-full max-w-sm rounded-3xl bg-slate-900 border border-slate-800 p-7 text-center card-in">
          <div className="text-6xl mb-2">🎉</div>
          <h2 className="text-xl font-bold">{cheer(userName)}</h2>
          <p className="text-slate-400 mt-1 text-sm">Revisión completada{userName ? ` — sigue así 💪` : ''}</p>
          <div className="mt-5 space-y-2 text-left text-sm">
            <div className="flex justify-between"><span className="text-slate-400">Verificadas</span><b className="text-emerald-400">{ver}</b></div>
            <div className="flex justify-between"><span className="text-slate-400">A revisar</span><b className="text-amber-400">{rev}</b></div>
            <div className="flex justify-between"><span className="text-slate-400">Sin marcar</span><b>{pen}</b></div>
            <div className="flex justify-between"><span className="text-slate-400">⏱ Tiempo</span><b>{fmtT(ms)} · {Math.round(ms / 1000 / Math.max(1, items.length))}s/factura</b></div>
          </div>
          <button onClick={exportXlsx} className="mt-6 w-full py-3.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 font-bold flex items-center justify-center gap-2"><Icon d={I.download} className="w-5 h-5" /> Exportar Excel</button>
          <div className="flex gap-2 mt-2">
            <button onClick={() => { setIdx(0); setDone(false) }} className="flex-1 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 font-semibold">↺ Repetir</button>
            <button onClick={() => setReview(false)} className="flex-1 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 font-semibold">Salir</button>
          </div>
        </div>
      </div>
    )
  }

  const progress = ((idx + 1) / items.length) * 100
  return (
    <div className="fixed inset-0 z-50 bg-slate-950 text-slate-100 flex flex-col md:grid md:grid-rows-[auto_1fr] overflow-hidden">
      {/* barra superior + progreso */}
      <div className="relative z-30 safe-t">
        <div className="flex items-center gap-3 px-4 py-3">
          <span className="font-bold tabular-nums">{idx + 1}<span className="text-slate-500 dark:text-slate-400">/{items.length}</span></span>
          <span className="text-sm text-slate-400 tabular-nums">⏱ {clock}{countRef.current ? ` · ${countRef.current}` : ''}</span>
          <button onClick={() => setSwipeMode(s => !s)} title={swipeMode ? 'Modo deslizar (toca para usar botones)' : 'Modo botones (toca para deslizar)'}
            className={'ml-auto flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[12px] font-semibold transition ' + (swipeMode ? 'bg-indigo-500/20 text-indigo-300' : 'bg-slate-800 text-slate-300')}>
            <Icon d={swipeMode ? I.play : I.check} className="w-3.5 h-3.5" /> {swipeMode ? 'Deslizar' : 'Botones'}
          </button>
          <div className="flex items-center gap-1.5">
            <button onClick={prev} className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-sm">◀</button>
            <button onClick={next} className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-sm">▶</button>
            <button onClick={() => setReview(false)} className="grid place-items-center w-9 h-9 rounded-lg bg-slate-800 hover:bg-slate-700"><Icon d={I.x} className="w-4 h-4" /></button>
          </div>
        </div>
        <div className="h-1 bg-slate-800"><div className="h-full bg-indigo-500 transition-all" style={{ width: progress + '%' }} /></div>
      </div>

      <div className="flex-1 min-h-0 grid grid-rows-1 md:grid-cols-[1fr_380px]">
        {/* viewport imagen */}
        <div ref={vpRef} className="vp relative overflow-hidden bg-slate-950 cursor-grab active:cursor-grabbing">
          <div ref={tintRef} className="swipe-tint" />
          <img ref={imgRef} draggable="false" alt="" className="vp-img" />
          <div ref={stampRef} style={{ display: 'none' }} />
          <div ref={iconRef} className="swipe-icon" />
          {/* controles zoom/girar */}
          <div className="vpctrl absolute right-3 top-1/2 -translate-y-1/2 flex flex-col gap-2.5 z-30" onPointerDown={e => e.stopPropagation()}>
            <CtrlBtn d={I.zoomIn} onClick={() => zoom(1.3)} />
            <CtrlBtn d={I.zoomOut} onClick={() => zoom(0.77)} />
            <CtrlBtn d={I.rotate} onClick={rot90} />
            <CtrlBtn d={I.fit} onClick={fit} />
          </div>
          <div className="absolute left-3 bottom-3 text-[11px] text-slate-400 bg-slate-900/70 rounded-md px-2 py-1 pointer-events-none">{swipeMode ? 'Desliza ▶ verificar · ◀ a revisar · 2 dedos = zoom' : 'Valida con los botones · 2 dedos = zoom'}</div>
          <div ref={toastRef} className="absolute left-1/2 top-1/2 text-[72px] leading-none pointer-events-none z-30 drop-shadow-lg" style={{ opacity: 0, transform: 'translate(-50%,-50%)', transition: 'opacity .15s' }} />
        </div>

        {/* panel datos: lateral en desktop */}
        <div className="hidden md:flex flex-col bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 border-l border-slate-200 dark:border-slate-800 overflow-hidden">
          <div className="flex-1 overflow-auto thin-sb p-5">
            <div className="text-lg font-bold mb-2">{F(it, marks, 'proveedor') || '—'}</div>
            <Fields it={it} marks={marks} setField={setField} aliases={aliases} onAlias={onAlias} dup={dupSet && dupSet.has(it.id)} />
          </div>
          <div className="flex gap-3 p-4 border-t border-slate-200 dark:border-slate-800">
            <button onClick={() => doMark('ver')} className="flex-1 py-4 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold flex items-center justify-center gap-2"><Icon d={I.check} /> Verificar</button>
            <button onClick={() => doMark('rev')} className="flex-1 py-4 rounded-xl bg-amber-500 hover:bg-amber-600 text-white font-bold flex items-center justify-center gap-2"><Icon d={I.flag} /> A revisar</button>
          </div>
        </div>
      </div>

      {/* resumen de datos guardados (siempre visible) + barra de acción: móvil */}
      <div className="md:hidden safe-b">
        <ReviewSummary it={it} marks={marks} onEdit={() => setSheet(true)} />
        <div className="flex items-center gap-3 px-4 pb-3 pt-1">
          <button onClick={() => doMark('rev')} className="flex-1 py-4 rounded-2xl bg-amber-500 active:scale-95 text-white font-bold flex items-center justify-center gap-2 transition"><Icon d={I.flag} /> A revisar</button>
          <button onClick={() => setSheet(true)} className="grid place-items-center w-14 h-14 rounded-2xl bg-slate-800 text-slate-200 active:scale-95 transition"><Icon d={I.grid} /></button>
          <button onClick={() => doMark('ver')} className="flex-1 py-4 rounded-2xl bg-emerald-600 active:scale-95 text-white font-bold flex items-center justify-center gap-2 transition"><Icon d={I.check} /> Verificar</button>
        </div>
      </div>

      {/* bottom sheet de datos: móvil */}
      {sheet && (
        <div className="md:hidden fixed inset-0 z-40" onClick={() => setSheet(false)}>
          <div className="absolute inset-0 bg-black/40" />
          <div className="absolute inset-x-0 bottom-0 h-[88vh] rounded-t-3xl bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 flex flex-col card-in safe-b" onClick={e => e.stopPropagation()}>
            <div className="pt-2.5 pb-1 grid place-items-center shrink-0"><div className="w-10 h-1.5 rounded-full bg-slate-300 dark:bg-slate-600" /></div>
            {/* foto del ticket: visible mientras editas (pinch / doble toque / botones) */}
            <SheetPreview src={it.img} rot={rotOf(it, marks)} />
            <div className="flex items-center justify-between px-5 pb-2 shrink-0">
              <div className="text-base font-bold truncate">{F(it, marks, 'proveedor') || '—'}</div>
              <button onClick={() => setSheet(false)} className="grid place-items-center w-8 h-8 rounded-lg bg-slate-100 dark:bg-slate-800"><Icon d={I.x} className="w-4 h-4" /></button>
            </div>
            <div className="flex-1 overflow-auto thin-sb px-5 pb-4"><Fields it={it} marks={marks} setField={setField} aliases={aliases} onAlias={onAlias} dup={dupSet && dupSet.has(it.id)} /></div>
          </div>
        </div>
      )}
    </div>
  )
}
const CtrlBtn = ({ d, onClick }) => (
  <button onClick={onClick} className="grid place-items-center w-12 h-12 rounded-2xl bg-white/95 text-slate-700 dark:text-slate-200 shadow-lg hover:bg-white active:scale-95 transition"><Icon d={d} /></button>
)

/* previsualizador de la foto en la hoja de edición (móvil): pinch / doble toque / botones */
function SheetPreview({ src, rot }) {
  const wrapRef = useRef(null), imgRef = useRef(null)
  const tf = useRef({ tx: 0, ty: 0, sc: 1, fit: 1 })
  const apply = () => { const t = tf.current, im = imgRef.current; if (im) im.style.transform = `translate(-50%,-50%) translate(${t.tx}px,${t.ty}px) rotate(${rot}deg) scale(${t.sc})` }
  const fit = () => {
    const im = imgRef.current, w = wrapRef.current; if (!im || !im.naturalWidth || !w) return
    const land = rot % 180 !== 0
    const iw = land ? im.naturalHeight : im.naturalWidth, ih = land ? im.naturalWidth : im.naturalHeight
    const s = (w.clientWidth / iw) || 1
    tf.current = { tx: 0, ty: Math.max(0, (ih * s - w.clientHeight) / 2), sc: s, fit: s }  // ancho completo, empieza arriba
    apply()
  }
  const zoom = f => { const t = tf.current; t.sc = Math.min(t.fit * 8, Math.max(t.fit, t.sc * f)); apply() }
  useEffect(() => { const im = imgRef.current; if (!im) return; im.onload = fit; im.src = src; if (im.complete && im.naturalWidth) fit() }, [src, rot])
  useEffect(() => {
    const w = wrapRef.current; if (!w) return
    const pts = new Map(); let mode = null, sx = 0, sy = 0, bx = 0, by = 0, sd = 0, ssc = 1, smx = 0, smy = 0, btx = 0, bty = 0, lastTap = 0
    const arr = () => [...pts.values()]
    const dist = () => { const p = arr(); return Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y) }
    const mid = () => { const p = arr(); return [(p[0].x + p[1].x) / 2, (p[0].y + p[1].y) / 2] }
    const down = e => {
      if (e.target.closest('.pvctrl')) return
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY }); try { w.setPointerCapture(e.pointerId) } catch (_) {}; e.preventDefault()
      if (pts.size === 2) { mode = 'pinch'; sd = dist(); ssc = tf.current.sc;[smx, smy] = mid(); btx = tf.current.tx; bty = tf.current.ty }
      else if (pts.size === 1) {
        const now = Date.now()
        if (now - lastTap < 300) { if (tf.current.sc > tf.current.fit * 1.2) fit(); else { tf.current.sc = tf.current.fit * 2.5; tf.current.tx = 0; tf.current.ty = 0; apply() } mode = null; lastTap = 0; return }
        lastTap = now; sx = e.clientX; sy = e.clientY; bx = tf.current.tx; by = tf.current.ty; mode = 'pan'
      }
    }
    const move = e => {
      if (!pts.has(e.pointerId)) return; pts.set(e.pointerId, { x: e.clientX, y: e.clientY })
      if (mode === 'pinch' && pts.size >= 2) { const d = dist(), [mx, my] = mid(); tf.current.sc = Math.min(tf.current.fit * 8, Math.max(tf.current.fit, ssc * (d / (sd || 1)))); tf.current.tx = btx + (mx - smx); tf.current.ty = bty + (my - smy); apply(); return }
      if (mode === 'pan') { tf.current.tx = bx + (e.clientX - sx); tf.current.ty = by + (e.clientY - sy); apply() }
    }
    const up = e => { pts.delete(e.pointerId); if (pts.size === 0) mode = null; else if (pts.size === 1 && mode === 'pinch') { const p = arr()[0]; sx = p.x; sy = p.y; bx = tf.current.tx; by = tf.current.ty; mode = 'pan' } }
    const wheel = e => { e.preventDefault(); zoom(e.deltaY < 0 ? 1.12 : 0.89) }
    w.addEventListener('pointerdown', down); w.addEventListener('pointermove', move); w.addEventListener('pointerup', up); w.addEventListener('pointercancel', up); w.addEventListener('wheel', wheel, { passive: false })
    return () => { w.removeEventListener('pointerdown', down); w.removeEventListener('pointermove', move); w.removeEventListener('pointerup', up); w.removeEventListener('pointercancel', up); w.removeEventListener('wheel', wheel) }
  }, [rot])
  return (
    <div ref={wrapRef} className="relative overflow-hidden bg-slate-900 rounded-xl mx-3 mb-2 shrink-0 select-none" style={{ height: '30vh', touchAction: 'none' }}>
      <img ref={imgRef} draggable="false" alt="" className="absolute left-1/2 top-1/2 max-w-none select-none will-change-transform" style={{ touchAction: 'none' }} />
      <div className="pvctrl absolute right-2 bottom-2 flex gap-1.5" onPointerDown={e => e.stopPropagation()}>
        <button onClick={() => zoom(1.4)} className="grid place-items-center w-8 h-8 rounded-lg bg-white/90 text-slate-700 shadow"><Icon d={I.zoomIn} className="w-4 h-4" /></button>
        <button onClick={() => zoom(0.7)} className="grid place-items-center w-8 h-8 rounded-lg bg-white/90 text-slate-700 shadow"><Icon d={I.zoomOut} className="w-4 h-4" /></button>
        <button onClick={fit} className="grid place-items-center w-8 h-8 rounded-lg bg-white/90 text-slate-700 shadow"><Icon d={I.fit} className="w-4 h-4" /></button>
      </div>
    </div>
  )
}

/* resumen siempre visible de los datos guardados (móvil) — pulsar = editar */
function ReviewSummary({ it, marks, onEdit }) {
  if (!it) return null
  const cuadra = cuadraOf(it, marks)
  const s = marks[it.id] || {}
  return (
    <button onClick={onEdit} className="block w-full text-left px-3 pt-2">
      <div className="rounded-2xl bg-slate-900/85 backdrop-blur border border-slate-700/80 px-4 py-2.5">
        <div className="flex items-center gap-2">
          <span className="font-semibold text-slate-100 truncate">{F(it, marks, 'proveedor') || '—'}</span>
          <span className={'shrink-0 px-1.5 py-0.5 rounded text-[10px] font-bold ' + (it.conf === 'alta' ? 'bg-emerald-500/20 text-emerald-300' : it.conf === 'media' ? 'bg-amber-500/20 text-amber-300' : 'bg-rose-500/20 text-rose-300')}>{it.conf}</span>
          {!cuadra && <span className="shrink-0 text-[11px] font-semibold text-rose-300">✗ no cuadra</span>}
          {s.status === 'ver' && <span className="shrink-0 text-[11px] font-bold text-emerald-400">✓ verif.</span>}
          {s.status === 'rev' && <span className="shrink-0 text-[11px] font-bold text-amber-400">⚑ revisar</span>}
          <span className="ml-auto shrink-0 flex items-center gap-1 text-[11px] text-slate-400"><Icon d={I.edit} className="w-3.5 h-3.5" /> editar</span>
        </div>
        <div className="flex items-center gap-2 mt-0.5 text-[12px] text-slate-400">
          <span className="shrink-0">{F(it, marks, 'fecha') || '—'}</span>
          <span className="opacity-50">·</span>
          <span className="truncate">{F(it, marks, 'num') || 'sin nº'}</span>
        </div>
        <div className="flex items-center gap-4 mt-1.5 text-[13px] tabular-nums">
          <span className="text-slate-400">Base <b className="text-slate-100 font-semibold">{eur(Nv(it, marks, 'base'))}</b></span>
          <span className="text-slate-400">IVA <b className="text-slate-100 font-semibold">{eur(Nv(it, marks, 'iva'))}</b></span>
          <span className="ml-auto text-slate-400">Total <b className="text-emerald-400 font-bold text-[15px]">{eur(Nv(it, marks, 'total'))}</b></span>
        </div>
      </div>
    </button>
  )
}

/* ===================== completado (lista) ===================== */
function DoneOverlay({ ver, total, userName, onExport, onClose, onBack }) {
  return (
    <div className="fixed inset-0 z-50 bg-slate-950/60 flex items-center justify-center p-5">
      <div className="w-full max-w-sm rounded-3xl bg-white dark:bg-slate-900 p-7 text-center card-in">
        <div className="text-6xl mb-2">🎉</div>
        <h2 className="text-xl font-bold text-slate-900 dark:text-slate-100 dark:text-slate-100">{cheer(userName)}</h2>
        <p className="text-slate-500 dark:text-slate-400 mt-1">Todo verificado · {ver} de {total} facturas. ¡Gran trabajo! 💪</p>
        <button onClick={onExport} className="mt-6 w-full py-3.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold flex items-center justify-center gap-2"><Icon d={I.download} className="w-5 h-5" /> Exportar Excel</button>
        <div className="flex gap-2 mt-2">
          <button onClick={onClose} className="flex-1 py-2.5 rounded-xl bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 font-semibold text-slate-700 dark:text-slate-200">Seguir</button>
          <button onClick={onBack} className="flex-1 py-2.5 rounded-xl bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 font-semibold text-slate-700 dark:text-slate-200">Al panel</button>
        </div>
      </div>
    </div>
  )
}

/* ===================== confirmar borrado ===================== */
function ConfirmDelete({ job, onCancel, onConfirm }) {
  return (
    <div className="fixed inset-0 z-[60] bg-slate-950/60 flex items-center justify-center p-5" onClick={onCancel}>
      <div className="w-full max-w-sm rounded-3xl bg-white dark:bg-slate-900 p-6 card-in" onClick={e => e.stopPropagation()}>
        <div className="grid place-items-center w-12 h-12 rounded-2xl bg-rose-100 text-rose-600 mb-3"><Icon d={I.trash} /></div>
        <h2 className="text-lg font-bold text-slate-900 dark:text-slate-100">Eliminar lote de {job.empresa || '—'}</h2>
        <p className="text-sm text-slate-500 dark:text-slate-400 mt-1.5">Se borrarán sus <b>{job.n_facturas ?? 0}</b> facturas, las imágenes del Storage y su estado de revisión. Esta acción no se puede deshacer.</p>
        <div className="flex gap-2 mt-5">
          <button onClick={onCancel} className="flex-1 py-3 rounded-xl bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 font-semibold text-slate-700 dark:text-slate-200">Cancelar</button>
          <button onClick={onConfirm} className="flex-1 py-3 rounded-xl bg-rose-600 hover:bg-rose-700 text-white font-semibold">Eliminar</button>
        </div>
      </div>
    </div>
  )
}
