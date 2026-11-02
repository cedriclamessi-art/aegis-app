"use client";

import { createContext, useContext, useEffect, useMemo, useState } from "react";
import type { CartLine } from "@/types/shop";
import { getProduct, SHIPPING_PROTECTION_PRICE } from "@/data/products";

interface CartCtx {
  lines: CartLine[];
  protection: boolean;
  count: number;
  subtotal: number;
  total: number;
  add: (handle: string, bundleId: string, qty?: number) => void;
  setQty: (handle: string, bundleId: string, qty: number) => void;
  remove: (handle: string, bundleId: string) => void;
  setProtection: (v: boolean) => void;
  lineTotal: (l: CartLine) => number;
}

const Ctx = createContext<CartCtx | null>(null);
const KEY = "clone-cart-v1";

export function CartProvider({ children }: { children: React.ReactNode }) {
  const [lines, setLines] = useState<CartLine[]>([]);
  const [protection, setProtection] = useState(false);
  const [ready, setReady] = useState(false);

  // Hydrate from localStorage after mount (avoids SSR/client hydration mismatch).
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) {
        const s = JSON.parse(raw);
        setLines(s.lines ?? []);
        setProtection(!!s.protection);
      }
    } catch {}
    setReady(true);
  }, []);
  /* eslint-enable react-hooks/set-state-in-effect */

  useEffect(() => {
    if (!ready) return;
    try {
      localStorage.setItem(KEY, JSON.stringify({ lines, protection }));
    } catch {}
  }, [lines, protection, ready]);

  const value = useMemo<CartCtx>(() => {
    const lineTotal = (l: CartLine) => {
      const b = getProduct(l.handle)?.bundles.find((x) => x.id === l.bundleId);
      return (b?.price ?? 0) * l.qty;
    };
    const subtotal = lines.reduce((s, l) => s + lineTotal(l), 0);
    return {
      lines,
      protection,
      count: lines.reduce((s, l) => s + l.qty, 0),
      subtotal,
      total: subtotal + (protection && lines.length ? SHIPPING_PROTECTION_PRICE : 0),
      lineTotal,
      setProtection,
      add: (handle, bundleId, qty = 1) =>
        setLines((cur) => {
          const i = cur.findIndex((l) => l.handle === handle && l.bundleId === bundleId);
          if (i >= 0) return cur.map((l, j) => (j === i ? { ...l, qty: l.qty + qty } : l));
          return [...cur, { handle, bundleId, qty }];
        }),
      setQty: (handle, bundleId, qty) =>
        setLines((cur) =>
          cur
            .map((l) => (l.handle === handle && l.bundleId === bundleId ? { ...l, qty } : l))
            .filter((l) => l.qty > 0),
        ),
      remove: (handle, bundleId) =>
        setLines((cur) => cur.filter((l) => !(l.handle === handle && l.bundleId === bundleId))),
    };
  }, [lines, protection]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useCart() {
  const c = useContext(Ctx);
  if (!c) throw new Error("useCart must be used inside CartProvider");
  return c;
}
