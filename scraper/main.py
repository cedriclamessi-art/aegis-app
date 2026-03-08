"""
AEGIS Scraper Service — FastAPI + Crawl4AI
==========================================
Microservice de scraping produit pour le pipeline AEGIS.
Scrape les pages AliExpress, Amazon, Shopify et tout site e-commerce.

Usage:
  pip install -r requirements.txt
  playwright install chromium
  python main.py
"""

import os
import re
import asyncio
import logging
from typing import Optional

from fastapi import FastAPI, HTTPException, Header
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from crawl4ai import AsyncWebCrawler, BrowserConfig, CrawlerRunConfig, CacheMode

import httpx

from extractors import (
    extract_aliexpress,
    extract_amazon,
    extract_shopify,
    extract_shopify_api,
    extract_generic,
)

# ── Config ──────────────────────────────────────────────────
logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
log = logging.getLogger("aegis-scraper")

INTERNAL_TOKEN = os.getenv("INTERNAL_SERVICE_TOKEN", "")
PORT = int(os.getenv("SCRAPER_PORT", "3001"))

# ── FastAPI App ─────────────────────────────────────────────
app = FastAPI(
    title="AEGIS Scraper Service",
    description="Product page scraping powered by Crawl4AI",
    version="1.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


# ── Models ──────────────────────────────────────────────────
class ScrapeRequest(BaseModel):
    url: str
    source: Optional[str] = None  # aliexpress | amazon | shopify | tiktok | other


class ProductRecord(BaseModel):
    name: str = ""
    description: str = ""
    price: float = 0.0
    currency: str = "EUR"
    images: list[str] = Field(default_factory=list)
    category: Optional[str] = None
    rating: Optional[float] = None
    reviewCount: Optional[int] = None
    supplier: Optional[str] = None
    shippingDays: Optional[int] = None
    rawData: dict = Field(default_factory=dict)


# ── Source Detection ────────────────────────────────────────
def detect_source(url: str) -> str:
    """Auto-detect the source platform from URL."""
    domain = url.lower()
    if "aliexpress" in domain:
        return "aliexpress"
    if "amazon" in domain:
        return "amazon"
    if "myshopify" in domain or "/products/" in domain:
        return "shopify"
    if "tiktok" in domain:
        return "tiktok"
    return "other"


# ── Crawl4AI Scraper ───────────────────────────────────────
async def scrape_url(url: str) -> tuple[str, str]:
    """
    Scrape a URL using Crawl4AI.
    Returns (raw_html, markdown_content).
    Tries domcontentloaded first (fast), then networkidle as fallback.
    """
    browser_config = BrowserConfig(
        headless=True,
        verbose=False,
        extra_args=[
            "--disable-gpu",
            "--no-sandbox",
            "--disable-dev-shm-usage",
        ],
    )

    async with AsyncWebCrawler(config=browser_config) as crawler:
        # Strategy 1: Fast — domcontentloaded + short delay
        crawl_config = CrawlerRunConfig(
            cache_mode=CacheMode.BYPASS,
            page_timeout=45000,
            wait_until="domcontentloaded",
            delay_before_return_html=3.0,  # Wait for JS rendering
            word_count_threshold=10,
            excluded_tags=["nav", "footer", "header", "aside"],
            remove_overlay_elements=True,
        )

        result = await crawler.arun(url=url, config=crawl_config)

        if not result.success:
            # Strategy 2: Retry with commit wait
            log.warning(f"[SCRAPE] domcontentloaded failed, retrying with commit for {url}")
            crawl_config_retry = CrawlerRunConfig(
                cache_mode=CacheMode.BYPASS,
                page_timeout=60000,
                wait_until="commit",
                delay_before_return_html=5.0,
                word_count_threshold=5,
                excluded_tags=["nav", "footer", "header", "aside"],
                remove_overlay_elements=True,
            )
            result = await crawler.arun(url=url, config=crawl_config_retry)

        if not result.success:
            raise HTTPException(
                status_code=502,
                detail=f"Crawl4AI scraping failed: {result.error_message}",
            )

        return result.html, result.markdown.raw_markdown


# ── Shopify API Shortcut ──────────────────────────────────
async def _try_shopify_api(url: str) -> dict | None:
    """
    Try to get product data from Shopify's /products/xxx.json API.
    This is MUCH faster than rendering the page and works on most Shopify stores.
    """
    # Extract the product handle from the URL
    match = re.search(r'/products/([^/?#]+)', url)
    if not match:
        return None

    handle = match.group(1)
    # Build the base URL
    parsed = url.split("/products/")[0]
    api_url = f"{parsed}/products/{handle}.json"

    try:
        async with httpx.AsyncClient(timeout=10, follow_redirects=True) as client:
            resp = await client.get(api_url, headers={
                "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
                "Accept": "application/json",
            })
            if resp.status_code != 200:
                return None

            product = resp.json().get("product")
            if not product:
                return None

            return extract_shopify_api(product, url)
    except Exception as e:
        log.warning(f"[SHOPIFY-API] Failed for {url}: {e}")
        return None


# ── Endpoints ──────────────────────────────────────────────

@app.get("/health")
async def health():
    """Health check endpoint."""
    return {"status": "ok", "service": "aegis-scraper", "engine": "crawl4ai"}


@app.post("/scrape", response_model=ProductRecord)
async def scrape_product(
    req: ScrapeRequest,
    x_internal_token: str = Header(default="", alias="X-Internal-Token"),
):
    """
    Scrape a product page and return structured data.

    Supports: AliExpress, Amazon, Shopify, and any e-commerce site.
    Auto-detects the platform if `source` is not provided.
    """
    # Token verification (optional, for internal services)
    if INTERNAL_TOKEN and x_internal_token != INTERNAL_TOKEN:
        log.warning(f"Invalid internal token from request to {req.url}")
        # Don't block — just log (for now)

    source = req.source or detect_source(req.url)
    log.info(f"[SCRAPE] {source} — {req.url}")

    # ── Strategy 1: For Shopify, try the /products/xxx.json API first ──
    if source == "shopify":
        api_data = await _try_shopify_api(req.url)
        if api_data and api_data.get("name"):
            log.info(f"[SCRAPE] Shopify API success — {api_data['name'][:50]}")
            api_data["rawData"]["scrape_method"] = "shopify_api"
            api_data["rawData"]["source"] = source
            api_data["rawData"]["url"] = req.url
            return ProductRecord(**api_data)

    # ── Strategy 2: Full Crawl4AI scrape ──
    try:
        html, markdown = await scrape_url(req.url)
    except HTTPException:
        raise
    except Exception as e:
        log.error(f"[SCRAPE] Error scraping {req.url}: {e}")
        raise HTTPException(status_code=502, detail=f"Scraping error: {str(e)}")

    # Extract structured data based on source
    try:
        if source == "aliexpress":
            data = extract_aliexpress(html, markdown, req.url)
        elif source == "amazon":
            data = extract_amazon(html, markdown, req.url)
        elif source == "shopify":
            data = extract_shopify(html, markdown, req.url)
        else:
            data = extract_generic(markdown, req.url)
    except Exception as e:
        log.error(f"[EXTRACT] Error extracting from {req.url}: {e}")
        # Fallback to generic extraction
        data = extract_generic(markdown, req.url)

    # Enrich rawData
    data["rawData"]["scrape_method"] = "crawl4ai"
    data["rawData"]["source"] = source
    data["rawData"]["url"] = req.url
    data["rawData"]["markdown_length"] = len(markdown)
    data["rawData"]["html_length"] = len(html)

    # Clean up empty fields
    if not data["name"]:
        # Last resort: use domain as name
        domain = req.url.replace("https://", "").replace("http://", "").split("/")[0]
        data["name"] = f"Produit — {domain}"

    log.info(
        f"[SCRAPE] Done — {data['name'][:50]} — "
        f"€{data['price']} — {len(data['images'])} images — "
        f"rating {data['rating']}"
    )

    return ProductRecord(**data)


@app.post("/scrape/batch")
async def scrape_batch(urls: list[str]):
    """Scrape multiple product URLs in parallel."""
    tasks = [
        scrape_product(ScrapeRequest(url=url))
        for url in urls[:10]  # Max 10 concurrent
    ]
    results = await asyncio.gather(*tasks, return_exceptions=True)

    return {
        "results": [
            r.model_dump() if isinstance(r, ProductRecord) else {"error": str(r), "url": urls[i]}
            for i, r in enumerate(results)
        ],
        "total": len(urls),
        "success": sum(1 for r in results if isinstance(r, ProductRecord)),
    }


# ── Run ────────────────────────────────────────────────────
if __name__ == "__main__":
    import uvicorn

    log.info(f"AEGIS Scraper Service starting on port {PORT}")
    uvicorn.run(app, host="0.0.0.0", port=PORT, log_level="info")
