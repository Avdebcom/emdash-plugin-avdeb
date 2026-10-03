import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { BACKOFF_MS, createCatalogClient, EMPTY_BACKOFF_MS, hash, STALE_MS } from "../src/client.ts";
import { MemoryKV, product, productsBody, scriptedFetch, SECRET_KEY } from "./helpers.ts";

const MIN = 60_000;

function setup(opts: { apiKey?: string; refCode?: string; budget?: number; replies: Parameters<typeof scriptedFetch>[0] }) {
	const kv = new MemoryKV();
	const { fetch, calls } = scriptedFetch(opts.replies);
	let t = Date.UTC(2026, 9, 1, 12);
	const client = createCatalogClient({
		kv,
		fetch,
		apiKey: opts.apiKey ?? "",
		refCode: opts.refCode ?? "",
		cacheMinutes: 60,
		budgetPerMinute: opts.budget,
		now: () => t,
	});
	return { kv, calls, client, advance: (ms: number) => (t += ms) };
}

describe("hash", () => {
	it("is FNV-1a 32-bit", () => {
		assert.equal(hash(""), "811c9dc5");
		assert.equal(hash("a"), "e40c292c");
	});
});

describe("products cache", () => {
	it("serves repeat queries from KV until they expire", async () => {
		const { client, calls, advance } = setup({
			replies: [{ body: productsBody([product()]) }, { body: productsBody([]) }],
		});
		const first = await client.products({ creator: "cleo", limit: 6 });
		assert.equal(first.source, "network");
		assert.equal(first.products.length, 1);
		advance(59 * MIN);
		assert.equal((await client.products({ creator: "cleo", limit: 6 })).source, "cache");
		assert.equal(calls.length, 1);
		advance(2 * MIN);
		const third = await client.products({ creator: "cleo", limit: 6 });
		assert.equal(third.source, "network");
		assert.equal(third.products.length, 0);
		assert.equal(calls.length, 2);
	});

	it("sends the secret key as a header and never a ref param", async () => {
		const { client, calls } = setup({ apiKey: SECRET_KEY, refCode: "IGNORED", replies: [{ body: productsBody([]) }] });
		await client.products({ tag: "stickers", limit: 6 });
		assert.equal(calls[0]!.headers.Authorization, `Bearer ${SECRET_KEY}`);
		assert.equal(calls[0]!.url, "https://api.avdeb.com/v1/catalog/products?tag=stickers&limit=6");
	});

	it("sends the manual referral code without a key", async () => {
		const { client, calls } = setup({ refCode: "MYCODE", replies: [{ body: productsBody([], { ref: "", tier: "anonymous" }) }] });
		const out = await client.products({ limit: 3 });
		assert.equal(calls[0]!.headers.Authorization, undefined);
		assert.equal(calls[0]!.url, "https://api.avdeb.com/v1/catalog/products?limit=3&ref=MYCODE");
		assert.equal(out.ref, "MYCODE");
		assert.equal(out.tier, "anonymous");
	});

	it("serves the last good copy when AVDEB fails, then backs off", async () => {
		const { client, calls, advance } = setup({
			replies: [{ body: productsBody([product()]) }, { status: 503, body: { error: "maintenance" } }],
		});
		await client.products({ limit: 6 });
		advance(61 * MIN);
		const stale = await client.products({ limit: 6 });
		assert.equal(stale.source, "stale");
		assert.equal(stale.error, "maintenance");
		assert.equal(stale.products[0]!.handle, "cat-sticker");
		advance(BACKOFF_MS - MIN);
		assert.equal((await client.products({ limit: 6 })).source, "cache");
		assert.equal(calls.length, 2);
	});

	it("caches failures without a good copy briefly", async () => {
		const { client, calls, advance } = setup({
			replies: [new Error("ECONNREFUSED"), { body: productsBody([product()]) }],
		});
		const out = await client.products({ limit: 6 });
		assert.deepEqual([out.source, out.products.length, out.error], ["empty", 0, "ECONNREFUSED"]);
		advance(EMPTY_BACKOFF_MS - 1);
		assert.equal((await client.products({ limit: 6 })).products.length, 0);
		assert.equal(calls.length, 1);
		advance(2);
		assert.equal((await client.products({ limit: 6 })).products.length, 1);
	});

	it("treats malformed responses as failures", async () => {
		const { client } = setup({ replies: [{ body: { hello: "world" } }] });
		const out = await client.products({ limit: 6 });
		assert.equal(out.source, "empty");
		assert.equal(out.error, "Unexpected response from AVDEB");
	});

	it("caps network calls per minute so random public queries can't burn the quota", async () => {
		const { client, calls, advance } = setup({ budget: 2, replies: () => ({ body: productsBody([]) }) });
		await client.products({ q: "a", limit: 6 });
		await client.products({ q: "b", limit: 6 });
		const limited = await client.products({ q: "c", limit: 6 });
		assert.deepEqual([limited.source, limited.error], ["empty", "rate limited"]);
		assert.equal(calls.length, 2);
		advance(MIN);
		assert.equal((await client.products({ q: "c", limit: 6 })).source, "network");
	});

	it("keeps entries separate per key/referral identity", async () => {
		const kv = new MemoryKV();
		const { fetch, calls } = scriptedFetch(() => ({ body: productsBody([]) }));
		const base = { kv, fetch, cacheMinutes: 60 };
		await createCatalogClient({ ...base, apiKey: "", refCode: "A" }).products({ limit: 6 });
		await createCatalogClient({ ...base, apiKey: "", refCode: "B" }).products({ limit: 6 });
		assert.equal(calls.length, 2);
	});

	it("ignores an entry whose stored key differs (hash collision guard)", async () => {
		const { kv, client, calls } = setup({ replies: [{ body: productsBody([product()]) }, { body: productsBody([]) }] });
		await client.products({ limit: 6 });
		const [[id, entry]] = [...kv.data].filter(([k]) => k.startsWith("cache:p:")) as [[string, Record<string, unknown>]];
		kv.data.set(id, { ...entry, key: "something else" });
		await client.products({ limit: 6 });
		assert.equal(calls.length, 2);
	});

	it("flush invalidates cached queries", async () => {
		const { client, calls } = setup({ replies: () => ({ body: productsBody([]) }) });
		await client.products({ limit: 6 });
		await client.flush();
		await client.products({ limit: 6 });
		assert.equal(calls.length, 2);
		assert.equal((await client.stats()).cacheVersion, 2);
	});

	it("cleanup removes expired and superseded entries", async () => {
		const { client, kv, advance } = setup({ replies: () => ({ body: productsBody([]) }) });
		await client.products({ q: "old", limit: 6 });
		await client.flush();
		await client.products({ q: "current", limit: 6 });
		assert.equal(await client.cleanup(), 1);
		advance(STALE_MS + 1);
		assert.equal(await client.cleanup(), 1);
		assert.deepEqual(
			[...kv.data.keys()].filter((k) => k.startsWith("cache:")),
			[],
		);
	});

	it("tracks request and error stats", async () => {
		const { client, advance } = setup({
			replies: [{ body: productsBody([product()]) }, { status: 500, body: {} }],
		});
		await client.products({ limit: 6 });
		advance(61 * MIN);
		await client.products({ limit: 6 });
		const s = await client.stats();
		assert.deepEqual([s.requests, s.errors, s.lastError, s.cachedQueries], [2, 1, "HTTP 500", 1]);
	});
});

describe("key info", () => {
	it("is null without a key and cached for 10 minutes with one", async () => {
		assert.equal(await setup({ replies: [] }).client.keyInfo(), null);

		const owner = { type: "affiliate", name: "Dmitry", ref: "ABC12345" };
		const { client, calls, advance } = setup({
			apiKey: SECRET_KEY,
			replies: [{ body: { kind: "secret", owner } }, { status: 401, body: { error: "key revoked" } }],
		});
		assert.deepEqual(await client.keyInfo(), { ok: true, owner: { ...owner, creatorSlug: "" } });
		assert.equal(await client.ref(), "ABC12345");
		assert.equal(calls.length, 1);
		assert.equal(calls[0]!.url, "https://api.avdeb.com/v1/catalog/key");
		advance(11 * MIN);
		assert.deepEqual(await client.keyInfo(), { ok: false, error: "key revoked" });
		assert.equal(await client.ref(), "");
	});

	it("uses the manual code as ref without a key", async () => {
		assert.equal(await setup({ refCode: "MINE", replies: [] }).client.ref(), "MINE");
	});
});
