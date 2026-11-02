import Link from "next/link";

export function SiteFooter() {
  return (
    <footer className="mt-auto border-t bg-neutral-50 py-10 text-sm text-neutral-600">
      <div className="mx-auto flex max-w-6xl flex-col gap-4 px-4 sm:flex-row sm:justify-between">
        <p>© BRAND. Replace with your own legal name.</p>
        <nav className="flex gap-4">
          <Link href="/">Shop</Link>
          <Link href="/cart">Cart</Link>
        </nav>
      </div>
    </footer>
  );
}
