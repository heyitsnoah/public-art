# The Square Canvas

An atlas of 2,209 public domain paintings in perfect square format from 692 museums worldwide.

**Live site:** [public-art.pages.dev](https://public-art.pages.dev)

## Features

- Dark, immersive gallery aesthetic inspired by museum collection sites
- Search across artists, titles, museums, and media
- Filter by century (BCE through 20th) and museum
- Sort by year, title, or artist
- Infinite scroll with progressive loading
- Detail modal with metadata and links to high-resolution originals
- Deep linking via URL parameters
- Fully static — no framework, no dependencies, vanilla HTML/CSS/JS

## Data

Artwork metadata sourced from Wikidata and museum open-access APIs. All artworks are in the public domain. Thumbnails are 200x200 JPEG crops.

## Build

```bash
node build.js
```

Reads source data from an Obsidian vault, generates `dist/` with:
- `index.html` — single HTML file with inlined CSS and JS
- `data.json` — compressed artwork metadata (~900KB)
- `thumbnails/` — 2,225 JPEG thumbnails (~25MB)
- `_headers` — Cloudflare Pages cache config

## Deploy

Deployed to Cloudflare Pages via GitHub integration. Auto-deploys on push to `main`.

## License

MIT

## Credits

Built by [Noah Brier](https://noahbrier.com) with support from [Alephic](https://alephic.com).
