# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
pnpm build          # Generate dist/ from data/all-artworks.json + src/
pnpm clean          # Remove dist/
pnpm run fetch-data  # Fetch artworks from Wikidata SPARQL (~5-10 min)
pnpm merge           # Deduplicate and merge into data/all-artworks.json
pnpm download        # Download thumbnails to dist/thumbnails/ (~60-90 min)
pnpm pipeline        # Run fetch → merge → download in sequence
pnpm lint            # TypeScript type checking (tsc --noEmit)
pnpm typecheck       # Same as lint
```

Use `pnpm lint` for linting. There is no test suite.

## Architecture

Three execution environments coexist:

- **`scripts/`** — TypeScript (ESM), run via `tsx`. Data acquisition and processing pipeline.
- **`build.js`** — CommonJS Node.js. Reads processed data, inlines CSS/JS into HTML, outputs `dist/`.
- **`src/`** — Vanilla browser JS (no framework). Single-page app with infinite scroll, filters, modal.

The `tsconfig.json` uses `module: "preserve"` + `moduleResolution: "bundler"` to avoid CJS/ESM conflicts between `build.js` (CJS) and `scripts/` (ESM via tsx).

## Data Pipeline

```
Wikidata SPARQL → data/wikidata-raw/*.json → data/all-artworks.json → dist/data.json
                  (fetch)                    (merge)                   (build)
                                                                       dist/thumbnails/
                                                                       (download)
```

1. **fetch-wikidata.ts** — Queries Wikidata in 8 century-based batches to avoid 60s timeout. Uses subclass hierarchy (`wdt:P31/wdt:P279*`) for broader painting coverage. Auto-splits batches on timeout.
2. **merge-data.ts** — Three-tier dedup: Wikidata ID → title+museum → title+artist. Applies city mapping from `scripts/city-mapping.json`. Validates dimensions, aspect ratio, public domain status.
3. **download-thumbnails.ts** — Rate-limited (1 req/sec) with exponential backoff. Uses `sharp` to resize to 200×200 JPEG with center crop. Skips existing thumbnails.
4. **build.js** — Additional title+museum dedup, compacts to short keys, inlines CSS/JS, injects dynamic artwork/museum counts into HTML.

## Key Conventions

**Data format in `dist/data.json`** uses short keys: `i` (id), `t` (title), `a` (artist), `y` (year), `d` (dateDisplay), `m` (medium), `u` (museum), `c` (city), `h`/`w` (height/width), `img` (imageUrl), `cn` (century), `wd` (wikidataUrl), `mu` (museumUrl).

**Artwork IDs**: `wikidata-{Q-number}` for Wikidata-sourced entries.

**Thumbnails**: `dist/thumbnails/{id}.jpg` — 200×200 JPEG, 80% quality.

**Filtering constraints**: ≥100cm minimum dimension, 0.85–1.15 aspect ratio, pre-1970 creation, public domain (artist died 70+ years ago or pre-1900).

## Frontend (src/app.js)

Vanilla JS IIFE. Fetches `data.json` once, then all filtering/sorting/search is client-side in-memory. Uses `IntersectionObserver` for infinite scroll (60 items per chunk), native `<dialog>` for modal, URL params for deep linking (`?q=`, `?c=`, `?m=`).

## Deploy

Cloudflare Pages from `dist/`. Auto-deploys on push to `main`. Uses `pnpm` as package manager. Sharp requires approved build scripts (`pnpm.onlyBuiltDependencies` in package.json).
