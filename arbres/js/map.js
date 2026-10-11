'use strict';
/* Plan interactif des arbres (Leaflet embarqué, fonctionne sans réseau pour les points ;
   les fonds de carte satellite / OpenStreetMap demandent une connexion). */
const MAPUI = { rows: true, layer: 'type', base: 'sat', filter: '', edit: false, mode: null, target: null, focus: null, center: null, zoom: null };
let MAP = null, ROWS = null, MARKERS = null, BASE = null, ME = null, WATCH = null, GPS = null;

const TYPE_PALETTE = ['#2f8f4f', '#d9822b', '#7a5cc2', '#2a8fbd', '#c9484a', '#a0a830', '#c2569b', '#5b6b7b', '#8a5a2b', '#1f9e8f'];
const natCmp = (a, b) => a.name.localeCompare(b.name, 'fr', { numeric: true });
// ordre de parcours : par rangée, puis n° dans la rangée, puis nom
const walkCmp = (a, b) => (a.row || '\uffff').localeCompare(b.row || '\uffff', 'fr', { numeric: true }) || (a.pos || 1e9) - (b.pos || 1e9) || natCmp(a, b);
const hasPos = t => t.lat != null && t.lng != null && isFinite(t.lat) && isFinite(t.lng);
const typesList = () => [...new Set(S.trees.map(t => t.type))].sort();
const typeColor = type => TYPE_PALETTE[Math.max(0, typesList().indexOf(type)) % TYPE_PALETTE.length];
const unplaced = () => S.trees.filter(alive).filter(t => !hasPos(t)).sort(walkCmp);

function markerColor(t) {
  if (MAPUI.layer === 'sante') return { bon: '#2f8f4f', surveiller: '#e0a21e', malade: '#d64545', mort: '#7b8580' }[t.status] || '#7b8580';
  if (MAPUI.layer === 'eau') { const n = alive(t) ? nextWater(t) : null; return !n ? '#9aa5a0' : n.date <= todayISO() ? '#1f78d1' : '#7fbf5a'; }
  if (MAPUI.layer === 'fruits') { const f = fruitByYear(t.id)[String(new Date().getFullYear())]; return f ? LEVEL_COLORS[Math.max(...Object.values(f))] : '#c9cfcb'; }
  return typeColor(t.type);
}
function legendHTML() {
  const dot = (c, l) => `<span><i style="background:${c}"></i>${esc(l)}</span>`;
  if (MAPUI.layer === 'sante') return Object.entries(STATUS).map(([k, v]) => dot({ bon: '#2f8f4f', surveiller: '#e0a21e', malade: '#d64545', mort: '#7b8580' }[k], v[0])).join('');
  if (MAPUI.layer === 'eau') return dot('#1f78d1', 'À arroser') + dot('#7fbf5a', 'À jour') + dot('#9aa5a0', 'Pas d’arrosage prévu');
  if (MAPUI.layer === 'fruits') return LEVELS.map((n, i) => dot(LEVEL_COLORS[i], n)).join('') + dot('#c9cfcb', 'Pas de constat cette année');
  return typesList().map(t => dot(typeColor(t), t)).join('');
}

function viewPlan(focusId) {
  MAPUI.focus = focusId || null;
  const types = typesList(), sel = (k, items, cur) => `<select data-map="${k}">${items.map(([v, l]) => opt(v, l, cur)).join('')}</select>`;
  return `<div class="row" style="margin-bottom:8px"><a href="#/arbres" class="btn sm">← Liste</a><h1 style="margin:0 0 0 6px;font-size:1.25rem">🗺️ Plan</h1></div>
    <div class="row" style="gap:6px;margin-bottom:8px">${sel('layer', [['type', 'Couleur : type'], ['sante', 'Couleur : santé'], ['eau', 'Couleur : arrosage'], ['fruits', 'Couleur : fruits']], MAPUI.layer)}
      ${sel('base', [['sat', 'Satellite'], ['osm', 'Plan routier'], ['none', 'Sans fond']], MAPUI.base)}
      ${sel('filter', [['', 'Tous les types'], ...types.map(x => [x, x])], MAPUI.filter)}</div>
    <div id="map"></div>
    <div class="legend" id="maplegend">${legendHTML()}</div>
    <div id="mappanel">${panelHTML()}</div>`;
}
function panelHTML() {
  const un = unplaced(), placed = S.trees.filter(hasPos).length;
  const tgt = treeById(MAPUI.target) || un[0];
  const opts = (un.length ? un : []).concat(tgt && hasPos(tgt) ? [tgt] : []).map(t => opt(t.id, t.name + (t.row ? ` — ${t.row}${t.pos ? ' n°' + t.pos : ''}` : '') + (hasPos(t) ? ' (placé)' : ''), tgt && tgt.id)).join('');
  let h = `<div class="small muted" style="margin:4px 0 8px">${placed} arbre(s) placé(s) · <b>${un.length}</b> sans position</div>`;
  if (MAPUI.mode === 'survey' && tgt) {
    h += `<div class="card"><b>🧭 Relevé GPS</b><p class="small muted" style="margin:4px 0 8px">Placez-vous au pied de l’arbre, attendez une précision correcte, puis enregistrez.</p>
      <label class="f">Arbre à enregistrer<select data-map="target">${opts}</select></label>
      <div id="gpsinfo" class="small" style="margin-bottom:8px">${gpsText()}</div>
      <button class="btn primary block" data-act="mapRecord">📍 Enregistrer ma position pour « ${esc(tgt.name)} »</button>
      <div class="row"><button class="btn col" data-act="mapSkip">Passer</button><button class="btn col" data-act="mapStop">Terminer</button></div></div>`;
  } else if (MAPUI.mode === 'place' && tgt) {
    h += `<div class="banner" style="background:var(--accent-l);color:var(--text)">👆 Touchez la carte pour placer <b>« ${esc(tgt.name)} »</b>
      <label class="f" style="margin:8px 0 0"><select data-map="target">${opts}</select></label></div><button class="btn block" data-act="mapStop">Terminer</button>`;
  } else {
    h += `<div class="row" style="flex-wrap:wrap;gap:6px"><button class="btn sm col" data-act="mapGeo">📍 Ma position</button>
      <button class="btn sm col${MAPUI.edit ? ' primary' : ''}" data-act="mapEdit">${MAPUI.edit ? '✓ Fin déplacement' : '✋ Déplacer des arbres'}</button></div>
      <div class="row" style="flex-wrap:wrap;gap:6px;margin-top:6px"><button class="btn sm col" data-act="mapSurvey"${un.length ? '' : ' disabled'}>🧭 Relevé GPS</button>
      <button class="btn sm col" data-act="mapPlace"${un.length ? '' : ' disabled'}>👆 Placer sur la carte</button>
      <button class="btn sm col" data-act="mapRow">↔️ Aligner une rangée</button></div>
      <div class="row" style="margin-top:6px"><button class="btn sm col" data-act="mapAssign">📋 Définir une rangée</button>
      <button class="btn sm col${MAPUI.rows ? ' primary' : ''}" data-act="mapRows">〰️ Traits de rangées : ${MAPUI.rows ? 'oui' : 'non'}</button></div>
      ${MAPUI.undo ? `<div class="row" style="margin-top:6px"><button class="btn sm col" data-act="mapUndo">↩️ Annuler l’alignement de « ${esc(MAPUI.undo.row)} »</button></div>` : ''}
      <p class="small muted" style="margin:6px 0 0">Les traits relient les arbres d’une rangée dans l’ordre ; un trait <b style="color:#d64545">rouge pointillé</b> signale un écart anormal (souvent une erreur d’ordre ou un arbre mal placé).</p>
      ${MAPUI.edit ? '<p class="small muted">Maintenez et glissez un point pour corriger sa position.</p>' : ''}`;
  }
  return h;
}
function gpsText() {
  if (!GPS) return '⏳ Recherche du signal GPS… (autorisez la localisation si demandé)';
  if (GPS.err) return '⚠️ ' + esc(GPS.err);
  const c = GPS.acc <= 8 ? 'var(--accent)' : GPS.acc <= 20 ? 'var(--warn)' : 'var(--danger)';
  return `Précision : <b style="color:${c}">± ${Math.round(GPS.acc)} m</b>${GPS.acc > 20 ? ' — signal faible, attendez ou déplacez-vous à découvert' : ''}`;
}
function refreshPanel() { const p = $('#mappanel'); if (p) p.innerHTML = panelHTML(); const l = $('#maplegend'); if (l) l.innerHTML = legendHTML(); }

// Traits reliant les arbres de chaque rangée dans l'ordre : un zigzag trahit une erreur d'ordre.
// Un segment très supérieur à l'écart habituel de la rangée est tracé en rouge.
function drawRows() {
  if (!ROWS) return; ROWS.clearLayers();
  if (!MAPUI.rows) return;
  const by = {};
  S.trees.filter(t => alive(t) && t.row && t.pos && hasPos(t)).forEach(t => (by[t.row] ||= []).push(t));
  for (const [name, list] of Object.entries(by)) {
    list.sort((a, b) => a.pos - b.pos);
    const pts = list.map(t => L.latLng(t.lat, t.lng));
    const per = list.slice(1).map((t, i) => Math.max(1, t.pos - list[i].pos));
    const steps = pts.slice(1).map((p, i) => p.distanceTo(pts[i]) / per[i]), srt = [...steps].sort((x, y) => x - y), med = srt.length ? srt[Math.floor(srt.length / 2)] : 0;
    steps.forEach((g, i) => {
      const bad = steps.length >= 3 && med > 0 && g > 2.5 * med;
      L.polyline([pts[i], pts[i + 1]], { color: bad ? '#ff3b30' : '#ffe14d', weight: bad ? 3 : 2, opacity: 0.9, dashArray: bad ? '6 4' : null, interactive: false }).addTo(ROWS);
    });
    L.marker(pts[0], { icon: L.divIcon({ className: 'rowdot', html: '', iconSize: [1, 1] }), interactive: false, keyboard: false })
      .bindTooltip(esc(name), { permanent: true, direction: 'left', offset: [-6, 0], className: 'rowlbl' }).addTo(ROWS);
  }
}
function destroyMap() {
  if (WATCH != null) { navigator.geolocation.clearWatch(WATCH); WATCH = null; }
  if (MAP) { MAP.remove(); MAP = null; ROWS = null; MARKERS = null; BASE = null; ME = null; }
}
function setBase() {
  if (!MAP) return;
  if (BASE) { MAP.removeLayer(BASE); BASE = null; }
  if (MAPUI.base === 'sat') BASE = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { maxNativeZoom: 18, maxZoom: 21, attribution: 'Imagerie © Esri, Maxar, Earthstar Geographics' });
  else if (MAPUI.base === 'osm') BASE = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxNativeZoom: 19, maxZoom: 21, attribution: '© OpenStreetMap' });
  if (BASE) BASE.addTo(MAP);
}
function initMap() {
  destroyMap();
  const el = $('#map'); if (!el) return;
  if (typeof L === 'undefined') { el.innerHTML = '<div class="empty">Module de carte non chargé.</div>'; return; }
  MAP = L.map(el, { maxZoom: 21, zoomControl: true });
  setBase();
  ROWS = L.layerGroup().addTo(MAP);
  MARKERS = L.layerGroup().addTo(MAP);
  const pts = drawMarkers();
  const f = MAPUI.focus && treeById(MAPUI.focus);
  if (f && hasPos(f)) { MAP.setView([f.lat, f.lng], 20); MARKERS.eachLayer(m => { if (m._tid === f.id) m.openPopup(); }); }
  else if (MAPUI.center && MAPUI.zoom != null) MAP.setView(MAPUI.center, MAPUI.zoom);
  else if (pts.length) MAP.fitBounds(pts, { padding: [30, 30], maxZoom: 19 });
  else { MAP.setView([34.0, 9.0], 6); locate(true); }
  MAPUI.focus = null;
  el.classList.toggle('z19', MAP.getZoom() >= 19);
  MAP.on('moveend', () => { MAPUI.center = MAP.getCenter(); MAPUI.zoom = MAP.getZoom(); el.classList.toggle('z19', MAP.getZoom() >= 19); });
  MAP.on('click', e => { if (MAPUI.mode === 'place') placeTree(e.latlng.lat, e.latlng.lng); });
  if (GPS) drawMe();
  if (MAPUI.mode === 'survey') startWatch();
}
function drawMarkers() {
  if (!MARKERS) return [];
  MARKERS.clearLayers(); const pts = [];
  S.trees.filter(hasPos).filter(t => !MAPUI.filter || t.type === MAPUI.filter).forEach(t => {
    const icon = L.divIcon({ className: 'tm', html: `<i style="background:${markerColor(t)}"></i>`, iconSize: [18, 18] });
    const m = L.marker([t.lat, t.lng], { icon, draggable: MAPUI.edit, keyboard: false, title: t.name });
    m._tid = t.id;
    m.bindTooltip(esc(t.name), { permanent: true, direction: 'top', offset: [0, -8], className: 'lbl' });
    const a = age(t);
    m.bindPopup(`<b>${esc(t.name)}</b><br>${esc(treeFull(t))}${a != null ? ' · ' + a + ' an' + (a > 1 ? 's' : '') : ''}<br><span class="small">${t.status !== 'bon' ? esc(STATUS[t.status][0]) + ' · ' : ''}${t.gpsAcc ? 'GPS ± ' + t.gpsAcc + ' m' : ''}</span><br>
      <a href="#/arbre/${t.id}"><b>Ouvrir la fiche →</b></a>`, { closeButton: false });
    m.on('dragend', () => { const p = m.getLatLng(); t.lat = +p.lat.toFixed(7); t.lng = +p.lng.toFixed(7); t.gpsAcc = null; save(); toast('Position mise à jour'); });
    m.addTo(MARKERS); pts.push([t.lat, t.lng]);
  });
  drawRows();
  return pts;
}

// ── GPS ──
function startWatch() {
  if (WATCH != null || !navigator.geolocation) { if (!navigator.geolocation) { GPS = { err: 'GPS non disponible sur cet appareil' }; } return; }
  WATCH = navigator.geolocation.watchPosition(p => {
    GPS = { lat: p.coords.latitude, lng: p.coords.longitude, acc: p.coords.accuracy, ts: Date.now() };
    drawMe(); const g = $('#gpsinfo'); if (g) g.innerHTML = gpsText();
  }, e => { GPS = { err: e.code === 1 ? 'Localisation refusée : autorisez-la dans les réglages du téléphone (Safari / site web)' : 'Position indisponible' }; const g = $('#gpsinfo'); if (g) g.innerHTML = gpsText(); },
  { enableHighAccuracy: true, maximumAge: 2000, timeout: 30000 });
}
function drawMe() {
  if (!MAP || !GPS || GPS.err) return;
  if (!ME) ME = L.layerGroup().addTo(MAP);
  ME.clearLayers();
  L.circle([GPS.lat, GPS.lng], { radius: Math.min(GPS.acc, 60), color: '#1f78d1', weight: 1, fillOpacity: 0.12, interactive: false }).addTo(ME);
  L.circleMarker([GPS.lat, GPS.lng], { radius: 7, color: '#fff', weight: 2, fillColor: '#1f78d1', fillOpacity: 1, interactive: false }).addTo(ME);
}
function locate(quiet) {
  startWatch();
  if (GPS && !GPS.err) { MAP.setView([GPS.lat, GPS.lng], Math.max(MAP.getZoom(), 19)); return; }
  if (!quiet) toast('Recherche de votre position…');
  navigator.geolocation && navigator.geolocation.getCurrentPosition(p => { GPS = { lat: p.coords.latitude, lng: p.coords.longitude, acc: p.coords.accuracy, ts: Date.now() }; drawMe(); if (MAP && (!quiet || !S.trees.some(hasPos))) MAP.setView([GPS.lat, GPS.lng], 18); },
    () => { if (!quiet) toast('Position indisponible'); }, { enableHighAccuracy: true, timeout: 20000 });
}

// ── Placement ──
function nextUnplaced(afterId) {
  const un = unplaced(); if (!un.length) return null;
  const all = S.trees.filter(alive).sort(walkCmp), i = all.findIndex(t => t.id === afterId);
  for (let k = 1; k <= all.length; k++) { const t = all[(i + k) % all.length]; if (!hasPos(t)) return t.id; }
  return un[0].id;
}
function setPos(t, lat, lng, acc) { t.lat = +lat.toFixed(7); t.lng = +lng.toFixed(7); t.gpsAcc = acc ? Math.round(acc) : null; }
function afterPlace(t) {
  save(); drawMarkers();
  const nx = nextUnplaced(t.id);
  MAPUI.target = nx;
  if (!nx) { MAPUI.mode = null; toast('✅ Tous les arbres sont placés'); } else toast(`« ${t.name} » placé`);
  refreshPanel();
}
function placeTree(lat, lng) {
  const t = treeById(MAPUI.target) || unplaced()[0]; if (!t) return;
  setPos(t, lat, lng, null); afterPlace(t);
}
function recordHere() {
  const t = treeById(MAPUI.target) || unplaced()[0]; if (!t) return;
  if (!GPS || GPS.err || Date.now() - GPS.ts > 20000) { toast('Pas de position GPS récente — patientez'); return; }
  if (GPS.acc > 20 && !confirm(`Précision faible (± ${Math.round(GPS.acc)} m). Enregistrer quand même ?`)) return;
  setPos(t, GPS.lat, GPS.lng, GPS.acc); afterPlace(t);
}

// ── Rangées : une rangée = un nom + un n° d'ordre par arbre (tous types mélangés possibles) ──
const rowsList = () => [...new Set(S.trees.map(t => t.row).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'fr', { numeric: true }));
let ORDER = [];
function updOrder() {
  $$('#ordlist .ordi').forEach(el => { const k = ORDER.indexOf(el.dataset.id); el.classList.toggle('sel', k >= 0); $('.ordn', el).textContent = k >= 0 ? k + 1 : ''; });
  const c = $('#ordcount'); if (c) c.textContent = `(${ORDER.length} choisi${ORDER.length > 1 ? 's' : ''})`;
}
function assignForm() {
  ORDER = [];
  const live = S.trees.filter(alive).sort(natCmp);
  sheet('📋 Définir une rangée', `<p class="muted small">Donnez un nom à la rangée, puis <b>touchez les arbres dans l’ordre où ils se suivent</b> le long de la rangée (tous types mélangés possibles). Le 1er touché reçoit le n° de départ, le suivant +1, etc.</p>
    ${selNew('row', 'Rangée', rowsList(), '', '— Choisir —')}
    <label class="f">N° du 1er arbre touché<input name="start" type="number" min="1" value="1"></label>
    <label class="f">Arbres <b id="ordcount"></b><input id="ordq" type="search" placeholder="Filtrer par nom, type…" style="margin-top:3px"></label>
    <div class="checks" id="ordlist" style="max-height:280px">${live.map(t => `<div class="ordi" data-act="ordPick" data-id="${t.id}" data-q="${esc(norm(t.name + ' ' + treeFull(t) + ' ' + (t.row || '')))}"><span class="ordn"></span><span class="col">${esc(t.name)} <span class="muted small">${esc(treeFull(t))}${t.row ? ' · ' + esc(t.row) + (t.pos ? ' n°' + t.pos : '') : ''}</span></span></div>`).join('')}</div>`, {
    submitLabel: 'Enregistrer la rangée',
    onSubmit: fd => {
      const row = selVal(fd, 'row'), start = parseInt(fd.get('start')) || 1;
      if (!row) { toast('Donnez un nom à la rangée'); return false; }
      if (!ORDER.length) { toast('Touchez au moins un arbre'); return false; }
      ORDER.forEach((id, k) => { const t = treeById(id); t.row = row; t.pos = start + k; });
      save(); refreshPanel(); toast(`${ORDER.length} arbre(s) dans la rangée « ${row} »`);
    }
  });
  updOrder();
}
// ── Alignement automatique d'une rangée ──
// Ajuste une droite (moindres carrés orthogonaux) sur les arbres déjà placés de la rangée, puis, avec les n°,
// répartit régulièrement les arbres le long de cette droite. Les points aberrants sont écartés de l'ajustement
// (mais ramenés sur la droite). Les arbres de la rangée sans position sont placés à leur emplacement théorique.
const median = a => { const s = [...a].sort((x, y) => x - y), n = s.length; return n ? (n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2) : 0; };
function fitRow(pts) { // pts: [{x,y,pos}]
  const n = pts.length, mx = pts.reduce((s, p) => s + p.x, 0) / n, my = pts.reduce((s, p) => s + p.y, 0) / n;
  let sxx = 0, syy = 0, sxy = 0; pts.forEach(p => { sxx += (p.x - mx) ** 2; syy += (p.y - my) ** 2; sxy += (p.x - mx) * (p.y - my); });
  const th = 0.5 * Math.atan2(2 * sxy, sxx - syy), dx = Math.cos(th), dy = Math.sin(th);
  const sv = pts.map(p => (p.x - mx) * dx + (p.y - my) * dy), mp = pts.reduce((s, p) => s + p.pos, 0) / n, ms = sv.reduce((s, v) => s + v, 0) / n;
  let cov = 0, vr = 0; pts.forEach((p, k) => { cov += (p.pos - mp) * (sv[k] - ms); vr += (p.pos - mp) ** 2; });
  const b = vr ? cov / vr : 0; return { mx, my, dx, dy, a: ms - b * mp, b };
}
function planAlign(row, even, fill) {
  const all = S.trees.filter(t => alive(t) && t.row === row && t.pos), placed = all.filter(hasPos);
  if (placed.length < 2 || new Set(placed.map(t => t.pos)).size < 2) return { err: 'Il faut au moins 2 arbres placés avec des n° différents dans cette rangée.' };
  const lat0 = placed.reduce((s, t) => s + t.lat, 0) / placed.length, lng0 = placed.reduce((s, t) => s + t.lng, 0) / placed.length;
  const kx = 111320 * Math.cos(lat0 * Math.PI / 180), ky = 110540;
  const P = t => ({ t, pos: t.pos, x: (t.lng - lng0) * kx, y: (t.lat - lat0) * ky });
  const pp = placed.map(P); let inl = pp, fit = fitRow(inl);
  for (let pass = 0; pass < 2 && pp.length >= 5; pass++) { // écarte les points aberrants de l'ajustement
    const res = pp.map(p => { const sx = (p.x - fit.mx) * fit.dx + (p.y - fit.my) * fit.dy; return { perp: Math.abs(-(p.x - fit.mx) * fit.dy + (p.y - fit.my) * fit.dx), along: Math.abs(sx - (fit.a + fit.b * p.pos)) }; });
    const mp = median(res.map(r => r.perp)), ma = median(res.map(r => r.along));
    const keep = pp.filter((p, k) => res[k].perp <= 3 * mp + 1.5 && res[k].along <= 3 * ma + 1.5);
    if (keep.length < 2 || new Set(keep.map(p => p.pos)).size < 2 || keep.length === inl.length) break;
    inl = keep; fit = fitRow(inl);
  }
  const toLL = (s) => ({ lat: lat0 + (fit.my + s * fit.dy) / ky, lng: lng0 + (fit.mx + s * fit.dx) / kx });
  const items = [], moves = [];
  pp.forEach(p => {
    const s = even ? fit.a + fit.b * p.pos : (p.x - fit.mx) * fit.dx + (p.y - fit.my) * fit.dy, q = toLL(s);
    const nx = (q.lng - lng0) * kx, ny = (q.lat - lat0) * ky; moves.push(Math.hypot(nx - p.x, ny - p.y));
    items.push({ t: p.t, lat: q.lat, lng: q.lng, was: true });
  });
  let added = 0;
  if (fill) all.filter(t => !hasPos(t)).forEach(t => { const q = toLL(fit.a + fit.b * t.pos); items.push({ t, lat: q.lat, lng: q.lng, was: false }); added++; });
  const spacing = Math.abs(fit.b);
  return { items, added, mean: moves.reduce((s, v) => s + v, 0) / moves.length, max: Math.max(...moves), spacing, outliers: pp.length - inl.length };
}
function rowForm() {
  const rows = rowsList();
  if (!rows.length) { toast('Définissez d’abord une rangée (📋 Définir une rangée)'); return; }
  sheet('↔️ Aligner une rangée', `<p class="muted small">Place les arbres de la rangée sur une <b>ligne droite</b> ajustée sur ceux que vous avez déjà positionnés (au moins 2), avec un espacement régulier selon leur n°. Les arbres sans position sont placés à leur emplacement théorique. Vous pourrez annuler.</p>
    <label class="f">Rangée<select name="row">${rows.map(r => { const n = S.trees.filter(t => t.row === r && alive(t)).length, p = S.trees.filter(t => t.row === r && alive(t) && hasPos(t)).length; return `<option value="${esc(r)}">${esc(r)} — ${p} placé(s) / ${n}</option>`; }).join('')}</select></label>
    <label class="f" style="color:var(--text)"><input type="checkbox" name="even" checked style="width:auto"> Espacer régulièrement selon le n° (sinon : seulement redresser sur la ligne)</label>
    <label class="f" style="color:var(--text)"><input type="checkbox" name="fill" checked style="width:auto"> Positionner aussi les arbres de la rangée sans position</label>`, {
    submitLabel: 'Aligner',
    onSubmit: fd => {
      const row = fd.get('row'), r = planAlign(row, !!fd.get('even'), !!fd.get('fill'));
      if (r.err) { toast(r.err); return false; }
      const sp = r.spacing ? ` · espacement ≈ ${r.spacing.toFixed(1).replace('.', ',')} m` : '';
      if (!confirm(`Rangée « ${row} » : ${r.items.length} arbre(s)${r.added ? ` (dont ${r.added} nouvellement placé(s))` : ''}${sp}.\nDéplacement moyen ${r.mean.toFixed(1).replace('.', ',')} m, maximum ${r.max.toFixed(1).replace('.', ',')} m${r.outliers ? `\n${r.outliers} point(s) très écarté(s) ignoré(s) pour tracer la ligne` : ''}.\nAppliquer ?`)) return false;
      MAPUI.undo = { row, items: r.items.map(i => ({ id: i.t.id, lat: i.t.lat, lng: i.t.lng, acc: i.t.gpsAcc, was: i.was })) };
      r.items.forEach(i => setPos(i.t, i.lat, i.lng, null));
      save(); drawMarkers(); refreshPanel(); toast(`Rangée « ${row} » alignée`);
    }
  });
}
function undoAlign() {
  const u = MAPUI.undo; if (!u) return;
  u.items.forEach(i => { const t = treeById(i.id); if (!t) return; if (i.was) { t.lat = i.lat; t.lng = i.lng; t.gpsAcc = i.acc ?? null; } else { t.lat = null; t.lng = null; t.gpsAcc = null; } });
  MAPUI.undo = null; save(); drawMarkers(); refreshPanel(); toast('Alignement annulé');
}

Object.assign(actions, {
  goPlan: () => { location.hash = '#/plan'; },
  mapGeo: () => { if (MAP) locate(false); },
  mapEdit: () => { MAPUI.edit = !MAPUI.edit; drawMarkers(); refreshPanel(); },
  mapSurvey: () => { MAPUI.mode = 'survey'; MAPUI.target = (unplaced()[0] || {}).id; startWatch(); refreshPanel(); },
  mapPlace: () => { MAPUI.mode = 'place'; MAPUI.target = (unplaced()[0] || {}).id; refreshPanel(); },
  mapStop: () => { MAPUI.mode = null; refreshPanel(); },
  mapSkip: () => { MAPUI.target = nextUnplaced(MAPUI.target); refreshPanel(); },
  mapRecord: recordHere,
  mapRow: rowForm,
  mapUndo: undoAlign,
  mapAssign: assignForm,
  mapRows: () => { MAPUI.rows = !MAPUI.rows; drawRows(); refreshPanel(); },
  ordPick: ({ id }) => { const k = ORDER.indexOf(id); if (k >= 0) ORDER.splice(k, 1); else ORDER.push(id); updOrder(); }
});
document.addEventListener('input', e => {
  if (e.target.id !== 'ordq') return;
  const q = norm(e.target.value);
  $$('#ordlist .ordi').forEach(el => el.classList.toggle('hide', !!q && !el.dataset.q.includes(q)));
});
document.addEventListener('change', e => {
  const k = e.target.dataset && e.target.dataset.map; if (!k) return;
  const v = e.target.value;
  if (k === 'layer') { MAPUI.layer = v; drawMarkers(); refreshPanel(); }
  if (k === 'base') { MAPUI.base = v; setBase(); }
  if (k === 'filter') { MAPUI.filter = v; drawMarkers(); }
  if (k === 'target') { MAPUI.target = v; refreshPanel(); }
});
