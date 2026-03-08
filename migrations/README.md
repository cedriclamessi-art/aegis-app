# AEGIS — Migrations

## Ordre d'exécution

```bash
# Option 1 : Migration complète depuis zéro (recommandé)
psql $DATABASE_URL < 000_consolidated.sql

# Puis les migrations additionnelles dans l'ordre :
psql $DATABASE_URL < 009_phase_unlock.sql
psql $DATABASE_URL < 010_learning_patterns.sql
psql $DATABASE_URL < 014_empire_core.sql
psql $DATABASE_URL < 016_ugc_media.sql
psql $DATABASE_URL < 017_capi_relay.sql

# Option 2 : make migrate (automatique)
make migrate
```

## Contenu des migrations

| Fichier | Contenu |
|---------|---------|
| `000_consolidated.sql` | Schémas de base — saas, events, jobs, agents, ops, store, ads, intel, risk, connectors |
| `009_phase_unlock.sql` | Système de phases (SEED→GROWTH→CRUISE→SCALE) |
| `010_learning_patterns.sql` | Tables learning — patterns, experiments, A/B |
| `014_empire_core.sql` | Empire Core — snapshot_daily, capital_live, empire_state, empire_index |
| `016_ugc_media.sql` | Media schema — ugc_jobs, video_templates, asset_recycling |
| `017_capi_relay.sql` | CAPI relay — events tracking, webhook dedup |
