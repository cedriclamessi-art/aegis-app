import { Lock, ShieldCheck, Truck } from "lucide-react";
import { FREE_SHIPPING_THRESHOLD } from "@/data/products";

const badges = [
  { icon: Truck, text: `Free shipping over $${FREE_SHIPPING_THRESHOLD}` },
  { icon: ShieldCheck, text: "90-day guarantee" },
  { icon: Lock, text: "Secure checkout" },
];

export function TrustBadges() {
  return (
    <section aria-label="Our promises" className="border-y bg-white">
      <ul className="mx-auto grid max-w-6xl gap-4 px-4 py-6 sm:grid-cols-3">
        {badges.map(({ icon: Icon, text }) => (
          <li key={text} className="flex items-center justify-center gap-2 text-sm font-medium text-neutral-800">
            <Icon className="size-5" aria-hidden="true" />
            {text}
          </li>
        ))}
      </ul>
    </section>
  );
}
