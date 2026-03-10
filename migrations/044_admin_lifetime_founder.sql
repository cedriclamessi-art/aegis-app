-- ============================================================
-- 044 — Admin Lifetime: Founder Account
-- Garantit admin_lifetime = true pour le fondateur
-- ============================================================

-- S'assurer que la colonne existe
ALTER TABLE saas.users ADD COLUMN IF NOT EXISTS admin_lifetime BOOLEAN DEFAULT FALSE;

-- Marquer le fondateur comme admin à vie
UPDATE saas.users
SET admin_lifetime = TRUE,
    role = 'admin',
    updated_at = NOW()
WHERE email = 'jonathanlamessi@yahoo.fr';

-- Table whitelist pour futurs admins lifetime
CREATE TABLE IF NOT EXISTS saas.admin_whitelist (
  email TEXT PRIMARY KEY,
  granted_at TIMESTAMPTZ DEFAULT NOW(),
  granted_by TEXT DEFAULT 'bootstrap'
);

INSERT INTO saas.admin_whitelist (email, granted_by)
VALUES ('jonathanlamessi@yahoo.fr', 'founder')
ON CONFLICT (email) DO NOTHING;
