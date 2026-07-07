// Generador de .xlsx real sin librerías (ZIP store + CRC32) y utilidades de tabla.
const escA = s => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')
const CRCT = (() => { let t = []; for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0 } return t })()
function crc32(u8) { let c = 0xFFFFFFFF; for (let i = 0; i < u8.length; i++) c = CRCT[(c ^ u8[i]) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0 }
const enc = s => new TextEncoder().encode(s)
function zipStore(files) {
  const u16 = n => [n & 255, (n >> 8) & 255], u32 = n => [n & 255, (n >> 8) & 255, (n >> 16) & 255, (n >> 24) & 255]
  let parts = [], cen = [], off = 0
  files.forEach(f => {
    const nm = enc(f.name), dt = f.data, crc = crc32(dt)
    const lh = [].concat([80, 75, 3, 4], u16(20), u16(0), u16(0), u16(0), u16(0), u32(crc), u32(dt.length), u32(dt.length), u16(nm.length), u16(0))
    parts.push(new Uint8Array(lh), nm, dt)
    cen.push([].concat([80, 75, 1, 2], u16(20), u16(20), u16(0), u16(0), u16(0), u16(0), u32(crc), u32(dt.length), u32(dt.length), u16(nm.length), u16(0), u16(0), u16(0), u16(0), u32(0), u32(off)), nm)
    off += lh.length + nm.length + dt.length
  })
  let cstart = off, clen = 0, cparts = []
  cen.forEach(x => { const a = Array.isArray(x) ? new Uint8Array(x) : x; cparts.push(a); clen += a.length })
  const end = new Uint8Array([].concat([80, 75, 5, 6], u16(0), u16(0), u16(cen.length / 2), u16(cen.length / 2), u32(clen), u32(cstart), u16(0)))
  let all = parts.concat(cparts, [end]), tot = 0; all.forEach(a => tot += a.length)
  const out = new Uint8Array(tot); let p = 0; all.forEach(a => { out.set(a, p); p += a.length }); return out
}
function colL(i) { let s = ''; i++; while (i) { let m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = (i - m - 1) / 26 } return s }
const cT = (r, c, v, s) => `<c r="${colL(c)}${r}" t="inlineStr"${s ? ` s="${s}"` : ''}><is><t xml:space="preserve">${escA(v)}</t></is></c>`
const cN = (r, c, v, s) => `<c r="${colL(c)}${r}"${s ? ` s="${s}"` : ''}><v>${Number(v).toFixed(2)}</v></c>`
const cR = (r, c, v, s) => `<c r="${colL(c)}${r}"${s ? ` s="${s}"` : ''}><v>${Number(v)}</v></c>`   // número en crudo (para %)

// Hoja de estilos compartida.
// cellXfs: 0 normal · 1 cabecera(azul,blanco,center) · 2 euro · 3 ámbar · 4 euro-ámbar
//          5 total(azul claro,negrita) · 6 euro-total · 7 normal · 8 título(azul,blanco,grande,center)
//          9 % · 10 %-ámbar
const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts count="1"><numFmt numFmtId="164" formatCode="#,##0.00\\ &quot;€&quot;"/></numFmts><fonts count="4"><font><sz val="11"/><name val="Calibri"/></font><font><b/><color rgb="FFFFFFFF"/><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font><font><b/><color rgb="FFFFFFFF"/><sz val="14"/><name val="Calibri"/></font></fonts><fills count="5"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF1F4E78"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFFFD24D"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFDCE6F1"/></patternFill></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf/></cellStyleXfs><cellXfs count="11"><xf/><xf fontId="1" fillId="2" applyFont="1" applyFill="1" applyAlignment="1"><alignment horizontal="center"/></xf><xf numFmtId="164" applyNumberFormat="1"/><xf fillId="3" applyFill="1"/><xf numFmtId="164" fillId="3" applyNumberFormat="1" applyFill="1"/><xf fontId="2" fillId="4" applyFont="1" applyFill="1"/><xf numFmtId="164" fontId="2" fillId="4" applyNumberFormat="1" applyFont="1" applyFill="1"/><xf/><xf fontId="3" fillId="2" applyFont="1" applyFill="1" applyAlignment="1"><alignment horizontal="center"/></xf><xf numFmtId="10" applyNumberFormat="1"/><xf numFmtId="10" fillId="3" applyNumberFormat="1" applyFill="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`

function pack(sheetXml, sheetName) {
  const ct = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`
  const rels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`
  const wb = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${escA(sheetName)}" sheetId="1" r:id="rId1"/></sheets></workbook>`
  const wbr = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`
  const files = [
    { name: '[Content_Types].xml', data: enc(ct) }, { name: '_rels/.rels', data: enc(rels) },
    { name: 'xl/workbook.xml', data: enc(wb) }, { name: 'xl/_rels/workbook.xml.rels', data: enc(wbr) },
    { name: 'xl/styles.xml', data: enc(STYLES) }, { name: 'xl/worksheets/sheet1.xml', data: enc(sheetXml) }
  ]
  return new Blob([zipStore(files)], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
}

const yearOf = rows => {
  const ys = rows.map(d => (String(d.fecha || '').match(/(\d{4})/) || [])[1]).filter(Boolean)
  if (!ys.length) return String(new Date().getFullYear())
  return ys.slice().sort((a, b) => ys.filter(y => y === b).length - ys.filter(y => y === a).length)[0]
}
const pctVal = v => (v == null || v === '') ? null : Number(String(v).replace(',', '.')) / 100

// ---- Hoja de CLIENTES (formato con título + cabecera azul) ----
function buildClientes(rows, opts) {
  const emp = (opts.empresa || '').toString().toUpperCase()
  const hdr = ['Factura', 'Fecha', 'Código', 'Nombre', 'Base imponible', '% IVA', 'IVA', 'Total', 'Comentarios']
  const N = hdr.length
  let sd = `<row r="1">` + cT(1, 0, `CLIENTES ${emp} ${yearOf(rows)}`.trim(), 8) + Array.from({ length: N - 1 }, (_, i) => cT(1, i + 1, '', 8)).join('') + `</row>`
  sd += `<row r="2">` + hdr.map((h, c) => cT(2, c, h, 1)).join('') + `</row>`
  let r = 3, tb = 0, ti = 0, tt = 0
  rows.forEach(d => {
    const st = d.amber ? 3 : 7, se = d.amber ? 4 : 2, sp = d.amber ? 10 : 9
    tb += +d.base || 0; ti += +d.iva || 0; tt += +d.total || 0
    const p = pctVal(d.iva_pct)
    sd += `<row r="${r}">` + cT(r, 0, d.num || '', st) + cT(r, 1, d.fecha || '', st) + cT(r, 2, d.codigo || '', st) + cT(r, 3, d.proveedor || '', st) +
      cN(r, 4, d.base, se) + (p == null ? cT(r, 5, '', st) : cR(r, 5, p, sp)) + cN(r, 6, d.iva, se) + cN(r, 7, d.total, se) + cT(r, 8, d.obs || '', st) + `</row>`; r++
  })
  sd += `<row r="${r}">` + cT(r, 0, '', 5) + cT(r, 1, '', 5) + cT(r, 2, '', 5) + cT(r, 3, 'TOTAL', 5) + cN(r, 4, tb, 6) + cT(r, 5, '', 5) + cN(r, 6, ti, 6) + cN(r, 7, tt, 6) + cT(r, 8, '', 5) + `</row>`
  const cols = `<col min="1" max="1" width="9"/><col min="2" max="2" width="11"/><col min="3" max="3" width="11"/><col min="4" max="4" width="42"/><col min="5" max="5" width="13"/><col min="6" max="6" width="8"/><col min="7" max="8" width="11"/><col min="9" max="9" width="42"/>`
  const sheet = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><cols>${cols}</cols><sheetData>${sd}</sheetData><mergeCells count="1"><mergeCell ref="A1:${colL(N - 1)}1"/></mergeCells></worksheet>`
  return pack(sheet, 'CLIENTES')
}

// ---- Hoja de PROVEEDORES (formato original) ----
function buildProveedores(rows) {
  const hdr = ['F.Factura', 'Proveedor', 'Nº Factura', 'Importe', 'IVA', 'Total', 'Estado', 'Observaciones']
  let sd = `<row r="1">` + hdr.map((h, c) => cT(1, c, h, 1)).join('') + `</row>`, r = 2, tb = 0, ti = 0, tt = 0
  rows.forEach(d => {
    const st = d.amber ? 3 : 7, se = d.amber ? 4 : 2
    tb += +d.base; ti += +d.iva; tt += +d.total
    sd += `<row r="${r}">` + cT(r, 0, d.fecha, st) + cT(r, 1, d.proveedor, st) + cT(r, 2, d.num, st) +
      cN(r, 3, d.base, se) + cN(r, 4, d.iva, se) + cN(r, 5, d.total, se) + cT(r, 6, d.estado, st) + cT(r, 7, d.obs, st) + `</row>`; r++
  })
  sd += `<row r="${r}">` + cT(r, 0, '', 5) + cT(r, 1, '', 5) + cT(r, 2, 'TOTAL', 5) + cN(r, 3, tb, 6) + cN(r, 4, ti, 6) + cN(r, 5, tt, 6) + cT(r, 6, '', 5) + cT(r, 7, '', 5) + `</row>`
  const sheet = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><cols><col min="1" max="1" width="12"/><col min="2" max="2" width="34"/><col min="3" max="3" width="22"/><col min="4" max="6" width="11"/><col min="7" max="7" width="12"/><col min="8" max="8" width="50"/></cols><sheetData>${sd}</sheetData></worksheet>`
  return pack(sheet, 'Revisado')
}

// rows: [{fecha,proveedor,num,codigo,iva_pct,base,iva,total,estado,obs,amber}]
export function buildXlsx(rows, opts = {}) {
  return opts.tipo === 'clientes' ? buildClientes(rows, opts) : buildProveedores(rows)
}

export function tsvTable(rows, opts = {}) {
  if (opts.tipo === 'clientes') {
    const hdr = ['Factura', 'Fecha', 'Código', 'Nombre', 'Base imponible', '% IVA', 'IVA', 'Total', 'Comentarios']
    const lines = [hdr.join('\t')]
    rows.forEach(d => lines.push([d.num, d.fecha, d.codigo, d.proveedor, d.base, (d.iva_pct == null || d.iva_pct === '' ? '' : d.iva_pct + '%'), d.iva, d.total, (d.obs || '').replace(/\t|\n/g, ' ')].join('\t')))
    return lines.join('\n')
  }
  const hdr = ['F.Factura', 'Proveedor', 'Nº Factura', 'Importe', 'IVA', 'Total', 'Estado', 'Observaciones']
  const lines = [hdr.join('\t')]
  rows.forEach(d => lines.push([d.fecha, d.proveedor, d.num, d.base, d.iva, d.total, d.estado, (d.obs || '').replace(/\t|\n/g, ' ')].join('\t')))
  return lines.join('\n')
}
