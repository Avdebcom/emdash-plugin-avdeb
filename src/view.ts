/**
 * Turns catalog products + display settings into ready-to-render view models.
 * Pure module: Astro templates only print these values.
 */

import { avdebLink, hasRef, isAvdebUrl, type CatalogQuery, type Product } from "./catalog.ts";
import {
	CARD_STYLES,
	LAYOUTS,
	oneOf,
	THEMES,
	type CardStyle,
	type ImageRatio,
	type Layout,
	type Theme,
} from "./constants.ts";
import type { DisplaySettings } from "./settings.ts";

/** Per-embed overrides (block fields or component props). Undefined = use the site setting. */
export interface DisplayOverrides {
	layout?: unknown;
	columns?: unknown;
	cardStyle?: unknown;
	theme?: unknown;
	ctaLabel?: unknown;
	hidePrice?: unknown;
	hideCreator?: unknown;
}

export interface ResolvedDisplay extends DisplaySettings {
	layout: Layout;
	cardStyle: CardStyle;
	theme: Theme;
}

export interface CardView {
	key: string;
	href: string;
	rel: string;
	target: "_blank" | undefined;
	title: string;
	image: string | null;
	width: number;
	height: number;
	price: string | null;
	compareAt: string | null;
	discount: number | null;
	isNew: boolean;
	creator: string | null;
}

const RATIO_SIZE: Record<ImageRatio, [number, number]> = {
	square: [600, 600],
	portrait: [600, 750],
	landscape: [600, 450],
};

export const RATIO_CSS: Record<ImageRatio, string> = {
	square: "1 / 1",
	portrait: "4 / 5",
	landscape: "4 / 3",
};

const NEW_DAYS = 14;

export function resolveDisplay(base: DisplaySettings, o: DisplayOverrides = {}): ResolvedDisplay {
	const columns = Math.trunc(Number(o.columns));
	const cta = typeof o.ctaLabel === "string" ? o.ctaLabel.trim().slice(0, 40) : "";
	return {
		...base,
		layout: oneOf(o.layout, LAYOUTS) ?? base.layout,
		cardStyle: oneOf(o.cardStyle, CARD_STYLES) ?? base.cardStyle,
		theme: oneOf(o.theme, THEMES) ?? base.theme,
		columns: Number.isFinite(columns) && columns >= 1 ? Math.min(6, columns) : base.columns,
		ctaLabel: cta || base.ctaLabel,
		showPrice: o.hidePrice === true ? false : base.showPrice,
		showCreator: o.hideCreator === true ? false : base.showCreator,
	};
}

export function formatPrice(amount: number | null, currency: string, locale = "en-US"): string | null {
	if (amount === null) return null;
	try {
		return new Intl.NumberFormat(locale, { style: "currency", currency }).format(amount);
	} catch {
		return `${amount.toFixed(2)} ${currency}`;
	}
}

/** Whole-number discount (e.g. 25 for 25 % off), or null when there's no real markdown. */
export function discountPercent(price: number | null, compareAt: number | null): number | null {
	if (price === null || compareAt === null || compareAt <= price || compareAt <= 0) return null;
	const pct = Math.round((1 - price / compareAt) * 100);
	return pct >= 1 && pct < 100 ? pct : null;
}

export function isNew(createdAt: string | null, now: number, days = NEW_DAYS): boolean {
	if (!createdAt) return false;
	const t = Date.parse(createdAt);
	return Number.isFinite(t) && t <= now && now - t < days * 86_400_000;
}

/** Referral links are paid links: `sponsored` (Google) — plus `noopener` for new tabs. */
export function relFor(url: string): string {
	return hasRef(url) ? "sponsored noopener" : "noopener";
}

export function buildCards(
	products: Product[],
	display: DisplaySettings,
	{ locale = "en-US", now = Date.now() }: { locale?: string; now?: number } = {},
): CardView[] {
	const [width, height] = RATIO_SIZE[display.imageRatio];
	const cards: CardView[] = [];
	for (const p of products) {
		if (!isAvdebUrl(p.url)) continue;
		const hasSale = display.showPrice && p.compareAtPrice !== null && p.price !== null && p.compareAtPrice > p.price;
		cards.push({
			key: p.handle,
			href: p.url,
			rel: relFor(p.url),
			target: display.newTab ? "_blank" : undefined,
			title: p.title,
			image: p.image,
			width,
			height,
			price: display.showPrice ? formatPrice(p.price, p.currency, locale) : null,
			compareAt: hasSale ? formatPrice(p.compareAtPrice, p.currency, locale) : null,
			discount: display.showBadges && display.showPrice ? discountPercent(p.price, p.compareAtPrice) : null,
			isNew: display.showBadges && isNew(p.createdAt, now),
			creator: display.showCreator && p.creator ? p.creator.name : null,
		});
	}
	return cards;
}

/** "View all" target for a creator or category embed (with the referral code), else null. */
export function viewAllHref(query: CatalogQuery, products: Product[], ref: string): string | null {
	if (query.handle || query.q || query.type) return null;
	if (query.creator && !query.tag) {
		const fromApi = products.find((p) => p.creator?.slug === query.creator)?.creator?.url;
		return fromApi ?? (avdebLink(`/creators/${query.creator}/`, ref) || null);
	}
	if (query.tag && !query.creator) return avdebLink(`/category/${query.tag}/`, ref) || null;
	return null;
}

export function disclosureFor(display: DisplaySettings, ref: string): string | null {
	return ref && display.showDisclosure && display.disclosureText ? display.disclosureText : null;
}

/** Inline CSS custom properties for an embed root. Values are validated numbers/hex only. */
export function rootStyle(display: DisplaySettings, columns: number): string {
	const parts = [
		`--avdeb-cols:${Math.min(6, Math.max(1, Math.trunc(columns)))}`,
		`--avdeb-radius:${display.radius}px`,
		`--avdeb-ratio:${RATIO_CSS[display.imageRatio]}`,
	];
	if (display.accentColor) parts.push(`--avdeb-accent:${display.accentColor}`);
	return parts.join(";");
}

/** Columns actually used: never more than there are products (a lone card shouldn't be 1/3 wide). */
export function effectiveColumns(display: ResolvedDisplay, count: number): number {
	if (display.layout === "list") return 1;
	return Math.max(1, Math.min(display.columns, count || 1));
}
