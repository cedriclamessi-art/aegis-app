import type { Product } from "@/types/shop";

// Placeholder catalogue. Replace names, copy, prices and images with your own.
export const FREE_SHIPPING_THRESHOLD = 70;
export const SHIPPING_PROTECTION_PRICE = 2.99;

export const products: Product[] = [
  {
    handle: "main-product",
    title: "Main Product",
    tagline: "Daily wellness drops",
    description:
      "Placeholder description. Replace with your own product copy. Explain what it is, how to use it and what is in it.",
    rating: 4.5,
    reviewCount: 3000,
    accent: "from-rose-200 to-amber-100",
    bundles: [
      { id: "b1", label: "1 bottle", bottles: 1, price: 49 },
      { id: "b2", label: "2 bottles", bottles: 2, price: 89, compareAt: 98, badge: "Popular" },
      { id: "b3", label: "3 bottles", bottles: 3, price: 119, compareAt: 147, badge: "Best value" },
    ],
  },
  {
    handle: "accessory",
    title: "Accessory",
    tagline: "A companion item",
    description: "Placeholder description for the accessory product.",
    rating: 4.7,
    reviewCount: 420,
    accent: "from-sky-200 to-emerald-100",
    bundles: [{ id: "a1", label: "1 piece", bottles: 1, price: 19 }],
  },
];

export const getProduct = (handle: string) => products.find((p) => p.handle === handle);
