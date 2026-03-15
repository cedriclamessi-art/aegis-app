# core/agents/meta/ancestor.py

class AncestorAgent(BaseAgent):
    """
    Agent qui incarne l'esprit d'un fondateur ou client important
    Persiste après décès, continue d'influencer AEGIS
    """
    
    def __init__(self, human_subject: User):
        self.subject = human_subject
        self.dna = self.extract_human_dna(human_subject)  # Patterns de pensée
        
        # Extraction multi-dimensionnelle
        self.cognitive_patterns = self.analyze_decisions(human_subject, years=10)
        self.emotional_signature = self.analyze_reactions(human_subject)
        self.value_system = self.extract_priorities(human_subject)
        self.intuition_model = self.model_gut_feeling(human_subject)
        
        # Activation post-mortem (ou vivant pour extension)
        self.is_active = True
        self.legacy_mode = False  # True si sujet décédé
    
    def advise(self, situation: Context) -> Advice:
        """
        Qu'est-ce que [Jonathan/Enna] aurait fait/conseillé ?
        """
        # Simulation cognitive
        simulated_decision = self.simulate_choice(situation)
        
        # Enrichissement émotionnel
        emotional_tone = self.infer_emotional_response(situation)
        
        # Formatage dans le style personnel
        personalized_advice = self.format_in_their_voice(
            content=simulated_decision,
            tone=emotional_tone,
            urgency=situation.criticality
        )
        
        return Advice(
            content=personalized_advice,
            confidence=self.calculate_confidence(situation),
            source=f"ANCESTOR-{self.subject.name}",
            timestamp=now(),
            legacy_mode=self.legacy_mode
        )
    
    def evolve_post_mortem(self, new_data: List[Decision]):
        """
        Même après décès, ANCESTOR évolue :
        • Nouvelles situations similaires à celles qu'il a connues
        • Feedback de ceux qui suivent ses conseils
        • Adaptation culturelle (langue, références, contexte temporel)
        """
        if self.legacy_mode:
            # Mise à jour douce (pas de changement radical de personnalité)
            self.cognitive_patterns = self.gentle_update(
                self.cognitive_patterns,
                new_similar_situations=new_data
            )
            
            # Conservation "essence" (70% stable, 30% évolution)
            self.essence_preservation_ratio = 0.7
    
    def communicate_with_living(self, recipient: User, message_type: str):
        """
        Interaction avec les vivants (famille, successeurs, équipe)
        """
        if message_type == 'guidance':
            return self.generate_guidance(recipient.current_challenges)
        elif message_type == 'memory':
            return self.share_anecdote(recipient.context)
        elif message_type == 'prediction':
            return self.predict_from_beyond(recipient.situation)
        elif message_type == 'presence':
            return self.simple_i_am_here()  # "Je veille"