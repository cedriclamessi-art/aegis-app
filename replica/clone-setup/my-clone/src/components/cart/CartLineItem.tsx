"use client";

import { Minus, Plus, Trash2 } from "lucide-react";
import { useCart } from "@/components/CartProvider";
import { ProductImage } from "@/components/ProductImage";
import { getProduct } from "@/data/products";
import type { CartLine } from "@/types/shop";
import { money } from "./format";

export function CartLineItem({ line }: { line: CartLine }) {
  const { setQty, remove, lineTotal } = useCart();
  const product = getProduct(line.handle);
  const bundle = product?.bundles.find((b) => b.id === line.bundleId);
  if (!product || !bundle) return null;

  const btn =
    "inline-flex h-9 w-9 items-center justify-center rounded-full border border-neutral-300 hover:bg-neutral-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-900";

  return (
    <li data-testid="cart-line" className="flex gap-4 py-5">
      <ProductImage product={product} className="w-20 shrink-0 sm:w-24" />
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="font-medium text-neutral-900">{product.title}</h3>
            <p className="text-sm text-neutral-500">{bundle.label}</p>
            <p className="text-sm text-neutral-500">{money(bundle.price)} each</p>
          </div>
          <p className="font-semibold text-neutral-900">{money(lineTotal(line))}</p>
        </div>
        <div className="mt-auto flex items-center justify-between">
          <div className="flex items-center gap-2" role="group" aria-label={`Quantity for ${product.title}, ${bundle.label}`}>
            <button
              type="button"
              className={btn}
              aria-label="Decrease quantity"
              onClick={() => setQty(line.handle, line.bundleId, line.qty - 1)}
            >
              <Minus className="h-4 w-4" aria-hidden />
            </button>
            <span className="w-8 text-center tabular-nums" aria-live="polite">
              {line.qty}
            </span>
            <button
              type="button"
              className={btn}
              aria-label="Increase quantity"
              onClick={() => setQty(line.handle, line.bundleId, line.qty + 1)}
            >
              <Plus className="h-4 w-4" aria-hidden />
            </button>
          </div>
          <button
            type="button"
            onClick={() => remove(line.handle, line.bundleId)}
            className="inline-flex items-center gap-1 rounded text-sm text-neutral-500 underline-offset-2 hover:text-neutral-900 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-900"
          >
            <Trash2 className="h-4 w-4" aria-hidden />
            Remove<span className="sr-only"> {product.title}, {bundle.label}</span>
          </button>
        </div>
      </div>
    </li>
  );
}
