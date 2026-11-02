// Every image slot of the site. Replace the files in public/images (same names) or edit paths here.
export const IMG = {
  logo: "/images/logo.svg",
  hero: "/images/hero.svg",
  lifestyle: ["/images/lifestyle-1.svg", "/images/lifestyle-2.svg", "/images/lifestyle-3.svg"],
  about: ["/images/about-1.svg", "/images/about-2.svg"],
  avatars: [1, 2, 3, 4, 5, 6].map((n) => `/images/avatar-${n}.svg`),
  og: "/seo/og.svg",
  favicon: "/seo/favicon.svg",
} as const;

// Gallery per product handle (Spanish variant reuses the main gallery).
export const GALLERY: Record<string, string[]> = {
  "main-product": [1, 2, 3, 4].map((n) => `/images/product-main-${n}.svg`),
  "main-product-es": [1, 2, 3, 4].map((n) => `/images/product-main-${n}.svg`),
  accessory: [1, 2, 3].map((n) => `/images/product-accessory-${n}.svg`),
};

export const galleryFor = (handle: string) => GALLERY[handle] ?? [];
export const coverFor = (handle: string) => galleryFor(handle)[0] ?? IMG.hero;
