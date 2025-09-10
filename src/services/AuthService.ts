import crypto from 'crypto';

interface SessionToken {
    key: string;
    token: string;
    expires: number;
    used: boolean;
    playerSessionId: string;
    isActive: boolean;
    lastHeartbeat: number;
    payload: string;
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
    private readonly TOKEN_EXPIRY = 30 * 60 * 1000; // 30 minutes initial
    private readonly SECRET_KEY = process.env.AUTH_SECRET || 'vidninja-secret-2024';

    constructor() {
        // Clean expired sessions every minute
        setInterval(() => this.cleanExpiredSessions(), 60000);
    }

    /**
     * Generate a session key for the frontend
     */
    generateSessionKey(): string {
        return crypto.randomBytes(32).toString('hex');
    }

    /**
     * Create a secure access token for a stream URL
     * Frontend sends sessionKey, backend returns token if valid
     */
    createSecureAccess(sessionKey: string, streamUrl: string, userAgent?: string): SecureStreamAccess | null {
        try {
            // Validate session key format
            if (!sessionKey || sessionKey.length !== 64) {
                return null;
            }

            // Generate a unique player session ID
            const playerSessionId = crypto.randomBytes(16).toString('hex');

            // Generate a time-limited token
            const token = this.generateSecureToken(sessionKey, streamUrl, userAgent);
            const expires = Date.now() + this.TOKEN_EXPIRY;

            // Get or create player session
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

            // Store token in session
            session.tokens.set(token, {
                key: sessionKey,
                token,
                expires,
                used: false,
                playerSessionId,
                isActive: false,
                lastHeartbeat: Date.now(),
                payload: streamUrl
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
     * Validate access token for stream request
     */
    validateStreamAccess(sessionKey: string, token: string, userAgent?: string): boolean {
        try {
            const session = this.sessions.get(sessionKey);

            if (!session) {
                return false;
            }

            // Get the specific token
            const tokenData = session.tokens.get(token);
            if (!tokenData) {
                return false;
            }

            // Check if expired
            if (Date.now() > tokenData.expires) {
                session.tokens.delete(token);
                return false;
            }

            // Check if already used (one-time use for security)
            if (tokenData.used) {
                return false;
            }

            // Validate token
            if (tokenData.token !== token) {
                return false;
            }

            // Mark as used and active
            tokenData.used = true;
            tokenData.isActive = true;
            tokenData.lastHeartbeat = Date.now();
            session.lastActivity = Date.now();

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
            if (!tokenData || !tokenData.isActive) return false;

            // Update heartbeat
            tokenData.lastHeartbeat = Date.now();
            session.lastActivity = Date.now();

            // Extend token expiry while active
            tokenData.expires = Date.now() + this.TOKEN_EXPIRY;

            return true;
        } catch (error) {
            console.error('Failed to send heartbeat:', error);
            return false;
        }
    }

    /**
     * Invalidate specific token (when player closes)
     */
    invalidateToken(sessionKey: string, token: string): boolean {
        try {
            const session = this.sessions.get(sessionKey);
            if (!session) return false;

            const tokenData = session.tokens.get(token);
            if (!tokenData) return false;

            // Mark as inactive and used
            tokenData.isActive = false;
            tokenData.used = true;

            // Remove from session
            session.tokens.delete(token);
            session.lastActivity = Date.now();

            return true;
        } catch (error) {
            console.error('Failed to invalidate token:', error);
            return false;
        }
    }

    /**
     * Invalidate entire session (when user closes all players)
     */
    invalidateSession(sessionKey: string): boolean {
        try {
            const session = this.sessions.get(sessionKey);
            if (!session) return false;

            // Mark all tokens as inactive
            for (const tokenData of session.tokens.values()) {
                tokenData.isActive = false;
                tokenData.used = true;
            }

            // Clear all tokens
            session.tokens.clear();

            // Remove session
            this.sessions.delete(sessionKey);

            return true;
        } catch (error) {
            console.error('Failed to invalidate session:', error);
            return false;
        }
    }

    /**
     * Clean expired sessions and tokens
     */
    private cleanExpiredSessions(): void {
        const now = Date.now();
        let cleanedSessions = 0;
        let cleanedTokens = 0;

        for (const [sessionKey, session] of this.sessions.entries()) {
            // Clean expired tokens within session
            for (const [tokenKey, tokenData] of session.tokens.entries()) {
                if (now > tokenData.expires ||
                    (!tokenData.isActive && now - tokenData.lastHeartbeat > 30000)) { // 30s grace for inactive
                    session.tokens.delete(tokenKey);
                    cleanedTokens++;
                }
            }

            // Clean empty sessions or sessions with no activity for 1 hour
            if (session.tokens.size === 0 || now - session.lastActivity > 60 * 60 * 1000) {
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
