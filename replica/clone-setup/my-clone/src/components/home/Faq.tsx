const faqs = [
  { q: "How do I use it?", a: "Placeholder answer. Explain the recommended daily usage here." },
  { q: "How long does shipping take?", a: "Placeholder answer. Orders over $70 ship free." },
  { q: "What is the guarantee?", a: "Placeholder answer. Describe the 90-day guarantee and how to request a refund." },
  { q: "Is checkout secure?", a: "Placeholder answer. Payments are encrypted and processed securely." },
];

export function Faq() {
  return (
    <section aria-labelledby="faq-heading" className="mx-auto max-w-3xl px-4 py-14">
      <h2 id="faq-heading" className="text-2xl font-semibold tracking-tight">
        Frequently asked questions
      </h2>
      <div className="mt-6 divide-y rounded-2xl border">
        {faqs.map(({ q, a }) => (
          <details key={q} className="group p-4">
            <summary className="cursor-pointer list-none font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-900">
              {q}
            </summary>
            <p className="mt-2 text-sm text-neutral-600">{a}</p>
          </details>
        ))}
      </div>
    </section>
  );
}
