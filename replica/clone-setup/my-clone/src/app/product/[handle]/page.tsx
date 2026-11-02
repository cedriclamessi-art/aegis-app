import { notFound } from "next/navigation";
import { Star } from "lucide-react";
import { getProduct, products } from "@/data/products";
import { ProductImage } from "@/components/ProductImage";
import { PurchasePanel } from "@/components/product/PurchasePanel";

export function generateStaticParams() {
  return products.map((p) => ({ handle: p.handle }));
}

export default async function ProductPage({ params }: { params: Promise<{ handle: string }> }) {
  const { handle } = await params;
  const product = getProduct(handle);
  if (!product) notFound();

  const filled = Math.round(product.rating);
  const details = [
    { title: "Ingredients", body: "Placeholder ingredients list. Replace with your own." },
    { title: "Shipping", body: "Placeholder shipping information. Free shipping over $70." },
    { title: "Returns", body: "Placeholder returns policy. 90-day guarantee." },
  ];

  return (
    <main className="mx-auto grid max-w-6xl gap-8 px-4 py-8 md:grid-cols-2 md:gap-12">
      <ProductImage product={product} />
      <div>
        <h1 className="text-3xl font-semibold tracking-tight">{product.title}</h1>
        <p className="mt-1 text-neutral-600">{product.tagline}</p>
        <div className="mt-3 flex items-center gap-2 text-sm">
          <span role="img" aria-label={`Rated ${product.rating} out of 5`} className="flex">
            {[1, 2, 3, 4, 5].map((i) => (
              <Star
                key={i}
                className={`size-4 ${i <= filled ? "fill-amber-400 text-amber-400" : "text-neutral-300"}`}
                aria-hidden="true"
              />
            ))}
          </span>
          <span className="text-neutral-600">
            {product.rating} ({product.reviewCount.toLocaleString("en-US")} reviews)
          </span>
        </div>
        <p className="mt-4 text-2xl font-semibold">From ${Math.min(...product.bundles.map((b) => b.price))}</p>
        <div className="mt-6">
          <PurchasePanel product={product} />
        </div>
        <p className="mt-8 text-neutral-700">{product.description}</p>
        <div className="mt-6 divide-y border-y">
          {details.map((d) => (
            <details key={d.title} className="group py-3">
              <summary className="cursor-pointer font-medium focus-visible:outline-2 focus-visible:outline-neutral-900">
                {d.title}
              </summary>
              <p className="mt-2 text-sm text-neutral-600">{d.body}</p>
            </details>
          ))}
        </div>
      </div>
    </main>
  );
}
