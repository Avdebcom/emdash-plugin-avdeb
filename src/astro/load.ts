/**
 * Server-side data loading for the Astro components. Calls the plugin's public routes in-process
 * through EmDash's public route dispatcher (no HTTP round-trip), and de-duplicates identical
 * requests within one page render.
 */

import { getPublicPluginApiRouteHandler, type PublicPluginRuntimeLocals } from "emdash/plugin-utils";

import { PLUGIN_ID } from "../constants.ts";
import { parseContextPayload, parseEmbedPayload, type ContextData, type EmbedData } from "../payload.ts";

type Route = "products" | "context";

const perRequest = new WeakMap<object, Map<string, Promise<unknown>>>();

function isRecord(v: unknown): v is Record<string, unknown> {
	return typeof v === "object" && v !== null && !Array.isArray(v);
}

async function call(locals: unknown, base: URL, route: Route, body: unknown): Promise<unknown> {
	const handler = getPublicPluginApiRouteHandler(locals as PublicPluginRuntimeLocals);
	const request = new Request(new URL(`/_emdash/api/plugins/${PLUGIN_ID}/${route}`, base), {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(body),
	});
	try {
		if (handler) {
			const res = await handler(PLUGIN_ID, "POST", `/${route}`, request);
			return res.success ? res.data : null;
		}
		// No in-process dispatcher (unusual setups): fall back to the public HTTP route.
		const res = await fetch(request);
		if (!res.ok) return null;
		const json: unknown = await res.json();
		return isRecord(json) ? json.data : null;
	} catch (error) {
		console.warn(`[${PLUGIN_ID}] ${route} failed:`, error);
		return null;
	}
}

function memo<T>(locals: unknown, key: string, run: () => Promise<T>): Promise<T> {
	if (!isRecord(locals)) return run();
	let map = perRequest.get(locals);
	if (!map) {
		map = new Map();
		perRequest.set(locals, map);
	}
	let hit = map.get(key) as Promise<T> | undefined;
	if (!hit) {
		hit = run();
		map.set(key, hit);
	}
	return hit;
}

/** Products for a query (unsanitised; the route validates it). Null when nothing can be shown. */
export function loadEmbed(locals: unknown, base: URL, query: Record<string, unknown>): Promise<EmbedData | null> {
	return memo(locals, `p:${JSON.stringify(query)}`, async () =>
		parseEmbedPayload(await call(locals, base, "products", query)),
	);
}

/** Referral code + display settings (buttons). */
export function loadContext(locals: unknown, base: URL): Promise<ContextData | null> {
	return memo(locals, "ctx", async () => parseContextPayload(await call(locals, base, "context", {})));
}
