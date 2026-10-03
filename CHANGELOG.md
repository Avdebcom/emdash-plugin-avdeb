# Changelog

## 0.1.1 — 2026-10-03

- Fix: product photos were cropped and cards restyled when an embed sat inside a post body whose theme
  styles bare elements (e.g. `.article-content img { margin: 1.75em 0 }`, global `img { height: auto }`,
  `.article-content a { text-decoration: underline }`, `article h3 { font-size }`). Layout-critical
  resets now use real class specificity; the rest stays `:where()`-wrapped. New tokens
  `--avdeb-title-size`, `--avdeb-title-leading`, `--avdeb-heading-size`, `--avdeb-items-margin`,
  `--avdeb-items-pad`, `--avdeb-link-deco`, `--avdeb-btn-bg`, `--avdeb-btn-color`. The embed root gets
  `not-prose` (Tailwind Typography).

## 0.1.0 — 2026-10-03

- First release: AVDEB Products / AVDEB Product / AVDEB Button Portable Text blocks; grid, carousel, list
  and spotlight layouts; horizontal, hero and compact single-product styles; template components
  (`emdash-plugin-avdeb/ui`); settings with encrypted secret key; KV cache with stale fallback, request
  budget and daily cleanup; Block Kit overview page and dashboard widget; `search_avdeb_products` MCP tool.
