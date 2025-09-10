import path from 'path';
import { fileURLToPath } from 'url';
import * as dotenv from 'dotenv';

// Get __dirname equivalent in ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load environment variables from the parent directory
dotenv.config({ path: path.join(__dirname, '../../../.env') });

export interface Config {
  port: number;
  tmdbApiKey: string;
  proxyUrl?: string;
  enableCors: boolean;
  nodeEnv: string;
  backendUrl?: string;
}

export function getConfig(): Config {
  // TMDB API Key
  let tmdbApiKey = process.env.MOVIE_WEB_TMDB_API_KEY || process.env.TMDB_API_KEY || '';
  tmdbApiKey = tmdbApiKey.trim();

  if (!tmdbApiKey) {
    throw new Error('Missing TMDB API key. Set MOVIE_WEB_TMDB_API_KEY or TMDB_API_KEY environment variable.');
  }

  // Proxy URL - should point to simple-proxy
  let proxyUrl: string | undefined = process.env.MOVIE_WEB_PROXY_URL;
  if (proxyUrl) {
    proxyUrl = proxyUrl.trim().replace(/\/$/, ''); // Remove trailing slash
  }

  // Other config
  const port = parseInt(process.env.PLAYER_PORT || '3001', 10);
  const enableCors = process.env.ENABLE_CORS !== 'false';
  const nodeEnv = process.env.NODE_ENV || 'development';

  // Backend URL for stream proxy URLs (auto-detect from environment)
  const backendUrl = process.env.BACKEND_URL || process.env.KOYEB_APP_URL || 
    'https://important-candide-vidninja-84a3a384.koyeb.app'; // Always fallback to Koyeb URL

  console.log('🔧 Backend Configuration:');
  console.log(`   📋 Port: ${port}`);
  console.log(`   🔑 TMDB API Key: ${tmdbApiKey.substring(0, 8)}...`);
  console.log(`   🔗 Proxy URL: ${proxyUrl || 'None (direct requests)'}`);
  console.log(`   🌐 CORS: ${enableCors ? 'Enabled' : 'Disabled'}`);
  console.log(`   🔨 Environment: ${nodeEnv}`);
  console.log(`   🏠 Backend URL: ${backendUrl}`);
  console.log(`   🔍 BACKEND_URL env: ${process.env.BACKEND_URL || 'not set'}`);
  console.log(`   🔍 KOYEB_APP_URL env: ${process.env.KOYEB_APP_URL || 'not set'}`);  return {
    port,
    tmdbApiKey,
    proxyUrl,
    enableCors,
    nodeEnv,
    backendUrl,
  };
}
