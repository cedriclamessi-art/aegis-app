import { FREE_SHIPPING_THRESHOLD } from "@/data/products";
import { money } from "./format";

export function FreeShippingBar({ subtotal }: { subtotal: number }) {
  const remaining = Math.max(0, FREE_SHIPPING_THRESHOLD - subtotal);
  const pct = Math.min(100, Math.round((subtotal / FREE_SHIPPING_THRESHOLD) * 100));
  return (
    <div className="rounded-2xl bg-neutral-50 p-4">
      <p className="text-sm font-medium text-neutral-900">
        {remaining > 0
          ? `You are ${money(remaining)} away from free shipping`
          : "You have unlocked free shipping"}
      </p>
      <div
        role="progressbar"
        aria-label="Progress toward free shipping"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={pct}
        className="mt-2 h-2 overflow-hidden rounded-full bg-neutral-200"
      >
        <div className="h-full rounded-full bg-emerald-500 transition-all" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}
