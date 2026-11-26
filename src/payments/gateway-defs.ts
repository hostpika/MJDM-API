/** Which payment gateways exist, what each one needs, and how the customer pays. */
export type GatewaySlug =
  | "stripe"
  | "cryptomus"
  | "bkash"
  | "bkash_personal"
  | "binance"
  | "binance_chain";

export type Currency = "USD" | "BDT";

export interface GatewayFieldDef {
  key: string;
  label: string;
  type: "text" | "password" | "textarea" | "checkbox" | "chain-addresses";
  placeholder?: string;
  description?: string;
  /** Secrets are write-only: the API never sends them back, only whether one is set. */
  secret?: boolean;
}

export interface GatewayDef {
  slug: GatewaySlug;
  name: string;
  description: string;
  /** What the customer is charged in. bKash is always taka; the rest are dollars. */
  currency: Currency;
  /** "redirect": the customer leaves for the gateway. "manual": the customer pays, then reports the payment. */
  flow: "redirect" | "manual" | "auto-match";
  fields: GatewayFieldDef[];
}

const FEE_FIELDS = (currency: Currency): GatewayFieldDef[] => [
  {
    key: "fee",
    label: "Fee (%)",
    type: "text",
    placeholder: "0",
    description: "Percentage added to what the customer pays.",
  },
  {
    key: "feeFixed",
    label: currency === "BDT" ? "Fixed fee (৳)" : "Fixed fee ($)",
    type: "text",
    placeholder: "0",
    description: "Flat amount added on top of the percentage. Customers pay both.",
  },
];

export const CHAIN_NETWORKS: { code: string; label: string }[] = [
  { code: "BSC", label: "BNB Smart Chain (BEP20)" },
  { code: "ETH", label: "Ethereum (ERC20)" },
  { code: "TRX", label: "Tron (TRC20)" },
  { code: "MATIC", label: "Polygon" },
  { code: "ARBITRUM", label: "Arbitrum One" },
  { code: "OPTIMISM", label: "Optimism" },
  { code: "BASE", label: "Base" },
  { code: "AVAXC", label: "Avalanche C-Chain" },
  { code: "SOL", label: "Solana" },
];
export const CHAIN_COINS = ["USDT", "USDC"] as const;

export const GATEWAY_DEFS: GatewayDef[] = [
  {
    slug: "bkash_personal",
    name: "bKash (Personal number)",
    description:
      "The customer sends money to one of your personal bKash numbers and enters the TrxID. You approve it, or the SMS forwarder approves it automatically.",
    currency: "BDT",
    flow: "manual",
    fields: [
      ...FEE_FIELDS("BDT"),
      {
        key: "smsSecret",
        label: "SMS forwarder secret",
        type: "password",
        secret: true,
        description:
          "Optional. A phone app that forwards bKash SMS messages to /v1/pay/webhook/bkash-sms with this secret approves matching payments automatically.",
      },
      {
        key: "instructions",
        label: "Extra instructions",
        type: "textarea",
        description: "Shown to the customer under the number.",
      },
    ],
  },
  {
    slug: "bkash",
    name: "bKash (Merchant checkout)",
    description: "bKash tokenized checkout: the customer pays on bKash and comes back paid.",
    currency: "BDT",
    flow: "redirect",
    fields: [
      { key: "username", label: "Username", type: "text" },
      { key: "password", label: "Password", type: "password", secret: true },
      { key: "appKey", label: "App key", type: "password", secret: true },
      { key: "appSecret", label: "App secret", type: "password", secret: true },
      ...FEE_FIELDS("BDT"),
    ],
  },
  {
    slug: "stripe",
    name: "Stripe (card)",
    description: "Card payments on Stripe's hosted checkout page.",
    currency: "USD",
    flow: "redirect",
    fields: [
      { key: "secretKey", label: "Secret key", type: "password", secret: true, placeholder: "sk_live_..." },
      {
        key: "webhookSecret",
        label: "Webhook signing secret",
        type: "password",
        secret: true,
        placeholder: "whsec_...",
        description: "Stripe webhook endpoint: https://api.mjdm.us/v1/pay/webhook/stripe (event checkout.session.completed).",
      },
      ...FEE_FIELDS("USD"),
    ],
  },
  {
    slug: "cryptomus",
    name: "Cryptomus (crypto)",
    description: "Crypto invoice on Cryptomus; the customer pays any supported coin.",
    currency: "USD",
    flow: "redirect",
    fields: [
      { key: "merchantUuid", label: "Merchant ID", type: "text" },
      {
        key: "apiKey",
        label: "Payment API key",
        type: "password",
        secret: true,
        description: "Callback URL: https://api.mjdm.us/v1/pay/webhook/cryptomus",
      },
      ...FEE_FIELDS("USD"),
    ],
  },
  {
    slug: "binance",
    name: "Binance Pay (manual)",
    description:
      "The customer sends USDT to your Binance Pay ID and enters the transaction ID. You approve it, or MJDM checks Binance deposit history when an API key is set.",
    currency: "USD",
    flow: "manual",
    fields: [
      { key: "binanceName", label: "Binance account name", type: "text" },
      { key: "uid", label: "Binance Pay ID / UID", type: "text" },
      { key: "qrimage", label: "QR code image URL", type: "text", placeholder: "https://..." },
      { key: "instructions", label: "Extra instructions", type: "textarea" },
      {
        key: "apiKey",
        label: "API key (optional, read-only, for auto-verify)",
        type: "password",
        secret: true,
      },
      { key: "apiSecret", label: "API secret (optional)", type: "password", secret: true },
      {
        key: "autoApproveMaxAmount",
        label: "Auto-approve verified payments up to (USD, 0 = never)",
        type: "text",
        placeholder: "0",
      },
      ...FEE_FIELDS("USD"),
    ],
  },
  {
    slug: "binance_chain",
    name: "Crypto USDT/USDC (auto-verify)",
    description:
      "The customer sends the exact amount on-chain to your Binance deposit address. MJDM matches it in Binance deposit history; no transaction ID needed.",
    currency: "USD",
    flow: "auto-match",
    fields: [
      {
        key: "addresses",
        label: "Deposit addresses",
        type: "chain-addresses",
        description:
          "One row per coin and network you accept. Copy each address from Binance, Deposit, choosing the same coin and network.",
      },
      { key: "apiKey", label: "API key (read-only; blank = reuse the Binance Pay one)", type: "password", secret: true },
      { key: "apiSecret", label: "API secret", type: "password", secret: true },
      ...FEE_FIELDS("USD"),
    ],
  },
];

export const GATEWAY_BY_SLUG = new Map(GATEWAY_DEFS.map((g) => [g.slug, g]));

export function isGatewaySlug(s: string): s is GatewaySlug {
  return GATEWAY_BY_SLUG.has(s as GatewaySlug);
}

export interface ChainAddress {
  coin: string;
  network: string;
  address: string;
}
