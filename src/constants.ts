/** Shared identifiers and limits. Pure module: no EmDash or Astro imports. */

export const PLUGIN_ID = "avdeb-products";
export const VERSION = "0.1.0";

export const API_HOST = "api.avdeb.com";
export const API_BASE = `https://${API_HOST}/v1/catalog`;
export const SITE_ORIGIN = "https://avdeb.com";
export const DOCS_URL = "https://avdeb.com/developers/#emdash";
export const PARTNER_DASHBOARD_URL = "https://avdeb.com/affiliate/dashboard/developers/";
export const AFFILIATE_URL = "https://avdeb.com/affiliate/";

/** Secret keys are issued as `avdeb_sk_` + 32 letters/digits (partner dashboard → Embeds & API). */
export const SECRET_KEY_RE = /^avdeb_sk_[A-Za-z0-9]{32}$/;
export const PUBLISHABLE_KEY_PREFIX = "avdeb_pk_";

/** Catalog API tier limits (api.avdeb.com docs/catalog.md). */
export const MAX_LIMIT_ANONYMOUS = 12;
export const MAX_LIMIT_SECRET = 48;
export const DEFAULT_LIMIT = 6;

export const BLOCK_TYPES = {
	products: "avdeb-products",
	product: "avdeb-product",
	button: "avdeb-button",
} as const;

export const LAYOUTS = ["grid", "carousel", "list", "spotlight"] as const;
export type Layout = (typeof LAYOUTS)[number];

export const CARD_STYLES = ["elevated", "outline", "minimal"] as const;
export type CardStyle = (typeof CARD_STYLES)[number];

export const THEMES = ["inherit", "light", "dark", "auto"] as const;
export type Theme = (typeof THEMES)[number];

export const IMAGE_RATIOS = ["square", "portrait", "landscape"] as const;
export type ImageRatio = (typeof IMAGE_RATIOS)[number];

export const PRODUCT_VARIANTS = ["card", "horizontal", "hero"] as const;
export type ProductVariant = (typeof PRODUCT_VARIANTS)[number];

export const BUTTON_VARIANTS = ["solid", "outline", "link"] as const;
export type ButtonVariant = (typeof BUTTON_VARIANTS)[number];

export const ALIGNMENTS = ["start", "center", "end"] as const;
export type Alignment = (typeof ALIGNMENTS)[number];

export function oneOf<T extends string>(value: unknown, allowed: readonly T[]): T | undefined {
	return typeof value === "string" && (allowed as readonly string[]).includes(value)
		? (value as T)
		: undefined;
}
