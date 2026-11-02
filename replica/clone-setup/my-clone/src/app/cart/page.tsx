"use client";

import { useCart } from "@/components/CartProvider";
import { CartLineItem } from "@/components/cart/CartLineItem";
import { CartSummary } from "@/components/cart/CartSummary";
import { EmptyCart } from "@/components/cart/EmptyCart";
import { FreeShippingBar } from "@/components/cart/FreeShippingBar";

export default function CartPage() {
  const { lines, subtotal } = useCart();
  return (
    <main className="mx-auto w-full max-w-5xl px-4 py-8 sm:py-12">
      <h1 className="mb-6 text-2xl font-semibold sm:text-3xl">Your cart</h1>
      {lines.length === 0 ? (
        <EmptyCart />
      ) : (
        <div className="grid gap-8 lg:grid-cols-[1fr_22rem]">
          <div className="space-y-4">
            <FreeShippingBar subtotal={subtotal} />
            <ul className="divide-y divide-neutral-200">
              {lines.map((l) => (
                <CartLineItem key={`${l.handle}:${l.bundleId}`} line={l} />
              ))}
            </ul>
          </div>
          <div className="lg:sticky lg:top-24 lg:self-start">
            <CartSummary />
          </div>
        </div>
      )}
    </main>
  );
}
