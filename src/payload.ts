/**
 * Validation of the route payload on the rendering side (defence in depth: everything printed in
 * HTML is re-checked here, even though the route already normalised it). Pure module.
 */

import { cleanRef, cleanSlug, isAvdebUrl, sanitizeQuery, type CatalogQuery, type Product } from "./catalog.ts";
import { MAX_LIMIT_SECRET } from "./constants.ts";
import { parseDisplay, type DisplaySettings } from "./settings.ts";

export interface EmbedData {
	products: Product[];
	ref: string;
	query: CatalogQuery;
	display: DisplaySettings;
}

export interface ContextData {
	ref: string;
	display: DisplaySettings;
}

function isRecord(v: unknown): v is Record<string, unknown> {
	return typeof v === "object" && v !== null && !Array.isArray(v);
}

function num(v: unknown): number | null {
	return typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : null;
}

function text(v: unknown, max: number): string {
	return typeof v === "string" ? v.trim().slice(0, max) : "";
}

export function reviveProduct(v: unknown): Product | null {
	if (!isRecord(v)) return null;
	const handle = cleanSlug(v.handle);
	const title = text(v.title, 200);
	if (!handle || !title || !isAvdebUrl(v.url)) return null;
	const image = typeof v.image === "string" && v.image.startsWith("https://") ? v.image : null;
	const currency = typeof v.currency === "string" && /^[A-Z]{3}$/.test(v.currency) ? v.currency : "USD";
	let creator: Product["creator"] = null;
	if (isRecord(v.creator) && cleanSlug(v.creator.slug)) {
		creator = {
			slug: cleanSlug(v.creator.slug),
			name: text(v.creator.name, 120) || cleanSlug(v.creator.slug),
			url: isAvdebUrl(v.creator.url) ? v.creator.url : null,
		};
	}
	const createdAt = typeof v.createdAt === "string" && !Number.isNaN(Date.parse(v.createdAt)) ? v.createdAt : null;
	return {
		handle,
		title,
		url: v.url,
		image,
		price: num(v.price),
		compareAtPrice: num(v.compareAtPrice),
		currency,
		type: text(v.type, 40) || null,
		tags: Array.isArray(v.tags) ? v.tags.map(cleanSlug).filter(Boolean).slice(0, 20) : [],
		creator,
		createdAt,
	};
}

export function parseEmbedPayload(data: unknown): EmbedData | null {
	if (!isRecord(data) || !Array.isArray(data.products)) return null;
	return {
		products: data.products.map(reviveProduct).filter((p): p is Product => p !== null),
		ref: cleanRef(data.ref),
		query: sanitizeQuery(data.query, MAX_LIMIT_SECRET),
		display: parseDisplay(data.display),
	};
}

export function parseContextPayload(data: unknown): ContextData | null {
	if (!isRecord(data)) return null;
	return { ref: cleanRef(data.ref), display: parseDisplay(data.display) };
}
