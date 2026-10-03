/**
 * Portable Text block types (editor slash menu → Block Kit modal) and the mapping from a saved
 * block node to a catalog request. Pure module.
 */

import type { PortableTextBlockConfig } from "emdash";

import { cleanSearch, cleanSlug, cleanType, parseAvdebLink } from "./catalog.ts";
import {
	ALIGNMENTS,
	BLOCK_TYPES,
	BUTTON_VARIANTS,
	oneOf,
	PRODUCT_VARIANTS,
	type Alignment,
	type ButtonVariant,
	type ProductVariant,
} from "./constants.ts";
import type { DisplayOverrides } from "./view.ts";

const DEFAULT = { label: "Site default", value: "default" };

const layoutOptions = [
	DEFAULT,
	{ label: "Grid", value: "grid" },
	{ label: "Carousel", value: "carousel" },
	{ label: "List (shop the post)", value: "list" },
	{ label: "Spotlight (first product featured)", value: "spotlight" },
];
const styleOptions = [
	DEFAULT,
	{ label: "Elevated", value: "elevated" },
	{ label: "Outline", value: "outline" },
	{ label: "Minimal", value: "minimal" },
];
const themeOptions = [
	DEFAULT,
	{ label: "Inherit from site", value: "inherit" },
	{ label: "Light", value: "light" },
	{ label: "Dark", value: "dark" },
	{ label: "Follow system", value: "auto" },
];

export const portableTextBlocks: PortableTextBlockConfig[] = [
	{
		type: BLOCK_TYPES.products,
		label: "AVDEB Products",
		icon: "link-external",
		category: "Marketing",
		description: "A grid, carousel or list of AVDEB products with your referral link",
		fields: [
			{
				type: "text_input",
				action_id: "id",
				label: "AVDEB link or search",
				placeholder: "https://avdeb.com/creators/your-slug/ · /category/stickers/ · cat stickers",
			},
			{
				type: "select",
				action_id: "source",
				label: "Show",
				options: [
					{ label: "Auto-detect from the link or text", value: "auto" },
					{ label: "A creator's products (slug)", value: "creator" },
					{ label: "A category (slug)", value: "tag" },
					{ label: "A product type (e.g. Sticker)", value: "type" },
					{ label: "Search results", value: "search" },
					{ label: "Newest products", value: "newest" },
				],
				initial_value: "auto",
			},
			{ type: "select", action_id: "layout", label: "Layout", options: layoutOptions, initial_value: "default" },
			{ type: "number_input", action_id: "limit", label: "Number of products (max 12 without a key, 48 with)", min: 1, max: 48, initial_value: 6 },
			{ type: "number_input", action_id: "columns", label: "Columns (0 = site default)", min: 0, max: 6, initial_value: 0 },
			{ type: "text_input", action_id: "heading", label: "Heading (optional)", placeholder: "Shop my favourite stickers" },
			{ type: "text_input", action_id: "intro", label: "Intro text (optional)", multiline: true },
			{ type: "toggle", action_id: "viewAll", label: "“View all” link to the creator or category page", initial_value: true },
			{ type: "select", action_id: "cardStyle", label: "Card style", options: styleOptions, initial_value: "default" },
			{ type: "select", action_id: "theme", label: "Colour theme", options: themeOptions, initial_value: "default" },
			{ type: "text_input", action_id: "ctaLabel", label: "Button text (optional)", placeholder: "View product" },
			{ type: "toggle", action_id: "hidePrice", label: "Hide prices", initial_value: false },
			{ type: "toggle", action_id: "hideCreator", label: "Hide designer names", initial_value: false },
		],
	},
	{
		type: BLOCK_TYPES.product,
		label: "AVDEB Product",
		icon: "link-external",
		category: "Marketing",
		description: "Feature one AVDEB product with your own recommendation",
		fields: [
			{
				type: "text_input",
				action_id: "id",
				label: "Product link or handle",
				placeholder: "https://avdeb.com/store/product-handle/",
			},
			{
				type: "select",
				action_id: "pick",
				label: "…or pick a recent product",
				options: [],
				optionsRoute: "options/products",
			},
			{
				type: "select",
				action_id: "variant",
				label: "Style",
				options: [
					{ label: "Horizontal card", value: "horizontal" },
					{ label: "Hero (large)", value: "hero" },
					{ label: "Compact card", value: "card" },
				],
				initial_value: "horizontal",
			},
			{ type: "text_input", action_id: "badge", label: "Badge (optional)", placeholder: "Editor's pick" },
			{ type: "text_input", action_id: "note", label: "Your note (optional)", multiline: true, placeholder: "Why you recommend it" },
			{ type: "text_input", action_id: "ctaLabel", label: "Button text (optional)", placeholder: "View product" },
			{ type: "select", action_id: "cardStyle", label: "Card style", options: styleOptions, initial_value: "default" },
			{ type: "select", action_id: "theme", label: "Colour theme", options: themeOptions, initial_value: "default" },
		],
	},
	{
		type: BLOCK_TYPES.button,
		label: "AVDEB Button",
		icon: "link",
		category: "Marketing",
		description: "A call-to-action button to any AVDEB page, with your referral code",
		fields: [
			{ type: "text_input", action_id: "id", label: "AVDEB link", placeholder: "https://avdeb.com/creators/your-slug/" },
			{ type: "text_input", action_id: "label", label: "Button text", initial_value: "Shop on AVDEB" },
			{
				type: "select",
				action_id: "variant",
				label: "Style",
				options: [
					{ label: "Solid", value: "solid" },
					{ label: "Outline", value: "outline" },
					{ label: "Text link with arrow", value: "link" },
				],
				initial_value: "solid",
			},
			{
				type: "select",
				action_id: "align",
				label: "Alignment",
				options: [
					{ label: "Start", value: "start" },
					{ label: "Center", value: "center" },
					{ label: "End", value: "end" },
				],
				initial_value: "start",
			},
		],
	},
];

type Node = Record<string, unknown>;

function s(v: unknown): string {
	return typeof v === "string" ? v.trim() : "";
}

function overridesOf(node: Node): DisplayOverrides {
	const pick = (v: unknown) => (v === "default" || v === "" ? undefined : v);
	return {
		layout: pick(node.layout),
		columns: node.columns,
		cardStyle: pick(node.cardStyle),
		theme: pick(node.theme),
		ctaLabel: node.ctaLabel,
		hidePrice: node.hidePrice,
		hideCreator: node.hideCreator,
	};
}

export interface ProductsRequest {
	/** Unsanitised query for the route (it re-validates and clamps to the tier max). */
	query: Record<string, unknown>;
	overrides: DisplayOverrides;
	heading: string;
	intro: string;
	viewAll: boolean;
}

/** `avdeb-products` node → catalog request. */
export function productsRequest(node: Node): ProductsRequest {
	const raw = s(node.id);
	const source = s(node.source) || "auto";
	const link = parseAvdebLink(raw);
	const query: Record<string, unknown> = { limit: node.limit };
	const slug = (kind: "creator" | "tag") => (link?.kind === kind ? link.value : cleanSlug(raw));

	switch (source) {
		case "creator":
			query.creator = slug("creator");
			break;
		case "tag":
			query.tag = slug("tag");
			break;
		case "type":
			query.type = cleanType(raw);
			break;
		case "search":
			query.q = cleanSearch(raw);
			break;
		case "newest":
			break;
		default:
			if (link) query[link.kind] = link.value;
			else if (raw) query.q = cleanSearch(raw);
	}
	return {
		query,
		overrides: overridesOf(node),
		heading: s(node.heading).slice(0, 120),
		intro: s(node.intro).slice(0, 400),
		viewAll: node.viewAll !== false,
	};
}

export interface ProductRequest {
	handle: string;
	variant: ProductVariant;
	badge: string;
	note: string;
	overrides: DisplayOverrides;
}

/** `avdeb-product` node → one product. A link/handle in `id` wins over the picker. */
export function productRequest(node: Node): ProductRequest {
	const raw = s(node.id);
	const link = parseAvdebLink(raw);
	const fromId = link ? (link.kind === "handle" ? link.value : "") : /[/.:]/.test(raw) ? "" : cleanSlug(raw);
	return {
		handle: fromId || cleanSlug(node.pick),
		variant: oneOf(node.variant, PRODUCT_VARIANTS) ?? "horizontal",
		badge: s(node.badge).slice(0, 40),
		note: s(node.note).slice(0, 600),
		overrides: overridesOf(node),
	};
}

export interface ButtonRequest {
	href: string;
	label: string;
	variant: ButtonVariant;
	align: Alignment;
}

export function buttonRequest(node: Node): ButtonRequest {
	return {
		href: s(node.id) || "/",
		label: s(node.label).slice(0, 80) || "Shop on AVDEB",
		variant: oneOf(node.variant, BUTTON_VARIANTS) ?? "solid",
		align: oneOf(node.align, ALIGNMENTS) ?? "start",
	};
}
