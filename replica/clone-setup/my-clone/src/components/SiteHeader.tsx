"use client";

import Link from "next/link";
import { ShoppingBag } from "lucide-react";
import { useCart } from "./CartProvider";

export function SiteHeader() {
  const { count } = useCart();
  return (
    <header className="sticky top-0 z-30 border-b bg-white/90 backdrop-blur">
      <div className="bg-neutral-900 py-1.5 text-center text-xs text-white">
        Free shipping over $70 · 90-day guarantee
      </div>
      <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-4">
        <Link href="/" className="text-lg font-semibold tracking-tight">
          BRAND
        </Link>
        <Link href="/cart" className="relative p-2" aria-label="Cart">
          <ShoppingBag className="size-5" />
          {count > 0 && (
            <span
              data-testid="cart-count"
              className="absolute -right-1 -top-1 flex size-5 items-center justify-center rounded-full bg-neutral-900 text-[11px] text-white"
            >
              {count}
            </span>
          )}
        </Link>
      </div>
    </header>
  );
}
