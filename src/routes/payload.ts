import { Request, Response } from 'express';
import { AuthService } from '../services/AuthService.js';

// Initialize auth service
const authService = new AuthService();

/**
 * Fetch with retry logic for unreliable video servers
 */
async function fetchStreamWithRetry(
  url: string,
  options: RequestInit,
  maxRetries: number = 3
): Promise<globalThis.Response> {
  let lastError: Error | undefined;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      console.log(`🔄 Fetch attempt ${attempt}/${maxRetries} for ${url.substring(0, 100)}...`);

      const response = await fetch(url, {
        ...options,
        signal: AbortSignal.timeout(attempt === 1 ? 120000 : 180000), // Much longer timeout: 2-3 minutes
      });

      if (response.ok) {
        console.log(`✅ Fetch successful on attempt ${attempt}`);
        return response;
      }

      // If response is not ok, treat as error for retry
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);

    } catch (error) {
      lastError = error as Error;
      console.log(`❌ Fetch attempt ${attempt} failed:`, error instanceof Error ? error.message : error);

      // Don't retry on certain errors
      if (error instanceof Error) {
        if (error.message.includes('404') || error.message.includes('403')) {
          throw error; // Don't retry on client errors
        }
        if (error.message.includes('UND_ERR_CONNECT_TIMEOUT')) {
          console.log(`🔄 Connection timeout, will retry with longer timeout...`);
          // Continue to retry for connection timeouts
        }
      }

      // Wait before retry (exponential backoff)
      if (attempt < maxRetries) {
        const delay = Math.min(1000 * Math.pow(2, attempt - 1), 5000); // 1s, 2s, 4s max
        console.log(`⏳ Waiting ${delay}ms before retry...`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }

  throw lastError || new Error('All fetch attempts failed');
}

/**
 * Send heartbeat to extend token lifetime while video is playing
 */
export const sendHeartbeat = async (req: Request, res: Response) => {
  try {
    const { sessionKey, token } = req.body;

    if (!sessionKey || !token) {
      return res.status(400).json({
        error: 'Missing sessionKey or token'
      });
    }

    const success = authService.sendHeartbeat(sessionKey, token);

    if (!success) {
      return res.status(401).json({
        error: 'Invalid session or token'
      });
    }

    res.json({
      success: true,
      message: 'Heartbeat received, token lifetime extended'
    });

    console.log('💓 Heartbeat received - token lifetime extended');
  } catch (error) {
    console.error('❌ Failed to process heartbeat:', error);
    res.status(500).json({
      error: 'Failed to process heartbeat',
      details: error instanceof Error ? error.message : 'Unknown error'
    });
  }
};

/**
 * Invalidate specific token when player closes
 */
export const invalidateToken = async (req: Request, res: Response) => {
  try {
    const { sessionKey, token } = req.body;

    if (!sessionKey || !token) {
      return res.status(400).json({
        error: 'Missing sessionKey or token'
      });
    }

    const success = authService.invalidateToken(sessionKey, token);

    res.json({
      success: true,
      message: 'Token invalidated successfully'
    });

    console.log('🚫 Token invalidated - player closed');
  } catch (error) {
    console.error('❌ Failed to invalidate token:', error);
    res.status(500).json({
      error: 'Failed to invalidate token',
      details: error instanceof Error ? error.message : 'Unknown error'
    });
  }
};

/**
 * Invalidate entire session when user closes all players
 */
export const invalidateSession = async (req: Request, res: Response) => {
  try {
    const { sessionKey } = req.body;

    if (!sessionKey) {
      return res.status(400).json({
        error: 'Missing sessionKey'
      });
    }

    const success = authService.invalidateSession(sessionKey);

    res.json({
      success: true,
      message: 'Session invalidated successfully'
    });

    console.log('🚫 Session invalidated - all players closed');
  } catch (error) {
    console.error('❌ Failed to invalidate session:', error);
    res.status(500).json({
      error: 'Failed to invalidate session',
      details: error instanceof Error ? error.message : 'Unknown error'
    });
  }
};

/**
 * Generate session key for secure stream access
 * Frontend calls this to get a session key
 */
export const generateSessionKey = async (req: Request, res: Response) => {
  try {
    const sessionKey = authService.generateSessionKey();

    res.json({
      success: true,
      sessionKey,
      expires: Date.now() + 5 * 60 * 1000 // 5 minutes
    });

    console.log('🔑 Generated session key for secure access');
  } catch (error) {
    console.error('❌ Failed to generate session key:', error);
    res.status(500).json({
      error: 'Failed to generate session key',
      details: error instanceof Error ? error.message : 'Unknown error'
    });
  }
};

/**
 * Create secure stream access token
 * Frontend sends sessionKey + payload, backend returns secure token
 */
export const createSecureAccess = async (req: Request, res: Response) => {
  try {
    const { sessionKey, payload } = req.body;

    if (!sessionKey || !payload) {
      return res.status(400).json({
        error: 'Missing sessionKey or payload'
      });
    }

    // Decode payload to get stream URL
    let decodedPayload: string;
    try {
      decodedPayload = Buffer.from(payload, 'base64url').toString();
    } catch (error) {
      try {
        decodedPayload = Buffer.from(payload, 'base64').toString();
      } catch (fallbackError) {
        return res.status(400).json({
          error: 'Invalid payload encoding'
        });
      }
    }

    const payloadData = JSON.parse(decodedPayload);

    if (!payloadData.url) {
      return res.status(400).json({
        error: 'Invalid payload structure - missing URL'
      });
    }

    // Create secure access token
    const secureAccess = authService.createSecureAccess(
      sessionKey,
      payloadData.url,
      req.headers['user-agent']
    );

    if (!secureAccess) {
      return res.status(401).json({
        error: 'Invalid session key or access denied'
      });
    }

    res.json({
      success: true,
      token: secureAccess.token,
      expires: secureAccess.expires
    });

    console.log('🔐 Created secure access token');
  } catch (error) {
    console.error('❌ Failed to create secure access:', error);
    res.status(500).json({
      error: 'Failed to create secure access',
      details: error instanceof Error ? error.message : 'Unknown error'
    });
  }
};

/**
 * Stream proxy endpoint - serves the actual video stream through our backend
 * Now requires secure authentication token + anti-scraping protection
 */
export const streamProxy = async (req: Request, res: Response) => {
  try {
    const { payload, sessionKey, token } = req.query;

    // Enhanced Security Checks
    const clientIP = req.ip || req.connection.remoteAddress || req.headers['x-forwarded-for'];
    const userAgent = req.headers['user-agent'] || '';
    const referer = req.headers['referer'] || req.headers['referrer'] || '';

    // 1. Basic parameter validation
    if (!payload || typeof payload !== 'string') {
      return res.status(400).json({
        error: 'Missing or invalid payload parameter'
      });
    }

    if (!sessionKey || typeof sessionKey !== 'string') {
      return res.status(401).json({
        error: 'Missing session key - secure access required'
      });
    }

    if (!token || typeof token !== 'string') {
      return res.status(401).json({
        error: 'Missing access token - secure access required'
      });
    }

    // 2. Anti-scraping: Block common scraping tools and suspicious user agents
    const suspiciousUserAgents = [
      'curl', 'wget', 'HTTPie', 'python-requests', 'Go-http-client',
      'PostmanRuntime', 'Insomnia', 'node-fetch', 'axios', 'Scrapy',
      'crawler', 'bot', 'spider', 'scraper', 'downloader',
      'youtube-dl', 'yt-dlp', 'ffmpeg', 'vlc', 'mplayer'
    ];

    const isSuspiciousUA = suspiciousUserAgents.some(ua =>
      userAgent.toLowerCase().includes(ua.toLowerCase())
    );

    if (isSuspiciousUA) {
      console.log(`🚫 Blocked suspicious user agent: ${userAgent}`);
      return res.status(403).json({
        error: 'Access denied - unauthorized client'
      });
    }

    // 3. Referer validation: Only allow requests from your domain or direct access from browsers
    const allowedReferers = [
      'https://cdn.vidninja.pro',
      'https://vidninja.pro',
      'http://localhost:3001',
      'http://localhost:3000',
      'http://localhost:5173', // Vite dev server
      'http://localhost:4173', // Vite preview server
      'http://127.0.0.1:5173', // Alternative localhost
      'http://127.0.0.1:3001'  // Alternative localhost
    ];

    const refererString = Array.isArray(referer) ? referer[0] : referer;
    const isValidReferer = !refererString || // Direct browser access is OK
      allowedReferers.some(allowed => refererString.startsWith(allowed));

    if (!isValidReferer) {
      console.log(`🚫 Blocked invalid referer: ${refererString}`);
      return res.status(403).json({
        error: 'Access denied - invalid referer'
      });
    }

    // 4. Must have a browser-like user agent
    const hasBrowserUA = userAgent.includes('Mozilla') ||
      userAgent.includes('Chrome') ||
      userAgent.includes('Safari') ||
      userAgent.includes('Firefox') ||
      userAgent.includes('Edge');

    if (!hasBrowserUA) {
      console.log(`🚫 Blocked non-browser user agent: ${userAgent}`);
      return res.status(403).json({
        error: 'Access denied - browser required'
      });
    }

    // 5. Validate secure access with enhanced checks
    const isValidAccess = authService.validateStreamAccess(
      sessionKey,
      token,
      userAgent,
      clientIP as string
    );

    if (!isValidAccess) {
      console.log('❌ Invalid or expired secure access token');
      return res.status(403).json({
        error: 'Access denied - invalid or expired token'
      });
    }

    console.log('🎬 Authorized stream access - proxying video stream');
    console.log('📦 Raw payload:', payload.substring(0, 100) + '...');

    // Decode the base64 payload (handle both base64 and base64url encoding)
    let decodedPayload: string;
    try {
      // First try base64url decoding (which is what we actually use)
      decodedPayload = Buffer.from(payload, 'base64url').toString();
    } catch (error) {
      try {
        // Fallback to regular base64 decoding
        console.log('⚠️ base64url failed, trying regular base64...');
        decodedPayload = Buffer.from(payload, 'base64').toString();
      } catch (fallbackError) {
        console.error('❌ Failed to decode payload with both base64url and base64:', error, fallbackError);
        return res.status(400).json({
          error: 'Invalid payload encoding - unable to decode as base64url or base64'
        });
      }
    }

    const payloadData = JSON.parse(decodedPayload);
    console.log('🔍 Decoded payload data:', {
      type: payloadData.type,
      url: payloadData.url?.substring(0, 100) + '...',
      hasHeaders: !!payloadData.headers,
      timestamp: payloadData.timestamp
    });

    if (!payloadData.url) {
      return res.status(400).json({
        error: 'Invalid payload structure - missing URL'
      });
    }

    console.log('📡 Proxying to actual stream URL:', payloadData.url);

    // Set up headers for video streaming
    const requestHeaders: Record<string, string> = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      'Accept': '*/*',
      'Accept-Encoding': 'identity',
      'Connection': 'keep-alive',
      ...payloadData.headers
    };

    // Add range header if provided by client, but expand it for better buffering
    if (req.headers.range) {
      const range = req.headers.range;
      console.log('📏 Original range request:', range);

      // Parse the range to potentially expand it for better buffering
      const rangeMatch = range.match(/bytes=(\d+)-(\d*)/);
      if (rangeMatch) {
        const start = parseInt(rangeMatch[1]);
        const end = rangeMatch[2] ? parseInt(rangeMatch[2]) : undefined;

        // If it's a small range request, expand it to download more for buffering
        // Only do this for initial requests or small chunks
        if (!end || (end - start) < 2 * 1024 * 1024) { // Less than 2MB
          const expandedEnd = end ? Math.min(end + 5 * 1024 * 1024, end + 10 * 1024 * 1024) : start + 10 * 1024 * 1024; // Add 5-10MB
          const expandedRange = `bytes=${start}-${expandedEnd}`;
          requestHeaders['Range'] = expandedRange;
          console.log('📈 Expanded range for buffering:', expandedRange);
        } else {
          requestHeaders['Range'] = range;
        }
      } else {
        requestHeaders['Range'] = range;
      }
    }

    console.log('📋 Request headers:', Object.keys(requestHeaders));

    // Fetch the actual stream with enhanced timeout and retry logic
    const streamResponse = await fetchStreamWithRetry(payloadData.url, {
      headers: requestHeaders,
    }, 3); // 3 retry attempts

    console.log('📡 Stream response status:', streamResponse.status, streamResponse.statusText);
    console.log('📋 Stream response headers:', Object.fromEntries(streamResponse.headers.entries()));

    if (!streamResponse.ok) {
      console.error('❌ Stream fetch failed:', streamResponse.status, streamResponse.statusText);
      return res.status(streamResponse.status).json({
        error: 'Stream fetch failed',
        status: streamResponse.status,
        statusText: streamResponse.statusText
      });
    }

    // Set response headers for optimized video streaming and buffering
    res.setHeader('Content-Type', streamResponse.headers.get('content-type') || 'video/mp4');
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'Range');
    res.setHeader('Access-Control-Expose-Headers', 'Content-Range, Content-Length, Content-Type, Accept-Ranges');
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable'); // Cache for 1 year to encourage buffering
    res.setHeader('Connection', 'keep-alive');

    // Add headers to encourage browser buffering
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', "default-src 'self'");

    // Forward content length if available
    const contentLength = streamResponse.headers.get('content-length');
    if (contentLength) {
      res.setHeader('Content-Length', contentLength);
    }

    // Forward content range if this is a range request
    const contentRange = streamResponse.headers.get('content-range');
    if (contentRange) {
      res.setHeader('Content-Range', contentRange);
      res.status(206); // Partial Content
    }

    console.log('✅ Streaming video content with optimized buffering');

    // Stream the content with larger chunks for better buffering
    if (streamResponse.body) {
      const reader = streamResponse.body.getReader();
      let bytesStreamed = 0;
      const chunkSize = 64 * 1024; // 64KB chunks for better buffering
      let buffer = new Uint8Array(0);

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) {
            // Write any remaining buffer
            if (buffer.length > 0) {
              res.write(Buffer.from(buffer));
            }
            break;
          }

          // Accumulate data in buffer
          const newBuffer = new Uint8Array(buffer.length + value.length);
          newBuffer.set(buffer);
          newBuffer.set(value, buffer.length);
          buffer = newBuffer;

          // Write chunks when buffer reaches optimal size
          while (buffer.length >= chunkSize) {
            const chunk = buffer.slice(0, chunkSize);
            res.write(Buffer.from(chunk));
            buffer = buffer.slice(chunkSize);
            bytesStreamed += chunkSize;

            // Add small delay for controlled streaming (prevents overwhelming)
            await new Promise(resolve => setImmediate(resolve));
          }
        }
        res.end();
        console.log(`✅ Stream completed. Total bytes: ${bytesStreamed}`);
      } finally {
        reader.releaseLock();
      }
    } else {
      res.end();
    }

  } catch (error) {
    console.error('❌ Failed to proxy video stream:', error);

    // Only send error response if headers haven't been sent yet
    if (!res.headersSent) {
      res.status(500).json({
        error: 'Failed to proxy stream',
        details: error instanceof Error ? error.message : 'Unknown error'
      });
    } else {
      // If streaming already started, just end the response
      try {
        res.end();
      } catch (endError) {
        console.error('❌ Error ending response:', endError);
      }
    }
  }
};
