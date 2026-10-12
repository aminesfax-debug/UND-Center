'use strict';
/* Synchronisation Firestore (optionnelle). L'appli reste « local d'abord » : IndexedDB est la référence
   de lecture, Firestore sert de copie partagée entre appareils (dernier écrit gagne, par document). */
const COLS = ['trees', 'logs', 'tasks', 'registry'];
const cname = c => 'arb_' + c;
const Sync = { inflight: {}, on: false, ready: false, fs: null, auth: null, user: null, status: 'off', err: '', synced: {}, seen: {}, firstSnap: {}, unsub: [], photoSynced: new Set(), dirty: false };
const stable = o => JSON.stringify(o, (k, v) => (v && typeof v === 'object' && !Array.isArray(v) ? Object.keys(v).sort().reduce((a, x) => ((a[x] = v[x]), a), {}) : v));
const clean = o => JSON.parse(JSON.stringify(o));

function syncAvailable() { return typeof firebase !== 'undefined' && typeof FB_CONFIG !== 'undefined'; }
function setStatus(s, err = '') { Sync.status = s; Sync.err = err; if (location.hash === '#/plus' && typeof render === 'function' && $('#sheet').hidden) render(); }

async function syncInit() {
  if (!syncAvailable()) { Sync.status = 'nosdk'; return; }
  try {
    if (!firebase.apps.length) firebase.initializeApp(FB_CONFIG);
    Sync.auth = firebase.auth(); Sync.fs = firebase.firestore();
    // Safari/iOS : le canal par défaut de Firestore (WebChannel / flux) est souvent bloqué → on impose le « long polling » (requêtes classiques)
    try { Sync.fs.settings({ experimentalForceLongPolling: true, useFetchStreams: false, merge: true }); } catch (e) { /* ignoré */ }
    try { await Sync.fs.enablePersistence({ synchronizeTabs: true }); } catch (e) { /* plusieurs onglets / navigateur non supporté : on continue */ }
    Sync.auth.onAuthStateChanged(u => { Sync.user = u; if (u) syncStart(); else syncStop(); if (typeof render === 'function') render(); });
  } catch (e) { Sync.status = 'error'; Sync.err = e.message; }
}
async function syncLogin(email, pass) { await Sync.auth.signInWithEmailAndPassword(email, pass); }
async function syncLogout() { await Sync.auth.signOut(); }

async function syncStart() {
  syncStop();
  Sync.on = true; Sync.ready = false; Sync.status = 'sync'; Sync.err = '';
  Sync.t0 = Date.now(); clearTimeout(Sync.slow); Sync.slow = setTimeout(() => { if (Sync.on && !Sync.ready) setStatus('sync'); }, 20000);
  const key = 'synced:' + Sync.user.uid;
  const saved = (await DB.get('kv', key)) || {};
  COLS.forEach(c => { Sync.inflight[c] = {}; Sync.synced[c] = saved[c] || {}; Sync.seen[c] = false; Sync.firstSnap[c] = false; });
  Sync.photoSynced = new Set(saved.photos || []); Sync.key = key;
  COLS.forEach(c => Sync.unsub.push(Sync.fs.collection(cname(c)).onSnapshot(snap => applyRemote(c, snap), e => setStatus('error', e.code === 'permission-denied' ? 'Accès refusé par les règles Firestore (e-mail non autorisé ou règles non publiées).' : e.message))));
}
// Test de connexion indépendant du SDK : interroge Firestore en REST avec votre jeton et affiche la réponse brute.
async function syncTest() {
  const out = [`Appli ${typeof APP_VERSION !== 'undefined' ? APP_VERSION : ''} · navigateur : ${navigator.onLine ? 'en ligne' : 'HORS LIGNE'}`];
  try {
    const tok = await Sync.user.getIdToken(); out.push('Connexion au compte : OK');
    const url = `https://firestore.googleapis.com/v1/projects/${FB_CONFIG.projectId}/databases/(default)/documents/arb_trees?pageSize=1`;
    const t0 = Date.now(), r = await fetch(url, { headers: { Authorization: 'Bearer ' + tok } }), txt = await r.text();
    out.push(`Firestore (REST) : HTTP ${r.status} en ${Date.now() - t0} ms`, txt.replace(/\s+/g, ' ').slice(0, 500));
  } catch (e) { out.push('Échec : ' + e.message); }
  return out.join('\n');
}
function syncRetry() { if (Sync.user) syncStart(); }
function syncStop() { clearTimeout(Sync.slow); Sync.unsub.forEach(f => f()); Sync.unsub = []; Sync.on = false; Sync.ready = false; Sync.status = 'off'; }

function applyRemote(c, snap) {
  if (!S) return;
  let changed = false;
  const list = S[c], idx = id => list.findIndex(x => x.id === id);
  // Règle d'or : une modification locale non confirmée par le serveur n'est JAMAIS écrasée par une version distante.
  snap.docChanges().forEach(ch => {
    if (ch.doc.metadata.hasPendingWrites) return; // écho de notre propre écriture
    const id = ch.doc.id, i = idx(id), local = i >= 0 ? list[i] : null, sj = Sync.synced[c][id];
    const localDirty = !!local && stable(local) !== sj;
    if (ch.type === 'removed') {
      if (local && !localDirty) { list.splice(i, 1); changed = true; }
      delete Sync.synced[c][id]; // si l'élément local est modifié, il sera ré-envoyé
      return;
    }
    const d = ch.doc.data(), j = stable(d);
    if (localDirty && !(sj === undefined && id.startsWith('def-'))) return; // le local gagne, il sera envoyé
    if (local) { if (stable(local) !== j) { list[i] = d; changed = true; } } else { list.push(d); changed = true; }
    Sync.synced[c][id] = j;
  });
  if (!snap.metadata.fromCache) {
    if (!Sync.seen[c]) { // 1re réponse du serveur : un élément confirmé puis disparu du serveur a été supprimé ailleurs
      Sync.seen[c] = true;
      const ids = new Set(snap.docs.map(d => d.id));
      for (const id of Object.keys(Sync.synced[c])) if (!ids.has(id)) {
        const i = idx(id);
        if (i >= 0 && stable(list[i]) === Sync.synced[c][id]) { list.splice(i, 1); changed = true; }
        delete Sync.synced[c][id];
      }
    }
    Sync.firstSnap[c] = true;
    if (!Sync.ready && COLS.every(k => Sync.firstSnap[k])) { Sync.ready = true; setStatus('ok'); DB.put('kv', 'state', S); pushDiff(); pushPhotos(); }
  }
  if (changed) { DB.put('kv', 'state', S); saveSynced(); softRender(); }
}

// Un élément n'est « synchronisé » qu'après confirmation du serveur (commit résolu).
function pushDiff() {
  if (!Sync.on || !Sync.ready) return;
  const ops = [];
  for (const c of COLS) {
    const cur = new Map(S[c].map(x => [x.id, x]));
    for (const [id, x] of cur) { const j = stable(x); if (Sync.synced[c][id] !== j && Sync.inflight[c][id] !== j) ops.push({ op: 'set', c, id, j, data: clean(x) }); }
    for (const id of Object.keys(Sync.synced[c])) if (!cur.has(id) && Sync.inflight[c][id] !== '__del') ops.push({ op: 'del', c, id, j: '__del' });
  }
  for (let i = 0; i < ops.length; i += 400) {
    const chunk = ops.slice(i, i + 400), batch = Sync.fs.batch();
    chunk.forEach(o => { Sync.inflight[o.c][o.id] = o.j; const ref = Sync.fs.collection(cname(o.c)).doc(o.id); o.op === 'set' ? batch.set(ref, o.data) : batch.delete(ref); });
    batch.commit().then(() => {
      chunk.forEach(o => { delete Sync.inflight[o.c][o.id]; if (o.op === 'set') Sync.synced[o.c][o.id] = o.j; else delete Sync.synced[o.c][o.id]; });
      saveSynced(); if (!syncPending()) setStatus('ok');
    }).catch(e => {
      chunk.forEach(o => delete Sync.inflight[o.c][o.id]); // restera « en attente » et sera ré-essayé
      setStatus('error', e.code === 'permission-denied' ? 'Écriture refusée par les règles Firestore.' : e.message);
    });
  }
}
// Nombre de modifications locales pas encore confirmées par le serveur
function syncPending() {
  let n = 0;
  for (const c of COLS) {
    const cur = new Set();
    for (const x of S[c]) { cur.add(x.id); if (Sync.synced[c][x.id] !== stable(x)) n++; }
    for (const id of Object.keys(Sync.synced[c])) if (!cur.has(id)) n++;
  }
  return n;
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
