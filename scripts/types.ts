export interface Artwork {
  id: string;
  wikidataId?: string;
  title: string;
  artist: string;
  artistDeathYear?: number;
  yearCreated?: number;
  dateDisplay: string;
  medium: string;
  museum: string;
  city: string;
  cityRank?: number;
  inventoryNumber?: string;
  heightCm: number;
  widthCm: number;
  aspectRatio: number;
  dimensionsRaw: string;
  publicDomain: boolean | null;
  publicDomainBasis: string;
  imageUrl: string;
  thumbnailUrl?: string;
  museumUrl?: string;
  wikidataUrl?: string;
  source: string;
}

export interface SparqlBinding {
  painting: { value: string };
  paintingLabel?: { value: string };
  height?: { value: string };
  width?: { value: string };
  inception?: { value: string };
  image: { value: string };
  creatorLabel?: { value: string };
  creatorDeathYear?: { value: string };
  locationLabel?: { value: string };
  inventoryNumber?: { value: string };
  mediumLabel?: { value: string };
}

export interface SparqlResponse {
  results: {
    bindings: SparqlBinding[];
  };
}

export interface TimeBucket {
  name: string;
  filter: string;
}

export interface FetchLog {
  timestamp: string;
  batches: BatchResult[];
  totalUnique: number;
}

export interface BatchResult {
  name: string;
  count: number;
  duration: number;
  error?: string;
}

export interface ArtworksFile {
  summary: {
    totalArtworks: number;
    totalRejected?: number;
    withImages: number;
    byMuseum: Record<string, number>;
    byCity: Record<string, number>;
    bySource?: Record<string, number>;
    consolidatedAt: string;
  };
  artworks: Artwork[];
}

export interface DownloadFailure {
  id: string;
  title: string;
  artist: string;
  url: string;
  error: string;
}
