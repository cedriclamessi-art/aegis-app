// ============================================================
// AEGIS — Auth Service (PRODUCTION-READY)
// Invite flow · Reset password · JWT · MFA (TOTP) · bcrypt
// ============================================================

import { randomBytes, createHash, timingSafeEqual } from 'crypto';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { authenticator } from 'otplib';
import { db } from '../utils/db';
import { logger } from '../utils/logger';

// ─── Types ────────────────────────────────────────────────
interface TokenPair {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

interface InviteResult {
  inviteUrl: string;
  expiresAt: Date;
}

// ─── AUTH SERVICE ─────────────────────────────────────────
export class AuthService {
  private readonly JWT_SECRET: string;
  private readonly JWT_REFRESH_SECRET: string;
  private readonly ACCESS_TOKEN_TTL = 15 * 60;        // 15 minutes
  private readonly REFRESH_TOKEN_TTL = 7 * 24 * 3600; // 7 jours
  private readonly INVITE_TTL_MS = 24 * 60 * 60 * 1000; // 24h
  private readonly BCRYPT_ROUNDS = 12;

  constructor() {
    const jwtSecret = process.env.JWT_SECRET;
    const jwtRefreshSecret = process.env.JWT_REFRESH_SECRET;

    // JAMAIS de valeur par defaut — crash au demarrage si absent
    if (!jwtSecret || jwtSecret.length < 64) {
      throw new Error('JWT_SECRET manquant ou trop court (min 64 chars). Generer avec: openssl rand -hex 64');
    }
    if (!jwtRefreshSecret || jwtRefreshSecret.length < 64) {
      throw new Error('JWT_REFRESH_SECRET manquant ou trop court. Generer avec: openssl rand -hex 64');
    }

    this.JWT_SECRET = jwtSecret;
    this.JWT_REFRESH_SECRET = jwtRefreshSecret;
  }

  // ─── INVITE FLOW ──────────────────────────────────────────
  async createInvite(
    email: string, tenantId: string, role: string,
    adminLifetime = false, invitedBy?: string
  ): Promise<InviteResult> {
    if (adminLifetime) {
      const whitelist = await db.query(
        `SELECT email FROM saas.admin_whitelist WHERE email = $1`, [email]
      );
      if (!whitelist.rows.length) {
        throw new Error(`Email ${email} non present dans admin_whitelist`);
      }
    }

    const existingUser = await db.query(
      `SELECT id FROM saas.users WHERE email = $1`, [email]
    );

    let userId: string;
    if (existingUser.rows.length) {
      userId = existingUser.rows[0].id;
    } else {
      const newUser = await db.query(
        `INSERT INTO saas.users (tenant_id, email, role, admin_lifetime, is_active)
         VALUES ($1, $2, $3, $4, TRUE) RETURNING id`,
        [tenantId, email, role, adminLifetime]
      );
      userId = newUser.rows[0].id;
    }

    const inviteToken = randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + this.INVITE_TTL_MS);

    await db.query(
      `UPDATE saas.users SET invite_token = $1, invite_expires = $2, updated_at = NOW() WHERE id = $3`,
      [inviteToken, expiresAt, userId]
    );

    if (adminLifetime) {
      await db.query(
        `INSERT INTO saas.entitlements (tenant_id, user_id, entitlement, granted_by)
         VALUES ($1, $2, 'admin_lifetime', $3) ON CONFLICT DO NOTHING`,
        [tenantId, userId, invitedBy ?? 'bootstrap']
      );
      await db.query(`UPDATE saas.tenants SET admin_lifetime = TRUE WHERE id = $1`, [tenantId]);
    }

    const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3001';
    const inviteUrl = `${baseUrl}/invite?token=${inviteToken}&email=${encodeURIComponent(email)}`;
    logger.info({ email, role, adminLifetime, expiresAt }, 'Invite creee');
    return { inviteUrl, expiresAt };
  }

  // ─── ACCEPTER L'INVITATION ────────────────────────────────
  async acceptInvite(
    token: string, email: string, newPassword: string, totpSecret?: string
  ): Promise<TokenPair> {
    const user = await db.query(
      `SELECT id, email, invite_token, invite_expires, tenant_id, role
       FROM saas.users WHERE email = $1 AND invite_token = $2 AND is_active = TRUE`,
      [email, token]
    );
    if (!user.rows.length) throw new Error('Token invalide ou email incorrect');
    const u = user.rows[0];
    if (new Date(u.invite_expires) < new Date()) throw new Error('Token expire');

    this.assertPasswordStrength(newPassword);
    const passwordHash = await this.hashPassword(newPassword);

    await db.query(
      `UPDATE saas.users SET password_hash = $1, invite_token = NULL, invite_expires = NULL,
         mfa_enabled = $2, mfa_secret = $3, updated_at = NOW() WHERE id = $4`,
      [passwordHash, !!totpSecret, totpSecret ?? null, u.id]
    );

    await db.query(
      `INSERT INTO ops.audit_log (tenant_id, user_id, action) VALUES ($1, $2, 'account_activated_via_invite')`,
      [u.tenant_id, u.id]
    );
    logger.info({ email, userId: u.id }, 'Compte active via invite');
    return this.issueTokenPair(u.id, u.tenant_id, u.role);
  }

  // ─── RESET PASSWORD FLOW ──────────────────────────────────
  async requestPasswordReset(email: string): Promise<string> {
    const user = await db.query(
      `SELECT id, tenant_id FROM saas.users WHERE email = $1 AND is_active = TRUE`, [email]
    );
    if (!user.rows.length) return 'ok'; // no user enumeration

    const resetToken = randomBytes(32).toString('hex');
    const tokenHash = createHash('sha256').update(resetToken).digest('hex');
    const expiresAt = new Date(Date.now() + this.INVITE_TTL_MS);

    await db.query(`DELETE FROM saas.auth_tokens WHERE user_id = $1 AND type = 'reset'`, [user.rows[0].id]);
    await db.query(
      `INSERT INTO saas.auth_tokens (user_id, token_hash, type, expires_at) VALUES ($1, $2, 'reset', $3)`,
      [user.rows[0].id, tokenHash, expiresAt]
    );

    const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3001';
    const resetUrl = `${baseUrl}/reset-password?token=${resetToken}&email=${encodeURIComponent(email)}`;
    logger.info({ email }, `Reset link generated`);
    return 'ok';
  }

  async confirmPasswordReset(token: string, email: string, newPassword: string): Promise<TokenPair> {
    const tokenHash = createHash('sha256').update(token).digest('hex');
    const tokenRow = await db.query(
      `SELECT t.id, t.user_id, u.tenant_id, u.role, t.expires_at
       FROM saas.auth_tokens t JOIN saas.users u ON u.id = t.user_id
       WHERE u.email = $1 AND t.token_hash = $2 AND t.type = 'reset' AND t.is_revoked = FALSE`,
      [email, tokenHash]
    );
    if (!tokenRow.rows.length) throw new Error('Token invalide');
    if (new Date(tokenRow.rows[0].expires_at) < new Date()) throw new Error('Token expire');

    this.assertPasswordStrength(newPassword);
    const passwordHash = await this.hashPassword(newPassword);
    const userId = tokenRow.rows[0].user_id;

    await db.query(`UPDATE saas.users SET password_hash = $1, updated_at = NOW() WHERE id = $2`, [passwordHash, userId]);
    await db.query(`UPDATE saas.auth_tokens SET is_revoked = TRUE WHERE id = $1`, [tokenRow.rows[0].id]);
    await db.query(
      `INSERT INTO ops.audit_log (tenant_id, user_id, action) VALUES ($1, $2, 'password_reset_confirmed')`,
      [tokenRow.rows[0].tenant_id, userId]
    );
    return this.issueTokenPair(userId, tokenRow.rows[0].tenant_id, tokenRow.rows[0].role);
  }

  // ─── LOGIN ────────────────────────────────────────────────
  async login(email: string, password: string, totpCode?: string): Promise<TokenPair> {
    const user = await db.query(
      `SELECT id, tenant_id, role, password_hash, mfa_enabled, mfa_secret, is_active
       FROM saas.users WHERE email = $1`, [email]
    );
    if (!user.rows.length || !user.rows[0].is_active) throw new Error('Identifiants incorrects');

    const u = user.rows[0];
    if (!u.password_hash) throw new Error('Compte non active — utiliser le lien d\'invitation');

    const valid = await this.verifyPassword(password, u.password_hash);
    if (!valid) throw new Error('Identifiants incorrects');

    if (u.mfa_enabled) {
      if (!totpCode) throw new Error('Code MFA requis');
      const mfaValid = this.verifyTOTP(u.mfa_secret, totpCode);
      if (!mfaValid) throw new Error('Code MFA invalide');
    }

    await db.query(`UPDATE saas.users SET last_login_at = NOW() WHERE id = $1`, [u.id]);
    await db.query(
      `INSERT INTO ops.audit_log (tenant_id, user_id, action) VALUES ($1,$2,'login')`,
      [u.tenant_id, u.id]
    );
    return this.issueTokenPair(u.id, u.tenant_id, u.role);
  }

  // ─── REFRESH TOKEN ────────────────────────────────────────
  async refreshToken(refreshTokenStr: string): Promise<TokenPair> {
    const tokenHash = createHash('sha256').update(refreshTokenStr).digest('hex');
    const stored = await db.query(
      `SELECT at.id, at.user_id, u.tenant_id, u.role
       FROM saas.auth_tokens at JOIN saas.users u ON u.id = at.user_id
       WHERE at.token_hash = $1 AND at.type = 'refresh' AND at.is_revoked = FALSE AND at.expires_at > NOW()`,
      [tokenHash]
    );
    if (!stored.rows.length) throw new Error('Session expiree — reconnecter');

    await db.query(`UPDATE saas.auth_tokens SET is_revoked = TRUE WHERE id = $1`, [stored.rows[0].id]);
    return this.issueTokenPair(stored.rows[0].user_id, stored.rows[0].tenant_id, stored.rows[0].role);
  }

  // ─── LOGOUT ───────────────────────────────────────────────
  async logout(refreshTokenStr: string): Promise<void> {
    const tokenHash = createHash('sha256').update(refreshTokenStr).digest('hex');
    await db.query(`UPDATE saas.auth_tokens SET is_revoked = TRUE WHERE token_hash = $1`, [tokenHash]);
  }

  // ─── Helpers prives ───────────────────────────────────────
  private issueTokenPair(userId: string, tenantId: string, role: string): TokenPair {
    const accessToken = jwt.sign(
      { userId, tenantId, role },
      this.JWT_SECRET,
      { expiresIn: this.ACCESS_TOKEN_TTL }
    );

    const refreshTokenStr = randomBytes(32).toString('hex');
    const refreshHash = createHash('sha256').update(refreshTokenStr).digest('hex');

    db.query(
      `INSERT INTO saas.auth_tokens (user_id, token_hash, type, expires_at)
       VALUES ($1, $2, 'refresh', NOW() + INTERVAL '7 days')`,
      [userId, refreshHash]
    ).catch(e => logger.error({ e }, 'Failed to store refresh token'));

    return { accessToken, refreshToken: refreshTokenStr, expiresIn: this.ACCESS_TOKEN_TTL };
  }

  private assertPasswordStrength(password: string): void {
    if (password.length < 12) throw new Error('Mot de passe trop court (12 caracteres minimum)');
    if (!/[A-Z]/.test(password)) throw new Error('Doit contenir au moins une majuscule');
    if (!/[0-9]/.test(password)) throw new Error('Doit contenir au moins un chiffre');
    if (!/[^A-Za-z0-9]/.test(password)) throw new Error('Doit contenir au moins un caractere special');
  }

  private async hashPassword(password: string): Promise<string> {
    return bcrypt.hash(password, this.BCRYPT_ROUNDS);
  }

  private async verifyPassword(password: string, hash: string): Promise<boolean> {
    // Support legacy sha256 hashes (migration path)
    if (hash.startsWith('sha256:')) {
      const parts = hash.split(':');
      const { createHmac } = await import('crypto');
      const expected = createHmac('sha256', parts[1]).update(password).digest('hex');
      const match = timingSafeEqual(Buffer.from(expected), Buffer.from(parts[2]));
      // TODO: re-hash with bcrypt on successful login for migration
      return match;
    }
    return bcrypt.compare(password, hash);
  }

  private verifyTOTP(secret: string, code: string): boolean {
    return authenticator.verify({ secret, token: code });
  }
}
