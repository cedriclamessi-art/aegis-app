# Recon map: shopamua.com

**Method and limits.** shopamua.com is blocked by this environment's network policy (403). This map comes only from public search snippets of the site's pages. No screenshots, no computed styles, no interaction sweep. Everything below is confidence: low to medium. Re-run with direct access to confirm.

## 1. Scope (proposed defaults, unconfirmed)
- App: shopamua.com, web (mobile-first likely)
- Slice: the buying loop: landing, product page, cart, checkout, order tracking
- For: not specified yet

## 2. Sources
| source | URL | gave |
| --- | --- | --- |
| home | https://shopamua.com/ | brand "AMUA VITALDROPS", wellness pitch |
| product | https://shopamua.com/products/amua-vitaldrops | main product, rating shown (4.5/5, 3,000+ reviews, unverified) |
| product | https://shopamua.com/products/silky-bottle-pouch | secondary product |
| spanish product | https://shopamua.com/products/amua-vitaldrops-spanish | localized product page |
| collection | https://shopamua.com/collections/frontpage | catalogue |
| cart | https://shopamua.com/cart | free-shipping threshold, shipping protection add-on |
| tracking | https://shopamua.com/apps/track123 | order tracking app page |
| about | https://shopamua.com/pages/about-us | mission |
| policies | https://shopamua.com/policies/refund-policy , /terms-of-service | refund and shipping rules |

URL patterns (/collections, /products, /policies, /pages, /apps) indicate a Shopify storefront. Inference, not confirmed.

## 3. Screen inventory
| ID | screen | route | purpose | key components | states seen |
| --- | --- | --- | --- | --- | --- |
| S01 | Home | / | pitch + main product | hero, rating badge, CTA, trust badges | unknown |
| S02 | Collection | /collections/frontpage | list products | product cards | unknown |
| S03 | Product (main) | /products/amua-vitaldrops | sell the main product | gallery, bundle picker (1 or 3 bottles), reviews, guarantee badge | unknown |
| S04 | Product (secondary) | /products/silky-bottle-pouch | accessory | same template as S03 | unknown |
| S05 | Product (Spanish) | /products/amua-vitaldrops-spanish | localized copy | same template as S03 | unknown |
| S06 | Cart | /cart | review and upsell | line items, shipping protection add-on ($2.99), free-shipping bar | threshold shown as $50 and $70 on different pages |
| S07 | Checkout | not observed | pay | Shopify-style hosted checkout (guess) | not observed |
| S08 | Order tracking | /apps/track123 | track an order | order number + email form | not observed |
| S09 | About | /pages/about-us | brand story | text | static |
| S10 | Policies | /policies/* | refund, terms, shipping | text | static |

## 4. Flows
- F01 Visitor buys: S01 -> S03 -> S06 -> S07 -> confirmation. Click count not measurable without direct access.
  edge: free-shipping threshold, shipping protection opt-in, 1 bottle vs 3 bottles (guarantee only covers a full 3-bottle supply)
- F02 Customer tracks order: S08 (order number) -> status
- F03 Customer requests refund: email support@shopamua.com with subject "90-Day Guarantee Request" (manual, no in-app flow seen)

## 5. Components (inferred)
Header + cart icon, announcement bar (guess), product card, product gallery, bundle selector, rating/review summary, trust badges, cart drawer or page, free-shipping progress bar, shipping-protection toggle, footer with policy links, language variant of product page.

## 6. Inferred data model (all guesses)
- Product: id, handle, title, description, images, price, variants (bottle count), rating_avg, review_count. Confidence: medium.
- Variant: id, product_id, bundle_size, price, compare_at_price. Confidence: low.
- Cart: id, lines[], shipping_protection (bool), subtotal. Confidence: medium.
- Order: id, number, email, status, tracking_number, carrier. Confidence: medium (tracking page exists).
- RefundRequest: order_numbers[], email, requested_at, within_90_days. Confidence: medium, handled by email today.

## 7. Policy rules found
- Processing 1-2 business days, delivery usually 4-8 business days, tracking email on shipment
- 90-day guarantee only for a full 90-day supply (3 bottles) bought on the site; excludes resellers and orders without proof
- Refund to original payment method within 1-3 business days
- Orders may not be cancellable once accepted

## 8. Cannot or should not be cloned (skip)
- Brand name, logo, product photos, copy, reviews and ratings: owned by Amua
- The product itself and its supply chain
- Health and body claims ("hormonal balance", "fuller hips, thighs and booty") and the "FDA-registered", "GMP", "third-party tested" statements. They are unverified and the site contradicts itself. Do not reuse them. For a supplement, advertising claims are regulated (FTC/FDA in the US).
- Real customer reviews (cannot be copied; use your own)

## 9. Size
Screens 10, flows 3, entities 5. Hard parts: payments/checkout, order tracking integration, shipping-protection add-on logic. Size: S if built on Shopify or Stripe Checkout, M if fully custom.

## Observed inconsistencies on the original (opportunities)
- Free shipping threshold differs between pages ($50 vs $70)
- Refund policy conflicts with the Silky Bottle Pouch page (simple 90-day return)
- Marketing message differs between home and product pages
