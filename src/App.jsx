import React, { useEffect, useRef, useState, useCallback } from 'react'
import { buildXlsx, tsvTable } from './xlsx.js'

const BASE = import.meta.env.BASE_URL
const rotOf = (it, m) => (((m[it.id]?.rot ?? it.rot0) % 360) + 360) % 360
const F = (it, m, k) => { const s = m[it.id]; return s && s[k] != null ? s[k] : it[k] }
const Nv = (it, m, k) => { const v = F(it, m, k); return typeof v === 'number' ? v : (parseFloat(String(v).replace(',', '.')) || 0) }
const rank = (it, m) => { const s = m[it.id]?.status; if (s === 'ver') return 4; if (it.flag || it.conf === 'baja') return 0; if (it.conf === 'media') return 1; return 2 }
const isoFromDMY = s => { const p = String(s).split('/'); return p.length === 3 ? `${p[2]}-${p[1].padStart(2,'0')}-${p[0].padStart(2,'0')}` : (/^\d{4}-\d{2}-\d{2}$/.test(s) ? s : '') }
const dmyFromIso = s => { const p = String(s).split('-'); return p.length === 3 ? `${p[2].padStart(2,'0')}/${p[1].padStart(2,'0')}/${p[0]}` : s }
const fmtT = ms => { const s = Math.floor(ms / 1000); return String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0') }

export default function App() {
  const [tandas, setTandas] = useState([])
  const [sel, setSel] = useState('')
  const [items, setItems] = useState([])
  const [marks, setMarks] = useState({})
  const [filter, setFilter] = useState('todas')
  const [modalId, setModalId] = useState(null)
  const [review, setReview] = useState(null) // {idx}
  const [showDone, setShowDone] = useState(false)
  const keyRef = useRef('')

  // carga índice
  useEffect(() => {
    fetch(`${BASE}data/index.json`).then(r => r.json()).then(j => {
      const t = j.tandas || []; setTandas(t); if (t.length) setSel(t[0].archivo)
    }).catch(() => setTandas([]))
  }, [])
  // carga tanda
  useEffect(() => {
    if (!sel) return
    fetch(`${BASE}data/${sel}`).then(r => r.json()).then(j => {
      setItems(j.items || [])
      keyRef.current = 'agm_rev_' + (j.fecha || sel)
      let m = {}; try { m = JSON.parse(localStorage.getItem(keyRef.current) || '{}') || {} } catch (e) { m = {} }
      setMarks(m)
    })
  }, [sel])

  const persist = useCallback(m => { try { localStorage.setItem(keyRef.current, JSON.stringify(m)) } catch (e) {} }, [])
  const update = useCallback((id, patch) => setMarks(prev => { const m = { ...prev, [id]: { ...prev[id], ...patch } }; persist(m); return m }), [persist])
  const setField = (id, k, raw, num) => { let v = raw; if (num) { v = parseFloat(String(raw).replace(',', '.')); if (isNaN(v)) v = undefined } else if (k === 'fecha') v = dmyFromIso(raw); update(id, { [k]: v }) }
  const mark = (id, status) => update(id, { status })
  const rotate = id => { const it = items.find(x => x.id === id); update(id, { rot: (rotOf(it, marks) + 90) % 360 }) }
  const reset = id => setMarks(prev => { const m = { ...prev }; const r = m[id]?.rot; m[id] = r != null ? { rot: r } : {}; persist(m); return m })

  const ver = items.filter(it => marks[it.id]?.status === 'ver').length
  const flagN = items.filter(it => it.flag).length
  useEffect(() => { if (items.length && ver === items.length) setShowDone(true) }, [ver, items.length])

  const ordered = [...items].sort((a, b) => rank(a, marks) - rank(b, marks))
  const visible = ordered.filter(it => {
    const s = marks[it.id]?.status
    if (filter === 'pend') return s !== 'ver'
    if (filter === 'ver') return s === 'ver'
    if (filter === 'flag') return it.flag
    return true
  })

  const approvedRows = () => [...items].sort((a, b) => isoFromDMY(F(a, marks, 'fecha')) < isoFromDMY(F(b, marks, 'fecha')) ? -1 : 1).map(it => {
    const s = marks[it.id]; const st = s?.status === 'ver' ? 'Verificada' : s?.status === 'rev' ? 'A revisar' : 'Pendiente'
    return { fecha: F(it, marks, 'fecha'), proveedor: F(it, marks, 'proveedor'), num: F(it, marks, 'num'),
      base: Nv(it, marks, 'base'), iva: Nv(it, marks, 'iva'), total: Nv(it, marks, 'total'),
      estado: st, obs: F(it, marks, 'obs'), amber: s?.status === 'rev' || it.flag }
  })
  const exportXlsx = () => { const blob = buildXlsx(approvedRows()); const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'AGM_revisado_' + new Date().toISOString().slice(0, 10) + '.xlsx'; a.click(); URL.revokeObjectURL(a.href) }
  const copyTable = async () => { try { await navigator.clipboard.writeText(tsvTable(approvedRows())); alert('Tabla copiada. Pégala en Excel.') } catch (e) { alert('No se pudo copiar automáticamente.') } }

  const Fields = ({ it }) => {
    const cuadra = Math.abs((Nv(it, marks, 'base') + Nv(it, marks, 'iva')) - Nv(it, marks, 'total')) <= 0.02
    const s = marks[it.id] || {}
    return (<>
      <span className="tag">{F(it, marks, 'num')}</span>
      {s.status === 'ver' && <span className="stamp" style={{ color: '#16a34a' }}>✓ VERIFICADA</span>}
      {s.status === 'rev' && <span className="stamp" style={{ color: '#b45309' }}>⚑ A REVISAR</span>}
      <div className="badges">
        <span className={'b c-' + it.conf}>confianza {it.conf}</span>
        <span className={'b ' + (cuadra ? 'ok' : 'bad')}>{cuadra ? '✓ cuadra' : '✗ no cuadra'}</span>
        {it.flag && <span className="b flagb">⚑ marcada</span>}
      </div>
      <div className="row"><span>Fecha</span><input type="date" className="ed" value={isoFromDMY(F(it, marks, 'fecha'))} onChange={e => setField(it.id, 'fecha', e.target.value, false)} /></div>
      <div className="row"><span>Proveedor</span><input className="ed wide" value={F(it, marks, 'proveedor')} onChange={e => setField(it.id, 'proveedor', e.target.value, false)} /></div>
      <div className="row"><span>Nº factura</span><input className="ed wide" value={F(it, marks, 'num')} onChange={e => setField(it.id, 'num', e.target.value, false)} /></div>
      <div className="row"><span>Base</span><input className="ed" value={Nv(it, marks, 'base').toFixed(2)} onChange={e => setField(it.id, 'base', e.target.value, true)} /></div>
      <div className="row"><span>IVA/IPSI — {it.timp}</span><input className="ed" value={Nv(it, marks, 'iva').toFixed(2)} onChange={e => setField(it.id, 'iva', e.target.value, true)} /></div>
      <div className="row"><span>Total</span><input className="ed" value={Nv(it, marks, 'total').toFixed(2)} onChange={e => setField(it.id, 'total', e.target.value, true)} /></div>
      <div className="row obs"><span>Obs.</span><textarea className="ed" value={F(it, marks, 'obs')} onChange={e => setField(it.id, 'obs', e.target.value, false)} /></div>
    </>)
  }

  return (
    <>
      <div className="hdr"><h1>Revisión de facturas AGM</h1><p>Datos de ficheros (sin BD). Marca verificada/pendiente, corrige campos y exporta. El estado se guarda en este navegador.</p></div>
      <div className="bar">
        <div className="kpi"><b>{items.length}</b>filas</div>
        <div className="kpi"><b>{ver}</b>verificadas</div>
        <div className="kpi"><b>{items.length - ver}</b>pendientes</div>
        <div className="kpi"><b>{flagN}</b>a revisar</div>
        {tandas.length > 1 && <select className="sel" value={sel} onChange={e => setSel(e.target.value)}>
          {tandas.map(t => <option key={t.archivo} value={t.archivo}>{t.fecha} ({t.n})</option>)}
        </select>}
        <div className="spacer" />
        <div className="filters">
          {['todas', 'pend', 'ver', 'flag'].map(f => <button key={f} className={filter === f ? 'active' : ''} onClick={() => setFilter(f)}>{{ todas: 'Todas', pend: 'Pendientes', ver: 'Verificadas', flag: 'A revisar' }[f]}</button>)}
        </div>
        <button className="btn blue" onClick={() => setReview({ idx: 0 })}>▶ Modo revisión</button>
        <button className="btn slate" onClick={copyTable}>⧉ Copiar tabla</button>
        <button className="btn green" onClick={exportXlsx}>⬇ Exportar Excel</button>
      </div>

      <div className="wrap">
        {items.length === 0 && <p style={{ color: '#64748b', padding: 14 }}>Cargando facturas…</p>}
        {visible.map(it => {
          const s = marks[it.id] || {}
          return (
            <div key={it.id} className={'card' + (s.status === 'ver' ? ' done' : '') + (it.flag ? ' flag' : '')}>
              <div className="imgcol" onClick={() => setModalId(it.id)}>
                <img src={it.img} style={{ transform: `rotate(${rotOf(it, marks)}deg)`, maxWidth: rotOf(it, marks) % 180 ? 300 : '100%', maxHeight: rotOf(it, marks) % 180 ? 330 : '100%' }} alt="" />
                <div className="imgtools">
                  <button onClick={e => { e.stopPropagation(); rotate(it.id) }}>⟳</button>
                  <button onClick={e => { e.stopPropagation(); setModalId(it.id) }}>🔍</button>
                </div>
              </div>
              <div className="info">
                <Fields it={it} />
                <div className="acts">
                  <button className="v" onClick={() => mark(it.id, 'ver')}>✓ Verificado</button>
                  <button className="r" onClick={() => mark(it.id, 'rev')}>⚑ A revisar</button>
                  <button className="e" onClick={() => reset(it.id)}>↺ Reset</button>
                </div>
              </div>
            </div>
          )
        })}
      </div>

      {modalId && <Modal it={items.find(x => x.id === modalId)} marks={marks} rotOf={rotOf} onClose={() => setModalId(null)} onRotate={rotate} Fields={Fields} mark={mark} />}
      {review && <ReviewMode items={ordered} marks={marks} setReview={setReview} mark={mark} update={update} rotate={rotate} Fields={Fields} exportXlsx={exportXlsx} />}
      {showDone && <div className="done2"><div className="donebox">
        <div style={{ fontSize: 56 }}>🎉</div><h2>¡Todo verificado!</h2>
        <p style={{ color: '#6b7280' }}>{ver} de {items.length} facturas verificadas</p>
        <button className="bigexp" onClick={() => { exportXlsx(); }}>⬇ Exportar Excel</button>
        <button className="donesec" onClick={() => setShowDone(false)}>Seguir</button>
      </div></div>}
    </>
  )
}

function Modal({ it, marks, rotOf, onClose, onRotate, Fields, mark }) {
  const [z, setZ] = useState(1)
  return (<div className="modal">
    <button className="mclose" onClick={onClose}>✕</button>
    <div className="mimg"><img src={it.img} style={{ transform: `rotate(${rotOf(it, marks)}deg) scale(${z})` }} alt="" /></div>
    <div className="mside">
      <div className="mtools"><button onClick={() => setZ(z * 1.25)}>＋ zoom</button><button onClick={() => setZ(z * .8)}>－</button><button onClick={() => onRotate(it.id)}>⟳ girar</button></div>
      <Fields it={it} />
      <div className="acts"><button className="v" onClick={() => mark(it.id, 'ver')}>✓ Verificado</button><button className="r" onClick={() => mark(it.id, 'rev')}>⚑ A revisar</button></div>
    </div>
  </div>)
}

function ReviewMode({ items, marks, setReview, mark, update, rotate, Fields, exportXlsx }) {
  const [idx, setIdx] = useState(0)
  const [done, setDone] = useState(false)
  const imgRef = useRef(null), vpRef = useRef(null), toastRef = useRef(null), stampRef = useRef(null)
  const tf = useRef({ tx: 0, ty: 0, sc: 1, rot: 0, fit: 1 })
  const startRef = useRef(null)
  const it = items[idx]
  const t0 = useRef(Date.now()), [clock, setClock] = useState('00:00'), countRef = useRef(0)

  useEffect(() => { const i = setInterval(() => setClock(fmtT(Date.now() - t0.current)), 500); return () => clearInterval(i) }, [])
  const apply = () => { const t = tf.current; if (imgRef.current) imgRef.current.style.transform = `translate(-50%,-50%) translate(${t.tx}px,${t.ty}px) rotate(${t.rot}deg) scale(${t.sc})` }
  const fit = () => { const im = imgRef.current, vp = vpRef.current; if (!im || !im.naturalWidth) return; const s = (Math.min(vp.clientWidth / im.naturalWidth, vp.clientHeight / im.naturalHeight) || 1) * .95; tf.current = { ...tf.current, tx: 0, ty: 0, sc: s, fit: s }; apply() }
  const setStamp = () => { const st = marks[it.id]?.status; if (stampRef.current) { stampRef.current.className = 'vpstamp' + (st === 'ver' ? ' ver' : st === 'rev' ? ' rev' : ''); stampRef.current.textContent = st === 'ver' ? '✓ VERIFICADA' : st === 'rev' ? '⚑ PENDIENTE' : '' } }
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
    setTimeout(() => { el.style.opacity = 0; el.style.transform = 'translate(-50%,-50%) scale(.5)'; next() }, 420)
  }
  // gestos
  useEffect(() => {
    const vp = vpRef.current; if (!vp) return
    let mode = null, sx = 0, sy = 0, bx = 0, by = 0, sdx = 0, dragging = false
    const swipe = dx => { const im = imgRef.current; im.style.transition = 'none'; const t = tf.current; im.style.transform = `translate(-50%,-50%) translate(${t.tx + dx}px,${t.ty}px) rotate(${t.rot + dx * 0.03}deg) scale(${t.sc})`; const h = startRef.current; const k = Math.max(-1, Math.min(1, dx / 150)); h.textContent = dx > 0 ? '✓' : '⚑'; h.style.color = dx > 0 ? '#22c55e' : '#f59e0b'; h.style.opacity = Math.abs(k); h.style.left = dx < 0 ? '30px' : 'auto'; h.style.right = dx > 0 ? '30px' : 'auto' }
    const clear = () => { const im = imgRef.current; im.style.transition = 'transform .2s'; apply(); startRef.current.style.opacity = 0; setTimeout(() => { im.style.transition = 'none' }, 210) }
    const fly = dir => { const im = imgRef.current; im.style.transition = 'transform .25s'; const t = tf.current; im.style.transform = `translate(-50%,-50%) translate(${dir * window.innerWidth}px,${t.ty}px) rotate(${dir * 18}deg) scale(${t.sc})`; startRef.current.style.opacity = 0; setTimeout(() => { im.style.transition = 'none'; doMark(dir > 0 ? 'ver' : 'rev', true) }, 230) }
    const down = e => { if (e.target.closest('.vpctrl')) return; mode = tf.current.sc <= tf.current.fit * 1.18 ? 'swipe' : 'pan'; sx = e.clientX; sy = e.clientY; bx = tf.current.tx; by = tf.current.ty; sdx = 0; dragging = true; vp.classList.add('drag'); try { vp.setPointerCapture(e.pointerId) } catch (_) {}; e.preventDefault() }
    const move = e => { if (!dragging) return; const dx = e.clientX - sx, dy = e.clientY - sy; if (mode === 'pan') { tf.current.tx = bx + dx; tf.current.ty = by + dy; apply() } else { sdx = dx; swipe(dx) } }
    const up = () => { if (!dragging) return; dragging = false; vp.classList.remove('drag'); if (mode === 'swipe') { const TH = Math.min(150, vp.clientWidth * 0.26); if (sdx > TH) fly(1); else if (sdx < -TH) fly(-1); else clear() } mode = null }
    const wheel = e => { e.preventDefault(); zoom(e.deltaY < 0 ? 1.12 : 0.89) }
    vp.addEventListener('pointerdown', down); vp.addEventListener('pointermove', move); vp.addEventListener('pointerup', up); vp.addEventListener('pointercancel', up); vp.addEventListener('wheel', wheel, { passive: false })
    return () => { vp.removeEventListener('pointerdown', down); vp.removeEventListener('pointermove', move); vp.removeEventListener('pointerup', up); vp.removeEventListener('pointercancel', up); vp.removeEventListener('wheel', wheel) }
  }, [idx])
  useEffect(() => {
    const h = e => { if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return; if (e.key === 'ArrowRight') next(); else if (e.key === 'ArrowLeft') prev(); else if (e.key === 'v' || e.key === 'V') doMark('ver'); else if (e.key === 'p' || e.key === 'P') doMark('rev'); else if (e.key === 'Escape') setReview(null); else if (e.key === '+' || e.key === '=') zoom(1.2); else if (e.key === '-') zoom(.8) }
    window.addEventListener('keydown', h); return () => window.removeEventListener('keydown', h)
  }, [idx])

  if (done) {
    let ver = 0, rev = 0, pen = 0; items.forEach(x => { const s = marks[x.id]?.status; if (s === 'ver') ver++; else if (s === 'rev') rev++; else pen++ })
    const ms = Date.now() - t0.current
    return (<div className="rv"><div className="rvhead"><span className="cnt">Revisión completada</span><span style={{ flex: 1 }} /><button onClick={() => setReview(null)}>✕ Salir</button></div>
      <div className="rvbody"><div className="vp" /><div className="rvside">
        <h2>✓ Revisión completada</h2>
        <div className="row"><span>Verificadas</span><b style={{ color: '#16a34a' }}>{ver}</b></div>
        <div className="row"><span>Pendientes / a revisar</span><b style={{ color: '#b45309' }}>{rev}</b></div>
        <div className="row"><span>Sin marcar</span><b>{pen}</b></div>
        <div className="row"><span>⏱ Tiempo</span><b>{fmtT(ms)} (≈ {Math.round(ms / 1000 / Math.max(1, items.length))} s/factura)</b></div>
        <div className="bigbtns"><button className="bv" onClick={exportXlsx}>⬇ Exportar Excel</button><button className="bp" style={{ background: '#475569' }} onClick={() => setReview(null)}>Salir</button></div>
        <div style={{ marginTop: 10 }}><button onClick={() => { setIdx(0); setDone(false) }} style={{ border: '1px solid #cbd5e1', background: '#fff', borderRadius: 8, padding: '8px 12px', cursor: 'pointer' }}>↺ Volver a empezar</button></div>
      </div></div></div>)
  }

  return (<div className="rv">
    <div className="rvhead">
      <span className="cnt">{idx + 1} / {items.length}</span><span className="clock">⏱ {clock}{countRef.current ? ` · ${countRef.current} rev` : ''}</span>
      <span style={{ flex: 1 }} />
      <button onClick={prev}>◀ Anterior</button><button onClick={next}>Siguiente ▶</button><button onClick={() => setReview(null)}>✕ Salir</button>
    </div>
    <div className="rvbody">
      <div className="vp" ref={vpRef}>
        <img ref={imgRef} draggable="false" alt="" />
        <div className="vpctrl" onMouseDown={e => e.stopPropagation()}>
          <button onClick={() => zoom(1.3)}>＋</button><button onClick={() => zoom(.77)}>－</button>
          <button onClick={rot90}>⟳</button><button onClick={fit}>⤢</button>
        </div>
        <div className="vpstamp" ref={stampRef} />
        <div className="swhint" ref={startRef} />
        <div className="rvhint">Desliza ▶ verificar · ◀ pendiente · con zoom, arrastra para mover</div>
      </div>
      <div className="rvside">
        <Fields it={it} />
        <div className="bigbtns markbtns"><button className="bv" onClick={() => doMark('ver')}>✓ Verificado (V)</button><button className="bp" onClick={() => doMark('rev')}>⚑ Pendiente (P)</button></div>
      </div>
    </div>
  </div>)
}
