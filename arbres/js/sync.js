'use strict';
/* Synchronisation Firestore (optionnelle). L'appli reste « local d'abord » : IndexedDB est la référence
   de lecture, Firestore sert de copie partagée entre appareils (dernier écrit gagne, par document). */
const COLS = ['trees', 'logs', 'tasks', 'registry'];
const cname = c => 'arb_' + c;
const Sync = { on: false, ready: false, fs: null, auth: null, user: null, status: 'off', err: '', synced: {}, seen: {}, firstSnap: {}, unsub: [], photoSynced: new Set(), dirty: false };
const stable = o => JSON.stringify(o, (k, v) => (v && typeof v === 'object' && !Array.isArray(v) ? Object.keys(v).sort().reduce((a, x) => ((a[x] = v[x]), a), {}) : v));
const clean = o => JSON.parse(JSON.stringify(o));

function syncAvailable() { return typeof firebase !== 'undefined' && typeof FB_CONFIG !== 'undefined'; }
function setStatus(s, err = '') { Sync.status = s; Sync.err = err; if (location.hash === '#/plus' && typeof render === 'function' && $('#sheet').hidden) render(); }

async function syncInit() {
  if (!syncAvailable()) { Sync.status = 'nosdk'; return; }
  try {
    if (!firebase.apps.length) firebase.initializeApp(FB_CONFIG);
    Sync.auth = firebase.auth(); Sync.fs = firebase.firestore();
    try { await Sync.fs.enablePersistence({ synchronizeTabs: true }); } catch (e) { /* plusieurs onglets / navigateur non supporté : on continue */ }
    Sync.auth.onAuthStateChanged(u => { Sync.user = u; if (u) syncStart(); else syncStop(); if (typeof render === 'function') render(); });
  } catch (e) { Sync.status = 'error'; Sync.err = e.message; }
}
async function syncLogin(email, pass) { await Sync.auth.signInWithEmailAndPassword(email, pass); }
async function syncLogout() { await Sync.auth.signOut(); }

async function syncStart() {
  syncStop();
  Sync.on = true; Sync.ready = false; Sync.status = 'sync'; Sync.err = '';
  const key = 'synced:' + Sync.user.uid;
  const saved = (await DB.get('kv', key)) || {};
  COLS.forEach(c => { Sync.synced[c] = saved[c] || {}; Sync.seen[c] = false; Sync.firstSnap[c] = false; });
  Sync.photoSynced = new Set(saved.photos || []); Sync.key = key;
  COLS.forEach(c => Sync.unsub.push(Sync.fs.collection(cname(c)).onSnapshot(snap => applyRemote(c, snap), e => setStatus('error', e.code === 'permission-denied' ? 'Accès refusé par les règles Firestore (e-mail non autorisé ou règles non publiées).' : e.message))));
}
function syncStop() { Sync.unsub.forEach(f => f()); Sync.unsub = []; Sync.on = false; Sync.ready = false; Sync.status = 'off'; }

function applyRemote(c, snap) {
  if (!S) return;
  let changed = false;
  const list = S[c], idx = id => list.findIndex(x => x.id === id);
  snap.docChanges().forEach(ch => {
    if (ch.doc.metadata.hasPendingWrites) return; // écho de notre propre écriture
    const id = ch.doc.id;
    if (ch.type === 'removed') { const i = idx(id); if (i >= 0) { list.splice(i, 1); changed = true; } delete Sync.synced[c][id]; return; }
    const d = ch.doc.data(), j = stable(d), i = idx(id);
    if (i >= 0) { if (stable(list[i]) !== j) { list[i] = d; changed = true; } } else { list.push(d); changed = true; }
    Sync.synced[c][id] = j;
  });
  if (!snap.metadata.fromCache) {
    if (!Sync.seen[c]) { // 1re réponse du serveur : ce qu'on croyait synchronisé mais qui a disparu côté serveur a été supprimé ailleurs
      Sync.seen[c] = true;
      const ids = new Set(snap.docs.map(d => d.id));
      for (const id of Object.keys(Sync.synced[c])) if (!ids.has(id)) { const i = idx(id); if (i >= 0) { list.splice(i, 1); changed = true; } delete Sync.synced[c][id]; }
    }
    Sync.firstSnap[c] = true;
    if (!Sync.ready && COLS.every(k => Sync.firstSnap[k])) { Sync.ready = true; setStatus('ok'); DB.put('kv', 'state', S); pushDiff(); pushPhotos(); }
  }
  if (changed) { DB.put('kv', 'state', S); softRender(); }
}

function pushDiff() {
  if (!Sync.on || !Sync.ready) return;
  const ops = [];
  for (const c of COLS) {
    const cur = new Map(S[c].map(x => [x.id, x]));
    for (const [id, x] of cur) { const j = stable(x); if (Sync.synced[c][id] !== j) { ops.push(['set', c, id, clean(x)]); Sync.synced[c][id] = j; } }
    for (const id of Object.keys(Sync.synced[c])) if (!cur.has(id)) { ops.push(['del', c, id]); delete Sync.synced[c][id]; }
  }
  saveSynced();
  for (let i = 0; i < ops.length; i += 400) {
    const batch = Sync.fs.batch();
    ops.slice(i, i + 400).forEach(([op, c, id, data]) => { const ref = Sync.fs.collection(cname(c)).doc(id); op === 'set' ? batch.set(ref, data) : batch.delete(ref); });
    batch.commit().catch(e => setStatus('error', e.code === 'permission-denied' ? 'Écriture refusée par les règles Firestore.' : e.message));
  }
}
function saveSynced() { if (Sync.key) DB.put('kv', Sync.key, { ...Sync.synced, photos: [...Sync.photoSynced] }); }

// Photos : un document par photo (image réduite, < 1 Mo), chargée à la demande sur les autres appareils
const blobToDataURL = b => new Promise(r => { const fr = new FileReader(); fr.onload = () => r(fr.result); fr.readAsDataURL(b); });
async function cloudPutPhoto(id, blob) {
  if (!Sync.on || Sync.photoSynced.has(id)) return;
  try { await Sync.fs.collection('arb_photos').doc(id).set({ data: await blobToDataURL(blob) }); Sync.photoSynced.add(id); saveSynced(); } catch (e) { /* réessayé au prochain démarrage */ }
}
async function pushPhotos() { for (const id of await DB.keys('photos')) { if (Sync.photoSynced.has(id)) continue; const b = await DB.get('photos', id); if (b) await cloudPutPhoto(id, b); } }
async function cloudGetPhoto(id) {
  if (!Sync.on) return null;
  try { const d = await Sync.fs.collection('arb_photos').doc(id).get(); if (!d.exists) return null; const b = await (await fetch(d.data().data)).blob(); await DB.put('photos', id, b); Sync.photoSynced.add(id); return b; } catch (e) { return null; }
}
function cloudDelPhoto(id) { if (Sync.on) { Sync.fs.collection('arb_photos').doc(id).delete().catch(() => {}); Sync.photoSynced.delete(id); } }

// Rendu différé si l'utilisateur est en train de saisir
function softRender() {
  const a = document.activeElement;
  if (!$('#sheet').hidden || (a && /INPUT|TEXTAREA|SELECT/.test(a.tagName))) { Sync.dirty = true; return; }
  render();
}
