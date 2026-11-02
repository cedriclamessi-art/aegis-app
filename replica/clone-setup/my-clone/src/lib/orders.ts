// Local, browser-only order store used by checkout, confirmation and tracking.
// Replace with Shopify / your backend. Orders live in localStorage under "clone-orders-v1".
import type { CartLine } from "@/types/shop";

export type OrderStatus = "processing" | "shipped" | "out_for_delivery" | "delivered";

export interface Order {
  number: string; // e.g. "#1042"
  email: string;
  createdAt: string; // ISO
  lines: CartLine[];
  protection: boolean;
  total: number;
  ship: { name: string; address: string; city: string; zip: string; country: string };
  status: OrderStatus;
  tracking?: string;
}

const KEY = "clone-orders-v1";

export function loadOrders(): Order[] {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? "[]") as Order[];
  } catch {
    return [];
  }
}

export function saveOrder(o: Order) {
  try {
    localStorage.setItem(KEY, JSON.stringify([o, ...loadOrders()]));
  } catch {}
}

export function nextOrderNumber(): string {
  return `#${1001 + loadOrders().length}`;
}

export function findOrder(number: string, email: string): Order | undefined {
  const n = number.trim().replace(/^#?/, "#");
  return loadOrders().find((o) => o.number === n && o.email.toLowerCase() === email.trim().toLowerCase());
}

export const STATUS_STEPS: { key: OrderStatus; label: string }[] = [
  { key: "processing", label: "Order received" },
  { key: "shipped", label: "Shipped" },
  { key: "out_for_delivery", label: "Out for delivery" },
  { key: "delivered", label: "Delivered" },
];
