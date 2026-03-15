# ============================================================
# AEGIS v12.2 — CRO Engine + Multi-Connecteurs
# ============================================================

from typing import Dict, List, Optional
from pydantic import BaseModel
from enum import Enum

class PsychologyTrigger(str, Enum):
    """70+ biais psychologiques applicables au marketing"""
    LOSS_AVERSION = "loss_aversion"
    SOCIAL_PROOF = "social_proof"
    SCARCITY = "scarcity"
    AUTHORITY = "authority"
    RECIPROCITY = "reciprocity"
    COMMITMENT = "commitment"
    ANCHORING = "anchoring"
    FRAMING = "framing"
    IKEA_EFFECT = "ikea_effect"
    ENDOWMENT_EFFECT = "endowment_effect"
    ZEIGARNIK_EFFECT = "zeigarnik_effect"
    DECOY_EFFECT = "decoy_effect"
    DEFAULT_BIAS = "default_bias"
    PARADOX_OF_CHOICE = "paradox_of_choice"
    AVAILABILITY_HEURISTIC = "availability_heuristic"
    CONFIRMATION_BIAS = "confirmation_bias"
    # ... (70+ total)

class PlatformType(str, Enum):
    META = "meta"
    TIKTOK = "tiktok"
    GOOGLE = "google"
    PINTEREST = "pinterest"

class ProductSource(str, Enum):
    AMAZON = "amazon"
    ALIEXPRESS = "aliexpress"
    SHOPIFY = "shopify"
    WOOCOMMERCE = "woocommerce"
    GENERIC = "generic"  # Any website

# ============================================================
# 1. UNIVERSAL PRODUCT IMPORTER
# ============================================================

class UniversalProductImporter:
    """
    Importe produits depuis n'importe quelle source
    Amazon, AliExpress, Shopify, WooCommerce, ou site générique
    """
    
    def import_from_url(self, url: str) -> Dict:
        """
        Détecte la source et scrape les données produit
        """
        source = self._detect_source(url)
        
        importers = {
            ProductSource.AMAZON: self._import_amazon,
            ProductSource.ALIEXPRESS: self._import_aliexpress,
            ProductSource.SHOPIFY: self._import_shopify,
            ProductSource.WOOCOMMERCE: self._import_woocommerce,
            ProductSource.GENERIC: self._import_generic
        }
        
        importer = importers.get(source, self._import_generic)
        raw_data = importer(url)
        
        # Analyse CRO du produit
        cro_analysis = self._analyze_cro_potential(raw_data)
        
        return {
            "source": source,
            "raw_data": raw_data,
            "cro_analysis": cro_analysis,
            "hunter_score": self._calculate_hunter_score(raw_data),
            "recommended_psychology": cro_analysis["dominant_appeal"]
        }
    
    def _detect_source(self, url: str) -> ProductSource:
        """Détecte la plateforme depuis l'URL"""
        domain = url.lower()
        
        if "amazon" in domain:
            return ProductSource.AMAZON
        elif "aliexpress" in domain:
            return ProductSource.ALIEXPRESS
        elif "shopify" in domain or self._detect_shopify(url):
            return ProductSource.SHOPIFY
        elif "woocommerce" in domain or self._detect_woocommerce(url):
            return ProductSource.WOOCOMMERCE
        else:
            return ProductSource.GENERIC
    
    def _analyze_cro_potential(self, data: Dict) -> Dict:
        """
        Analyse le potentiel CRO basé sur la psychologie
        """
        # Analyse des avis = social proof potential
        review_count = data.get("review_count", 0)
        avg_rating = data.get("avg_rating", 0)
        
        # Analyse prix = pricing psychology potential
        price = data.get("price", 0)
        comparison_price = data.get("comparison_price", price * 1.3)
        
        # Détermine le biais dominant à exploiter
        if review_count > 1000 and avg_rating > 4.5:
            dominant_appeal = PsychologyTrigger.SOCIAL_PROOF
        elif price < 50:
            dominant_appeal = PsychologyTrigger.LOSS_AVERSION  # "Pas cher, pas de regret"
        elif "limited" in data.get("title", "").lower():
            dominant_appeal = PsychologyTrigger.SCARCITY
        else:
            dominant_appeal = PsychologyTrigger.AUTHORITY
        
        return {
            "dominant_appeal": dominant_appeal,
            "social_proof_score": min(review_count / 100, 10),  # 0-10
            "price_appeal_score": self._calculate_price_appeal(price),
            "urgency_potential": self._detect_urgency_signals(data),
            "recommended_hooks": self._generate_psychology_hooks(dominant_appeal, data)
        }
    
    def _generate_psychology_hooks(self, bias: PsychologyTrigger, data: Dict) -> List[str]:
        """
        Génère les accroches marketing basées sur le biais psychologique
        """
        hooks = {
            PsychologyTrigger.LOSS_AVERSION: [
                "Ne manquez pas cette opportunité unique",
                "Les stocks s'épuisent rapidement",
                "Prix augmentera bientôt",
                "Derniers exemplaires disponibles"
            ],
            PsychologyTrigger.SOCIAL_PROOF: [
                f"Déjà {data.get('review_count', 'des milliers')} clients satisfaits",
                "Le produit #1 dans sa catégorie",
                "Recommandé par les experts",
                "Best-seller depuis 6 mois"
            ],
            PsychologyTrigger.SCARCITY: [
                "Édition limitée - Plus que {stock} unités",
                "Offre exclusive aux membres",
                "Stock réservé 10 minutes",
                "Disponibilité limitée par client"
            ],
            PsychologyTrigger.AUTHORITY: [
                "Conçu avec des experts de l'industrie",
                "Certifié par les professionnels",
                "Recommandé par {influencer}",
                "Garantie satisfait ou remboursé 30 jours"
            ]
        }
        return hooks.get(bias, [])

# ============================================================
# 2. AD PLATFORM CONNECTORS
# ============================================================

class MetaAdsConnector:
    """Connecteur Meta (Facebook/Instagram) avec CRO optimization"""
    
    def __init__(self, access_token: str, ad_account_id: str):
        self.access_token = access_token
        self.ad_account_id = ad_account_id
        self.api_version = "v18.0"
    
    def create_cro_optimized_campaign(self, 
                                     campaign_config: Dict,
                                     psychology_strategy: Dict) -> str:
        """
        Crée une campagne Meta optimisée par psychologie
        """
        from facebook_business.api import FacebookAdsApi
        from facebook_business.adobjects.campaign import Campaign
        from facebook_business.adobjects.adset import AdSet
        from facebook_business.adobjects.ad import Ad
        
        # 1. Création campagne avec objectif conversion
        campaign = Campaign(parent_id=self.ad_account_id)
        campaign.update({
            Campaign.Field.name: f"[CRO] {campaign_config['name']} - {psychology_strategy['primary_trigger']}",
            Campaign.Field.objective: Campaign.Objective.conversions,
            Campaign.Field.status: Campaign.Status.paused,
            Campaign.Field.special_ad_categories: [],
            # CRO: Budget optimisé pour learning phase rapide
            Campaign.Field.daily_budget: campaign_config['budget_daily'] * 100,  # cents
        })
        campaign.remote_create()
        
        # 2. AdSet avec ciblage psychologique
        adset = AdSet(parent_id=self.ad_account_id)
        adset.update({
            AdSet.Field.name: f"AdSet - {psychology_strategy['targeting_persona']}",
            AdSet.Field.campaign_id: campaign[Campaign.Field.id],
            AdSet.Field.daily_budget: campaign_config['budget_daily'] * 100,
            AdSet.Field.billing_event: AdSet.BillingEvent.impressions,
            AdSet.Field.optimization_goal: AdSet.OptimizationGoal.offsite_conversions,
            AdSet.Field.promoted_object: {
                "pixel_id": campaign_config['pixel_id'],
                "custom_event_type": "PURCHASE"
            },
            # CRO: Ciblage comportemental basé sur psychologie
            AdSet.Field.targeting: self._build_psychological_targeting(psychology_strategy),
            # CRO: Placement optimisé conversion
            AdSet.Field.placement: {
                "facebook": ["feed", "marketplace", "video_feeds"],
                "instagram": ["stream", "shop"],
                "audience_network": [],
                "messenger": []
            }
        })
        adset.remote_create()
        
        # 3. Créatifs A/B testés psychologiquement
        for variant in psychology_strategy['creative_variants']:
            ad = self._create_psychology_ad(
                adset_id=adset[AdSet.Field.id],
                variant=variant,
                psychology_trigger=variant['psychology']
            )
        
        return campaign[Campaign.Field.id]
    
    def _build_psychological_targeting(self, strategy: Dict) -> Dict:
        """
        Construit un ciblage basé sur le profil psychologique
        """
        trigger = strategy['primary_trigger']
        
        targeting_configs = {
            PsychologyTrigger.LOSS_AVERSION: {
                # Cibler: acheteurs impulsifs, sensibles aux offres
                "behaviors": ["engaged_shoppers", "deal_seekers"],
                "interests": ["discounts", "coupons", "sales"],
                "income": "all"  # Peu importe, tant que c'est "pas cher"
            },
            PsychologyTrigger.SOCIAL_PROOF: {
                # Cibler: influenceables, communautaires
                "behaviors": ["social_engagers", "brand_loyalists"],
                "interests": ["trending", "popular products", "reviews"],
                "connections": "expand"  # Lookalikes des acheteurs
            },
            PsychologyTrigger.SCARCITY: {
                # Cibler: collectionneurs, exclusivité
                "behaviors": ["luxury_buyers", "collectors"],
                "interests": ["limited editions", "exclusive", "VIP"],
                "income": "top_25%"
            },
            PsychologyTrigger.AUTHORITY: {
                # Cibler: professionnels, décideurs
                "behaviors": ["business_decision_makers", "professionals"],
                "interests": ["industry experts", "certified products", "quality"],
                "education": "college_graduates"
            }
        }
        
        return targeting_configs.get(trigger, targeting_configs[PsychologyTrigger.SOCIAL_PROOF])

class TikTokAdsConnector:
    """Connecteur TikTok — Viralité + Désir mimétique"""
    
    def create_viral_campaign(self, 
                             product_data: Dict,
                             psychology_hooks: List[str]) -> str:
        """
        Crée campagne TikTok optimisée viralité
        """
        # TikTok = Désir mimétique + Effet de chute + Authenticité
        hooks = {
            "hook_types": ["problem_agitation", "transformation", "social_proof", "curiosity_gap"],
            "duration": "15-30s",  # Optimal pour completion rate
            "format": "native_ugc",  # Pas de pub "corporate"
            "sound": "trending_audio",  # Viralité algorithmique
            "cta_placement": "end_frame_with_delay"  # Zeigarnik: suspense avant CTA
        }
        
        # Créatifs générés par GEN-VIDEO-CRO
        creatives = self._generate_tiktok_creatives(product_data, hooks)
        
        # Lancement avec Spark Ads (organic-looking)
        campaign_id = self._launch_spark_ads_campaign(creatives, hooks)
        
        return campaign_id

class GoogleAdsConnector:
    """Connecteur Google — Intent-based + Ancrage"""
    
    def create_search_campaign(self, 
                              keywords: List[str],
                              psychology_strategy: Dict) -> str:
        """
        Crée campagne Search avec ancrage prix
        """
        # Google Search = Intent élevé, optimisation ancrage
        strategy = {
            "ad_format": "responsive_search_ad",
            "headlines": [
                f"À partir de {psychology_strategy['anchored_price']}€",  # Ancrage bas
                f"Valeur réelle: {psychology_strategy['comparison_price']}€",  # Ancrage haut
                psychology_strategy['primary_hook']
            ],
            "descriptions": [
                f"Économisez {psychology_strategy['savings_amount']}€ aujourd'hui",  # Gain
                f"Ne payez pas {psychology_strategy['comparison_price']}€",  # Perte
                "Livraison gratuite 24-48h"  # Réciprocité
            ],
            "extensions": {
                "sitelinks": ["Avis clients", "Garantie", "Nos engagements"],
                "callouts": ["Prix bas garanti", "Satisfait ou remboursé", "Stock limité"],
                "structured_snippets": ["Marques: AEGIS Certified", "Types: Premium, Standard"]
            }
        }
        
        return self._launch_search_campaign(keywords, strategy)

# ============================================================
# 3. CRO ENGINE — Optimisation Continue
# ============================================================

class CROEngine:
    """
    Moteur d'optimisation conversion basé sur la psychologie
    """
    
    def __init__(self, brand_id: str):
        self.brand_id = brand_id
        self.psychology_matrix = self._load_psychology_models()
    
    def optimize_landing_page(self, page_id: str) -> Dict:
        """
        Optimise une landing page avec tests A/B psychologiques
        """
        page = self._get_landing_page(page_id)
        
        # Analyse page actuelle
        current_performance = self._analyze_performance(page_id)
        
        # Identification biais sous-exploités
        underutilized_biases = self._identify_opportunities(page, current_performance)
        
        # Génération variants testables
        experiments = []
        for bias in underutilized_biases[:3]:  # Top 3 opportunités
            variant = self._generate_psychology_variant(page, bias)
            experiment = self._setup_ab_test(page, variant, bias)
            experiments.append(experiment)
        
        return {
            "current_conversion_rate": current_performance['conversion_rate'],
            "experiments_launched": len(experiments),
            "expected_uplift": self._calculate_expected_uplift(experiments),
            "experiments": experiments
        }
    
    def _identify_opportunities(self, page: Dict, performance: Dict) -> List[PsychologyTrigger]:
        """
        Identifie quels biais psychologiques manquent sur la page
        """
        missing = []
        
        # Vérifie présence éléments CRO
        if not page.get('social_proof_section'):
            missing.append(PsychologyTrigger.SOCIAL_PROOF)
        
        if not page.get('urgency_elements'):
            missing.append(PsychologyTrigger.SCARCITY)
        
        if not page.get('guarantee_badges'):
            missing.append(PsychologyTrigger.AUTHORITY)
        
        if performance['cart_abandonment'] > 70:
            missing.append(PsychologyTrigger.ZEIGARNIK_EFFECT)  # Récupération paniers
        
        if performance['time_on_page'] < 30:
            missing.append(PsychologyTrigger.CURIOSITY_GAP)  # Hook amélioré
        
        return missing
    
    def personalize_for_visitor(self, 
                                 visitor_id: str, 
                                 base_page: Dict) -> Dict:
        """
        Personnalise la page selon le profil psychologique du visiteur
        """
        profile = self._get_visitor_psychology_profile(visitor_id)
        
        # Adapte la page au profil
        personalized = base_page.copy()
        
        if profile['dominant_bias'] == PsychologyTrigger.LOSS_AVERSION:
            # Mettre en avant "Ce que vous perdez" plutôt que "Ce que vous gagnez"
            personalized['headline'] = base_page['headline_loss_version']
            personalized['cta_text'] = "Ne manquez pas cette offre"
            personalized['urgency_badge'] = True
        
        elif profile['dominant_bias'] == PsychologyTrigger.SOCIAL_PROOF:
            # Mettre en avant témoignages, nombre de clients
            personalized['hero_section'] = base_page['social_proof_hero']
            personalized['testimonials_position'] = "above_fold"
            personalized['live_counter'] = True  # "127 personnes regardent ce produit"
        
        elif profile['dominant_bias'] == PsychologyTrigger.AUTHORITY:
            # Mettre en avant certifications, experts
            personalized['trust_badges'] = "prominent"
            personalized['expert_endorsement'] = base_page['expert_video']
            personalized['guarantee_highlight'] = "30-day money back"
        
        return personalized