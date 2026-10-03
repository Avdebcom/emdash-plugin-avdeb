/**
 * Plugin route handlers. Only type imports from EmDash, so the handlers run in tests with a fake
 * context.
 */

import type { PluginContext, RouteContext } from "emdash";

import { maxLimit, sanitizeQuery, type Product } from "./catalog.ts";
import { createCatalogClient, type CatalogClient } from "./client.ts";
import { displayOf, readSettings, type ResolvedSettings, type SettingKey } from "./settings.ts";
import { formatPrice } from "./view.ts";

type Ctx = Pick<PluginContext, "kv" | "settings" | "http" | "log">;

export async function loadSettings(ctx: Ctx): Promise<ResolvedSettings> {
	return readSettings((key: SettingKey) => ctx.settings.get(key));
}

export function clientFor(ctx: Ctx, settings: ResolvedSettings, now?: () => number): CatalogClient {
	const http = ctx.http;
	if (!http) throw new Error("AVDEB Products needs the network:request capability for api.avdeb.com");
	return createCatalogClient({
		kv: ctx.kv,
		fetch: (url, init) => http.fetch(url, init),
		apiKey: settings.apiKey,
		refCode: settings.refCode,
		cacheMinutes: settings.cacheMinutes,
		log: ctx.log,
		now,
	});
}

/** Public: products + presentation settings for the site renderer. Never returns credentials. */
export async function productsRoute(ctx: RouteContext) {
	const settings = await loadSettings(ctx);
	const query = sanitizeQuery(ctx.input, maxLimit(settings.apiKey !== ""));
	const out = await clientFor(ctx, settings).products(query);
	return {
		products: out.products,
		ref: out.ref,
		tier: out.tier,
		query,
		display: displayOf(settings),
	};
}

/** Public: referral code + presentation settings (for buttons and links, no product lookup). */
export async function contextRoute(ctx: RouteContext) {
	const settings = await loadSettings(ctx);
	return { ref: await clientFor(ctx, settings).ref(), display: displayOf(settings) };
}

function optionLabel(p: Product): string {
	const price = formatPrice(p.price, p.currency);
	return price ? `${p.title} · ${price}` : p.title;
}

/**
 * Editor: options for the "pick a product" select — the key owner's own products for creators,
 * otherwise the newest products. Shape required by the editor: `{ items: [{ id, name }] }`.
 */
export async function productOptionsRoute(ctx: RouteContext) {
	const settings = await loadSettings(ctx);
	const client = clientFor(ctx, settings);
	const info = await client.keyInfo();
	const creator = info?.ok ? info.owner.creatorSlug : "";
	const query = sanitizeQuery(
		{ creator, limit: maxLimit(settings.apiKey !== "") },
		maxLimit(settings.apiKey !== ""),
	);
	const out = await client.products(query);
	return { items: out.products.map((p) => ({ id: p.handle, name: optionLabel(p) })) };
}

/** Editor / MCP: search the catalog and get ready-to-insert block data. */
export async function searchRoute(ctx: RouteContext) {
	const settings = await loadSettings(ctx);
	const query = sanitizeQuery(ctx.input, maxLimit(settings.apiKey !== ""));
	const out = await clientFor(ctx, settings).products(query);
	return {
		products: out.products.map((p) => ({
			handle: p.handle,
			title: p.title,
			price: p.price,
			currency: p.currency,
			url: p.url,
			image: p.image,
			creator: p.creator?.name ?? null,
			block: { _type: "avdeb-product", id: p.handle },
		})),
		ref: out.ref,
		...(out.error ? { warning: out.error } : {}),
	};
}

/** Daily cron: drop expired cache entries so random public queries can't pile up in KV. */
export async function cleanupCache(ctx: Ctx): Promise<number> {
	const settings = await loadSettings(ctx);
	return clientFor(ctx, settings).cleanup();
}
