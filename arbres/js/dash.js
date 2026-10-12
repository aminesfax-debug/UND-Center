'use strict';
/* Tableau de bord par catégorie d'arbres (type) : #/tableau puis #/tableau/<Type> */
const STATUS_COLORS = { bon: '#2f8f4f', surveiller: '#e0a21e', malade: '#d64545', mort: '#9aa5a0' };
const thisYear = () => String(new Date().getFullYear());
const fmt1 = n => (Math.round(n * 10) / 10).toString().replace('.', ',');
const lvlName = v => LEVELS[Math.min(6, Math.max(0, Math.round(v)))];
const lvlColor = v => LEVEL_COLORS[Math.min(6, Math.max(0, Math.round(v)))];
const treeFruitYear = t => { const f = fruitByYear(t.id); return Object.fromEntries(Object.entries(f).map(([y, o]) => [y, Math.max(...Object.values(o))])); };

// Moyenne de charge en fruits par année pour un groupe d'arbres → { année: {avg, n} }
function fruitAvg(trees) {
  const acc = {};
  trees.forEach(t => { const f = treeFruitYear(t); for (const y of Object.keys(f)) (acc[y] ||= []).push(f[y]); });
  return Object.fromEntries(Object.entries(acc).map(([y, a]) => [y, { avg: a.reduce((s, v) => s + v, 0) / a.length, n: a.length }]));
}
// Récolte par année pour un groupe d'arbres → { année: {kg, n, oil, oilKg} }
function harvestByYear(trees) {
  const ids = new Set(trees.map(t => t.id)), out = {};
  S.logs.filter(l => l.kind === 'recolte' && l.qty && ids.has(l.treeId)).forEach(l => {
    const y = l.date.slice(0, 4), o = (out[y] ||= { kg: 0, trees: new Set(), oil: 0, oilKg: 0 });
    o.kg += l.qty; o.trees.add(l.treeId); if (l.oil) { o.oil += l.oil; o.oilKg += l.qty; }
  });
  Object.values(out).forEach(o => (o.n = o.trees.size));
  return out;
}
function groupStats(trees) {
  const live = trees.filter(alive), t0 = todayISO(), ids = new Set(live.map(t => t.id));
  const st = { bon: 0, surveiller: 0, malade: 0, mort: 0 }; trees.forEach(t => (st[t.status] = (st[t.status] || 0) + 1));
  const ages = live.map(age).filter(a => a != null);
  return {
    n: trees.length, live: live.length, st, avgAge: ages.length ? ages.reduce((s, v) => s + v, 0) / ages.length : null,
    water: live.filter(t => { const w = nextWater(t); return w && w.date <= t0; }).length,
    late: S.tasks.filter(x => !x.done && x.date < t0 && ids.has(x.treeId)).length,
    unplaced: live.filter(t => !hasPos(t)).length,
    fruit: fruitAvg(live), harvest: harvestByYear(trees)
  };
}
const statusBar = st => { const tot = Object.values(st).reduce((s, v) => s + v, 0) || 1; return `<div style="display:flex;height:10px;border-radius:5px;overflow:hidden;background:var(--border)">${Object.entries(st).filter(([, v]) => v).map(([k, v]) => `<span title="${esc(STATUS[k] ? STATUS[k][0] : k)} : ${v}" style="width:${v / tot * 100}%;background:${STATUS_COLORS[k]}"></span>`).join('')}</div>`; };
const trend = (cur, prev) => (cur == null || prev == null ? '' : Math.abs(cur - prev) < 0.25 ? ' <span class="muted">→ stable</span>' : cur > prev ? ' <span style="color:var(--accent)">▲</span>' : ' <span style="color:var(--danger)">▼</span>');

function viewDash(type) {
  if (type) return viewDashType(type);
  const types = [...new Set(S.trees.map(t => t.type))].sort((a, b) => S.trees.filter(t => t.type === b).length - S.trees.filter(t => t.type === a).length || a.localeCompare(b));
  if (!types.length) return '<h1>📊 Tableau de bord</h1><div class="empty">Ajoutez des arbres pour voir le tableau de bord.</div>';
  const all = groupStats(S.trees), y = thisYear(), py = String(+y - 1), m = new Date().getMonth() + 1;
  return `<h1>📊 Tableau de bord</h1>
    <div class="stats" style="grid-template-columns:repeat(4,1fr)"><div class="stat"><b>${all.live}</b><span>arbres vivants</span></div><div class="stat"><b>${types.length}</b><span>catégories</span></div>
      <div class="stat"><b style="color:${all.water ? 'var(--warn)' : 'inherit'}">${all.water}</b><span>à arroser</span></div><div class="stat"><b style="color:${all.late ? 'var(--danger)' : 'inherit'}">${all.late}</b><span>tâches en retard</span></div></div>
    <h2>Par catégorie</h2>
    <div class="dgrid">${types.map(ty => {
      const trees = S.trees.filter(t => t.type === ty), s = groupStats(trees), f = s.fruit[y], fp = s.fruit[py], h = s.harvest[y], hp = s.harvest[py];
      const inSeason = trees.some(t => alive(t) && harvestMonthsOf(t).includes(m)), probs = s.st.surveiller + s.st.malade;
      return `<a class="card dcard" href="#/tableau/${encodeURIComponent(ty)}" style="color:inherit;display:block">
        <div class="row"><b style="font-size:1.05rem">${esc(ty)}</b><span class="badge right">${s.live} arbre${s.live > 1 ? 's' : ''}</span></div>
        <div style="margin:8px 0">${statusBar(s.st)}</div>
        <div class="small muted">${probs ? `<span style="color:${s.st.malade ? 'var(--danger)' : 'var(--warn)'}">${probs} à surveiller / malade(s)</span> · ` : ''}${s.avgAge != null ? 'âge moyen ' + fmt1(s.avgAge) + ' ans' : ''}${s.water ? ` · <span style="color:var(--warn)">💧 ${s.water} à arroser</span>` : ''}${s.late ? ` · <span style="color:var(--danger)">${s.late} tâche(s) en retard</span>` : ''}</div>
        <div style="margin-top:8px;font-size:.88rem">${f ? `🍎 Fruits ${y} : <b style="color:${lvlColor(f.avg)}">${lvlName(f.avg)}</b> <span class="muted">(${fmt1(f.avg)}/6 · ${f.n} arbre${f.n > 1 ? 's' : ''})</span>${fp ? trend(f.avg, fp.avg) : ''}` : `🍎 Fruits ${y} : <span class="muted">pas de constat</span>`}</div>
        <div style="font-size:.88rem">🧺 Récolte ${y} : ${h ? `<b>${fmt1(h.kg)} kg</b> <span class="muted">(${fmt1(h.kg / h.n)} kg/arbre)</span>${hp ? ` <span class="muted">· ${py} : ${fmt1(hp.kg)} kg</span>` : ''}` : `<span class="muted">${hp ? py + ' : ' + fmt1(hp.kg) + ' kg' : 'aucune saisie'}</span>`}${inSeason ? ' <span class="badge">en saison</span>' : ''}</div>
      </a>`; }).join('')}</div>
    <div class="legend">${Object.entries(STATUS).map(([k, v]) => `<span><i style="background:${STATUS_COLORS[k]}"></i>${v[0]}</span>`).join('')}</div>`;
}

function viewDashType(type) {
  const trees = S.trees.filter(t => t.type === type); if (!trees.length) return `<div class="empty">Catégorie introuvable. <a href="#/tableau">Retour</a></div>`;
  const s = groupStats(trees), live = trees.filter(alive), t0 = todayISO(), y = thisYear(), py = String(+y - 1);
  const barRows = (rows, max, colorFn, fmtFn) => rows.map(r => `<div style="margin-bottom:8px"><div class="row"><b>${esc(r.label)}</b><span class="right small">${fmtFn(r)}</span></div><div class="bar" style="width:${Math.max(3, r.v / max * 100)}%;background:${colorFn(r)}"></div></div>`).join('');
  // Charge en fruits par année
  const fy = Object.entries(s.fruit).sort(([a], [b]) => b.localeCompare(a));
  // Récoltes par année
  const hy = Object.entries(s.harvest).sort(([a], [b]) => b.localeCompare(a)), hmax = Math.max(1, ...hy.map(([, o]) => o.kg));
  // Variétés
  const vars = [...new Set(live.map(t => t.variety || ''))].sort();
  // Zones
  const zones = [...new Set(live.map(t => t.zone || ''))].sort((a, b) => (a || '￿').localeCompare(b || '￿', 'fr', { numeric: true }));
  // Tâches à venir (60 jours) + en retard, regroupées par intitulé et date
  const ids = new Set(live.map(t => t.id)), groups = {};
  S.tasks.filter(x => !x.done && ids.has(x.treeId) && x.date <= addDays(t0, 60)).forEach(x => { const k = x.label + '|' + x.date; (groups[k] ||= { label: x.label, date: x.date, type: x.type, n: 0 }).n++; });
  const todo = Object.values(groups).sort((a, b) => a.date.localeCompare(b.date));
  const watch = live.filter(t => t.status !== 'bon').sort(natCmp);
  const waterList = live.filter(t => { const w = nextWater(t); return w && w.date <= t0; });
  return `<div class="row" style="margin-bottom:8px"><a href="#/tableau" class="btn sm">← Catégories</a><button class="btn sm right" data-act="dashList" data-type="${esc(type)}">☰ Voir la liste</button></div>
    <h1 style="margin-bottom:8px">${esc(type)} <span class="muted small">(${live.length} vivant${live.length > 1 ? 's' : ''}${s.n > s.live ? ' · ' + (s.n - s.live) + ' retiré(s)' : ''})</span></h1>
    <div class="stats" style="grid-template-columns:repeat(4,1fr)"><div class="stat"><b>${s.avgAge != null ? fmt1(s.avgAge) : '—'}</b><span>âge moyen (ans)</span></div>
      <div class="stat"><b style="color:${s.st.surveiller + s.st.malade ? 'var(--warn)' : 'inherit'}">${s.st.surveiller + s.st.malade}</b><span>à surveiller / malades</span></div>
      <div class="stat"><b style="color:${s.water ? 'var(--warn)' : 'inherit'}">${s.water}</b><span>à arroser</span></div><div class="stat"><b style="color:${s.late ? 'var(--danger)' : 'inherit'}">${s.late}</b><span>tâches en retard</span></div></div>
    <div class="card">${statusBar(s.st)}<div class="legend">${Object.entries(s.st).filter(([, v]) => v).map(([k, v]) => `<span><i style="background:${STATUS_COLORS[k]}"></i>${esc(STATUS[k] ? STATUS[k][0] : k)} : ${v}</span>`).join('')}</div></div>
    <div class="dgrid">
    <div><h2>🍎 Charge en fruits par année</h2><div class="card">${fy.length ? barRows(fy.map(([yy, o]) => ({ label: yy, v: o.avg + 1, avg: o.avg, n: o.n })), 7, r => lvlColor(r.avg), r => `<span style="color:${lvlColor(r.avg)};font-weight:600">${lvlName(r.avg)}</span> <span class="muted">(${fmt1(r.avg)}/6 · ${r.n} arbre${r.n > 1 ? 's' : ''})</span>`) + '<p class="muted small" style="margin:4px 0 0">Moyenne des derniers constats de l’année, sur les arbres constatés.</p>' : '<span class="muted">Aucun constat de fruits. Utilisez le type « Constat » dans le journal des arbres.</span>'}</div></div>
    <div><h2>🧺 Récoltes par année</h2><div class="card">${hy.length ? barRows(hy.map(([yy, o]) => ({ label: yy, v: o.kg, o })), hmax, () => 'var(--accent)', r => `<b>${fmt1(r.o.kg)} kg</b> <span class="muted">· ${fmt1(r.o.kg / r.o.n)} kg/arbre (${r.o.n})</span>${r.o.oil ? ` · ${fmt1(r.o.oil)} L d’huile ≈ ${fmt1(r.o.oil * 0.916 / r.o.oilKg * 100)} %` : ''}`) + '<p class="muted small" style="margin:4px 0 0">Les récoltes groupées sont réparties à parts égales (estimation).</p>' : '<span class="muted">Aucune récolte saisie.</span>'}</div></div>
    </div>
    <h2>🌿 Par variété</h2><div class="card" style="overflow-x:auto"><table class="yr" style="font-size:.85rem"><tr><th></th><th>Arbres</th><th>Âge moy.</th><th>Fruits ${y}</th><th>Récolte ${py}</th><th>Récolte ${y}</th></tr>${vars.map(v => {
      const g = live.filter(t => (t.variety || '') === v), gs = groupStats(g), f = gs.fruit[y], hp = gs.harvest[py], h = gs.harvest[y];
      return `<tr><td class="lab">${esc(v || '— sans variété')}</td><td>${g.length}</td><td>${gs.avgAge != null ? fmt1(gs.avgAge) : '—'}</td><td>${f ? `<b style="color:${lvlColor(f.avg)}">${fmt1(f.avg)}</b>/6` : '—'}</td><td>${hp ? fmt1(hp.kg) + ' kg' : '—'}</td><td>${h ? fmt1(h.kg) + ' kg' : '—'}</td></tr>`; }).join('')}</table></div>
    <h2>📍 Par zone</h2><div class="card" style="overflow-x:auto"><table class="yr" style="font-size:.85rem"><tr><th></th><th>Arbres</th><th>À surveiller</th><th>À arroser</th></tr>${zones.map(z => {
      const g = live.filter(t => (t.zone || '') === z); return `<tr><td class="lab">${esc(z || '— sans zone')}</td><td>${g.length}</td><td>${g.filter(t => t.status !== 'bon').length || '—'}</td><td>${g.filter(t => { const w = nextWater(t); return w && w.date <= t0; }).length || '—'}</td></tr>`; }).join('')}</table></div>
    <h2>🗓️ À faire (60 jours et retards)</h2><div class="card">${todo.length ? todo.map(g => `<div class="task"><div class="col"><div>${(TASK_TYPES[g.type] || TASK_TYPES.autre).i} <b>${esc(g.label)}</b> <span class="badge">${g.n} arbre${g.n > 1 ? 's' : ''}</span></div><div class="small muted"><span style="${g.date < t0 ? 'color:var(--danger);font-weight:600' : ''}">${rel(g.date)}</span> · ${fmtDate(g.date)}</div></div></div>`).join('') : '<span class="muted">Rien de prévu.</span>'}</div>
    ${watch.length ? `<h2>⚠️ À surveiller / malades</h2><div class="card">${watch.slice(0, 30).map(t => `<div class="task"><a class="col" href="#/arbre/${t.id}"><b>${esc(t.name)}</b><div class="small muted">${esc(t.variety || '')}${t.zone ? ' · ' + esc(t.zone) : ''}</div></a><span class="badge ${STATUS[t.status][1]}">${STATUS[t.status][0]}</span></div>`).join('')}${watch.length > 30 ? `<div class="small muted">… et ${watch.length - 30} autre(s)</div>` : ''}</div>` : ''}
    ${waterList.length ? `<h2>💧 À arroser maintenant (${waterList.length})</h2><div class="card small">${waterList.slice(0, 40).map(t => `<a href="#/arbre/${t.id}">${esc(t.name)}</a>`).join(' · ')}${waterList.length > 40 ? ' …' : ''}</div>` : ''}`;
}
Object.assign(actions, { dashList: ({ type }) => { ui.fType = type; ui.fZone = ''; ui.q = ''; location.hash = '#/arbres'; } });
