"use client";

import { useState } from "react";
import Link from "next/link";
import { Check, ShieldCheck } from "lucide-react";
import type { Product } from "@/types/shop";
import { useCart } from "@/components/CartProvider";

const usd = (n: number) => `$${n.toFixed(n % 1 === 0 ? 0 : 2)}`;

export function PurchasePanel({ product }: { product: Product }) {
  const { add } = useCart();
  const defaultId = product.bundles[Math.floor(product.bundles.length / 2)]?.id ?? product.bundles[0].id;
  const [bundleId, setBundleId] = useState(defaultId);
  const [added, setAdded] = useState(false);

  const onAdd = () => {
    add(product.handle, bundleId);
    setAdded(true);
  };

  return (
    <div>
      <fieldset>
        <legend className="mb-3 text-sm font-medium">Choose your bundle</legend>
        <div className="space-y-3">
          {product.bundles.map((b) => {
            const selected = b.id === bundleId;
            return (
              <label
                key={b.id}
                className={`flex cursor-pointer items-center justify-between gap-3 rounded-xl border p-4 transition has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-neutral-900 has-[:focus-visible]:ring-offset-2 ${
                  selected ? "border-neutral-900 bg-neutral-50" : "border-neutral-200 hover:border-neutral-400"
                }`}
              >
                <span className="flex items-center gap-3">
                  <input
                    type="radio"
                    name="bundle"
                    value={b.id}
                    checked={selected}
                    onChange={() => {
                      setBundleId(b.id);
                      setAdded(false);
                    }}
                    className="size-4 accent-neutral-900"
                  />
                  <span className="font-medium">{b.label}</span>
                  {b.badge && (
                    <span className="rounded-full bg-neutral-900 px-2 py-0.5 text-xs text-white">{b.badge}</span>
                  )}
                </span>
                <span className="text-right">
                  {b.compareAt && (
                    <span className="mr-2 text-sm text-neutral-500 line-through">{usd(b.compareAt)}</span>
                  )}
                  <span className="font-semibold">{usd(b.price)}</span>
                </span>
              </label>
            );
          })}
        </div>
      </fieldset>

      <button
        type="button"
        data-testid="add-to-cart"
        onClick={onAdd}
        className="mt-6 w-full rounded-full bg-neutral-900 px-6 py-4 font-semibold text-white transition hover:bg-neutral-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-900"
      >
        Add to cart
      </button>

      <div aria-live="polite" className="mt-3 min-h-6 text-sm">
        {added && (
          <p className="flex items-center gap-2 text-emerald-700">
            <Check className="size-4" aria-hidden="true" />
            Added
            <Link href="/cart" className="font-medium underline underline-offset-2">
              View cart
            </Link>
          </p>
        )}
      </div>

      <p className="mt-2 flex items-center gap-2 text-sm text-neutral-600">
        <ShieldCheck className="size-4" aria-hidden="true" />
        90-day money-back guarantee (placeholder).
      </p>
    </div>
  );
}
