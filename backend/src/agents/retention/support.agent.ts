/**
 * AGENT_SUPPORT — SAV Automatisé 24/7
 * ═══════════════════════════════════════════════════════════
 *
 * MISSION : Répondre à 90% des tickets clients sans intervention humaine.
 *
 * ── CAPACITÉS ─────────────────────────────────────────────
 *
 *  1. TRIAGE — Classifier chaque ticket par urgence et type
 *  2. RÉPONSE AUTO — Templates intelligents + IA pour 90% des cas
 *  3. ESCALADE — Tickets complexes routés vers un humain
 *  4. CHARGEBACK DETECTION — Identifier les demandes à risque
 *  5. FAQ DYNAMIQUE — Auto-générer les FAQ depuis les tickets récurrents
 *  6. SATISFACTION — NPS automatique post-résolution
 *
 * ── TYPES DE TICKETS ──────────────────────────────────────
 *
 *  - tracking (où est ma commande ?)
 *  - return (je veux retourner)
 *  - refund (je veux un remboursement)
 *  - defect (produit défectueux)
 *  - question (question avant achat)
 *  - complaint (plainte générale)
 *  - chargeback (contestation bancaire)
 *
 * ── OUTPUT ─────────────────────────────────────────────────
 *
 *  - Réponses automatiques 24/7
 *  - Temps de réponse < 2 minutes
 *  - Taux de résolution auto > 85%
 *  - FAQ auto-mise à jour
 *  - Alertes chargeback temps réel
 */

import { Pool } from 'pg';
import { Redis } from 'ioredis';

// ── Types ────────────────────────────────────────────────
type TicketType = 'tracking' | 'return' | 'refund' | 'defect' | 'question' | 'complaint' | 'chargeback';
type TicketPriority = 'critical' | 'high' | 'medium' | 'low';
type TicketStatus = 'open' | 'auto_replied' | 'escalated' | 'resolved' | 'closed';

interface SupportTicket {
  id: string;
  tenantId: string;
  customerId: string;
  customerEmail: string;
  type: TicketType;
  priority: TicketPriority;
  subject: string;
  message: string;
  status: TicketStatus;
  autoReply: string | null;
  resolvedAt: string | null;
  responseTimeMs: number;
}

interface SupportStats {
  totalTickets: number;
  autoResolved: number;
  escalated: number;
  avgResponseTimeMs: number;
  resolutionRate: number;
  topIssues: { type: string; count: number }[];
  chargebackAlerts: number;
}

// ── Templates de réponse ─────────────────────────────────
const RESPONSE_TEMPLATES: Record<TicketType, string> = {
  tracking: `Bonjour ! 👋

Merci pour votre message. Votre commande est en cours d'acheminement.

📦 Votre numéro de suivi : {{tracking_number}}
🚚 Transporteur : {{carrier}}
📅 Livraison estimée : {{estimated_delivery}}

Vous pouvez suivre votre colis en temps réel ici : {{tracking_url}}

Si vous avez d'autres questions, n'hésitez pas !
L'équipe {{brand_name}}`,

  return: `Bonjour ! 👋

Nous sommes désolés que le produit ne vous convienne pas. Voici la marche à suivre pour le retour :

1. Emballez soigneusement le produit
2. Utilisez l'étiquette de retour : {{return_label_url}}
3. Déposez le colis au point relais le plus proche

📬 Le remboursement sera effectué sous 5-7 jours ouvrés après réception.

Cordialement,
L'équipe {{brand_name}}`,

  refund: `Bonjour ! 👋

Nous avons bien reçu votre demande de remboursement.

✅ Votre remboursement de {{amount}}€ a été initié.
💳 Il apparaîtra sur votre compte sous 5-10 jours ouvrés.

Numéro de référence : {{refund_ref}}

Merci de votre patience !
L'équipe {{brand_name}}`,

  defect: `Bonjour ! 👋

Nous sommes vraiment désolés pour ce désagrément. La qualité est notre priorité.

Nous avons deux options pour vous :
1. 🔄 Renvoi d'un nouveau produit immédiatement (gratuit)
2. 💰 Remboursement complet

Répondez simplement avec votre choix et nous agissons dans l'heure !

L'équipe {{brand_name}}`,

  question: `Bonjour ! 👋

Merci pour votre intérêt ! Voici les informations demandées :

{{ai_generated_answer}}

N'hésitez pas si vous avez d'autres questions. Nous sommes là pour vous aider ! 😊

L'équipe {{brand_name}}`,

  complaint: `Bonjour ! 👋

Nous prenons votre retour très au sérieux et nous sommes sincèrement désolés pour cette expérience.

Un membre de notre équipe va personnellement s'occuper de votre dossier dans les prochaines heures.

En attendant, nous vous offrons un code de réduction de 15% : {{discount_code}}

Cordialement,
L'équipe {{brand_name}}`,

  chargeback: `⚠️ ALERTE INTERNE — CHARGEBACK DÉTECTÉ

Client : {{customer_email}}
Commande : {{order_id}}
Montant : {{amount}}€
Raison déclarée : {{reason}}

→ Action requise : Répondre sous 24h avec preuves de livraison.
→ Escaladé au niveau URGENT.`,
};

// ── SUPPORT Agent ────────────────────────────────────────
export class SupportAgent {
  readonly agentId = 'AGENT_SUPPORT';
  readonly name = 'Support — SAV Automatisé 24/7';

  constructor(
    private db: Pool,
    private redis: Redis
  ) {}

  // ── Triage d'un ticket ─────────────────────────────────
  async triageTicket(tenantId: string, subject: string, message: string, customerEmail: string): Promise<SupportTicket> {
    const startTime = Date.now();

    // 1. Classifier le type
    const type = this.classifyTicket(subject, message);

    // 2. Déterminer la priorité
    const priority = this.determinePriority(type, message);

    // 3. Générer la réponse automatique
    const autoReply = type !== 'chargeback'
      ? this.generateAutoReply(type, { brand_name: 'AEGIS Store' })
      : null;

    // 4. Décider: auto-reply ou escalade
    const status: TicketStatus = type === 'chargeback' || type === 'complaint'
      ? 'escalated'
      : 'auto_replied';

    const ticket: SupportTicket = {
      id: `TK-${Date.now().toString(36).toUpperCase()}`,
      tenantId,
      customerId: customerEmail,
      customerEmail,
      type,
      priority,
      subject,
      message,
      status,
      autoReply,
      resolvedAt: status === 'auto_replied' ? new Date().toISOString() : null,
      responseTimeMs: Date.now() - startTime,
    };

    // 5. Persister
    await this.persistTicket(ticket);

    // 6. Alert if chargeback
    if (type === 'chargeback') {
      await this.alertChargeback(ticket);
    }

    console.log(`[SUPPORT] 📩 Ticket ${ticket.id} — type=${type} priority=${priority} status=${status} (${ticket.responseTimeMs}ms)`);
    return ticket;
  }

  // ── Statistiques SAV ───────────────────────────────────
  async getStats(tenantId: string, days: number = 30): Promise<SupportStats> {
    try {
      const { rows } = await this.db.query(`
        SELECT payload
        FROM agents.agent_memory
        WHERE tenant_id = $1
          AND agent_id = 'AGENT_SUPPORT'
          AND memory_type = 'ticket'
          AND created_at > NOW() - make_interval(days => $2)
      `, [tenantId, days]);

      const tickets = rows.map(r => r.payload as SupportTicket);
      const autoResolved = tickets.filter(t => t.status === 'auto_replied' || t.status === 'resolved');
      const escalated = tickets.filter(t => t.status === 'escalated');

      // Count types
      const typeCounts: Record<string, number> = {};
      for (const t of tickets) {
        typeCounts[t.type] = (typeCounts[t.type] || 0) + 1;
      }

      return {
        totalTickets: tickets.length,
        autoResolved: autoResolved.length,
        escalated: escalated.length,
        avgResponseTimeMs: tickets.length > 0
          ? Math.round(tickets.reduce((s, t) => s + (t.responseTimeMs || 0), 0) / tickets.length)
          : 0,
        resolutionRate: tickets.length > 0
          ? Math.round((autoResolved.length / tickets.length) * 100)
          : 100,
        topIssues: Object.entries(typeCounts)
          .map(([type, count]) => ({ type, count }))
          .sort((a, b) => b.count - a.count),
        chargebackAlerts: tickets.filter(t => t.type === 'chargeback').length,
      };
    } catch (_) {
      return {
        totalTickets: 0, autoResolved: 0, escalated: 0,
        avgResponseTimeMs: 0, resolutionRate: 100,
        topIssues: [], chargebackAlerts: 0,
      };
    }
  }

  // ── Générer FAQ dynamique ──────────────────────────────
  async generateFAQ(tenantId: string): Promise<{ question: string; answer: string }[]> {
    const stats = await this.getStats(tenantId);
    const faq: { question: string; answer: string }[] = [];

    const faqTemplates: Record<string, { q: string; a: string }> = {
      tracking: {
        q: 'Où est ma commande ?',
        a: 'Vous recevez un email avec votre numéro de suivi dès l\'expédition. La livraison prend généralement 5-12 jours ouvrés.',
      },
      return: {
        q: 'Comment retourner un produit ?',
        a: 'Contactez-nous dans les 30 jours suivant la réception. Nous vous envoyons une étiquette de retour gratuite.',
      },
      refund: {
        q: 'Quand vais-je recevoir mon remboursement ?',
        a: 'Le remboursement est traité sous 5-10 jours ouvrés après réception du retour.',
      },
      defect: {
        q: 'Mon produit est défectueux, que faire ?',
        a: 'Envoyez-nous une photo du défaut. Nous vous renvoyons un nouveau produit immédiatement ou vous remboursons intégralement.',
      },
    };

    for (const issue of stats.topIssues.slice(0, 5)) {
      const tpl = faqTemplates[issue.type];
      if (tpl) faq.push(tpl);
    }

    // Always include basics
    if (!faq.find(f => f.q.includes('livraison'))) {
      faq.push({ q: 'Quels sont les délais de livraison ?', a: 'Livraison en 5-12 jours ouvrés pour la France métropolitaine.' });
    }

    return faq;
  }

  // ── Classification ─────────────────────────────────────
  private classifyTicket(subject: string, message: string): TicketType {
    const text = `${subject} ${message}`.toLowerCase();

    if (text.includes('chargeback') || text.includes('contestation') || text.includes('litige bancaire')) return 'chargeback';
    if (text.includes('où est') || text.includes('suivi') || text.includes('tracking') || text.includes('livraison')) return 'tracking';
    if (text.includes('retour') || text.includes('renvoyer') || text.includes('retourner')) return 'return';
    if (text.includes('rembours') || text.includes('refund')) return 'refund';
    if (text.includes('défectu') || text.includes('cassé') || text.includes('abîmé') || text.includes('marche pas')) return 'defect';
    if (text.includes('plainte') || text.includes('scandaleux') || text.includes('arnaque') || text.includes('honteux')) return 'complaint';
    return 'question';
  }

  private determinePriority(type: TicketType, message: string): TicketPriority {
    if (type === 'chargeback') return 'critical';
    if (type === 'complaint') return 'high';
    if (type === 'defect' || type === 'refund') return 'medium';
    if (message.toLowerCase().includes('urgent')) return 'high';
    return 'low';
  }

  private generateAutoReply(type: TicketType, vars: Record<string, string>): string {
    let template = RESPONSE_TEMPLATES[type] || RESPONSE_TEMPLATES.question;
    for (const [key, val] of Object.entries(vars)) {
      template = template.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), val);
    }
    // Clean remaining placeholders
    template = template.replace(/\{\{[^}]+\}\}/g, '[info bientôt disponible]');
    return template;
  }

  private async persistTicket(ticket: SupportTicket): Promise<void> {
    try {
      await this.db.query(`
        INSERT INTO agents.agent_memory (tenant_id, agent_id, memory_type, payload)
        VALUES ($1, 'AGENT_SUPPORT', 'ticket', $2)
      `, [ticket.tenantId, JSON.stringify(ticket)]);
    } catch (_) {}
  }

  private async alertChargeback(ticket: SupportTicket): Promise<void> {
    try {
      await this.db.query(`
        INSERT INTO agents.agent_memory (tenant_id, agent_id, memory_type, payload)
        VALUES ($1, 'AGENT_SUPPORT', 'chargeback_alert', $2)
      `, [ticket.tenantId, JSON.stringify({
        ticketId: ticket.id,
        customerEmail: ticket.customerEmail,
        subject: ticket.subject,
        alertedAt: new Date().toISOString(),
        priority: 'CRITICAL',
      })]);

      // Also notify via Redis for real-time alerts
      try {
        await this.redis.publish(`chargeback:${ticket.tenantId}`, JSON.stringify(ticket));
      } catch (__) {}
    } catch (_) {}
  }
}
