"""
AEGIS Scraper — Platform-specific extractors
=============================================
Extract structured product data from raw HTML/markdown
for AliExpress, Amazon, Shopify, and generic pages.
"""

import re
import json
from typing import Optional


def extract_aliexpress(html: str, markdown: str, url: str) -> dict:
    """Extract product data from AliExpress page."""
    data = {
        "name": "",
        "description": "",
        "price": 0.0,
        "currency": "EUR",
        "images": [],
        "category": None,
        "rating": None,
        "reviewCount": None,
        "supplier": None,
        "shippingDays": None,
        "rawData": {"source": "aliexpress", "url": url},
    }

    # Try JSON-LD first
    json_ld = _extract_json_ld(html)
    if json_ld:
        data["name"] = json_ld.get("name", "")
        if "offers" in json_ld:
            offers = json_ld["offers"]
            if isinstance(offers, list):
                offers = offers[0]
            data["price"] = float(offers.get("price", 0))
            data["currency"] = offers.get("priceCurrency", "EUR")
        if "image" in json_ld:
            imgs = json_ld["image"]
            data["images"] = imgs if isinstance(imgs, list) else [imgs]
        if "aggregateRating" in json_ld:
            ar = json_ld["aggregateRating"]
            data["rating"] = float(ar.get("ratingValue", 0))
            data["reviewCount"] = int(ar.get("reviewCount", 0))
        data["description"] = json_ld.get("description", "")

    # Fallback: extract from HTML patterns
    if not data["name"]:
        title_match = re.search(r'<title[^>]*>(.+?)</title>', html, re.IGNORECASE)
        if title_match:
            data["name"] = title_match.group(1).split("|")[0].split("-")[0].strip()

    if not data["images"]:
        img_matches = re.findall(r'(https?://[^\s"\']+\.(?:jpg|jpeg|png|webp))', html)
        # Filter for product images (large enough URLs)
        data["images"] = list(set(
            img for img in img_matches
            if "ae01.alicdn" in img or "cbu01.alicdn" in img
        ))[:10]

    if data["price"] == 0:
        price_match = re.search(r'[\$\€]?\s*(\d+[.,]\d{2})', markdown)
        if price_match:
            data["price"] = float(price_match.group(1).replace(",", "."))

    # Extract orders count
    orders_match = re.search(r'(\d[\d,]*)\s*(?:sold|orders|commandes|ventes)', markdown, re.IGNORECASE)
    if orders_match:
        data["rawData"]["orders"] = int(orders_match.group(1).replace(",", ""))

    # Extract shipping
    ship_match = re.search(r'(\d+)\s*(?:days?|jours?|business days)', markdown, re.IGNORECASE)
    if ship_match:
        data["shippingDays"] = int(ship_match.group(1))

    # Store name
    store_match = re.search(r'(?:Store|Boutique|Shop)\s*[:\-]?\s*([^\n<]+)', html, re.IGNORECASE)
    if store_match:
        data["supplier"] = store_match.group(1).strip()[:100]

    return data


def extract_amazon(html: str, markdown: str, url: str) -> dict:
    """Extract product data from Amazon page."""
    data = {
        "name": "",
        "description": "",
        "price": 0.0,
        "currency": "EUR",
        "images": [],
        "category": None,
        "rating": None,
        "reviewCount": None,
        "supplier": None,
        "shippingDays": None,
        "rawData": {"source": "amazon", "url": url},
    }

    # JSON-LD
    json_ld = _extract_json_ld(html)
    if json_ld:
        data["name"] = json_ld.get("name", "")
        if "offers" in json_ld:
            offers = json_ld["offers"]
            if isinstance(offers, list):
                offers = offers[0]
            data["price"] = float(offers.get("price", 0))
            data["currency"] = offers.get("priceCurrency", "EUR")
        if "image" in json_ld:
            imgs = json_ld["image"]
            data["images"] = imgs if isinstance(imgs, list) else [imgs]
        if "aggregateRating" in json_ld:
            ar = json_ld["aggregateRating"]
            data["rating"] = float(ar.get("ratingValue", 0))
            data["reviewCount"] = int(ar.get("reviewCount", ar.get("ratingCount", 0)))

    # Title fallback
    if not data["name"]:
        title_match = re.search(r'id="productTitle"[^>]*>([^<]+)', html)
        if title_match:
            data["name"] = title_match.group(1).strip()

    # Price fallback
    if data["price"] == 0:
        price_match = re.search(r'(?:price|prix)[^0-9]*(\d+[.,]\d{2})', markdown, re.IGNORECASE)
        if price_match:
            data["price"] = float(price_match.group(1).replace(",", "."))

    # Rating fallback
    if not data["rating"]:
        rating_match = re.search(r'(\d[.,]\d)\s*(?:out of|sur)\s*5', markdown, re.IGNORECASE)
        if rating_match:
            data["rating"] = float(rating_match.group(1).replace(",", "."))

    # Reviews fallback
    if not data["reviewCount"]:
        review_match = re.search(r'([\d,]+)\s*(?:ratings?|evaluations?|avis)', markdown, re.IGNORECASE)
        if review_match:
            data["reviewCount"] = int(review_match.group(1).replace(",", ""))

    # ASIN
    asin_match = re.search(r'/dp/([A-Z0-9]{10})', url)
    if asin_match:
        data["rawData"]["asin"] = asin_match.group(1)

    # Images
    if not data["images"]:
        img_matches = re.findall(r'(https?://m\.media-amazon\.com/images/[^\s"\']+)', html)
        data["images"] = list(set(img_matches))[:10]

    # BSR
    bsr_match = re.search(r'Best Sellers Rank.*?#([\d,]+)', html, re.DOTALL)
    if bsr_match:
        data["rawData"]["bsr"] = int(bsr_match.group(1).replace(",", ""))

    return data


def extract_shopify(html: str, markdown: str, url: str) -> dict:
    """Extract product data from Shopify store."""
    data = {
        "name": "",
        "description": "",
        "price": 0.0,
        "currency": "EUR",
        "images": [],
        "category": None,
        "rating": None,
        "reviewCount": None,
        "supplier": None,
        "shippingDays": None,
        "rawData": {"source": "shopify", "url": url},
    }

    # Shopify stores expose product data in a JS variable
    product_json_match = re.search(r'var\s+meta\s*=\s*(\{[^;]+\})', html)

    # Try JSON-LD
    json_ld = _extract_json_ld(html)
    if json_ld:
        data["name"] = json_ld.get("name", "")
        data["description"] = json_ld.get("description", "")
        if "offers" in json_ld:
            offers = json_ld["offers"]
            if isinstance(offers, list):
                offers = offers[0]
            data["price"] = float(offers.get("price", 0))
            data["currency"] = offers.get("priceCurrency", "EUR")
        if "image" in json_ld:
            imgs = json_ld["image"]
            data["images"] = imgs if isinstance(imgs, list) else [imgs]

    # Shopify product JSON in script tag
    shopify_json = re.search(r'"product"\s*:\s*(\{.+?\})\s*[,}]', html)
    if not shopify_json:
        shopify_json = re.search(r'ShopifyAnalytics\.meta\s*=\s*(\{.+?\})', html)

    # Title fallback
    if not data["name"]:
        og_title = re.search(r'property="og:title"\s+content="([^"]+)"', html)
        if og_title:
            data["name"] = og_title.group(1)

    # Price fallback
    if data["price"] == 0:
        og_price = re.search(r'property="og:price:amount"\s+content="([^"]+)"', html)
        if og_price:
            data["price"] = float(og_price.group(1))

    # Images from og tags
    if not data["images"]:
        og_images = re.findall(r'property="og:image"\s+content="([^"]+)"', html)
        data["images"] = og_images[:10]

    # Vendor
    vendor_match = re.search(r'"vendor"\s*:\s*"([^"]+)"', html)
    if vendor_match:
        data["supplier"] = vendor_match.group(1)

    return data


def extract_shopify_api(product: dict, url: str) -> dict:
    """Extract product data from Shopify JSON API response (/products/xxx.json)."""
    data = {
        "name": product.get("title", ""),
        "description": "",
        "price": 0.0,
        "currency": "USD",
        "images": [],
        "category": product.get("product_type") or None,
        "rating": None,
        "reviewCount": None,
        "supplier": product.get("vendor") or None,
        "shippingDays": None,
        "rawData": {
            "source": "shopify",
            "url": url,
            "shopify_id": product.get("id"),
            "tags": product.get("tags", ""),
            "variants_count": len(product.get("variants", [])),
        },
    }

    # Description: strip HTML tags
    body_html = product.get("body_html", "")
    if body_html:
        data["description"] = re.sub(r'<[^>]+>', ' ', body_html).strip()[:500]

    # Price from first variant
    variants = product.get("variants", [])
    if variants:
        first_variant = variants[0]
        try:
            data["price"] = float(first_variant.get("price", 0))
        except (ValueError, TypeError):
            pass

        # Check compare_at_price for original price
        compare = first_variant.get("compare_at_price")
        if compare:
            try:
                data["rawData"]["compare_at_price"] = float(compare)
            except (ValueError, TypeError):
                pass

    # Images
    images = product.get("images", [])
    data["images"] = [img.get("src", "") for img in images if img.get("src")][:10]

    return data


def extract_generic(markdown: str, url: str) -> dict:
    """Extract product data from any page using markdown content."""
    data = {
        "name": "",
        "description": "",
        "price": 0.0,
        "currency": "EUR",
        "images": [],
        "category": None,
        "rating": None,
        "reviewCount": None,
        "supplier": None,
        "shippingDays": None,
        "rawData": {"source": "generic", "url": url},
    }

    # Extract title from first heading
    heading = re.search(r'^#\s+(.+)', markdown, re.MULTILINE)
    if heading:
        data["name"] = heading.group(1).strip()

    # Price patterns
    price_patterns = [
        r'(?:prix|price|tarif)\s*[:\-]?\s*[\$\€£]?\s*(\d+[.,]\d{2})',
        r'[\$\€£]\s*(\d+[.,]\d{2})',
        r'(\d+[.,]\d{2})\s*[\$\€£]',
        r'(\d+[.,]\d{2})\s*(?:EUR|USD|GBP)',
    ]
    for pattern in price_patterns:
        match = re.search(pattern, markdown, re.IGNORECASE)
        if match:
            data["price"] = float(match.group(1).replace(",", "."))
            break

    # Currency detection
    if "$" in markdown[:500] or "USD" in markdown[:500]:
        data["currency"] = "USD"
    elif "£" in markdown[:500] or "GBP" in markdown[:500]:
        data["currency"] = "GBP"

    # Rating
    rating_match = re.search(r'(\d[.,]\d)\s*/\s*5|(\d[.,]\d)\s*(?:stars?|etoiles?)', markdown, re.IGNORECASE)
    if rating_match:
        val = rating_match.group(1) or rating_match.group(2)
        data["rating"] = float(val.replace(",", "."))

    # Images from markdown
    img_matches = re.findall(r'!\[.*?\]\((https?://[^\)]+)\)', markdown)
    if not img_matches:
        img_matches = re.findall(r'(https?://[^\s"\']+\.(?:jpg|jpeg|png|webp))', markdown)
    data["images"] = list(set(img_matches))[:10]

    # First ~500 chars as description
    text = re.sub(r'[#\*\[\]!]', '', markdown[:800]).strip()
    data["description"] = text[:500]

    return data


def _extract_json_ld(html: str) -> Optional[dict]:
    """Extract JSON-LD Product schema from HTML."""
    matches = re.findall(
        r'<script\s+type="application/ld\+json"[^>]*>(.*?)</script>',
        html,
        re.DOTALL | re.IGNORECASE,
    )
    for raw in matches:
        try:
            obj = json.loads(raw.strip())
            # Handle @graph arrays
            if isinstance(obj, list):
                for item in obj:
                    if item.get("@type") == "Product":
                        return item
            elif isinstance(obj, dict):
                if obj.get("@type") == "Product":
                    return obj
                if "@graph" in obj:
                    for item in obj["@graph"]:
                        if isinstance(item, dict) and item.get("@type") == "Product":
                            return item
        except (json.JSONDecodeError, TypeError):
            continue
    return None
