import fs from 'fs';
import path from 'path';
import sharp from 'sharp';
import {
  DATA_DIR,
  THUMBNAILS_DIR,
  RATE_LIMIT_MS,
  MAX_RETRIES,
  USER_AGENT,
} from './config.js';
import type { Artwork, ArtworksFile, DownloadFailure } from './types.js';

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

function getWikimediaThumbUrl(originalUrl: string, width: number = 400): string {
  if (originalUrl.includes('Special:FilePath')) {
    return originalUrl.replace('http://', 'https://') + `?width=${width}`;
  }
  return originalUrl;
}

async function downloadWithRetry(url: string, retries: number = MAX_RETRIES): Promise<Buffer> {
  let lastError: Error | undefined;

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, {
        headers: {
          'User-Agent': USER_AGENT,
          'Accept': 'image/*,*/*;q=0.8',
        },
        redirect: 'follow',
      });

      if (!res.ok) {
        throw new Error(`HTTP ${res.status} ${res.statusText}`);
      }

      const contentType = res.headers.get('content-type') || '';
      if (!contentType.startsWith('image/')) {
        throw new Error(`Not an image: ${contentType}`);
      }

      const buffer = Buffer.from(await res.arrayBuffer());

      if (buffer.length < 1000) {
        throw new Error(`Image too small: ${buffer.length} bytes`);
      }

      return buffer;
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      if (attempt < retries) {
        const backoff = Math.pow(2, attempt) * 1000;
        console.log(`    Retry ${attempt}/${retries} after ${backoff}ms: ${lastError.message}`);
        await sleep(backoff);
      }
    }
  }

  throw new Error(`Failed after ${retries} retries: ${lastError?.message}`);
}

async function main(): Promise<void> {
  console.log('Thumbnail Downloader');
  console.log('====================\n');

  // Read artworks
  const dataPath = path.join(DATA_DIR, 'all-artworks.json');
  if (!fs.existsSync(dataPath)) {
    console.error('Run merge-data.ts first! No all-artworks.json found.');
    process.exit(1);
  }

  const data: ArtworksFile = JSON.parse(fs.readFileSync(dataPath, 'utf-8'));
  const artworks = data.artworks;
  console.log(`Processing ${artworks.length} artworks`);

  // Ensure thumbnail directory exists
  fs.mkdirSync(THUMBNAILS_DIR, { recursive: true });

  // Scan for existing thumbnails
  const existingThumbs = new Set(
    fs.readdirSync(THUMBNAILS_DIR)
      .filter(f => f.endsWith('.jpg'))
      .map(f => f.replace('.jpg', ''))
  );
  console.log(`Existing thumbnails: ${existingThumbs.size}`);

  // Filter to artworks needing thumbnails
  const needsDownload = artworks.filter(a => !existingThumbs.has(a.id));
  console.log(`Need to download: ${needsDownload.length}\n`);

  if (needsDownload.length === 0) {
    console.log('All thumbnails already exist!');
    return;
  }

  let downloaded = 0;
  let failed = 0;
  const failures: DownloadFailure[] = [];

  for (let i = 0; i < needsDownload.length; i++) {
    const art = needsDownload[i];

    if (!art.imageUrl) {
      failed++;
      failures.push({ id: art.id, title: art.title, artist: art.artist, url: '', error: 'No image URL' });
      continue;
    }

    const downloadUrl = getWikimediaThumbUrl(art.imageUrl, 400);
    const thumbPath = path.join(THUMBNAILS_DIR, `${art.id}.jpg`);

    try {
      await sleep(RATE_LIMIT_MS);
      const buffer = await downloadWithRetry(downloadUrl);

      // Resize to 200x200 using sharp with cover crop (center)
      await sharp(buffer)
        .resize(200, 200, { fit: 'cover', position: 'centre' })
        .jpeg({ quality: 80 })
        .toFile(thumbPath);

      downloaded++;

      if ((downloaded + failed) % 100 === 0) {
        console.log(`  Progress: ${downloaded + failed}/${needsDownload.length} (${downloaded} OK, ${failed} failed)`);
      }
    } catch (err) {
      failed++;
      const message = err instanceof Error ? err.message : String(err);
      failures.push({
        id: art.id,
        title: art.title,
        artist: art.artist,
        url: downloadUrl,
        error: message,
      });

      if (failed <= 10) {
        console.log(`  FAILED [${i + 1}]: "${art.title}" - ${message.slice(0, 100)}`);
      }
    }
  }

  console.log('\n====================');
  console.log('Download Summary');
  console.log('====================');
  console.log(`Downloaded: ${downloaded}`);
  console.log(`Failed: ${failed}`);
  console.log(`Already existed: ${existingThumbs.size}`);
  console.log(`Total thumbnails: ${existingThumbs.size + downloaded}`);

  if (failures.length > 0) {
    const failPath = path.join(DATA_DIR, 'download-failures.json');
    fs.writeFileSync(failPath, JSON.stringify({ failures, timestamp: new Date().toISOString() }, null, 2));
    console.log(`\nSaved ${failures.length} failures to ${failPath}`);
  }
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
