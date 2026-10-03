/**
 * Plugin settings: the schema EmDash renders as the settings form, and a validating reader.
 * Pure module.
 */

import type { SettingField } from "emdash";

import { cleanRef, usableKey } from "./catalog.ts";
import {
	CARD_STYLES,
	IMAGE_RATIOS,
	LAYOUTS,
	oneOf,
	THEMES,
	type CardStyle,
	type ImageRatio,
	type Layout,
	type Theme,
} from "./constants.ts";

const DEFAULT_DISCLOSURE =
	"As an AVDEB affiliate, I earn a commission from qualifying purchases.";

/**
 * `admin.settingsSchema` — EmDash generates the settings screen from this. `apiKey` is a `secret`
 * field: write-only in the admin and encrypted at rest (needs EMDASH_ENCRYPTION_KEY).
 */
export const settingsSchema = {
	apiKey: {
		type: "secret",
		label: "AVDEB secret key",
		description:
			"Optional. avdeb_sk_… from Partner dashboard → Embeds & API. Adds your referral code automatically and allows up to 48 products per embed.",
	},
	refCode: {
		type: "string",
		label: "Referral code",
		description:
			"Only used without a secret key: added as ?ref= to every AVDEB link. Leave empty for plain links.",
		default: "",
	},
	layout: {
		type: "select",
		label: "Default layout",
		options: [
			{ value: "grid", label: "Grid" },
			{ value: "carousel", label: "Carousel" },
			{ value: "list", label: "List" },
			{ value: "spotlight", label: "Spotlight (first product featured)" },
		],
		default: "grid",
	},
	columns: { type: "number", label: "Default columns", min: 1, max: 6, default: 3 },
	cardStyle: {
		type: "select",
		label: "Card style",
		options: [
			{ value: "elevated", label: "Elevated (soft shadow)" },
			{ value: "outline", label: "Outline" },
			{ value: "minimal", label: "Minimal" },
		],
		default: "elevated",
	},
	theme: {
		type: "select",
		label: "Colour theme",
		description: "Inherit uses your site's text colour and transparent cards.",
		options: [
			{ value: "inherit", label: "Inherit from site" },
			{ value: "light", label: "Light" },
			{ value: "dark", label: "Dark" },
			{ value: "auto", label: "Follow visitor's system setting" },
		],
		default: "inherit",
	},
	accentColor: {
		type: "string",
		label: "Accent colour",
		description: "Hex colour for prices, badges and buttons, e.g. #4d7f5a. Empty = AVDEB green.",
		default: "",
	},
	radius: { type: "number", label: "Corner radius (px)", min: 0, max: 32, default: 16 },
	imageRatio: {
		type: "select",
		label: "Image shape",
		options: [
			{ value: "square", label: "Square (1:1)" },
			{ value: "portrait", label: "Portrait (4:5)" },
			{ value: "landscape", label: "Landscape (4:3)" },
		],
		default: "square",
	},
	ctaLabel: { type: "string", label: "Button text", default: "View product" },
	showPrice: { type: "boolean", label: "Show prices", default: true },
	showCreator: { type: "boolean", label: "Show designer name", default: true },
	showBadges: { type: "boolean", label: "Show Sale / New badges", default: true },
	newTab: { type: "boolean", label: "Open product links in a new tab", default: false },
	showDisclosure: {
		type: "boolean",
		label: "Affiliate disclosure",
		description:
			"Show the note below under embeds when links carry a referral code (e.g. required by the US FTC).",
		default: true,
	},
	disclosureText: { type: "string", label: "Disclosure text", default: DEFAULT_DISCLOSURE },
	cacheMinutes: {
		type: "number",
		label: "Refresh products every (minutes)",
		description: "Products are cached on your site; the last good copy is kept for a week if AVDEB is unreachable.",
		min: 5,
		max: 2880,
		default: 360,
	},
} satisfies Record<string, SettingField>;

export type SettingKey = keyof typeof settingsSchema;

/** Presentation settings — safe to send to the page (no credentials). */
export interface DisplaySettings {
	layout: Layout;
	columns: number;
	cardStyle: CardStyle;
	theme: Theme;
	accentColor: string;
	radius: number;
	imageRatio: ImageRatio;
	ctaLabel: string;
	showPrice: boolean;
	showCreator: boolean;
	showBadges: boolean;
	newTab: boolean;
	showDisclosure: boolean;
	disclosureText: string;
}

export interface ResolvedSettings extends DisplaySettings {
	/** Usable secret key or "". */
	apiKey: string;
	/** What was saved in the key field (may be malformed) — only for diagnostics, never rendered. */
	rawApiKey: string;
	refCode: string;
	cacheMinutes: number;
}

export const DEFAULT_DISPLAY: DisplaySettings = {
	layout: "grid",
	columns: 3,
	cardStyle: "elevated",
	theme: "inherit",
	accentColor: "",
	radius: 16,
	imageRatio: "square",
	ctaLabel: "View product",
	showPrice: true,
	showCreator: true,
	showBadges: true,
	newTab: false,
	showDisclosure: true,
	disclosureText: DEFAULT_DISCLOSURE,
};

const HEX_RE = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;

/** A hex colour or "" — the value is placed in a style attribute, so nothing else is accepted. */
export function safeColor(value: unknown): string {
	const v = typeof value === "string" ? value.trim() : "";
	return HEX_RE.test(v) ? v.toLowerCase() : "";
}

function int(value: unknown, min: number, max: number, fallback: number): number {
	const n = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
	return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : fallback;
}

function bool(value: unknown, fallback: boolean): boolean {
	if (typeof value === "boolean") return value;
	if (value === "true" || value === 1) return true;
	if (value === "false" || value === 0) return false;
	return fallback;
}

function text(value: unknown, max: number, fallback: string): string {
	const v = typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, max) : "";
	return v || fallback;
}

/** Read every setting through `get` (e.g. `ctx.settings.get`) and validate it. */
export async function readSettings(
	get: (key: SettingKey) => Promise<unknown>,
): Promise<ResolvedSettings> {
	const keys = Object.keys(settingsSchema) as SettingKey[];
	const values = await Promise.all(keys.map((k) => get(k).catch(() => null)));
	const s = Object.fromEntries(keys.map((k, i) => [k, values[i]])) as Record<SettingKey, unknown>;
	const rawApiKey = typeof s.apiKey === "string" ? s.apiKey.trim() : "";
	return {
		...parseDisplay(s),
		apiKey: usableKey(rawApiKey),
		rawApiKey,
		refCode: cleanRef(s.refCode),
		cacheMinutes: int(s.cacheMinutes, 5, 2880, 360),
	};
}

export function displayOf(s: ResolvedSettings): DisplaySettings {
	return {
		layout: s.layout,
		columns: s.columns,
		cardStyle: s.cardStyle,
		theme: s.theme,
		accentColor: s.accentColor,
		radius: s.radius,
		imageRatio: s.imageRatio,
		ctaLabel: s.ctaLabel,
		showPrice: s.showPrice,
		showCreator: s.showCreator,
		showBadges: s.showBadges,
		newTab: s.newTab,
		showDisclosure: s.showDisclosure,
		disclosureText: s.disclosureText,
	};
}

/** Validate display settings (stored settings, or a route payload that crossed into Astro). */
export function parseDisplay(value: unknown): DisplaySettings {
	const v = typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
	const d = DEFAULT_DISPLAY;
	return {
		layout: oneOf(v.layout, LAYOUTS) ?? d.layout,
		columns: int(v.columns, 1, 6, d.columns),
		cardStyle: oneOf(v.cardStyle, CARD_STYLES) ?? d.cardStyle,
		theme: oneOf(v.theme, THEMES) ?? d.theme,
		accentColor: safeColor(v.accentColor),
		radius: int(v.radius, 0, 32, d.radius),
		imageRatio: oneOf(v.imageRatio, IMAGE_RATIOS) ?? d.imageRatio,
		ctaLabel: text(v.ctaLabel, 40, d.ctaLabel),
		showPrice: bool(v.showPrice, d.showPrice),
		showCreator: bool(v.showCreator, d.showCreator),
		showBadges: bool(v.showBadges, d.showBadges),
		newTab: bool(v.newTab, d.newTab),
		showDisclosure: bool(v.showDisclosure, d.showDisclosure),
		disclosureText: text(v.disclosureText, 300, d.disclosureText),
	};
}
