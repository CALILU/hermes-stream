/**
 * lib/auth.js - JWT authentication, bcrypt helpers, and Express middleware
 *
 * Provides:
 * - JWT access token generation and verification
 * - Refresh token generation
 * - bcrypt password hashing and comparison
 * - Legacy SHA256 detection and migration support
 * - Local IP detection (LAN auto-auth)
 * - Express middleware: authMiddleware, requireRole, loginRateLimit
 *
 * @author IsiPrime
 */

const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const crypto = require('crypto');

// ============================================
// CONFIGURATION
// ============================================

const BCRYPT_ROUNDS = parseInt(process.env.BCRYPT_ROUNDS) || 12;
const JWT_SECRET = process.env.JWT_SECRET || crypto.randomBytes(64).toString('hex');
const JWT_ACCESS_EXPIRY = process.env.JWT_ACCESS_EXPIRY || '15m';
const JWT_REFRESH_EXPIRY = process.env.JWT_REFRESH_EXPIRY || '30d';
const ALLOW_LAN_AUTH = process.env.ALLOW_LAN_AUTH !== 'false'; // true by default

// Rate limit config
const LOGIN_MAX_ATTEMPTS = 5;
const LOGIN_WINDOW_MS = 15 * 60 * 1000; // 15 minutes

// ============================================
// JWT FUNCTIONS
// ============================================

/**
 * Generate a signed JWT access token for a user
 * @param {Object} user - { id, username, role }
 * @returns {string} Signed JWT
 */
function generateAccessToken(user) {
    return jwt.sign(
        { userId: user.id, username: user.username, role: user.role },
        JWT_SECRET,
        { expiresIn: JWT_ACCESS_EXPIRY }
    );
}

/**
 * Generate a cryptographically random refresh token
 * @returns {string} 80-char hex string
 */
function generateRefreshToken() {
    return crypto.randomBytes(40).toString('hex');
}

/**
 * Verify and decode a JWT access token
 * @param {string} token - JWT to verify
 * @returns {Object} Decoded payload
 * @throws {jwt.JsonWebTokenError|jwt.TokenExpiredError}
 */
function verifyAccessToken(token) {
    return jwt.verify(token, JWT_SECRET);
}

// ============================================
// PASSWORD FUNCTIONS
// ============================================

/**
 * Hash a password with bcrypt
 * @param {string} password - Plain text password
 * @returns {Promise<string>} Bcrypt hash
 */
async function hashPassword(password) {
    return bcrypt.hash(password, BCRYPT_ROUNDS);
}

/**
 * Compare a plain text password against a bcrypt hash
 * @param {string} password - Plain text password
 * @param {string} hash - Bcrypt hash
 * @returns {Promise<boolean>}
 */
async function comparePassword(password, hash) {
    return bcrypt.compare(password, hash);
}

/**
 * Detect if a stored hash is a legacy SHA256 hash (not bcrypt)
 * Bcrypt hashes start with $2b$ (or $2a$), SHA256 is 64 hex chars
 * @param {string} hash - Stored password hash
 * @returns {boolean}
 */
function isLegacySHA256(hash) {
    if (!hash || typeof hash !== 'string') return false;
    return /^[a-f0-9]{64}$/i.test(hash) && !hash.startsWith('$2b$') && !hash.startsWith('$2a$');
}

/**
 * Verify a password against a legacy SHA256 hash
 * @param {string} password - Plain text password
 * @param {string} hash - SHA256 hex hash
 * @returns {boolean}
 */
function verifySHA256(password, hash) {
    return crypto.createHash('sha256').update(password).digest('hex') === hash;
}

// ============================================
// NETWORK FUNCTIONS
// ============================================

/**
 * Check if an IP address is on the local network
 * @param {string} ip - IP address to check
 * @returns {boolean}
 */
function isLocalIP(ip) {
    if (!ip) return true;

    // Clean the IP (may come as ::ffff:192.168.1.1)
    const cleanIP = ip.replace(/^::ffff:/, '');

    const localPatterns = [
        /^localhost$/i,
        /^127\./,
        /^192\.168\./,
        /^10\./,
        /^172\.(1[6-9]|2[0-9]|3[0-1])\./,
        /^::1$/,
        /^fe80:/i
    ];

    return localPatterns.some(pattern => pattern.test(cleanIP));
}

/**
 * Extract the real client IP from a request, respecting proxy headers
 * @param {import('express').Request} req
 * @returns {string}
 */
function getClientIP(req) {
    return req.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
           req.headers['x-real-ip'] ||
           req.connection?.remoteAddress ||
           req.socket?.remoteAddress ||
           req.ip;
}

// ============================================
// EXPRESS MIDDLEWARE
// ============================================

/**
 * Create the main authentication middleware
 *
 * - LAN IPs are auto-authenticated as local admin (when ALLOW_LAN_AUTH is true)
 * - External IPs must provide a valid JWT Bearer token
 *
 * @param {Object} usersDB - The db/users-db module (unused for token verify, but available for future lookups)
 * @returns {Function} Express middleware
 */
function authMiddleware(usersDB) {
    return (req, res, next) => {
        const clientIP = getClientIP(req);

        // LAN auto-auth
        if (ALLOW_LAN_AUTH && isLocalIP(clientIP)) {
            req.user = { id: 1, username: 'local', role: 'admin', isLocal: true };
            return next();
        }

        // Extract Bearer token from header, or fallback to query string
        // (EventSource and <video> elements cannot set custom headers)
        const authHeader = req.headers['authorization'];
        const token = authHeader && authHeader.startsWith('Bearer ')
            ? authHeader.slice(7)
            : (req.query && (req.query.token || req.query.session)) || null;

        if (!token) {
            return res.status(401).json({
                error: 'Token requerido',
                code: 'NO_TOKEN'
            });
        }

        try {
            const decoded = jwt.verify(token, JWT_SECRET);
            req.user = {
                id: decoded.userId,
                username: decoded.username,
                role: decoded.role
            };
            return next();
        } catch (err) {
            if (err.name === 'TokenExpiredError') {
                return res.status(401).json({
                    error: 'Token expirado',
                    code: 'TOKEN_EXPIRED'
                });
            }
            return res.status(401).json({
                error: 'Token invalido',
                code: 'TOKEN_INVALID'
            });
        }
    };
}

/**
 * Middleware factory that restricts access to specific roles
 * @param {...string} roles - Allowed roles
 * @returns {Function} Express middleware
 */
function requireRole(...roles) {
    return (req, res, next) => {
        if (!req.user) {
            return res.status(401).json({
                error: 'No autenticado',
                code: 'NOT_AUTHENTICATED'
            });
        }
        if (!roles.includes(req.user.role)) {
            return res.status(403).json({
                error: 'No tienes permisos para esta accion',
                code: 'FORBIDDEN'
            });
        }
        next();
    };
}

/**
 * Login rate limiting middleware
 *
 * Tracks failed login attempts per IP. Allows LOGIN_MAX_ATTEMPTS per LOGIN_WINDOW_MS.
 * The route handler must call req.recordLoginAttempt() on failed logins to increment the counter.
 *
 * @returns {Function} Express middleware
 */
function loginRateLimit() {
    const attempts = new Map(); // IP -> { count, firstAttempt }

    // Periodic cleanup every 30 minutes
    setInterval(() => {
        const now = Date.now();
        for (const [ip, data] of attempts) {
            if (now - data.firstAttempt > LOGIN_WINDOW_MS) {
                attempts.delete(ip);
            }
        }
    }, 30 * 60 * 1000);

    return (req, res, next) => {
        const ip = getClientIP(req);
        const now = Date.now();
        const record = attempts.get(ip);

        // Clean expired window
        if (record && now - record.firstAttempt > LOGIN_WINDOW_MS) {
            attempts.delete(ip);
        }

        const current = attempts.get(ip);

        // Check if rate limited
        if (current && current.count >= LOGIN_MAX_ATTEMPTS) {
            const retryAfter = Math.ceil((LOGIN_WINDOW_MS - (now - current.firstAttempt)) / 1000);
            return res.status(429).json({
                error: 'Demasiados intentos de login. Intenta mas tarde.',
                code: 'RATE_LIMITED',
                retryAfter
            });
        }

        // Attach helper for the route handler to call on failed login
        req.recordLoginAttempt = () => {
            const existing = attempts.get(ip);
            if (existing) {
                existing.count++;
            } else {
                attempts.set(ip, { count: 1, firstAttempt: now });
            }
        };

        next();
    };
}

// ============================================
// UTILITY FUNCTIONS
// ============================================

/**
 * Calculate the expiry Date for a refresh token based on JWT_REFRESH_EXPIRY
 * Parses formats like '30d', '7d', '24h', '60m'
 * @returns {Date}
 */
function getRefreshTokenExpiryDate() {
    const expiry = JWT_REFRESH_EXPIRY;
    const match = expiry.match(/^(\d+)([dhms])$/);

    if (!match) {
        // Default to 30 days if format is unrecognized
        return new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    }

    const value = parseInt(match[1]);
    const unit = match[2];
    let ms;

    switch (unit) {
        case 'd': ms = value * 24 * 60 * 60 * 1000; break;
        case 'h': ms = value * 60 * 60 * 1000; break;
        case 'm': ms = value * 60 * 1000; break;
        case 's': ms = value * 1000; break;
        default: ms = 30 * 24 * 60 * 60 * 1000;
    }

    return new Date(Date.now() + ms);
}

// ============================================
// EXPORTS
// ============================================

module.exports = {
    // JWT
    generateAccessToken,
    generateRefreshToken,
    verifyAccessToken,

    // Passwords
    hashPassword,
    comparePassword,
    isLegacySHA256,
    verifySHA256,

    // Network
    isLocalIP,
    getClientIP,

    // Middleware
    authMiddleware,
    requireRole,
    loginRateLimit,

    // Utility
    getRefreshTokenExpiryDate,

    // Constants (read-only)
    JWT_SECRET,
    JWT_ACCESS_EXPIRY,
    JWT_REFRESH_EXPIRY,
    BCRYPT_ROUNDS,
    ALLOW_LAN_AUTH
};
