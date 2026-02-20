/**
 * VANTAGE 4o - Auth API routes
 * POST /api/auth/register, /api/auth/login, /api/auth/logout
 * GET /api/auth/me, POST /api/auth/forgot-password, /api/auth/reset-password
 */

const express = require('express');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { register, login, findUserById, createPasswordResetToken, resetPasswordWithToken, hashPassword, sanitizeUser } = require('../services/authService');
const { requireAuth, optionalAuth, getTokenFromRequest, COOKIE_NAME } = require('../middleware/auth');
const { getDb } = require('../config/db');

const router = express.Router();
// Use env; fallback only for local dev (set JWT_SECRET in production)
const JWT_SECRET = process.env.JWT_SECRET || process.env.SESSION_SECRET || 'vantage-dev-secret-change-in-production';
const COOKIE_OPTIONS = {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
    path: '/',
};
const FIREBASE_WEB_API_KEY = process.env.FIREBASE_WEB_API_KEY || 'AIzaSyCAdInE9zpi2AWKyOgkahE1KMEzPxJLfAc';

async function verifyFirebaseIdToken(idToken) {
    const response = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${FIREBASE_WEB_API_KEY}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ idToken })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.users || data.users.length === 0) {
        return null;
    }
    return data.users[0];
}

async function findOrCreateOAuthUser(firebaseUser) {
    const db = getDb();
    const email = String(firebaseUser.email || '').trim().toLowerCase();
    if (!email) return null;

    const existingUser = await new Promise((resolve, reject) => {
        db.get(
            'SELECT id, email, display_name, email_verified, created_at FROM users WHERE email = ?',
            [email],
            (err, row) => (err ? reject(err) : resolve(row))
        );
    });
    if (existingUser) {
        return sanitizeUser(existingUser);
    }

    const displayName = String(firebaseUser.displayName || email.split('@')[0]).trim();
    const randomPassword = crypto.randomBytes(24).toString('hex');
    const passwordHash = await hashPassword(randomPassword);

    const createdUserId = await new Promise((resolve, reject) => {
        db.run(
            `INSERT INTO users (email, password_hash, display_name, email_verified)
             VALUES (?, ?, ?, ?)`,
            [email, passwordHash, displayName || null, firebaseUser.emailVerified ? 1 : 0],
            function(err) {
                if (err) return reject(err);
                resolve(this.lastID);
            }
        );
    });

    const createdUser = await new Promise((resolve, reject) => {
        db.get(
            'SELECT id, email, display_name, email_verified, created_at FROM users WHERE id = ?',
            [createdUserId],
            (err, row) => (err ? reject(err) : resolve(row))
        );
    });

    return sanitizeUser(createdUser);
}

/**
 * POST /api/auth/register
 * Body: { email, password, displayName? }
 */
router.post('/register', async (req, res) => {
    try {
        const { email, password, displayName } = req.body || {};
        const user = await register({ email, password, displayName });
        const token = jwt.sign({ userId: user.id }, JWT_SECRET, { expiresIn: '7d' });
        res.cookie(COOKIE_NAME, token, COOKIE_OPTIONS);
        res.json({ user, token });
    } catch (e) {
        if (e.code === 'VALIDATION' || e.code === 'DUPLICATE_EMAIL') {
            return res.status(400).json({ error: e.message, code: e.code });
        }
        res.status(500).json({ error: 'Registration failed' });
    }
});

/**
 * POST /api/auth/login
 * Body: { email, password, rememberMe? }
 */
router.post('/login', async (req, res) => {
    try {
        const { email, password } = req.body || {};
        const user = await login(email, password);
        if (!user) {
            return res.status(401).json({ error: 'Invalid email or password', code: 'INVALID_CREDENTIALS' });
        }
        const token = jwt.sign({ userId: user.id }, JWT_SECRET, { expiresIn: '7d' });
        res.cookie(COOKIE_NAME, token, COOKIE_OPTIONS);
        res.json({ user, token });
    } catch (e) {
        res.status(500).json({ error: 'Login failed' });
    }
});

/**
 * POST /api/auth/logout
 * Clears auth cookie.
 */
router.post('/logout', (req, res) => {
    res.clearCookie(COOKIE_NAME, { path: '/', httpOnly: true });
    res.json({ ok: true });
});

/**
 * GET /api/auth/me
 * Returns current user if authenticated.
 */
router.get('/me', optionalAuth, (req, res) => {
    if (req.user) {
        const db = getDb();
        return db.get(
            'SELECT plan, status FROM subscriptions WHERE user_id = ?',
            [req.user.id],
            (err, sub) => {
                const status = String(sub?.status || 'inactive').toLowerCase();
                const isPlus = sub?.plan === 'pro' && (status === 'active' || status === 'trialing');
                const effectivePlan = isPlus ? 'pro' : 'free';
                if (err) {
                    return res.json({ user: { ...req.user, plan: 'free', plan_status: 'inactive' } });
                }
                return res.json({
                    user: {
                        ...req.user,
                        plan: effectivePlan,
                        plan_status: sub?.status || 'inactive'
                    }
                });
            }
        );
    }
    res.json({ user: null });
});

/**
 * PUT /api/auth/me
 * Body: { displayName }
 * Updates the current user's display name.
 */
router.put('/me', requireAuth, (req, res) => {
    const displayName = String((req.body && req.body.displayName) || '').trim();
    if (!displayName) {
        return res.status(400).json({ error: 'Display name is required', code: 'VALIDATION' });
    }
    if (displayName.length > 60) {
        return res.status(400).json({ error: 'Display name is too long', code: 'VALIDATION' });
    }

    try {
        const db = getDb();
        db.run(
            `UPDATE users
             SET display_name = ?, updated_at = datetime('now')
             WHERE id = ?`,
            [displayName, req.user.id],
            function(err) {
                if (err) {
                    return res.status(500).json({ error: 'Failed to update profile' });
                }
                db.get(
                    'SELECT id, email, display_name, email_verified, created_at FROM users WHERE id = ?',
                    [req.user.id],
                    (getErr, user) => {
                        if (getErr || !user) {
                            return res.status(500).json({ error: 'Failed to fetch updated profile' });
                        }
                        res.json({
                            user: {
                                id: user.id,
                                email: user.email,
                                display_name: user.display_name || user.email,
                                email_verified: user.email_verified,
                                created_at: user.created_at
                            }
                        });
                    }
                );
            }
        );
    } catch (e) {
        res.status(500).json({ error: 'Failed to update profile' });
    }
});

/**
 * POST /api/auth/forgot-password
 * Body: { email }
 * In production: send reset link via email. Here we return a token for demo.
 */
router.post('/forgot-password', async (req, res) => {
    try {
        const { email } = req.body || {};
        const result = await createPasswordResetToken(email);
        // Never expose whether email exists; always return success for security
        if (result) {
            // Demo: return reset link with token (in production, send email only)
            res.json({
                message: 'If an account exists, a reset link would be sent.',
                // Only for dev/demo: include reset token so frontend can show reset form
                resetToken: process.env.NODE_ENV !== 'production' ? result.token : undefined,
            });
        } else {
            res.json({ message: 'If an account exists, a reset link would be sent.' });
        }
    } catch (e) {
        res.status(500).json({ error: 'Request failed' });
    }
});

/**
 * POST /api/auth/reset-password
 * Body: { token, newPassword }
 */
router.post('/reset-password', async (req, res) => {
    try {
        const { token, newPassword } = req.body || {};
        const ok = await resetPasswordWithToken(token, newPassword);
        if (!ok) {
            return res.status(400).json({ error: 'Invalid or expired reset link', code: 'INVALID_RESET' });
        }
        res.json({ message: 'Password updated. You can sign in now.' });
    } catch (e) {
        res.status(500).json({ error: 'Reset failed' });
    }
});

/**
 * POST /api/auth/firebase/google
 * Body: { idToken }
 * Exchanges Firebase Google auth token for local session cookie.
 */
router.post('/firebase/google', async (req, res) => {
    try {
        const idToken = String((req.body && req.body.idToken) || '').trim();
        if (!idToken) {
            return res.status(400).json({ error: 'Missing Firebase token', code: 'VALIDATION' });
        }

        const firebaseUser = await verifyFirebaseIdToken(idToken);
        if (!firebaseUser) {
            return res.status(401).json({ error: 'Invalid Firebase token', code: 'INVALID_TOKEN' });
        }

        const isGoogleProvider =
            Array.isArray(firebaseUser.providerUserInfo) &&
            firebaseUser.providerUserInfo.some((item) => item.providerId === 'google.com');
        if (!isGoogleProvider) {
            return res.status(400).json({ error: 'Token is not from Google sign-in', code: 'INVALID_PROVIDER' });
        }

        const user = await findOrCreateOAuthUser(firebaseUser);
        if (!user) {
            return res.status(400).json({ error: 'User email missing from provider', code: 'INVALID_PROFILE' });
        }

        const token = jwt.sign({ userId: user.id }, JWT_SECRET, { expiresIn: '7d' });
        res.cookie(COOKIE_NAME, token, COOKIE_OPTIONS);
        res.json({ user, token });
    } catch (e) {
        console.error('Firebase Google login failed:', e);
        res.status(500).json({ error: 'Google login failed' });
    }
});

module.exports = router;
