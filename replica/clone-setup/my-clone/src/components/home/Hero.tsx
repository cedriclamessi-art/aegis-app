import Link from "next/link";
import { Star } from "lucide-react";
import type { Product } from "@/types/shop";

export function Hero({ product }: { product: Product }) {
  return (
    <section className="bg-gradient-to-b from-neutral-50 to-white">
      <div className="mx-auto max-w-3xl px-4 py-16 text-center md:py-24">
        <h1 className="text-4xl font-semibold tracking-tight text-neutral-900 md:text-5xl">
          Feel your best, every single day
        </h1>
        <p className="mx-auto mt-4 max-w-xl text-lg text-neutral-600">
          Placeholder subline. A simple daily routine designed to fit your life, backed by a 90-day guarantee.
        </p>
        <p className="mt-5 flex items-center justify-center gap-2 text-sm text-neutral-700">
          <span className="flex" aria-hidden="true">
            {[0, 1, 2, 3, 4].map((i) => (
              <Star
                key={i}
                className={`size-4 ${i < Math.round(product.rating) ? "fill-amber-400 text-amber-400" : "text-neutral-300"}`}
              />
            ))}
          </span>
          <span>
            {product.rating.toFixed(1)} out of 5 from {product.reviewCount.toLocaleString("en-US")}+ reviews
          </span>
        </p>
        <Link
          href={`/product/${product.handle}`}
          className="mt-8 inline-flex h-12 items-center justify-center rounded-full bg-neutral-900 px-8 text-base font-medium text-white transition hover:bg-neutral-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-900"
        >
          Shop {product.title}
        </Link>
      </div>
    </section>
  );
}
