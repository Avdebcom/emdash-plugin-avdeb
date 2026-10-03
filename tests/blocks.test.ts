import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buttonRequest, portableTextBlocks, productRequest, productsRequest } from "../src/blocks.ts";

describe("block definitions", () => {
	it("declares three blocks whose field ids are unique and use editor-supported elements", () => {
		assert.deepEqual(
			portableTextBlocks.map((b) => b.type),
			["avdeb-products", "avdeb-product", "avdeb-button"],
		);
		// The Portable Text modal renders text_input, number_input, select, toggle, repeater, media_picker.
		const supported = new Set(["text_input", "number_input", "select", "toggle", "repeater", "media_picker"]);
		for (const block of portableTextBlocks) {
			const ids = block.fields!.map((f) => f.action_id);
			assert.equal(new Set(ids).size, ids.length, `${block.type} has duplicate field ids`);
			assert.equal(ids[0], "id", `${block.type}: first field is the editor's display id`);
			for (const f of block.fields!) assert.ok(supported.has(f.type), `${block.type}.${f.action_id}: ${f.type}`);
		}
	});
});

describe("productsRequest", () => {
	it("auto-detects creator, category and product links", () => {
		assert.deepEqual(productsRequest({ id: "https://avdeb.com/creators/cleo/", limit: 8 }).query, { creator: "cleo", limit: 8 });
		assert.deepEqual(productsRequest({ id: "/category/stickers/" }).query, { tag: "stickers", limit: undefined });
		assert.deepEqual(productsRequest({ id: "avdeb.com/store/cat/" }).query, { handle: "cat", limit: undefined });
	});

	it("treats plain text as a search, or as the chosen source", () => {
		assert.deepEqual(productsRequest({ id: "cat stickers" }).query, { q: "cat stickers", limit: undefined });
		assert.deepEqual(productsRequest({ id: "Cleo", source: "creator" }).query, { creator: "cleo", limit: undefined });
		assert.deepEqual(productsRequest({ id: "https://avdeb.com/creators/cleo/", source: "creator" }).query, { creator: "cleo", limit: undefined });
		assert.deepEqual(productsRequest({ id: "Phone Case", source: "type" }).query, { type: "Phone Case", limit: undefined });
		assert.deepEqual(productsRequest({ id: "ignored", source: "newest", limit: 4 }).query, { limit: 4 });
	});

	it("maps 'default' selects to the site setting and keeps headings", () => {
		const r = productsRequest({ id: "", layout: "default", cardStyle: "outline", heading: " Shop ", viewAll: false });
		assert.equal(r.overrides.layout, undefined);
		assert.equal(r.overrides.cardStyle, "outline");
		assert.equal(r.heading, "Shop");
		assert.equal(r.viewAll, false);
		assert.equal(productsRequest({}).viewAll, true);
	});
});

describe("productRequest", () => {
	it("prefers a link or handle in id over the picker", () => {
		assert.equal(productRequest({ id: "https://avdeb.com/store/Cat-Sticker/", pick: "dog" }).handle, "cat-sticker");
		assert.equal(productRequest({ id: "cat-sticker" }).handle, "cat-sticker");
		assert.equal(productRequest({ id: "", pick: "dog" }).handle, "dog");
	});

	it("ignores non-product links instead of guessing a handle", () => {
		assert.equal(productRequest({ id: "https://avdeb.com/creators/cleo/" }).handle, "");
		assert.equal(productRequest({ id: "https://example.com/store/cat/", pick: "dog" }).handle, "dog");
	});

	it("validates the variant", () => {
		assert.equal(productRequest({ id: "x", variant: "hero" }).variant, "hero");
		assert.equal(productRequest({ id: "x", variant: "giant" }).variant, "horizontal");
	});
});

describe("buttonRequest", () => {
	it("has sensible defaults", () => {
		assert.deepEqual(buttonRequest({}), { href: "/", label: "Shop on AVDEB", variant: "solid", align: "start" });
		assert.deepEqual(buttonRequest({ id: "/creators/cleo/", label: "My shop", variant: "link", align: "center" }), {
			href: "/creators/cleo/",
			label: "My shop",
			variant: "link",
			align: "center",
		});
	});
});
