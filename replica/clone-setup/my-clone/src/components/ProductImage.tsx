import type { Product } from "@/types/shop";

// Placeholder visual. Swap for <Image> with your own photo.
export function ProductImage({ product, className = "" }: { product: Product; className?: string }) {
  return (
    <div
      className={`flex aspect-square items-center justify-center rounded-2xl bg-gradient-to-br ${product.accent} text-sm text-neutral-500 ${className}`}
      role="img"
      aria-label={product.title}
    >
      Photo
    </div>
  );
}
