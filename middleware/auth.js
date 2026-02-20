/**
 * VANTAGE 4o - Auth middleware
 * Verifies JWT from cookie or Authorization header and attaches req.user.
 */

const jwt = require('jsonwebtoken');
const { findUserById } = require('../services/authService');

// JWT secret from env; never hardcode (fallback for dev only; set JWT_SECRET in production)
const JWT_SECRET = process.env.JWT_SECRET || process.env.SESSION_SECRET || 'vantage-dev-secret-change-in-production';
const COOKIE_NAME = process.env.AUTH_COOKIE_NAME || 'vantage_token';

/**
 * Optional auth: if valid token present, set req.user; otherwise leave unset.
 * Use for routes that work for both guest and logged-in users.
 */
async function optionalAuth(req, res, next) {
    const token = getTokenFromRequest(req);
    if (!token) return next();
    try {
        const payload = jwt.verify(token, JWT_SECRET);
        const user = await findUserById(payload.userId);
        if (user) req.user = user;
    } catch (_) { /* ignore invalid token */ }
    next();
}

/**
 * Required auth: must have valid token and user. Otherwise 401.
 */
async function requireAuth(req, res, next) {
    const token = getTokenFromRequest(req);
    if (!token) {
        return res.status(401).json({ error: 'Not authenticated', code: 'NO_TOKEN' });
    }
    try {
        const payload = jwt.verify(token, JWT_SECRET);
        const user = await findUserById(payload.userId);
        if (!user) {
            return res.status(401).json({ error: 'User not found', code: 'INVALID_TOKEN' });
        }
        req.user = user;
        next();
    } catch (e) {
        return res.status(401).json({ error: 'Invalid or expired session', code: 'INVALID_TOKEN' });
    }
}

/**
 * Get JWT from cookie (preferred) or Authorization: Bearer <token>.
 */
function getTokenFromRequest(req) {
    const cookie = req.cookies && req.cookies[COOKIE_NAME];
    if (cookie) return cookie;
    const auth = req.headers.authorization;
    if (auth && auth.startsWith('Bearer ')) return auth.slice(7);
    return null;
}

module.exports = { optionalAuth, requireAuth, getTokenFromRequest, COOKIE_NAME };
