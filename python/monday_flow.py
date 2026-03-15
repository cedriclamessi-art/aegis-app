# ============================================================
# MONDAY FLOW — Orchestrateur du Pipeline Hebdomadaire
# 154 agents, 8h30 de traitement, 100% automatisé
# ============================================================

from datetime import datetime, timedelta
from typing import List, Dict, Optional
from enum import Enum
import asyncio
from dataclasses import dataclass

class PipelinePhase(Enum):
    DISCOVERY = "discovery"
    CREATION = "creation"
    BUILD = "build"
    LOGISTICS = "logistics"
    LAUNCH = "launch"

@dataclass
class AgentTask:
    agent_code: str
    task_name: str
    estimated_duration_minutes: int
    dependencies: List[str]  # Doit attendre ces agents
    outputs: List[str]  # Ce qu'il produit
    retry_on_failure: bool = True
    max_retries: int = 3

class MondayFlowOrchestrator:
    """
    Orchestrateur du Monday Flow — Gère les 154 agents sur 5 phases
    """
    
    def __init__(self):
        self.ceo_agent = CEOAgent()
        self.orchestrator = BaseOrchestrator()
        self.turbulence = TurbulenceControl()
        self.ghost = GhostAnalytics()
        
        # Définition des 154 tâches du pipeline
        self.pipeline_tasks = self._define_pipeline()
        
    def _define_pipeline(self) -> Dict[PipelinePhase, List[AgentTask]]:
        """
        Définit l'ordonnancement complet des 154 agents
        """
        return {
            PipelinePhase.DISCOVERY: [
                AgentTask("CEO-1", "strategic_brief", 5, [], ["objectives", "budget", "focus"]),
                AgentTask("HUNTER-1", "scrape_amazon", 25, [], ["amazon_products"]),
                AgentTask("HUNTER-2", "scrape_aliexpress", 25, [], ["aliexpress_products"]),
                AgentTask("HUNTER-3", "scrape_tiktok", 25, [], ["tiktok_trending"]),
                AgentTask("HUNTER-4", "scrape_generic_sites", 25, [], ["niche_products"]),
                AgentTask("HUNTER-5", "virality_analysis", 15, ["HUNTER-1", "HUNTER-2", "HUNTER-3", "HUNTER-4"], ["viral_candidates"]),
                AgentTask("INTEL-1", "competitor_pricing", 15, [], ["pricing_intel"]),
                AgentTask("INTEL-2", "competitor_ads", 15, [], ["ads_intel"]),
                AgentTask("INTEL-3", "market_gaps", 15, ["INTEL-1", "INTEL-2"], ["opportunities"]),
                AgentTask("PSYCHE-1", "audience_profiling", 30, ["HUNTER-5"], ["psychology_profiles"]),
                AgentTask("PSYCHE-2", "pain_points_analysis", 30, ["PSYCHE-1"], ["pain_points"]),
                AgentTask("PSYCHE-3", "trigger_identification", 30, ["PSYCHE-2"], ["psychology_triggers"]),
                AgentTask("DATA-1", "margin_calculation", 15, ["HUNTER-5"], ["margin_data"]),
                AgentTask("DATA-2", "shipping_analysis", 15, ["DATA-1"], ["logistics_data"]),
                AgentTask("DATA-3", "legal_compliance_check", 15, ["DATA-2"], ["compliance_status"]),
                AgentTask("PRODUCT-1", "product_scoring", 15, ["DATA-3", "PSYCHE-3"], ["hunter_scores"]),
                AgentTask("PRODUCT-2", "cro_potential", 15, ["PRODUCT-1"], ["cro_scores"]),
                AgentTask("PRODUCT-3", "final_validation", 15, ["PRODUCT-2"], ["validated_products"]),
                AgentTask("WINNER-1", "winner_selection", 15, ["PRODUCT-3"], ["top_3_products"]),
            ],
            
            PipelinePhase.CREATION: [
                AgentTask("OFFER-1", "offer_construction", 15, ["WINNER-1"], ["offer_structure"]),
                AgentTask("OFFER-2", "guarantee_pricing", 15, ["OFFER-1"], ["final_offer"]),
                AgentTask("GEN-PRICE-1", "pricing_strategy", 15, ["OFFER-2"], ["price_anchoring", "charm_prices"]),
                AgentTask("GEN-BRAND-1", "brand_naming", 15, ["GEN-PRICE-1"], ["brand_name", "slogan", "story"]),
                AgentTask("GEN-VISUAL-1", "logo_generation", 15, ["GEN-BRAND-1"], ["logo_concepts"]),
                AgentTask("GEN-VISUAL-2", "color_palette", 10, ["GEN-VISUAL-1"], ["color_scheme"]),
                AgentTask("GEN-VISUAL-3", "typography", 10, ["GEN-VISUAL-2"], ["font_pairing"]),
                AgentTask("GEN-VISUAL-4", "brand_guidelines", 10, ["GEN-VISUAL-3"], ["brand_book"]),
                AgentTask("COPY-CHIEF-1", "product_copy", 30, ["GEN-BRAND-1"], ["product_description"]),
                AgentTask("COPY-CHIEF-2", "landing_copy", 30, ["COPY-CHIEF-1"], ["landing_page_text"]),
                AgentTask("COPY-CHIEF-3", "email_sequences", 30, ["COPY-CHIEF-2"], ["email_flows"]),
                AgentTask("GEN-COPY-CRO-1", "psychological_variants_a", 15, ["COPY-CHIEF-3"], ["copy_variant_a"]),
                AgentTask("GEN-COPY-CRO-2", "psychological_variants_b", 15, ["COPY-CHIEF-3"], ["copy_variant_b"]),
                AgentTask("GEN-VIDEO-1", "ugc_video_1", 15, ["GEN-COPY-CRO-2"], ["video_1"]),
                AgentTask("GEN-VIDEO-2", "ugc_video_2", 15, ["GEN-VIDEO-1"], ["video_2"]),
                AgentTask("GEN-VIDEO-3", "ugc_video_3", 15, ["GEN-VIDEO-2"], ["video_3"]),
                AgentTask("GEN-PROOF-1", "social_proof_generation", 15, ["GEN-VIDEO-3"], ["testimonials", "reviews"]),
                AgentTask("CREATIVE-1", "angle_1_visuals", 15, ["GEN-PROOF-1"], ["creatives_angle_1"]),
                AgentTask("CREATIVE-2", "angle_2_visuals", 15, ["CREATIVE-1"], ["creatives_angle_2"]),
                AgentTask("CREATIVE-3", "angle_3_visuals", 15, ["CREATIVE-2"], ["creatives_angle_3"]),
                AgentTask("CREATIVE-4", "angle_4_visuals", 15, ["CREATIVE-3"], ["creatives_angle_4"]),
                AgentTask("CREATIVE-5", "angle_5_visuals", 15, ["CREATIVE-4"], ["creatives_angle_5"]),
            ],
            
            PipelinePhase.BUILD: [
                AgentTask("ARCHITECT-1", "shopify_structure", 15, ["CREATIVE-5"], ["site_structure"]),
                AgentTask("ARCHITECT-2", "landing_page_build", 15, ["ARCHITECT-1"], ["landing_page"]),
                AgentTask("NAV-1", "ux_optimization", 15, ["ARCHITECT-2"], ["ux_flow"]),
                AgentTask("NAV-2", "funnel_friction_reduction", 15, ["NAV-1"], ["optimized_funnel"]),
                AgentTask("TECH-1", "performance_optimization", 15, ["NAV-2"], ["core_web_vitals"]),
                AgentTask("TECH-2", "mobile_optimization", 15, ["TECH-1"], ["mobile_ready"]),
                AgentTask("SOCIAL-PROOF-1", "testimonials_integration", 15, ["TECH-2"], ["social_proof_live"]),
                AgentTask("TRUST-SEALS-1", "trust_badges", 15, ["SOCIAL-PROOF-1"], ["trust_elements"]),
                AgentTask("COMPLIANCE-1", "legal_verification", 15, ["TRUST-SEALS-1"], ["compliance_check"]),
            ],
            
            PipelinePhase.LOGISTICS: [
                AgentTask("OPS-1", "logistics_config", 10, ["COMPLIANCE-1"], ["logistics_setup"]),
                AgentTask("OPS-2", "sku_mapping", 10, ["OPS-1"], ["sku_mapped"]),
                AgentTask("OPS-3", "api_connection_test", 10, ["OPS-2"], ["connection_verified"]),
                AgentTask("OPS-4", "webhook_setup", 10, ["OPS-3"], ["webhooks_active"]),
                AgentTask("OPS-5", "stock_sync", 10, ["OPS-4"], ["stock_synced"]),
                AgentTask("OPS-6", "fulfillment_test", 10, ["OPS-5"], ["fulfillment_ready"]),
            ],
            
            PipelinePhase.LAUNCH: [
                AgentTask("PULSE-META-1", "meta_campaign_setup", 15, ["OPS-6"], ["meta_campaigns"]),
                AgentTask("PULSE-META-2", "meta_audience_targeting", 15, ["PULSE-META-1"], ["meta_audiences"]),
                AgentTask("PULSE-TIKTOK-1", "tiktok_campaign_setup", 15, ["PULSE-META-2"], ["tiktok_campaigns"]),
                AgentTask("PULSE-TIKTOK-2", "tiktok_spark_ads", 15, ["PULSE-TIKTOK-1"], ["spark_ads"]),
                AgentTask("PULSE-GOOGLE-1", "google_campaign_setup", 15, ["PULSE-TIKTOK-2"], ["google_campaigns"]),
                AgentTask("PULSE-PIN-1", "pinterest_campaign_setup", 15, ["PULSE-GOOGLE-1"], ["pinterest_campaigns"]),
                AgentTask("PULSE-CRO-1", "ab_test_setup", 15, ["PULSE-PIN-1"], ["ab_tests"]),
                AgentTask("PULSE-CRO-2", "tracking_verification", 15, ["PULSE-CRO-1"], ["tracking_confirmed"]),
                AgentTask("ADS-BUDGET-1", "budget_allocation", 10, ["PULSE-CRO-2"], ["budget_plan"]),
                AgentTask("CEO-1", "final_validation", 10, ["ADS-BUDGET-1"], ["go_no_go"]),
            ]
        }
    
    async def execute_monday_flow(self, brand_context: Dict) -> Dict:
        """
        Exécute le Monday Flow complet — 154 agents, 8h30
        """
        start_time = datetime.utcnow()
        execution_log = []
        
        # Initialisation Ghost Analytics (surveillance invisible)
        self.ghost.start_observation_session("monday_flow", brand_context['brand_id'])
        
        for phase in PipelinePhase:
            self.ghost.log_phase_start(phase.value, datetime.utcnow())
            
            phase_tasks = self.pipeline_tasks[phase]
            phase_results = await self._execute_phase(phase, phase_tasks, brand_context)
            
            execution_log.append({
                "phase": phase.value,
                "start_time": phase_results['start'],
                "end_time": phase_results['end'],
                "tasks_completed": phase_results['completed'],
                "tasks_failed": phase_results['failed'],
                "outputs": phase_results['outputs']
            })
            
            self.ghost.log_phase_end(phase.value, datetime.utcnow(), phase_results['status'])
            
            # Vérification Turbulence après chaque phase
            turbulence_check = self.turbulence.check_phase_health(phase, phase_results)
            if turbulence_check['alert_level'] != 'green':
                correction = self.turbulence.apply_correction(turbulence_check)
                execution_log[-1]['turbulence_correction'] = correction
        
        total_duration = (datetime.utcnow() - start_time).total_seconds() / 60
        
        return {
            "status": "completed",
            "total_duration_minutes": total_duration,
            "phases_executed": len(execution_log),
            "execution_log": execution_log,
            "final_outputs": self._collect_final_outputs(execution_log),
            "ghost_report": self.ghost.generate_session_report()
        }
    
    async def _execute_phase(self, phase: PipelinePhase, tasks: List[AgentTask], context: Dict) -> Dict:
        """
        Exécute une phase avec gestion des dépendances et parallélisation
        """
        phase_start = datetime.utcnow()
        completed_tasks = []
        failed_tasks = []
        outputs = {}
        
        # Graphe de dépendances
        task_graph = self._build_dependency_graph(tasks)
        
        while task_graph.has_ready_tasks():
            ready_tasks = task_graph.get_ready_tasks()
            
            # Exécution parallèle des tâches prêtes
            results = await asyncio.gather(*[
                self._execute_agent_task(task, context, outputs)
                for task in ready_tasks
            ])
            
            for task, result in zip(ready_tasks, results):
                if result['status'] == 'success':
                    completed_tasks.append(task.agent_code)
                    outputs.update(result['outputs'])
                    task_graph.mark_completed(task.agent_code)
                else:
                    failed_tasks.append({
                        "agent": task.agent_code,
                        "error": result['error'],
                        "retry_count": result.get('retry_count', 0)
                    })
                    
                    if task.retry_on_failure and result.get('retry_count', 0) < task.max_retries:
                        # Retry avec backoff
                        await asyncio.sleep(2 ** result.get('retry_count', 0))
                        task_graph.mark_ready_for_retry(task.agent_code)
                    else:
                        task_graph.mark_failed(task.agent_code)
                        
                        # Alert CEO si critique
                        if self._is_critical_task(task):
                            self.ceo_agent.report_critical_failure(task, result['error'])
        
        return {
            "start": phase_start,
            "end": datetime.utcnow(),
            "completed": len(completed_tasks),
            "failed": len(failed_tasks),
            "outputs": outputs,
            "status": "completed" if len(failed_tasks) == 0 else "degraded"
        }
    
    async def _execute_agent_task(self, task: AgentTask, context: Dict, available_outputs: Dict) -> Dict:
        """
        Exécute une tâche d'agent individuelle
        """
        try:
            # Récupération agent
            agent = self.orchestrator.get_agent(task.agent_code)
            
            # Préparation inputs
            task_inputs = self._prepare_inputs(task, available_outputs)
            
            # Exécution avec timeout
            result = await asyncio.wait_for(
                agent.execute(task.task_name, task_inputs, context),
                timeout=task.estimated_duration_minutes * 60 * 1.5  # 50% marge
            )
            
            # Log Ghost
            self.ghost.log_agent_execution(task.agent_code, task.task_name, "success", result)
            
            return {
                "status": "success",
                "outputs": {output: result.get(output) for output in task.outputs},
                "execution_time": result.get('execution_time_seconds')
            }
            
        except Exception as e:
            self.ghost.log_agent_execution(task.agent_code, task.task_name, "failed", {"error": str(e)})
            return {
                "status": "failed",
                "error": str(e),
                "retry_count": context.get('retry_count', 0)
            }
    
    def _is_critical_task(self, task: AgentTask) -> bool:
        """
        Détermine si une tâche est critique pour le pipeline
        """
        critical_agents = ["CEO-1", "WINNER-1", "COMPLIANCE-1", "CEO-1-FINAL"]
        return task.agent_code in critical_agents