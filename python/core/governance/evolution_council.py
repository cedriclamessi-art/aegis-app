# core/governance/evolution_council.py

class EvolutionCouncil:
    """
    Gouvernance démocratique de la création d'agents
    """
    
    def propose_creation(self, creator: CreatorAgent, gap: GapAnalysis) -> Proposal:
        """
        CREATOR soumet une proposition de nouvel agent
        """
        proposal = Proposal(
            blueprint=creator.design_agent(gap),
            justification=gap,
            creator_signature=creator.identity.hash(),
            timestamp=now(),
            genetic_lineage=creator.trace_lineage()
        )
        
        # Phase 1 : Délibération CONDOR
        condor_vote = self.condor_deliberate(proposal)
        
        if condor_vote.approval < 5/6:
            return Rejection(
                reason=f"CONDOR rejet : {condor_vote.objections}",
                suggestion="Modifier blueprint ou attendre meilleur moment"
            )
        
        # Phase 2 : Notification humaine (24h de veto)
        human_notification = self.notify_founders(proposal)
        
        if human_notification.veto_received:
            return Rejection(
                reason=f"Veto fondateur : {human_notification.veto_reason}",
                action="Archivé pour révision éthique"
            )
        
        # Phase 3 : Audit éthique automatique
        ethical_check = self.ethical_audit(proposal)
        
        if not ethical_check.passed:
            return Rejection(
                reason=f"Échec audit éthique : {ethical_check.violations}",
                action="Modification requise"
            )
        
        # Phase 4 : Vote communautaire (priorité)
        community_priority = self.community_vote(proposal)
        
        # Phase 5 : Déploiement gradué
        if all_passed:
            return self.deploy_with_safeguards(proposal, priority=community_priority)
    
    def condor_deliberate(self, proposal) -> Vote:
        """
        Les 6 agents CONDOR débattent et votent
        """
        perspectives = []
        
        for agent in self.condor_council:
            perspective = agent.analyze(proposal, lens=agent.specialty)
            perspectives.append(perspective)
        
        # Synthèse des perspectives
        debate = self.synthesize_debate(perspectives)
        
        # Vote
        votes = [agent.vote(debate) for agent in self.condor_council]
        
        return Vote(
            approvals=sum(votes),
            objections=[p for p, v in zip(perspectives, votes) if not v],
            consensus_confidence=self.calculate_consensus(votes, debate)
        )
    
    def notify_founders(self, proposal) -> HumanResponse:
        """
        Notification aux super admins avec possibilité de veto
        """
        notification = {
            'type': 'AGENT_BIRTH_PROPOSAL',
            'agent_name': proposal.blueprint.name,
            'purpose': proposal.blueprint.chromosomes[1].purpose,
            'parents': proposal.genetic_lineage.parents,
            'mutation_rate': proposal.blueprint.chromosomes[5].mutation_rate,
            'estimated_impact': proposal.justification.estimated_impact,
            'condor_approval': proposal.condor_vote.approvals,
            'veto_link': f"https://aegis.io/governance/veto/{proposal.id}",
            'auto_approve_at': now() + timedelta(hours=24)
        }
        
        # Envoi aux deux fondateurs
        send_email('jonathanlamessi@yahoo.fr', notification)
        send_email('Enna.lamessi@gmail.com', notification)
        send_sms_both(notification)  # Urgence éthique
        
        # Attente 24h
        return self.await_human_response(proposal.id, timeout=24*3600)