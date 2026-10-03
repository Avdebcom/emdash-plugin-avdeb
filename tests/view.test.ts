import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { normalizeProduct, type Product } from "../src/catalog.ts";
import { DEFAULT_DISPLAY, readSettings, safeColor } from "../src/settings.ts";
import {
	buildCards,
	discountPercent,
	disclosureFor,
	effectiveColumns,
	formatPrice,
	isNew,
	relFor,
	resolveDisplay,
	rootStyle,
	viewAllHref,
} from "../src/view.ts";
import { product } from "./helpers.ts";

const NOW = Date.parse("2026-10-02T12:00:00Z");
const p = (o: Record<string, unknown> = {}) => normalizeProduct(product(o)) as Product;

describe("formatting", () => {
	it("formats prices per locale and currency", () => {
		assert.equal(formatPrice(4.9, "USD", "en-US"), "$4.90");
		assert.equal(formatPrice(4.9, "EUR", "de-DE"), "4,90\u00a0€");
		assert.equal(formatPrice(null, "USD"), null);
	});

	it("computes whole-number discounts only for real markdowns", () => {
		assert.equal(discountPercent(15, 20), 25);
		assert.equal(discountPercent(4.9, 6.5), 25);
		assert.equal(discountPercent(20, 20), null);
		assert.equal(discountPercent(25, 20), null);
		assert.equal(discountPercent(null, 20), null);
		assert.equal(discountPercent(19.99, 20), null);
	});

	it("flags products created in the last 14 days", () => {
		assert.equal(isNew("2026-09-30T10:00:00Z", NOW), true);
		assert.equal(isNew("2026-09-18T11:00:00Z", NOW), false);
		assert.equal(isNew("2026-10-05T00:00:00Z", NOW), false);
		assert.equal(isNew(null, NOW), false);
	});

	it("marks referral links as sponsored", () => {
		assert.equal(relFor("https://avdeb.com/store/x/?ref=A"), "sponsored noopener");
		assert.equal(relFor("https://avdeb.com/store/x/"), "noopener");
	});
});

describe("cards", () => {
	it("builds view models with sale badge, designer and link attributes", () => {
		const [card] = buildCards([p({ compare_at_price: 6.5 })], { ...DEFAULT_DISPLAY, newTab: true }, { now: NOW });
		assert.deepEqual(card, {
			key: "cat-sticker",
			href: "https://avdeb.com/store/cat-sticker/?ref=ABC12345",
			rel: "sponsored noopener",
			target: "_blank",
			title: "Cat Sticker",
			image: "https://cdn.avdeb.com/cat.webp",
			width: 600,
			height: 600,
			price: "$4.90",
			compareAt: "$6.50",
			discount: 25,
			isNew: true,
			creator: "Cleo",
		});
	});

	it("respects hidden prices, designers and badges", () => {
		const display = resolveDisplay({ ...DEFAULT_DISPLAY, showBadges: false, imageRatio: "portrait" }, { hidePrice: true, hideCreator: true });
		const [card] = buildCards([p({ compare_at_price: 6.5 })], display, { now: NOW });
		assert.deepEqual(
			[card!.price, card!.compareAt, card!.discount, card!.isNew, card!.creator, card!.height],
			[null, null, null, false, null, 750],
		);
	});
});

describe("display", () => {
	it("applies valid overrides only", () => {
		const d = resolveDisplay(DEFAULT_DISPLAY, { layout: "carousel", columns: 9, cardStyle: "glass", ctaLabel: "  Shop  " });
		assert.deepEqual([d.layout, d.columns, d.cardStyle, d.ctaLabel], ["carousel", 6, "elevated", "Shop"]);
		assert.equal(resolveDisplay(DEFAULT_DISPLAY, { columns: 0 }).columns, 3);
	});

	it("never uses more columns than products (lists use one)", () => {
		assert.equal(effectiveColumns(resolveDisplay(DEFAULT_DISPLAY, { columns: 4 }), 2), 2);
		assert.equal(effectiveColumns(resolveDisplay(DEFAULT_DISPLAY, { layout: "list" }), 5), 1);
	});

	it("writes only validated values into the style attribute", () => {
		assert.equal(rootStyle({ ...DEFAULT_DISPLAY, accentColor: "#ABC" }, 4), "--avdeb-cols:4;--avdeb-radius:16px;--avdeb-ratio:1 / 1;--avdeb-accent:#ABC");
		assert.equal(safeColor("#4D7F5A"), "#4d7f5a");
		assert.equal(safeColor("red;background:url(x)"), "");
		assert.equal(safeColor("#12345"), "");
	});

	it("links 'View all' for creator and category embeds", () => {
		assert.equal(viewAllHref({ creator: "cleo", limit: 6 }, [p()], "ABC12345"), "https://avdeb.com/creators/cleo/?ref=ABC12345");
		assert.equal(viewAllHref({ creator: "other", limit: 6 }, [p()], "R"), "https://avdeb.com/creators/other/?ref=R");
		assert.equal(viewAllHref({ tag: "stickers", limit: 6 }, [], ""), "https://avdeb.com/category/stickers/");
		assert.equal(viewAllHref({ q: "cats", limit: 6 }, [], "R"), null);
		assert.equal(viewAllHref({ creator: "cleo", tag: "x", limit: 6 }, [], "R"), null);
	});

	it("shows the disclosure only with a referral code", () => {
		assert.equal(disclosureFor(DEFAULT_DISPLAY, ""), null);
		assert.equal(disclosureFor(DEFAULT_DISPLAY, "ABC"), DEFAULT_DISPLAY.disclosureText);
		assert.equal(disclosureFor({ ...DEFAULT_DISPLAY, showDisclosure: false }, "ABC"), null);
	});
});

describe("settings", () => {
	it("falls back to defaults for missing or invalid values", async () => {
		const values: Record<string, unknown> = {
			apiKey: "avdeb_pk_123",
			refCode: "AB C<>",
			layout: "masonry",
			columns: "12",
			radius: -5,
			accentColor: "tomato",
			showPrice: "false",
			cacheMinutes: 1,
			disclosureText: "   ",
		};
		const s = await readSettings(async (k) => values[k] ?? null);
		assert.deepEqual(
			[s.apiKey, s.rawApiKey, s.refCode, s.layout, s.columns, s.radius, s.accentColor, s.showPrice, s.cacheMinutes, s.disclosureText],
			["", "avdeb_pk_123", "ABC", "grid", 6, 0, "", false, 5, DEFAULT_DISPLAY.disclosureText],
		);
	});

	it("survives a failing settings store", async () => {
		const s = await readSettings(async () => {
			throw new Error("db down");
		});
		assert.equal(s.layout, "grid");
		assert.equal(s.apiKey, "");
	});
});
