import fs from 'fs';
import path from 'path';
import {
  SPARQL_ENDPOINT,
  USER_AGENT,
  CURRENT_YEAR,
  PD_DEATH_YEARS_AGO,
  MIN_SIZE_CM,
  ASPECT_RATIO_MIN,
  ASPECT_RATIO_MAX,
  RAW_DIR,
  DATA_DIR,
  BATCH_DELAY_MS,
  TIME_BUCKETS,
  splitBucket,
} from './config.js';
import type { SparqlBinding, SparqlResponse, Artwork, BatchResult, FetchLog, TimeBucket } from './types.js';

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

function buildQuery(timeFilter: string): string {
  return `
SELECT DISTINCT ?painting ?paintingLabel ?height ?width ?inception ?image ?creatorLabel ?creatorDeathYear ?locationLabel ?inventoryNumber ?mediumLabel
WHERE {
  # Painting or subclass of painting
  ?painting wdt:P31/wdt:P279* wd:Q3305213 .

  # Height in cm
  ?painting p:P2048 ?heightStatement .
  ?heightStatement psv:P2048 ?heightValue .
  ?heightValue wikibase:quantityAmount ?height .
  ?heightValue wikibase:quantityUnit wd:Q174728 .

  # Width in cm
  ?painting p:P2049 ?widthStatement .
  ?widthStatement psv:P2049 ?widthValue .
  ?widthValue wikibase:quantityAmount ?width .
  ?widthValue wikibase:quantityUnit wd:Q174728 .

  # Near-square aspect ratio
  FILTER(?width / ?height >= ${ASPECT_RATIO_MIN} && ?width / ?height <= ${ASPECT_RATIO_MAX})

  # Minimum size
  FILTER(?height >= ${MIN_SIZE_CM} && ?width >= ${MIN_SIZE_CM})

  # Must have image
  ?painting wdt:P18 ?image .

  # Creator and death year
  OPTIONAL {
    ?painting wdt:P170 ?creator .
    OPTIONAL { ?creator wdt:P570 ?creatorDeath . }
    BIND(YEAR(?creatorDeath) AS ?creatorDeathYear)
  }

  # Creation date
  OPTIONAL { ?painting wdt:P571 ?inception . }

  # Time bucket filter
  ${timeFilter}

  # Location
  OPTIONAL { ?painting wdt:P276 ?location . }

  # Inventory number
  OPTIONAL { ?painting wdt:P217 ?inventoryNumber . }

  # Medium/material
  OPTIONAL { ?painting wdt:P186 ?medium . }

  SERVICE wikibase:label { bd:serviceParam wikibase:language "en,de,fr,es,it,nl" . }
}
ORDER BY DESC(?height)
`;
}

async function fetchSparql(query: string): Promise<SparqlResponse> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 75_000); // 75s timeout

  try {
    const response = await fetch(SPARQL_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Accept': 'application/sparql-results+json',
        'User-Agent': USER_AGENT,
      },
      body: `query=${encodeURIComponent(query)}`,
      signal: controller.signal,
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`SPARQL query failed: ${response.status} ${response.statusText}\n${text.slice(0, 500)}`);
    }

    return response.json() as Promise<SparqlResponse>;
  } finally {
    clearTimeout(timeout);
  }
}

function getWikidataId(uri: string): string | null {
  const match = uri.match(/Q\d+$/);
  return match ? match[0] : null;
}

function determinePublicDomain(creatorDeathYear: number | null, inceptionYear: number | null): { publicDomain: boolean | null; basis: string } {
  if (creatorDeathYear && (CURRENT_YEAR - creatorDeathYear) >= PD_DEATH_YEARS_AGO) {
    return {
      publicDomain: true,
      basis: `Artist died in ${creatorDeathYear}, over 70 years ago.`,
    };
  }

  if (inceptionYear && inceptionYear < 1900) {
    return {
      publicDomain: true,
      basis: `Work created in ${inceptionYear}. Artists from this era are typically deceased 70+ years.`,
    };
  }

  return {
    publicDomain: null,
    basis: 'Public domain status unknown. Requires manual verification.',
  };
}

function transformBinding(binding: SparqlBinding): Artwork | null {
  const height = parseFloat(binding.height?.value ?? '');
  const width = parseFloat(binding.width?.value ?? '');

  if (!height || !width) return null;

  const aspectRatio = Math.round((width / height) * 100) / 100;

  let yearCreated: number | null = null;
  if (binding.inception?.value) {
    const match = binding.inception.value.match(/^-?(\d{4})/);
    if (match) {
      const raw = binding.inception.value;
      yearCreated = raw.startsWith('-') ? -parseInt(match[1]) : parseInt(match[1]);
    }
  }

  // Filter: created before 1970 (if we have date)
  if (yearCreated && yearCreated >= 1970) return null;

  const creatorDeathYear = binding.creatorDeathYear?.value
    ? parseInt(binding.creatorDeathYear.value)
    : null;

  const pd = determinePublicDomain(creatorDeathYear, yearCreated);

  // Skip if not public domain with recent date
  if (yearCreated && yearCreated >= 1954 && !pd.publicDomain) return null;

  const wikidataId = getWikidataId(binding.painting.value);
  if (!wikidataId) return null;

  return {
    id: `wikidata-${wikidataId}`,
    wikidataId,
    title: binding.paintingLabel?.value || 'Untitled',
    artist: binding.creatorLabel?.value || 'Unknown',
    artistDeathYear: creatorDeathYear ?? undefined,
    yearCreated: yearCreated ?? undefined,
    dateDisplay: yearCreated ? String(yearCreated) : 'Unknown',
    medium: binding.mediumLabel?.value || 'Oil on canvas',
    museum: binding.locationLabel?.value || 'Unknown',
    city: '',
    inventoryNumber: binding.inventoryNumber?.value ?? undefined,
    heightCm: Math.round(height * 10) / 10,
    widthCm: Math.round(width * 10) / 10,
    aspectRatio,
    dimensionsRaw: `${Math.round(height)} × ${Math.round(width)} cm`,
    publicDomain: pd.publicDomain,
    publicDomainBasis: pd.basis,
    imageUrl: binding.image.value,
    wikidataUrl: binding.painting.value,
    source: 'wikidata',
  };
}

async function fetchBucket(bucket: TimeBucket): Promise<{ artworks: Artwork[]; result: BatchResult }> {
  const start = Date.now();
  const query = buildQuery(bucket.filter);

  try {
    console.log(`  Fetching ${bucket.name}...`);
    const response = await fetchSparql(query);
    const bindings = response.results.bindings;

    // Deduplicate within batch by Wikidata ID
    const seen = new Set<string>();
    const artworks: Artwork[] = [];

    for (const binding of bindings) {
      const artwork = transformBinding(binding);
      if (!artwork || !artwork.wikidataId) continue;
      if (seen.has(artwork.wikidataId)) continue;
      seen.add(artwork.wikidataId);
      artworks.push(artwork);
    }

    const duration = Date.now() - start;
    console.log(`  ${bucket.name}: ${artworks.length} artworks (${(duration / 1000).toFixed(1)}s)`);

    return {
      artworks,
      result: { name: bucket.name, count: artworks.length, duration },
    };
  } catch (err) {
    const duration = Date.now() - start;
    const message = err instanceof Error ? err.message : String(err);
    console.error(`  ${bucket.name}: FAILED (${(duration / 1000).toFixed(1)}s) - ${message.slice(0, 200)}`);

    return {
      artworks: [],
      result: { name: bucket.name, count: 0, duration, error: message.slice(0, 500) },
    };
  }
}

async function main(): Promise<void> {
  console.log('Wikidata SPARQL Fetcher');
  console.log('======================');
  console.log(`Constraints: ${MIN_SIZE_CM}cm min, ${ASPECT_RATIO_MIN}-${ASPECT_RATIO_MAX} ratio`);
  console.log(`Batches: ${TIME_BUCKETS.length} time periods`);
  console.log('');

  fs.mkdirSync(RAW_DIR, { recursive: true });

  const allArtworks: Artwork[] = [];
  const batchResults: BatchResult[] = [];
  const globalSeen = new Set<string>();

  // Recursively fetch a bucket, splitting on failure (max 2 levels deep)
  async function fetchWithRetry(bucket: TimeBucket, depth: number): Promise<Artwork[]> {
    const { artworks, result } = await fetchBucket(bucket);

    if (!result.error) {
      batchResults.push(result);
      return artworks;
    }

    // Try splitting into sub-buckets
    const subBuckets = splitBucket(bucket);
    if (subBuckets.length <= 1 || depth >= 2) {
      console.log(`  Cannot split ${bucket.name} further, skipping`);
      batchResults.push(result);
      return [];
    }

    console.log(`  Retrying ${bucket.name} as ${subBuckets.length} sub-buckets...`);
    const allSubArtworks: Artwork[] = [];
    for (const sub of subBuckets) {
      await sleep(BATCH_DELAY_MS);
      const subArtworks = await fetchWithRetry(sub, depth + 1);
      allSubArtworks.push(...subArtworks);
    }
    return allSubArtworks;
  }

  for (let i = 0; i < TIME_BUCKETS.length; i++) {
    const bucket = TIME_BUCKETS[i];
    const artworks = await fetchWithRetry(bucket, 0);

    // Global dedup
    for (const art of artworks) {
      if (art.wikidataId && !globalSeen.has(art.wikidataId)) {
        globalSeen.add(art.wikidataId);
        allArtworks.push(art);
      }
    }

    // Save batch
    const batchFile = path.join(RAW_DIR, `${bucket.name}.json`);
    fs.writeFileSync(batchFile, JSON.stringify({ bucket: bucket.name, count: artworks.length, artworks }, null, 2));

    // Delay between batches
    if (i < TIME_BUCKETS.length - 1) {
      console.log(`  Waiting ${BATCH_DELAY_MS / 1000}s before next batch...`);
      await sleep(BATCH_DELAY_MS);
    }
  }

  // Summary
  console.log('\n=== Fetch Summary ===');
  console.log(`Total unique artworks: ${allArtworks.length}`);
  for (const r of batchResults) {
    const status = r.error ? `FAILED: ${r.error.slice(0, 80)}` : `${r.count} artworks`;
    console.log(`  ${r.name}: ${status}`);
  }

  // Save fetch log
  const log: FetchLog = {
    timestamp: new Date().toISOString(),
    batches: batchResults,
    totalUnique: allArtworks.length,
  };
  fs.writeFileSync(path.join(DATA_DIR, 'fetch-log.json'), JSON.stringify(log, null, 2));

  console.log(`\nSaved ${allArtworks.length} artworks across ${batchResults.length} batches to ${RAW_DIR}`);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
