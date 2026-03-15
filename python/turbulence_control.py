# ============================================================
# TURBULENCE CONTROL — Détection et Correction Automatique
# 5 Détecteurs, 3 Niveaux d'Action, 154 agents protégés
# ============================================================

from datetime import datetime, timedelta
from typing import Dict, List, Optional, Callable
from enum import Enum
import asyncio

class AlertLevel(Enum):
    GREEN = "green"      # Normal
    WHISPER = "whisper"  # Surveillance accrue
    MURMUR = "murmur"    # Action corrective auto
    ALERT = "alert"      # Crise, escalation

class TurbulenceDetector:
    """
    Détecteur de turbulence individuel
    """
    
    def __init__(self, name: str, thresholds: Dict, check_interval_seconds: int):
        self.name = name
        self.thresholds = thresholds
        self.check_interval = check_interval_seconds
        self.correction_actions = {
            AlertLevel.WHISPER: [],
            AlertLevel.MURMUR: [],
            AlertLevel.ALERT: []
        }
    
    def check(self, metrics: Dict) -> AlertLevel:
        """
        Vérifie si les seuils sont dépassés
        """
        raise NotImplementedError

class CVROnlyDetector(TurbulenceDetector):
    """
    Détecteur 1 : Chute du taux de conversion
    """
    
    def __init__(self):
        super().__init__(
            name="CVR_DROP",
            thresholds={
                "whisper": -0.20,  # -20%
                "murmur": -0.30,   # -30%
                "alert": -0.50     # -50%
            },
            check_interval_seconds=300  # 5 minutes
        )
        
        # Actions auto par niveau
        self.correction_actions[AlertLevel.WHISPER] = [
            self._increase_monitoring,
            self._log_for_analysis
        ]
        self.correction_actions[AlertLevel.MURMUR] = [
            self._pause_affected_campaigns,
            self._test_checkout_flow,
            self._notify_team
        ]
        self.correction_actions[AlertLevel.ALERT] = [
            self._stop_all_campaigns,
            self._escalate_to_ceo,
            self._escalate_to_super_admins,
            self._initiate_post_mortem
        ]
    
    def check(self, metrics: Dict) -> AlertLevel:
        cvr_current = metrics.get('conversion_rate_current', 0)
        cvr_baseline = metrics.get('conversion_rate_baseline', 0.03)  # 3% default
        
        if cvr_baseline == 0:
            return AlertLevel.GREEN
        
        change_percent = (cvr_current - cvr_baseline) / cvr_baseline
        
        if change_percent <= self.thresholds['alert']:
            return AlertLevel.ALERT
        elif change_percent <= self.thresholds['murmur']:
            return AlertLevel.MURMUR
        elif change_percent <= self.thresholds['whisper']:
            return AlertLevel.WHISPER
        
        return AlertLevel.GREEN
    
    async def _pause_affected_campaigns(self, context: Dict):
        """
        Murmur : Pause les campagnes dont le CVR a chuté
        """
        affected_campaigns = context.get('affected_campaigns', [])
        
        for campaign_id in affected_campaigns:
            # Appel API Meta/TikTok/Google pour pause
            await self._pause_campaign(campaign_id)
            
            # Log
            print(f"[TURBULENCE] Campaign {campaign_id} paused due to CVR drop")
        
        # Notification
        await self._send_notification(
            to=["ops_team", "media_buyers"],
            subject=f"[MURMUR] CVR Drop detected — {len(affected_campaigns)} campaigns paused",
            body=f"Conversion rate dropped by {(context.get('change_percent', 0) * 100):.1f}%. "
                 f"Campaigns paused pending investigation."
        )
    
    async def _stop_all_campaigns(self, context: Dict):
        """
        Alert : Arrêt complet de toutes les campagnes
        """
        brand_id = context.get('brand_id')
        
        # Arrêt d'urgence toutes plateformes
        await asyncio.gather(
            self._emergency_stop_meta(brand_id),
            self._emergency_stop_tiktok(brand_id),
            self._emergency_stop_google(brand_id)
        )
        
        # Escalade immédiate
        await self._escalate_to_super_admins(context)

class CPASpikeDetector(TurbulenceDetector):
    """
    Détecteur 2 : Explosion du coût d'acquisition
    """
    
    def __init__(self):
        super().__init__(
            name="CPA_SPIKE",
            thresholds={
                "whisper": 0.50,   # +50%
                "murmur": 1.00,    # +100%
                "alert": 2.00      # +200%
            },
            check_interval_seconds=600  # 10 minutes
        )
        
        self.correction_actions[AlertLevel.MURMUR] = [
            self._reduce_budget_20_percent,
            self._test_new_audiences,
            self._rotate_creatives
        ]
        self.correction_actions[AlertLevel.ALERT] = [
            self._stop_platform,
            self._reallocate_budget_to_healthy_platforms,
            self._escalate_to_ceo
        ]
    
    def check(self, metrics: Dict) -> AlertLevel:
        cpa_current = metrics.get('cpa_current', 0)
        cpa_baseline = metrics.get('cpa_baseline', 50)  # €50 default
        
        if cpa_baseline == 0:
            return AlertLevel.GREEN
        
        change_percent = (cpa_current - cpa_baseline) / cpa_baseline
        
        if change_percent >= self.thresholds['alert']:
            return AlertLevel.ALERT
        elif change_percent >= self.thresholds['murmur']:
            return AlertLevel.MURMUR
        elif change_percent >= self.thresholds['whisper']:
            return AlertLevel.WHISPER
        
        return AlertLevel.GREEN
    
    async def _reallocate_budget_to_healthy_platforms(self, context: Dict):
        """
        Redistribue le budget vers les plateformes saines
        """
        unhealthy_platform = context.get('platform')  # ex: 'meta'
        brand_id = context.get('brand_id')
        
        # Identifier plateformes saines
        healthy_platforms = await self._get_healthy_platforms(brand_id, exclude=unhealthy_platform)
        
        if healthy_platforms:
            # Récupérer budget de la plateforme malade
            budget_to_move = await self._get_platform_budget(brand_id, unhealthy_platform)
            
            # Réallouer proportionnellement
            for platform in healthy_platforms:
                additional_budget = budget_to_move * (1 / len(healthy_platforms))
                await self._increase_platform_budget(brand_id, platform, additional_budget)
                
                print(f"[TURBULENCE] Reallocated €{additional_budget:.2f} from {unhealthy_platform} to {platform}")
        
        await self._notify_team(
            subject=f"[ALERT] Budget emergency reallocation — {unhealthy_platform} → others",
            body=f"€{budget_to_move:.2f} moved to healthy platforms: {healthy_platforms}"
        )

class CreativeFatigueDetector(TurbulenceDetector):
    """
    Détecteur 3 : Usure des créatifs publicitaires
    """
    
    def __init__(self):
        super().__init__(
            name="CREATIVE_FATIGUE",
            thresholds={
                "whisper": {"ctr_drop": -0.30, "frequency": 3.0, "days": 3},
                "murmur": {"ctr_drop": -0.40, "frequency": 4.0, "days": 5},
                "alert": {"ctr_drop": -0.50, "frequency": 5.0, "days": 7}
            },
            check_interval_seconds=3600  # 1 heure
        )
        
        self.correction_actions[AlertLevel.WHISPER] = [
            self._launch_variant_tests
        ]
        self.correction_actions[AlertLevel.MURMUR] = [
            self._request_new_creatives_from_factory,
            self._pause_fatigued_creatives
        ]
        self.correction_actions[AlertLevel.ALERT] = [
            self._full_creative_reset,
            self._escalate_to_creative_team
        ]
    
    def check(self, metrics: Dict) -> AlertLevel:
        ctr_change = metrics.get('ctr_change_percent', 0)
        frequency = metrics.get('frequency', 0)
        days_running = metrics.get('days_running', 0)
        
        # Check alert first
        if (ctr_change <= self.thresholds['alert']['ctr_drop'] and 
            frequency >= self.thresholds['alert']['frequency'] and
            days_running >= self.thresholds['alert']['days']):
            return AlertLevel.ALERT
        
        # Check murmur
        if (ctr_change <= self.thresholds['murmur']['ctr_drop'] and 
            frequency >= self.thresholds['murmur']['frequency'] and
            days_running >= self.thresholds['murmur']['days']):
            return AlertLevel.MURMUR
        
        # Check whisper
        if (ctr_change <= self.thresholds['whisper']['ctr_drop'] and 
            frequency >= self.thresholds['whisper']['frequency'] and
            days_running >= self.thresholds['whisper']['days']):
            return AlertLevel.WHISPER
        
        return AlertLevel.GREEN
    
    async def _request_new_creatives_from_factory(self, context: Dict):
        """
        Déclenche génération nouveaux créatifs par Creative Factory
        """
        brand_id = context.get('brand_id')
        product_data = context.get('product_data')
        
        # Appel direct au Creative Factory
        from creative_factory import CreativeFactoryAgent
        factory = CreativeFactoryAgent()
        
        new_creatives = await factory.generate_urgent_batch(
            product_data=product_data,
            count=10,  # 10 nouveaux créatifs d'urgence
            psychology_focus="fresh_angles",  # Nouveaux angles
            urgency="high"
        )
        
        # Auto-lancement tests A/B
        await self._auto_launch_creative_tests(brand_id, new_creatives)
        
        print(f"[TURBULENCE] Generated {len(new_creatives)} new creatives from factory")

class TurbulenceControl:
    """
    Système central de contrôle des turbulences
    """
    
    def __init__(self):
        self.detectors = {
            "CVR_DROP": CVROnlyDetector(),
            "CPA_SPIKE": CPASpikeDetector(),
            "CREATIVE_FATIGUE": CreativeFatigueDetector(),
            "AUDIENCE_SATURATION": AudienceSaturationDetector(),
            "CHARGEBACK_ALERT": ChargebackAlertDetector()
        }
        
        self.active_corrections = []
        self.alert_history = []
    
    async def continuous_monitoring(self, brand_id: str):
        """
        Boucle de surveillance continue
        """
        while True:
            # Collecte métriques temps réel
            metrics = await self._collect_realtime_metrics(brand_id)
            
            # Vérification tous détecteurs
            for detector_name, detector in self.detectors.items():
                alert_level = detector.check(metrics.get(detector_name, {}))
                
                if alert_level != AlertLevel.GREEN:
                    # Log dans Ghost Analytics
                    ghost.log_turbulence(detector_name, alert_level, metrics)
                    
                    # Application corrections
                    correction_result = await self.apply_correction(
                        detector_name, 
                        alert_level, 
                        metrics,
                        brand_id
                    )
                    
                    # Stockage historique
                    self.alert_history.append({
                        "timestamp": datetime.utcnow(),
                        "detector": detector_name,
                        "level": alert_level.value,
                        "metrics": metrics.get(detector_name),
                        "correction_applied": correction_result
                    })
                    
                    # Notification si Murmur ou Alert
                    if alert_level in [AlertLevel.MURMUR, AlertLevel.ALERT]:
                        await self._send_urgent_notification(
                            brand_id, detector_name, alert_level, correction_result
                        )
            
            # Attente prochaine vérification (intervalle le plus court des détecteurs)
            await asyncio.sleep(300)  # 5 minutes base
    
    async def apply_correction(self, detector_name: str, level: AlertLevel, 
                               metrics: Dict, brand_id: str) -> Dict:
        """
        Applique les corrections automatiques selon niveau
        """
        detector = self.detectors[detector_name]
        actions = detector.correction_actions.get(level, [])
        
        context = {
            "brand_id": brand_id,
            "detector": detector_name,
            "level": level.value,
            "metrics": metrics,
            "timestamp": datetime.utcnow()
        }
        
        results = []
        for action in actions:
            try:
                result = await action(context)
                results.append({"action": action.__name__, "status": "success", "result": result})
            except Exception as e:
                results.append({"action": action.__name__, "status": "failed", "error": str(e)})
        
        return {
            "detector": detector_name,
            "level": level.value,
            "actions_executed": len(results),
            "results": results,
            "timestamp": datetime.utcnow()
        }
    
    async def _send_urgent_notification(self, brand_id: str, detector: str, 
                                        level: AlertLevel, correction: Dict):
        """
        Notification urgente équipe + Super Admin si ALERT
        """
        recipients = ["ops_team", "media_buyers", "growth_team"]
        
        if level == AlertLevel.ALERT:
            recipients.extend([
                "jonathanlamessi@yahoo.fr",
                "Enna.lamessi@gmail.com"
            ])
        
        subject = f"[{level.value.upper()}] TURBULENCE: {detector} on brand {brand_id}"
        
        body = f"""
        TURBULENCE DETECTED
        
        Brand: {brand_id}
        Detector: {detector}
        Level: {level.value.upper()}
        Time: {datetime.utcnow().isoformat()}
        
        Metrics: {correction.get('metrics')}
        
        Auto-correction applied: {correction.get('actions_executed')} actions
        Results: {correction.get('results')}
        
        Manual review recommended.
        """
        
        await self._send_email(recipients, subject, body)
        
        # Slack/SMS si ALERT
        if level == AlertLevel.ALERT:
            await self._send_sms_to_super_admins(f"URGENT: {detector} ALERT on {brand_id}")