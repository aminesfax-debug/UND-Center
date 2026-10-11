'use strict';
/* Plan interactif des arbres (Leaflet embarqué, fonctionne sans réseau pour les points ;
   les fonds de carte satellite / OpenStreetMap demandent une connexion). */
const MAPUI = { layer: 'type', base: 'sat', filter: '', edit: false, mode: null, target: null, focus: null, center: null, zoom: null };
let MAP = null, MARKERS = null, BASE = null, ME = null, WATCH = null, GPS = null;

const TYPE_PALETTE = ['#2f8f4f', '#d9822b', '#7a5cc2', '#2a8fbd', '#c9484a', '#a0a830', '#c2569b', '#5b6b7b', '#8a5a2b', '#1f9e8f'];
const natCmp = (a, b) => a.name.localeCompare(b.name, 'fr', { numeric: true });
const hasPos = t => t.lat != null && t.lng != null && isFinite(t.lat) && isFinite(t.lng);
const typesList = () => [...new Set(S.trees.map(t => t.type))].sort();
const typeColor = type => TYPE_PALETTE[Math.max(0, typesList().indexOf(type)) % TYPE_PALETTE.length];
const unplaced = () => S.trees.filter(alive).filter(t => !hasPos(t)).sort(natCmp);

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
  const opts = (un.length ? un : []).concat(tgt && hasPos(tgt) ? [tgt] : []).map(t => opt(t.id, t.name + (hasPos(t) ? ' (placé)' : ''), tgt && tgt.id)).join('');
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
      <button class="btn sm col" data-act="mapRow">↔️ Rangée</button></div>
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

function destroyMap() {
  if (WATCH != null) { navigator.geolocation.clearWatch(WATCH); WATCH = null; }
  if (MAP) { MAP.remove(); MAP = null; MARKERS = null; BASE = null; ME = null; }
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
  const all = S.trees.filter(alive).sort(natCmp), i = all.findIndex(t => t.id === afterId);
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

// ── Rangée : positions intermédiaires par interpolation ──
function rowForm() {
  const placed = S.trees.filter(alive).filter(hasPos).sort(natCmp);
  if (placed.length < 2) { toast('Placez d’abord au moins 2 arbres (début et fin de rangée)'); return; }
  const o = placed.map(t => opt(t.id, t.name, '')).join('');
  sheet('↔️ Compléter une rangée', `<p class="muted small">Choisissez le premier et le dernier arbre de la rangée (déjà placés). Les arbres du même type dont le numéro est entre les deux sont répartis à égale distance. Corrigez ensuite au doigt si la rangée n’est pas régulière.</p>
    <label class="f">Premier arbre<select name="a">${o}</select></label><label class="f">Dernier arbre<select name="b">${o}</select></label>
    <label class="f" style="color:var(--text)"><input type="checkbox" name="over" style="width:auto"> Écraser les positions déjà enregistrées entre les deux</label>`, {
    submitLabel: 'Positionner',
    onSubmit: fd => {
      const A = treeById(fd.get('a')), B = treeById(fd.get('b'));
      if (!A || !B || A.id === B.id) { toast('Choisissez deux arbres différents'); return false; }
      const seq = S.trees.filter(alive).filter(t => t.type === A.type && norm(t.variety) === norm(A.variety)).sort(natCmp);
      let i = seq.findIndex(t => t.id === A.id), j = seq.findIndex(t => t.id === B.id);
      if (i < 0 || j < 0) { toast('Les deux arbres doivent avoir le même type et la même variété'); return false; }
      const step = i < j ? 1 : -1, n = Math.abs(j - i) - 1;
      if (n < 1) { toast('Aucun arbre entre les deux'); return false; }
      const mid = []; for (let k = i + step; k !== j; k += step) mid.push(seq[k]);
      const todo = mid.filter(t => fd.get('over') || !hasPos(t));
      if (!todo.length) { toast('Tous ont déjà une position'); return false; }
      if (!confirm(`Positionner ${todo.length} arbre(s) entre « ${A.name} » et « ${B.name} » ?`)) return false;
      mid.forEach((t, k) => { if (todo.includes(t)) setPos(t, A.lat + (B.lat - A.lat) * (k + 1) / (n + 1), A.lng + (B.lng - A.lng) * (k + 1) / (n + 1), null); });
      save(); drawMarkers(); refreshPanel(); toast(`${todo.length} arbre(s) positionné(s)`);
    }
  });
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
  mapRow: rowForm
});
document.addEventListener('change', e => {
  const k = e.target.dataset && e.target.dataset.map; if (!k) return;
  const v = e.target.value;
  if (k === 'layer') { MAPUI.layer = v; drawMarkers(); refreshPanel(); }
  if (k === 'base') { MAPUI.base = v; setBase(); }
  if (k === 'filter') { MAPUI.filter = v; drawMarkers(); }
  if (k === 'target') { MAPUI.target = v; refreshPanel(); }
});
