# ============================================================
# AEGIS x Agents Logistiques Fournisseurs
# ============================================================

import pandas as pd
import ftplib
import smtplib
from email.mime.multipart import MIMEMultipart
from email.mime.base import MIMEBase
from email import encoders
from datetime import datetime
from typing import List, Dict, Optional
from pydantic import BaseModel

class LogisticsAgent(BaseModel):
    """Un de tes agents logistiques fournisseurs"""
    id: str
    agent_code: str  # 'AGT-001'
    agent_name: str  # 'LogiPro Sud'
    integration_type: str  # 'api', 'ftp', 'email', 'manual'
    
    # API (si applicable)
    api_endpoint: Optional[str]
    api_key: Optional[str]
    
    # FTP (si applicable)
    ftp_host: Optional[str]
    ftp_user: Optional[str]
    ftp_pass: Optional[str]
    ftp_path: str = "/incoming/"
    
    # Email (si applicable)
    email_to: Optional[str]  # commandes@logipro.fr
    email_cc: Optional[str]
    
    # Capacités
    primary_category: str  # 'electronics'
    avg_preparation_hours: int = 24

class BrandLogisticsSetup(BaseModel):
    """Config d'une marche avec un agent"""
    brand_id: str
    logistics_agent_id: str
    negotiated_cost_percent: float  # 35% = 0.35
    product_mapping: Dict[str, str]  # {aegis_sku: agent_sku}
    is_primary: bool = False

class LogisticsOrderItem(BaseModel):
    """Item à commander chez l'agent"""
    aegis_sku: str
    agent_sku: str
    quantity: int
    unit_price: float  # Prix négocié

class LogisticsOrder(BaseModel):
    """Commande à envoyer à l'agent logistique"""
    order_id: str
    brand_id: str
    customer_email: str
    shipping_address: Dict
    items: List[LogisticsOrderItem]
    packaging_type: str = "standard"  # 'standard', 'branded'

class LogisticsAgentClient:
    """
    Client pour communiquer avec tes agents logistiques
    Adapte selon le type d'intégration de chaque agent
    """
    
    def __init__(self, agent: LogisticsAgent):
        self.agent = agent
    
    # ============================================================
    # MÉTHODE 1 : API REST (si l'agent a une API moderne)
    # ============================================================
    
    def send_order_api(self, order: LogisticsOrder) -> Dict:
        """
        Envoie commande via API REST (agent tech-savvy)
        """
        import requests
        
        endpoint = f"{self.agent.api_endpoint}/orders"
        
        payload = {
            "external_reference": order.order_id,
            "customer_email": order.customer_email,
            "shipping_address": order.shipping_address,
            "items": [
                {
                    "sku": item.agent_sku,
                    "quantity": item.quantity,
                    "unit_price": item.unit_price
                }
                for item in order.items
            ],
            "packaging_instructions": self._get_packaging_instructions(order.packaging_type),
            "webhook_url": f"https://aegis.io/webhooks/logistics/{self.agent.agent_code}"
        }
        
        headers = {
            "Authorization": f"Bearer {self.agent.api_key}",
            "Content-Type": "application/json"
        }
        
        response = requests.post(endpoint, json=payload, headers=headers)
        response.raise_for_status()
        
        return {
            "agent_order_id": response.json().get("order_id"),
            "status": "acknowledged",
            "estimated_ship_date": response.json().get("estimated_ship_date")
        }
    
    def get_stock_api(self, skus: List[str]) -> Dict[str, int]:
        """
        Récupère stock temps réel via API
        """
        import requests
        
        endpoint = f"{self.agent.api_endpoint}/inventory"
        
        response = requests.get(
            endpoint,
            headers={"Authorization": f"Bearer {self.agent.api_key}"},
            params={"skus": ",".join(skus)}
        )
        response.raise_for_status()
        
        data = response.json()
        return {item["sku"]: item["quantity_available"] for item in data["items"]}
    
    # ============================================================
    # MÉTHODE 2 : FTP + CSV (agent classique, très courant)
    # ============================================================
    
    def send_order_ftp_csv(self, order: LogisticsOrder) -> str:
        """
        Génère CSV commande et upload sur FTP agent
        Format standard : commande_id, sku, qty, adresse...
        """
        # Création DataFrame
        df = pd.DataFrame([
            {
                "commande_id": order.order_id,
                "date": datetime.now().strftime("%Y-%m-%d %H:%M"),
                "sku": item.agent_sku,
                "quantite": item.quantity,
                "prix_unitaire": item.unit_price,
                "client_email": order.customer_email,
                "adresse_livraison": self._format_address(order.shipping_address),
                "instructions_emballage": order.packaging_type,
                "reference_externe": f"AEGIS-{order.order_id}"
            }
            for item in order.items
        ])
        
        # Génération fichier
        filename = f"commande_{order.order_id}_{datetime.now().strftime('%Y%m%d_%H%M%S')}.csv"
        local_path = f"/tmp/{filename}"
        df.to_csv(local_path, index=False, encoding='utf-8', sep=';')
        
        # Upload FTP
        with ftplib.FTP(self.agent.ftp_host) as ftp:
            ftp.login(self.agent.ftp_user, self.agent.ftp_pass)
            ftp.cwd(self.agent.ftp_path)
            
            with open(local_path, 'rb') as f:
                ftp.storbinary(f'STOR {filename}', f)
        
        return f"ftp://{self.agent.ftp_host}{self.agent.ftp_path}{filename}"
    
    def read_stock_ftp_csv(self) -> pd.DataFrame:
        """
        Lit fichier stock envoyé par agent sur FTP
        (l'agent upload régulièrement son stock)
        """
        # Liste fichiers stock
        stock_files = []
        
        with ftplib.FTP(self.agent.ftp_host) as ftp:
            ftp.login(self.agent.ftp_user, self.agent.ftp_pass)
            ftp.cwd("/outgoing/")  # Dossier où agent dépose fichiers
            
            files = ftp.nlst()
            stock_files = [f for f in files if f.startswith("stock_")]
        
        if not stock_files:
            return pd.DataFrame()
        
        # Dernier fichier stock
        latest_file = sorted(stock_files)[-1]
        
        # Téléchargement
        local_path = f"/tmp/{latest_file}"
        with ftplib.FTP(self.agent.ftp_host) as ftp:
            ftp.login(self.agent.ftp_user, self.agent.ftp_pass)
            ftp.cwd("/outgoing/")
            
            with open(local_path, 'wb') as f:
                ftp.retrbinary(f'RETR {latest_file}', f.write)
        
        # Lecture
        df = pd.read_csv(local_path, sep=';', encoding='utf-8')
        return df  # Columns: sku, quantity_available, quantity_reserved, price
    
    # ============================================================
    # MÉTHODE 3 : EMAIL + CSV (agent basique)
    # ============================================================
    
    def send_order_email(self, order: LogisticsOrder) -> bool:
        """
        Envoie commande par email avec CSV en pièce jointe
        (pour agents sans API ni FTP)
        """
        # Génération CSV
        df = pd.DataFrame([
            {
                "commande_id": order.order_id,
                "sku": item.agent_sku,
                "quantite": item.quantity,
                "client": order.customer_email,
                "adresse": self._format_address(order.shipping_address)
            }
            for item in order.items
        ])
        
        filename = f"commande_{order.order_id}.csv"
        csv_path = f"/tmp/{filename}"
        df.to_csv(csv_path, index=False, encoding='utf-8', sep=';')
        
        # Création email
        msg = MIMEMultipart()
        msg['From'] = 'commandes@aegis-brands.com'
        msg['To'] = self.agent.email_to
        msg['Cc'] = self.agent.email_cc or ''
        msg['Subject'] = f'[AEGIS] Nouvelle commande {order.order_id}'
        
        body = f"""
        Bonjour,
        
        Veuillez trouver ci-joint la commande {order.order_id}.
        
        Merci de confirmer réception et d'indiquer la date d'expédition estimée.
        
        Cordialement,
        Système AEGIS
        """
        
        msg.attach(MIMEText(body, 'plain'))
        
        # Pièce jointe
        with open(csv_path, 'rb') as f:
            part = MIMEBase('application', 'octet-stream')
            part.set_payload(f.read())
            encoders.encode_base64(part)
            part.add_header(
                'Content-Disposition',
                f'attachment; filename= {filename}'
            )
            msg.attach(part)
        
        # Envoi
        with smtplib.SMTP('smtp.aegis-brands.com', 587) as server:
            server.starttls()
            server.login('commandes@aegis-brands.com', 'password')
            server.send_message(msg)
        
        return True
    
    # ============================================================
    # GESTION DES RÉPONSES AGENTS
    # ============================================================
    
    def process_agent_response(self, response_type: str, data: Dict, db: Session) -> bool:
        """
        Traite réponse de l'agent (webhook, email parsé, ou FTP)
        """
        handlers = {
            "order_ack": self._handle_order_acknowledged,
            "tracking": self._handle_tracking_received,
            "stock_update": self._handle_stock_update,
            "exception": self._handle_exception
        }
        
        handler = handlers.get(response_type)
        if handler:
            return handler(data, db)
        return False
    
    def _handle_tracking_received(self, data: Dict, db: Session) -> bool:
        """
        Agent envoie numéro de tracking
        """
        order = db.query(LogisticsOrder).filter_by(
            agent_order_reference=data["agent_order_id"]
        ).first()
        
        if order:
            order.tracking_number = data["tracking_number"]
            order.carrier_name = data["carrier"]
            order.tracking_url = self._generate_tracking_url(
                data["carrier"], 
                data["tracking_number"]
            )
            order.shipped_at = datetime.now()
            order.status = "shipped"
            
            db.commit()
            
            # Email client avec tracking
            self._notify_customer_tracking(order)
            
            return True
        
        return False
    
    def _handle_stock_update(self, data: Dict, db: Session) -> bool:
        """
        Mise à jour stock depuis agent
        """
        for item in data["inventory"]:
            inventory = db.query(LogisticsInventorySync).filter_by(
                logistics_agent_id=self.agent.id,
                agent_sku=item["sku"]
            ).first()
            
            if inventory:
                inventory.quantity_available = item["quantity"]
                inventory.last_agent_stock_update = datetime.now()
                inventory.last_sync_at = datetime.now()
                inventory.sync_status = "synced"
        
        db.commit()
        return True
    
    # ============================================================
    # HELPERS
    # ============================================================
    
    def _format_address(self, address: Dict) -> str:
        """Formate adresse pour agent"""
        return f"{address['name']}, {address['street']}, {address['zip']} {address['city']}, {address['country']}"
    
    def _get_packaging_instructions(self, packaging_type: str) -> str:
        """Instructions emballage pour agent"""
        instructions = {
            "standard": "Emballage standard",
            "branded": "Utiliser packaging AEGIS fourni + insert marketing",
            "premium": "Packaging premium + ruban + carte remerciement"
        }
        return instructions.get(packaging_type, "Standard")
    
    def _generate_tracking_url(self, carrier: str, tracking: str) -> str:
        """Génère URL tracking selon transporteur"""
        urls = {
            "colissimo": f"https://www.laposte.fr/outils/suivre-vos-envois?code={tracking}",
            "dhl": f"https://www.dhl.com/fr-fr/home/tracking/tracking-express.html?submit=1&tracking-id={tracking}",
            "ups": f"https://www.ups.com/track?tracknum={tracking}",
            "chronopost": f"https://www.chronopost.fr/tracking-no-cms/suivi-page?listeNumeros={tracking}"
        }
        return urls.get(carrier.lower(), "#")