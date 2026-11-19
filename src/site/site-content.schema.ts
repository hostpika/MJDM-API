import { z } from "zod";

/** https URL or a same-site path. Never javascript:, data: or protocol-relative URLs. */
const link = z
  .string()
  .max(500)
  .refine((v) => v === "" || /^https:\/\/[^\s]+$/i.test(v) || /^\/(?!\/)[^\s]*$/.test(v), {
    message: "must be an https:// URL or a path starting with /",
  });
const text = (max = 300) => z.string().max(max);
const bilingual = z.object({ en: text(), bn: text() });
const sizeMb = z.number().min(0).max(5000);

const pageSeo = z.object({ title: text(120), description: text(320) });

/** Search-engine and analytics settings. Every ID is format-checked so it can never carry markup. */
export const seoSchema = z.object({
  titleSuffix: text(60),
  description: text(320),
  keywords: text(500),
  ogImage: link,
  twitterHandle: z.string().regex(/^(@[A-Za-z0-9_]{1,15})?$/, "like @mjdm or empty"),
  googleVerification: z.string().regex(/^[A-Za-z0-9_-]{0,120}$/, "only the content value, letters/digits/-/_"),
  bingVerification: z.string().regex(/^[A-Za-z0-9_-]{0,120}$/, "only the content value, letters/digits/-/_"),
  ga4Id: z.string().regex(/^(G-[A-Z0-9]{4,14})?$/, "like G-XXXXXXXXXX or empty"),
  gtmId: z.string().regex(/^(GTM-[A-Z0-9]{4,10})?$/, "like GTM-XXXXXXX or empty"),
  metaPixelId: z.string().regex(/^(\d{5,20})?$/, "digits only or empty"),
  /** Per-page title/description, keyed by path ("/", "/docs", "/privacy", "/terms"). */
  pages: z
    .record(z.string().regex(/^\/([a-z0-9-]+(\/[a-z0-9-]+)*)?$/), pageSeo)
    .refine((r) => Object.keys(r).length <= 30, { message: "too many pages" }),
});

export const DEFAULT_SEO: z.infer<typeof seoSchema> = {
  titleSuffix: "",
  description: "",
  keywords: "",
  ogImage: "",
  twitterHandle: "",
  googleVerification: "",
  bingVerification: "",
  ga4Id: "",
  gtmId: "",
  metaPixelId: "",
  pages: {},
};

export const siteContentSchema = z.object({
  announcement: z.object({
    enabled: z.boolean(),
    text: bilingual,
    href: link,
  }),
  release: z.object({
    version: z.string().regex(/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/, "semantic version, e.g. 1.0.0"),
    channel: z.enum(["stable", "beta"]),
    notesUrl: link,
    windows: z.object({
      installerUrl: link,
      installerSizeMb: sizeMb,
      portableUrl: link,
      portableSizeMb: sizeMb,
      sha256: z.string().regex(/^([0-9a-fA-F]{64})?$/, "64 hex characters or empty"),
    }),
    linux: z.object({
      appImageUrl: link,
      appImageSizeMb: sizeMb,
      debUrl: link,
      rpmUrl: link,
      sha256: z.string().regex(/^([0-9a-fA-F]{64})?$/, "64 hex characters or empty"),
    }),
  }),
  extensions: z.object({ chromeUrl: link, firefoxUrl: link, edgeUrl: link }),
  pricing: z.object({
    trialDays: z.number().int().min(0).max(365),
    lifetime: z.object({ usd: z.number().min(0).max(100000), bdt: z.number().min(0).max(10000000) }),
    annual: z.object({ usd: z.number().min(0).max(100000), bdt: z.number().min(0).max(10000000) }),
    buyUrl: link,
  }),
  /** Per-language text overrides, keyed by the dotted path of the website string (e.g. "hero.titleLine1"). */
  overrides: z.object({
    en: z.record(z.string().max(100), z.string().max(2000)),
    bn: z.record(z.string().max(100), z.string().max(2000)),
  }),
  /** Optional in stored documents written before SEO existed. */
  seo: seoSchema.default(DEFAULT_SEO),
});

export type SiteContent = z.infer<typeof siteContentSchema>;

export const DEFAULT_SITE_CONTENT: SiteContent = {
  announcement: { enabled: false, text: { en: "", bn: "" }, href: "" },
  release: {
    version: "1.0.0",
    channel: "stable",
    notesUrl: "",
    windows: {
      installerUrl: "",
      installerSizeMb: 0,
      portableUrl: "",
      portableSizeMb: 0,
      sha256: "",
    },
    linux: { appImageUrl: "", appImageSizeMb: 0, debUrl: "", rpmUrl: "", sha256: "" },
  },
  extensions: { chromeUrl: "", firefoxUrl: "", edgeUrl: "" },
  pricing: {
    trialDays: 30,
    lifetime: { usd: 24.95, bdt: 999 },
    annual: { usd: 11.95, bdt: 499 },
    buyUrl: "",
  },
  overrides: { en: {}, bn: {} },
  seo: DEFAULT_SEO,
};
