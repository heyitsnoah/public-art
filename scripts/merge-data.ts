import fs from 'fs';
import path from 'path';
import {
  DATA_DIR,
  RAW_DIR,
  MIN_SIZE_CM,
  ASPECT_RATIO_MIN,
  ASPECT_RATIO_MAX,
} from './config.js';
import type { Artwork, ArtworksFile } from './types.js';

// Load city mapping
const cityMappingPath = path.join(path.dirname(new URL(import.meta.url).pathname), 'city-mapping.json');
const cityMapping: { museumCities: Record<string, string>; cityRanks: Record<string, number> } =
  JSON.parse(fs.readFileSync(cityMappingPath, 'utf-8'));

const MUSEUM_CITIES = cityMapping.museumCities;
const CITY_RANKS = cityMapping.cityRanks;

function normalizeTitle(title: string): string {
  return (title || '')
    .toLowerCase()
    .replace(/[^\w\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeArtist(artist: string): string {
  return (artist || '')
    .toLowerCase()
    .replace(/[^\w\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function getCityForMuseum(museum: string): string {
  if (!museum) return '';

  // Direct lookup
  if (MUSEUM_CITIES[museum]) return MUSEUM_CITIES[museum];

  // Partial match
  for (const [key, city] of Object.entries(MUSEUM_CITIES)) {
    if (museum.toLowerCase().includes(key.toLowerCase()) ||
        key.toLowerCase().includes(museum.toLowerCase())) {
      return city;
    }
  }

  return '';
}

function main(): void {
  console.log('Merge & Deduplicate');
  console.log('===================\n');

  // 1. Read all batch results from wikidata-raw
  const rawFiles = fs.readdirSync(RAW_DIR).filter(f => f.endsWith('.json'));
  console.log(`Found ${rawFiles.length} batch files in ${RAW_DIR}`);

  const newArtworks: Artwork[] = [];
  for (const file of rawFiles) {
    const data = JSON.parse(fs.readFileSync(path.join(RAW_DIR, file), 'utf-8'));
    const artworks: Artwork[] = data.artworks || [];
    newArtworks.push(...artworks);
    console.log(`  ${file}: ${artworks.length} artworks`);
  }
  console.log(`Total from Wikidata batches: ${newArtworks.length}`);

  // 2. Read existing seed data
  const existingPath = path.join(DATA_DIR, 'existing-artworks.json');
  let existingArtworks: Artwork[] = [];
  if (fs.existsSync(existingPath)) {
    const existing: ArtworksFile = JSON.parse(fs.readFileSync(existingPath, 'utf-8'));
    existingArtworks = existing.artworks;
    console.log(`Existing seed data: ${existingArtworks.length} artworks`);
  } else {
    console.log('No existing seed data found, starting fresh');
  }

  // 3. Three-tier deduplication
  // Build indexes from existing data
  const seenByWikidataId = new Map<string, Artwork>();
  const seenByTitleMuseum = new Map<string, Artwork>();
  const seenByTitleArtist = new Map<string, Artwork>();
  const merged: Artwork[] = [];

  // Add existing artworks first (they have priority for museum URLs etc.)
  for (const art of existingArtworks) {
    if (art.wikidataId) seenByWikidataId.set(art.wikidataId, art);

    const tmKey = `${normalizeTitle(art.title)}|||${(art.museum || '').toLowerCase().trim()}`;
    seenByTitleMuseum.set(tmKey, art);

    const taKey = `${normalizeTitle(art.title)}|||${normalizeArtist(art.artist)}`;
    seenByTitleArtist.set(taKey, art);

    merged.push(art);
  }

  console.log(`\nDeduplicating new artworks against ${merged.length} existing...`);

  let addedNew = 0;
  let skippedDupe = 0;
  let updatedExisting = 0;

  for (const art of newArtworks) {
    // Tier 1: Wikidata ID match
    if (art.wikidataId && seenByWikidataId.has(art.wikidataId)) {
      const existing = seenByWikidataId.get(art.wikidataId)!;
      // Merge any missing fields from new data
      if (!existing.medium || existing.medium === 'Oil on canvas') {
        if (art.medium && art.medium !== 'Oil on canvas') {
          existing.medium = art.medium;
          updatedExisting++;
        }
      }
      skippedDupe++;
      continue;
    }

    // Tier 2: Title + museum match
    const tmKey = `${normalizeTitle(art.title)}|||${(art.museum || '').toLowerCase().trim()}`;
    if (seenByTitleMuseum.has(tmKey)) {
      skippedDupe++;
      continue;
    }

    // Tier 3: Title + artist match
    const taKey = `${normalizeTitle(art.title)}|||${normalizeArtist(art.artist)}`;
    if (seenByTitleArtist.has(taKey)) {
      skippedDupe++;
      continue;
    }

    // New artwork - add it
    if (art.wikidataId) seenByWikidataId.set(art.wikidataId, art);
    seenByTitleMuseum.set(tmKey, art);
    seenByTitleArtist.set(taKey, art);
    merged.push(art);
    addedNew++;
  }

  console.log(`  Added new: ${addedNew}`);
  console.log(`  Skipped duplicates: ${skippedDupe}`);
  console.log(`  Updated existing: ${updatedExisting}`);
  console.log(`  Pre-validation total: ${merged.length}`);

  // 4. Apply city mapping
  let citiesMapped = 0;
  const unmappedMuseums = new Map<string, number>();

  for (const art of merged) {
    if (!art.city) {
      art.city = getCityForMuseum(art.museum);
      if (art.city) citiesMapped++;
    }
    art.cityRank = CITY_RANKS[art.city] || 999;

    if (!art.city && art.museum && art.museum !== 'Unknown') {
      unmappedMuseums.set(art.museum, (unmappedMuseums.get(art.museum) || 0) + 1);
    }
  }
  console.log(`\nCity mapping: ${citiesMapped} museums mapped to cities`);

  // 5. Validate
  const validated: Artwork[] = [];
  let rejected = 0;

  for (const art of merged) {
    // Must have dimensions
    if (!art.heightCm || !art.widthCm) { rejected++; continue; }

    // Aspect ratio check (relaxed)
    const ratio = art.widthCm / art.heightCm;
    if (ratio < ASPECT_RATIO_MIN || ratio > ASPECT_RATIO_MAX) { rejected++; continue; }

    // Size check (relaxed)
    if (art.heightCm < MIN_SIZE_CM || art.widthCm < MIN_SIZE_CM) { rejected++; continue; }

    // Must have image
    if (!art.imageUrl) { rejected++; continue; }

    // Not explicitly non-public-domain
    if (art.publicDomain === false) { rejected++; continue; }

    validated.push(art);
  }

  console.log(`\nValidation: ${validated.length} passed, ${rejected} rejected`);

  // Sort by city rank, museum, year
  validated.sort((a, b) => {
    const rankA = a.cityRank ?? 999;
    const rankB = b.cityRank ?? 999;
    if (rankA !== rankB) return rankA - rankB;
    if (a.museum !== b.museum) return (a.museum || '').localeCompare(b.museum || '');
    return (a.yearCreated || 0) - (b.yearCreated || 0);
  });

  // Build summary stats
  const byMuseum: Record<string, number> = {};
  const byCity: Record<string, number> = {};
  for (const art of validated) {
    byMuseum[art.museum || 'Unknown'] = (byMuseum[art.museum || 'Unknown'] || 0) + 1;
    byCity[art.city || 'Unknown'] = (byCity[art.city || 'Unknown'] || 0) + 1;
  }

  const museumCount = Object.keys(byMuseum).length;

  const output: ArtworksFile = {
    summary: {
      totalArtworks: validated.length,
      totalRejected: rejected,
      withImages: validated.length,
      byMuseum,
      byCity,
      consolidatedAt: new Date().toISOString(),
    },
    artworks: validated,
  };

  // Write output
  const outputPath = path.join(DATA_DIR, 'all-artworks.json');
  fs.writeFileSync(outputPath, JSON.stringify(output, null, 2));
  console.log(`\nSaved ${validated.length} artworks to ${outputPath}`);
  console.log(`Museums: ${museumCount}`);

  // Log unmapped museums
  if (unmappedMuseums.size > 0) {
    console.log(`\nUnmapped museums (${unmappedMuseums.size}):`);
    const sorted = [...unmappedMuseums.entries()].sort((a, b) => b[1] - a[1]);
    for (const [museum, count] of sorted.slice(0, 30)) {
      console.log(`  ${museum}: ${count}`);
    }
    if (sorted.length > 30) {
      console.log(`  ... and ${sorted.length - 30} more`);
    }
  }
}

main();
