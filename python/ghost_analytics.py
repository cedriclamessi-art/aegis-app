# ============================================================
# GHOST ANALYTICS — Observation Invisible
# 4 Modes, 3 Niveaux de Signaux, 154 Agents Observés
# ============================================================

from datetime import datetime, timedelta
from typing import Dict, List, Optional, Callable
from enum import Enum
import json

class GhostMode(Enum):
    PERFORMANCE = "performance"
    COMPETITOR = "competitor"
    BEHAVIOR = "behavior"
    OPPORTUNITY = "opportunity"

class SignalLevel(Enum):
    WHISPER = "whisper"    # Information
    MURMUR = "murmur"      # Anomalie, recommandation
    ALERT = "alert"        # Crise, action urgente

class GhostSignal:
    """
    Signal émis par Ghost
    """
    
    def __init__(self, 
                 mode: GhostMode, 
                 level: SignalLevel, 
                 source_agent: str,
                 target_agents: List[str],
                 observation: str,
                 recommendation: Optional[str] = None,
                 confidence: float = 0.8,
                 auto_action: Optional[Callable] = None,
                 auto_action_delay_minutes: int = 15):
        
        self.mode = mode
        self.level = level
        self.source_agent = source_agent
        self.target_agents = target_agents
        self.observation = observation
        self.recommendation = recommendation
        self.confidence = confidence
        self.auto_action = auto_action
        self.auto_action_delay = auto_action_delay_minutes
        self.timestamp = datetime.utcnow()
        self.acknowledged_by = None
        self.acknowledged_at = None
    
    def to_dict(self) -> Dict:
        return {
            "mode": self.mode.value,
            "level": self.level.value,
            "source": self.source_agent,
            "targets": self.target_agents,
            "observation": self.observation,
            "recommendation": self.recommendation,
            "confidence": self.confidence,
            "timestamp": self.timestamp.isoformat(),
            "acknowledged": self.acknowledged_by is not None
        }

class GhostAgent:
    """
    Agent Ghost individuel (4 instances : Performance, Competitor, Behavior, Opportunity)
    """
    
    def __init__(self, mode: GhostMode, code: str):
        self.mode = mode
        self.code = code
        self.observation_buffer = []
        self.signal_history = []
        self.is_observing = False
    
    async def observe(self, context: Dict):
        """
        Mode observation continue
        """
        self.is_observing = True
        
        if self.mode == GhostMode.PERFORMANCE:
            await self._observe_performance(context)
        elif self.mode == GhostMode.COMPETITOR:
            await self._observe_competitors(context)
        elif self.mode == GhostMode.BEHAVIOR:
            await self._observe_behavior(context)
        elif self.mode == GhostMode.OPPORTUNITY:
            await self._observe_opportunities(context)
    
    async def _observe_performance(self, context: Dict):
        """
        Mode Performance : Surveillance KPIs
        """
        brand_id = context.get('brand_id')
        
        # Collecte métriques temps réel
        metrics = await self._collect_performance_metrics(brand_id)
        
        # Analyse vs baseline
        for metric_name, current_value in metrics.items():
            baseline = await self._get_baseline(brand_id, metric_name)
            trend = await self._get_trend(brand_id, metric_name, hours=24)
            
            # Détection niveau signal
            deviation = (current_value - baseline) / baseline if baseline else 0
            
            if metric_name == 'conversion_rate':
                if deviation < -0.45:  # -45%
                    signal = GhostSignal(
                        mode=GhostMode.PERFORMANCE,
                        level=SignalLevel.ALERT,
                        source_agent=self.code,
                        target_agents=["CEO-1", "TURBULENCE-1", "ANALYTICS-1"],
                        observation=f"CVR collapsed: {current_value:.2%} vs baseline {baseline:.2%} ({deviation:+.1%})",
                        recommendation="URGENT: Verify checkout functionality. Auto-stop campaigns in 15min if no ack.",
                        confidence=0.95,
                        auto_action=self._emergency_stop_campaigns,
                        auto_action_delay_minutes=15
                    )
                    await self._emit_signal(signal)
                    
                elif deviation < -0.20:  # -20%
                    signal = GhostSignal(
                        mode=GhostMode.PERFORMANCE,
                        level=SignalLevel.MURMUR,
                        source_agent=self.code,
                        target_agents=["ANALYTICS-1", "ADS-1"],
                        observation=f"CVR significant drop: {current_value:.2%} vs baseline {baseline:.2%}",
                        recommendation="Review recent changes (creatives, pricing, audience). Consider A/B test pause.",
                        confidence=0.80
                    )
                    await self._emit_signal(signal)
                    
                elif deviation < -0.05:  # -5%
                    # Whisper — juste log
                    self.observation_buffer.append({
                        "timestamp": datetime.utcnow(),
                        "metric": metric_name,
                        "value": current_value,
                        "baseline": baseline,
                        "deviation": deviation,
                        "note": "Slight underperformance, monitoring"
                    })
    
    async def _observe_competitors(self, context: Dict):
        """
        Mode Competitor : Veille concurrentielle
        """
        brand_id = context.get('brand_id')
        competitors = context.get('competitors', [])
        
        for competitor in competitors:
            # Surveillance prix
            price_change = await self._check_competitor_pricing(competitor)
            if price_change['change_percent'] < -0.20:  # -20% price drop
                signal = GhostSignal(
                    mode=GhostMode.COMPETITOR,
                    level=SignalLevel.MURMUR,
                    source_agent=self.code,
                    target_agents=["INTEL-1", "STRATEGY-1", "CEO-1"],
                    observation=f"Competitor {competitor} dropped prices by {abs(price_change['change_percent']):.0%} on {price_change['product_category']}",
                    recommendation="Options: (1) Match price (margin impact: -15%), (2) Emphasize differentiation, (3) Target different segment. Analysis needed.",
                    confidence=0.85
                )
                await self._emit_signal(signal)
            
            # Surveillance nouvelles campagnes
            new_ads = await self._detect_new_competitor_ads(competitor)
            if new_ads:
                # Whisper — information
                self.observation_buffer.append({
                    "timestamp": datetime.utcnow(),
                    "competitor": competitor,
                    "event": "new_ads_detected",
                    "creatives_count": len(new_ads),
                    "platforms": list(set(ad['platform'] for ad in new_ads))
                })
    
    async def _observe_behavior(self, context: Dict):
        """
        Mode Behavior : Analyse comportement utilisateurs
        """
        brand_id = context.get('brand_id')
        
        # Heatmap analysis
        heatmap_data = await self._collect_heatmap_data(brand_id)
        
        # Détection rage clicks (frustration)
        rage_clicks = heatmap_data.get('rage_clicks', [])
        if len(rage_clicks) > 10:  # Seuil frustration
            signal = GhostSignal(
                mode=GhostMode.BEHAVIOR,
                level=SignalLevel.MURMUR,
                source_agent=self.code,
                target_agents=["NAV-1", "TECH-1", "UX-1"],
                observation=f"High rage click activity detected: {len(rage_clicks)} instances on {rage_clicks[0]['element']}",
                recommendation="Element likely broken or misleading. Inspect and fix urgently.",
                confidence=0.90
            )
            await self._emit_signal(signal)
        
        # Détection scroll depth anormal (contenu pas vu)
        scroll_data = heatmap_data.get('scroll_depth', {})
        if scroll_data.get('average_depth_percent', 100) < 30:
            signal = GhostSignal(
                mode=GhostMode.BEHAVIOR,
                level=SignalLevel.WHISPER,
                source_agent=self.code,
                target_agents=["NAV-1"],
                observation=f"Low scroll depth: {scroll_data['average_depth_percent']:.0%}. Key content may be missed.",
                recommendation="Consider moving CTA above fold or improving hook.",
                confidence=0.75
            )
            # Whisper = pas d'émission formelle, juste log
            self.observation_buffer.append(signal.to_dict())
    
    async def _observe_opportunities(self, context: Dict):
        """
        Mode Opportunity : Scan tendances et opportunités
        """
        # Scan Twitter/TikTok trending
        trending_topics = await self._scan_social_trends()
        
        for topic in trending_topics:
            relevance_score = self._calculate_relevance(topic, context.get('niche'))
            if relevance_score > 0.8:
                signal = GhostSignal(
                    mode=GhostMode.OPPORTUNITY,
                    level=SignalLevel.MURMUR,
                    source_agent=self.code,
                    target_agents=["HUNTER-1", "GROWTH-1", "CEO-1"],
                    observation=f"Trending topic highly relevant to niche: '{topic['name']}' (volume: {topic['volume']})",
                    recommendation=f"Fast-follow opportunity: Create content/campaign around '{topic['name']}' within 24-48h for maximum virality.",
                    confidence=relevance_score
                )
                await self._emit_signal(signal)
    
    async def _emit_signal(self, signal: GhostSignal):
        """
        Émet un signal vers les agents cibles
        """
        # Stockage historique
        self.signal_history.append(signal)
        
        # Envoi aux agents cibles
        for target in signal.target_agents:
            await self._send_to_agent(target, signal)
        
        # Log spécial si ALERT
        if signal.level == SignalLevel.ALERT:
            await self._escalate_to_super_admins(signal)
            
            # Programmation auto-action si configurée
            if signal.auto_action:
                asyncio.create_task(self._schedule_auto_action(signal))
    
    async def _schedule_auto_action(self, signal: GhostSignal):
        """
        Attente avant auto-action si pas d'acquittement
        """
        await asyncio.sleep(signal.auto_action_delay * 60)
        
        # Vérification acquittement
        if signal.acknowledged_by is None:
            print(f"[GHOST ALERT] No acknowledgment after {signal.auto_action_delay}min. Executing auto-action.")
            await signal.auto_action()
            signal.auto_action_executed = True

class GhostAnalyticsSystem:
    """
    Système Ghost complet — 4 agents d'observation
    """
    
    def __init__(self):
        self.ghosts = {
            GhostMode.PERFORMANCE: GhostAgent(GhostMode.PERFORMANCE, "GHOST-PERF"),
            GhostMode.COMPETITOR: GhostAgent(GhostMode.COMPETITOR, "GHOST-COMP"),
            GhostMode.BEHAVIOR: GhostAgent(GhostMode.BEHAVIOR, "GHOST-BEHAV"),
            GhostMode.OPPORTUNITY: GhostAgent(GhostMode.OPPORTUNITY, "GHOST-OPP")
        }
        
        self.active_sessions = {}
    
    def start_observation_session(self, session_name: str, brand_id: str):
        """
        Démarre session d'observation complète
        """
        self.active_sessions[session_name] = {
            "brand_id": brand_id,
            "started_at": datetime.utcnow(),
            "ghosts_active": list(self.ghosts.keys()),
            "signals_emitted": []
        }
        
        # Lancement observation parallèle
        for ghost in self.ghosts.values():
            asyncio.create_task(ghost.observe({"brand_id": brand_id}))
        
        print(f"[GHOST] Observation session '{session_name}' started for brand {brand_id}")
    
    def log_phase_start(self, phase_name: str, timestamp: datetime):
        """Log début phase Monday Flow"""
        for ghost in self.ghosts.values():
            ghost.observation_buffer.append({
                "type": "phase_start",
                "phase": phase_name,
                "timestamp": timestamp
            })
    
    def log_phase_end(self, phase_name: str, timestamp: datetime, status: str):
        """Log fin phase Monday Flow"""
        for ghost in self.ghosts.values():
            ghost.observation_buffer.append({
                "type": "phase_end",
                "phase": phase_name,
                "status": status,
                "timestamp": timestamp
            })
    
    def log_agent_execution(self, agent_code: str, task: str, status: str, result: Dict):
        """Log exécution agent"""
        # Ghost-Performance track les performances des agents
        self.ghosts[GhostMode.PERFORMANCE].observation_buffer.append({
            "type": "agent_execution",
            "agent": agent_code,
            "task": task,
            "status": status,
            "duration": result.get('execution_time'),
            "timestamp": datetime.utcnow()
        })
    
    def log_turbulence(self, detector: str, level: str, metrics: Dict):
        """Log événement turbulence"""
        signal = GhostSignal(
            mode=GhostMode.PERFORMANCE,
            level=SignalLevel.ALERT if level == "alert" else SignalLevel.MURMUR,
            source_agent="TURBULENCE",
            target_agents=["CEO-1", "GHOST-PERF"],
            observation=f"Turbulence detected: {detector} at level {level}",
            recommendation="Review turbulence report and validate auto-corrections.",
            confidence=0.90
        )
        asyncio.create_task(self.ghosts[GhostMode.PERFORMANCE]._emit_signal(signal))
    
    def generate_session_report(self, session_name: str = "monday_flow") -> Dict:
        """
        Génère rapport complet de session
        """
        session = self.active_sessions.get(session_name)
        if not session:
            return {"error": "Session not found"}
        
        report = {
            "session": session_name,
            "brand_id": session['brand_id'],
            "duration": (datetime.utcnow() - session['started_at']).total_seconds() / 3600,
            "observations_by_mode": {},
            "signals_emitted": {
                "whisper": 0,
                "murmur": 0,
                "alert": 0
            },
            "key_findings": []
        }
        
        for mode, ghost in self.ghosts.items():
            report["observations_by_mode"][mode.value] = len(ghost.observation_buffer)
            
            for signal in ghost.signal_history:
                report["signals_emitted"][signal.level.value] += 1
                
                if signal.level == SignalLevel.ALERT:
                    report["key_findings"].append({
                        "timestamp": signal.timestamp.isoformat(),
                        "observation": signal.observation,
                        "recommendation": signal.recommendation
                    })
        
        return report