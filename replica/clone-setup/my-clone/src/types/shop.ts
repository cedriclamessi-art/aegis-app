export interface Bundle {
  id: string;
  label: string; // e.g. "1 bottle"
  bottles: number;
  price: number; // total price in USD
  compareAt?: number;
  badge?: string;
}

export interface Product {
  handle: string;
  title: string;
  tagline: string;
  description: string;
  rating: number;
  reviewCount: number;
  bundles: Bundle[];
  accent: string; // placeholder gradient colours, replaced by real photos later
}

export interface CartLine {
  handle: string;
  bundleId: string;
  qty: number;
}
