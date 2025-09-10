import { Router, Request, Response } from 'express';
import { ProviderService } from '../services/ProviderService.js';
import { TMDBService } from '../services/TMDBService.js';
import { decodePayload, streamProxy } from './payload.js';

export function createProviderRoutes(providerService: ProviderService, tmdbService: TMDBService): Router {
  const router = Router();

  // Get available providers
  router.get('/providers', (req: Request, res: Response) => {
    try {
      const providers = providerService.getAvailableProviders();
      res.json({
        success: true,
        ...providers,
      });
    } catch (error) {
      console.error('❌ Error getting providers:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to get providers',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  });

  // Movie endpoint
  router.get('/movie/:tmdbId', async (req: Request, res: Response) => {
    try {
      const { tmdbId } = req.params;
      const { providers: requestedProviders, timeout = '30000' } = req.query;

      console.log(`🎬 Movie request for TMDB ID: ${tmdbId}`);

      // Get movie details from TMDB
      const movieDetails = await tmdbService.getMovieDetails(tmdbId);

      // Parse requested providers
      let providerList: string[] | undefined;
      if (typeof requestedProviders === 'string') {
        providerList = requestedProviders.split(',');
      }

      // Scrape streams
      const streams = await providerService.scrapeMovie(
        movieDetails,
        providerList,
        parseInt(timeout as string, 10)
      );

      // Get available providers for response
      const availableProviders = providerService.getAvailableProviders();

      res.json({
        success: true,
        media: movieDetails,
        streams,
        providersAvailable: availableProviders.sources
          .filter(p => !p.mediaTypes || p.mediaTypes.includes('movie'))
          .map(p => ({
            id: p.id,
            name: p.name,
            rank: p.rank,
          })),
      });

    } catch (error) {
      console.error('❌ Movie scraping error:', error);
      res.status(500).json({
        success: false,
        error: 'Scraping failed',
        message: error instanceof Error ? error.message : 'Unknown error',
        tmdbId: req.params.tmdbId,
      });
    }
  });

  // TV Show endpoint
  router.get('/tv/:tmdbId/:season/:episode', async (req: Request, res: Response) => {
    try {
      const { tmdbId, season, episode } = req.params;
      const { providers: requestedProviders, timeout = '30000' } = req.query;

      console.log(`📺 TV request for TMDB ID: ${tmdbId} S${season}E${episode}`);

      // Get show details from TMDB
      const showDetails = await tmdbService.getShowDetails(
        tmdbId,
        parseInt(season, 10),
        parseInt(episode, 10)
      );

      // Parse requested providers
      let providerList: string[] | undefined;
      if (typeof requestedProviders === 'string') {
        providerList = requestedProviders.split(',');
      }

      // Scrape streams
      const streams = await providerService.scrapeTvShow(
        showDetails,
        providerList,
        parseInt(timeout as string, 10)
      );

      // Get available providers for response
      const availableProviders = providerService.getAvailableProviders();

      res.json({
        success: true,
        media: showDetails,
        streams,
        providersAvailable: availableProviders.sources
          .filter(p => !p.mediaTypes || p.mediaTypes.includes('show'))
          .map(p => ({
            id: p.id,
            name: p.name,
            rank: p.rank,
          })),
      });

    } catch (error) {
      console.error('❌ TV scraping error:', error);
      res.status(500).json({
        success: false,
        error: 'Scraping failed',
        message: error instanceof Error ? error.message : 'Unknown error',
        tmdbId: req.params.tmdbId,
      });
    }
  });

  // TMDB search endpoint
  router.get('/tmdb/search', async (req: Request, res: Response) => {
    try {
      const { q: query, type = 'multi', page = '1' } = req.query;

      if (!query || typeof query !== 'string') {
        return res.status(400).json({
          success: false,
          error: 'Query parameter is required',
        });
      }

      const results = await tmdbService.searchContent(
        query,
        type as 'movie' | 'tv' | 'multi',
        parseInt(page as string, 10)
      );

      res.json({
        success: true,
        results,
      });
    } catch (error) {
      console.error('❌ TMDB search error:', error);
      res.status(500).json({
        success: false,
        error: 'TMDB search failed',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  });

  // Payload decode endpoint - converts payload URLs to stream info
  router.get('/payload/decode', decodePayload);

  // Stream proxy endpoint - serves video streams through our backend
  router.get('/stream', streamProxy);

  return router;
}
