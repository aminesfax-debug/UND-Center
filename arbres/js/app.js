'use strict';
const APP_VERSION = 'v21';
let TASKS_UNDO = null; // dernier nettoyage des tâches en retard, annulable tant que l'appli reste ouverte
/* Mes Arbres — PWA hors-ligne. Données: IndexedDB (état JSON + photos en Blob). */

// ───────── Utilitaires ─────────
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const pad = n => String(n).padStart(2, '0');
const iso = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parse = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const todayISO = () => iso(new Date());
const addDays = (s, n) => { const d = parse(s); d.setDate(d.getDate() + n); return iso(d); };
const addMonths = (s, n) => { const d = parse(s); const day = d.getDate(); d.setDate(1); d.setMonth(d.getMonth() + n); d.setDate(Math.min(day, new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate())); return iso(d); };
const diffDays = (a, b) => Math.round((parse(a) - parse(b)) / 864e5);
const fmtDate = s => s ? parse(s).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' }) : '';
const norm = s => (s || '').trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
const isEmpty = v => v == null || v === '' || (Array.isArray(v) && !v.length);
const num = v => { const n = parseFloat(String(v).replace(',', '.')); return isNaN(n) ? null : n; };
function rel(date) {
  const d = diffDays(date, todayISO());
  if (d === 0) return "Aujourd'hui";
  if (d === 1) return 'Demain';
  if (d === -1) return 'Hier';
  return d < 0 ? `En retard de ${-d} j` : `Dans ${d} j`;
}
function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.hidden = false;
  clearTimeout(toast.t); toast.t = setTimeout(() => (t.hidden = true), 2400);
}

// ───────── Stockage ─────────
const DB = {
  db: null,
  open() {
    return new Promise((res, rej) => {
      const r = indexedDB.open('arbres', 1);
      r.onupgradeneeded = () => { r.result.createObjectStore('kv'); r.result.createObjectStore('photos'); };
      r.onsuccess = () => { this.db = r.result; res(); };
      r.onerror = () => rej(r.error);
    });
  },
  tx(store, mode, fn) {
    return new Promise((res, rej) => {
      const t = this.db.transaction(store, mode); const out = fn(t.objectStore(store));
      t.oncomplete = () => res(out.result); t.onerror = () => rej(t.error);
    });
  },
  get: (s, k) => DB.tx(s, 'readonly', st => st.get(k)),
  put: (s, k, v) => DB.tx(s, 'readwrite', st => st.put(v, k)),
  del: (s, k) => DB.tx(s, 'readwrite', st => st.delete(k)),
  keys: s => DB.tx(s, 'readonly', st => st.getAllKeys()),
  clear: s => DB.tx(s, 'readwrite', st => st.clear())
};
let S = null;
let saveT = null;
const save = () => { clearTimeout(saveT); saveT = setTimeout(() => { DB.put('kv', 'state', S).catch(() => toast('⚠️ Échec de sauvegarde')); pushDiff(); }, 150); };
function defaultFiche(f) {
  const o = { id: 'def-' + norm(f.type).replace(/\W+/g, '-') + '-' + norm(f.variety).replace(/\W+/g, '-'), type: f.type, variety: f.variety || '', exposition: '', sol: '', arrosage: '', plantation: '', taille: '', fertilisation: '', sante: '', remarques: '', floraison: [], recolte: [], plan: [], ...JSON.parse(JSON.stringify(f)) };
  delete o.aliases; return o;
}
function seedRegistry(existing = []) {
  const have = new Set(existing.map(f => norm(f.type) + '|' + norm(f.variety)));
  return DEFAULT_FICHES.filter(f => !have.has(norm(f.type) + '|' + norm(f.variety))).map(defaultFiche);
}
async function loadState() {
  S = await DB.get('kv', 'state');
  if (!S) { S = { v: 1, trees: [], logs: [], tasks: [], registry: seedRegistry(), settings: {} }; save(); }
  try { navigator.storage?.persist?.(); } catch (e) { /* ignore */ }
  migrate();
}
// Migrations ponctuelles des données existantes (une fois par appareil)
function migrate() {
  S.settings ||= {}; S.settings.mig ||= {};
  if (!S.settings.mig.noMaturite) { // tâche « Contrôle de maturité » supprimée : remplacée par le constat « Quantité de fruits »
    const GONE = 'Contrôle de maturité avant récolte';
    S.registry.forEach(f => { if ((f.plan || []).some(p => p.label === GONE)) f.plan = f.plan.filter(p => p.label !== GONE); });
    S.tasks = S.tasks.filter(t => t.done || t.label !== GONE);
    S.settings.mig.noMaturite = true; save();
  }
  if (!S.settings.mig.figVarietes) { // variétés de figuier (fiche fournie) : ajout sans doublon ni écrasement
    const figs = S.registry.filter(f => norm(f.type) === 'figuier'), FIELDS = ['figType', 'bearing', 'capri', 'exposition', 'sol', 'arrosage', 'plantation', 'taille', 'fertilisation', 'sante', 'remarques'];
    DEFAULT_FICHES.filter(d => d.aliases && norm(d.type) === 'figuier').forEach(d => {
      const hit = figs.find(f => f.variety && d.aliases.some(a => norm(f.variety).includes(a)));
      if (hit) { // fiche déjà présente (même sous un autre nom) : on ne complète que les champs VIDES
        FIELDS.forEach(k => { if (isEmpty(hit[k]) && !isEmpty(d[k])) hit[k] = d[k]; });
        if (hit.bacour === undefined) hit.bacour = d.bacour;
        if (isEmpty(hit.recolte)) hit.recolte = [...d.recolte];
      } else S.registry.push(defaultFiche(d));
    });
    const gen = S.registry.find(f => norm(f.type) === 'figuier' && !norm(f.variety)), genDef = DEFAULT_FICHES.find(d => norm(d.type) === 'figuier' && !d.variety);
    if (gen && genDef) { gen.plan = gen.plan || []; genDef.plan.forEach(p => { if (!gen.plan.some(x => x.label === p.label)) gen.plan.push({ ...p }); }); gen.plan.sort((a, b) => a.month - b.month); }
    S.settings.mig.figVarietes = true; save();
  }
  if (!S.settings.mig.constatFruits) { // rappel annuel « Constat : quantité de fruits » (olivier), dont la réalisation = constat de fruits
    const NEW = { month: 10, type: 'constat', label: 'Constat : quantité de fruits' };
    // Si le registre contient déjà cette ligne (autre appareil / nouvelle installation), la migration a déjà eu lieu ailleurs :
    // ne pas recréer de tâches (l'utilisateur a pu les supprimer).
    const already = S.registry.some(f => norm(f.type) === 'olivier' && (f.plan || []).some(p => p.type === 'constat'));
    S.registry.forEach(f => { if (norm(f.type) === 'olivier' && (f.plan || []).length && !f.plan.some(p => p.type === 'constat')) { f.plan.push({ ...NEW }); f.plan.sort((a, b) => a.month - b.month); } });
    if (!already) S.trees.filter(t => alive(t) && norm(t.type) === 'olivier').forEach(t => addPlanTask(t, NEW)); // uniquement cette tâche : on ne recrée pas celles que vous auriez supprimées
    S.settings.mig.constatFruits = true; save();
  }
}

// Photos
const delPhoto = id => { DB.del('photos', id); cloudDelPhoto(id); };
const photoURLs = new Map();
async function savePhoto(file) {
  const bmp = await createImageBitmap(file).catch(() => null);
  let blob = file;
  if (bmp) {
    const k = Math.min(1, 1024 / Math.max(bmp.width, bmp.height));
    const c = document.createElement('canvas'); c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
    c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
    blob = await new Promise(r => c.toBlob(r, 'image/jpeg', 0.7));
  }
  const id = uid(); await DB.put('photos', id, blob); cloudPutPhoto(id, blob); return id;
}
async function photoURL(id) {
  if (photoURLs.has(id)) return photoURLs.get(id);
  const b = (await DB.get('photos', id)) || (await cloudGetPhoto(id)); if (!b) return null;
  const u = URL.createObjectURL(b); photoURLs.set(id, u); return u;
}
async function hydrate(root = document) {
  for (const el of $$('[data-photo]', root)) {
    const id = el.dataset.photo; if (!id) continue;
    const u = await photoURL(id); if (!u) continue;
    if (el.tagName === 'IMG') el.src = u; else { el.style.backgroundImage = `url(${u})`; el.textContent = ''; }
  }
}
async function formPhoto(fd, old) {
  const f = fd.get('photo');
  if (f && f.size) { const id = await savePhoto(f); if (old) delPhoto(old); return id; }
  if (fd.get('delphoto') && old) { delPhoto(old); return ''; }
  return old || '';
}

// ───────── Domaine ─────────
const alive = t => t.status !== 'mort';
const treeById = id => S.trees.find(t => t.id === id);
const treeLabel = t => t ? t.name : '(arbre supprimé)';
const treeFull = t => [t.type, t.variety].filter(Boolean).join(' · ');
const age = t => (t.year ? new Date().getFullYear() - t.year : null);
const STATUS = { bon: ['Bonne santé', ''], surveiller: ['À surveiller', 'warn'], malade: ['Malade', 'danger'], mort: ['Mort / retiré', 'grey'] };

const isFigType = t => norm(t).startsWith('figuier');
const hasTwoCrops = f => !!f && (f.bearing === 'bifere' || !!f.bacour);
// Charge en fruits : dernier constat de chaque année (et de chaque récolte pour les figuiers bifères)
function fruitByYear(treeId) {
  const out = {};
  S.logs.filter(l => l.treeId === treeId && l.kind === 'constat' && l.fruit != null).sort((a, b) => a.date.localeCompare(b.date))
    .forEach(l => { ((out[l.date.slice(0, 4)] ||= {})[l.crop || ''] = l.fruit); });
  return out;
}
const lvlFR = v => v.toFixed(1).replace('.', ',');

function findFiches(type, variety) {
  const exact = S.registry.find(f => norm(f.type) === norm(type) && norm(f.variety) === norm(variety));
  const generic = S.registry.find(f => norm(f.type) === norm(type) && !norm(f.variety));
  return { exact, generic };
}
// Fiche fusionnée : champs de la variété, sinon ceux du type
function ficheOf(t) {
  const { exact, generic } = findFiches(t.type, t.variety);
  if (!exact && !generic) return null;
  const m = { ...(generic || {}) };
  if (exact) for (const k of Object.keys(exact)) if (!isEmpty(exact[k])) m[k] = exact[k];
  m._exact = !!exact; m._hasGeneric = !!generic;
  return m;
}
// Crée la tâche d'une ligne du plan type pour un arbre, sauf si elle existe déjà (ouverte, ou faite depuis < 300 j)
function addPlanTask(t, p) {
  const today = todayISO(), cm = new Date().getMonth() + 1, key = `${p.type}|${p.label}|${p.month}`;
  if (S.tasks.some(x => x.treeId === t.id && x.tplKey === key && !x.done)) return 0;
  if (S.tasks.some(x => x.treeId === t.id && x.tplKey === key && x.done && x.doneDate && diffDays(today, x.doneDate) < 300)) return 0;
  const y = new Date().getFullYear(); let date = `${y}-${pad(p.month)}-15`;
  if (date < today) date = p.month === cm ? today : `${y + 1}-${pad(p.month)}-15`;
  S.tasks.push({ id: uid(), treeId: t.id, type: p.type, label: p.label, date, repeat: 'y1', tplKey: key, done: false, product: '', notes: '' });
  return 1;
}
function ensurePlan(t) {
  const f = ficheOf(t); if (!f || !f.plan) return 0;
  return f.plan.reduce((n, p) => n + addPlanTask(t, p), 0);
}
const REPEATS = { '': 'Aucune', y1: 'Chaque année', m3: 'Tous les 3 mois', m1: 'Tous les mois', d14: 'Toutes les 2 semaines', d7: 'Chaque semaine' };
function nextDate(date, rep) {
  if (!rep) return null;
  const n = parseInt(rep.slice(1), 10), u = rep[0];
  return u === 'y' ? addMonths(date, 12 * n) : u === 'm' ? addMonths(date, n) : addDays(date, n);
}
// Arrosage
const SUMMER = m => m >= 5 && m <= 9;
function waterInterval(t, month = new Date().getMonth() + 1) {
  const i = t.irrig || {}; return (SUMMER(month) ? i.summerDays : i.winterDays) || 0;
}
function lastWater(t) {
  let best = null;
  for (const l of S.logs) if (l.treeId === t.id && l.kind === 'irrigation' && (!best || l.date > best)) best = l.date;
  return best;
}
function nextWater(t) {
  const iv = waterInterval(t); if (!iv) return null;
  const last = lastWater(t);
  return { date: last ? addDays(last, iv) : todayISO(), last, iv };
}
function darUntil(t) {
  let max = null;
  for (const l of S.logs) if (l.treeId === t.id && l.dar > 0) { const d = addDays(l.date, +l.dar); if (!max || d > max.date) max = { date: d, product: l.product }; }
  return max && max.date > todayISO() ? max : null;
}
function harvestMonthsOf(t) { return (ficheOf(t) || {}).recolte || []; }
const monthRuns = months => { // [10,11,12,1] -> [{start:10,len:4}]
  const set = new Set(months), runs = [];
  for (const m of set) if (!set.has(m === 1 ? 12 : m - 1)) { let len = 1, c = m; while (set.has(c === 12 ? 1 : c + 1) && len < 12) { c = c === 12 ? 1 : c + 1; len++; } runs.push({ start: m, len }); }
  return runs;
};

// ───────── UI de base ─────────
const ui = { treeTab: 'fiche', logFilter: '', q: '', fType: '', fZone: '', fStatus: '', regQ: '', cal: { y: new Date().getFullYear(), m: new Date().getMonth(), tab: 'mois', sel: null } };

function sheet(title, body, opts = {}) {
  const el = $('#sheet');
  el.innerHTML = `<div class="sheet-bg" data-act="closeSheet"></div><form class="sheet-box"><header><b>${title}</b><button type="button" class="x" data-act="closeSheet">✕</button></header><div class="sheet-body">${body}</div>${opts.onSubmit ? `<footer><button class="btn primary">${opts.submitLabel || 'Enregistrer'}</button></footer>` : ''}</form>`;
  el.hidden = false;
  const form = $('form', el);
  if (opts.onSubmit) form.onsubmit = async e => {
    e.preventDefault();
    try { if ((await opts.onSubmit(new FormData(form), form)) !== false) closeSheet(); }
    catch (err) { console.error(err); toast('Erreur : ' + err.message); }
  };
  $$('select[name=kind]', form).forEach(syncKind);
  if (opts.onOpen) opts.onOpen(form);
  hydrate(el);
}
function closeSheet() { $('#sheet').hidden = true; $('#sheet').innerHTML = ''; if (Sync.dirty) { Sync.dirty = false; render(); } }
function syncKind(sel) {
  const k = sel.value;
  $$('[data-kinds]', sel.form).forEach(e => e.classList.toggle('hide', !e.dataset.kinds.split(' ').includes(k)));
}
const opt = (v, l, cur) => `<option value="${esc(v)}"${String(cur) === String(v) ? ' selected' : ''}>${esc(l)}</option>`;
const monthChecks = (name, sel = []) => `<div class="months">${MONTHS.map((m, i) => `<label><input type="checkbox" name="${name}" value="${i + 1}"${sel.includes(i + 1) ? ' checked' : ''}>${m}</label>`).join('')}</div>`;
const fieldVal = (fd, n) => (fd.get(n) || '').toString().trim();

// ───────── Formulaires ─────────
function treePicker(pre = []) {
  const live = S.trees.filter(alive).sort((a, b) => a.name.localeCompare(b.name, 'fr', { numeric: true }));
  const fulls = [...new Set(live.map(treeFull))].sort(), zones = [...new Set(live.map(t => t.zone).filter(Boolean))].sort();
  return `<label class="f">Arbres concernés <b id="pickn"></b></label>
    <div class="row" style="margin-bottom:6px"><button type="button" class="btn sm" data-act="pick" data-v="1">Tous</button><button type="button" class="btn sm" data-act="pick" data-v="0">Aucun</button>
    <select data-pick="full"><option value="">+ type/variété…</option>${fulls.map(x => `<option>${esc(x)}</option>`).join('')}</select>
    ${zones.length ? `<select data-pick="zone"><option value="">+ zone…</option>${zones.map(x => `<option>${esc(x)}</option>`).join('')}</select>` : ''}</div>
    <div class="checks" style="max-height:230px">${live.length ? live.map(t => `<label data-full="${esc(treeFull(t))}" data-zone="${esc(t.zone)}"><input type="checkbox" name="trees" value="${t.id}"${pre.includes(t.id) ? ' checked' : ''}> ${esc(t.name)} <span class="muted small">${esc(treeFull(t))}</span></label>`).join('') : '<span class="muted">Aucun arbre.</span>'}</div>`;
}
function updPick(f) { const n = $('#pickn', f); if (n) n.textContent = `(${$$('input[name=trees]:checked', f).length} sélectionné${$$('input[name=trees]:checked', f).length > 1 ? 's' : ''})`; }
function waterGroupForm() {
  sheet('💧 Arrosage groupé', `<div class="g2"><label class="f">Date<input type="date" name="date" value="${todayISO()}"></label><label class="f">Litres / arbre (vide = valeur de chaque arbre)<input name="l" inputmode="decimal"></label></div>${treePicker()}`, {
    onSubmit: fd => { const ids = fd.getAll('trees'); if (!ids.length) { toast('Aucun arbre choisi'); return false; } const l = num(fd.get('l')); ids.forEach(id => { const t = treeById(id); logWater(t, l ?? t.irrig?.litres, fd.get('date')); }); render(); toast(`💧 ${ids.length} arbres arrosés`); }
  });
  updPick($('#sheet form'));
}
function harvestGroupForm() {
  sheet('🧺 Récolte groupée', `<p class="muted small">Pour une récolte sans pesée arbre par arbre : le total est <b>réparti également</b> entre les arbres choisis et marqué « estimation ». Pour des chiffres exacts, saisissez la récolte sur la fiche de chaque arbre.</p>
    <div class="g2"><label class="f">Date<input type="date" name="date" value="${todayISO()}"></label><label class="f">Total récolté (kg)<input name="kg" inputmode="decimal" required></label></div>
    <label class="f">Huile obtenue (L) — olives, optionnel<input name="oil" inputmode="decimal"></label>${treePicker()}`, {
    onSubmit: fd => {
      const ids = fd.getAll('trees'), kg = num(fd.get('kg')); if (!ids.length || !kg) { toast('Arbres et total requis'); return false; }
      const oil = num(fd.get('oil')), blocked = ids.map(treeById).filter(t => darUntil(t));
      if (blocked.length && !confirm(`⚠️ ${blocked.length} arbre(s) sont sous délai avant récolte (ex. ${blocked[0].name}). Enregistrer quand même ?`)) return false;
      ids.forEach(id => S.logs.push({ id: uid(), treeId: id, date: fd.get('date'), kind: 'recolte', text: 'Récolte groupée (répartition égale, estimation)', qty: Math.round(kg / ids.length * 100) / 100, oil: oil ? Math.round(oil / ids.length * 100) / 100 : null, estimated: true, product: '', dar: 0 }));
      save(); render(); toast(`Récolte répartie sur ${ids.length} arbres`);
    }
  });
  updPick($('#sheet form'));
}

// Liste déroulante + option « Autre… » (les <datalist> sont mal gérés sur iPhone)
function selNew(name, label, opts, cur, empty) {
  const has = !cur || opts.includes(cur);
  return `<div><label class="f">${label}<select name="${name}" data-new="${name}">${empty ? `<option value="">${esc(empty)}</option>` : ''}${opts.map(o => opt(o, o, cur)).join('')}<option value="__new"${has ? '' : ' selected'}>➕ Autre / nouveau…</option></select></label>
    <input name="${name}_new" class="${has ? 'hide' : ''}" placeholder="Saisir…" value="${has ? '' : esc(cur)}" style="margin:-4px 0 10px"></div>`;
}
const selVal = (fd, n) => (fd.get(n) === '__new' ? fieldVal(fd, n + '_new') : fieldVal(fd, n));
const varietiesOf = type => [...new Set([...S.registry.filter(f => norm(f.type) === norm(type) && f.variety).map(f => f.variety), ...S.trees.filter(x => norm(x.type) === norm(type) && x.variety).map(x => x.variety)])].sort();
function toggleFig(form) { const box = $('#fig-fields', form); if (box) box.classList.toggle('hide', !isFigType(selVal(new FormData(form), 'type'))); }
function refreshVarieties(form) {
  const sel = form.elements.variety; if (!sel || sel.tagName !== 'SELECT') return;
  const type = selVal(new FormData(form), 'type'), cur = sel.value;
  const opts = varietiesOf(type);
  sel.innerHTML = '<option value="">— Aucune —</option>' + opts.map(o => opt(o, o, cur)).join('') + '<option value="__new">➕ Autre / nouvelle…</option>';
  sel.value = opts.includes(cur) ? cur : '';
  form.elements.variety_new.classList.add('hide');
}

function treeForm(t) {
  const isNew = !t; t = t || { irrig: { summerDays: 7, winterDays: 0, litres: 20 }, status: 'bon', year: new Date().getFullYear() };
  const types = [...new Set([...S.registry.map(f => f.type), ...S.trees.map(x => x.type)])].sort();
  const zones = [...new Set(S.trees.map(x => x.zone).filter(Boolean))];
  sheet(isNew ? 'Nouvel arbre' : 'Modifier l’arbre', `
    <label class="f">Nom / repère<input name="name" value="${esc(t.name)}" placeholder="ex. Olivier du fond"></label>
    ${isNew ? '<label class="f">Nombre d’arbres identiques à créer (numérotés automatiquement)<input name="count" type="number" min="1" max="200" value="1"></label>' : ''}
    <div class="g2">${selNew('type', 'Type', types, t.type, '— Choisir —')}${selNew('variety', 'Variété', varietiesOf(t.type), t.variety, '— Aucune —')}</div>
    <div class="g2"><label class="f">Année de plantation<input name="year" type="number" min="1900" max="2100" value="${t.year || ''}"></label>
    <label class="f">État de santé<select name="status">${Object.entries(STATUS).map(([k, v]) => opt(k, v[0], t.status)).join('')}</select></label></div>
    ${selNew('zone', 'Zone / emplacement', zones, t.zone, '— Aucune —')}
    <div class="g2">${selNew('row', 'Rangée', [...new Set(S.trees.map(x => x.row).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'fr', { numeric: true })), t.row, '— Aucune —')}
    <label class="f">${isNew ? 'N° du 1er arbre dans la rangée' : 'N° dans la rangée'}<input name="pos" type="number" min="1" value="${t.pos ?? ''}" placeholder="ordre le long de la rangée"></label></div>
    <div class="g3"><label class="f">Latitude<input name="lat" value="${t.lat ?? ''}" inputmode="decimal"></label><label class="f">Longitude<input name="lng" value="${t.lng ?? ''}" inputmode="decimal"></label>
    <label class="f">&nbsp;<button type="button" class="btn" data-act="gps">📍 Ici</button></label></div>
    <h3>💧 Irrigation (jours entre deux arrosages — 0 = pas d’arrosage)</h3>
    <div class="g3"><label class="f">Été (mai–sept.)<input name="summerDays" type="number" min="0" value="${t.irrig?.summerDays ?? 7}"></label>
    <label class="f">Reste de l’année<input name="winterDays" type="number" min="0" value="${t.irrig?.winterDays ?? 0}"></label>
    <label class="f">Litres / arrosage<input name="litres" type="number" min="0" value="${t.irrig?.litres ?? 20}"></label></div>
    <label class="f">Notes<textarea name="notes">${esc(t.notes)}</textarea></label>
    <label class="f">Photo<input type="file" name="photo" accept="image/*" capture="environment"></label>
    ${t.photoId ? '<label class="f"><input type="checkbox" name="delphoto" style="width:auto"> Supprimer la photo actuelle</label>' : ''}
    ${isNew ? '<label class="f" style="color:var(--text)"><input type="checkbox" name="plan" checked style="width:auto"> Générer le plan annuel type (taille, compost, traitements…) depuis la fiche du registre</label>' : ''}
  `, {
    onSubmit: async fd => {
      const type = selVal(fd, 'type'); if (!type) { toast('Le type est obligatoire'); return false; }
      const count = isNew ? Math.min(200, Math.max(1, parseInt(fd.get('count')) || 1)) : 1;
      const base = fieldVal(fd, 'name') || `${type} ${selVal(fd, 'variety')}`.trim();
      const photoId = await formPhoto(fd, t.photoId); let first = null, n = 0;
      for (let i = 1; i <= count; i++) {
      const obj = isNew ? { id: uid(), createdAt: todayISO() } : t; first ||= obj;
      Object.assign(obj, {
        name: count > 1 ? `${base} ${i}` : (fieldVal(fd, 'name') || `${base} #${S.trees.length + 1}`),
        type, variety: selVal(fd, 'variety'), year: parseInt(fd.get('year')) || null, status: fd.get('status'), zone: selVal(fd, 'zone'),
        lat: num(fd.get('lat')), lng: num(fd.get('lng')), notes: fieldVal(fd, 'notes'),
        row: selVal(fd, 'row'), pos: selVal(fd, 'row') && parseInt(fd.get('pos')) ? parseInt(fd.get('pos')) + i - 1 : null,
        irrig: { summerDays: parseInt(fd.get('summerDays')) || 0, winterDays: parseInt(fd.get('winterDays')) || 0, litres: parseInt(fd.get('litres')) || 0 }
      });
      obj.photoId = i === 1 ? photoId : '';
      if (isNew) S.trees.push(obj);
      if (isNew && fd.get('plan')) n += ensurePlan(obj);
      }
      save();
      if (isNew && count === 1) location.hash = '#/arbre/' + first.id; else if (isNew) location.hash = '#/arbres'; else render();
      toast(isNew ? `${count} arbre(s) ajouté(s)${n ? ` · ${n} tâches planifiées` : ''}` : 'Modifié');
    }
  });
}

function logForm(treeId, log, kind, taskId) {
  const isNew = !log; log = log || { date: todayISO(), kind: kind || 'constat' };
  const t = treeById(treeId);
  sheet(isNew ? 'Nouvelle entrée — ' + esc(treeLabel(t)) : 'Modifier l’entrée', `
    <div class="g2"><label class="f">Date<input type="date" name="date" value="${log.date}" required></label>
    <label class="f">Type<select name="kind">${Object.entries(LOG_KINDS).map(([k, v]) => opt(k, v.i + ' ' + v.l, log.kind)).join('')}</select></label></div>
    <label class="f">Description<textarea name="text" placeholder="Observation, travail réalisé…">${esc(log.text)}</textarea></label>
    <label class="f" data-kinds="constat">🍎 Quantité de fruits<select name="fruit"><option value="">— Non renseignée —</option>${LEVELS.map((n, i) => opt(i, n, log.fruit ?? '')).join('')}</select></label>
    ${hasTwoCrops(t && ficheOf(t)) ? `<label class="f" data-kinds="constat">Récolte concernée<select name="crop"><option value="">—</option>${Object.entries(CROPS).map(([k, v]) => opt(k, v, log.crop)).join('')}</select></label>` : ''}
    <label class="f" data-kinds="recolte">Quantité récoltée (kg)<input name="qty_kg" inputmode="decimal" value="${log.kind === 'recolte' ? log.qty ?? '' : ''}"></label>
    ${t && /olivier/i.test(norm(t.type)) ? `<label class="f" data-kinds="recolte">Huile obtenue (L) — optionnel<input name="oil" inputmode="decimal" value="${log.oil ?? ''}"></label>` : ''}
    <label class="f" data-kinds="irrigation">Eau apportée (litres)<input name="qty_l" inputmode="decimal" value="${log.kind === 'irrigation' ? log.qty ?? '' : ''}"></label>
    <label class="f" data-kinds="traitement travail">Produit / dose<input name="product" value="${esc(log.product)}"></label>
    <label class="f" data-kinds="traitement">Délai avant récolte (jours) — voir l’étiquette<input name="dar" type="number" min="0" value="${log.dar || ''}"></label>
    <label class="f">Photo<input type="file" name="photo" accept="image/*" capture="environment"></label>
    ${log.photoId ? '<label class="f"><input type="checkbox" name="delphoto" style="width:auto"> Supprimer la photo</label>' : ''}
  `, {
    onSubmit: async fd => {
      const k = fd.get('kind');
      if (taskId && (k !== 'constat' || fd.get('fruit') === '')) { toast('Choisissez le type « Constat » et la quantité de fruits'); return false; }
      if (k === 'recolte') { const d = darUntil(t); if (d && d.date > fd.get('date') && !confirm(`⚠️ Délai avant récolte en cours jusqu’au ${fmtDate(d.date)} (${d.product || 'traitement'}). Enregistrer quand même ?`)) return false; }
      const obj = isNew ? { id: uid(), treeId } : log;
      Object.assign(obj, { date: fd.get('date'), kind: k, text: fieldVal(fd, 'text'), product: fieldVal(fd, 'product'), dar: k === 'traitement' ? parseInt(fd.get('dar')) || 0 : 0,
        oil: k === 'recolte' ? num(fd.get('oil')) : null, fruit: k === 'constat' && fd.get('fruit') !== '' ? +fd.get('fruit') : null, crop: k === 'constat' ? fieldVal(fd, 'crop') : '', qty: k === 'recolte' ? num(fd.get('qty_kg')) : k === 'irrigation' ? num(fd.get('qty_l')) : null });
      obj.photoId = await formPhoto(fd, log.photoId);
      if (isNew) S.logs.push(obj);
      const tk = taskId && S.tasks.find(x => x.id === taskId);
      if (tk && !tk.done) completeTask(tk, obj.date);
      save(); render(); toast(tk ? 'Constat enregistré · tâche terminée' : 'Enregistré');
    }
  });
}

function taskForm(task, preset = {}) {
  const isNew = !task; task = task || { type: 'taille', date: preset.date || todayISO(), repeat: '' };
  const who = isNew ? treePicker(preset.treeIds || [])
    : `<p class="muted">🌳 ${esc(treeLabel(treeById(task.treeId)))}</p>`;
  sheet(isNew ? 'Nouvelle tâche' : 'Modifier la tâche', `${who}
    <div class="g2"><label class="f">Action<select name="type">${Object.entries(TASK_TYPES).map(([k, v]) => opt(k, v.i + ' ' + v.l, task.type)).join('')}</select></label>
    <label class="f">Date prévue<input type="date" name="date" value="${task.date}" required></label></div>
    <label class="f">Intitulé<input name="label" value="${esc(task.label)}" placeholder="(par défaut : nom de l’action)"></label>
    <label class="f">Répétition<select name="repeat">${Object.entries(REPEATS).map(([k, v]) => opt(k, v, task.repeat)).join('')}</select></label>
    <label class="f">Produit prévu<input name="product" value="${esc(task.product)}"></label>
    <label class="f">Notes<textarea name="notes">${esc(task.notes)}</textarea></label>
    ${isNew ? '' : '<button type="button" class="btn danger block" data-act="delTask" data-id="' + task.id + '">Supprimer la tâche</button>'}
  `, {
    onOpen: f => updPick(f),
    onSubmit: fd => {
      const ids = isNew ? fd.getAll('trees') : [task.treeId];
      if (!ids.length) { toast('Choisissez au moins un arbre'); return false; }
      for (const id of ids) {
        const o = isNew ? { id: uid(), treeId: id, done: false } : task;
        Object.assign(o, { type: fd.get('type'), label: fieldVal(fd, 'label') || TASK_TYPES[fd.get('type')].l, date: fd.get('date'), repeat: fd.get('repeat'), product: fieldVal(fd, 'product'), notes: fieldVal(fd, 'notes') });
        if (isNew) S.tasks.push(o);
      }
      save(); render(); toast(isNew ? `${ids.length} tâche(s) créée(s)` : 'Modifié');
    }
  });
}

// Marque la tâche faite et planifie l'occurrence suivante si elle se répète
function completeTask(task, date) {
  task.done = true; task.doneDate = date;
  const nd = nextDate(task.date, task.repeat);
  if (nd) { let d = nd; while (d < date) d = nextDate(d, task.repeat); S.tasks.push({ ...task, id: uid(), date: d, done: false, doneDate: null }); }
  return !!nd;
}
function doneForm(task) {
  if (task.type === 'constat') { logForm(task.treeId, null, 'constat', task.id); return; } // le constat de fruits EST la réalisation de la tâche
  const t = treeById(task.treeId), isPest = task.type === 'pesticide';
  sheet('Terminer : ' + esc(task.label), `
    <p class="muted">${esc(treeLabel(t))}</p>
    <label class="f">Date de réalisation<input type="date" name="date" value="${todayISO()}" required></label>
    <label class="f">Produit / dose utilisé<input name="product" value="${esc(task.product)}"></label>
    ${isPest ? '<label class="f">Délai avant récolte (jours) — voir l’étiquette<input name="dar" type="number" min="0"></label>' : ''}
    <label class="f">Remarque<textarea name="text"></textarea></label>
  `, {
    submitLabel: '✓ Terminé',
    onSubmit: fd => {
      const date = fd.get('date');
      const nd = completeTask(task, date);
      S.logs.push({ id: uid(), treeId: task.treeId, date, kind: isPest ? 'traitement' : 'travail', text: `${TASK_TYPES[task.type].i} ${task.label}${fieldVal(fd, 'text') ? ' — ' + fieldVal(fd, 'text') : ''}`, product: fieldVal(fd, 'product'), dar: isPest ? parseInt(fd.get('dar')) || 0 : 0, qty: null, taskId: task.id });
      save(); render(); toast(nd ? 'Terminé · prochaine occurrence planifiée' : 'Terminé');
    }
  });
}

function ficheForm(f, prefill) {
  const isNew = !f || !!prefill; f = f || { type: '', variety: '', floraison: [], recolte: [], plan: [] };
  const types = [...new Set(S.registry.map(x => x.type))].sort();
  const ta = (n, l, ph = '') => `<label class="f">${l}<textarea name="${n}" placeholder="${esc(ph)}">${esc(f[n])}</textarea></label>`;
  sheet(isNew ? 'Nouvelle fiche' : 'Fiche : ' + esc([f.type, f.variety].filter(Boolean).join(' · ')), `
    <div class="g2">${selNew('type', 'Type', types, f.type, '— Choisir —')}<label class="f">Variété (vide = fiche générale du type)<input name="variety" value="${esc(f.variety)}"></label></div>
    <p class="muted small">Les champs laissés vides héritent de la fiche générale du type.</p>
    ${ta('exposition', 'Exposition')}${ta('sol', 'Sol')}${ta('arrosage', 'Besoins en eau')}${ta('plantation', 'Plantation / écartement')}${ta('taille', 'Taille')}${ta('fertilisation', 'Fertilisation')}${ta('sante', 'Maladies & ravageurs')}${ta('remarques', 'Remarques')}
    <div id="fig-fields" class="${isFigType(f.type) ? '' : 'hide'}"><h3>🌿 Particularités du figuier</h3>
      <label class="f">Type de figuier<select name="figType"><option value="">— Non renseigné —</option>${Object.entries(FIG_TYPES).map(([k, v]) => opt(k, v, f.figType)).join('')}</select></label>
      <label class="f">Production<select name="bearing"><option value="">— Non renseignée —</option>${Object.entries(FIG_BEARING).map(([k, v]) => opt(k, v, f.bearing)).join('')}</select></label>
      <label class="f" style="color:var(--text)"><input type="checkbox" name="bacour" style="width:auto"${f.bacour ? ' checked' : ''}> Produit une 1re récolte (Bacour / figues-fleurs)</label>
      <label class="f">Pollinisation<select name="capri"><option value="">— Non renseignée —</option>${Object.entries(FIG_CAPRI).map(([k, v]) => opt(k, v, f.capri)).join('')}</select></label>
      <p class="muted small">Repères : Commun = autofertile ; Smyrne = caprification nécessaire ; San Pedro = caprification pour la 2e récolte seulement.</p></div>
    <h3>🌸 Floraison</h3>${monthChecks('floraison', f.floraison)}
    <h3>🧺 Période de récolte</h3>${monthChecks('recolte', f.recolte)}
    <h3>🗓️ Plan annuel type</h3><div id="plan-rows">${(f.plan || []).map(planRow).join('')}</div>
    <button type="button" class="btn sm" data-act="addPlanRow">+ Ajouter une action</button>
    ${isNew ? '' : '<button type="button" class="btn danger block" style="margin-top:14px" data-act="delFiche" data-id="' + f.id + '">Supprimer la fiche</button>'}
  `, {
    onSubmit: fd => {
      const type = selVal(fd, 'type'); if (!type) { toast('Type obligatoire'); return false; }
      const dup = S.registry.find(x => x.id !== f.id && norm(x.type) === norm(type) && norm(x.variety) === norm(fieldVal(fd, 'variety')));
      if (dup) { toast('Cette fiche existe déjà'); return false; }
      const o = isNew ? { id: uid() } : f, newVar = fieldVal(fd, 'variety');
      if (!isNew && (norm(f.type) !== norm(type) || norm(f.variety) !== norm(newVar))) { // renommer la fiche = ne pas orpheliner les arbres qui la portent
        const linked = S.trees.filter(t => norm(t.type) === norm(f.type) && norm(t.variety) === norm(f.variety));
        if (linked.length && confirm(`${linked.length} arbre(s) portent actuellement « ${f.type}${f.variety ? ' · ' + f.variety : ''} ». Les renommer aussi en « ${type}${newVar ? ' · ' + newVar : ''} » pour qu’ils gardent cette fiche ?`)) linked.forEach(t => { t.type = type; t.variety = newVar; });
      }
      Object.assign(o, { type, variety: newVar });
      for (const k of ['exposition', 'sol', 'arrosage', 'plantation', 'taille', 'fertilisation', 'sante', 'remarques']) o[k] = fieldVal(fd, k);
      if (isFigType(type)) { o.figType = fieldVal(fd, 'figType'); o.bearing = fieldVal(fd, 'bearing'); o.bacour = !!fd.get('bacour'); o.capri = fieldVal(fd, 'capri'); }
      o.floraison = fd.getAll('floraison').map(Number); o.recolte = fd.getAll('recolte').map(Number);
      const pm = fd.getAll('pm'), pt = fd.getAll('pt'), pl = fd.getAll('pl');
      o.plan = pm.map((m, i) => ({ month: +m, type: pt[i], label: (pl[i] || '').trim() || TASK_TYPES[pt[i]].l })).sort((a, b) => a.month - b.month);
      if (isNew) S.registry.push(o);
      save(); render(); toast('Fiche enregistrée');
    }
  });
}
const planRow = (p = { month: 1, type: 'taille', label: '' }) => `<div class="row" style="margin-bottom:6px"><select name="pm" style="width:84px">${MONTHS.map((m, i) => opt(i + 1, m, p.month)).join('')}</select>
  <select name="pt" style="width:110px">${Object.entries(TASK_TYPES).map(([k, v]) => opt(k, v.i + ' ' + v.l.split(' ')[0], p.type)).join('')}</select><input name="pl" value="${esc(p.label)}" placeholder="Intitulé"><button type="button" class="btn sm danger" data-act="rmRow">✕</button></div>`;

function rainForm() {
  sheet('🌧️ Pluie', `<p class="muted">Une pluie d’au moins 8 mm compte comme arrosage pour tous les arbres vivants (les compteurs d’arrosage repartent de cette date).</p>
    <div class="g2"><label class="f">Date<input type="date" name="date" value="${todayISO()}"></label><label class="f">Cumul (mm)<input name="mm" inputmode="decimal" required></label></div>`, {
    onSubmit: fd => {
      const mm = num(fd.get('mm')) || 0;
      if (mm < 8) { toast('Moins de 8 mm : arrosage toujours nécessaire'); return false; }
      for (const t of S.trees.filter(alive)) S.logs.push({ id: uid(), treeId: t.id, date: fd.get('date'), kind: 'irrigation', source: 'pluie', text: `Pluie ${mm} mm`, qty: null, product: '', dar: 0 });
      save(); render(); toast('Pluie enregistrée pour tous les arbres');
    }
  });
}

// ───────── Vues ─────────
function taskRow(t, showTree = true) {
  const tr = treeById(t.treeId), ty = TASK_TYPES[t.type] || TASK_TYPES.autre, late = !t.done && t.date < todayISO();
  return `<div class="task${t.done ? ' done' : ''}"><button class="ck" data-act="${t.done ? 'undoTask' : 'doneTask'}" data-id="${t.id}">${t.done ? '✓' : ''}</button>
    <div class="col" data-act="editTask" data-id="${t.id}"><div class="ellipsis">${ty.i} <b>${esc(t.label)}</b></div>
    <div class="small muted ellipsis">${showTree ? esc(treeLabel(tr)) + ' · ' : ''}${t.done ? 'fait le ' + fmtDate(t.doneDate) : `<span style="${late ? 'color:var(--danger);font-weight:600' : ''}">${rel(t.date)}</span> · ${fmtDate(t.date)}`}${t.repeat ? ' · 🔁' : ''}</div></div></div>`;
}
const treeThumb = (t, big) => `<div class="thumb${big ? ' big' : ''}" data-photo="${t.photoId || ''}">🌳</div>`;

function viewHome() {
  const t0 = todayISO(), live = S.trees.filter(alive), open = S.tasks.filter(x => !x.done && treeById(x.treeId));
  const byD = (a, b) => a.date.localeCompare(b.date);
  const overdue = open.filter(x => x.date < t0).sort(byD), today = open.filter(x => x.date === t0), soon = open.filter(x => x.date > t0 && x.date <= addDays(t0, 14)).sort(byD);
  const water = live.map(t => ({ t, n: nextWater(t) })).filter(x => x.n && x.n.date <= t0);
  const m = new Date().getMonth() + 1, harv = {};
  live.forEach(t => { if (harvestMonthsOf(t).includes(m)) { const k = treeFull(t); harv[k] = (harv[k] || 0) + 1; } });
  const dars = live.map(t => ({ t, d: darUntil(t) })).filter(x => x.d);
  const bk = S.settings.lastBackup, bkOld = S.trees.length && (!bk || diffDays(t0, bk) > 30);
  return `<h1>🌳 Mon jardin</h1>
    ${bkOld ? `<div class="banner">💾 ${bk ? 'Dernière sauvegarde il y a ' + diffDays(t0, bk) + ' jours.' : 'Aucune sauvegarde.'} Vos données ne sont que sur ce téléphone. <a href="#/plus">Sauvegarder</a></div>` : ''}
    ${!Sync.user && Sync.status !== 'nosdk' ? '<div class="banner">☁️ Synchronisation inactive — <a href="#/plus">se connecter</a></div>' : Sync.status === 'error' ? `<div class="banner danger">☁️ ${esc(Sync.err)}</div>` : ''}
    <div class="stats"><div class="stat"><b>${live.length}</b><span>arbres</span></div><div class="stat"><b style="color:${overdue.length ? 'var(--danger)' : 'inherit'}">${overdue.length}</b><span>en retard</span></div><div class="stat"><b style="color:${water.length ? 'var(--warn)' : 'inherit'}">${water.length}</b><span>à arroser</span></div></div>
    ${dars.map(x => `<div class="banner danger">⛔ <b>${esc(x.t.name)}</b> : ne pas récolter avant le ${fmtDate(x.d.date)} (${esc(x.d.product || 'traitement')}).</div>`).join('')}
    ${!live.length ? `<div class="empty">Aucun arbre pour l’instant.<br><br><a class="btn primary" data-act="newTree">+ Ajouter mon premier arbre</a></div>` : ''}
    ${water.length ? `<h2>💧 À arroser (${water.length}) <button class="btn sm right" data-act="waterAll">Tout arroser</button> <button class="btn sm" data-act="rain">🌧️</button></h2><div class="card">${water.map(({ t, n }) => `<div class="task"><button class="ck" data-act="water" data-id="${t.id}">💧</button><div class="col"><a href="#/arbre/${t.id}"><b>${esc(t.name)}</b></a><div class="small muted">${n.last ? 'Dernier : ' + fmtDate(n.last) + ' · retard ' + Math.max(0, diffDays(t0, n.date)) + ' j' : 'Jamais arrosé'} · ${t.irrig.litres || '?'} L</div></div></div>`).join('')}</div>` : (live.length ? `<button class="btn sm" data-act="rain">🌧️ Il a plu</button>` : '')}
    ${overdue.length ? `<h2>⚠️ En retard <button class="btn sm right" data-act="cleanOverdue">🧹 Nettoyer</button></h2><div class="card">${overdue.map(x => taskRow(x)).join('')}</div>` : ''}
    ${today.length ? `<h2>📌 Aujourd’hui</h2><div class="card">${today.map(x => taskRow(x)).join('')}</div>` : ''}
    <h2>🗓️ Dans les 14 jours</h2><div class="card">${soon.length ? soon.map(x => taskRow(x)).join('') : '<span class="muted">Rien de prévu.</span>'}</div>
    ${Object.keys(harv).length ? `<h2>🧺 Récoltes ce mois-ci</h2><div class="card">${Object.entries(harv).map(([k, n]) => `<div>${esc(k)} <span class="badge">${n} arbre${n > 1 ? 's' : ''}</span></div>`).join('')}</div>` : ''}`;
}

function viewTrees() {
  const types = [...new Set(S.trees.map(t => t.type))].sort(), zones = [...new Set(S.trees.map(t => t.zone).filter(Boolean))].sort();
  return `<h1>🌳 Arbres <span class="muted small">(${S.trees.length})</span></h1>
    <div class="tabs"><button class="on">☰ Liste</button><button data-act="goPlan">🗺️ Plan</button></div>
    <input id="q" type="search" placeholder="Rechercher (nom, type, variété, zone)…" value="${esc(ui.q)}" style="margin-bottom:8px">
    <div class="tabs"><button data-act="fType" data-v="" class="${!ui.fType ? 'on' : ''}">Tous</button>${types.map(x => `<button data-act="fType" data-v="${esc(x)}" class="${ui.fType === x ? 'on' : ''}">${esc(x)}</button>`).join('')}</div>
    ${zones.length ? `<div class="tabs"><button data-act="fZone" data-v="" class="${!ui.fZone ? 'on' : ''}">Toutes zones</button>${zones.map(x => `<button data-act="fZone" data-v="${esc(x)}" class="${ui.fZone === x ? 'on' : ''}">${esc(x)}</button>`).join('')}</div>` : ''}
    <div class="row" style="margin-bottom:10px"><button class="btn sm col" data-act="waterGroup">💧 Arrosage groupé</button><button class="btn sm col" data-act="harvestGroup">🧺 Récolte groupée</button></div>
    <div id="tlist">${treeList()}</div><button class="fab" data-act="newTree">+</button>`;
}
function treeList() {
  const q = norm(ui.q);
  const list = S.trees.filter(t => (!ui.fType || t.type === ui.fType) && (!ui.fZone || t.zone === ui.fZone) && (!q || norm([t.name, t.type, t.variety, t.zone].join(' ')).includes(q))).sort((a, b) => a.name.localeCompare(b.name));
  if (!list.length) return `<div class="empty">${S.trees.length ? 'Aucun résultat.' : 'Appuyez sur + pour ajouter un arbre.'}</div>`;
  const t0 = todayISO();
  return list.map(t => {
    const n = alive(t) ? nextWater(t) : null, late = S.tasks.filter(x => x.treeId === t.id && !x.done && x.date < t0).length, a = age(t);
    return `<a class="card row" href="#/arbre/${t.id}" style="color:inherit">${treeThumb(t)}<div class="col"><b class="ellipsis" style="display:block">${esc(t.name)}</b>
      <div class="small muted ellipsis">${esc(treeFull(t))}${a != null ? ' · ' + a + ' an' + (a > 1 ? 's' : '') : ''}${t.zone ? ' · ' + esc(t.zone) : ''}</div>
      <div>${t.status !== 'bon' ? `<span class="badge ${STATUS[t.status][1]}">${STATUS[t.status][0]}</span>` : ''}${late ? `<span class="badge danger">${late} en retard</span>` : ''}${n && n.date <= t0 ? '<span class="badge warn">💧 à arroser</span>' : ''}</div></div></a>`;
  }).join('');
}

function viewTree(id) {
  const t = treeById(id); if (!t) return '<div class="empty">Arbre introuvable. <a href="#/arbres">Retour</a></div>';
  const a = age(t), f = ficheOf(t), d = darUntil(t), n = nextWater(t);
  const tabs = [['fiche', 'Fiche'], ['journal', 'Journal'], ['taches', 'Tâches'], ['arrosage', 'Arrosage'], ['recoltes', 'Récoltes']];
  let body = '';
  const logs = S.logs.filter(l => l.treeId === id).sort((x, y) => y.date.localeCompare(x.date));
  if (ui.treeTab === 'fiche') {
    const sec = (l, v) => !isEmpty(v) ? `<details><summary>${l}</summary><p>${esc(v)}</p></details>` : '';
    body = `<div class="card"><div class="small">${t.row ? `Rangée : <b>${esc(t.row)}</b>${t.pos ? ' · n° <b>' + t.pos + '</b>' : ''}<br>` : ''}Plantation : <b>${t.year || '?'}</b>${a != null ? ` (${a} an${a > 1 ? 's' : ''})` : ''}<br>Zone : <b>${esc(t.zone || '—')}</b>${t.lat != null && t.lng != null ? ` · <a href="#/plan/${t.id}">🗺️ Voir sur le plan</a> · <a target="_blank" rel="noopener" href="https://www.google.com/maps?q=${t.lat},${t.lng}">📍 Itinéraire</a>` : ''}</div>${t.notes ? `<p style="white-space:pre-wrap">${esc(t.notes)}</p>` : ''}</div>
      <h2>📚 Fiche technique <button class="btn sm right" data-act="openFiche" data-type="${esc(t.type)}" data-var="${esc(t.variety)}">${f?._exact || (!t.variety && f) ? 'Modifier' : f ? 'Créer la fiche variété' : 'Créer la fiche'}</button></h2>
      ${f ? `<div class="card">${f.floraison?.length ? `<div class="small">🌸 Floraison : ${f.floraison.map(m => MONTHS[m - 1]).join(', ')}</div>` : ''}${f.recolte?.length ? `<div class="small">🧺 Récolte : ${f.recolte.map(m => MONTHS[m - 1]).join(', ')}</div>` : ''}
        ${isFigType(t.type) && (f.figType || f.bearing || f.capri || f.bacour) ? `<div style="margin:6px 0">${f.figType ? `<span class="badge">${FIG_TYPES[f.figType]}</span>` : ''}${f.bearing ? `<span class="badge">${f.bearing === 'bifere' ? 'Bifère' : 'Unifère'}</span>` : ''}${f.bacour ? '<span class="badge">1re récolte (Bacour)</span>' : ''}${f.capri ? `<span class="badge warn">${FIG_CAPRI[f.capri]}</span>` : ''}</div>` : ''}
        ${sec('☀️ Exposition', f.exposition)}${sec('🪨 Sol', f.sol)}${sec('💧 Besoins en eau', f.arrosage)}${sec('📏 Plantation', f.plantation)}${sec('✂️ Taille', f.taille)}${sec('🧪 Fertilisation', f.fertilisation)}${sec('🐛 Maladies & ravageurs', f.sante)}${sec('📝 Remarques', f.remarques)}</div>
        <p class="muted small">Fiche indicative : à adapter à votre microclimat. Vérifiez toujours les produits homologués et les délais avant récolte sur l’étiquette.</p>`
        : `<div class="empty">Aucune fiche pour « ${esc(t.type)} ». Créez-la dans le registre.</div>`}
      <button class="btn block" data-act="editTree" data-id="${id}">✏️ Modifier l’arbre</button>
      <button class="btn danger block" data-act="delTree" data-id="${id}">🗑️ Supprimer l’arbre</button>`;
  } else if (ui.treeTab === 'journal') {
    const L = ui.logFilter ? logs.filter(l => l.kind === ui.logFilter) : logs;
    body = `<div class="tabs"><button class="${!ui.logFilter ? 'on' : ''}" data-act="logFilter" data-v="">Tout</button>${Object.entries(LOG_KINDS).map(([k, v]) => `<button class="${ui.logFilter === k ? 'on' : ''}" data-act="logFilter" data-v="${k}">${v.i} ${v.l}</button>`).join('')}</div>
      <button class="btn primary block" data-act="newLog" data-id="${id}">+ Nouvelle entrée</button>
      <div class="card">${L.length ? L.map(l => `<div class="log" data-act="editLog" data-id="${l.id}"><div class="ic">${LOG_KINDS[l.kind].i}</div><div class="col"><div class="small muted">${fmtDate(l.date)} · ${LOG_KINDS[l.kind].l}${l.qty != null ? ` · ${l.qty} ${l.kind === 'recolte' ? 'kg' : 'L'}` : ''}${l.fruit != null ? ` · 🍎 <b style="color:${LEVEL_COLORS[l.fruit]}">${LEVELS[l.fruit]}</b>${l.crop ? ' (' + CROPS[l.crop] + ')' : ''}` : ''}</div><div style="white-space:pre-wrap">${esc(l.text)}</div>${l.product ? `<div class="small muted">🧴 ${esc(l.product)}${l.dar ? ` · DAR ${l.dar} j` : ''}</div>` : ''}</div>${l.photoId ? `<img data-photo="${l.photoId}" alt="">` : ''}</div>`).join('') : '<span class="muted">Aucune entrée.</span>'}</div>`;
  } else if (ui.treeTab === 'taches') {
    const tk = S.tasks.filter(x => x.treeId === id), op = tk.filter(x => !x.done).sort((p, q) => p.date.localeCompare(q.date)), dn = tk.filter(x => x.done).sort((p, q) => (q.doneDate || '').localeCompare(p.doneDate || '')).slice(0, 15);
    body = `<div class="row" style="margin-bottom:10px"><button class="btn primary col" data-act="newTaskFor" data-id="${id}">+ Tâche</button><button class="btn col" data-act="applyPlan" data-id="${id}">🗓️ Plan type</button></div>
      <div class="card">${op.length ? op.map(x => taskRow(x, false)).join('') : '<span class="muted">Aucune tâche à venir.</span>'}</div>${dn.length ? `<h2>Historique</h2><div class="card">${dn.map(x => taskRow(x, false)).join('')}</div>` : ''}`;
  } else if (ui.treeTab === 'arrosage') {
    const il = logs.filter(l => l.kind === 'irrigation'), y = new Date().getFullYear(), tot = il.filter(l => l.date.startsWith(y) && l.qty).reduce((s, l) => s + l.qty, 0);
    body = `<div class="card"><div>Rythme : <b>${waterInterval(t) ? 'tous les ' + waterInterval(t) + ' jours' : 'aucun arrosage prévu (saison actuelle)'}</b> · ${t.irrig.litres || '?'} L</div>
      <div class="small muted">Été : ${t.irrig.summerDays || 0} j · Reste de l’année : ${t.irrig.winterDays || 0} j</div>
      ${n ? `<div style="margin-top:6px">Prochain : <b>${fmtDate(n.date)}</b> <span class="muted">(${rel(n.date)})</span></div>` : ''}<div class="small muted">Dernier : ${lastWater(t) ? fmtDate(lastWater(t)) : '—'} · Eau saisie cette année : ${Math.round(tot)} L</div></div>
      <button class="btn primary block" data-act="water" data-id="${id}">💧 Arrosé aujourd’hui (${t.irrig.litres || 0} L)</button>
      <div class="card">${il.length ? il.slice(0, 40).map(l => `<div class="log" data-act="editLog" data-id="${l.id}"><div class="ic">${l.source === 'pluie' ? '🌧️' : '💧'}</div><div class="col">${fmtDate(l.date)}${l.qty ? ` · ${l.qty} L` : ''}<div class="small muted">${esc(l.text)}</div></div></div>`).join('') : '<span class="muted">Aucun arrosage enregistré.</span>'}</div>`;
  } else if (ui.treeTab === 'recoltes') {
    const hv = logs.filter(l => l.kind === 'recolte' && l.qty), by = {};
    const oil = {}; hv.forEach(l => { const y = l.date.slice(0, 4); by[y] = (by[y] || 0) + l.qty; if (l.oil) { oil[y] = oil[y] || { l: 0, kg: 0 }; oil[y].l += l.oil; oil[y].kg += l.qty; } });
    const ys = Object.keys(by).sort().reverse(), mx = Math.max(1, ...Object.values(by));
    const fy = fruitByYear(id), fYears = Object.keys(fy).sort().reverse();
    const fruitBlock = `<h2>🍎 Charge en fruits par année</h2><button class="btn primary block" data-act="newLog" data-id="${id}" data-kind="constat">+ Constat de fruits</button>
      <div class="card">${fYears.length ? fYears.map(y => Object.entries(fy[y]).sort().map(([c, v]) => `<div style="margin-bottom:8px"><div class="row"><b>${y}</b>${c ? `<span class="muted small">${CROPS[c]}</span>` : ''}<span class="right" style="color:${LEVEL_COLORS[v]};font-weight:600">${LEVELS[v]}</span></div><div class="bar" style="width:${(v + 1) / 7 * 100}%;background:${LEVEL_COLORS[v]}"></div></div>`).join('')).join('') : '<span class="muted">Aucun constat de fruits. Ajoutez un constat avec la quantité de fruits (idéalement avant la récolte).</span>'}</div>
      <p class="muted small">Dernier constat de l’année retenu. Comparez les années pour repérer l’alternance.</p>
      <h2>🧺 Quantités récoltées</h2>`;
    body = fruitBlock + `<button class="btn primary block" data-act="newLog" data-id="${id}" data-kind="recolte">+ Enregistrer une récolte</button>
      <p class="muted small">Alternance : comparez les années, les oliviers produisent souvent beaucoup une année sur deux. Rendement huile = litres × 0,916 / kg.</p><div class="card">${ys.length ? ys.map(y => `<div style="margin-bottom:8px"><div class="row"><b>${y}</b><span class="right">${Math.round(by[y] * 10) / 10} kg${oil[y] ? ` · ${Math.round(oil[y].l * 10) / 10} L d’huile (≈ ${Math.round(oil[y].l * 0.916 / oil[y].kg * 1000) / 10} %)` : ''}</span></div><div class="bar" style="width:${by[y] / mx * 100}%"></div></div>`).join('') : '<span class="muted">Aucune récolte enregistrée.</span>'}</div>`;
  }
  return `<div class="row" style="margin-bottom:8px"><a href="#/arbres" class="btn sm">← Arbres</a><span class="right"></span><button class="btn sm" data-act="editTree" data-id="${id}">✏️</button></div>
    ${treeThumb(t, true)}<h1 style="margin-bottom:2px">${esc(t.name)}</h1>
    <div class="muted">${esc(treeFull(t))}${a != null ? ` · ${a} an${a > 1 ? 's' : ''}` : ''} ${t.status !== 'bon' ? `<span class="badge ${STATUS[t.status][1]}">${STATUS[t.status][0]}</span>` : ''}</div>
    ${d ? `<div class="banner danger" style="margin-top:8px">⛔ Ne pas récolter avant le ${fmtDate(d.date)} (${esc(d.product || 'traitement')}).</div>` : ''}
    <div class="row" style="margin:10px 0"><button class="btn col" data-act="water" data-id="${id}">💧 Arrosé</button><button class="btn col" data-act="newLog" data-id="${id}">📝 Constat</button><button class="btn col" data-act="newTaskFor" data-id="${id}">+ Tâche</button></div>
    <div class="tabs">${tabs.map(([k, l]) => `<button class="${ui.treeTab === k ? 'on' : ''}" data-act="treeTab" data-v="${k}">${l}</button>`).join('')}</div>${body}`;
}

function calendarItems() { // date -> [{kind, ...}]
  const map = {};
  const push = (d, it) => (map[d] ||= []).push(it);
  S.tasks.forEach(t => { if (treeById(t.treeId)) push(t.done ? t.doneDate : t.date, { task: t }); });
  return map;
}
function viewCalendar() {
  const c = ui.cal, tabs = `<div class="tabs"><button class="${c.tab === 'mois' ? 'on' : ''}" data-act="calTab" data-v="mois">Mois</button><button class="${c.tab === 'annee' ? 'on' : ''}" data-act="calTab" data-v="annee">Année (cultural)</button></div>`;
  if (c.tab === 'annee') return `<h1>📅 Calendrier</h1>${tabs}${viewYear()}`;
  const map = calendarItems(), first = new Date(c.y, c.m, 1), start = (first.getDay() + 6) % 7, days = new Date(c.y, c.m + 1, 0).getDate(), t0 = todayISO();
  let cells = '';
  for (let i = 0; i < start; i++) cells += '<div></div>';
  for (let d = 1; d <= days; d++) {
    const ds = `${c.y}-${pad(c.m + 1)}-${pad(d)}`, its = map[ds] || [];
    cells += `<div class="d${ds === t0 ? ' today' : ''}${ds === c.sel ? ' sel' : ''}" data-act="calDay" data-v="${ds}"><b>${d}</b><div class="dots">${its.slice(0, 8).map(i => `<span class="dot" style="background:${TASK_TYPES[i.task.type]?.c};${i.task.done ? 'opacity:.35' : ''}"></span>`).join('')}</div></div>`;
  }
  const harv = {};
  S.trees.filter(alive).forEach(t => { if (harvestMonthsOf(t).includes(c.m + 1)) { const k = treeFull(t); harv[k] = (harv[k] || 0) + 1; } });
  const sel = c.sel && (map[c.sel] || []);
  return `<h1>📅 Calendrier</h1>${tabs}
    <div class="row" style="margin-bottom:8px"><button class="btn sm" data-act="calNav" data-v="-1">‹</button><b class="col" style="text-align:center;text-transform:capitalize">${first.toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' })}</b><button class="btn sm" data-act="calNav" data-v="1">›</button></div>
    ${Object.keys(harv).length ? `<div class="banner" style="background:var(--accent-l);color:var(--accent)">🧺 Récolte : ${Object.entries(harv).map(([k, n]) => `${esc(k)} (${n})`).join(' · ')}</div>` : ''}
    <div class="cal">${['L', 'M', 'M', 'J', 'V', 'S', 'D'].map(x => `<div class="h">${x}</div>`).join('')}${cells}</div>
    <div class="legend">${Object.values(TASK_TYPES).map(v => `<span><i style="background:${v.c}"></i>${v.l.split(' ')[0]}</span>`).join('')}</div>
    ${c.sel ? `<h2>${fmtDate(c.sel)} <button class="btn sm right" data-act="newTaskOn" data-v="${c.sel}">+ Tâche</button></h2><div class="card">${sel.length ? sel.map(i => taskRow(i.task)).join('') : '<span class="muted">Rien ce jour-là.</span>'}</div>` : '<p class="muted small">Touchez un jour pour voir ou ajouter des actions.</p>'}`;
}
function viewYear() {
  const groups = {};
  S.trees.filter(alive).forEach(t => { const k = treeFull(t); (groups[k] ||= []).push(t); });
  const keys = Object.keys(groups).sort(), cm = new Date().getMonth() + 1;
  if (!keys.length) return '<div class="empty">Ajoutez des arbres pour voir le calendrier cultural.</div>';
  const bars = [['recolte', 'Récolte', '#2f9e4f'], ['floraison', 'Floraison', '#e6779c'], ['taille', 'Taille', '#e08a1e'], ['pesticide', 'Traitement', '#d64545'], ['fertil', 'Engrais / compost', '#8a5a2b']];
  const row = k => {
    const f = ficheOf(groups[k][0]) || {}, plan = f.plan || [];
    const monthsOf = key => key === 'recolte' || key === 'floraison' ? f[key] || [] : key === 'fertil' ? plan.filter(p => ['engrais', 'compost'].includes(p.type)).map(p => p.month) : plan.filter(p => p.type === key).map(p => p.month);
    return `<tr><td class="lab">${esc(k)} <span class="muted">(${groups[k].length})</span></td>${MONTHS.map((_, i) => `<td class="${i + 1 === cm ? 'cur' : ''}">${bars.map(([key, , col]) => `<div class="b" style="background:${monthsOf(key).includes(i + 1) ? col : 'transparent'}"></div>`).join('')}</td>`).join('')}</tr>`;
  };
  return `<table class="yr"><tr><th></th>${MONTHS.map((m, i) => `<th class="${i + 1 === cm ? 'cur' : ''}">${m[0].toUpperCase()}</th>`).join('')}</tr>${keys.map(row).join('')}</table>
    <div class="legend">${bars.map(([, l, c]) => `<span><i style="background:${c}"></i>${l}</span>`).join('')}</div><p class="muted small">Issu des fiches du registre (périodes indicatives).</p>`;
}

function viewRegistry() {
  const q = norm(ui.regQ), by = {};
  S.registry.filter(f => !q || norm(f.type + ' ' + f.variety).includes(q)).forEach(f => (by[f.type] ||= []).push(f));
  const types = Object.keys(by).sort(), count = (type, v) => S.trees.filter(t => norm(t.type) === norm(type) && norm(t.variety) === norm(v)).length;
  return `<h1>📚 Registre des fiches</h1><input id="rq" type="search" placeholder="Rechercher un type ou une variété…" value="${esc(ui.regQ)}" style="margin-bottom:10px">
    ${types.map(ty => `<div class="card"><b>${esc(ty)}</b>${by[ty].sort((a, b) => a.variety.localeCompare(b.variety)).map(f => `<div class="task" data-act="editFiche" data-id="${f.id}"><div class="col"><div>${f.variety ? esc(f.variety) : '<i>Fiche générale</i>'}</div><div class="small muted">${f.recolte?.length ? '🧺 ' + f.recolte.map(m => MONTHS[m - 1]).join(', ') : 'récolte non renseignée'}${f.plan?.length ? ' · ' + f.plan.length + ' actions' : ''}</div></div><span class="badge">${count(ty, f.variety)} 🌳</span></div>`).join('')}</div>`).join('') || '<div class="empty">Aucune fiche.</div>'}
    <button class="fab" data-act="newFiche">+</button>`;
}

function syncCard() {
  const st = Sync.status;
  if (st === 'nosdk') return '<p class="small muted">Module Firebase non chargé (connexion nécessaire au premier lancement). Mode local uniquement.</p>';
  if (!Sync.user) return '<p class="small muted">Connectez-vous pour partager les données entre vos appareils et avec les personnes autorisées. Sans connexion, l’appli reste utilisable en local.</p><button class="btn primary block" data-act="syncLogin">Se connecter</button>';
  const pend = Sync.ready ? syncPending() : 0;
  const msg = st === 'ok' ? (pend ? `⏳ ${pend} modification(s) en attente d’envoi` : '✅ À jour — tout est confirmé par le serveur') : st === 'error' ? '⚠️ ' + esc(Sync.err) : (Date.now() - (Sync.t0 || 0) > 20000 ? `⏳ Pas de réponse du serveur depuis ${Math.round((Date.now() - Sync.t0) / 1000)} s (${COLS.filter(k => Sync.firstSnap[k]).length}/${COLS.length} collections reçues). Vérifiez le réseau (Wi-Fi ou 4G/5G). Vos données restent sur le téléphone et seront envoyées dès que la connexion aboutit.` : '⏳ Connexion au serveur…');
  return `<div>${esc(Sync.user.email)}</div><div class="small" style="margin:4px 0 10px">${msg}</div>${st === 'ok' ? '' : '<button class="btn block" data-act="syncRetry">🔄 Réessayer</button><button class="btn block" data-act="syncTest">🔍 Tester la connexion</button>'}<button class="btn block" data-act="syncLogout">Se déconnecter</button>`;
}
function viewMore() {
  const y = new Date().getFullYear(), hv = {};
  S.logs.filter(l => l.kind === 'recolte' && l.qty).forEach(l => { const tr = treeById(l.treeId); if (!tr) return; const k = tr.type, yy = l.date.slice(0, 4); ((hv[k] ||= {})[yy] = (hv[k][yy] || 0) + l.qty); });
  const yrs = [...new Set(Object.values(hv).flatMap(o => Object.keys(o)))].sort().slice(-4);
  const fr = {};
  S.trees.forEach(tr => { const f = fruitByYear(tr.id); for (const yy of Object.keys(f)) ((fr[tr.type] ||= {})[yy] ||= []).push(Math.max(...Object.values(f[yy]))); });
  const fYrs = [...new Set(Object.values(fr).flatMap(o => Object.keys(o)))].sort().slice(-4);
  return `<h1>⚙️ Plus</h1>
    <h2>☁️ Synchronisation</h2><div class="card">${syncCard()}</div>
    <h2>📊 Excel</h2><div class="card"><p class="small muted">Exportez la liste des arbres (et tout l’historique, en lecture seule) dans un classeur Excel, modifiez les données voulues (nom, année, zone, rangée, santé, position GPS, arrosage…), puis réimportez-le : l’appli montre les changements et demande confirmation avant d’appliquer.</p>
    <button class="btn primary block" data-act="xlsxExport">⬇️ Exporter les arbres (.xlsx)</button>
    <label class="btn block" style="cursor:pointer">⬆️ Importer un classeur modifié<input type="file" id="xlsimp" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" hidden></label>
    ${typeof IMPORT_UNDO !== 'undefined' && IMPORT_UNDO ? '<button class="btn block" data-act="xlsxUndo">↩️ Annuler le dernier import</button>' : ''}</div>
    <h2>💾 Sauvegarde</h2><div class="card"><p class="small muted">Les données sont stockées uniquement sur cet appareil. Sauvegardez régulièrement (fichier JSON avec photos) et gardez-le ailleurs (Drive, e-mail…).${S.settings.lastBackup ? '<br>Dernière : ' + fmtDate(S.settings.lastBackup) : ''}</p>
    <button class="btn primary block" data-act="export">⬇️ Exporter une sauvegarde</button>${navigator.canShare ? '<button class="btn block" data-act="share">📤 Partager la sauvegarde</button>' : ''}
    <label class="btn block" style="cursor:pointer">⬆️ Restaurer une sauvegarde<input type="file" id="imp" accept=".json,application/json" hidden></label></div>
    <h2>🔔 Rappels sur le téléphone</h2><div class="card"><p class="small muted">Exporte les tâches et périodes de récolte en fichier calendrier (.ics) à ouvrir avec Google Agenda / Apple Calendrier : notification la veille à 9 h, répétitions annuelles incluses. À refaire après avoir ajouté de nouvelles tâches.</p><button class="btn block" data-act="ics">📅 Exporter vers mon agenda (.ics)</button></div>
    <h2>📈 Récoltes (kg) par type</h2><div class="card">${yrs.length ? `<table class="yr" style="font-size:.85rem"><tr><th></th>${yrs.map(a => `<th>${a}</th>`).join('')}</tr>${Object.keys(hv).sort().map(k => `<tr><td class="lab">${esc(k)}</td>${yrs.map(a => `<td>${hv[k][a] ? Math.round(hv[k][a] * 10) / 10 : '—'}</td>`).join('')}</tr>`).join('')}</table>` : '<span class="muted">Aucune récolte saisie.</span>'}</div>
    <h2>🍎 Charge en fruits moyenne (0–6)</h2><div class="card">${fYrs.length ? `<table class="yr" style="font-size:.85rem"><tr><th></th>${fYrs.map(a => `<th>${a}</th>`).join('')}</tr>${Object.keys(fr).sort().map(k => `<tr><td class="lab">${esc(k)}</td>${fYrs.map(a => { const v = fr[k][a]; if (!v) return '<td>—</td>'; const m = v.reduce((p, q) => p + q, 0) / v.length; return `<td><b style="color:${LEVEL_COLORS[Math.round(m)]}">${lvlFR(m)}</b> <span class="muted">(${v.length})</span></td>`; }).join('')}</tr>`).join('')}</table><p class="muted small">0 = pas de fruits … 6 = énormément. Entre parenthèses : nombre d’arbres avec un constat.</p>` : '<span class="muted">Aucun constat de fruits.</span>'}</div>
    <h2>🛠️ Données</h2><div class="card"><button class="btn danger block" data-act="cleanOverdue">🧹 Nettoyer les tâches en retard (${S.tasks.filter(t => !t.done && t.date < todayISO()).length})</button>${TASKS_UNDO ? `<button class="btn block" data-act="undoDelTasks">↩️ Annuler le nettoyage (${TASKS_UNDO.removed.length + TASKS_UNDO.moved.length} tâches)</button>` : ''}<button class="btn block" data-act="mergeDefaults">Ajouter les fiches par défaut manquantes</button><button class="btn danger block" data-act="wipe">Tout effacer</button></div>
    <p class="muted small" style="text-align:center">Mes Arbres · version ${APP_VERSION} · fonctionne hors-ligne · ${y}</p>`;
}

// ───────── Export / import / ICS ─────────
async function buildBackup() {
  const photos = {};
  for (const k of await DB.keys('photos')) {
    const b = await DB.get('photos', k); if (!b) continue;
    photos[k] = await new Promise(r => { const fr = new FileReader(); fr.onload = () => r(fr.result); fr.readAsDataURL(b); });
  }
  S.settings.lastBackup = todayISO(); save();
  return new Blob([JSON.stringify({ app: 'mes-arbres', version: 1, exported: new Date().toISOString(), state: S, photos })], { type: 'application/json' });
}
const backupName = () => `mes-arbres-${todayISO()}.json`;
function download(blob, name) { const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 5000); }
async function importBackup(file) {
  const j = JSON.parse(await file.text());
  if (j.app !== 'mes-arbres' || !j.state) throw new Error('Fichier invalide');
  if (!confirm('Remplacer toutes les données actuelles par cette sauvegarde ? (Avec la synchronisation, les autres appareils seront alignés.)')) return;
  await DB.clear('photos'); photoURLs.clear();
  for (const [k, v] of Object.entries(j.photos || {})) await DB.put('photos', k, await (await fetch(v)).blob());
  S = j.state; await DB.put('kv', 'state', S); render(); toast('Sauvegarde restaurée');
}
function buildICS() {
  const esc2 = s => String(s || '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
  const D = s => s.replace(/-/g, ''), stamp = new Date().toISOString().replace(/[-:]/g, '').slice(0, 15) + 'Z';
  const RR = { y1: 'FREQ=YEARLY', m1: 'FREQ=MONTHLY', m3: 'FREQ=MONTHLY;INTERVAL=3', d14: 'FREQ=WEEKLY;INTERVAL=2', d7: 'FREQ=WEEKLY' };
  const ev = (uidv, start, end, title, desc, rr, alarm = true) => ['BEGIN:VEVENT', `UID:${uidv}@mes-arbres`, `DTSTAMP:${stamp}`, `DTSTART;VALUE=DATE:${D(start)}`, `DTEND;VALUE=DATE:${D(end)}`, `SUMMARY:${esc2(title)}`, desc ? `DESCRIPTION:${esc2(desc)}` : '', rr ? `RRULE:${rr}` : '',
    alarm ? 'BEGIN:VALARM\r\nTRIGGER:-PT15H\r\nACTION:DISPLAY\r\nDESCRIPTION:' + esc2(title) + '\r\nEND:VALARM' : '', 'END:VEVENT'].filter(Boolean).join('\r\n');
  const out = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Mes Arbres//FR', 'CALSCALE:GREGORIAN', 'X-WR-CALNAME:Mes Arbres'];
  S.tasks.filter(t => !t.done && treeById(t.treeId)).forEach(t => out.push(ev(t.id, t.date, addDays(t.date, 1), `${TASK_TYPES[t.type].i} ${t.label} — ${treeById(t.treeId).name}`, [t.product && 'Produit : ' + t.product, t.notes].filter(Boolean).join('\n'), RR[t.repeat])));
  const seen = new Set(), y = new Date().getFullYear();
  S.trees.filter(alive).forEach(t => {
    const k = treeFull(t); if (seen.has(k)) return; seen.add(k);
    monthRuns(harvestMonthsOf(t)).forEach(r => { const end = r.start + r.len - 1; out.push(ev('harv-' + norm(k) + r.start, `${y}-${pad(r.start)}-01`, end > 12 ? `${y + 1}-${pad(end - 12 + 1 > 12 ? 1 : end - 12 + 1)}-01` : `${end === 12 ? y + 1 : y}-${pad(end === 12 ? 1 : end + 1)}-01`, '🧺 Récolte : ' + k, '', 'FREQ=YEARLY', false)); });
  });
  out.push('END:VCALENDAR'); return new Blob([out.join('\r\n')], { type: 'text/calendar' });
}

// ───────── Actions ─────────
function logWater(t, qty, date = todayISO()) { S.logs.push({ id: uid(), treeId: t.id, date, kind: 'irrigation', text: 'Arrosage', qty: qty || null, product: '', dar: 0 }); save(); }
const actions = {
  closeSheet: closeSheet,
  newTree: () => treeForm(),
  editTree: ({ id }) => treeForm(treeById(id)),
  delTree: ({ id }) => { const t = treeById(id); if (!confirm(`Supprimer « ${t.name} » avec son journal et ses tâches ?\n(Pour un arbre mort, préférez le statut « Mort / retiré » afin de garder l’historique.)`)) return; S.logs.filter(l => l.treeId === id && l.photoId).forEach(l => delPhoto(l.photoId)); if (t.photoId) delPhoto(t.photoId); S.trees = S.trees.filter(x => x.id !== id); S.logs = S.logs.filter(l => l.treeId !== id); S.tasks = S.tasks.filter(x => x.treeId !== id); save(); location.hash = '#/arbres'; },
  gps: (_, el) => { const f = el.form; navigator.geolocation ? navigator.geolocation.getCurrentPosition(p => { f.lat.value = p.coords.latitude.toFixed(6); f.lng.value = p.coords.longitude.toFixed(6); }, () => toast('Position indisponible'), { enableHighAccuracy: true, timeout: 10000 }) : toast('GPS non supporté'); },
  fType: ({ v }) => { ui.fType = v; render(); },
  fZone: ({ v }) => { ui.fZone = v; render(); },
  waterGroup: waterGroupForm, harvestGroup: harvestGroupForm,
  pick: ({ v }, el) => { $$('input[name=trees]', el.form).forEach(c => (c.checked = v === '1')); updPick(el.form); },
  waterAll: () => { const t0 = todayISO(); let n = 0; S.trees.filter(alive).forEach(t => { const w = nextWater(t); if (w && w.date <= t0) { logWater(t, t.irrig?.litres); n++; } }); render(); toast(`💧 ${n} arbres arrosés`); },
  treeTab: ({ v }) => { ui.treeTab = v; render(); },
  logFilter: ({ v }) => { ui.logFilter = v; render(); },
  newLog: ({ id, kind }) => logForm(id, null, kind),
  editLog: ({ id }) => { sheet('Entrée', `<button type="button" class="btn block" data-act="editLog2" data-id="${id}">✏️ Modifier</button><button type="button" class="btn danger block" data-act="delLog" data-id="${id}">🗑️ Supprimer</button>`); },
  editLog2: ({ id }) => logForm(S.logs.find(x => x.id === id).treeId, S.logs.find(x => x.id === id)),
  delLog: ({ id }) => { if (!confirm('Supprimer cette entrée ?')) return; const l = S.logs.find(x => x.id === id); if (l.photoId) delPhoto(l.photoId); S.logs = S.logs.filter(x => x.id !== id); save(); closeSheet(); render(); },
  water: ({ id }) => { const t = treeById(id); logWater(t, t.irrig?.litres); render(); toast('💧 Arrosage enregistré'); },
  rain: rainForm,
  newTaskFor: ({ id }) => taskForm(null, { treeIds: [id] }),
  newTaskOn: ({ v }) => taskForm(null, { date: v }),
  editTask: ({ id }) => taskForm(S.tasks.find(x => x.id === id)),
  delTask: ({ id }) => { if (!confirm('Supprimer cette tâche ?')) return; S.tasks = S.tasks.filter(x => x.id !== id); save(); closeSheet(); render(); },
  doneTask: ({ id }) => doneForm(S.tasks.find(x => x.id === id)),
  undoTask: ({ id }) => { const t = S.tasks.find(x => x.id === id); t.done = false; t.doneDate = null; save(); render(); toast('Tâche rouverte'); },
  applyPlan: ({ id }) => { const n = ensurePlan(treeById(id)); save(); render(); toast(n ? `${n} tâche(s) ajoutée(s)` : 'Plan déjà à jour (ou fiche sans plan)'); },
  newFiche: () => ficheForm(),
  editFiche: ({ id }) => ficheForm(S.registry.find(x => x.id === id)),
  openFiche: ({ type, var: v }) => { const { exact, generic } = findFiches(type, v); if (exact) ficheForm(exact); else if (generic && !v) ficheForm(generic); else ficheForm({ type, variety: v, floraison: [], recolte: [], plan: [] }, true); },
  delFiche: ({ id }) => { if (!confirm('Supprimer cette fiche ?')) return; S.registry = S.registry.filter(x => x.id !== id); save(); closeSheet(); render(); },
  addPlanRow: () => $('#plan-rows').insertAdjacentHTML('beforeend', planRow()),
  rmRow: (_, el) => el.parentElement.remove(),
  calTab: ({ v }) => { ui.cal.tab = v; render(); },
  calNav: ({ v }) => { const d = new Date(ui.cal.y, ui.cal.m + +v, 1); ui.cal.y = d.getFullYear(); ui.cal.m = d.getMonth(); ui.cal.sel = null; render(); },
  calDay: ({ v }) => { ui.cal.sel = v; render(); },
  syncLogin: () => sheet('☁️ Connexion', `<label class="f">E-mail<input name="email" type="email" autocomplete="username" required value="${esc(S.settings.email || '')}"></label><label class="f">Mot de passe<input name="pass" type="password" autocomplete="current-password" required></label>`, {
    submitLabel: 'Se connecter', onSubmit: async fd => { try { await syncLogin(fieldVal(fd, 'email'), fd.get('pass')); S.settings.email = fieldVal(fd, 'email'); toast('Connecté'); } catch (e) { toast('Connexion refusée : ' + (e.code || e.message)); return false; } } }),
  syncRetry: () => { syncRetry(); toast('Nouvelle tentative…'); render(); },
  syncTest: async () => { sheet('🔍 Test de connexion', '<p class="muted">Test en cours…</p>'); const r = await syncTest(); sheet('🔍 Test de connexion', `<p class="muted small">Envoyez-moi ce texte tel quel.</p><pre style="white-space:pre-wrap;word-break:break-word;font-size:.8rem;user-select:text;-webkit-user-select:text">${esc(r)}</pre>`); },
  syncLogout: async () => { if (!confirm('Se déconnecter ? Les données restent sur ce téléphone mais ne seront plus synchronisées.')) return; await syncLogout(); toast('Déconnecté'); },
  export: async () => { download(await buildBackup(), backupName()); render(); toast('Sauvegarde exportée'); },
  share: async () => { const b = await buildBackup(), f = new File([b], backupName(), { type: 'application/json' }); if (navigator.canShare({ files: [f] })) navigator.share({ files: [f], title: 'Sauvegarde Mes Arbres' }).catch(() => {}); else toast('Partage non supporté'); },
  ics: () => download(buildICS(), 'mes-arbres.ics'),
  mergeDefaults: () => { const add = seedRegistry(S.registry); S.registry.push(...add); save(); toast(add.length + ' fiche(s) ajoutée(s)'); },
  cleanOverdue: () => {
    const t0 = todayISO(), od = S.tasks.filter(t => !t.done && t.date < t0);
    if (!od.length) { toast('Aucune tâche en retard'); return; }
    const rep = od.filter(t => t.repeat), one = od.length - rep.length, plan = od.filter(t => t.tplKey).length;
    sheet('🧹 Nettoyer les tâches en retard', `<p><b>${od.length}</b> tâche(s) en retard : <b>${one}</b> ponctuelle(s) et <b>${rep.length}</b> qui se répète(nt) (${plan} issue(s) du plan type).</p>
      <p class="small muted">Les tâches ponctuelles en retard seront supprimées. Les tâches terminées, les tâches à venir et le journal ne sont pas touchés.</p>
      ${rep.length ? `<div class="card" style="padding:10px"><b>Pour les ${rep.length} tâche(s) qui se répète(nt) :</b>
        <label style="display:block;color:var(--text);margin-top:8px"><input type="radio" name="rep" value="move" checked style="width:auto"> <b>Les reporter à leur prochaine occurrence</b> <span class="muted small">(recommandé : elles disparaissent des retards mais reviendront à la prochaine échéance, ex. l’an prochain)</span></label>
        <label style="display:block;color:var(--text);margin-top:8px"><input type="radio" name="rep" value="del" style="width:auto"> <b>Les supprimer définitivement</b> <span class="muted small">(la répétition s’arrête : elles ne reviendront plus sur ces arbres)</span></label></div>` : ''}
      <p class="small muted">Vous pourrez annuler tant que vous ne fermez pas l’appli.</p>`, {
      submitLabel: `Nettoyer (${od.length})`,
      onSubmit: fd => {
        const del = fd.get('rep') === 'del', undo = { removed: [], moved: [] };
        od.forEach(t => {
          if (t.repeat && !del) { let d = nextDate(t.date, t.repeat); while (d < t0) d = nextDate(d, t.repeat); undo.moved.push({ id: t.id, date: t.date }); t.date = d; }
          else { undo.removed.push({ ...t }); }
        });
        const gone = new Set(undo.removed.map(t => t.id)); S.tasks = S.tasks.filter(t => !gone.has(t.id));
        TASKS_UNDO = undo; save(); render(); toast(`${undo.removed.length} supprimée(s), ${undo.moved.length} reportée(s)`);
      }
    });
  },
  undoDelTasks: () => {
    const u = TASKS_UNDO; if (!u) return;
    S.tasks.push(...u.removed); u.moved.forEach(m => { const t = S.tasks.find(x => x.id === m.id); if (t) t.date = m.date; });
    TASKS_UNDO = null; save(); render(); toast('Nettoyage annulé');
  },
  wipe: async () => { if (!confirm('Effacer TOUTES les données (arbres, journal, tâches, fiches) ? Si la synchronisation est active, elles seront aussi supprimées sur les autres appareils.') || !confirm('Dernière confirmation : action irréversible.')) return; await DB.clear('photos'); photoURLs.clear(); S = { v: 1, trees: [], logs: [], tasks: [], registry: seedRegistry(), settings: {} }; save(); render(); }
};
document.addEventListener('click', e => {
  const el = e.target.closest('[data-act]'); if (!el) return;
  if (el.tagName === 'A' && el.getAttribute('href')) return;
  const fn = actions[el.dataset.act]; if (!fn) return;
  e.preventDefault(); e.stopPropagation(); fn(el.dataset, el);
});
document.addEventListener('change', e => {
  if (e.target.matches('select[data-new]')) {
    const f = e.target.form, n = e.target.dataset.new;
    f.elements[n + '_new'].classList.toggle('hide', e.target.value !== '__new');
    if (e.target.value === '__new') f.elements[n + '_new'].focus();
    if (n === 'type') { refreshVarieties(f); toggleFig(f); }
  }
  if (e.target.matches('select[data-pick]')) { const k = e.target.dataset.pick, v = e.target.value; if (v) $$('.checks label', e.target.form).forEach(l => { if (l.dataset[k] === v) $('input', l).checked = true; }); e.target.value = ''; updPick(e.target.form); }
  if (e.target.name === 'trees') updPick(e.target.form);
  if (e.target.matches('select[name=kind]')) syncKind(e.target);
  if (e.target.id === 'imp' && e.target.files[0]) importBackup(e.target.files[0]).catch(err => toast('Erreur : ' + err.message)).finally(() => (e.target.value = ''));
});
document.addEventListener('input', e => {
  if (e.target.name === 'type_new') { refreshVarieties(e.target.form); toggleFig(e.target.form); }
  if (e.target.id === 'q') { ui.q = e.target.value; $('#tlist').innerHTML = treeList(); hydrate($('#tlist')); }
  if (e.target.id === 'rq') { ui.regQ = e.target.value; const pos = e.target.selectionStart; render(); const i = $('#rq'); i.focus(); i.setSelectionRange(pos, pos); }
});

// ───────── Routage ─────────
function render() {
  if (!S) return;
  const parts = (location.hash.slice(1) || '/').split('/').filter(Boolean), r = parts[0] || 'home';
  let html;
  if (r === 'arbres') html = viewTrees(); else if (r === 'arbre') html = viewTree(parts[1]); else if (r === 'calendrier') html = viewCalendar();
  else if (r === 'registre') html = viewRegistry(); else if (r === 'plus') html = viewMore(); else if (r === 'plan') html = viewPlan(parts[1]); else if (r === 'tableau') html = viewDash(parts[1] ? decodeURIComponent(parts[1]) : ''); else html = viewHome();
  const y = window.scrollY;
  $('#view').innerHTML = html;
  const nav = r === 'arbre' || r === 'plan' ? 'arbres' : r;
  $$('#nav a').forEach(a => a.classList.toggle('on', a.dataset.nav === nav));
  hydrate($('#view'));
  if (r === 'plan') initMap(); else if (typeof destroyMap === 'function') destroyMap();
  if (render.last === location.hash) window.scrollTo(0, y); else window.scrollTo(0, 0);
  render.last = location.hash;
}
window.addEventListener('hashchange', () => { closeSheet(); render(); });
async function init() {
  try { await DB.open(); await loadState(); } catch (e) { $('#view').innerHTML = `<div class="empty">Stockage indisponible : ${esc(e.message)}<br>Désactivez la navigation privée.</div>`; return; }
  render();
  syncInit();
  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
    const hadController = !!navigator.serviceWorker.controller; let reloading = false;
    navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).then(reg => {
      document.addEventListener('visibilitychange', () => { if (!document.hidden) reg.update().catch(() => {}); }); // cherche une mise à jour à chaque retour dans l'appli
    }).catch(() => {});
    navigator.serviceWorker.addEventListener('controllerchange', () => { // nouvelle version prise en charge → rechargement (sauf saisie en cours)
      if (!hadController || reloading) return;
      if ($('#sheet').hidden) { reloading = true; location.reload(); } else toast('Mise à jour disponible — fermez puis rouvrez l’appli');
    });
  }
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
