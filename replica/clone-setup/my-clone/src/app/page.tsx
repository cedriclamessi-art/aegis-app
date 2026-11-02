import { products, getProduct } from "@/data/products";
import { Hero } from "@/components/home/Hero";
import { TrustBadges } from "@/components/home/TrustBadges";
import { ProductGrid } from "@/components/home/ProductGrid";
import { Benefits } from "@/components/home/Benefits";
import { Faq } from "@/components/home/Faq";
import { ClosingCta } from "@/components/home/ClosingCta";

export default function Home() {
  const main = getProduct("main-product") ?? products[0];
  return (
    <main>
      <Hero product={main} />
      <TrustBadges />
      <ProductGrid products={products} />
      <Benefits />
      <Faq />
      <ClosingCta href={`/product/${main.handle}`} />
    </main>
  );
}
