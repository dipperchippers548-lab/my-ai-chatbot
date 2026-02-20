/**
 * VANTAGE 4o - Chat API routes
 * GET /api/chats - Get user's chat history
 * POST /api/chats - Create new chat
 * GET /api/chats/:id - Get specific chat
 * PUT /api/chats/:id - Update chat (title, pin, etc.)
 * DELETE /api/chats/:id - Delete chat
 */

const express = require('express');
const { requireAuth } = require('../middleware/auth');
const { getDb } = require('../config/db');

const router = express.Router();

// Get all chats for the current user
router.get('/', requireAuth, (req, res) => {
    try {
        const db = getDb();
        const query = `
            SELECT c.*, COUNT(m.id) as message_count
            FROM chats c
            LEFT JOIN messages m ON c.id = m.chat_id
            WHERE c.user_id = ?
            GROUP BY c.id
            ORDER BY c.updated_at DESC
        `;
        
        db.all(query, [req.user.id], (err, chats) => {
            if (err) {
                console.error('Error fetching chats:', err);
                return res.status(500).json({ error: 'Failed to fetch chats' });
            }
            res.json(chats);
        });
    } catch (error) {
        console.error('Error fetching chats:', error);
        res.status(500).json({ error: 'Failed to fetch chats' });
    }
});

// Create new chat
router.post('/', requireAuth, (req, res) => {
    try {
        const db = getDb();
        const { title = 'New Chat' } = req.body;

        const stmt = db.prepare(`
            INSERT INTO chats (user_id, title) VALUES (?, ?)
        `);

        stmt.run(req.user.id, title, function(err) {
            if (err) {
                console.error('Error creating chat:', err);
                return res.status(500).json({ error: 'Failed to create chat' });
            }
            
            db.get(`
                SELECT id, user_id, title, created_at, updated_at 
                FROM chats 
                WHERE id = ?
            `, [this.lastID], (err, newChat) => {
                if (err) {
                    console.error('Error fetching new chat:', err);
                    return res.status(500).json({ error: 'Failed to fetch new chat' });
                }
                res.status(201).json(newChat);
            });
        });
    } catch (error) {
        console.error('Error creating chat:', error);
        res.status(500).json({ error: 'Failed to create chat' });
    }
});

// Get specific chat with messages
router.get('/:id', requireAuth, (req, res) => {
    try {
        const db = getDb();
        const chatId = req.params.id;

        // Verify chat belongs to user
        db.get(`
            SELECT id, user_id, title, created_at, updated_at
            FROM chats
            WHERE id = ? AND user_id = ?
        `, [chatId, req.user.id], (err, chat) => {
            if (err) {
                console.error('Error fetching chat:', err);
                return res.status(500).json({ error: 'Failed to fetch chat' });
            }
            
            if (!chat) {
                return res.status(404).json({ error: 'Chat not found' });
            }

            // Get messages for this chat
            db.all(`
                SELECT id, role, content, created_at
                FROM messages
                WHERE chat_id = ?
                ORDER BY created_at ASC
            `, [chatId], (err, messages) => {
                if (err) {
                    console.error('Error fetching messages:', err);
                    return res.status(500).json({ error: 'Failed to fetch messages' });
                }
                
                res.json({
                    chat,
                    messages
                });
            });
        });
    } catch (error) {
        console.error('Error fetching chat:', error);
        res.status(500).json({ error: 'Failed to fetch chat' });
    }
});

// Update chat (title, pin status, etc.)
router.put('/:id', requireAuth, (req, res) => {
    try {
        const db = getDb();
        const chatId = req.params.id;
        const { title, pinned } = req.body;

        // Verify chat belongs to user
        const existingChat = db.prepare(`
            SELECT id, user_id
            FROM chats
            WHERE id = ? AND user_id = ?
        `).get(chatId, req.user.id);

        if (!existingChat) {
            return res.status(404).json({ error: 'Chat not found' });
        }

        // Update chat
        const stmt = db.prepare(`
            UPDATE chats 
            SET title = COALESCE(?, title),
                updated_at = datetime('now')
            WHERE id = ?
        `);

        stmt.run(title, chatId);

        const updatedChat = db.prepare(`
            SELECT id, user_id, title, created_at, updated_at
            FROM chats
            WHERE id = ?
        `).get(chatId);

        res.json(updatedChat);
    } catch (error) {
        console.error('Error updating chat:', error);
        res.status(500).json({ error: 'Failed to update chat' });
    }
});

// Delete chat
router.delete('/:id', requireAuth, (req, res) => {
    try {
        const db = getDb();
        const chatId = req.params.id;

        // Verify chat belongs to user
        const existingChat = db.prepare(`
            SELECT id, user_id
            FROM chats
            WHERE id = ? AND user_id = ?
        `).get(chatId, req.user.id);

        if (!existingChat) {
            return res.status(404).json({ error: 'Chat not found' });
        }

        // Delete chat (messages will be deleted due to CASCADE)
        const stmt = db.prepare('DELETE FROM chats WHERE id = ?');
        stmt.run(chatId);

        res.json({ success: true });
    } catch (error) {
        console.error('Error deleting chat:', error);
        res.status(500).json({ error: 'Failed to delete chat' });
    }
});

// Save message to chat
router.post('/:id/messages', requireAuth, (req, res) => {
    try {
        const db = getDb();
        const chatId = req.params.id;
        const { role, content } = req.body;

        if (!role || !content) {
            return res.status(400).json({ error: 'Role and content are required' });
        }

        // Verify chat belongs to user
        const existingChat = db.prepare(`
            SELECT id, user_id
            FROM chats
            WHERE id = ? AND user_id = ?
        `).get(chatId, req.user.id);

        if (!existingChat) {
            return res.status(404).json({ error: 'Chat not found' });
        }

        // Insert message
        const stmt = db.prepare(`
            INSERT INTO messages (chat_id, role, content) VALUES (?, ?, ?)
        `);

        const result = stmt.run(chatId, role, content);

        // Update chat's updated_at timestamp
        db.prepare('UPDATE chats SET updated_at = datetime(\'now\') WHERE id = ?')
            .run(chatId);

        const newMessage = db.prepare(`
            SELECT id, chat_id, role, content, created_at
            FROM messages
            WHERE id = ?
        `).get(result.lastInsertRowid);

        res.status(201).json(newMessage);
    } catch (error) {
        console.error('Error saving message:', error);
        res.status(500).json({ error: 'Failed to save message' });
    }
});

module.exports = router;