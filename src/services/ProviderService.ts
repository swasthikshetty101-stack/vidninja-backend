import {
  makeProviders,
  makeStandardFetcher,
  makeSimpleProxyFetcher,
  targets,
  setM3U8ProxyUrl,
  setProxyUrl,
  ProviderControls,
  ScrapeMedia,
  MovieMedia,
  ShowMedia,
  SourcererOutput,
  Stream,
  HlsBasedStream,
  FileBasedStream
} from '../../../../lib/index.js';
import { Config } from '../config';

export interface MediaInfo {
  type: 'movie' | 'show';
  title: string;
  releaseYear: number;
  tmdbId: string;
  imdbId: string;
  season?: {
    number: number;
    tmdbId: string;
  };
  episode?: {
    number: number;
    tmdbId: string;
  };
}

export interface StreamResult {
  providerId: string;
  providerName: string;
  stream: {
    playlist: string;
    type: string;
    headers?: Record<string, string>;
    captions?: Array<{
      language: string;
      url: string;
      type: string;
    }>;
  };
  scrapedAt: string;
}

export class ProviderService {
  private providers!: ProviderControls;
  private config: Config;
  private fetcher!: any;
  private proxiedFetcher?: any;

  constructor(config: Config) {
    this.config = config;
    this.initializeProviders();
  }

  /**
   * Encode a direct stream URL into payload format to hide the source
   */
  private encodeStreamToPayload(url: string, headers?: Record<string, string>, streamType?: string): string {
    try {
      console.log('🔍 Input URL to encode:', url);

      // Check if the URL is already a payload URL - don't double encode!
      if (url.includes('payload=')) {
        console.log('⚠️ URL is already a payload URL, returning as-is');
        return url;
      }

      // Determine content type based on stream type or URL
      let type = 'mp4';
      if (streamType === 'hls' || url.includes('.m3u8')) {
        type = 'hls';
      } else if (url.includes('.mp4')) {
        type = 'mp4';
      }

      // Create payload object with stream information
      const payloadData = {
        type: type,
        url: url,
        headers: headers || {},
        options: {},
        timestamp: Date.now()
      };

      // Convert to base64
      const payloadJson = JSON.stringify(payloadData);
      const payloadBase64 = btoa(payloadJson);

      // Return as stream proxy URL that Video.js can handle directly
      const streamProxyUrl = `http://localhost:${this.config.port}/api/v1/stream?payload=${payloadBase64}`;

      console.log('🔒 Encoded stream URL to payload format');
      console.log('📦 Original URL hidden, stream proxy created');

      return streamProxyUrl;
    } catch (error) {
      console.warn('⚠️ Failed to encode stream URL to payload:', error);
      return url; // Fallback to original URL
    }
  }

  /**
   * Decode payload URL and extract the actual stream URL (for internal use)
   */
  private decodePayloadUrl(url: string): string {
    try {
      // Check if this is a payload URL
      const payloadMatch = url.match(/[?&]payload=([^&]+)/);
      if (payloadMatch) {
        const payloadBase64 = payloadMatch[1];
        const decodedPayload = atob(payloadBase64);
        const payloadData = JSON.parse(decodedPayload);

        console.log('🔍 Decoded payload for internal processing');

        // Extract the actual URL from the payload
        if (payloadData.url) {
          return payloadData.url;
        }
      }

      // Return original URL if not a payload URL
      return url;
    } catch (error) {
      console.warn('⚠️ Failed to decode payload URL:', error);
      return url;
    }
  }

  /**
   * Process stream URL to always encode as payload for security
   */
  private processStreamUrl(streamUrl: string, headers?: Record<string, string>, streamType?: string): string {
    console.log('🔍 Processing stream URL:', streamUrl);

    // Check if this is already a payload URL pointing to external proxy
    const payloadMatch = streamUrl.match(/^https?:\/\/[^\/]+\/?\?payload=(.+)$/);
    if (payloadMatch) {
      const payload = payloadMatch[1];
      console.log('🔄 Redirecting payload URL to our backend stream proxy');

      // Create a URL pointing to our backend's stream proxy
      return `http://localhost:${this.config.port}/api/v1/stream?payload=${payload}`;
    }

    // For direct URLs (like from Cloudnestra), encode them as payloads
    console.log('🔒 Encoding direct URL as payload to hide source');
    return this.encodeStreamToPayload(streamUrl, headers, streamType);
  }

  private initializeProviders() {
    console.log('🔧 Initializing provider system...');

    // Set proxy URLs for stream proxying
    if (this.config.proxyUrl) {
      setM3U8ProxyUrl(`${this.config.proxyUrl}/m3u8-proxy`);
      setProxyUrl(this.config.proxyUrl);
    }

    // Create fetchers
    this.fetcher = makeStandardFetcher(fetch);

    // Use proxied fetcher if proxy URL is configured
    this.proxiedFetcher = this.config.proxyUrl
      ? makeSimpleProxyFetcher(this.config.proxyUrl, fetch)
      : this.fetcher; // fallback to regular fetcher

    this.providers = makeProviders({
      fetcher: this.fetcher,
      proxiedFetcher: this.proxiedFetcher,
      target: targets.BROWSER, // Use targets.BROWSER to ensure proxy is used
      consistentIpForRequests: true,
      proxyStreams: true, // Enable proxy for stream URLs
    });

    const sources = this.providers.listSources();
    const embeds = this.providers.listEmbeds();

    console.log('✅ Providers initialized successfully');
    console.log(`📦 Available sources: ${sources.length}`);
    console.log(`🔗 Available embeds: ${embeds.length}`);
    console.log(`🔀 Proxy enabled: ${this.config.proxyUrl ? 'Yes' : 'No'}`);
    console.log(`🔀 Stream proxying: ${this.config.proxyUrl ? 'Yes' : 'No'}`);

    if (this.config.proxyUrl) {
      console.log(`🌐 Proxy URL: ${this.config.proxyUrl}`);
      console.log(`🌐 M3U8 Proxy URL: ${this.config.proxyUrl}/m3u8-proxy`);
      console.log(`🌐 General Proxy URL: ${this.config.proxyUrl}`);
    }
  }

  public getAvailableProviders() {
    const sources = this.providers.listSources();
    const embeds = this.providers.listEmbeds();

    return {
      sources: sources.map(s => ({
        id: s.id,
        name: s.name,
        rank: s.rank,
        type: s.type,
        mediaTypes: s.mediaTypes,
      })),
      embeds: embeds.map(e => ({
        id: e.id,
        name: e.name,
        rank: e.rank,
        type: e.type,
      })),
    };
  }

  private convertToScrapeMedia(media: MediaInfo): ScrapeMedia {
    if (media.type === 'movie') {
      return {
        type: 'movie',
        title: media.title,
        releaseYear: media.releaseYear,
        tmdbId: media.tmdbId,
        imdbId: media.imdbId,
      } as MovieMedia;
    } else {
      if (!media.season || !media.episode) {
        throw new Error('Season and episode are required for TV shows');
      }
      return {
        type: 'show',
        title: media.title,
        releaseYear: media.releaseYear,
        tmdbId: media.tmdbId,
        imdbId: media.imdbId,
        season: media.season,
        episode: media.episode,
      } as ShowMedia;
    }
  }

  public async scrapeMovie(
    media: MediaInfo,
    requestedProviders?: string[],
    timeout: number = 15000 // Reduced timeout to 15 seconds
  ): Promise<StreamResult[]> {
    console.log(`🎬 Scraping movie: ${media.title} (${media.releaseYear})`);

    // Get available providers for movies
    let availableProviders = this.providers.listSources()
      .filter(p => !p.mediaTypes || p.mediaTypes.includes('movie'))
      .sort((a, b) => b.rank - a.rank);

    // Filter by requested providers if specified
    if (requestedProviders && requestedProviders.length > 0) {
      availableProviders = availableProviders.filter(p => requestedProviders.includes(p.id));
    }

    // Skip problematic providers for now
    const problematicProviders = ['ridomovies'];
    availableProviders = availableProviders.filter(p => !problematicProviders.includes(p.id));

    console.log(`🔍 Using ${availableProviders.length} providers`);

    const streams: StreamResult[] = [];

    // Try providers in order of rank (highest first)
    for (const provider of availableProviders.slice(0, 8)) { // Try more providers
      try {
        console.log(`🚀 Trying provider: ${provider.name} (rank: ${provider.rank})`);
        console.log(`🔧 Using proxy: ${this.config.proxyUrl ? 'Yes' : 'No'}`);

        const scrapeMedia = this.convertToScrapeMedia(media);

        console.log(`🔧 Fetcher type: ${this.config.proxyUrl ? 'Proxied' : 'Direct'}`);

        const scrapePromise = this.providers.runSourceScraper({
          id: provider.id,
          media: scrapeMedia,
        });

        const timeoutPromise = new Promise<SourcererOutput>((_, reject) =>
          setTimeout(() => reject(new Error(`Provider ${provider.name} timed out after ${timeout}ms`)), timeout)
        );

        console.log(`⏱️ Starting scrape with ${timeout}ms timeout...`);
        const result = await Promise.race([scrapePromise, timeoutPromise]) as SourcererOutput;

        if (result.stream && result.stream.length > 0) {
          const stream = result.stream[0];

          // Handle different stream types
          let streamUrl: string;
          if (stream.type === 'hls') {
            streamUrl = (stream as HlsBasedStream).playlist;
          } else if (stream.type === 'file') {
            // Get the best quality from file-based stream
            const fileStream = stream as FileBasedStream;
            const qualities = fileStream.qualities;
            const bestQuality = qualities['1080'] || qualities['720'] || qualities['480'] || qualities['360'];
            streamUrl = bestQuality?.url || '';
          } else {
            console.warn(`Unknown stream type: ${(stream as any).type}`);
            continue;
          }

          if (!streamUrl) {
            console.warn('No valid stream URL found');
            continue;
          }

          // Encode stream URL as payload to hide source
          const payloadUrl = this.processStreamUrl(streamUrl, stream.headers, stream.type);

          streams.push({
            providerId: provider.id,
            providerName: provider.name,
            stream: {
              playlist: payloadUrl,
              type: stream.type,
              headers: stream.headers,
              captions: stream.captions,
            },
            scrapedAt: new Date().toISOString(),
          });

          console.log(`✅ Successfully scraped from ${provider.name}`);
          console.log(`� Stream URL encoded as payload`);

          // Stop after finding first working stream
          break;
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        console.warn(`❌ Provider ${provider.name} failed: ${errorMessage}`);

        // Add some delay between failed providers to avoid rate limiting
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }

    if (streams.length === 0) {
      console.warn('⚠️ No streams found for this movie');
      console.log('💡 You can try:');
      console.log('   1. Different search terms');
      console.log('   2. Check if movie exists on target sites');
      console.log('   3. Try again later (some providers may be temporarily down)');
    }

    return streams;
  }

  public async scrapeTvShow(
    media: MediaInfo,
    requestedProviders?: string[],
    timeout: number = 30000
  ): Promise<StreamResult[]> {
    console.log(`📺 Scraping TV show: ${media.title} S${media.season?.number}E${media.episode?.number}`);

    // Get available providers for TV shows
    let availableProviders = this.providers.listSources()
      .filter(p => !p.mediaTypes || p.mediaTypes.includes('show'))
      .sort((a, b) => b.rank - a.rank);

    // Filter by requested providers if specified
    if (requestedProviders && requestedProviders.length > 0) {
      availableProviders = availableProviders.filter(p => requestedProviders.includes(p.id));
    }

    console.log(`🔍 Using ${availableProviders.length} providers`);

    const streams: StreamResult[] = [];

    // Try providers in order of rank (highest first)
    for (const provider of availableProviders.slice(0, 5)) {
      try {
        console.log(`🚀 Trying provider: ${provider.name}`);

        const scrapeMedia = this.convertToScrapeMedia(media);

        const result = await Promise.race([
          this.providers.runSourceScraper({
            media: scrapeMedia,
            id: provider.id,
            disableOpensubtitles: true,
          }),
          new Promise<SourcererOutput>((_, reject) =>
            setTimeout(() => reject(new Error('Timeout')), timeout)
          ),
        ]) as SourcererOutput;

        if (result.stream && result.stream.length > 0) {
          const stream = result.stream[0];

          // Handle different stream types
          let streamUrl: string;
          if (stream.type === 'hls') {
            streamUrl = (stream as HlsBasedStream).playlist;
          } else if (stream.type === 'file') {
            // Get the best quality from file-based stream
            const fileStream = stream as FileBasedStream;
            const qualities = fileStream.qualities;
            const bestQuality = qualities['1080'] || qualities['720'] || qualities['480'] || qualities['360'];
            streamUrl = bestQuality?.url || '';
          } else {
            console.warn(`Unknown stream type: ${(stream as any).type}`);
            continue;
          }

          if (!streamUrl) {
            console.warn('No valid stream URL found');
            continue;
          }

          // Encode stream URL as payload to hide source
          const payloadUrl = this.processStreamUrl(streamUrl, stream.headers, stream.type);

          streams.push({
            providerId: provider.id,
            providerName: provider.name,
            stream: {
              playlist: payloadUrl,
              type: stream.type,
              headers: stream.headers,
              captions: stream.captions,
            },
            scrapedAt: new Date().toISOString(),
          });

          console.log(`✅ Successfully scraped from ${provider.name}`);
          console.log(`� Stream URL encoded as payload`);

          // Stop after finding first working stream
          break;
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        console.warn(`❌ Provider ${provider.name} failed: ${errorMessage}`);
      }
    }

    if (streams.length === 0) {
      console.warn('⚠️ No streams found for this TV show episode');
    }

    return streams;
  }
}
