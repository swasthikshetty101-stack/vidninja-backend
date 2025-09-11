import crypto from 'crypto';

interface SessionToken {
    key: string;
    token: string;
    expires: number;
    playerSessionId: string;
    isActive: boolean;
    lastHeartbeat: number;
    payload: string;
    clientIP?: string; // Track client IP for additional security
    userAgent?: string; // Track user agent
    createdAt: number; // Track creation time
}

interface SecureStreamAccess {
    sessionKey: string;
    token: string;
    url: string;
    expires: number;
}

interface PlayerSession {
    sessionKey: string;
    tokens: Map<string, SessionToken>;
    created: number;
    lastActivity: number;
}

export class AuthService {
    private sessions = new Map<string, PlayerSession>();
    private readonly TOKEN_EXPIRY = 60 * 60 * 1000; // 1 hour for active sessions
    private readonly SECRET_KEY = process.env.AUTH_SECRET || 'vidninja-secret-2024';

    constructor() {
        // Clean expired sessions every 10 minutes (less frequent)
        setInterval(() => this.cleanExpiredSessions(), 10 * 60 * 1000);
    }

    /**
     * Generate a session key for the frontend
     */
    generateSessionKey(): string {
        return crypto.randomBytes(32).toString('hex');
    }

    /**
     * Create a secure access token for a stream URL
     */
    createSecureAccess(sessionKey: string, streamUrl: string, userAgent?: string): SecureStreamAccess | null {
        try {
            if (!sessionKey || sessionKey.length !== 64) {
                return null;
            }

            const playerSessionId = crypto.randomBytes(16).toString('hex');
            const token = this.generateSecureToken(sessionKey, streamUrl, userAgent);
            const expires = Date.now() + this.TOKEN_EXPIRY;

            let session = this.sessions.get(sessionKey);
            if (!session) {
                session = {
                    sessionKey,
                    tokens: new Map(),
                    created: Date.now(),
                    lastActivity: Date.now()
                };
                this.sessions.set(sessionKey, session);
            }

            session.tokens.set(token, {
                key: sessionKey,
                token,
                expires,
                playerSessionId,
                isActive: true, // Set as active immediately
                lastHeartbeat: Date.now(),
                payload: streamUrl,
                clientIP: undefined, // Will be set during validation
                userAgent,
                createdAt: Date.now()
            });

            session.lastActivity = Date.now();

            return {
                sessionKey,
                token,
                url: streamUrl,
                expires
            };
        } catch (error) {
            console.error('Failed to create secure access:', error);
            return null;
        }
    }

    /**
     * Validate access token for stream request - with IP binding for security
     */
    validateStreamAccess(sessionKey: string, token: string, userAgent?: string, clientIP?: string): boolean {
        try {
            const session = this.sessions.get(sessionKey);
            if (!session) {
                return false;
            }

            const tokenData = session.tokens.get(token);
            if (!tokenData) {
                return false;
            }

            // Bind IP on first use for security
            if (!tokenData.clientIP && clientIP) {
                tokenData.clientIP = clientIP;
            }

            // Validate IP binding - token can only be used from the same IP
            if (tokenData.clientIP && clientIP && tokenData.clientIP !== clientIP) {
                console.log(`🚫 IP mismatch: token bound to ${tokenData.clientIP}, request from ${clientIP}`);
                return false;
            }

            // Validate user agent consistency
            if (tokenData.userAgent && userAgent && tokenData.userAgent !== userAgent) {
                console.log(`🚫 User agent mismatch detected`);
                return false;
            }

            // Update activity - NO EXPIRATION CHECK FOR ACTIVE TOKENS
            tokenData.isActive = true;
            tokenData.lastHeartbeat = Date.now();
            session.lastActivity = Date.now();

            // Keep extending expiry for active sessions
            tokenData.expires = Date.now() + this.TOKEN_EXPIRY;

            return true;
        } catch (error) {
            console.error('Failed to validate stream access:', error);
            return false;
        }
    }

    /**
     * Generate secure token using HMAC
     */
    private generateSecureToken(sessionKey: string, url: string, userAgent = ''): string {
        const timestamp = Date.now().toString();
        const data = `${sessionKey}:${url}:${userAgent}:${timestamp}`;

        return crypto
            .createHmac('sha256', this.SECRET_KEY)
            .update(data)
            .digest('hex');
    }

    /**
     * Send heartbeat for active token
     */
    sendHeartbeat(sessionKey: string, token: string): boolean {
        try {
            const session = this.sessions.get(sessionKey);
            if (!session) return false;

            const tokenData = session.tokens.get(token);
            if (!tokenData) return false;

            tokenData.lastHeartbeat = Date.now();
            session.lastActivity = Date.now();
            tokenData.expires = Date.now() + this.TOKEN_EXPIRY;

            return true;
        } catch (error) {
            console.error('Failed to send heartbeat:', error);
            return false;
        }
    }

    /**
     * Invalidate specific token
     */
    invalidateToken(sessionKey: string, token: string): boolean {
        try {
            const session = this.sessions.get(sessionKey);
            if (!session) return false;

            session.tokens.delete(token);
            session.lastActivity = Date.now();

            return true;
        } catch (error) {
            console.error('Failed to invalidate token:', error);
            return false;
        }
    }

    /**
     * Invalidate entire session
     */
    invalidateSession(sessionKey: string): boolean {
        try {
            const deleted = this.sessions.delete(sessionKey);
            return deleted;
        } catch (error) {
            console.error('Failed to invalidate session:', error);
            return false;
        }
    }

    /**
     * Clean expired sessions - VERY CONSERVATIVE
     */
    private cleanExpiredSessions(): void {
        const now = Date.now();
        let cleanedSessions = 0;
        let cleanedTokens = 0;

        for (const [sessionKey, session] of this.sessions.entries()) {
            // Only clean tokens that haven't been active for 30+ minutes
            for (const [tokenKey, tokenData] of session.tokens.entries()) {
                if (now - tokenData.lastHeartbeat > 30 * 60 * 1000) {
                    session.tokens.delete(tokenKey);
                    cleanedTokens++;
                }
            }

            // Only clean sessions with no tokens and no activity for 2+ hours
            if (session.tokens.size === 0 && now - session.lastActivity > 2 * 60 * 60 * 1000) {
                this.sessions.delete(sessionKey);
                cleanedSessions++;
            }
        }

        if (cleanedSessions > 0 || cleanedTokens > 0) {
            console.log(`🧹 Cleaned ${cleanedSessions} expired sessions, ${cleanedTokens} expired tokens`);
        }
    }

    /**
     * Get session statistics
     */
    getStats() {
        let totalTokens = 0;
        let activeTokens = 0;

        for (const session of this.sessions.values()) {
            totalTokens += session.tokens.size;
            for (const token of session.tokens.values()) {
                if (token.isActive) activeTokens++;
            }
        }

        return {
            activeSessions: this.sessions.size,
            totalTokens,
            activeTokens,
            memoryUsage: JSON.stringify([...this.sessions.values()]).length
        };
    }
}