import type { Product } from "@/types/shop";
import { ProductCard } from "./ProductCard";

export function ProductGrid({ products }: { products: Product[] }) {
  return (
    <section aria-labelledby="shop-heading" className="mx-auto max-w-6xl px-4 py-14">
      <h2 id="shop-heading" className="text-2xl font-semibold tracking-tight">
        Shop the collection
      </h2>
      <div className="mt-6 grid grid-cols-2 gap-5 md:grid-cols-3 lg:grid-cols-4">
        {products.map((p) => (
          <ProductCard key={p.handle} product={p} />
        ))}
      </div>
    </section>
  );
}
