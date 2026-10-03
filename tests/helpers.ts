/** Test doubles: in-memory KV, scripted fetch, and a fake EmDash route context. */

export class MemoryKV {
	data = new Map<string, unknown>();

	async get<T>(key: string): Promise<T | null> {
		return this.data.has(key) ? structuredClone(this.data.get(key) as T) : null;
	}

	async set(key: string, value: unknown): Promise<void> {
		this.data.set(key, structuredClone(value));
	}

	async delete(key: string): Promise<boolean> {
		return this.data.delete(key);
	}

	async list(prefix = ""): Promise<Array<{ key: string; value: unknown }>> {
		return [...this.data].filter(([k]) => k.startsWith(prefix)).map(([key, value]) => ({ key, value }));
	}
}

export interface Call {
	url: string;
	headers: Record<string, string>;
}

type Reply = { status?: number; body: unknown } | Error;

/** fetch that answers from a queue (or a function) and records every call. */
export function scriptedFetch(replies: Reply[] | ((url: string) => Reply)) {
	const calls: Call[] = [];
	const fetch = async (url: string, init?: RequestInit): Promise<Response> => {
		calls.push({ url, headers: { ...(init?.headers as Record<string, string>) } });
		const reply = typeof replies === "function" ? replies(url) : replies.shift();
		if (!reply) throw new Error(`unexpected fetch ${url}`);
		if (reply instanceof Error) throw reply;
		return new Response(JSON.stringify(reply.body), {
			status: reply.status ?? 200,
			headers: { "Content-Type": "application/json" },
		});
	};
	return { fetch, calls };
}

export function product(overrides: Record<string, unknown> = {}) {
	return {
		id: "p1",
		handle: "cat-sticker",
		title: "Cat Sticker",
		url: "https://avdeb.com/store/cat-sticker/?ref=ABC12345",
		image: "https://cdn.avdeb.com/cat.webp",
		price: 4.9,
		compare_at_price: null,
		currency: "USD",
		type: "Sticker",
		tags: ["stickers", "cats"],
		creator: { slug: "cleo", name: "Cleo", url: "https://avdeb.com/creators/cleo/?ref=ABC12345" },
		created_at: "2026-09-30T10:00:00Z",
		...overrides,
	};
}

export function productsBody(products: unknown[], extra: Record<string, unknown> = {}) {
	return { products, next_cursor: null, ref: "ABC12345", tier: "secret", ...extra };
}

export const SECRET_KEY = "avdeb_sk_" + "a1B2c3D4".repeat(4);

/** Minimal stand-in for an EmDash RouteContext (only what the plugin touches). */
export function fakeCtx(opts: {
	settings?: Record<string, unknown>;
	input?: unknown;
	fetch?: (url: string, init?: RequestInit) => Promise<Response>;
	kv?: MemoryKV;
}) {
	const settings = opts.settings ?? {};
	const warnings: unknown[] = [];
	return {
		input: opts.input,
		kv: opts.kv ?? new MemoryKV(),
		settings: {
			get: async (key: string) => (key in settings ? settings[key] : null),
		},
		http: opts.fetch ? { fetch: opts.fetch } : undefined,
		log: {
			debug() {},
			info() {},
			warn: (...args: unknown[]) => warnings.push(args),
			error() {},
		},
		warnings,
		// eslint-disable-next-line typescript/no-explicit-any -- structural stand-in for RouteContext
	} as any;
}
