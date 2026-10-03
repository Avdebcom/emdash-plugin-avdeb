import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
	avdebLink,
	cleanRef,
	cleanSearch,
	cleanSlug,
	isAvdebUrl,
	keyProblem,
	normalizeProduct,
	parseAvdebLink,
	parseKeyResponse,
	parseProductsResponse,
	productsUrl,
	queryKey,
	sanitizeQuery,
	usableKey,
} from "../src/catalog.ts";
import { product, SECRET_KEY } from "./helpers.ts";

describe("cleaning", () => {
	it("keeps only referral-code characters, max 40", () => {
		assert.equal(cleanRef(" AB-c_9<script>"), "AB-c_9script");
		assert.equal(cleanRef("x".repeat(50)).length, 40);
		assert.equal(cleanRef(undefined), "");
	});

	it("slugifies", () => {
		assert.equal(cleanSlug("  Cat Stickers!! "), "cat-stickers");
		assert.equal(cleanSlug("../../etc/passwd"), "etc-passwd");
		assert.equal(cleanSlug(42), "42");
	});

	it("strips control characters from search and caps it", () => {
		assert.equal(cleanSearch("cat\u0000\n  stickers"), "cat stickers");
		assert.equal(cleanSearch("a".repeat(150)).length, 100);
	});
});

describe("keys", () => {
	it("accepts only avdeb_sk_ + 32 alphanumerics", () => {
		assert.equal(usableKey(SECRET_KEY), SECRET_KEY);
		assert.equal(usableKey(` ${SECRET_KEY} `), SECRET_KEY);
		assert.equal(usableKey(SECRET_KEY + "x"), "");
		assert.equal(keyProblem(SECRET_KEY), null);
		assert.equal(keyProblem(""), null);
		assert.equal(keyProblem("avdeb_pk_abc"), "publishable");
		assert.equal(keyProblem("sk_live_123"), "malformed");
	});
});

describe("links", () => {
	it("recognises avdeb.com over https only", () => {
		assert.equal(isAvdebUrl("https://avdeb.com/store/x/"), true);
		assert.equal(isAvdebUrl("https://www.avdeb.com/"), true);
		assert.equal(isAvdebUrl("http://avdeb.com/"), false);
		assert.equal(isAvdebUrl("https://avdeb.com.evil.test/"), false);
		assert.equal(isAvdebUrl("https://evil.test/?u=https://avdeb.com"), false);
		assert.equal(isAvdebUrl("javascript:alert(1)"), false);
	});

	it("builds referral links from paths and URLs, never off-site", () => {
		assert.equal(avdebLink("/store/cat/", "ABC"), "https://avdeb.com/store/cat/?ref=ABC");
		assert.equal(avdebLink("avdeb.com/creators/cleo/", ""), "https://avdeb.com/creators/cleo/");
		assert.equal(avdebLink("https://avdeb.com/?ref=OLD&x=1", "NEW"), "https://avdeb.com/?ref=NEW&x=1");
		assert.equal(avdebLink("https://example.com/", "ABC"), "");
		assert.equal(avdebLink("//evil.test/", "ABC"), "");
		assert.equal(avdebLink("", "ABC"), "");
	});

	it("parses creator, category and product links", () => {
		assert.deepEqual(parseAvdebLink("https://avdeb.com/creators/Cleo/"), { kind: "creator", value: "cleo" });
		assert.deepEqual(parseAvdebLink("avdeb.com/category/stickers/?ref=X"), { kind: "tag", value: "stickers" });
		assert.deepEqual(parseAvdebLink("https://www.avdeb.com/store/cat-sticker"), { kind: "handle", value: "cat-sticker" });
		assert.deepEqual(parseAvdebLink("/store/cat-sticker/#reviews"), { kind: "handle", value: "cat-sticker" });
		assert.equal(parseAvdebLink("https://example.com/store/cat/"), null);
		assert.equal(parseAvdebLink("https://avdeb.com/blog/post/"), null);
		assert.equal(parseAvdebLink("https://avdeb.com/store/"), null);
		assert.equal(parseAvdebLink("cat stickers"), null);
	});
});

describe("sanitizeQuery", () => {
	it("clamps the limit to the tier maximum and defaults to 6", () => {
		assert.deepEqual(sanitizeQuery({ creator: "Cleo", limit: 100 }, 12), { creator: "cleo", limit: 12 });
		assert.deepEqual(sanitizeQuery({ tag: "stickers", limit: "8" }, 48), { tag: "stickers", limit: 8 });
		assert.deepEqual(sanitizeQuery({}, 48), { limit: 6 });
		assert.deepEqual(sanitizeQuery({ limit: -3 }, 48), { limit: 6 });
		assert.deepEqual(sanitizeQuery(null, 48), { limit: 6 });
	});

	it("forces one product for a handle and ignores unknown keys", () => {
		assert.deepEqual(sanitizeQuery({ handle: "cat-sticker", limit: 20, cursor: "x", key: "y" }, 48), {
			handle: "cat-sticker",
			limit: 1,
		});
	});

	it("produces stable keys and URLs", () => {
		const q = sanitizeQuery({ q: "cat stickers", type: "Sticker", limit: 4 }, 48);
		assert.equal(queryKey(q), "||Sticker||cat stickers|4");
		assert.equal(
			productsUrl(q, "ABC"),
			"https://api.avdeb.com/v1/catalog/products?type=Sticker&q=cat+stickers&limit=4&ref=ABC",
		);
		assert.equal(productsUrl({ limit: 6 }), "https://api.avdeb.com/v1/catalog/products?limit=6");
	});
});

describe("normalizeProduct", () => {
	it("keeps rendered fields", () => {
		assert.deepEqual(normalizeProduct(product({ compare_at_price: 6.5 })), {
			handle: "cat-sticker",
			title: "Cat Sticker",
			url: "https://avdeb.com/store/cat-sticker/?ref=ABC12345",
			image: "https://cdn.avdeb.com/cat.webp",
			price: 4.9,
			compareAtPrice: 6.5,
			currency: "USD",
			type: "Sticker",
			tags: ["stickers", "cats"],
			creator: { slug: "cleo", name: "Cleo", url: "https://avdeb.com/creators/cleo/?ref=ABC12345" },
			createdAt: "2026-09-30T10:00:00Z",
		});
	});

	it("rejects products that would link off-site or lack a title", () => {
		assert.equal(normalizeProduct(product({ url: "https://evil.test/store/cat/" })), null);
		assert.equal(normalizeProduct(product({ title: "" })), null);
		assert.equal(normalizeProduct("nope"), null);
	});

	it("drops unsafe images, creator links and bad currencies", () => {
		const p = normalizeProduct(
			product({
				image: "http://cdn.avdeb.com/cat.webp",
				currency: "dollars",
				price: "4.90",
				creator: { slug: "cleo", name: "", url: "https://evil.test/" },
				created_at: "yesterday",
			}),
		)!;
		assert.equal(p.image, null);
		assert.equal(p.currency, "USD");
		assert.equal(p.price, null);
		assert.deepEqual(p.creator, { slug: "cleo", name: "cleo", url: null });
		assert.equal(p.createdAt, null);
	});

	it("parses a products response, de-duplicating by handle", () => {
		const res = parseProductsResponse({
			products: [product(), product(), product({ handle: "dog", url: "https://avdeb.com/store/dog/" }), { bad: 1 }],
			ref: "ABC12345",
			tier: "secret",
		})!;
		assert.deepEqual(
			res.products.map((p) => p.handle),
			["cat-sticker", "dog"],
		);
		assert.equal(res.ref, "ABC12345");
		assert.equal(res.tier, "secret");
		assert.equal(parseProductsResponse({ products: [], tier: "admin" })!.tier, "anonymous");
		assert.equal(parseProductsResponse({ error: "x" }), null);
	});

	it("parses the key owner", () => {
		assert.deepEqual(
			parseKeyResponse({ kind: "secret", owner: { type: "creator", name: "Cleo", ref: "ABC", creator_slug: "cleo" } }),
			{ type: "creator", name: "Cleo", ref: "ABC", creatorSlug: "cleo" },
		);
		assert.equal(parseKeyResponse({}), null);
	});
});
