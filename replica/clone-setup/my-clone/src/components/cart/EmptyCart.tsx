import Link from "next/link";
import { ShoppingBag } from "lucide-react";

export function EmptyCart() {
  return (
    <div className="flex flex-col items-center gap-4 py-20 text-center">
      <ShoppingBag className="h-10 w-10 text-neutral-400" aria-hidden />
      <h2 className="text-xl font-semibold">Your cart is empty</h2>
      <p className="text-neutral-500">Add something to get started.</p>
      <Link
        href="/"
        className="rounded-full bg-neutral-900 px-6 py-3 font-medium text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-900"
      >
        Continue shopping
      </Link>
    </div>
  );
}
