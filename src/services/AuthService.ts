import crypto from 'crypto';

interface SessionToken {
    key: string;
    token: string;
    expires: number;
    used: boolean;
}

interface SecureStreamAccess {
    sessionKey: string;
    token: string;
    url: string;
    expires: number;
}

export class AuthService {
    private sessions = new Map<string, SessionToken>();
    private readonly TOKEN_EXPIRY = 5 * 60 * 1000; // 5 minutes
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

            // Generate a time-limited token
            const token = this.generateSecureToken(sessionKey, streamUrl, userAgent);
            const expires = Date.now() + this.TOKEN_EXPIRY;

            // Store session
            this.sessions.set(sessionKey, {
                key: sessionKey,
                token,
                expires,
                used: false
            });

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

            // Check if expired
            if (Date.now() > session.expires) {
                this.sessions.delete(sessionKey);
                return false;
            }

            // Check if already used (one-time use for security)
            if (session.used) {
                return false;
            }

            // Validate token
            if (session.token !== token) {
                return false;
            }

            // Mark as used
            session.used = true;

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
     * Clean expired sessions
     */
    private cleanExpiredSessions(): void {
        const now = Date.now();
        let cleaned = 0;

        for (const [key, session] of this.sessions.entries()) {
            if (now > session.expires) {
                this.sessions.delete(key);
                cleaned++;
            }
        }

        if (cleaned > 0) {
            console.log(`🧹 Cleaned ${cleaned} expired auth sessions`);
        }
    }

    /**
     * Get session statistics
     */
    getStats() {
        return {
            activeSessions: this.sessions.size,
            memoryUsage: JSON.stringify([...this.sessions.values()]).length
        };
    }
}
