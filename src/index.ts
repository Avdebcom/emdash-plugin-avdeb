/**
 * AVDEB Products — EmDash plugin.
 *
 * Embed AVDEB products (a creator's shop, a category, a search or single products) in Portable Text
 * content and Astro templates, with the site owner's referral code on every link.
 *
 * This is a trusted (native) plugin: it contributes Portable Text block types and Astro render
 * components, which the sandbox/registry format cannot. It only talks to api.avdeb.com.
 *
 * @example
 * ```ts
 * // astro.config.mjs
 * import { avdebProducts } from "emdash-plugin-avdeb";
 *
 * emdash({ plugins: [avdebProducts()] });
 * ```
 */

import type { PluginDescriptor, ResolvedPlugin } from "emdash";
import { definePlugin } from "emdash";
import { z } from "astro/zod";

import { adminRoute, WIDGET_ID } from "./admin.ts";
import { portableTextBlocks } from "./blocks.ts";
import { API_HOST, PLUGIN_ID, VERSION } from "./constants.ts";
import { cleanupCache, contextRoute, productOptionsRoute, productsRoute, searchRoute } from "./routes.ts";
import { settingsSchema } from "./settings.ts";

// eslint-disable-next-line typescript/no-empty-object-type -- reserved for future options
export interface AvdebProductsOptions {}

const capabilities = ["network:request"] as const;
const allowedHosts = [API_HOST];
const adminPages = [{ path: "/", label: "AVDEB Products", icon: "storefront" }];
const adminWidgets = [{ id: WIDGET_ID, title: "AVDEB Products", size: "third" as const }];

/** Descriptor for `emdash({ plugins: [avdebProducts()] })` in astro.config. */
export function avdebProducts(
	options: AvdebProductsOptions = {},
): PluginDescriptor<AvdebProductsOptions> {
	return {
		id: PLUGIN_ID,
		version: VERSION,
		format: "native",
		entrypoint: "emdash-plugin-avdeb",
		componentsEntry: "emdash-plugin-avdeb/astro",
		options,
		capabilities: [...capabilities],
		allowedHosts,
		adminPages,
		adminWidgets,
		settingsSchema,
		portableTextBlocks,
	};
}

const searchInput = z.object({
	q: z.string().max(100).optional().describe("Search phrase, e.g. 'cat stickers'"),
	creator: z.string().max(100).optional().describe("Creator slug"),
	tag: z.string().max(100).optional().describe("Category slug"),
	type: z.string().max(40).optional().describe("Product type, e.g. 'Sticker'"),
	limit: z.number().int().min(1).max(48).optional(),
});

export function createPlugin(_options: AvdebProductsOptions = {}): ResolvedPlugin {
	return definePlugin({
		id: PLUGIN_ID,
		version: VERSION,
		capabilities: [...capabilities],
		allowedHosts,

		hooks: {
			"plugin:activate": {
				handler: async (_event, ctx) => {
					await ctx.cron?.schedule("cleanup", { schedule: "@daily" });
				},
			},
			cron: {
				handler: async (event, ctx) => {
					if (event.name !== "cleanup") return;
					const removed = await cleanupCache(ctx);
					if (removed > 0) ctx.log.info("Removed expired AVDEB cache entries", { removed });
				},
			},
		},

		routes: {
			// Called in-process by the site renderer (getPublicPluginApiRouteHandler). Returns public
			// product data only; network calls are cached and capped per minute.
			products: { public: true, handler: productsRoute },
			context: { public: true, handler: contextRoute },

			// Editor: the "pick a product" select in the AVDEB Product block.
			"options/products": { permission: "content:create", handler: productOptionsRoute },
			"mcp/search": { permission: "content:create", input: searchInput, handler: searchRoute },

			admin: { permission: "plugins:manage", handler: adminRoute },
		},

		mcp: {
			tools: {
				search_avdeb_products: {
					description:
						"Search AVDEB products to embed in content. Returns handles plus a ready Portable Text block ({ _type: 'avdeb-product', id }) for each.",
					route: "mcp/search",
					input: searchInput,
					destructive: false,
				},
			},
		},

		admin: {
			settingsSchema,
			pages: adminPages,
			widgets: adminWidgets,
			portableTextBlocks,
		},
	});
}

export default createPlugin;

export { BLOCK_TYPES, PLUGIN_ID } from "./constants.ts";
export type { Product, CatalogQuery } from "./catalog.ts";
export type { DisplaySettings } from "./settings.ts";
