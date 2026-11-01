// Wallet (Robux history) and private-server management types + pure helpers.
// Shapes mirror src-tauri/src/economy.rs (camelCase).

export type TxKind =
  | "Purchase"
  | "Sale"
  | "CurrencyPurchase"
  | "PremiumStipend"
  | "TradeRobux"
  | "EngagementPayout"
  | "AffiliateSale"
  | "PendingRobux";

export const TX_TABS: { id: TxKind; label: string; hint: string }[] = [
  { id: "Purchase", label: "Purchases", hint: "Robux you spent on items, passes and products." },
  { id: "Sale", label: "Sales", hint: "Robux you earned from sales of things you made." },
  { id: "CurrencyPurchase", label: "Robux bought", hint: "Robux you bought with money." },
  { id: "PremiumStipend", label: "Premium", hint: "Monthly Robux from a Roblox Premium membership." },
  { id: "TradeRobux", label: "Trades", hint: "Robux moved by trades." },
  { id: "EngagementPayout", label: "Engagement", hint: "Payouts from experience engagement." },
  { id: "AffiliateSale", label: "Affiliate", hint: "Robux earned through affiliate sales." },
  { id: "PendingRobux", label: "Pending", hint: "Robux that has not been released to your balance yet." },
];

export interface Transaction {
  id: number;
  created: string;
  /** Signed by direction: negative = spent, positive = received. */
  amount: number;
  currency: string;
  isPending: boolean;
  name?: string | null;
  itemType?: string | null;
  place?: string | null;
  agent?: string | null;
  agentKind?: string | null;
}

export interface PageTotals {
  count: number;
  income: number;
  spent: number;
  net: number;
  pendingCount: number;
  pending: number;
}

export interface TransactionPage {
  kind: TxKind;
  items: Transaction[];
  nextCursor?: string | null;
  totals: PageTotals;
}

export interface ServerSettings {
  universeId: number;
  available: boolean;
  /** Robux per month; 0 = free. */
  price: number;
  hasDiscounts: boolean;
}

export interface OwnedServer {
  id?: number | null;
  name: string;
  active: boolean;
  universeId: number;
  placeId: number;
  ownerId?: number | null;
  ownerName?: string | null;
}

export interface ServerSubscription {
  active: boolean;
  expired: boolean;
  expirationDate?: string | null;
  price?: number | null;
  canRenew: boolean;
  hasInsufficientFunds: boolean;
  hasPriceChanged: boolean;
  hasRecurringProfile: boolean;
}

export interface ServerDetail {
  id: number;
  name: string;
  active: boolean;
  gameName?: string | null;
  universeId?: number | null;
  placeId?: number | null;
  /** Launchable roblox.com/share?code=…&type=Server link, when Roblox returned one. */
  shareLink?: string | null;
  /** Roblox returned a legacy-format link that Muffin can't launch. */
  linkIsLegacy: boolean;
  subscription?: ServerSubscription | null;
}

export interface PurchaseResult {
  serverId: number;
  name: string;
  price: number;
}

export const SERVER_NAME_MAX = 50;

export function formatRobux(n: number): string {
  return n.toLocaleString("en-US");
}

/** "+1,200" / "−35" (true minus sign); 0 renders as "0". */
export function signedRobux(n: number): string {
  if (n === 0) return "0";
  return `${n > 0 ? "+" : "−"}${formatRobux(Math.abs(n))}`;
}

/** Locale date+time for an ISO timestamp; falls back to the raw string when unparsable. */
export function formatWhen(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso || "Unknown date";
  return d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

/** Whole days until `iso` (negative when past); null when unparsable. */
export function daysUntil(iso: string | null | undefined, now = Date.now()): number | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return null;
  return Math.ceil((t - now) / 86_400_000);
}
