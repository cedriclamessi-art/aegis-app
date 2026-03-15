# core/genetics/agent_dna.py

class AgentGenetics:
    """
    Système génétique des agents AEGIS
    """
    
    def reproduce(self, parent1: AgentDNA, parent2: AgentDNA, 
                  environmental_pressure: Context) -> AgentDNA:
        """
        Création d'un nouvel agent par combinaison de deux parents
        """
        child = AgentDNA()
        
        # Crossover : Mélange des chromosomes
        for chrom in range(1, 9):
            if random() < 0.5:
                child.chromosomes[chrom] = parent1.chromosomes[chrom].copy()
            else:
                child.chromosomes[chrom] = parent2.chromosomes[chrom].copy()
        
        # Mutation : Adaptation à la pression environnementale
        mutation_rate = self.calculate_mutation_rate(parent1, parent2, environmental_pressure)
        
        for gene in child.all_genes():
            if random() < mutation_rate:
                gene.mutate(direction=self.infer_optimal_direction(environmental_pressure))
        
        # Validation : La mutation est-elle viable ?
        if not self.is_viable(child):
            return self.reproduce(parent1, parent2, environmental_pressure)  # Retry
        
        # Enregistrement généalogique
        child.lineage = {
            'parents': [parent1.id, parent2.id],
            'generation': max(parent1.generation, parent2.generation) + 1,
            'birth_context': environmental_pressure.hash(),
            'timestamp': now()
        }
        
        return child
    
    def calculate_mutation_rate(self, p1, p2, pressure) -> float:
        """
        Plus l'environnement change vite, plus on mute (innovation)
        Plus les parents sont stables, moins on mute (conservation)
        """
        stability = (p1.fitness + p2.fitness) / 2
        turbulence = pressure.change_velocity
        
        # Formule : Mutation inversement proportionnelle à stabilité,
        # directement proportionnelle à turbulence
        base_rate = 0.05  # 5% de base
        adaptation = (1 - stability) * 0.3  # +30% max si instable
        urgency = min(turbulence * 0.2, 0.4)  # +40% max si crise
        
        return min(base_rate + adaptation + urgency, 0.5)  # Max 50%
    
    def is_viable(self, dna: AgentDNA) -> bool:
        """
        Vérification de viabilité (pas de mutations létales)
        """
        checks = [
            dna.chromosomes[1].purpose.is_defined(),  # Doit avoir un but
            dna.chromosomes[4].safety.has_hard_limits(),  # Doit avoir des limites
            dna.chromosomes[5].fitness > 0.1,  # Doit pouvoir survivre
            self.check_ethical_constraints(dna),  # Pas de gènes interdits
        ]
        return all(checks)