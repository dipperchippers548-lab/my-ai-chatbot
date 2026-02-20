/**
 * VANTAGE 4o - Authentication service
 * Handles password hashing, user registration, login validation.
 * No secrets hardcoded; uses env vars for JWT.
 */

const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const { getDb } = require('../config/db');

// Salt rounds for bcrypt (higher = more secure, slower)
const SALT_ROUNDS = 12;

/**
 * Hash a plain-text password for storage.
 * @param {string} plainPassword
 * @returns {Promise<string>} hashed password
 */
async function hashPassword(plainPassword) {
    return bcrypt.hash(plainPassword, SALT_ROUNDS);
}

/**
 * Compare plain password with stored hash.
 * @param {string} plainPassword
 * @param {string} hash
 * @returns {Promise<boolean>}
 */
async function comparePassword(plainPassword, hash) {
    return bcrypt.compare(plainPassword, hash);
}

/**
 * Create a new user (register). Returns user without password_hash.
 * @param {object} params - { email, password, displayName }
 * @returns {Promise<object>} { id, email, display_name, created_at } or throws
 */
async function register({ email, password, displayName }) {
    return new Promise((resolve, reject) => {
        const db = getDb();
        const emailNorm = (email || '').trim().toLowerCase();
        if (!emailNorm || !password) {
            const err = new Error('Email and password are required');
            err.code = 'VALIDATION';
            return reject(err);
        }
        if (password.length < 8) {
            const err = new Error('Password must be at least 8 characters');
            err.code = 'VALIDATION';
            return reject(err);
        }
        
        hashPassword(password).then(passwordHash => {
            const stmt = db.prepare(
                'INSERT INTO users (email, password_hash, display_name) VALUES (?, ?, ?)'
            );
            
            stmt.run(emailNorm, passwordHash, (displayName || '').trim() || null, function(err) {
                if (err) {
                    if (err.message && err.message.includes('UNIQUE')) {
                        const error = new Error('An account with this email already exists');
                        error.code = 'DUPLICATE_EMAIL';
                        return reject(error);
                    }
                    return reject(err);
                }
                
                db.get('SELECT id, email, display_name, created_at FROM users WHERE id = ?', [this.lastID], (err, row) => {
                    if (err) return reject(err);
                    resolve(sanitizeUser(row));
                });
            });
        }).catch(reject);
    });
}

/**
 * Validate credentials and return user (without password).
 * @param {string} email
 * @param {string} password
 * @returns {Promise<object|null>} user or null
 */
async function login(email, password) {
    return new Promise((resolve, reject) => {
        const db = getDb();
        const emailNorm = (email || '').trim().toLowerCase();
        
        db.get('SELECT id, email, display_name, password_hash, created_at FROM users WHERE email = ?', [emailNorm], async (err, row) => {
            if (err) return reject(err);
            if (!row) return resolve(null);
            
            try {
                const match = await comparePassword(password, row.password_hash);
                if (!match) return resolve(null);
                resolve(sanitizeUser(row));
            } catch (error) {
                reject(error);
            }
        });
    });
}

/**
 * Find user by ID (for session validation).
 */
function findUserById(id) {
    return new Promise((resolve) => {
        const db = getDb();
        db.get('SELECT id, email, display_name, email_verified, created_at FROM users WHERE id = ?', [id], (err, row) => {
            if (err || !row) {
                resolve(null);
            } else {
                resolve(sanitizeUser(row));
            }
        });
    });
}

/**
 * Remove sensitive fields from user object.
 */
function sanitizeUser(row) {
    if (!row) return null;
    const u = { ...row };
    delete u.password_hash;
    u.display_name = u.display_name || u.email;
    return u;
}

/**
 * Generate a secure random token (e.g. for password reset).
 */
function generateToken() {
    return crypto.randomBytes(32).toString('hex');
}

/**
 * Forgot-password: create a reset token and return it (in production, send via email).
 * @param {string} email
 * @returns {Promise<{ token: string }|null>} token if user exists, else null
 */
async function createPasswordResetToken(email) {
    return new Promise((resolve, reject) => {
        const db = getDb();
        const emailNorm = (email || '').trim().toLowerCase();
        
        db.get('SELECT id FROM users WHERE email = ?', [emailNorm], (err, user) => {
            if (err) return reject(err);
            if (!user) return resolve(null);
            
            const token = generateToken();
            const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString(); // 1 hour
            
            const stmt = db.prepare('INSERT INTO password_reset_tokens (user_id, token, expires_at) VALUES (?, ?, ?)');
            stmt.run(user.id, token, expiresAt, function(err) {
                if (err) return reject(err);
                resolve({ token, userId: user.id });
            });
        });
    });
}

/**
 * Reset password using token. Returns true if success.
 */
async function resetPasswordWithToken(token, newPassword) {
    return new Promise((resolve, reject) => {
        if (newPassword.length < 8) return resolve(false);
        
        const db = getDb();
        
        db.get('SELECT id, user_id, expires_at, used FROM password_reset_tokens WHERE token = ?', [token], async (err, row) => {
            if (err) return reject(err);
            if (!row || row.used || new Date(row.expires_at) < new Date()) return resolve(false);
            
            try {
                const hash = await hashPassword(newPassword);
                
                db.serialize(() => {
                    const updateUser = db.prepare('UPDATE users SET password_hash = ?, updated_at = datetime(\'now\') WHERE id = ?');
                    const markUsed = db.prepare('UPDATE password_reset_tokens SET used = 1 WHERE id = ?');
                    
                    updateUser.run(hash, row.user_id);
                    markUsed.run(row.id, (err) => {
                        if (err) return reject(err);
                        resolve(true);
                    });
                });
            } catch (error) {
                reject(error);
            }
        });
    });
}

module.exports = {
    hashPassword,
    comparePassword,
    register,
    login,
    findUserById,
    generateToken,
    createPasswordResetToken,
    resetPasswordWithToken,
    sanitizeUser,
};
