import fs from 'fs';
import path from 'path';
import sharp from 'sharp';
import { DIST_DIR, THUMBNAILS_DIR, DATA_DIR } from './config.js';
import type { ArtworksFile } from './types.js';

async function main(): Promise<void> {
  console.log('Generating OG image...');

  // Read artworks to get IDs
  const data: ArtworksFile = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'all-artworks.json'), 'utf-8'));
  const artworks = data.artworks;

  // Pick random artworks that have thumbnails
  const thumbSet = new Set(
    fs.readdirSync(THUMBNAILS_DIR).filter(f => f.endsWith('.jpg')).map(f => f.replace('.jpg', ''))
  );
  const withThumbs = artworks.filter(a => thumbSet.has(a.id));

  // Shuffle and pick 48 (8x6 grid)
  const shuffled = withThumbs.sort(() => Math.random() - 0.5);
  const picks = shuffled.slice(0, 48);

  // OG image: 1200x630 (standard)
  // Grid: 8 cols x 6 rows = 48 cells, each 150x105
  const cols = 8;
  const rows = 6;
  const cellW = 150;
  const cellH = 105;
  const width = cols * cellW;  // 1200
  const height = rows * cellH; // 630

  // Resize each thumbnail and compose
  const composites: sharp.OverlayOptions[] = [];

  for (let i = 0; i < picks.length; i++) {
    const row = Math.floor(i / cols);
    const col = i % cols;
    const thumbPath = path.join(THUMBNAILS_DIR, `${picks[i].id}.jpg`);

    if (!fs.existsSync(thumbPath)) continue;

    const resized = await sharp(thumbPath)
      .resize(cellW, cellH, { fit: 'cover' })
      .toBuffer();

    composites.push({
      input: resized,
      left: col * cellW,
      top: row * cellH,
    });
  }

  // Create base image and composite thumbnails
  const base = sharp({
    create: { width, height, channels: 3, background: { r: 18, g: 18, b: 18 } },
  });

  // Add dark overlay + text via SVG
  const textOverlay = Buffer.from(`
    <svg width="${width}" height="${height}">
      <rect width="100%" height="100%" fill="rgba(0,0,0,0.55)"/>
      <text x="600" y="270" text-anchor="middle" font-family="Georgia, serif" font-size="72" font-weight="bold" fill="white">The Square Canvas</text>
      <text x="600" y="340" text-anchor="middle" font-family="Arial, sans-serif" font-size="24" fill="rgba(255,255,255,0.8)">${artworks.length.toLocaleString()} public domain artworks from museums worldwide</text>
    </svg>
  `);

  composites.push({ input: textOverlay, left: 0, top: 0 });

  await base
    .composite(composites)
    .jpeg({ quality: 85 })
    .toFile(path.join(DIST_DIR, 'og-image.jpg'));

  console.log(`Generated ${path.join(DIST_DIR, 'og-image.jpg')} (1200x630)`);
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
