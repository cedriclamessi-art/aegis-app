import Link from "next/link";

export function ClosingCta({ href }: { href: string }) {
  return (
    <section className="bg-neutral-900 text-white">
      <div className="mx-auto max-w-3xl px-4 py-16 text-center">
        <h2 className="text-3xl font-semibold tracking-tight">Ready to feel the difference?</h2>
        <p className="mt-3 text-neutral-300">Try it risk-free with our 90-day guarantee.</p>
        <Link
          href={href}
          className="mt-8 inline-flex h-12 items-center justify-center rounded-full bg-white px-8 font-medium text-neutral-900 transition hover:bg-neutral-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
        >
          Get started
        </Link>
      </div>
    </section>
  );
}
