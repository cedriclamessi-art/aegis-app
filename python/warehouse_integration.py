# ============================================================
# AEGIS x WAREHOUSE — Client API WMS (Ton Entrepôt)
# Remplacement : NEXUS → WAREHOUSE
# ============================================================

import requests
import hmac
import hashlib
import json
from datetime import datetime
from typing import Optional, Dict, List
from pydantic import BaseModel

class WarehouseConfig(BaseModel):
    """Configuration de ton entrepôt pour une marque"""
    wms_api_key: str
    wms_endpoint_url: str
    webhook_secret: str
    warehouse_id: str  # 'WH-PARIS', 'WH-MARSEILLE'
    default_carrier: str = 'colissimo'
    packaging_type: str = 'branded'

class WarehouseOrderItem(BaseModel):
    """Item à expédier"""
    warehouse_sku: str
    quantity: int
    location_code: Optional[str] = None  # 'A-12-3' pour picking optimisé

class WarehouseOrder(BaseModel):
    """Commande à envoyer à l'entrepôt"""
    order_id: str
    items: List[WarehouseOrderItem]
    shipping_address: Dict
    carrier: Optional[str] = None
    packaging_type: Optional[str] = None  # Override config
    branded_insert: bool = True  # Insert marketing AEGIS

class WarehouseClient:
    """
    Client API pour TON entrepôt (WMS propriétaire)
    Remplace l'intégration NEXUS/externe
    """
    
    def __init__(self, config: WarehouseConfig):
        self.config = config
        self.session = requests.Session()
        self.session.headers.update({
            "Authorization": f"Bearer {config.wms_api_key}",
            "Content-Type": "application/json",
            "X-Warehouse-ID": config.warehouse_id,
            "X-AEGIS-Version": "12.1"
        })
    
    def _sign_payload(self, payload: str) -> str:
        """Signe webhook avec HMAC"""
        return hmac.new(
            self.config.webhook_secret.encode(),
            payload.encode(),
            hashlib.sha256
        ).hexdigest()
    
    # ============================================================
    # INVENTORY — Gestion des stocks
    # ============================================================
    
    def sync_inventory(self, products: List[Dict]) -> Dict:
        """
        Synchronise les produits AEGIS avec le WMS entrepôt
        """
        endpoint = f"{self.config.wms_endpoint_url}/v1/inventory/bulk-sync"
        
        payload = {
            "warehouse_id": self.config.warehouse_id,
            "products": [
                {
                    "sku": p["warehouse_sku"],
                    "barcode": p.get("barcode"),
                    "initial_qty": p["stock_quantity"],
                    "location": p.get("location_code", "DEFAULT"),
                    "zone": self._determine_zone(p)  # 'FAST-MOVERS' si best-seller
                }
                for p in products
            ]
        }
        
        response = self.session.post(endpoint, json=payload)
        response.raise_for_status()
        return response.json()
    
    def get_stock_levels(self, skus: List[str]) -> Dict[str, Dict]:
        """
        Récupère stock temps réel de l'entrepôt
        """
        endpoint = f"{self.config.wms_endpoint_url}/v1/inventory/levels"
        
        response = self.session.post(
            endpoint, 
            json={"skus": skus, "warehouse_id": self.config.warehouse_id}
        )
        response.raise_for_status()
        
        data = response.json()
        return {
            item["sku"]: {
                "available": item["quantity_available"],
                "reserved": item["quantity_reserved"],
                "location": item["location_code"]
            }
            for item in data["items"]
        }
    
    def update_stock(self, sku: str, quantity_change: int, reason: str) -> bool:
        """
        Met à jour stock (réception marchandise, ajustement inventaire)
        """
        endpoint = f"{self.config.wms_endpoint_url}/v1/inventory/adjust"
        
        payload = {
            "sku": sku,
            "warehouse_id": self.config.warehouse_id,
            "adjustment": quantity_change,
            "reason": reason  # 'reception', 'return', 'damage', 'inventory_count'
        }
        
        response = self.session.post(endpoint, json=payload)
        return response.status_code == 200
    
    # ============================================================
    # ORDERS — Fulfillment
    # ============================================================
    
    def create_order(self, order: WarehouseOrder) -> Dict:
        """
        Envoie commande à l'entrepôt pour pick & pack
        """
        endpoint = f"{self.config.wms_endpoint_url}/v1/orders"
        
        # Récupère les locations optimisées pour picking
        picking_optimized = self._optimize_picking(order.items)
        
        payload = {
            "external_id": order.order_id,
            "warehouse_id": self.config.warehouse_id,
            "items": [
                {
                    "sku": item.warehouse_sku,
                    "qty": item.quantity,
                    "location": item.location_code or picking_optimized.get(item.warehouse_sku)
                }
                for item in order.items
            ],
            "shipping": {
                "carrier": order.carrier or self.config.default_carrier,
                "address": order.shipping_address,
                "method": "standard"  # ou 'express'
            },
            "packaging": {
                "type": order.packaging_type or self.config.packaging_type,
                "branded_insert": order.branded_insert,
                "insert_design_id": None  # Référence design AEGIS généré
            },
            "priority": "normal",  # 'normal', 'urgent', 'same-day'
            "auto_process": True
        }
        
        response = self.session.post(endpoint, json=payload)
        response.raise_for_status()
        return response.json()
    
    def get_picking_list(self, batch_id: str) -> Dict:
        """
        Récupère liste de prélèvement optimisée pour opérateur entrepôt
        """
        endpoint = f"{self.config.wms_endpoint_url}/v1/picking-lists/{batch_id}"
        
        response = self.session.get(endpoint)
        response.raise_for_status()
        return response.json()
    
    def confirm_picked(self, wms_order_id: str, operator_name: str) -> bool:
        """
        Confirme qu'un opérateur a préparé la commande
        """
        endpoint = f"{self.config.wms_endpoint_url}/v1/orders/{wms_order_id}/pick"
        
        payload = {
            "operator": operator_name,
            "picked_at": datetime.utcnow().isoformat(),
            "items_verified": True
        }
        
        response = self.session.post(endpoint, json=payload)
        return response.status_code == 200
    
    def confirm_packed(self, wms_order_id: str, operator_name: str, 
                      parcel_count: int, weight_kg: float) -> Dict:
        """
        Confirme emballage et génère étiquette shipping
        """
        endpoint = f"{self.config.wms_endpoint_url}/v1/orders/{wms_order_id}/pack"
        
        payload = {
            "operator": operator_name,
            "packed_at": datetime.utcnow().isoformat(),
            "parcels": [
                {
                    "parcel_id": f"{wms_order_id}-{i+1}",
                    "weight_kg": weight_kg / parcel_count,
                    "dimensions_cm": {"l": 30, "w": 20, "h": 15}  # Standard ou mesuré
                }
                for i in range(parcel_count)
            ]
        }
        
        response = self.session.post(endpoint, json=payload)
        response.raise_for_status()
        return response.json()  # Retourne URLs étiquettes shipping
    
    # ============================================================
    # WEBHOOKS — Événements entrepôt
    # ============================================================
    
    def process_webhook(self, event_type: str, payload: Dict, 
                       signature: str, db: Session) -> bool:
        """
        Traite webhooks entrants de ton WMS entrepôt
        """
        if not self._verify_signature(payload, signature):
            raise SecurityError("Invalid webhook signature")
        
        handlers = {
            "order.confirmed": self._handle_order_confirmed,
            "order.picking": self._handle_picking_started,
            "order.picked": self._handle_picked,
            "order.packed": self._handle_packed,
            "order.shipped": self._handle_shipped,
            "order.delivered": self._handle_delivered,
            "order.exception": self._handle_exception,
            "stock.updated": self._handle_stock_update
        }
        
        handler = handlers.get(event_type)
        if handler:
            return handler(payload, db)
        return False
    
    def _handle_picked(self, payload: Dict, db: Session) -> bool:
        """Commande préparée par opérateur"""
        wms_order_id = payload["order_id"]
        operator = payload["operator_name"]
        
        order = db.query(WarehouseOrder).filter_by(wms_order_id=wms_order_id).first()
        if order:
            order.status = "picked"
            order.picked_by = operator
            order.picked_at = datetime.utcnow()
            order.webhook_events.append({
                "event": "picked",
                "operator": operator,
                "timestamp": datetime.utcnow().isoformat()
            })
            db.commit()
            
            # Notification client : "Votre commande est en préparation"
            self._notify_customer(order, "picked")
        
        return True
    
    def _handle_shipped(self, payload: Dict, db: Session) -> bool:
        """Commande expédiée"""
        wms_order_id = payload["order_id"]
        
        order = db.query(WarehouseOrder).filter_by(wms_order_id=wms_order_id).first()
        if order:
            order.status = "shipped"
            order.carrier_name = payload["carrier"]
            order.tracking_number = payload["tracking_number"]
            order.tracking_url = payload["tracking_url"]
            order.shipped_at = datetime.utcnow()
            db.commit()
            
            # Email client avec tracking
            self._send_tracking_email(order)
            
            # Mise à jour Empire Index (livraison = point positif)
            self._update_empire_index(order.brand_id, "fulfillment_speed", 10)
        
        return True
    
    def _optimize_picking(self, items: List[WarehouseOrderItem]) -> Dict[str, str]:
        """
        Optimise le chemin de picking dans l'entrepôt
        (algorithme pathfinding simple : allées les plus proches)
        """
        # Appelle API WMS pour optimisation
        endpoint = f"{self.config.wms_endpoint_url}/v1/picking/optimize"
        
        skus = [item.warehouse_sku for item in items]
        response = self.session.post(
            endpoint,
            json={"skus": skus, "warehouse_id": self.config.warehouse_id}
        )
        
        if response.status_code == 200:
            data = response.json()
            return {item["sku"]: item["optimal_location"] for item in data["items"]}
        
        # Fallback : locations par défaut
        return {}