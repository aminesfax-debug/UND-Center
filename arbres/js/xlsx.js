'use strict';
/* Export / import Excel (.xlsx) de la liste des arbres — sans bibliothèque externe.
   Écriture : zip « stocké » + XML minimal. Lecture : zip + inflate natif (DecompressionStream) + DOMParser. */

// ───────── ZIP ─────────
const CRC_T = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
const crc32 = b => { let c = 0xFFFFFFFF; for (let i = 0; i < b.length; i++) c = CRC_T[(c ^ b[i]) & 255] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; };
function zipStore(files) { // files: [{name, data: Uint8Array}]
  const enc = new TextEncoder(), parts = [], central = []; let off = 0;
  const u16 = n => [n & 255, (n >> 8) & 255], u32 = n => [n & 255, (n >> 8) & 255, (n >> 16) & 255, (n >>> 24) & 255];
  for (const f of files) {
    const nm = enc.encode(f.name), crc = crc32(f.data), sz = f.data.length;
    const lh = new Uint8Array([0x50, 0x4b, 3, 4, ...u16(20), ...u16(0x0800), ...u16(0), ...u16(0), ...u16(0x21), ...u32(crc), ...u32(sz), ...u32(sz), ...u16(nm.length), ...u16(0), ...nm]);
    central.push(new Uint8Array([0x50, 0x4b, 1, 2, ...u16(20), ...u16(20), ...u16(0x0800), ...u16(0), ...u16(0), ...u16(0x21), ...u32(crc), ...u32(sz), ...u32(sz), ...u16(nm.length), ...u16(0), ...u16(0), ...u16(0), ...u16(0), ...u32(0), ...u32(off), ...nm]));
    parts.push(lh, f.data); off += lh.length + sz;
  }
  const cdSize = central.reduce((s, c) => s + c.length, 0);
  const end = new Uint8Array([0x50, 0x4b, 5, 6, ...u16(0), ...u16(0), ...u16(files.length), ...u16(files.length), ...u32(cdSize), ...u32(off), ...u16(0)]);
  return new Blob([...parts, ...central, end], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}
async function unzip(buf) {
  const dv = new DataView(buf), u8 = new Uint8Array(buf), dec = new TextDecoder();
  let e = u8.length - 22; while (e >= 0 && dv.getUint32(e, true) !== 0x06054b50) e--;
  if (e < 0) throw new Error('Ce fichier n’est pas un classeur Excel (.xlsx) valide.');
  const n = dv.getUint16(e + 10, true); let p = dv.getUint32(e + 16, true); const out = {};
  for (let i = 0; i < n; i++) {
    if (dv.getUint32(p, true) !== 0x02014b50) break;
    const method = dv.getUint16(p + 10, true), csz = dv.getUint32(p + 20, true), nl = dv.getUint16(p + 28, true), el = dv.getUint16(p + 30, true), cl = dv.getUint16(p + 32, true), lo = dv.getUint32(p + 42, true);
    const name = dec.decode(u8.subarray(p + 46, p + 46 + nl)); p += 46 + nl + el + cl;
    const start = lo + 30 + dv.getUint16(lo + 26, true) + dv.getUint16(lo + 28, true);
    out[name] = { method, data: u8.subarray(start, start + csz) };
  }
  return out;
}
async function zipText(files, name) {
  const f = files[name]; if (!f) return null;
  let data = f.data;
  if (f.method === 8) data = new Uint8Array(await new Response(new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).arrayBuffer());
  else if (f.method !== 0) throw new Error('Compression du classeur non prise en charge.');
  return new TextDecoder().decode(data);
}

// ───────── Lecture d'un classeur ─────────
const colIdx = ref => { let n = 0; for (const ch of /^[A-Z]+/.exec(ref)[0]) n = n * 26 + ch.charCodeAt(0) - 64; return n - 1; };
async function readXlsx(buf) { // → { sheets: [{name, rows: [[...]]}] }
  const files = await unzip(buf), xml = s => new DOMParser().parseFromString(s, 'application/xml');
  const wb = await zipText(files, 'xl/workbook.xml'); if (!wb) throw new Error('Classeur Excel illisible (workbook.xml absent).');
  const relDoc = xml(await zipText(files, 'xl/_rels/workbook.xml.rels')), rels = {};
  [...relDoc.getElementsByTagName('Relationship')].forEach(r => { let t = r.getAttribute('Target'); rels[r.getAttribute('Id')] = t.startsWith('/') ? t.slice(1) : 'xl/' + t; });
  const shared = [], ss = await zipText(files, 'xl/sharedStrings.xml');
  if (ss) [...xml(ss).getElementsByTagName('si')].forEach(si => shared.push([...si.getElementsByTagName('t')].filter(t => t.parentNode.nodeName !== 'rPh').map(t => t.textContent).join('')));
  const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships', sheets = [];
  for (const s of [...xml(wb).getElementsByTagName('sheet')]) {
    const path = rels[s.getAttributeNS(R, 'id') || s.getAttribute('r:id')], sx = path && await zipText(files, path); if (!sx) continue;
    const rows = [];
    [...xml(sx).getElementsByTagName('row')].forEach(row => {
      const r = [];
      [...row.getElementsByTagName('c')].forEach(c => {
        const t = c.getAttribute('t'); let v = null;
        if (t === 'inlineStr') v = [...c.getElementsByTagName('t')].map(x => x.textContent).join('');
        else { const ve = c.getElementsByTagName('v')[0]; if (ve && ve.textContent !== '') { const raw = ve.textContent; v = t === 's' ? shared[+raw] : t === 'b' ? raw === '1' : t === 'str' || t === 'e' ? raw : Number(raw); } }
        r[colIdx(c.getAttribute('r'))] = v;
      });
      rows[+row.getAttribute('r') - 1] = r;
    });
    sheets.push({ name: s.getAttribute('name'), rows: Array.from(rows, r => (r ? Array.from(r, v => (v === undefined ? null : v)) : [])) });
  }
  return { sheets };
}

// ───────── Écriture d'un classeur ─────────
const xe = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '');
const colName = i => { let s = ''; for (i++; i > 0; i = Math.floor((i - 1) / 26)) s = String.fromCharCode(65 + (i - 1) % 26) + s; return s; };
function sheetXml(rows, o = {}) { // rows: [[valeur|{v,s}]]
  const cell = (v, r, c) => {
    let s = 0; if (v && typeof v === 'object') { s = v.s || 0; v = v.v; }
    const ref = colName(c) + (r + 1), st = s ? ` s="${s}"` : '';
    if (v == null || v === '') return s ? `<c r="${ref}"${st}/>` : '';
    if (typeof v === 'number' && isFinite(v)) return `<c r="${ref}"${st}><v>${v}</v></c>`;
    return `<c r="${ref}"${st} t="inlineStr"><is><t xml:space="preserve">${xe(v)}</t></is></c>`;
  };
  const body = rows.map((row, r) => `<row r="${r + 1}">${row.map((v, c) => cell(v, r, c)).join('')}</row>`).join('');
  const nc = Math.max(...rows.map(r => r.length)), last = colName(nc - 1) + rows.length;
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><dimension ref="A1:${last}"/>`
    + `<sheetViews><sheetView workbookViewId="0"${o.first ? ' tabSelected="1"' : ''}>${o.freeze ? '<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/>' : ''}</sheetView></sheetViews><sheetFormatPr defaultRowHeight="15"/>`
    + (o.widths ? `<cols>${o.widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('')}</cols>` : '')
    + `<sheetData>${body}</sheetData>${o.filter ? `<autoFilter ref="A1:${last}"/>` : ''}`
    + (o.validations ? `<dataValidations count="${o.validations.length}">${o.validations.map(v => `<dataValidation type="list" allowBlank="1" showErrorMessage="1" errorTitle="Valeur non reconnue" error="Choisissez une valeur de la liste." sqref="${v.sqref}"><formula1>"${xe(v.list.join(','))}"</formula1></dataValidation>`).join('')}</dataValidations>` : '')
    + `</worksheet>`;
}
function buildXlsx(sheets) { // sheets: [{name, rows, opts}]
  const enc = new TextEncoder(), f = (name, text) => ({ name, data: enc.encode(text) });
  const styles = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">`
    + `<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font></fonts>`
    + `<fills count="4"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF2F7D4F"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFE9ECEA"/></patternFill></fill></fills>`
    + `<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>`
    + `<cellXfs count="4"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"><alignment vertical="center" wrapText="1"/></xf><xf numFmtId="0" fontId="0" fillId="3" borderId="0" xfId="0" applyFill="1"/><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment wrapText="1" vertical="top"/></xf></cellXfs>`
    + `<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;
  const ct = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${sheets.map((s, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}</Types>`;
  const wb = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><bookViews><workbookView/></bookViews><sheets>${sheets.map((s, i) => `<sheet name="${xe(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets></workbook>`;
  const wbRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((s, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`;
  const root = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`;
  return zipStore([f('[Content_Types].xml', ct), f('_rels/.rels', root), f('xl/workbook.xml', wb), f('xl/_rels/workbook.xml.rels', wbRels), f('xl/styles.xml', styles), ...sheets.map((s, i) => f(`xl/worksheets/sheet${i + 1}.xml`, sheetXml(s.rows, { ...s.opts, first: i === 0 })))]);
}

// ───────── Liste des arbres ↔ Excel ─────────
const TREE_COLS = [
  ['ID (ne pas modifier)', 'id', 24], ['Nom', 'name', 26], ['Type', 'type', 16], ['Variété', 'variety', 18], ['Année de plantation', 'year', 12], ['Zone', 'zone', 16],
  ['Rangée', 'row', 10], ['N° dans la rangée', 'pos', 10], ['Santé', 'status', 16], ['Latitude', 'lat', 13], ['Longitude', 'lng', 13],
  ['Arrosage été (jours)', 'summerDays', 11], ['Arrosage hors été (jours)', 'winterDays', 12], ['Litres par arrosage', 'litres', 11], ['Notes', 'notes', 40]
];
const hkey = s => norm(String(s || '')).replace(/[^a-z0-9]+/g, ' ').trim();
const STATUS_LABELS = () => Object.fromEntries(Object.entries(STATUS).map(([k, v]) => [k, v[0]]));
function treeRow(t) {
  const sl = STATUS_LABELS(), i = t.irrig || {};
  return { id: t.id, name: t.name, type: t.type, variety: t.variety || '', year: t.year || '', zone: t.zone || '', row: t.row || '', pos: t.pos || '', status: sl[t.status] || sl.bon,
    lat: t.lat ?? '', lng: t.lng ?? '', summerDays: i.summerDays ?? '', winterDays: i.winterDays ?? '', litres: i.litres ?? '', notes: t.notes || '' };
}
function exportTreesXlsx() {
  const trees = [...S.trees].sort((a, b) => a.type.localeCompare(b.type, 'fr') || (a.row || '￿').localeCompare(b.row || '￿', 'fr', { numeric: true }) || (a.pos || 1e9) - (b.pos || 1e9) || a.name.localeCompare(b.name, 'fr', { numeric: true }));
  const head = TREE_COLS.map(([h]) => ({ v: h, s: 1 }));
  const rows = [head, ...trees.map(t => { const r = treeRow(t); return TREE_COLS.map(([, k], c) => (c === 0 ? { v: r[k], s: 2 } : r[k])); })];
  const sl = Object.values(STATUS_LABELS()), stCol = colName(TREE_COLS.findIndex(c => c[1] === 'status'));
  const help = [['Mode d’emploi'], [''],
    ['• Modifiez les cellules voulues, enregistrez le fichier en .xlsx, puis dans l’appli : Plus › Excel › Importer.'],
    ['• Ne touchez pas à la colonne « ID » : elle relie chaque ligne à son arbre.'],
    ['• Ligne SANS ID (ou ID inconnu) = nouvel arbre (Nom et Type obligatoires).'],
    ['• Une cellule vidée efface la donnée (ex. Zone). Supprimer une ligne NE supprime PAS l’arbre dans l’appli.'],
    ['• Santé : ' + sl.join(' / ') + '.'],
    ['• Rangée + N° dans la rangée : ordre des arbres le long de la rangée (nécessaire pour l’alignement sur le plan).'],
    ['• Latitude et Longitude en degrés décimaux (ex. 34.7406 et 10.7603), les deux ou aucune.'],
    ['• Arrosage : nombre de jours entre deux arrosages (0 = pas d’arrosage) ; Litres par arrosage.'],
    ['• Avant l’import, l’appli vous montre toutes les modifications et vous demande confirmation ; vous pourrez annuler.'],
    [''], ['Exporté le ' + fmtDate(todayISO()) + ' — ' + trees.length + ' arbre(s).']].map((r, i) => [{ v: r[0], s: i === 0 ? 1 : 3 }]);
  const blob = buildXlsx([
    { name: 'Arbres', rows, opts: { freeze: true, filter: true, widths: TREE_COLS.map(c => c[2]), validations: [{ sqref: `${stCol}2:${stCol}2000`, list: sl }] } },
    { name: 'Aide', rows: help, opts: { widths: [110] } }]);
  const name = `arbres-${todayISO()}.xlsx`;
  if (typeof download === 'function') download(blob, name);
  return { blob, name, n: trees.length };
}

// Import : analyse → aperçu des changements → application (annulable)
let IMPORT_UNDO = null;
const FIELD_LABEL = { name: 'Nom', type: 'Type', variety: 'Variété', year: 'Année', zone: 'Zone', row: 'Rangée', pos: 'N° rangée', status: 'Santé', lat: 'Latitude', lng: 'Longitude', summerDays: 'Arrosage été', winterDays: 'Arrosage hors été', litres: 'Litres', notes: 'Notes' };
const cellStr = v => (v == null ? '' : typeof v === 'number' ? String(Math.round(v * 1e9) / 1e9) : String(v).trim());
function parseTreesSheet(sheet) {
  const rows = sheet.rows; let h = rows.findIndex(r => r && r.some(v => v != null && hkey(v) === 'nom') && r.some(v => v != null && hkey(v) === 'type'));
  if (h < 0) throw new Error('Colonnes « Nom » et « Type » introuvables : utilisez le fichier exporté par l’appli.');
  const idx = {}; rows[h].forEach((v, c) => { const k = hkey(v); const col = TREE_COLS.find(([name]) => hkey(name) === k || (k.startsWith('id ') && name.startsWith('ID'))); if (col && idx[col[1]] == null) idx[col[1]] = c; });
  const stByLabel = {}; Object.entries(STATUS).forEach(([k, v]) => { stByLabel[hkey(v[0])] = k; stByLabel[hkey(k)] = k; });
  const out = { updates: [], news: [], same: 0, errors: [] };
  for (let r = h + 1; r < rows.length; r++) {
    const row = rows[r] || [], get = k => (idx[k] == null ? undefined : (row[idx[k]] ?? null)); // colonne présente mais cellule vide/absente = null (donc « vider » efface la donnée)
    if (!row.some(v => v != null && String(v).trim() !== '')) continue;
    const xl = r + 1, err = m => out.errors.push(`Ligne ${xl} : ${m}`);
    const vals = {}; let bad = false;
    const num = (k, min, max, int) => { const raw = get(k); if (raw === undefined) return; const s = cellStr(raw); if (s === '') { vals[k] = null; return; } const n = Number(String(s).replace(',', '.')); if (!isFinite(n) || n < min || n > max || (int && !Number.isInteger(n))) { err(`« ${FIELD_LABEL[k]} » invalide (${s})`); bad = true; } else vals[k] = n; };
    ['name', 'type', 'variety', 'zone', 'row', 'notes'].forEach(k => { const raw = get(k); if (raw !== undefined) vals[k] = cellStr(raw); });
    num('year', 1800, 2200, true); num('pos', 1, 100000, true); num('lat', -90, 90); num('lng', -180, 180); num('summerDays', 0, 365, true); num('winterDays', 0, 365, true); num('litres', 0, 100000);
    if (get('status') !== undefined) { const s = cellStr(get('status')); if (s === '') vals.status = 'bon'; else if (stByLabel[hkey(s)]) vals.status = stByLabel[hkey(s)]; else { err(`Santé inconnue (« ${s} »)`); bad = true; } }
    if ('lat' in vals && 'lng' in vals && ((vals.lat == null) !== (vals.lng == null))) { err('Latitude et longitude doivent être renseignées ensemble'); bad = true; }
    if (vals.pos != null && !(vals.row)) { err('« N° dans la rangée » sans « Rangée »'); bad = true; }
    const id = cellStr(get('id')), t = id && treeById(id);
    if (!t) { // nouvel arbre
      if (!vals.name || !vals.type) { err('nouvel arbre : Nom et Type obligatoires'); bad = true; }
      if (bad) continue; out.news.push({ xl, vals }); continue;
    }
    if (vals.name === '' || vals.type === '') { err('Nom et Type ne peuvent pas être vides'); bad = true; }
    if (bad) continue;
    const cur = treeRow(t), ch = [];
    for (const [k, v] of Object.entries(vals)) {
      const a = cur[k] === '' || cur[k] == null ? null : cur[k], b = v === '' || v == null ? null : v;
      if (k === 'status' ? t.status !== v : String(a ?? '') !== String(b ?? '')) ch.push({ k, from: a, to: b });
    }
    if (!ch.length) out.same++; else out.updates.push({ xl, t, ch });
  }
  return out;
}
const showV = (k, v) => (v == null || v === '' ? '∅' : k === 'status' ? (STATUS[v] ? STATUS[v][0] : v) : String(v));
function applyVals(t, vals) {
  for (const [k, v] of Object.entries(vals)) {
    if (['summerDays', 'winterDays', 'litres'].includes(k)) { t.irrig = t.irrig || {}; t.irrig[k] = v == null ? 0 : v; }
    else if (k === 'status') t.status = v;
    else if (k === 'year' || k === 'pos') t[k] = v == null ? null : v;
    else if (k === 'lat' || k === 'lng') t[k] = v == null ? null : v;
    else t[k] = v == null ? '' : v;
  }
  if (!t.row) t.pos = null;
}
async function importTreesXlsx(file) {
  const wb = await readXlsx(await file.arrayBuffer()), sheet = wb.sheets.find(s => hkey(s.name) === 'arbres') || wb.sheets[0];
  if (!sheet) throw new Error('Classeur vide.');
  const r = parseTreesSheet(sheet);
  if (!r.updates.length && !r.news.length) { if (r.errors.length) showImportReport(r); else toast('Aucune modification dans ce fichier.'); return; }
  const lines = [...r.updates.slice(0, 40).map(u => `<div class="small" style="margin-bottom:6px"><b>${esc(u.t.name)}</b> <span class="muted">(ligne ${u.xl})</span><br>${u.ch.map(c => `${esc(FIELD_LABEL[c.k])} : <span class="muted">${esc(showV(c.k, c.from))}</span> → <b>${esc(showV(c.k, c.to))}</b>`).join('<br>')}</div>`),
    r.updates.length > 40 ? `<div class="small muted">… et ${r.updates.length - 40} autre(s) arbre(s) modifié(s)</div>` : ''].join('');
  showImportPreview(r, lines);
}
function showImportReport(r) { sheet('Import Excel — problèmes', `<div class="banner danger">${r.errors.slice(0, 15).map(esc).join('<br>')}${r.errors.length > 15 ? `<br>… (${r.errors.length - 15} autres)` : ''}</div>`); }
function showImportPreview(r, lines) {
  sheet('Import Excel — aperçu', `<div class="stats" style="grid-template-columns:repeat(3,1fr)"><div class="stat"><b>${r.updates.length}</b><span>modifié(s)</span></div><div class="stat"><b>${r.news.length}</b><span>nouveau(x)</span></div><div class="stat"><b>${r.same}</b><span>inchangé(s)</span></div></div>
    ${r.errors.length ? `<div class="banner danger"><b>${r.errors.length} ligne(s) ignorée(s) :</b><br>${r.errors.slice(0, 8).map(esc).join('<br>')}${r.errors.length > 8 ? `<br>… (${r.errors.length - 8} autres)` : ''}</div>` : ''}
    ${r.news.length ? `<p class="small"><b>Nouveaux arbres :</b> ${r.news.slice(0, 12).map(n => esc(n.vals.name)).join(', ')}${r.news.length > 12 ? '…' : ''}</p><label class="f" style="color:var(--text)"><input type="checkbox" name="plan" checked style="width:auto"> Générer le plan annuel type pour les nouveaux arbres</label>` : ''}
    <h3>Modifications</h3>${lines || '<span class="muted">Aucune.</span>'}
    <p class="small muted">Aucun arbre n’est supprimé par l’import. Vous pourrez annuler juste après.</p>`, {
    submitLabel: `Appliquer (${r.updates.length + r.news.length})`,
    onSubmit: fd => {
      const undo = { before: [], created: [], tasks: [] };
      r.updates.forEach(u => { undo.before.push(JSON.parse(JSON.stringify(u.t))); const vals = {}; u.ch.forEach(c => (vals[c.k] = c.to)); applyVals(u.t, vals); });
      const t0 = new Set(S.tasks.map(x => x.id));
      r.news.forEach(n => {
        const t = { id: uid(), createdAt: todayISO(), name: '', type: '', variety: '', status: 'bon', irrig: { summerDays: 7, winterDays: 0, litres: 20 }, notes: '' };
        applyVals(t, n.vals); if (!t.year) t.year = null; S.trees.push(t); undo.created.push(t.id);
        if (fd.get('plan')) ensurePlan(t);
      });
      undo.tasks = S.tasks.filter(x => !t0.has(x.id)).map(x => x.id);
      IMPORT_UNDO = undo; save(); render(); toast(`Import terminé : ${r.updates.length} modifié(s), ${r.news.length} nouveau(x)`);
    }
  });
}
function undoImport() {
  const u = IMPORT_UNDO; if (!u) return;
  if (!confirm('Annuler le dernier import Excel ?')) return;
  u.before.forEach(b => { const i = S.trees.findIndex(t => t.id === b.id); if (i >= 0) S.trees[i] = b; });
  S.tasks = S.tasks.filter(t => !u.tasks.includes(t.id)); S.trees = S.trees.filter(t => !u.created.includes(t.id));
  IMPORT_UNDO = null; save(); render(); toast('Import annulé');
}
Object.assign(actions, {
  xlsxExport: () => { try { const r = exportTreesXlsx(); toast(`${r.n} arbre(s) exportés`); } catch (e) { toast('Export impossible : ' + e.message); } },
  xlsxUndo: undoImport
});
document.addEventListener('change', e => {
  if (e.target.id !== 'xlsimp' || !e.target.files[0]) return;
  const f = e.target.files[0]; e.target.value = '';
  importTreesXlsx(f).catch(err => { console.error(err); toast('Import impossible : ' + err.message); });
});
