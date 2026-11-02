import { Leaf, Sparkles, Timer } from "lucide-react";

const items = [
  { icon: Leaf, title: "Simple ingredients", text: "Placeholder copy about what goes in and why it matters." },
  { icon: Timer, title: "Easy daily habit", text: "Placeholder copy about a routine that takes seconds." },
  { icon: Sparkles, title: "Noticeable results", text: "Placeholder copy about what customers can expect." },
];

export function Benefits() {
  return (
    <section aria-labelledby="benefits-heading" className="bg-neutral-50">
      <div className="mx-auto max-w-6xl px-4 py-14">
        <h2 id="benefits-heading" className="text-2xl font-semibold tracking-tight">
          Why people love it
        </h2>
        <ul className="mt-6 grid gap-6 md:grid-cols-3">
          {items.map(({ icon: Icon, title, text }) => (
            <li key={title} className="rounded-2xl bg-white p-6 shadow-sm">
              <Icon className="size-6 text-neutral-900" aria-hidden="true" />
              <h3 className="mt-3 font-semibold">{title}</h3>
              <p className="mt-1 text-sm text-neutral-600">{text}</p>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
