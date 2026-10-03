import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { adminRoute, ago, connectionBanner } from "../src/admin.ts";
import { parseEmbedPayload } from "../src/payload.ts";
import { contextRoute, productOptionsRoute, productsRoute, searchRoute } from "../src/routes.ts";
import { readSettings } from "../src/settings.ts";
import { fakeCtx, MemoryKV, product, productsBody, scriptedFetch, SECRET_KEY } from "./helpers.ts";

const owner = { type: "creator", name: "Cleo", ref: "ABC12345", creator_slug: "cleo" };

function api(url: string) {
	if (url.endsWith("/key")) return { body: { kind: "secret", owner } };
	return { body: productsBody([product(), product({ handle: "dog", url: "https://avdeb.com/store/dog/?ref=ABC12345", price: 9.9 })]) };
}

describe("public routes", () => {
	it("returns products and display settings — never the secret key", async () => {
		const { fetch, calls } = scriptedFetch(api);
		const ctx = fakeCtx({
			settings: { apiKey: SECRET_KEY, layout: "carousel", accentColor: "#123456" },
			input: { creator: "Cleo", limit: 100, key: "leak?" },
			fetch,
		});
		const out = await productsRoute(ctx);
		assert.equal(calls[0]!.url, "https://api.avdeb.com/v1/catalog/products?creator=cleo&limit=48");
		assert.deepEqual(out.query, { creator: "cleo", limit: 48 });
		assert.equal(out.products.length, 2);
		assert.equal(out.display.layout, "carousel");
		assert.equal(out.display.accentColor, "#123456");
		assert.ok(!JSON.stringify(out).includes(SECRET_KEY));
		assert.ok(!JSON.stringify(out).includes("apiKey"));
	});

	it("limits anonymous embeds to 12 products", async () => {
		const { fetch, calls } = scriptedFetch(api);
		await productsRoute(fakeCtx({ settings: { refCode: "MINE" }, input: { limit: 40 }, fetch }));
		assert.equal(calls[0]!.url, "https://api.avdeb.com/v1/catalog/products?limit=12&ref=MINE");
	});

	it("round-trips through the renderer's payload validation", async () => {
		const { fetch } = scriptedFetch(api);
		const out = await productsRoute(fakeCtx({ input: { tag: "stickers" }, fetch }));
		const parsed = parseEmbedPayload(JSON.parse(JSON.stringify(out)))!;
		assert.deepEqual(parsed.products, out.products);
		assert.deepEqual(parsed.query, out.query);
		assert.equal(parsed.ref, "ABC12345");
	});

	it("context returns the key owner's referral code", async () => {
		const { fetch } = scriptedFetch(api);
		const out = await contextRoute(fakeCtx({ settings: { apiKey: SECRET_KEY }, fetch }));
		assert.equal(out.ref, "ABC12345");
	});

	it("fails clearly without the network capability", async () => {
		await assert.rejects(productsRoute(fakeCtx({ input: {} })), /network:request/);
	});
});

describe("editor routes", () => {
	it("lists the creator's own products for the picker", async () => {
		const { fetch, calls } = scriptedFetch(api);
		const out = await productOptionsRoute(fakeCtx({ settings: { apiKey: SECRET_KEY }, fetch }));
		assert.equal(calls[1]!.url, "https://api.avdeb.com/v1/catalog/products?creator=cleo&limit=48");
		assert.deepEqual(out.items, [
			{ id: "cat-sticker", name: "Cat Sticker · $4.90" },
			{ id: "dog", name: "Cat Sticker · $9.90" },
		]);
	});

	it("search returns insertable blocks", async () => {
		const { fetch } = scriptedFetch(api);
		const out = await searchRoute(fakeCtx({ input: { q: "cat" }, fetch }));
		assert.deepEqual(out.products[0]!.block, { _type: "avdeb-product", id: "cat-sticker" });
	});
});

describe("admin", () => {
	const settings = (values: Record<string, unknown>) => readSettings(async (k) => values[k] ?? null);

	it("explains key problems", async () => {
		assert.match(String(connectionBanner(await settings({ apiKey: "avdeb_pk_x" }), null)?.title), /publishable/);
		assert.match(String(connectionBanner(await settings({ apiKey: "nope" }), null)?.title), /doesn't look like/);
		assert.match(String(connectionBanner(await settings({}), null)?.title), /aren't credited/);
		assert.equal(connectionBanner(await settings({ refCode: "ABC" }), null), null);
		assert.match(
			String(connectionBanner(await settings({ apiKey: SECRET_KEY }), { ok: false, error: "key revoked" })?.description),
			/key revoked/,
		);
	});

	it("renders the overview page with connection, stats and a preview", async () => {
		const { fetch } = scriptedFetch(api);
		const out = await adminRoute(fakeCtx({ settings: { apiKey: SECRET_KEY }, input: { type: "page_load", page: "/" }, fetch }));
		const types = out.blocks.map((b) => b.type);
		assert.equal(types[0], "header");
		for (const t of ["fields", "stats", "actions", "table", "accordion"]) assert.ok(types.includes(t), t);
		const fields = out.blocks.find((b) => b.type === "fields") as { fields: Array<{ label: string; value: string }> };
		assert.deepEqual(fields.fields[0], { label: "Connected as", value: "Cleo (creator)" });
		const table = out.blocks.find((b) => b.type === "table") as { rows: unknown[] };
		assert.equal(table.rows.length, 2);
	});

	it("refresh invalidates the cache and toasts", async () => {
		const kv = new MemoryKV();
		const { fetch, calls } = scriptedFetch(api);
		const page = { type: "page_load", page: "/" };
		await adminRoute(fakeCtx({ kv, input: page, fetch }));
		const before = calls.length;
		const out = await adminRoute(fakeCtx({ kv, input: { type: "block_action", action_id: "refresh_cache", page: "/" }, fetch }));
		assert.equal(out.toast?.type, "success");
		assert.ok(calls.length > before, "preview was re-fetched after the flush");
	});

	it("renders a compact widget", async () => {
		const { fetch } = scriptedFetch(api);
		const out = await adminRoute(fakeCtx({ settings: { refCode: "ABC" }, input: { type: "page_load", page: "widget:status" }, fetch }));
		assert.deepEqual(
			out.blocks.map((b) => b.type),
			["fields", "actions"],
		);
	});

	it("formats relative times", () => {
		const now = 10_000_000;
		assert.equal(ago(null, now), "never");
		assert.equal(ago(now - 30_000, now), "just now");
		assert.equal(ago(now - 5 * 60_000, now), "5 min ago");
		assert.equal(ago(now - 3 * 3_600_000, now), "3 h ago");
	});
});
