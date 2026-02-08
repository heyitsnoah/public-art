#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const OBSIDIAN_BASE = '/Users/noahbrier/dev/02_Areas/Obsidian';
const SOURCE_JSON = path.join(OBSIDIAN_BASE, '01 Projects/Public Domain Artwork Research/Analysis/all-artworks.json');
const THUMBNAILS_DIR = path.join(OBSIDIAN_BASE, '05 Attachments/Organized/Public Domain Art/thumbnails');

const DIST = path.join(__dirname, 'dist');
const SRC = path.join(__dirname, 'src');

// Ensure dist directories exist
fs.mkdirSync(path.join(DIST, 'thumbnails'), { recursive: true });

// --- 1. Read and transform artwork data ---
console.log('Reading source data...');
const raw = JSON.parse(fs.readFileSync(SOURCE_JSON, 'utf-8'));
const artworks = raw.artworks;
console.log(`  Found ${artworks.length} artworks`);

// Clean artist field: replace Wikidata URIs with "Unknown artist"
function cleanArtist(artist) {
  if (!artist) return 'Unknown artist';
  if (artist.startsWith('http://www.wikidata.org/') || artist.startsWith('https://www.wikidata.org/')) {
    return 'Unknown artist';
  }
  return artist;
}

// Derive century from yearCreated
function getCentury(year) {
  if (year == null) return null;
  if (year <= 0) return 'BCE';
  return Math.ceil(year / 100);
}

// --- Deduplicate artworks ---
// Same artwork often appears from both museum API and Wikidata.
// Key on title + museum to find dupes; prefer museum-sourced entries (have museumUrl).
function dedupeKey(a) {
  const t = (a.title || '').toLowerCase().trim();
  const m = (a.museum || '').toLowerCase().trim();
  return `${t}|||${m}`;
}

const seen = new Map();
const deduped = [];
for (const a of artworks) {
  const key = dedupeKey(a);
  if (seen.has(key)) {
    const existing = seen.get(key);
    // Prefer entry with museumUrl, or the non-wikidata source
    const existingHasMuseumUrl = !!existing.museumUrl;
    const currentHasMuseumUrl = !!a.museumUrl;
    if (!existingHasMuseumUrl && currentHasMuseumUrl) {
      // Replace with this better entry
      const idx = deduped.indexOf(existing);
      deduped[idx] = a;
      seen.set(key, a);
    }
    // Otherwise keep existing
  } else {
    seen.set(key, a);
    deduped.push(a);
  }
}
console.log(`  Deduplicated: ${artworks.length} → ${deduped.length} (removed ${artworks.length - deduped.length} duplicates)`);

// Generate trimmed data with short keys for size optimization
const trimmed = deduped.map(a => {
  const obj = {
    i: a.id,                                    // id
    t: a.title || 'Untitled',                   // title
    a: cleanArtist(a.artist),                   // artist
    y: a.yearCreated,                           // year
    d: a.dateDisplay || '',                     // dateDisplay
    m: a.medium || '',                          // medium
    u: a.museum || '',                          // museum
    c: a.city || 'Location unknown',            // city
    h: a.heightCm,                              // heightCm
    w: a.widthCm,                               // widthCm
    img: a.imageUrl || '',                      // high-res image URL
    cn: getCentury(a.yearCreated),              // century number
  };
  // Add optional URLs
  if (a.wikidataUrl) obj.wd = a.wikidataUrl;
  if (a.museumUrl) obj.mu = a.museumUrl;
  return obj;
});

const dataJson = JSON.stringify(trimmed);
fs.writeFileSync(path.join(DIST, 'data.json'), dataJson);
console.log(`  Generated data.json (${(dataJson.length / 1024).toFixed(0)}KB)`);

// --- 2. Copy thumbnails ---
console.log('Copying thumbnails...');
const thumbFiles = fs.readdirSync(THUMBNAILS_DIR).filter(f => f.endsWith('.jpg'));
let copied = 0;
let missing = 0;

// Build set of artwork IDs for reference
const artworkIds = new Set(artworks.map(a => a.id));

for (const file of thumbFiles) {
  const src = path.join(THUMBNAILS_DIR, file);
  const dest = path.join(DIST, 'thumbnails', file);
  fs.copyFileSync(src, dest);
  copied++;
}

// Check which artworks are missing thumbnails
const thumbSet = new Set(thumbFiles.map(f => f.replace('.jpg', '')));
const missingThumbs = deduped.filter(a => !thumbSet.has(a.id));
if (missingThumbs.length > 0) {
  console.log(`  Warning: ${missingThumbs.length} artworks missing thumbnails:`);
  missingThumbs.forEach(a => console.log(`    - ${a.id}: ${a.title}`));
}

console.log(`  Copied ${copied} thumbnails`);

// --- 3. Build index.html with inlined CSS and JS ---
console.log('Building index.html...');
const htmlTemplate = fs.readFileSync(path.join(SRC, 'index.html'), 'utf-8');
const css = fs.readFileSync(path.join(SRC, 'styles.css'), 'utf-8');
const js = fs.readFileSync(path.join(SRC, 'app.js'), 'utf-8');

let html = htmlTemplate;
html = html.replace('/* __CSS_INLINE__ */', css);
html = html.replace('/* __JS_INLINE__ */', js);

fs.writeFileSync(path.join(DIST, 'index.html'), html);
console.log(`  Generated index.html (${(Buffer.byteLength(html) / 1024).toFixed(0)}KB)`);

// --- 4. Write _headers for Cloudflare Pages ---
const headers = `/thumbnails/*
  Cache-Control: public, max-age=31556952, immutable
/data.json
  Cache-Control: public, max-age=86400
`;
fs.writeFileSync(path.join(DIST, '_headers'), headers);

// --- Summary ---
console.log('\nBuild complete!');
console.log(`  Artworks: ${trimmed.length}`);
console.log(`  Thumbnails: ${copied}`);
console.log(`  Missing thumbnails: ${missingThumbs.length}`);
console.log(`  Output: ${DIST}/`);
