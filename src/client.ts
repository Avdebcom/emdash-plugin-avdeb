/**
 * Cached AVDEB catalog client.
 *
 * Every query is cached in plugin KV on its own. When AVDEB can't be reached the last good answer
 * (kept for a week) is served and retried after a back-off. Because the render route is public,
 * network calls are also capped per minute so nobody can burn the site's API quota by sending
 * random queries. Pure module: KV and fetch are injected.
 */

import {
	apiErrorMessage,
	parseKeyResponse,
	parseProductsResponse,
	productsUrl,
	queryKey,
	type CatalogQuery,
	type KeyOwner,
	type Product,
	type Tier,
} from "./catalog.ts";
import { API_BASE, VERSION } from "./constants.ts";

export interface KVLike {
	get<T>(key: string): Promise<T | null>;
	set(key: string, value: unknown): Promise<void>;
	delete(key: string): Promise<boolean>;
	list(prefix?: string): Promise<Array<{ key: string; value: unknown }>>;
}

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

export interface LogLike {
	warn(message: string, data?: unknown): void;
}

export interface ClientOptions {
	kv: KVLike;
	fetch: FetchLike;
	apiKey: string;
	refCode: string;
	cacheMinutes: number;
	now?: () => number;
	/** Max network calls per minute across all queries (default 30). */
	budgetPerMinute?: number;
	timeoutMs?: number;
	log?: LogLike;
}

export type ProductsSource = "cache" | "network" | "stale" | "empty";

export interface ProductsOutcome {
	products: Product[];
	ref: string;
	tier: Tier;
	source: ProductsSource;
	error?: string;
}

export type KeyInfo = { ok: true; owner: KeyOwner } | { ok: false; error: string };

export interface ClientStats {
	requests: number;
	errors: number;
	lastFetchAt: number | null;
	lastError: string | null;
	lastErrorAt: number | null;
	cachedQueries: number;
	cacheVersion: number;
}

interface ProductsEntry {
	key: string;
	products: Product[];
	ref: string;
	tier: Tier;
	fetchedAt: number;
	freshUntil: number;
	staleUntil: number;
	error?: string;
}

interface KeyEntry {
	info: KeyInfo;
	until: number;
}

interface StoredStats {
	requests: number;
	errors: number;
	lastFetchAt: number | null;
	lastError: string | null;
	lastErrorAt: number | null;
}

const MINUTE = 60_000;
export const STALE_MS = 7 * 24 * 60 * MINUTE;
export const BACKOFF_MS = 15 * MINUTE;
export const EMPTY_BACKOFF_MS = 5 * MINUTE;
export const KEY_OK_MS = 10 * MINUTE;
export const KEY_FAIL_MS = 5 * MINUTE;

const K_VERSION = "state:version";
const K_BUDGET = "state:budget";
const K_STATS = "state:stats";
const P_PRODUCTS = "cache:p:";
const P_KEY = "cache:key:";

/** FNV-1a (32-bit) as hex — short, stable KV key suffix. Entries also store the full key. */
export function hash(input: string): string {
	let h = 0x811c9dc5;
	for (let i = 0; i < input.length; i++) {
		h ^= input.charCodeAt(i);
		h = Math.imul(h, 0x01000193);
	}
	return (h >>> 0).toString(16).padStart(8, "0");
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function createCatalogClient(opts: ClientOptions) {
	const now = opts.now ?? Date.now;
	const kv = opts.kv;
	const budget = opts.budgetPerMinute ?? 30;
	const cacheMs = Math.max(5, opts.cacheMinutes) * MINUTE;
	const identity = opts.apiKey ? `k:${hash(opts.apiKey)}` : `r:${opts.refCode}`;

	function headers(): Record<string, string> {
		const h: Record<string, string> = {
			Accept: "application/json",
			"User-Agent": `emdash-plugin-avdeb/${VERSION}`,
		};
		if (opts.apiKey) h.Authorization = `Bearer ${opts.apiKey}`;
		return h;
	}

	async function request(url: string): Promise<{ ok: true; json: unknown } | { ok: false; error: string }> {
		try {
			const init: RequestInit = { method: "GET", headers: headers() };
			if (typeof AbortSignal !== "undefined" && "timeout" in AbortSignal) {
				init.signal = AbortSignal.timeout(opts.timeoutMs ?? 8000);
			}
			const res = await opts.fetch(url, init);
			const json: unknown = await res.json().catch(() => null);
			return res.ok ? { ok: true, json } : { ok: false, error: apiErrorMessage(res.status, json) };
		} catch (err) {
			return { ok: false, error: err instanceof Error ? err.message : String(err) };
		}
	}

	async function version(): Promise<number> {
		const v = await kv.get<number>(K_VERSION);
		return typeof v === "number" && v > 0 ? v : 1;
	}

	/** Approximate per-minute limiter (KV round-trips are not atomic; good enough as a quota guard). */
	async function takeBudget(): Promise<boolean> {
		const minute = Math.floor(now() / MINUTE);
		const cur = await kv.get<{ minute: number; count: number }>(K_BUDGET);
		const count = cur && cur.minute === minute ? cur.count : 0;
		if (count >= budget) return false;
		await kv.set(K_BUDGET, { minute, count: count + 1 });
		return true;
	}

	async function record(error: string | null): Promise<void> {
		const prev = (await kv.get<StoredStats>(K_STATS)) ?? {
			requests: 0,
			errors: 0,
			lastFetchAt: null,
			lastError: null,
			lastErrorAt: null,
		};
		const t = now();
		await kv.set(K_STATS, {
			requests: prev.requests + 1,
			errors: prev.errors + (error ? 1 : 0),
			lastFetchAt: t,
			lastError: error ?? prev.lastError,
			lastErrorAt: error ? t : prev.lastErrorAt,
		} satisfies StoredStats);
	}

	async function products(query: CatalogQuery): Promise<ProductsOutcome> {
		const key = `${identity}|${queryKey(query)}`;
		const id = `${P_PRODUCTS}${await version()}:${hash(key)}`;
		const stored = await kv.get<ProductsEntry>(id);
		const entry = isRecord(stored) && stored.key === key ? stored : null;
		const t = now();

		if (entry && t < entry.freshUntil) {
			return { products: entry.products, ref: entry.ref, tier: entry.tier, source: "cache", error: entry.error };
		}

		const fallbackTier: Tier = opts.apiKey ? "secret" : "anonymous";
		if (!(await takeBudget())) {
			return entry && t < entry.staleUntil
				? { products: entry.products, ref: entry.ref, tier: entry.tier, source: "stale", error: "rate limited" }
				: { products: [], ref: "", tier: fallbackTier, source: "empty", error: "rate limited" };
		}

		const res = await request(productsUrl(query, opts.apiKey ? "" : opts.refCode));
		const parsed = res.ok ? parseProductsResponse(res.json) : null;
		const error = res.ok ? (parsed ? null : "Unexpected response from AVDEB") : res.error;
		await record(error);

		if (parsed) {
			const ref = parsed.ref || (opts.apiKey ? "" : opts.refCode);
			await kv.set(id, {
				key,
				products: parsed.products,
				ref,
				tier: parsed.tier,
				fetchedAt: t,
				freshUntil: t + cacheMs,
				staleUntil: t + STALE_MS,
			} satisfies ProductsEntry);
			return { products: parsed.products, ref, tier: parsed.tier, source: "network" };
		}

		opts.log?.warn("AVDEB catalog request failed", { error, query });
		if (entry && t < entry.staleUntil) {
			await kv.set(id, { ...entry, freshUntil: t + BACKOFF_MS, error: error! } satisfies ProductsEntry);
			return { products: entry.products, ref: entry.ref, tier: entry.tier, source: "stale", error: error! };
		}
		await kv.set(id, {
			key,
			products: [],
			ref: "",
			tier: fallbackTier,
			fetchedAt: t,
			freshUntil: t + EMPTY_BACKOFF_MS,
			staleUntil: t + EMPTY_BACKOFF_MS,
			error: error!,
		} satisfies ProductsEntry);
		return { products: [], ref: "", tier: fallbackTier, source: "empty", error: error! };
	}

	/** Who the secret key belongs to. `null` without a key. */
	async function keyInfo(): Promise<KeyInfo | null> {
		if (!opts.apiKey) return null;
		const id = `${P_KEY}${hash(opts.apiKey)}`;
		const cached = await kv.get<KeyEntry>(id);
		const t = now();
		if (isRecord(cached) && typeof cached.until === "number" && t < cached.until) return cached.info;

		const res = await request(`${API_BASE}/key`);
		const owner = res.ok ? parseKeyResponse(res.json) : null;
		const info: KeyInfo = owner
			? { ok: true, owner }
			: { ok: false, error: res.ok ? "Unexpected response from AVDEB" : res.error };
		await record(info.ok ? null : info.error);
		await kv.set(id, { info, until: t + (info.ok ? KEY_OK_MS : KEY_FAIL_MS) } satisfies KeyEntry);
		return info;
	}

	/** The referral code links carry: the key owner's with a key, else the manual code. */
	async function ref(): Promise<string> {
		if (!opts.apiKey) return opts.refCode;
		const info = await keyInfo();
		return info?.ok ? info.owner.ref : "";
	}

	/** "Refresh products now": invalidate every cached query and the key check. */
	async function flush(): Promise<void> {
		await kv.set(K_VERSION, (await version()) + 1);
		for (const { key } of await kv.list(P_KEY)) await kv.delete(key);
	}

	/** Delete expired and superseded cache entries (daily cron). Returns how many were removed. */
	async function cleanup(): Promise<number> {
		const v = await version();
		const t = now();
		let removed = 0;
		for (const { key, value } of await kv.list("cache:")) {
			const rec = isRecord(value) ? value : {};
			const expired = key.startsWith(P_PRODUCTS)
				? !key.startsWith(`${P_PRODUCTS}${v}:`) || !(typeof rec.staleUntil === "number" && t < rec.staleUntil)
				: !(typeof rec.until === "number" && t < rec.until);
			if (expired && (await kv.delete(key))) removed++;
		}
		return removed;
	}

	async function stats(): Promise<ClientStats> {
		const v = await version();
		const s = await kv.get<StoredStats>(K_STATS);
		const cached = await kv.list(`${P_PRODUCTS}${v}:`);
		return {
			requests: s?.requests ?? 0,
			errors: s?.errors ?? 0,
			lastFetchAt: s?.lastFetchAt ?? null,
			lastError: s?.lastError ?? null,
			lastErrorAt: s?.lastErrorAt ?? null,
			cachedQueries: cached.length,
			cacheVersion: v,
		};
	}

	return { products, keyInfo, ref, flush, cleanup, stats };
}

export type CatalogClient = ReturnType<typeof createCatalogClient>;
