import { Config } from '../config/index.js';
import { MediaInfo } from './ProviderService.js';

export interface TMDBSearchResult {
  id: number;
  title?: string;
  name?: string;
  release_date?: string;
  first_air_date?: string;
  overview: string;
  poster_path?: string;
  backdrop_path?: string;
  media_type?: 'movie' | 'tv';
  vote_average: number;
}

export class TMDBService {
  private config: Config;

  constructor(config: Config) {
    this.config = config;
  }

  async getMovieDetails(tmdbId: string): Promise<MediaInfo> {
    console.log(`📡 Fetching TMDB movie details for ID: ${tmdbId}`);

    try {
      console.log(`🔄 Using Cloudflare proxy for movie details...`);
      const movie = await this.fetchFromProxy(`movie/${tmdbId}?append_to_response=external_ids`);

      console.log(`✅ Movie details successful via Cloudflare proxy`);
      return {
        type: 'movie',
        title: movie.title,
        releaseYear: parseInt(movie.release_date.split('-')[0]),
        tmdbId,
        imdbId: movie.external_ids?.imdb_id || '',
      };
    } catch (error) {
      console.error('❌ TMDB movie fetch error:', error);
      throw new Error(`Failed to fetch movie details from TMDB: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  async getShowDetails(tmdbId: string, seasonNumber: number, episodeNumber: number): Promise<MediaInfo> {
    console.log(`📡 Fetching TMDB show details for ID: ${tmdbId} S${seasonNumber}E${episodeNumber}`);

    try {
      console.log(`🔄 Using Cloudflare proxy for show details...`);

      // Fetch series, season, and episode details concurrently
      const [series, season, episode] = await Promise.all([
        this.fetchFromProxy(`tv/${tmdbId}?append_to_response=external_ids`),
        this.fetchFromProxy(`tv/${tmdbId}/season/${seasonNumber}`),
        this.fetchFromProxy(`tv/${tmdbId}/season/${seasonNumber}/episode/${episodeNumber}`),
      ]);

      return {
        type: 'show',
        title: series.name,
        releaseYear: parseInt(series.first_air_date.split('-')[0]),
        tmdbId,
        imdbId: series.external_ids?.imdb_id || '',
        season: {
          number: seasonNumber,
          tmdbId: season.id.toString(),
        },
        episode: {
          number: episodeNumber,
          tmdbId: episode.id.toString(),
        },
      };
    } catch (error) {
      console.error('❌ TMDB show fetch error:', error);
      throw new Error(`Failed to fetch show details from TMDB: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  private async fetchFromProxy(path: string): Promise<any> {
    const url = `${this.config.proxyUrl}/tmdb-proxy/${path}`;

    const response = await fetch(url, {
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      },
      signal: AbortSignal.timeout(12000),
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    return await response.json();
  }

  async searchContent(query: string, type: 'movie' | 'tv' | 'multi' = 'multi', page: number = 1): Promise<{ results: TMDBSearchResult[]; total_pages: number; total_results: number }> {
    console.log(`🔍 Searching TMDB: "${query}" (type: ${type})`);

    try {
      console.log(`🔄 Using Cloudflare proxy for search...`);
      const result = await this.fetchFromProxy(`search/${type}?query=${encodeURIComponent(query)}&page=${page}`);

      console.log(`✅ Search successful via Cloudflare proxy`);
      return result;

    } catch (error) {
      console.error('❌ TMDB search error:', error);
      throw new Error(`Failed to search TMDB: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }
}
