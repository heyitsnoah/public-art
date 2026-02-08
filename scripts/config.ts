import path from 'path';
import { fileURLToPath } from 'url';
import type { TimeBucket } from './types.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const PROJECT_ROOT = path.join(__dirname, '..');
export const DATA_DIR = path.join(PROJECT_ROOT, 'data');
export const RAW_DIR = path.join(DATA_DIR, 'wikidata-raw');
export const DIST_DIR = path.join(PROJECT_ROOT, 'dist');
export const THUMBNAILS_DIR = path.join(DIST_DIR, 'thumbnails');

export const SPARQL_ENDPOINT = 'https://query.wikidata.org/sparql';
export const USER_AGENT = 'PublicDomainArtworkResearch/2.0 (noah@noahbrier.com; public domain artwork catalog)';

export const CURRENT_YEAR = 2026;
export const PD_DEATH_YEARS_AGO = 70;

export const MIN_SIZE_CM = 100;
export const ASPECT_RATIO_MIN = 0.85;
export const ASPECT_RATIO_MAX = 1.15;

export const RATE_LIMIT_MS = 1000;
export const MAX_RETRIES = 3;
export const BATCH_DELAY_MS = 5000;

export const TIME_BUCKETS: TimeBucket[] = [
  { name: 'pre-1400', filter: 'FILTER(YEAR(?inception) < 1400)' },
  { name: '1400-1499', filter: 'FILTER(YEAR(?inception) >= 1400 && YEAR(?inception) < 1500)' },
  { name: '1500-1599', filter: 'FILTER(YEAR(?inception) >= 1500 && YEAR(?inception) < 1600)' },
  { name: '1600-1699', filter: 'FILTER(YEAR(?inception) >= 1600 && YEAR(?inception) < 1700)' },
  { name: '1700-1799', filter: 'FILTER(YEAR(?inception) >= 1700 && YEAR(?inception) < 1800)' },
  { name: '1800-1899', filter: 'FILTER(YEAR(?inception) >= 1800 && YEAR(?inception) < 1900)' },
  { name: '1900-1969', filter: 'FILTER(YEAR(?inception) >= 1900 && YEAR(?inception) < 1970)' },
  { name: 'no-date', filter: 'FILTER(!BOUND(?inception))' },
];

// Sub-buckets for retry on timeout
export function splitBucket(bucket: TimeBucket): TimeBucket[] {
  // Handle pre-1400: split into centuries
  if (bucket.name === 'pre-1400') {
    return [
      { name: 'pre-1200', filter: 'FILTER(YEAR(?inception) < 1200)' },
      { name: '1200-1299', filter: 'FILTER(YEAR(?inception) >= 1200 && YEAR(?inception) < 1300)' },
      { name: '1300-1399', filter: 'FILTER(YEAR(?inception) >= 1300 && YEAR(?inception) < 1400)' },
    ];
  }

  const match = bucket.name.match(/^(\d{4})-(\d{4})$/);
  if (!match) return [bucket]; // Can't split no-date

  const start = parseInt(match[1]);
  const end = parseInt(match[2]);
  const span = end - start + 1;

  // Split in half
  const half = Math.floor(span / 2);
  if (half < 10) return [bucket]; // Don't split below 10-year windows

  const mid = start + half;
  return [
    { name: `${start}-${mid - 1}`, filter: `FILTER(YEAR(?inception) >= ${start} && YEAR(?inception) < ${mid})` },
    { name: `${mid}-${end}`, filter: `FILTER(YEAR(?inception) >= ${mid} && YEAR(?inception) < ${end + 1})` },
  ];
}
