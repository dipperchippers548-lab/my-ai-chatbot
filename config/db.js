/**
 * VANTAGE 4o - Database configuration (SQLite)
 * Handles connection and table creation. Uses environment variable for DB path.
 */

const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

// Use env var or default to local file (never hardcode secrets)
const DB_PATH = process.env.DATABASE_PATH || path.join(__dirname, '..', 'data', 'vantage.db');

// Ensure data directory exists
const dataDir = path.dirname(DB_PATH);
if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
}

let db = null;

/**
 * Get or create the database connection (singleton).
 */
function getDb() {
    if (!db) {
        db = new sqlite3.Database(DB_PATH, (err) => {
            if (err) {
                console.error('Error opening database:', err.message);
            } else {
                console.log('Connected to SQLite database.');
                initTables(db);
            }
        });
    }
    return db;
}

/**
 * Create tables if they do not exist. Safe to run on every getDb().
 */
function initTables(database) {
    // Users: email/password auth, display name, email verification, timestamps
    database.serialize(() => {
        database.run(`
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                email TEXT UNIQUE NOT NULL,
                password_hash TEXT NOT NULL,
                display_name TEXT,
                email_verified INTEGER DEFAULT 0,
                created_at TEXT DEFAULT (datetime('now')),
                updated_at TEXT DEFAULT (datetime('now'))
            )
        `);

        database.run(`CREATE INDEX IF NOT EXISTS idx_users_email ON users(email)`);

        // Password reset tokens (for forgot-password flow)
        database.run(`
            CREATE TABLE IF NOT EXISTS password_reset_tokens (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                token TEXT NOT NULL,
                expires_at TEXT NOT NULL,
                used INTEGER DEFAULT 0,
                created_at TEXT DEFAULT (datetime('now'))
            )
        `);

        database.run(`CREATE INDEX IF NOT EXISTS idx_reset_tokens_token ON password_reset_tokens(token)`);

        // Sessions / device tracking (for security: device & IP checks later)
        database.run(`
            CREATE TABLE IF NOT EXISTS sessions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                token_hash TEXT,
                ip_address TEXT,
                user_agent TEXT,
                created_at TEXT DEFAULT (datetime('now')),
                expires_at TEXT
            )
        `);

        database.run(`CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id)`);

        // Chats table
        database.run(`
            CREATE TABLE IF NOT EXISTS chats (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                title TEXT DEFAULT 'New Chat',
                created_at TEXT DEFAULT (datetime('now')),
                updated_at TEXT DEFAULT (datetime('now'))
            )
        `);

        database.run(`CREATE INDEX IF NOT EXISTS idx_chats_user ON chats(user_id)`);

        // Messages table
        database.run(`
            CREATE TABLE IF NOT EXISTS messages (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                chat_id INTEGER NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
                role TEXT NOT NULL,
                content TEXT NOT NULL,
                created_at TEXT DEFAULT (datetime('now'))
            )
        `);

        database.run(`CREATE INDEX IF NOT EXISTS idx_messages_chat ON messages(chat_id)`);

        // Subscriptions table (Stripe-ready; Phase 2)
        database.run(`
            CREATE TABLE IF NOT EXISTS subscriptions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER UNIQUE NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                plan TEXT DEFAULT 'free',
                stripe_customer_id TEXT,
                stripe_subscription_id TEXT,
                status TEXT DEFAULT 'active',
                current_period_end TEXT,
                created_at TEXT DEFAULT (datetime('now')),
                updated_at TEXT DEFAULT (datetime('now'))
            )
        `);

        database.run(`CREATE INDEX IF NOT EXISTS idx_subscriptions_user ON subscriptions(user_id)`);

        // Stripe webhook event logs (for auditing/retry diagnostics)
        database.run(`
            CREATE TABLE IF NOT EXISTS stripe_webhook_events (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                event_id TEXT UNIQUE,
                event_type TEXT,
                status TEXT NOT NULL,
                error_message TEXT,
                payload TEXT,
                created_at TEXT DEFAULT (datetime('now')),
                updated_at TEXT DEFAULT (datetime('now'))
            )
        `);

        database.run(`CREATE INDEX IF NOT EXISTS idx_webhook_events_status ON stripe_webhook_events(status)`);
        database.run(`CREATE INDEX IF NOT EXISTS idx_webhook_events_created ON stripe_webhook_events(created_at)`);
    });
}

/**
 * Close the database connection (for graceful shutdown).
 */
function closeDb() {
    if (db) {
        db.close((err) => {
            if (err) {
                console.error('Error closing database:', err.message);
            } else {
                console.log('Database connection closed.');
            }
        });
        db = null;
    }
}

module.exports = { getDb, closeDb, initTables };
