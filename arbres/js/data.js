// Fiches techniques par défaut (indicatives — climat méditerranéen / Tunisie).
// À adapter à votre région et microclimat ; vérifier toujours les produits homologués et les délais avant récolte sur l'étiquette.
const TASK_TYPES = {
  taille:     { l: 'Taille',                 i: '✂️', c: '#e08a1e' },
  compost:    { l: 'Compost / fumure',       i: '🪱', c: '#8a5a2b' },
  engrais:    { l: 'Engrais',                i: '🧪', c: '#7a5cc2' },
  pesticide:  { l: 'Traitement / pesticide', i: '🧴', c: '#d64545' },
  fortifiant: { l: 'Fortifiant',             i: '🌿', c: '#2f9e6e' },
  paillage:   { l: 'Paillage',               i: '🍂', c: '#a07840' },
  desherbage: { l: 'Désherbage',             i: '🌾', c: '#6b8f2a' },
  autre:      { l: 'Autre',                  i: '📌', c: '#5b6b7b' }
};
const LOG_KINDS = {
  constat:    { l: 'Constat',    i: '👁️' },
  travail:    { l: 'Travail',    i: '🛠️' },
  irrigation: { l: 'Arrosage',   i: '💧' },
  traitement: { l: 'Traitement', i: '🧴' },
  recolte:    { l: 'Récolte',    i: '🧺' }
};
// Échelle de charge en fruits (constat), de 0 à 6
const LEVELS = ['Pas de fruits', 'Très peu', 'Peu', 'Moyen', 'Moyen plus', 'Beaucoup', 'Énormément'];
const LEVEL_COLORS = ['#9aa5a0', '#c9b458', '#d9a441', '#9fbf4a', '#5fae52', '#2f8f4f', '#1b6a3a'];
// Figuier : particularités variétales (fiches du registre)
const FIG_TYPES = { commun: 'Commun', smyrne: 'Smyrne', san_pedro: 'San Pedro', caprifiguier: 'Caprifiguier (mâle)', autre: 'Autre' };
const FIG_BEARING = { unifere: 'Unifère (une seule récolte)', bifere: 'Bifère (deux récoltes)' };
const FIG_CAPRI = { autofertile: 'Autofertile (sans caprification)', caprification: 'Nécessite la caprification', capri2: 'Caprification pour la 2e récolte seulement' };
const CROPS = { bacour: '1re récolte (Bacour)', principale: '2e récolte (figues d’automne)' };
const MONTHS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];

const P = (m, t, l) => ({ month: m, type: t, label: l });
const COMPOST = P(11, 'compost', 'Compost / fumier mûr au pied');
const DEFAULT_FICHES = [
  { type: 'Olivier', variety: '', exposition: 'Plein soleil.', sol: 'Tous sols drainants, calcaire toléré ; craint l’asphyxie racinaire.',
    arrosage: 'Jeune (<3 ans) : arrosage hebdomadaire en été. Adulte : très résistant à la sécheresse, mais un apport estival (floraison mai, grossissement du fruit juillet-septembre) améliore nettement la production.',
    plantation: 'Écartement 5–7 m. Plantation automne ou fin d’hiver.', taille: 'Fin d’hiver (fév.–mars). Aérer le centre, supprimer gourmands et bois mort. Le fruit se forme sur le bois de l’année précédente.',
    fertilisation: 'Compost ou fumier à l’automne ; azote en fin d’hiver. Bore si carence.', sante: 'Œil de paon (cuivre préventif automne), mouche de l’olive (piégeage dès juin), cochenille noire, teigne.',
    remarques: 'Alternance : production forte une année sur deux, la taille et la fumure aident à la limiter. Le rendement en huile dépend de la variété, de la maturité et de la date de récolte : notez-le chaque année (onglet Récoltes).', floraison: [5, 6], recolte: [10, 11, 12, 1],
    plan: [P(2, 'taille', 'Taille d’entretien (aérer le centre)'), P(3, 'engrais', 'Engrais azoté de fin d’hiver'), COMPOST, P(11, 'pesticide', 'Cuivre préventif (œil de paon)'), P(6, 'pesticide', 'Pose des pièges mouche de l’olive'), P(4, 'fortifiant', 'Fortifiant (algues / purin d’ortie)'), P(5, 'desherbage', 'Désherbage / fauchage au pied avant l’été'), P(7, 'autre', 'Relevé des pièges mouche de l’olive (comptage)'), P(9, 'autre', 'Relevé des pièges mouche + contrôle œil de paon')] },
  { type: 'Olivier', variety: 'Chemlali', recolte: [11, 12, 1], remarques: 'Variété dominante du centre/sud : très rustique, tolère sécheresse et salinité. Alternance de production marquée.' },
  { type: 'Olivier', variety: 'Chétoui', recolte: [10, 11, 12], remarques: 'Variété typique du nord, mieux adaptée aux zones plus humides.' },

  { type: 'Citronnier', variety: '', exposition: 'Plein soleil, abrité du vent et du gel (sensible sous -2 °C).', sol: 'Bien drainé, neutre à légèrement acide. Chlorose ferrique en sol très calcaire.',
    arrosage: 'Régulier, ne jamais laisser sécher : 1–2 fois/semaine en été selon le sol, espacé en hiver.', plantation: 'Écartement 4–5 m. Plantation printemps.',
    taille: 'Légère, après la récolte principale (avril) : aérer, retirer bois mort et gourmands.', fertilisation: '3 apports/an (fév., mai, août) + compost à l’automne. Chélate de fer si feuilles jaunes aux nervures vertes.',
    sante: 'Cochenilles (huile blanche en hiver), mineuse des agrumes, pucerons, gommose si sol asphyxiant.', remarques: 'Floraison et fructification quasi continues (remontant).',
    floraison: [3, 4, 5], recolte: [11, 12, 1, 2, 3, 4],
    plan: [P(4, 'taille', 'Taille légère après récolte'), P(2, 'engrais', 'Engrais agrumes (1er apport)'), P(5, 'engrais', 'Engrais agrumes (2e apport)'), P(8, 'engrais', 'Engrais agrumes (3e apport)'), P(1, 'pesticide', 'Huile blanche (cochenilles)'), P(7, 'fortifiant', 'Surveillance mineuse – savon noir / neem'), COMPOST] },
  { type: 'Oranger', variety: '', exposition: 'Plein soleil, abrité du vent.', sol: 'Profond, bien drainé, neutre à légèrement acide.', arrosage: 'Régulier ; 1 fois/semaine en été pour un arbre adulte, davantage si jeune.',
    plantation: 'Écartement 5–6 m.', taille: 'Légère après la récolte (mars–avril).', fertilisation: '3 apports (fév., mai, août) + compost en automne.', sante: 'Cochenilles, mineuse, mouche méditerranéenne des fruits (piégeage dès l’été), gommose.',
    remarques: '', floraison: [3, 4], recolte: [12, 1, 2, 3, 4],
    plan: [P(4, 'taille', 'Taille légère après récolte'), P(2, 'engrais', 'Engrais agrumes (1er apport)'), P(5, 'engrais', 'Engrais agrumes (2e apport)'), P(8, 'engrais', 'Engrais agrumes (3e apport)'), P(7, 'pesticide', 'Piégeage mouche méditerranéenne'), COMPOST] },
  { type: 'Oranger', variety: 'Maltaise demi-sanguine', recolte: [1, 2, 3, 4], remarques: 'Variété locale, maturité tardive.' },
  { type: 'Oranger', variety: 'Thomson Navel', recolte: [11, 12, 1], remarques: 'Précoce.' },
  { type: 'Mandarinier', variety: '', exposition: 'Plein soleil, abrité du vent.', sol: 'Bien drainé, neutre à légèrement acide.', arrosage: 'Régulier ; 1 fois/semaine en été, éviter les à-coups (chute de fruits, éclatement).',
    plantation: 'Écartement 4–5 m.', taille: 'Légère après récolte (fév.–mars).', fertilisation: '3 apports (fév., mai, août) + compost.', sante: 'Cochenilles, mineuse, mouche des fruits, pucerons.', remarques: 'Inclut clémentinier.',
    floraison: [4, 5], recolte: [11, 12, 1, 2],
    plan: [P(3, 'taille', 'Taille légère après récolte'), P(2, 'engrais', 'Engrais agrumes (1er apport)'), P(5, 'engrais', 'Engrais agrumes (2e apport)'), P(8, 'engrais', 'Engrais agrumes (3e apport)'), P(1, 'pesticide', 'Huile blanche (cochenilles)'), COMPOST] },
  { type: 'Grenadier', variety: '', exposition: 'Plein soleil.', sol: 'Tous sols, tolère calcaire et sel.', arrosage: 'Résistant à la sécheresse ; arrosage régulier pendant la fructification (les alternances sec/humide font éclater les fruits).',
    plantation: 'Écartement 4–5 m.', taille: 'Fin d’hiver : supprimer rejets du pied, bois mort, ouvrir le centre.', fertilisation: 'Compost en automne, léger apport d’azote au printemps.', sante: 'Pucerons, cochenilles, pourriture du cœur des fruits.',
    remarques: '', floraison: [5, 6, 7], recolte: [9, 10, 11],
    plan: [P(2, 'taille', 'Taille + suppression des rejets'), P(3, 'engrais', 'Apport d’azote de printemps'), COMPOST] },
  { type: 'Grenadier', variety: 'Gabsi', recolte: [9, 10], remarques: 'Variété de Gabès, fruits sucrés.' },
  { type: 'Figuier', variety: '', exposition: 'Plein soleil.', sol: 'Tous sols drainants, tolère calcaire.', arrosage: 'Très rustique ; arrosage d’appoint en été, surtout les jeunes arbres et pendant le grossissement des figues.',
    plantation: 'Écartement 5–6 m.', taille: 'Hiver (janv.–fév.), légère : retirer bois mort et branches croisées.', fertilisation: 'Compost à l’automne.', sante: 'Mouche méditerranéenne des fruits, cochenilles, rouille.',
    remarques: 'Selon la variété : figues-fleurs (juin–juillet) puis figues d’automne.', floraison: [], recolte: [8, 9, 10],
    plan: [P(1, 'taille', 'Taille d’hiver légère'), COMPOST, P(7, 'pesticide', 'Piégeage mouche des fruits'), P(6, 'autre', 'Récolte des figues-fleurs (variétés bifères)'), P(9, 'autre', 'Surveillance rouille / mouche, ramassage des fruits tombés'), P(5, 'desherbage', 'Désherbage / paillage au pied')] },
  { type: 'Amandier', variety: '', exposition: 'Plein soleil ; floraison précoce sensible aux gelées tardives.', sol: 'Drainant, calcaire toléré.', arrosage: 'Résistant à la sécheresse ; arrosage d’appoint au printemps et pendant le remplissage de l’amande.',
    plantation: 'Écartement 6–7 m.', taille: 'Hiver (déc.) ou après récolte : formation, éclaircie du centre.', fertilisation: 'Compost en automne ; engrais après floraison.', sante: 'Monilia, cloque, pucerons, guêpe de l’amandier.', remarques: '',
    floraison: [1, 2], recolte: [8, 9], plan: [P(12, 'taille', 'Taille de formation / éclaircie'), P(11, 'pesticide', 'Cuivre à la chute des feuilles'), P(3, 'engrais', 'Engrais après floraison'), COMPOST] },
  { type: 'Abricotier', variety: '', exposition: 'Plein soleil, abri des gelées tardives.', sol: 'Profond, drainant.', arrosage: 'Régulier au printemps (grossissement du fruit), puis modéré.', plantation: 'Écartement 5–6 m.',
    taille: 'Juste après la récolte (juillet) pour limiter gommose et monilia.', fertilisation: 'Compost à l’automne, engrais en fin d’hiver.', sante: 'Monilia, gommose, pucerons, cloque.', remarques: 'Gel sur les fleurs = risque de perte de récolte.',
    floraison: [2, 3], recolte: [5, 6], plan: [P(7, 'taille', 'Taille après récolte'), P(11, 'pesticide', 'Cuivre à la chute des feuilles'), P(2, 'engrais', 'Engrais de fin d’hiver'), COMPOST] },
  { type: 'Pêcher', variety: '', exposition: 'Plein soleil.', sol: 'Léger, drainant.', arrosage: 'Régulier de la floraison à la récolte, essentiel pour le calibre.', plantation: 'Écartement 4–5 m.',
    taille: 'Taille annuelle obligatoire : après récolte (août) + éventuelle taille en vert.', fertilisation: 'Compost à l’automne, engrais en fin d’hiver.', sante: 'Cloque (cuivre avant débourrement), pucerons, monilia, mouche des fruits.', remarques: '',
    floraison: [2, 3], recolte: [6, 7, 8], plan: [P(8, 'taille', 'Taille de fructification après récolte'), P(1, 'pesticide', 'Cuivre contre la cloque (avant débourrement)'), P(2, 'engrais', 'Engrais de fin d’hiver'), COMPOST] },
  { type: 'Prunier', variety: '', exposition: 'Plein soleil.', sol: 'Frais, profond.', arrosage: 'Régulier au printemps et en été.', plantation: 'Écartement 5 m.', taille: 'Légère après récolte ou en hiver.',
    fertilisation: 'Compost en automne.', sante: 'Monilia, pucerons, hoplocampe.', remarques: '', floraison: [2, 3], recolte: [6, 7, 8],
    plan: [P(8, 'taille', 'Taille légère après récolte'), P(11, 'pesticide', 'Cuivre à la chute des feuilles'), COMPOST] },
  { type: 'Vigne', variety: '', exposition: 'Plein soleil.', sol: 'Drainant, pauvre accepté.', arrosage: 'Peu exigeante ; arrosage de la 1re année puis d’appoint.', plantation: 'Écartement 1,5–2,5 m selon conduite.',
    taille: 'Au repos (déc.–fév.) : tailler sur 2 yeux (cot) ou long bois selon la conduite.', fertilisation: 'Compost en hiver.', sante: 'Oïdium (soufre), mildiou (cuivre), cochylis.', remarques: '',
    floraison: [5], recolte: [8, 9, 10],
    plan: [P(1, 'taille', 'Taille de la vigne'), P(4, 'pesticide', 'Soufre (oïdium)'), P(4, 'pesticide', 'Cuivre (mildiou)'), P(5, 'autre', 'Ébourgeonnage / palissage'), P(12, 'compost', 'Compost / fumier mûr')] },
  { type: 'Palmier dattier', variety: '', exposition: 'Plein soleil, chaleur.', sol: 'Sableux profond, tolère le sel.', arrosage: 'Gros besoin en eau : « pieds dans l’eau, tête au soleil ». Irrigation régulière en été.',
    plantation: 'Écartement 8–9 m.', taille: 'Élagage des palmes sèches et rejets en hiver (garder les palmes vertes).', fertilisation: 'Fumier ou compost à l’automne.', sante: 'Pyrale des dattes, cochenille blanche, bayoud (champignon).',
    remarques: 'Dioïque : pollinisation manuelle (pollen d’un mâle) en février–mars.', floraison: [2, 3], recolte: [10, 11, 12],
    plan: [P(1, 'taille', 'Élagage des palmes sèches et rejets'), P(3, 'autre', 'Pollinisation'), P(4, 'autre', 'Éclaircissage / ciselage des régimes'), P(8, 'autre', 'Ensachage des régimes'), COMPOST] },
  { type: 'Caroubier', variety: '', exposition: 'Plein soleil.', sol: 'Tous sols, très rustique.', arrosage: 'Très résistant à la sécheresse ; arrosage seulement la jeunesse.', plantation: 'Écartement 8 m.', taille: 'Légère, fin d’hiver.',
    fertilisation: 'Peu exigeant.', sante: 'Oïdium, peu de problèmes.', remarques: 'Arbres mâles, femelles ou hermaphrodites : vérifier le sexe pour la fructification.', floraison: [9, 10], recolte: [8, 9],
    plan: [P(3, 'taille', 'Taille légère'), COMPOST] },
  { type: 'Néflier du Japon', variety: '', exposition: 'Soleil, abrité du vent.', sol: 'Frais, riche.', arrosage: 'Régulier, y compris en été (formation des fleurs à l’automne).', plantation: 'Écartement 5 m.',
    taille: 'Après la récolte (juin) : aérer.', fertilisation: 'Compost ; engrais après récolte.', sante: 'Feu bactérien, pucerons, mouche des fruits.', remarques: 'Fructification hiver/printemps.', floraison: [10, 11, 12], recolte: [4, 5],
    plan: [P(6, 'taille', 'Taille après récolte'), P(6, 'engrais', 'Engrais après récolte'), P(10, 'compost', 'Compost / fumier mûr')] },
  { type: 'Pommier', variety: '', exposition: 'Soleil.', sol: 'Frais, profond.', arrosage: 'Régulier en été.', plantation: 'Écartement 4–6 m.', taille: 'Hiver (janv.–fév.).', fertilisation: 'Compost en automne.',
    sante: 'Carpocapse (piégeage), tavelure, pucerons.', remarques: 'Besoin en froid : adapté surtout aux zones fraîches (nord, Cap Bon, altitude).', floraison: [3, 4], recolte: [8, 9, 10],
    plan: [P(1, 'taille', 'Taille d’hiver'), P(2, 'pesticide', 'Cuivre avant débourrement'), P(4, 'pesticide', 'Piégeage carpocapse'), COMPOST] },
  { type: 'Poirier', variety: '', exposition: 'Soleil.', sol: 'Frais, profond.', arrosage: 'Régulier en été.', plantation: 'Écartement 4–6 m.', taille: 'Hiver (janv.–fév.).', fertilisation: 'Compost en automne.',
    sante: 'Carpocapse, tavelure, psylle, feu bactérien.', remarques: 'Besoin en froid : zones fraîches.', floraison: [3], recolte: [7, 8, 9],
    plan: [P(1, 'taille', 'Taille d’hiver'), P(2, 'pesticide', 'Cuivre avant débourrement'), COMPOST] },
  { type: 'Jujubier', variety: '', exposition: 'Plein soleil.', sol: 'Tous sols, tolère sécheresse.', arrosage: 'Très peu exigeant ; arrosage d’appoint à la fructification.', plantation: 'Écartement 5 m.', taille: 'Légère en hiver.',
    fertilisation: 'Compost.', sante: 'Mouche des fruits.', remarques: 'Caduc, feuillage tardif.', floraison: [6, 7], recolte: [9, 10], plan: [P(2, 'taille', 'Taille légère'), COMPOST] },
  { type: 'Kaki', variety: '', exposition: 'Soleil.', sol: 'Profond, frais.', arrosage: 'Régulier en été.', plantation: 'Écartement 5 m.', taille: 'Hiver, légère.', fertilisation: 'Compost.', sante: 'Cochenilles, chute des fruits par stress hydrique.',
    remarques: '', floraison: [5], recolte: [10, 11, 12], plan: [P(1, 'taille', 'Taille légère d’hiver'), COMPOST] },
  { type: 'Cognassier', variety: '', exposition: 'Soleil.', sol: 'Frais.', arrosage: 'Modéré.', plantation: 'Écartement 4–5 m.', taille: 'Hiver, légère.', fertilisation: 'Compost.', sante: 'Moniliose, feu bactérien.', remarques: '',
    floraison: [4], recolte: [10, 11], plan: [P(1, 'taille', 'Taille légère d’hiver'), COMPOST] }
];
