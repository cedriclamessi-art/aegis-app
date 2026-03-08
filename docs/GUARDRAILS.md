# AGENT_GUARDRAILS — Garde-fous Structurels par Niveau

> **Philosophie** : Les garde-fous existants (POLICY_GOVERNOR, STOP_LOSS, OPS_GUARD) sont
> **réactifs** — ils interviennent après l'erreur. AGENT_GUARDRAILS est **structurel** —
> il empêche l'erreur d'être possible.

---

## Vue d'ensemble des 5 garde-fous

| ID  | Garde-fou             | Niveau | Déclencheur                        | Action automatique        |
|-----|-----------------------|--------|------------------------------------|---------------------------|
| GF1 | Complexity Budget     | 1      | Tentative de promotion d'agent     | `block`                   |
| GF2 | Circuit Breaker       | 1      | Empire Index cron 15min            | `downgrade_tier`          |
| GF3 | Silence Window        | 1      | Après chaque promotion             | `shadow_mode` (48h)       |
| GF4 | Data Quality Gate     | 2      | Partage de pattern cross-tenant    | `reject_pattern`          |
| GF5 | Complexity Score      | 3      | Promotion + Simulator + cron       | `block`                   |

**Niveaux d'activation :**
- **Niveau 1** (`basic`) — GF1 + GF2 + GF3 toujours actifs
- **Niveau 2** (`hedge_fund`) — + GF4
- **Niveau 3** (`full_organism`) — + GF5 + Simulator threshold

---

## GF1 — Complexity Budget

**Règle** : Maximum **1 agent promu en production par semaine calendar**.

**Pourquoi** : L'interaction entre deux agents nouveaux activés simultanément est
imprévisible. Les bugs inter-agents sont les plus difficiles à diagnostiquer.

**Déclenchement** :
```
guardrails.check_promotion → guardian.check_complexity_budget()
```

**Réponse** :
- Si 0 promotion cette semaine → `allowed: true` → promotion + GF3 démarre
- Si ≥ 1 promotion cette semaine → `allowed: false` → message clair + date de la prochaine semaine

**Table** : `guardian.agent_promotions` (week_number + year_number par tenant)

**Override** : `is_overridable = FALSE` — aucune exception même par AGENT_CEO.

---

## GF2 — Circuit Breaker Empire Index

**Règle** : Si `empire_index` baisse **3 jours consécutifs** ET descend **sous 40** →
rétrogradation automatique d'un tier de feature flags.

**Pourquoi** : On ne scale pas un système instable. Un déclin de 3 jours
n'est pas du bruit — c'est un signal.

**Déclenchement** : cron `*/15 * * * *` → `guardrails.cron_monitor`

**Logique de rétrogradation** :
```
full_organism → hedge_fund   (agents CEO, UGC, Learning → standby)
hedge_fund    → basic         (agents CONDOR, SPY → standby)
basic         → basic         (plancher — on ne va pas en dessous)
```

**Réactivation** : manuelle uniquement, via `guardrails.check_promotion`
une fois l'Empire Index stabilisé au-dessus de 40.

**Notification** : broadcast vers `AGENT_CEO` + alerte `critical` dans `ops.alerts`.

**Table** : `guardian.empire_trend` (consecutive_decline par tenant)

---

## GF3 — Silence Window

**Règle** : Après chaque promotion d'agent, **48h en shadow_only** obligatoires.
Aucune décision autonome exécutée pendant cette fenêtre.

**Pourquoi** : Le risque principal d'un multi-agent system est l'interaction
imprévue entre deux changements simultanés. 48h permettent de détecter
les comportements anormaux avant qu'ils aient un impact financier.

**Déclenchement** :
- Auto : à chaque appel réussi à `guardrails.check_promotion`
- Trigger PostgreSQL : `trg_agent_promotion_guard` sur `agents.registry`

**Pendant la silence window** :
```
guardrails.check_decision → { executionMode: 'shadow_only' }
```
L'agent propose, log, mais n'exécute pas.

**Expiration** : automatique à `promoted_at + 48h`, vérifiée au cron.

**Table** : `guardian.agent_promotions` (silence_window_ends, silence_window_active)

---

## GF4 — Data Quality Gate

**Règle** : Un pattern n'entre dans le pool cross-tenant que si :
- `source_tenant_count ≥ 3` (minimum 3 tenants sources différents)
- `total_spend_eur ≥ 1000` (spend consolidé ≥ 1 000€)
- `confidence_score ≥ 0.70` (variance faible entre tenants)

**Pourquoi** : Un pattern d'un seul compte à 200€/mois n'apprend rien
à un compte à 20k€/mois. Le "bruit partagé" est pire que pas de learning.

**Déclenchement** : avant tout partage cross-tenant par `AGENT_LEARNING`
```
guardrails.check_pattern → guardian.validate_pattern_quality()
```

**Réponse** :
- `passed: true` → pattern entre dans `intel.patterns` (tenant_id = NULL)
- `passed: false` → pattern reste local au tenant source, raison loggée

**Contrainte SQL** : colonne `quality_gate_passed BOOLEAN DEFAULT FALSE`
sur `intel.patterns` — le pool partagé ne voit que `quality_gate_passed = TRUE`.

**Calcul confidence_score** (responsabilité AGENT_LEARNING) :
```
confidence = 1 - (std_dev(roas_across_tenants) / mean(roas_across_tenants))
```

---

## GF5 — Complexity Score + Simulator Threshold

### Complexity Score

**Règle** : Score 1-10 calculé en temps réel. Bloque les nouvelles activations
si le score dépasse le seuil du tier.

**Formule** :
```
score = agents_score (0-3)
      + features_score (0-2)
      + silence_score (0-2)
      + alerts_score (0-2)
      + simulator_score (0-1)
```

**Seuils par tier** :
| Tier          | Seuil blocage | Seuil alerte |
|---------------|--------------|--------------|
| basic         | 6            | 5            |
| hedge_fund    | 7            | 6            |
| full_organism | 8            | 7            |

**Override** : `is_overridable = TRUE` — un humain peut forcer avec justification.

### Simulator Threshold

**Règle** : Le Strategic Simulator tourne **uniquement** si l'impact estimé de
la décision dépasse **500€**. En dessous → exécution directe sans simulation.

**Pourquoi** : Un simulator sur chaque micro-décision devient un "bureaucracy engine".
Il doit rester une arme, pas un frein.

---

## Règle Méta — Immuabilité du système

**Règle** : `AGENT_GUARDRAILS` et `guardian.immutable_rules` ne peuvent pas être
modifiés par un agent, même `AGENT_CEO`.

**Implémentation technique** :
```sql
REVOKE INSERT, UPDATE, DELETE ON guardian.immutable_rules FROM PUBLIC;
```

Toute modification des règles = migration SQL manuelle, donc :
- tracée dans le git
- validée par code review
- déployée par un humain

---

## Intégration — Comment appeler AGENT_GUARDRAILS

### Avant de promouvoir un agent
```typescript
// Dans OPS_GUARD, avant check_and_unlock_phases()
const check = await agentBus.dispatch({
  taskType: 'guardrails.check_promotion',
  tenantId,
  input: { tenantId, agentId: 'AGENT_META_TESTING', promotedBy: 'auto_threshold' }
});

if (!check.output.allowed) {
  logger.warn({ reason: check.output.blockedBy }, 'Promotion blocked by guardrails');
  return; // Ne pas promouvoir
}
```

### Avant une décision autonome
```typescript
// Dans tout agent avant d'exécuter une action
const check = await agentBus.dispatch({
  taskType: 'guardrails.check_decision',
  tenantId,
  input: { tenantId, decisionType: 'budget_scale' }
});

const mode = check.output.executionMode; // 'full_auto' | 'shadow_only'
if (mode === 'shadow_only') {
  await this.logShadow(decision); // log sans exécuter
  return;
}
await this.execute(decision);
```

### Avant de partager un pattern (AGENT_LEARNING)
```typescript
const check = await agentBus.dispatch({
  taskType: 'guardrails.check_pattern',
  tenantId,
  input: { tenantId, patternId, sourceTenantCount, totalSpendEur, confidenceScore }
});

if (!check.output.allowed) {
  // Pattern reste local — ne pas écrire tenant_id = NULL
  return;
}
// Pattern validé → peut être partagé cross-tenant
await db.query('UPDATE intel.patterns SET tenant_id = NULL WHERE id = $1', [patternId]);
```

### Avant une simulation stratégique
```typescript
const check = await agentBus.dispatch({
  taskType: 'guardrails.check_simulator',
  tenantId,
  input: { tenantId, actionValueEur: estimatedImpact }
});

if (check.output.simulatorRequired) {
  // Lance le simulator
  await strategicSimulator.run(context);
} else {
  // Exécution directe
  await this.executeDirectly(context);
}
```

---

## Dashboard — guardian.status_dashboard

```sql
SELECT * FROM guardian.status_dashboard WHERE tenant_id = $1;
```

Retourne :
- `gf1_promotions_this_week` / `gf1_max_per_week`
- `gf2_consecutive_decline` / `gf2_triggered`
- `gf3_agents_in_silence`
- `gf4_rejected_patterns_7d`
- `gf5_complexity_score` / `gf5_threshold_exceeded`
- `empire_index_current`
- `open_alerts`

---

## Schéma des tables

```
guardian.immutable_rules        → règles immuables (READ ONLY applicatif)
guardian.agent_promotions       → historique promotions + silence windows
guardian.empire_trend           → historique empire index + circuit breaker
guardian.complexity_snapshots   → historique complexity score
guardian.validated_patterns     → vue patterns qualifiés
guardian.status_dashboard       → vue résumé CEO
```
