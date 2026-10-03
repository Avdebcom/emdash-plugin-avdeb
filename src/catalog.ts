/**
 * AVDEB catalog API contract: query sanitising, response validation, link helpers.
 * Pure module — safe to import from routes, Astro components and tests.
 */

import {
	API_BASE,
	DEFAULT_LIMIT,
	MAX_LIMIT_ANONYMOUS,
	MAX_LIMIT_SECRET,
	PUBLISHABLE_KEY_PREFIX,
	SECRET_KEY_RE,
	SITE_ORIGIN,
} from "./constants.ts";

export interface CatalogQuery {
	creator?: string;
	tag?: string;
	type?: string;
	handle?: string;
	q?: string;
	limit: number;
}

export interface ProductCreator {
	slug: string;
	name: string;
	url: string | null;
}

export interface Product {
	handle: string;
	title: string;
	url: string;
	image: string | null;
	price: number | null;
	compareAtPrice: number | null;
	currency: string;
	type: string | null;
	tags: string[];
	creator: ProductCreator | null;
	createdAt: string | null;
}

export type Tier = "anonymous" | "publishable" | "secret";

export interface ProductsResult {
	products: Product[];
	ref: string;
	tier: Tier;
}

export interface KeyOwner {
	type: string;
	name: string;
	ref: string;
	creatorSlug: string;
}

export type KeyProblem = "publishable" | "malformed";

const SLUG_RE = /[^a-z0-9-]+/g;
const TYPE_RE = /[^\p{L}\p{N} &'-]+/gu;
// eslint-disable-next-line no-control-regex -- strip control characters from search input
const CONTROL_RE = /[\u0000-\u001f\u007f]+/g;
const CURRENCY_RE = /^[A-Z]{3}$/;

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function str(value: unknown): string {
	return typeof value === "string" ? value : typeof value === "number" ? String(value) : "";
}

/** Referral codes are letters, digits, "-" and "_" (as issued in the AVDEB affiliate dashboard). */
export function cleanRef(code: unknown): string {
	return str(code).replace(/[^A-Za-z0-9_-]/g, "").slice(0, 40);
}

/** Lower-case URL slug (creator, category, product handle). */
export function cleanSlug(value: unknown): string {
	return str(value).trim().toLowerCase().replace(SLUG_RE, "-").replace(/^-+|-+$/g, "").slice(0, 100);
}

/** Product type such as "Sticker" or "Phone Case". */
export function cleanType(value: unknown): string {
	return str(value).replace(TYPE_RE, "").replace(/\s+/g, " ").trim().slice(0, 40);
}

/** Free-text search phrase. */
export function cleanSearch(value: unknown): string {
	return str(value).replace(CONTROL_RE, " ").replace(/\s+/g, " ").trim().slice(0, 100);
}

/** `null` for a usable secret key, otherwise why it can't be used. Empty input is not a problem. */
export function keyProblem(key: unknown): KeyProblem | null {
	const k = str(key).trim();
	if (k === "" || SECRET_KEY_RE.test(k)) return null;
	return k.startsWith(PUBLISHABLE_KEY_PREFIX) ? "publishable" : "malformed";
}

/** The key when it is a well-formed secret key, otherwise "". */
export function usableKey(key: unknown): string {
	const k = str(key).trim();
	return SECRET_KEY_RE.test(k) ? k : "";
}

export function maxLimit(hasKey: boolean): number {
	return hasKey ? MAX_LIMIT_SECRET : MAX_LIMIT_ANONYMOUS;
}

export function isAvdebUrl(url: unknown): url is string {
	if (typeof url !== "string") return false;
	try {
		const u = new URL(url);
		const host = u.hostname.toLowerCase();
		return u.protocol === "https:" && (host === "avdeb.com" || host === "www.avdeb.com");
	} catch {
		return false;
	}
}

/**
 * Absolute avdeb.com URL for an avdeb.com URL or a site path ("/store/cat/"), with `ref` set when
 * given. Anything pointing elsewhere returns "" so callers never link off-site by accident.
 */
export function avdebLink(input: unknown, ref = ""): string {
	let raw = str(input).trim();
	if (raw === "") return "";
	if (raw.startsWith("/") && !raw.startsWith("//")) raw = SITE_ORIGIN + raw;
	else if (/^(www\.)?avdeb\.com(\/|$)/i.test(raw)) raw = "https://" + raw;
	if (!isAvdebUrl(raw)) return "";
	const u = new URL(raw);
	const code = cleanRef(ref);
	if (code !== "") u.searchParams.set("ref", code);
	return u.toString();
}

export function hasRef(url: string): boolean {
	try {
		return new URL(url).searchParams.has("ref");
	} catch {
		return false;
	}
}

export type LinkTarget = { kind: "creator" | "tag" | "handle"; value: string };

/**
 * Recognise an AVDEB page a user pasted: /creators/{slug}/, /category/{slug}/, /store/{handle}/.
 * Accepts full URLs, scheme-less "avdeb.com/…" and bare paths.
 */
export function parseAvdebLink(input: unknown): LinkTarget | null {
	const raw = str(input).trim();
	if (raw === "") return null;
	let path: string;
	if (raw.startsWith("/") && !raw.startsWith("//")) {
		path = raw;
	} else {
		const withScheme = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
		try {
			const u = new URL(withScheme);
			const host = u.hostname.toLowerCase();
			if (host !== "avdeb.com" && host !== "www.avdeb.com") return null;
			path = u.pathname;
		} catch {
			return null;
		}
	}
	const [section, slug] = path.split(/[?#]/)[0]!.split("/").filter(Boolean);
	const value = cleanSlug(slug);
	if (!section || value === "") return null;
	const kind = ({ creators: "creator", category: "tag", store: "handle" } as const)[
		section.toLowerCase() as "creators" | "category" | "store"
	];
	return kind ? { kind, value } : null;
}

/**
 * Validate an untrusted query (route input). Unknown keys are ignored; an empty filter set means
 * "newest products". `limit` is clamped to the tier max; a handle always means one product.
 */
export function sanitizeQuery(input: unknown, max: number): CatalogQuery {
	const src = isRecord(input) ? input : {};
	const query: CatalogQuery = { limit: DEFAULT_LIMIT };
	const creator = cleanSlug(src.creator);
	const tag = cleanSlug(src.tag);
	const type = cleanType(src.type);
	const handle = cleanSlug(src.handle);
	const q = cleanSearch(src.q);
	if (creator) query.creator = creator;
	if (tag) query.tag = tag;
	if (type) query.type = type;
	if (handle) query.handle = handle;
	if (q) query.q = q;
	const limit = Math.trunc(Number(src.limit));
	query.limit = handle ? 1 : Number.isFinite(limit) && limit > 0 ? Math.min(max, limit) : Math.min(max, DEFAULT_LIMIT);
	return query;
}

/** Stable string for a query (cache key, request de-duplication). */
export function queryKey(q: CatalogQuery): string {
	return [q.creator ?? "", q.tag ?? "", q.type ?? "", q.handle ?? "", q.q ?? "", q.limit].join("|");
}

/** GET /v1/catalog/products URL. `ref` is only sent without a key (key holders get their own code). */
export function productsUrl(q: CatalogQuery, ref = ""): string {
	const params = new URLSearchParams();
	for (const k of ["creator", "tag", "type", "handle", "q"] as const) {
		const v = q[k];
		if (v) params.set(k, v);
	}
	params.set("limit", String(q.limit));
	const code = cleanRef(ref);
	if (code) params.set("ref", code);
	return `${API_BASE}/products?${params.toString()}`;
}

function money(value: unknown): number | null {
	return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}

/** Keep only fields the plugin renders, validated. `null` for anything unusable. */
export function normalizeProduct(raw: unknown): Product | null {
	if (!isRecord(raw)) return null;
	const handle = cleanSlug(raw.handle);
	const title = str(raw.title).replace(CONTROL_RE, " ").trim().slice(0, 200);
	const url = str(raw.url);
	if (!handle || !title || !isAvdebUrl(url)) return null;

	const image = str(raw.image);
	const currency = str(raw.currency).toUpperCase();
	let creator: ProductCreator | null = null;
	if (isRecord(raw.creator)) {
		const slug = cleanSlug(raw.creator.slug);
		if (slug) {
			const creatorUrl = str(raw.creator.url);
			creator = {
				slug,
				name: str(raw.creator.name).trim().slice(0, 120) || slug,
				url: isAvdebUrl(creatorUrl) ? creatorUrl : null,
			};
		}
	}
	const createdAt = str(raw.created_at);
	return {
		handle,
		title,
		url,
		image: image.startsWith("https://") ? image : null,
		price: money(raw.price),
		compareAtPrice: money(raw.compare_at_price),
		currency: CURRENCY_RE.test(currency) ? currency : "USD",
		type: cleanType(raw.type) || null,
		tags: Array.isArray(raw.tags) ? raw.tags.map(cleanSlug).filter(Boolean).slice(0, 20) : [],
		creator,
		createdAt: createdAt && !Number.isNaN(Date.parse(createdAt)) ? createdAt : null,
	};
}

export function parseProductsResponse(json: unknown): ProductsResult | null {
	if (!isRecord(json) || !Array.isArray(json.products)) return null;
	const products: Product[] = [];
	const seen = new Set<string>();
	for (const raw of json.products) {
		const p = normalizeProduct(raw);
		if (p && !seen.has(p.handle)) {
			seen.add(p.handle);
			products.push(p);
		}
	}
	const tier = json.tier === "secret" || json.tier === "publishable" ? json.tier : "anonymous";
	return { products, ref: cleanRef(json.ref), tier };
}

export function parseKeyResponse(json: unknown): KeyOwner | null {
	if (!isRecord(json) || !isRecord(json.owner)) return null;
	const o = json.owner;
	return {
		type: str(o.type).replace(/[^a-z_-]/gi, "").toLowerCase().slice(0, 20),
		name: str(o.name).trim().slice(0, 120),
		ref: cleanRef(o.ref),
		creatorSlug: cleanSlug(o.creator_slug),
	};
}

/** Error message from an API error body (`{ "error": "…" }`) or the HTTP status. */
export function apiErrorMessage(status: number, json: unknown): string {
	const msg = isRecord(json) ? str(json.error).trim().slice(0, 200) : "";
	return msg || `HTTP ${status}`;
}
