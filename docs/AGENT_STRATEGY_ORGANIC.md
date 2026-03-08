# AGENT_STRATEGY_ORGANIC — Documentation complète
> Mission : Transformer chaque produit en machine à audience organique

---

## 1. RÔLE

**Mission primaire** : Construire une audience organique durable via UGC automatisés, calendrier éditorial intelligent, et boucles de croissance communautaire — **avant même que les ads payantes tournent**.

**Logique** : L'organique valide ce qui marche. Les ads scalent ce que l'organique a prouvé. MEDIA_BUYER reçoit les contenus organiques gagnants pour les booster en dark posts.

---

## 2. PLANNING (horaires fixes)

| Task | Schedule | Pourquoi |
|------|----------|----------|
| `strategy.organic_plan` | Lundi 6h (hebdo) | Révision de la stratégie avec les nouvelles données marché |
| `ugc.batch_production` | Mardi + Vendredi 8h | Batch de 10-15 scripts prêts à filmer |
| `content.calendar_build` | 1er du mois 7h | Planification du mois entier |
| `content.repurpose` | Chaque jour 10h | Déclinaisons des contenus performants |
| `organic.performance_review` | Dimanche 20h | Analyse semaine + winners → MEDIA_BUYER |
| `ugc.generate_scripts` | **TRIGGER** viral détecté | Surfer sur les trends en temps réel |
| `audience.persona_build` | **TRIGGER** product.ingested | Personas dès qu'un nouveau produit entre |

---

## 3. FLUX COMPLET

```
╔══════════════════════════════════════════════════════════╗
║          PIPELINE ORGANIQUE (product → audience)          ║
╚══════════════════════════════════════════════════════════╝

1. TRIGGER : product.ingested (nouveau produit)
   │
   └─→ AGENT_STRATEGY_ORGANIC : audience.persona_build
         │  LLM génère 3 personas ultra-précis
         │
         └─→ strategy.organic_plan
               │  LLM construit la stratégie complète
               │  (brand voice + pilliers + KPIs + roadmap 90j)
               │
               ├─→ DATA_PUSH → AGENT_COPY (brand voice)
               ├─→ DATA_PUSH → AGENT_CREATIVE (pilliers visuels)
               │
               └─→ ugc.batch_production (15 scripts)
                     │  LLM génère scripts complets :
                     │  hook × 5 variantes + corps + CTA +
                     │  hashtags + notes visuelles
                     │
                     ├─→ COMMAND → AGENT_CREATIVE (briefs visuels)
                     │
                     └─→ content.calendar_build
                           │  Place les scripts dans le calendrier
                           │  (best time slots calculés par plateforme)
                           │
                           └─→ 📅 Calendrier 30 jours planifié

2. ROUTINE (quotidienne / hebdomadaire)
   │
   ├─→ content.repurpose (10h/jour)
   │     Un viral TikTok → Instagram Reels + YouTube Short + Pinterest
   │
   └─→ organic.performance_review (dimanche soir)
         │  Analyse winners (vues > 2x moyenne)
         │
         ├─→ DATA_PUSH → AGENT_LEARNING (patterns gagnants)
         ├─→ Mise à jour hook_library (hooks validés)
         └─→ COMMAND → AGENT_MEDIA_BUYER (booster les viraux > 10k vues)

3. GROWTH LOOP (temps réel)
   │
   ← ALERT → AGENT_MARKET_INTEL (viral détecté, trend breakout)
   │
   └─→ ugc.generate_scripts (priorité 9 — urgent)
         "trend_hijack" script généré en < 2 min
         Planifié dans le calendrier sous 1h
```

---

## 4. TABLES CRÉÉES

| Table | Contenu |
|-------|---------|
| `intel.organic_strategies` | Stratégie globale (personas, pilliers, KPIs, roadmap 90j) |
| `intel.ugc_scripts` | Scripts complets avec hook × 5 variantes, timecodes, notes visuelles |
| `intel.content_calendar` | Planning editorial par plateforme avec résultats post-publication |
| `intel.hook_library` | Bibliothèque de hooks validés et scorés (0-10) |
| `intel.creator_briefs` | Briefs prêts à envoyer aux créateurs UGC |
| `intel.repurposing_map` | Traçabilité : source → toutes ses déclinaisons |
| `intel.audience_analytics` | Métriques croissance audience (daily snapshot par plateforme) |

---

## 5. TYPES DE SCRIPTS UGC GÉNÉRÉS

| Type | Description | Durée | Taux viral |
|------|-------------|-------|-----------|
| `hook_reel` | Pattern interrupt pur — arrête le scroll | 15-30s | ⭐⭐⭐⭐⭐ |
| `transformation` | Avant/après — le plus partagé | 30-60s | ⭐⭐⭐⭐⭐ |
| `ingredient_focus` | Éducatif sur UN ingrédient / bénéfice | 30-60s | ⭐⭐⭐⭐ |
| `objection_killer` | Répond à la vraie objection | 30-60s | ⭐⭐⭐⭐ |
| `social_proof` | Preuve sociale naturelle | 30s | ⭐⭐⭐⭐ |
| `routine_hack` | Intégration dans la routine | 60s | ⭐⭐⭐⭐ |
| `trend_hijack` | Surfer sur un trend actuel | 15-30s | ⭐⭐⭐⭐⭐ |
| `educational` | Valeur pure — mécanisme produit | 60-90s | ⭐⭐⭐ |
| `storytime` | Narration personnelle | 60-90s | ⭐⭐⭐ |
| `day_in_life` | Intégration lifestyle | 60-180s | ⭐⭐⭐ |
| `comparison` | vs concurrent (sans nommer) | 30-60s | ⭐⭐⭐⭐ |
| `comment_reply` | Réponse à une vraie question | 30-60s | ⭐⭐⭐⭐⭐ |

---

## 6. FRÉQUENCES PAR PLATEFORME

| Plateforme | Fréquence | Best time slots |
|-----------|-----------|----------------|
| TikTok | 1/jour | 7h, 12h, 17h, 20h, 22h |
| Instagram Reels | 5/semaine | 8h, 12h30, 17h30, 21h |
| YouTube Shorts | 3/semaine | 9h, 15h, 20h |
| Pinterest | 10 pins/semaine | 8h, 14h, 20h |

---

## 7. REPURPOSING AUTOMATIQUE

```
TikTok 60s viral (> 5000 vues)
  │
  ├─→ Instagram Reels : trim 30s + sous-titres + format 1:1
  ├─→ YouTube Shorts : sous-titres + écran de fin
  └─→ Pinterest : extract hook + format 2:3
```

---

## 8. COMMUNICATION AVEC LES AUTRES AGENTS

| Vers | Type | Quand | Contenu |
|------|------|-------|---------|
| AGENT_COPY | DATA_PUSH | Après stratégie | Brand voice + personas |
| AGENT_CREATIVE | COMMAND | Après batch UGC | Briefs visuels pour chaque script |
| AGENT_MEDIA_BUYER | COMMAND | Dimanche review | Contenus organiques à booster en dark post |
| AGENT_LEARNING | DATA_PUSH | Dimanche review | Patterns hooks gagnants |
| AGENT_ORCHESTRATOR | EVENT | Après calendrier | Rapport planification |
| ← AGENT_MARKET_INTEL | ALERT | Trend/viral détecté | Déclenche trend_hijack script |
| ← AGENT_ORCHESTRATOR | COMMAND | product.ingested | Déclenche personas + stratégie |
| ← AGENT_ANALYTICS | DATA_PUSH | Perfs disponibles | Déclenche review |

---

## 9. SIGNAL ORGANIQUE → ADS (la boucle clé)

```
Contenu organique > 10 000 vues
  │
  └─→ COMMAND → AGENT_MEDIA_BUYER
        "Créer un dark post de ce contenu avec 20-50€/j"
        payload: { calendar_id, platform, views, engagement_rate }
        │
        └─→ AGENT_MEDIA_BUYER crée une campagne boosted
              avec ce contenu déjà prouvé organiquement
              → ROAS > moyenne (contenu validé par le marché)
```

---

## 10. NOUVELLES VARIABLES D'ENV

```bash
# Déjà dans .env.example (aucune nouvelle variable requise)
# L'agent utilise le LLM_API_KEY existant pour toutes les générations
# Les plateformes sont gérées via les connecteurs existants
```
