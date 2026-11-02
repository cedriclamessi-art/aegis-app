import Link from "next/link";
import { ProductImage } from "@/components/ProductImage";
import type { Product } from "@/types/shop";

export function ProductCard({ product }: { product: Product }) {
  const from = Math.min(...product.bundles.map((b) => b.price));
  return (
    <Link
      href={`/product/${product.handle}`}
      className="group block rounded-2xl focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-neutral-900"
    >
      <ProductImage product={product} className="transition group-hover:opacity-90" />
      <h3 className="mt-3 text-base font-semibold text-neutral-900">{product.title}</h3>
      <p className="text-sm text-neutral-600">{product.tagline}</p>
      <p className="mt-1 text-sm font-medium text-neutral-900">from ${from}</p>
    </Link>
  );
}
