import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react'
import { buildXlsx, tsvTable } from './xlsx.js'

const BASE = import.meta.env.BASE_URL

/* ---------- helpers de datos (no rompen el contrato JSON) ---------- */
const rotOf = (it, m) => (((m[it.id]?.rot ?? it.rot0) % 360) + 360) % 360
const F = (it, m, k) => { const s = m[it.id]; return s && s[k] != null ? s[k] : it[k] }
const Nv = (it, m, k) => { const v = F(it, m, k); return typeof v === 'number' ? v : (parseFloat(String(v).replace(',', '.')) || 0) }
const rank = (it, m) => { const s = m[it.id]?.status; if (s === 'ver') return 4; if (it.flag || it.conf === 'baja') return 0; if (it.conf === 'media') return 1; return 2 }
const isoFromDMY = s => { const p = String(s).split('/'); return p.length === 3 ? `${p[2]}-${p[1].padStart(2, '0')}-${p[0].padStart(2, '0')}` : (/^\d{4}-\d{2}-\d{2}$/.test(s) ? s : '') }
const dmyFromIso = s => { const p = String(s).split('-'); return p.length === 3 ? `${p[2].padStart(2, '0')}/${p[1].padStart(2, '0')}/${p[0]}` : s }
const fmtT = ms => { const s = Math.floor(ms / 1000); return String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0') }
const eur = n => Number(n || 0).toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €'
const cuadraOf = (it, m) => Math.abs((Nv(it, m, 'base') + Nv(it, m, 'iva')) - Nv(it, m, 'total')) <= 0.02

/* ---------- localStorage seguro (Safari bloquea en file://) ---------- */
const lsGet = (k, fb) => { try { return JSON.parse(localStorage.getItem(k) || '') ?? fb } catch (e) { return fb } }
const lsSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)) } catch (e) {} }
const lsDel = k => { try { localStorage.removeItem(k) } catch (e) {} }
const revKey = fecha => 'agm_rev_' + fecha
const metaKey = fecha => 'agm_meta_' + fecha
const HIDDEN_KEY = 'agm_hidden'

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
  grid: <><rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" /></>,
  doc: <><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6" /></>,
  chevR: <path d="m9 18 6-6-6-6" />,
  edit: <><path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" /></>,
}
const Icon = ({ d, className = 'w-5 h-5', sw = 2 }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round" className={className}>{d}</svg>
)

/* ================================================================= */
export default function App() {
  const [tandas, setTandas] = useState([])
  const [hidden, setHidden] = useState(() => lsGet(HIDDEN_KEY, []))
  const [view, setView] = useState('dashboard')      // 'dashboard' | 'list'
  const [sel, setSel] = useState(null)               // tanda activa {fecha, archivo, n}
  const [items, setItems] = useState([])
  const [marks, setMarks] = useState({})
  const [tick, setTick] = useState(0)                // recálculo de stats del panel
  const [confirm, setConfirm] = useState(null)       // tanda a eliminar
  const keyRef = useRef('')

  /* índice de tandas */
  const loadIndex = useCallback(() => {
    fetch(`${BASE}data/index.json?t=` + Date.now())
      .then(r => r.json())
      .then(j => setTandas(j.tandas || []))
      .catch(() => setTandas([]))
  }, [])
  useEffect(() => { loadIndex() }, [loadIndex])

  /* carga de una tanda */
  const openTanda = useCallback(t => {
    setSel(t); setView('list'); setItems([])
    fetch(`${BASE}data/${t.archivo}`).then(r => r.json()).then(j => {
      setItems(j.items || [])
      const fecha = j.fecha || t.fecha || t.archivo
      keyRef.current = revKey(fecha)
      setMarks(lsGet(keyRef.current, {}))
      const mk = metaKey(fecha); const meta = lsGet(mk, {})
      if (!meta.first) lsSet(mk, { ...meta, first: new Date().toISOString() })
    })
    window.scrollTo(0, 0)
  }, [])

  const persist = useCallback(m => {
    lsSet(keyRef.current, m)
    const fecha = keyRef.current.replace('agm_rev_', '')
    lsSet(metaKey(fecha), { ...lsGet(metaKey(fecha), {}), last: new Date().toISOString() })
  }, [])
  const update = useCallback((id, patch) => setMarks(prev => { const m = { ...prev, [id]: { ...prev[id], ...patch } }; persist(m); return m }), [persist])
  const setField = (id, k, raw, num) => { let v = raw; if (num) { v = parseFloat(String(raw).replace(',', '.')); if (isNaN(v)) v = undefined } else if (k === 'fecha') v = dmyFromIso(raw); update(id, { [k]: v }) }
  const mark = (id, status) => update(id, { status })
  const rotate = id => { const it = items.find(x => x.id === id); update(id, { rot: (rotOf(it, marks) + 90) % 360 }) }
  const reset = id => setMarks(prev => { const m = { ...prev }; const r = m[id]?.rot; m[id] = r != null ? { rot: r } : {}; persist(m); return m })

  /* borrado de una tanda (real en dev, local en producción) */
  const removeTanda = async t => {
    const fecha = t.fecha || t.archivo
    try { await fetch(`${BASE}__api/delete-tanda`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ archivo: t.archivo }) }) } catch (e) {}
    lsDel(revKey(fecha)); lsDel(metaKey(fecha))
    const h = Array.from(new Set([...hidden, t.archivo])); setHidden(h); lsSet(HIDDEN_KEY, h)
    setTandas(prev => prev.filter(x => x.archivo !== t.archivo))
    setConfirm(null); setTick(x => x + 1)
    if (sel && sel.archivo === t.archivo) { setView('dashboard'); setSel(null) }
  }
  const restoreHidden = () => { setHidden([]); lsSet(HIDDEN_KEY, []); setTick(x => x + 1); loadIndex() }

  const visibleTandas = useMemo(() => tandas.filter(t => !hidden.includes(t.archivo)), [tandas, hidden])

  /* editor de campos (reutilizado en lista, modal y revisión) */
  const Fields = useCallback(({ it, compact }) => {
    const cuadra = cuadraOf(it, marks)
    const s = marks[it.id] || {}
    const Row = ({ label, children }) => (
      <div className="flex items-center justify-between gap-3 py-1.5 border-b border-dashed border-slate-200/70">
        <span className="text-[13px] text-slate-500 whitespace-nowrap">{label}</span>{children}
      </div>
    )
    const inp = 'rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm text-slate-900 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200 outline-none transition'
    return (
      <div className={compact ? '' : 'space-y-0.5'}>
        <div className="flex flex-wrap items-center gap-1.5 mb-2.5">
          <span className={'px-2 py-0.5 rounded-md text-[11px] font-semibold ' + (it.conf === 'alta' ? 'bg-emerald-100 text-emerald-700' : it.conf === 'media' ? 'bg-amber-100 text-amber-700' : 'bg-rose-100 text-rose-700')}>confianza {it.conf}</span>
          <span className={'px-2 py-0.5 rounded-md text-[11px] font-semibold ' + (cuadra ? 'bg-emerald-100 text-emerald-700' : 'bg-rose-100 text-rose-700')}>{cuadra ? '✓ cuadra' : '✗ no cuadra'}</span>
          {it.flag && <span className="px-2 py-0.5 rounded-md text-[11px] font-semibold bg-orange-100 text-orange-700">⚑ marcada</span>}
          {s.status === 'ver' && <span className="px-2 py-0.5 rounded-md text-[11px] font-bold bg-emerald-600 text-white">✓ VERIFICADA</span>}
          {s.status === 'rev' && <span className="px-2 py-0.5 rounded-md text-[11px] font-bold bg-amber-500 text-white">⚑ A REVISAR</span>}
        </div>
        <Row label="Fecha"><input type="date" className={inp + ' w-[150px]'} value={isoFromDMY(F(it, marks, 'fecha'))} onChange={e => setField(it.id, 'fecha', e.target.value, false)} /></Row>
        <Row label="Proveedor"><input className={inp + ' flex-1 min-w-0'} value={F(it, marks, 'proveedor') || ''} onChange={e => setField(it.id, 'proveedor', e.target.value, false)} /></Row>
        <Row label="Nº factura"><input className={inp + ' flex-1 min-w-0'} value={F(it, marks, 'num') || ''} onChange={e => setField(it.id, 'num', e.target.value, false)} /></Row>
        <Row label="Base"><input inputMode="decimal" className={inp + ' w-28 text-right tabular-nums'} value={Nv(it, marks, 'base').toFixed(2)} onChange={e => setField(it.id, 'base', e.target.value, true)} /></Row>
        <Row label={'IVA/IPSI · ' + (it.timp || '')}><input inputMode="decimal" className={inp + ' w-28 text-right tabular-nums'} value={Nv(it, marks, 'iva').toFixed(2)} onChange={e => setField(it.id, 'iva', e.target.value, true)} /></Row>
        <Row label="Total"><input inputMode="decimal" className={inp + ' w-28 text-right tabular-nums font-semibold'} value={Nv(it, marks, 'total').toFixed(2)} onChange={e => setField(it.id, 'total', e.target.value, true)} /></Row>
        <div className="pt-2">
          <span className="text-[13px] text-slate-500">Observaciones</span>
          <textarea className={inp + ' w-full mt-1 min-h-[44px] resize-y'} value={F(it, marks, 'obs') || ''} onChange={e => setField(it.id, 'obs', e.target.value, false)} />
        </div>
      </div>
    )
  }, [marks])

  /* export (usa la tanda cargada) */
  const approvedRows = () => [...items].sort((a, b) => isoFromDMY(F(a, marks, 'fecha')) < isoFromDMY(F(b, marks, 'fecha')) ? -1 : 1).map(it => {
    const s = marks[it.id]; const st = s?.status === 'ver' ? 'Verificada' : s?.status === 'rev' ? 'A revisar' : 'Pendiente'
    return { fecha: F(it, marks, 'fecha'), proveedor: F(it, marks, 'proveedor'), num: F(it, marks, 'num'), base: Nv(it, marks, 'base'), iva: Nv(it, marks, 'iva'), total: Nv(it, marks, 'total'), estado: st, obs: F(it, marks, 'obs'), amber: s?.status === 'rev' || it.flag }
  })
  const exportXlsx = () => { const blob = buildXlsx(approvedRows()); const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'AGM_revisado_' + (sel?.fecha || '') + '.xlsx'; a.click(); URL.revokeObjectURL(a.href) }
  const copyTable = async () => { try { await navigator.clipboard.writeText(tsvTable(approvedRows())); alert('Tabla copiada. Pégala en Excel.') } catch (e) { alert('No se pudo copiar automáticamente.') } }

  return (
    <div className="min-h-full">
      {view === 'dashboard'
        ? <Dashboard tandas={visibleTandas} hiddenCount={hidden.length} tick={tick} onOpen={openTanda} onDelete={setConfirm} onRestore={restoreHidden} />
        : <ListView sel={sel} items={items} marks={marks} Fields={Fields} mark={mark} reset={reset} rotate={rotate}
            exportXlsx={exportXlsx} copyTable={copyTable} setField={setField} update={update}
            onBack={() => { setView('dashboard'); setTick(x => x + 1); }} onDelete={() => setConfirm(sel)} />}

      {confirm && <ConfirmDelete tanda={confirm} onCancel={() => setConfirm(null)} onConfirm={() => removeTanda(confirm)} />}
    </div>
  )
}

/* ===================== PANEL (dashboard) ===================== */
function statsOf(t) {
  const fecha = t.fecha || t.archivo
  const m = lsGet(revKey(fecha), {})
  let ver = 0, rev = 0
  for (const id in m) { if (m[id]?.status === 'ver') ver++; else if (m[id]?.status === 'rev') rev++ }
  const total = t.n || 0
  const pend = Math.max(0, total - ver - rev)
  const meta = lsGet(metaKey(fecha), {})
  return { total, ver, rev, pend, last: meta.last, first: meta.first }
}
const relTime = iso => {
  if (!iso) return '—'
  const d = (Date.now() - new Date(iso).getTime()) / 1000
  if (d < 60) return 'hace un momento'
  if (d < 3600) return `hace ${Math.floor(d / 60)} min`
  if (d < 86400) return `hace ${Math.floor(d / 3600)} h`
  return `hace ${Math.floor(d / 86400)} d`
}

function Dashboard({ tandas, hiddenCount, tick, onOpen, onDelete, onRestore }) {
  const data = useMemo(() => tandas.map(t => ({ t, s: statsOf(t) })), [tandas, tick])
  const g = data.reduce((a, { s }) => ({ total: a.total + s.total, ver: a.ver + s.ver, rev: a.rev + s.rev, pend: a.pend + s.pend }), { total: 0, ver: 0, rev: 0, pend: 0 })
  const pct = g.total ? Math.round((g.ver / g.total) * 100) : 0

  return (
    <div className="mx-auto max-w-5xl px-4 pb-16">
      <header className="safe-t pt-7 pb-5">
        <div className="flex items-center gap-2.5">
          <div className="grid place-items-center w-10 h-10 rounded-xl bg-indigo-600 text-white shadow-lg shadow-indigo-600/30"><Icon d={I.doc} /></div>
          <div>
            <h1 className="text-xl font-bold tracking-tight text-slate-900">Revisión de facturas <span className="text-indigo-600">AGM</span></h1>
            <p className="text-[13px] text-slate-500">Panel general · {tandas.length} {tandas.length === 1 ? 'tanda' : 'tandas'}</p>
          </div>
        </div>
      </header>

      {/* KPIs globales */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Kpi n={g.total} label="Facturas" tone="slate" />
        <Kpi n={g.ver} label="Verificadas" tone="emerald" />
        <Kpi n={g.rev} label="A revisar" tone="amber" />
        <Kpi n={g.pend} label="Pendientes" tone="indigo" />
      </div>

      {g.total > 0 && (
        <div className="mt-4 rounded-2xl bg-white border border-slate-200 p-4 shadow-sm">
          <div className="flex items-center justify-between text-sm mb-2">
            <span className="font-semibold text-slate-700">Progreso global</span>
            <span className="text-slate-500">{g.ver}/{g.total} · <b className="text-emerald-600">{pct}%</b></span>
          </div>
          <div className="h-2.5 rounded-full bg-slate-100 overflow-hidden"><div className="h-full bg-gradient-to-r from-emerald-400 to-emerald-600 transition-all" style={{ width: pct + '%' }} /></div>
        </div>
      )}

      {/* tarjetas de tandas */}
      <h2 className="mt-8 mb-3 text-sm font-semibold uppercase tracking-wide text-slate-400">Tandas</h2>
      {tandas.length === 0
        ? <div className="rounded-2xl border border-dashed border-slate-300 bg-white/60 p-10 text-center text-slate-500">No hay tandas. Añade un <code className="text-indigo-600">.json</code> a <code>public/data/</code> y refréscalo en <code>index.json</code>.</div>
        : <div className="grid sm:grid-cols-2 gap-3">
            {data.map(({ t, s }) => <TandaCard key={t.archivo} t={t} s={s} onOpen={() => onOpen(t)} onDelete={() => onDelete(t)} />)}
          </div>}

      {hiddenCount > 0 && (
        <button onClick={onRestore} className="mt-6 text-[13px] text-slate-500 hover:text-indigo-600 underline underline-offset-2">Restaurar {hiddenCount} tanda(s) oculta(s)</button>
      )}
    </div>
  )
}

const Kpi = ({ n, label, tone }) => {
  const tones = { slate: 'text-slate-900', emerald: 'text-emerald-600', amber: 'text-amber-600', indigo: 'text-indigo-600' }
  return (
    <div className="rounded-2xl bg-white border border-slate-200 p-4 shadow-sm">
      <div className={'text-3xl font-extrabold tabular-nums ' + tones[tone]}>{n}</div>
      <div className="text-[13px] text-slate-500 mt-0.5">{label}</div>
    </div>
  )
}

function TandaCard({ t, s, onOpen, onDelete }) {
  const pct = s.total ? Math.round((s.ver / s.total) * 100) : 0
  const done = s.total > 0 && s.ver === s.total
  return (
    <div className="group rounded-2xl bg-white border border-slate-200 shadow-sm hover:shadow-md hover:border-indigo-300 transition overflow-hidden">
      <button onClick={onOpen} className="w-full text-left p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <span className="font-bold text-slate-900">{t.fecha}</span>
              {done && <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-emerald-100 text-emerald-700">COMPLETA</span>}
            </div>
            <div className="text-[12px] text-slate-400 mt-0.5">{t.n} facturas · última revisión {relTime(s.last)}</div>
          </div>
          <Icon d={I.chevR} className="w-5 h-5 text-slate-300 group-hover:text-indigo-500 transition" />
        </div>

        <div className="mt-3 h-2 rounded-full bg-slate-100 overflow-hidden">
          <div className="h-full bg-emerald-500 transition-all" style={{ width: pct + '%' }} />
        </div>
        <div className="mt-2.5 flex flex-wrap gap-x-4 gap-y-1 text-[12px]">
          <span className="text-emerald-600 font-semibold">{s.ver} verif.</span>
          <span className="text-amber-600 font-semibold">{s.rev} a revisar</span>
          <span className="text-slate-500 font-semibold">{s.pend} pend.</span>
          <span className="ml-auto text-slate-400">{pct}%</span>
        </div>
      </button>
      <div className="flex border-t border-slate-100">
        <button onClick={onOpen} className="flex-1 py-2.5 text-sm font-semibold text-indigo-600 hover:bg-indigo-50 transition">Abrir</button>
        <div className="w-px bg-slate-100" />
        <button onClick={onDelete} className="px-4 py-2.5 text-sm font-semibold text-rose-500 hover:bg-rose-50 transition flex items-center gap-1.5"><Icon d={I.trash} className="w-4 h-4" /> Eliminar</button>
      </div>
    </div>
  )
}

/* ===================== LISTA (una tanda) ===================== */
function ListView({ sel, items, marks, Fields, mark, reset, rotate, exportXlsx, copyTable, onBack, onDelete }) {
  const [filter, setFilter] = useState('todas')
  const [q, setQ] = useState('')
  const [modalId, setModalId] = useState(null)
  const [review, setReview] = useState(false)
  const [showDone, setShowDone] = useState(false)

  const ver = items.filter(it => marks[it.id]?.status === 'ver').length
  const rev = items.filter(it => marks[it.id]?.status === 'rev').length
  useEffect(() => { if (items.length && ver === items.length) setShowDone(true) }, [ver, items.length])

  const ordered = [...items].sort((a, b) => rank(a, marks) - rank(b, marks))
  const ql = q.trim().toLowerCase()
  const visible = ordered.filter(it => {
    const s = marks[it.id]?.status
    if (filter === 'pend' && s === 'ver') return false
    if (filter === 'ver' && s !== 'ver') return false
    if (filter === 'flag' && !(it.flag || s === 'rev')) return false
    if (ql) { const hay = [F(it, marks, 'proveedor'), F(it, marks, 'num'), F(it, marks, 'obs')].join(' ').toLowerCase(); if (!hay.includes(ql)) return false }
    return true
  })

  const FilterBtn = ({ id, label, n }) => (
    <button onClick={() => setFilter(id)} className={'px-3 py-1.5 rounded-full text-[13px] font-medium whitespace-nowrap transition ' + (filter === id ? 'bg-indigo-600 text-white shadow' : 'bg-white text-slate-600 border border-slate-200 hover:border-indigo-300')}>{label}{n != null && <span className="ml-1 opacity-70">{n}</span>}</button>
  )

  return (
    <div>
      {/* cabecera sticky */}
      <div className="sticky top-0 z-20 bg-white/90 backdrop-blur border-b border-slate-200">
        <div className="mx-auto max-w-5xl px-4 safe-t">
          <div className="flex items-center gap-3 py-3">
            <button onClick={onBack} className="grid place-items-center w-9 h-9 rounded-lg hover:bg-slate-100 text-slate-600 transition"><Icon d={I.back} /></button>
            <div className="min-w-0">
              <h1 className="font-bold text-slate-900 leading-tight truncate">Tanda {sel?.fecha}</h1>
              <p className="text-[12px] text-slate-500">{ver} verif · {rev} a revisar · {items.length - ver - rev} pend</p>
            </div>
            <div className="ml-auto flex items-center gap-2">
              <button onClick={() => setReview(true)} className="hidden sm:flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-indigo-600 text-white text-sm font-semibold shadow-lg shadow-indigo-600/30 hover:bg-indigo-700 transition"><Icon d={I.play} className="w-4 h-4" /> Revisar</button>
              <button onClick={copyTable} className="grid place-items-center w-9 h-9 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 transition" title="Copiar tabla"><Icon d={I.copy} className="w-[18px] h-[18px]" /></button>
              <button onClick={exportXlsx} className="grid place-items-center w-9 h-9 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 transition" title="Exportar Excel"><Icon d={I.download} className="w-[18px] h-[18px]" /></button>
              <button onClick={onDelete} className="grid place-items-center w-9 h-9 rounded-lg border border-rose-200 text-rose-500 hover:bg-rose-50 transition" title="Eliminar tanda"><Icon d={I.trash} className="w-[18px] h-[18px]" /></button>
            </div>
          </div>
          <div className="flex items-center gap-2 pb-3 overflow-x-auto thin-sb">
            <FilterBtn id="todas" label="Todas" n={items.length} />
            <FilterBtn id="pend" label="Pendientes" n={items.length - ver} />
            <FilterBtn id="ver" label="Verificadas" n={ver} />
            <FilterBtn id="flag" label="A revisar" n={rev} />
            <div className="relative ml-auto flex-1 min-w-[140px] max-w-[260px]">
              <Icon d={I.search} className="w-4 h-4 absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
              <input value={q} onChange={e => setQ(e.target.value)} placeholder="Buscar…" className="w-full pl-8 pr-2 py-1.5 rounded-full border border-slate-200 text-[13px] focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200 outline-none" />
            </div>
          </div>
        </div>
      </div>

      {/* tarjetas */}
      <div className="mx-auto max-w-5xl px-4 py-5 space-y-4">
        {items.length === 0 && <p className="text-slate-400 py-10 text-center">Cargando facturas…</p>}
        {items.length > 0 && visible.length === 0 && <p className="text-slate-400 py-10 text-center">Sin resultados para este filtro.</p>}
        {visible.map(it => <InvoiceCard key={it.id} it={it} marks={marks} Fields={Fields} mark={mark} reset={reset} rotate={rotate} onZoom={() => setModalId(it.id)} />)}
      </div>

      {/* botón flotante de revisión en móvil */}
      <button onClick={() => setReview(true)} className="sm:hidden fixed right-4 bottom-4 z-30 flex items-center gap-2 px-5 py-3.5 rounded-full bg-indigo-600 text-white font-semibold shadow-xl shadow-indigo-600/40 active:scale-95 transition"><Icon d={I.play} className="w-5 h-5" /> Revisar</button>

      {modalId && <Modal it={items.find(x => x.id === modalId)} marks={marks} onClose={() => setModalId(null)} onRotate={rotate} Fields={Fields} mark={mark} />}
      {review && <ReviewMode items={ordered} marks={marks} setReview={setReview} mark={mark} rotate={rotate} Fields={Fields} exportXlsx={exportXlsx} />}
      {showDone && <DoneOverlay ver={ver} total={items.length} onExport={exportXlsx} onClose={() => setShowDone(false)} onBack={onBack} />}
    </div>
  )
}

function InvoiceCard({ it, marks, Fields, mark, reset, rotate, onZoom }) {
  const s = marks[it.id] || {}
  const done = s.status === 'ver'
  return (
    <div className={'rounded-2xl bg-white border shadow-sm overflow-hidden grid sm:grid-cols-[300px_1fr] transition ' + (done ? 'opacity-60 border-slate-200' : it.flag || s.status === 'rev' ? 'border-amber-300' : 'border-slate-200')}>
      <div className="relative bg-slate-900 h-56 sm:h-auto sm:min-h-[260px] flex items-center justify-center overflow-hidden cursor-zoom-in" onClick={onZoom}>
        <img src={it.img} alt="" className="max-w-full max-h-full object-contain" style={{ transform: `rotate(${rotOf(it, marks)}deg)`, maxWidth: rotOf(it, marks) % 180 ? '70%' : '100%' }} />
        <div className="absolute top-2 right-2 flex gap-1.5">
          <button onClick={e => { e.stopPropagation(); rotate(it.id) }} className="grid place-items-center w-8 h-8 rounded-lg bg-white/90 text-slate-700 hover:bg-white shadow"><Icon d={I.rotate} className="w-4 h-4" /></button>
          <button onClick={e => { e.stopPropagation(); onZoom() }} className="grid place-items-center w-8 h-8 rounded-lg bg-white/90 text-slate-700 hover:bg-white shadow"><Icon d={I.zoomIn} className="w-4 h-4" /></button>
        </div>
      </div>
      <div className="p-4">
        <div className="text-base font-bold text-slate-900 mb-0.5">{F(it, marks, 'proveedor') || '—'}</div>
        <Fields it={it} />
        <div className="flex flex-wrap gap-2 mt-3">
          <button onClick={() => mark(it.id, 'ver')} className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-emerald-600 text-white text-sm font-semibold hover:bg-emerald-700 transition"><Icon d={I.check} className="w-4 h-4" /> Verificado</button>
          <button onClick={() => mark(it.id, 'rev')} className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-amber-500 text-white text-sm font-semibold hover:bg-amber-600 transition"><Icon d={I.flag} className="w-4 h-4" /> A revisar</button>
          <button onClick={() => reset(it.id)} className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-slate-100 text-slate-600 text-sm font-semibold hover:bg-slate-200 transition"><Icon d={I.reset} className="w-4 h-4" /> Reset</button>
        </div>
      </div>
    </div>
  )
}

/* ===================== MODAL zoom ===================== */
function Modal({ it, marks, onClose, onRotate, Fields, mark }) {
  const [z, setZ] = useState(1)
  return (
    <div className="fixed inset-0 z-50 bg-slate-950/95 flex flex-col md:grid md:grid-cols-[1fr_380px]">
      <button onClick={onClose} className="absolute top-3 left-3 z-10 grid place-items-center w-10 h-10 rounded-xl bg-white/90 text-slate-700 hover:bg-white shadow"><Icon d={I.x} /></button>
      <div className="flex-1 min-h-0 overflow-auto grid place-items-center p-4 thin-sb">
        <img src={it.img} alt="" className="transition-transform" style={{ transform: `rotate(${rotOf(it, marks)}deg) scale(${z})` }} />
      </div>
      <div className="bg-white/95 backdrop-blur p-5 overflow-auto thin-sb max-h-[45vh] md:max-h-none safe-b">
        <div className="flex gap-2 mb-3">
          <button onClick={() => setZ(z * 1.25)} className="grid place-items-center w-10 h-10 rounded-lg border border-slate-200 hover:bg-slate-50"><Icon d={I.zoomIn} /></button>
          <button onClick={() => setZ(z * 0.8)} className="grid place-items-center w-10 h-10 rounded-lg border border-slate-200 hover:bg-slate-50"><Icon d={I.zoomOut} /></button>
          <button onClick={() => onRotate(it.id)} className="grid place-items-center w-10 h-10 rounded-lg border border-slate-200 hover:bg-slate-50"><Icon d={I.rotate} /></button>
        </div>
        <Fields it={it} />
        <div className="flex gap-2 mt-4">
          <button onClick={() => mark(it.id, 'ver')} className="flex-1 flex items-center justify-center gap-1.5 py-3 rounded-xl bg-emerald-600 text-white font-semibold"><Icon d={I.check} className="w-4 h-4" /> Verificado</button>
          <button onClick={() => mark(it.id, 'rev')} className="flex-1 flex items-center justify-center gap-1.5 py-3 rounded-xl bg-amber-500 text-white font-semibold"><Icon d={I.flag} className="w-4 h-4" /> A revisar</button>
        </div>
      </div>
    </div>
  )
}

/* ===================== MODO REVISIÓN (Tinder) ===================== */
function ReviewMode({ items, marks, setReview, mark, rotate, Fields, exportXlsx }) {
  const [idx, setIdx] = useState(0)
  const [done, setDone] = useState(false)
  const [sheet, setSheet] = useState(false)   // bottom sheet de datos (móvil)
  const imgRef = useRef(null), vpRef = useRef(null), toastRef = useRef(null), iconRef = useRef(null), tintRef = useRef(null), stampRef = useRef(null)
  const tf = useRef({ tx: 0, ty: 0, sc: 1, rot: 0, fit: 1 })
  const it = items[idx]
  const t0 = useRef(Date.now()), [clock, setClock] = useState('00:00'), countRef = useRef(0)

  useEffect(() => { const i = setInterval(() => setClock(fmtT(Date.now() - t0.current)), 500); return () => clearInterval(i) }, [])
  const apply = () => { const t = tf.current; if (imgRef.current) imgRef.current.style.transform = `translate(-50%,-50%) translate(${t.tx}px,${t.ty}px) rotate(${t.rot}deg) scale(${t.sc})` }
  const fit = () => { const im = imgRef.current, vp = vpRef.current; if (!im || !im.naturalWidth) return; const s = (Math.min(vp.clientWidth / im.naturalWidth, vp.clientHeight / im.naturalHeight) || 1) * .95; tf.current = { ...tf.current, tx: 0, ty: 0, sc: s, fit: s }; apply() }
  const setStamp = () => { const st = marks[it?.id]?.status; if (stampRef.current) { stampRef.current.style.display = st ? 'block' : 'none'; stampRef.current.className = 'absolute top-5 left-1/2 -translate-x-1/2 -rotate-6 px-5 py-2 rounded-xl border-4 font-black text-2xl z-20 ' + (st === 'ver' ? 'text-emerald-600 border-emerald-500 bg-emerald-50/90' : 'text-amber-600 border-amber-500 bg-amber-50/90'); stampRef.current.textContent = st === 'ver' ? '✓ VERIFICADA' : st === 'rev' ? '⚑ PENDIENTE' : '' } }
  useEffect(() => { if (!it) return; tf.current.rot = ((marks[it.id]?.rot ?? it.rot0) % 360 + 360) % 360; const im = imgRef.current; if (im) { im.onload = fit; im.src = it.img; if (im.complete) fit() } apply(); setStamp() }, [idx, it])
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
    setTimeout(() => { el.style.opacity = 0; el.style.transform = 'translate(-50%,-50%) scale(.5)'; next() }, 380)
  }

  /* gestos (swipe tipo Tinder + paneo con zoom) */
  useEffect(() => {
    const vp = vpRef.current; if (!vp) return
    let mode = null, sx = 0, sy = 0, bx = 0, by = 0, sdx = 0, dragging = false
    const swipe = dx => {
      const im = imgRef.current; im.style.transition = 'none'; const t = tf.current
      im.style.transform = `translate(-50%,-50%) translate(${t.tx + dx}px,${t.ty}px) rotate(${t.rot + dx * 0.04}deg) scale(${t.sc})`
      const k = Math.max(-1, Math.min(1, dx / 160))
      const ic = iconRef.current; ic.textContent = dx > 0 ? '✓' : '⚑'; ic.style.color = dx > 0 ? '#22c55e' : '#f59e0b'; ic.style.opacity = Math.abs(k); ic.style.left = dx < 0 ? '24px' : 'auto'; ic.style.right = dx > 0 ? '24px' : 'auto'
      const tn = tintRef.current; tn.style.opacity = Math.abs(k) * 0.55; tn.style.background = dx > 0 ? 'radial-gradient(circle at 80% 50%, rgba(34,197,94,.9), transparent 70%)' : 'radial-gradient(circle at 20% 50%, rgba(245,158,11,.9), transparent 70%)'
    }
    const clear = () => { const im = imgRef.current; im.style.transition = 'transform .2s'; apply(); iconRef.current.style.opacity = 0; tintRef.current.style.opacity = 0; setTimeout(() => { im.style.transition = 'none' }, 210) }
    const fly = dir => { const im = imgRef.current; im.style.transition = 'transform .26s ease-out'; const t = tf.current; im.style.transform = `translate(-50%,-50%) translate(${dir * window.innerWidth}px,${t.ty}px) rotate(${dir * 20}deg) scale(${t.sc})`; iconRef.current.style.opacity = 0; tintRef.current.style.opacity = 0; setTimeout(() => { im.style.transition = 'none'; doMark(dir > 0 ? 'ver' : 'rev', true) }, 240) }
    const down = e => { if (e.target.closest('.vpctrl')) return; mode = tf.current.sc <= tf.current.fit * 1.18 ? 'swipe' : 'pan'; sx = e.clientX; sy = e.clientY; bx = tf.current.tx; by = tf.current.ty; sdx = 0; dragging = true; try { vp.setPointerCapture(e.pointerId) } catch (_) {}; e.preventDefault() }
    const move = e => { if (!dragging) return; const dx = e.clientX - sx, dy = e.clientY - sy; if (mode === 'pan') { tf.current.tx = bx + dx; tf.current.ty = by + dy; apply() } else { sdx = dx; swipe(dx) } }
    const up = () => { if (!dragging) return; dragging = false; if (mode === 'swipe') { const TH = Math.min(150, vp.clientWidth * 0.26); if (sdx > TH) fly(1); else if (sdx < -TH) fly(-1); else clear() } mode = null }
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
          <h2 className="text-xl font-bold">Revisión completada</h2>
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
          <span className="font-bold tabular-nums">{idx + 1}<span className="text-slate-500">/{items.length}</span></span>
          <span className="text-sm text-slate-400 tabular-nums">⏱ {clock}{countRef.current ? ` · ${countRef.current}` : ''}</span>
          <div className="ml-auto flex items-center gap-1.5">
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
          <div className="absolute left-3 bottom-3 text-[11px] text-slate-400 bg-slate-900/70 rounded-md px-2 py-1 pointer-events-none">Desliza ▶ verificar · ◀ a revisar</div>
          <div ref={toastRef} className="absolute left-1/2 top-1/2 text-[120px] leading-none pointer-events-none z-30" style={{ opacity: 0, transform: 'translate(-50%,-50%) scale(.5)', transition: 'all .2s' }} />
        </div>

        {/* panel datos: lateral en desktop */}
        <div className="hidden md:flex flex-col bg-white text-slate-900 border-l border-slate-200 overflow-hidden">
          <div className="flex-1 overflow-auto thin-sb p-5">
            <div className="text-lg font-bold mb-2">{F(it, marks, 'proveedor') || '—'}</div>
            <Fields it={it} />
          </div>
          <div className="flex gap-3 p-4 border-t border-slate-200">
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
          <div className="absolute inset-x-0 bottom-0 max-h-[80vh] rounded-t-3xl bg-white text-slate-900 flex flex-col card-in safe-b" onClick={e => e.stopPropagation()}>
            <div className="pt-3 pb-1 grid place-items-center"><div className="w-10 h-1.5 rounded-full bg-slate-300" /></div>
            <div className="flex items-center justify-between px-5 pb-2">
              <div className="text-base font-bold truncate">{F(it, marks, 'proveedor') || '—'}</div>
              <button onClick={() => setSheet(false)} className="grid place-items-center w-8 h-8 rounded-lg bg-slate-100"><Icon d={I.x} className="w-4 h-4" /></button>
            </div>
            <div className="flex-1 overflow-auto thin-sb px-5 pb-4"><Fields it={it} /></div>
          </div>
        </div>
      )}
    </div>
  )
}
const CtrlBtn = ({ d, onClick }) => (
  <button onClick={onClick} className="grid place-items-center w-12 h-12 rounded-2xl bg-white/95 text-slate-700 shadow-lg hover:bg-white active:scale-95 transition"><Icon d={d} /></button>
)

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
function DoneOverlay({ ver, total, onExport, onClose, onBack }) {
  return (
    <div className="fixed inset-0 z-50 bg-slate-950/60 flex items-center justify-center p-5">
      <div className="w-full max-w-sm rounded-3xl bg-white p-7 text-center card-in">
        <div className="text-6xl mb-2">🎉</div>
        <h2 className="text-xl font-bold text-slate-900">¡Todo verificado!</h2>
        <p className="text-slate-500 mt-1">{ver} de {total} facturas verificadas</p>
        <button onClick={onExport} className="mt-6 w-full py-3.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold flex items-center justify-center gap-2"><Icon d={I.download} className="w-5 h-5" /> Exportar Excel</button>
        <div className="flex gap-2 mt-2">
          <button onClick={onClose} className="flex-1 py-2.5 rounded-xl bg-slate-100 hover:bg-slate-200 font-semibold text-slate-700">Seguir</button>
          <button onClick={onBack} className="flex-1 py-2.5 rounded-xl bg-slate-100 hover:bg-slate-200 font-semibold text-slate-700">Al panel</button>
        </div>
      </div>
    </div>
  )
}

/* ===================== confirmar borrado ===================== */
function ConfirmDelete({ tanda, onCancel, onConfirm }) {
  return (
    <div className="fixed inset-0 z-[60] bg-slate-950/60 flex items-center justify-center p-5" onClick={onCancel}>
      <div className="w-full max-w-sm rounded-3xl bg-white p-6 card-in" onClick={e => e.stopPropagation()}>
        <div className="grid place-items-center w-12 h-12 rounded-2xl bg-rose-100 text-rose-600 mb-3"><Icon d={I.trash} /></div>
        <h2 className="text-lg font-bold text-slate-900">Eliminar tanda {tanda.fecha}</h2>
        <p className="text-sm text-slate-500 mt-1.5">Se borrará el fichero <code className="text-rose-600">{tanda.archivo}</code> (sus {tanda.n} facturas e imágenes) y su estado de revisión. Así el proyecto no acumula datos antiguos.</p>
        <p className="text-[12px] text-slate-400 mt-2">En desarrollo (<code>npm run dev</code>) se borra el fichero de verdad. En la web publicada solo se oculta en este navegador.</p>
        <div className="flex gap-2 mt-5">
          <button onClick={onCancel} className="flex-1 py-3 rounded-xl bg-slate-100 hover:bg-slate-200 font-semibold text-slate-700">Cancelar</button>
          <button onClick={onConfirm} className="flex-1 py-3 rounded-xl bg-rose-600 hover:bg-rose-700 text-white font-semibold">Eliminar</button>
        </div>
      </div>
    </div>
  )
}
