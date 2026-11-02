"use client";

import { useId } from "react";
import { useCart } from "@/components/CartProvider";
import { SHIPPING_PROTECTION_PRICE } from "@/data/products";
import { money } from "./format";

export function CartSummary() {
  const { subtotal, total, protection, setProtection } = useCart();
  const id = useId();
  return (
    <section aria-labelledby={`${id}-h`} className="space-y-4 rounded-2xl border border-neutral-200 p-5">
      <h2 id={`${id}-h`} className="text-lg font-semibold">
        Order summary
      </h2>
      <label htmlFor={`${id}-p`} className="flex cursor-pointer items-start gap-3 text-sm">
        <input
          id={`${id}-p`}
          type="checkbox"
          checked={protection}
          onChange={(e) => setProtection(e.target.checked)}
          className="mt-0.5 h-4 w-4 accent-neutral-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-900"
        />
        <span>
          Add shipping protection{" "}
          <span className="font-medium">({money(SHIPPING_PROTECTION_PRICE)})</span>
          <span className="block text-neutral-500">Placeholder copy describing coverage.</span>
        </span>
      </label>
      <dl className="space-y-2 text-sm">
        <div className="flex justify-between">
          <dt className="text-neutral-600">Subtotal</dt>
          <dd>{money(subtotal)}</dd>
        </div>
        {protection && (
          <div className="flex justify-between">
            <dt className="text-neutral-600">Shipping protection</dt>
            <dd>{money(SHIPPING_PROTECTION_PRICE)}</dd>
          </div>
        )}
        <div className="flex justify-between border-t border-neutral-200 pt-3 text-base font-semibold">
          <dt>Total</dt>
          <dd data-testid="cart-total">{money(total)}</dd>
        </div>
      </dl>
      <a
        href="#"
        aria-disabled="true"
        title="Connect Shopify or Stripe here"
        onClick={(e) => e.preventDefault()}
        className="flex h-12 w-full cursor-not-allowed items-center justify-center rounded-full bg-neutral-900 font-medium text-white opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-900"
      >
        Checkout
      </a>
      <p className="text-center text-xs text-neutral-500">Taxes and shipping calculated at checkout.</p>
    </section>
  );
}
