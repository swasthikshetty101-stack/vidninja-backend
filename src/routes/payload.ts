import { Request, Response } from 'express';

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
 * Decode payload endpoint - converts payload URLs back to direct stream URLs
 * This is used by the video player to get the actual stream URL from the encoded payload
 */
export const decodePayload = async (req: Request, res: Response) => {
  try {
    const { payload } = req.query;

    if (!payload || typeof payload !== 'string') {
      return res.status(400).json({
        error: 'Missing or invalid payload parameter'
      });
    }

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

    console.log('🔓 Decoding payload for video player');
    console.log('📦 Payload data:', {
      type: payloadData.type,
      hasUrl: !!payloadData.url,
      hasHeaders: !!payloadData.headers,
      timestamp: payloadData.timestamp
    });

    // Validate payload structure
    if (!payloadData.url) {
      return res.status(400).json({
        error: 'Invalid payload structure - missing URL'
      });
    }

    // Return the decoded stream information
    res.json({
      success: true,
      stream: {
        url: payloadData.url,
        type: payloadData.type || 'mp4',
        headers: payloadData.headers || {},
        options: payloadData.options || {}
      }
    });

    console.log('✅ Payload decoded successfully');

  } catch (error) {
    console.error('❌ Failed to decode payload:', error);
    res.status(500).json({
      error: 'Failed to decode payload',
      details: error instanceof Error ? error.message : 'Unknown error'
    });
  }
};

/**
 * Stream proxy endpoint - serves the actual video stream through our backend
 * This allows Video.js to access the stream directly while hiding the source
 */
export const streamProxy = async (req: Request, res: Response) => {
  try {
    const { payload } = req.query;

    if (!payload || typeof payload !== 'string') {
      return res.status(400).json({
        error: 'Missing or invalid payload parameter'
      });
    }

    console.log('🎬 Proxying video stream through payload');
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
