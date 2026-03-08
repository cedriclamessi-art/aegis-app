# AEGIS Changelog

## v7.0.0 — 2026-03-06 — "100 Hacks"

Audit complet de 100 growth hacks e-commerce.
28 gaps identifiés dans v6.0. 7 nouveaux agents. ~95/100 hacks couverts.
Chaque agent intégré dans le système de paliers : observe → suggest → semi_auto → auto.

---

### GAP #88 — AGENT_REPURCHASE

"Une serviette exfoliante dure 82 jours → campagne au jour 72."

Avant v7.0, AGENT_REPLENISHMENT gérait le stock côté vendeur.
Personne ne gérait le cycle de vie côté acheteur.

AGENT_REPURCHASE calcule l'intervalle médian entre 2 achats du même produit
en analysant les vraies commandes répétées (minimum 5 repeat buyers par SKU).
Chaque SKU a son propre rythme. Une serviette exfoliante ≠ un sérum visage.

product_lifecycle : p25, p50, p75 des intervalles. Trigger = p50 - 10 jours.
Confidence = min(0.95, repeat_buyers / 50) — plus de données = plus de certitude.
Seuls les cycles 7j–365j sont considérés (filtre les aberrations).

Paliers :
T1 → observe (calcule les cycles, ne déclenche rien)
T2 → suggest (propose la campagne, humain approuve)
T3 → semi_auto (déclenche si impact < €20/campagne)
T4+ → auto (plein automatique, Klaviyo + Meta retargeting)

---

### GAP #85 — AGENT_GIFT_CONVERSION

"Quelqu'un reçoit ton produit en cadeau, l'aime → nouveau client perdu."

AGENT_GIFT_CONVERSION capture ce flux invisible.

3 sources de détection :
- Option "c'est un cadeau" cochée au checkout Shopify
- Réponse verbatim ("je l'ai reçu en cadeau", "pour offrir")
- Signal Klaviyo (clique sur email depuis compte acheteur)

Workflow : détection → code promo unique WELCOMEXXXXXX (-15% configurable)
→ email personnalisé Claude → tracking conversion.

Si email destinataire inconnu : email à l'acheteur pour transmettre.
Taux de conversion de ce flux mesuré séparément dans gift_recipients.

---

### GAP #91 — AGENT_LOYALTY

Programme de fidélité complet absent jusqu'en v6.0.

4 niveaux : Bronze (0 pts) → Argent (500 pts) → Or (1500 pts) → Platine (5000 pts)
Accrual : 10 pts/€ · 50 pts avis · 200 pts parrainage · 100 pts anniversaire · 50 pts inscription
Validité : 365 jours (configurable)

Campagnes automatiques :
- "Near-upgrade" : client à 100 pts du niveau supérieur → email de motivation
- "Dormant VIP" : Or/Platine inactif 60j + ≥200 pts disponibles → réactivation urgence

Expiration automatique des points à 02:00 chaque nuit.
Intégré avec AGENT_KLAVIYO et AGENT_RFM — les champions fidélité reçoivent
un traitement différencié dans toutes les campagnes.

---

### GAP #92 — AGENT_CONTENT_ORCHESTRATOR

"Toujours en mode promo → destruction de la valeur perçue."

Cycle 4 semaines coordonné entre Meta, email, et TikTok organique :

S1 — Éducation (budget ×0.7, objectif BRAND_AWARENESS)
     Contenu : bienfaits produit, tutoriels, "comment utiliser"
S2 — Preuve sociale (budget ×1.0, objectif CONVERSIONS)
     Contenu : UGC, avant/après, avis Trustpilot
S3 — Urgence (budget ×1.4, objectif CONVERSIONS)
     Contenu : offre limitée, compte à rebours, stock restant
S4 — Fidélisation (budget ×0.6, objectif RETARGETING)
     Contenu : programme points, nouveautés, merci clients

Le cycle saisonnier peut override (Black Friday à ×1.8 > urgence phase à ×1.4 → on prend le max).
CTA suggéré généré par Claude à chaque début de semaine.

---

### GAP #71 — AGENT_CREATIVE_FATIGUE

Surveillance de la saturation créative avec 3 signaux combinés :
- CTR drop vs semaine 1 : mild (-10%), moderate (-25%), severe (-40%)
- Fréquence 7j : mild (2.25×), moderate (3×), severe (4.5×)
- CPM increase : +30% = signal de fatigue

Niveaux : none / mild / alerte / moderate / retire suggéré / severe / retire auto (T3+)

T3+ : retire automatiquement les créatifs en fatigue sévère + demande remplacement.
T1-T2 : détection + alerte uniquement (humain décide).

Seuils dans dynamic_thresholds — recalibrés par AGENT_THRESHOLD_CALIBRATOR.

---

### GAP #94 — AGENT_COHORT

"Les clients acquis via Meta en janvier valent-ils mieux que ceux de TikTok en février ?"

Cohortes mensuelles × canal d'acquisition, 12 mois glissants.
Rétention M0 → M6, LTV M3 et M6 par cohorte.
Minimum 3 clients par cohorte pour calcul valide.

Exemple de conclusion actionnable :
Canal email → LTV M6 = €71 | Canal Meta → LTV M6 = €52 | Canal TikTok → €38
→ AGENT_BUDGET_OPTIMIZER alloue plus de budget email, réduit TikTok.

Alimenté par les données attribution_events → couplé à AGENT_BEHAVIORAL_LEARNING.

---

### Architecture v7.0 — État final

| Dimension              | v6.0 | v7.0 |
|------------------------|------|------|
| Agents                 | 42   | 49   |
| Migrations             | 28   | 30   |
| Tests                  | 148  | 177  |
| Seuils dynamiques      | 26   | 37   |
| Hacks couverts         | ~72  | ~95  |
| Nouveaux agents        | —    | +7   |
| Tier configs           | 193  | 228  |

Couverture 100 hacks v7.0 :
✅ Data & Segmentation (1-20)    : 20/20
✅ Stratégie campagne (21-40)    : 19/20 (hack 36 cartes cadeaux = Shopify natif)
✅ Créatif & Message (41-60)     : 12/20 (8 hacks = exécution créative humaine)
✅ Mesure & Optimisation (61-80) : 19/20 (hack 67 dashboards = externe)
✅ Rétention & Post-achat (81-100): 18/20 (hacks 85,96 partiellement)

~95/100 couvert. Les 5 restants = exécution créative pure (angles émotionnels,
storytelling) ou features Shopify natives (cartes cadeaux, abonnements Shopify+).

---

## Versions précédentes
v6.0.0 — Intemporel: patterns comportementaux · benchmarks cross-clients · adapters · seuils dynamiques
v5.0.0 — Paliers d'autonomie · Verbatims · Réputation · Article 6 · Onboarding · Billing performance
v4.2.0 — Calendrier mondial · Replenishment · PWA · Brief A/B
v4.0.0 — Conseil Constitutionnel (5 articles → 6 en v5.0)
