/**
 * Site-side Portable Text renderers. EmDash merges `blockComponents` into <PortableText>
 * automatically; a site can still override any type via its own `components.types`.
 */

import { BLOCK_TYPES } from "../constants.ts";
import ButtonBlock from "./ButtonBlock.astro";
import ProductBlock from "./ProductBlock.astro";
import ProductsBlock from "./ProductsBlock.astro";

export const blockComponents = {
	[BLOCK_TYPES.products]: ProductsBlock,
	[BLOCK_TYPES.product]: ProductBlock,
	[BLOCK_TYPES.button]: ButtonBlock,
};
