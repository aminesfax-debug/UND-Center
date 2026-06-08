#!/usr/bin/env python3
# patch_orders2.py — version corrigée (indentation 8 espaces)
import sys, os

PATH = os.path.expanduser("~/UND-Center/index.html")

with open(PATH, "r", encoding="utf-8") as f:
    c = f.read()

orig = len(c)
ok = []
fail = []

# ── Patch 1 : editOrderId dans l'état S ──────────────────────────────────────
O1 = "expandedOrder:null,"
N1 = "expandedOrder:null,editOrderId:null,"
if O1 in c:
    c = c.replace(O1, N1, 1); ok.append("1 — editOrderId ajouté à S")
else:
    fail.append("1 — expandedOrder:null introuvable")

# ── Patch 2 : boutons crayon + corbeille dans l'en-tête de la card ───────────
O2 = '<select class="st-sel" data-oid="${o.id}" onclick="event.stopPropagation()" style="font-size:11px;padding:3px 5px;width:auto">${statusOpts(o.status)}</select>'
N2 = (
    '<button onclick="event.stopPropagation();startEditOrder(\'${o.id}\')" title="Modifier" '
    'style="background:none;border:none;cursor:pointer;color:var(--text2);padding:4px;border-radius:var(--r)">'
    '<i class="ti ti-pencil" style="font-size:16px"></i></button> '
    '<button onclick="event.stopPropagation();deleteOrder(\'${o.id}\')" title="Supprimer" '
    'style="background:none;border:none;cursor:pointer;color:#e55;padding:4px;border-radius:var(--r)">'
    '<i class="ti ti-trash" style="font-size:16px"></i></button> '
    + O2
)
if O2 in c:
    c = c.replace(O2, N2, 1); ok.append("2 — boutons crayon/corbeille ajoutés")
else:
    fail.append("2 — select.st-sel introuvable")

# ── Patch 3 : métadonnées conditionnelles (8 espaces d'indentation) ───────────
O3 = (
    '        <div><span style="color:var(--text2)">N\u00b0 Cde :</span> <strong>${o.id}</strong></div>\n'
    '        <div><span style="color:var(--text2)">Client :</span> <strong>${esc(o.client)}</strong></div>\n'
    '        <div><span style="color:var(--text2)">D\u00e9lai :</span> <strong>${esc(o.deadline||"\u2014")}</strong></div>\n'
    '        <div><span style="color:var(--text2)">Repr\u00e9sentant :</span> <strong>${esc(o.rep||"\u2014")}</strong></div>\n'
    '        <div><span style="color:var(--text2)">Paiement :</span> <strong>${esc(o.paymentTerms||"\u2014")}</strong></div>\n'
    '        ${o.source==="WEB_CLIENT"?`<div><span style="background:var(--blue-bg);color:var(--blue);padding:2px 8px;border-radius:20px;font-size:11px;font-weight:600">Commande web</span></div>`:""}\n'
    '      </div>'
)

N3 = (
    '        ${S.editOrderId===o.id?`\n'
    '        <div><span style="color:var(--text2)">N\u00b0 Cde :</span> <strong>${o.id}</strong></div>\n'
    '        <div style="display:flex;flex-direction:column;gap:2px">\n'
    '          <label style="color:var(--text2);font-size:11px">Client</label>\n'
    '          <input id="eoc_client" value="${esc(o.client)}" style="font-size:12px;padding:3px 6px;border:1px solid var(--border);border-radius:4px;background:var(--surface)">\n'
    '        </div>\n'
    '        <div style="display:flex;flex-direction:column;gap:2px">\n'
    '          <label style="color:var(--text2);font-size:11px">D\u00e9lai</label>\n'
    "          <input id=\"eoc_deadline\" value=\"${esc(o.deadline||'')}\" style=\"font-size:12px;padding:3px 6px;border:1px solid var(--border);border-radius:4px;background:var(--surface)\">\n"
    '        </div>\n'
    '        <div style="display:flex;flex-direction:column;gap:2px">\n'
    '          <label style="color:var(--text2);font-size:11px">Repr\u00e9sentant</label>\n'
    "          <input id=\"eoc_rep\" value=\"${esc(o.rep||'')}\" style=\"font-size:12px;padding:3px 6px;border:1px solid var(--border);border-radius:4px;background:var(--surface)\">\n"
    '        </div>\n'
    '        <div style="display:flex;flex-direction:column;gap:2px">\n'
    '          <label style="color:var(--text2);font-size:11px">Paiement</label>\n'
    "          <input id=\"eoc_payment\" value=\"${esc(o.paymentTerms||'')}\" style=\"font-size:12px;padding:3px 6px;border:1px solid var(--border);border-radius:4px;background:var(--surface)\">\n"
    '        </div>\n'
    '      </div>\n'
    '      <div style="display:flex;gap:8px;margin-bottom:10px">\n'
    "        <button onclick=\"saveOrderEdit('${o.id}')\" class=\"btn btn-sm btn-primary\"><i class=\"ti ti-check\"></i> Enregistrer</button>\n"
    '        <button onclick="S.editOrderId=null;render()" class="btn btn-sm"><i class="ti ti-x"></i> Annuler</button>\n'
    '      </div>`:`\n'
    '        <div><span style="color:var(--text2)">N\u00b0 Cde :</span> <strong>${o.id}</strong></div>\n'
    '        <div><span style="color:var(--text2)">Client :</span> <strong>${esc(o.client)}</strong></div>\n'
    '        <div><span style="color:var(--text2)">D\u00e9lai :</span> <strong>${esc(o.deadline||"\u2014")}</strong></div>\n'
    '        <div><span style="color:var(--text2)">Repr\u00e9sentant :</span> <strong>${esc(o.rep||"\u2014")}</strong></div>\n'
    '        <div><span style="color:var(--text2)">Paiement :</span> <strong>${esc(o.paymentTerms||"\u2014")}</strong></div>\n'
    '        ${o.source==="WEB_CLIENT"?`<div><span style="background:var(--blue-bg);color:var(--blue);padding:2px 8px;border-radius:20px;font-size:11px;font-weight:600">Commande web</span></div>`:""}\n'
    '      </div>`}\n'
    '      <div'   # on rattache le div suivant (table-scroll) pour ne pas casser la structure
)

# Pour ne pas avaler le "<div class=" suivant, on cherche O3 + ce qui suit
O3_FULL = O3 + '\n      <div'
N3_FULL = N3  # N3 se termine déjà par '      <div'

if O3_FULL in c:
    c = c.replace(O3_FULL, N3_FULL, 1); ok.append("3 — m\u00e9tadonn\u00e9es conditionnelles")
elif O3 in c:
    c = c.replace(O3, N3_FULL.replace('\n      <div', '') + '\n      <div', 1)
    ok.append("3 — m\u00e9tadonn\u00e9es conditionnelles (fallback)")
else:
    fail.append("3 — bloc m\u00e9tadonn\u00e9es introuvable")

# ── Patch 4 : fonctions deleteOrder / startEditOrder / saveOrderEdit ──────────
NEW_FUNCS = """function deleteOrder(id){
  if(!confirm("Supprimer la commande "+id+" ?"))return;
  S.orders=S.orders.filter(x=>x.id!==id);
  saveOrders();render();
}
function startEditOrder(id){
  S.editOrderId=id;S.expandedOrder=id;render();
}
function saveOrderEdit(id){
  const o=S.orders.find(x=>x.id===id);if(!o)return;
  const g=k=>{const el=document.getElementById(k);return el?el.value.trim():null;};
  const cl=g("eoc_client"),dl=g("eoc_deadline"),rp=g("eoc_rep"),pm=g("eoc_payment");
  if(cl!==null)o.client=cl;
  if(dl!==null)o.deadline=dl;
  if(rp!==null)o.rep=rp;
  if(pm!==null)o.paymentTerms=pm;
  S.editOrderId=null;saveOrders();render();
}
"""
T4 = "function saveOrders(){"
if T4 in c:
    c = c.replace(T4, NEW_FUNCS + T4, 1); ok.append("4 — fonctions delete/edit ajout\u00e9es")
else:
    fail.append("4 — function saveOrders introuvable")

# ── Résumé ────────────────────────────────────────────────────────────────────
print(f"\nTaille : {orig} \u2192 {len(c)} chars (+{len(c)-orig})\n")
for m in ok:   print(f"  \u2713 {m}")
for m in fail: print(f"  \u2717 {m}")

if fail:
    print("\n\u26a0\ufe0f  Patches \u00e9chou\u00e9s \u2014 fichier NON modifi\u00e9.")
    sys.exit(1)

with open(PATH, "w", encoding="utf-8") as f:
    f.write(c)

print("\n\u2705 Fichier mis \u00e0 jour.")
print("Lance : cd ~/UND-Center && git add -A && git commit -m 'feat: delete + edit commandes clients' && git push")
