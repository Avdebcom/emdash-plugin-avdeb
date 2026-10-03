// Dev-only: lets `tsc` resolve `.astro` imports in src/astro/index.ts and src/ui.ts.
// (.astro files themselves are compiled by Astro in the consuming site.)
declare module "*.astro" {
	const Component: (props: Record<string, unknown>) => unknown;
	export default Component;
}
