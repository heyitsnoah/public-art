#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const SOURCE_JSON = path.join(__dirname, 'data', 'all-artworks.json');
const THUMBNAILS_DIR = path.join(__dirname, 'dist', 'thumbnails');

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

// Filter out artworks without thumbnails
let withThumbs = deduped;
if (fs.existsSync(THUMBNAILS_DIR)) {
  const thumbSet = new Set(
    fs.readdirSync(THUMBNAILS_DIR).filter(f => f.endsWith('.jpg')).map(f => f.replace('.jpg', ''))
  );
  withThumbs = deduped.filter(a => thumbSet.has(a.id));
  const removed = deduped.length - withThumbs.length;
  if (removed > 0) console.log(`  Removed ${removed} artworks without thumbnails`);
}

// Generate trimmed data with short keys for size optimization
const trimmed = withThumbs.map(a => {
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

// --- 2. Count thumbnails ---
let thumbCount = 0;
if (fs.existsSync(THUMBNAILS_DIR)) {
  thumbCount = fs.readdirSync(THUMBNAILS_DIR).filter(f => f.endsWith('.jpg')).length;
}
console.log(`  Thumbnails: ${thumbCount}`);

// --- 3. Build index.html with inlined CSS and JS ---
console.log('Building index.html...');
const htmlTemplate = fs.readFileSync(path.join(SRC, 'index.html'), 'utf-8');
const css = fs.readFileSync(path.join(SRC, 'styles.css'), 'utf-8');
const js = fs.readFileSync(path.join(SRC, 'app.js'), 'utf-8');

let html = htmlTemplate;
html = html.replace('/* __CSS_INLINE__ */', css);
html = html.replace('/* __JS_INLINE__ */', js);

// Inject dynamic counts
const museumSet = new Set(trimmed.map(a => a.u).filter(Boolean));
const artworkCount = trimmed.length.toLocaleString();
const museumCountStr = museumSet.size.toLocaleString();
html = html.replace(/2,209/g, artworkCount);
// Replace the span content first (more specific), then meta description
html = html.replace(/>692<\/span>/g, '>' + museumCountStr + '</span>');
html = html.replace(/692 museums/g, museumCountStr + ' museums');
console.log(`  Injected counts: ${artworkCount} artworks, ${museumCountStr} museums`);

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
console.log(`  Museums: ${museumSet.size}`);
console.log(`  Thumbnails: ${thumbCount}`);
console.log(`  Output: ${DIST}/`);
