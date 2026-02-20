require('dotenv').config();
const express = require('express');
const cookieParser = require('cookie-parser');
const OpenAI = require('openai');
const multer = require('multer');
const fs = require('fs');
const { getDb } = require('./config/db');
const { requireAuth } = require('./middleware/auth');
const authRoutes = require('./routes/auth');
const { billingRoutes, billingWebhookHandler } = require('./routes/billing');

const app = express();
const upload = multer({ dest: 'uploads/' });

if (!fs.existsSync('./uploads')) fs.mkdirSync('./uploads');

// Initialize database (creates tables if needed)
getDb();

// Stripe webhook must use raw body before JSON middleware.
app.post('/api/billing/webhook', express.raw({ type: 'application/json' }), billingWebhookHandler);
app.use(express.json({ limit: '50mb' }));
app.use(cookieParser());
app.use(express.static(__dirname));
app.use('/uploads', express.static('uploads'));

// Auth API (login, register, logout, me, forgot/reset password)
app.use('/api/auth', authRoutes);

// Chat API (chat history, messages, etc.)
const chatRoutes = require('./routes/chat');
app.use('/api/chats', chatRoutes);
app.use('/api/billing', billingRoutes);

const groq = new OpenAI({
    apiKey: process.env.GROQ_API_KEY,
    baseURL: "https://api.groq.com/openai/v1" 
});

const ACTIVE_CHAT_MODEL = process.env.GROQ_CHAT_MODEL || "meta-llama/llama-4-scout-17b-16e-instruct";
const ACTIVE_VISION_MODEL = process.env.GROQ_VISION_MODEL || "meta-llama/llama-4-scout-17b-16e-instruct";
const PLAN_RUNTIME = {
    free: {
        initialDelayMs: 900,
        chunkDelayMs: 18,
        maxTokens: 700,
        windowMs: 60 * 60 * 1000,
        maxMessagesPerWindow: 40
    },
    plus: {
        initialDelayMs: 120,
        chunkDelayMs: 0,
        maxTokens: 1800,
        windowMs: 60 * 60 * 1000,
        maxMessagesPerWindow: 400
    }
};
const usageWindowByUser = new Map();
const MODEL_CATALOG = [
    {
        id: 'vantage-4o',
        label: 'VANTAGE 4o',
        tier: 'free',
        model: ACTIVE_CHAT_MODEL,
        mode: 'balanced',
        persona: 'default'
    },
    {
        id: 'vantage-4o-chill',
        label: 'VANTAGE 4o Chill',
        tier: 'free',
        model: ACTIVE_CHAT_MODEL,
        mode: 'balanced',
        persona: 'chill'
    },
    {
        id: 'vantage-4o-coach',
        label: 'VANTAGE 4o Coach',
        tier: 'free',
        model: ACTIVE_CHAT_MODEL,
        mode: 'balanced',
        persona: 'coach'
    },
    {
        id: 'vantage-1.0-pro',
        label: 'VANTAGE 1.0 PRO',
        tier: 'plus',
        model: ACTIVE_CHAT_MODEL,
        mode: 'pro',
        persona: 'pro'
    },
    {
        id: 'vantage-1.0-thinking',
        label: 'VANTAGE 1.0 THINKING',
        tier: 'plus',
        model: ACTIVE_CHAT_MODEL,
        mode: 'thinking',
        persona: 'analyst'
    },
    {
        id: 'vantage-1.0-creative',
        label: 'VANTAGE 1.0 Creative',
        tier: 'plus',
        model: ACTIVE_CHAT_MODEL,
        mode: 'pro',
        persona: 'creative'
    },
    {
        id: 'vantage-1.0-coder',
        label: 'VANTAGE 1.0 Coder',
        tier: 'plus',
        model: ACTIVE_CHAT_MODEL,
        mode: 'pro',
        persona: 'coder'
    }
];

function buildChatTitleFromMessage(content) {
    const cleaned = String(content || '')
        .replace(/\s+/g, ' ')
        .trim();

    if (!cleaned) return 'Image conversation';

    // Keep titles short and topic-like (ChatGPT-style conversation labels).
    const firstSentence = cleaned.split(/[.!?\n]/)[0].trim();
    const withoutPromptLead = firstSentence
        .replace(/^(what is|what's|tell me about|can you|could you|please|help me|i want to know)\s+/i, '')
        .trim();
    const source = withoutPromptLead || firstSentence;
    const words = source.split(' ').filter(Boolean).slice(0, 6);
    let title = words.join(' ');
    if (!title) return 'New conversation';
    title = title.charAt(0).toUpperCase() + title.slice(1);
    return title.length <= 60 ? title : `${title.slice(0, 57).trim()}...`;
}

function formatMessagesForModel(history = []) {
    return history.map((msg) => {
        const imageUrl = msg?.image?.dataUrl || msg?.image?.url || msg?.img || null;
        if (imageUrl) {
            return {
                role: "user",
                content: [
                    { type: "text", text: msg.content || "Please describe this image and what is happening." },
                    { type: "image_url", image_url: { url: imageUrl } }
                ]
            };
        }
        return { role: msg.role, content: msg.content };
    });
}

function hasImageInMessages(formattedMessages = []) {
    return formattedMessages.some((msg) => (
        Array.isArray(msg?.content)
        && msg.content.some((part) => part && part.type === 'image_url')
    ));
}

function isModelRetiredError(error) {
    const message = String(error?.message || error?.error?.message || '').toLowerCase();
    return error?.code === 'model_decommissioned' || message.includes('decommissioned');
}

async function createCompletionWithFallback({
    models = [],
    messages = [],
    maxTokens = 700,
    stream = false
}) {
    const uniqueModels = [...new Set(models.filter(Boolean))];
    let lastError = null;

    for (const model of uniqueModels) {
        try {
            return await groq.chat.completions.create({
                model,
                messages,
                max_tokens: maxTokens,
                stream
            });
        } catch (error) {
            lastError = error;
            if (!isModelRetiredError(error)) {
                throw error;
            }
            console.warn(`Model unavailable (${model}), trying fallback...`);
        }
    }

    throw lastError || new Error('No available model for this request');
}

function dbGet(query, params = []) {
    const db = getDb();
    return new Promise((resolve, reject) => {
        db.get(query, params, (err, row) => (err ? reject(err) : resolve(row)));
    });
}

function dbRun(query, params = []) {
    const db = getDb();
    return new Promise((resolve, reject) => {
        db.run(query, params, function(err) {
            if (err) return reject(err);
            resolve(this);
        });
    });
}

function dbAll(query, params = []) {
    const db = getDb();
    return new Promise((resolve, reject) => {
        db.all(query, params, (err, rows) => (err ? reject(err) : resolve(rows)));
    });
}

async function getUserPlan(userId) {
    const subscription = await dbGet(
        'SELECT plan, status FROM subscriptions WHERE user_id = ?',
        [userId]
    ).catch(() => null);

    const isPlus = subscription?.plan === 'pro' && ['active', 'trialing'].includes(String(subscription?.status || '').toLowerCase());
    return isPlus ? 'plus' : 'free';
}

function getAllowedModelsForPlan(plan) {
    if (plan === 'plus') {
        return MODEL_CATALOG;
    }
    return MODEL_CATALOG.filter((model) => model.tier === 'free');
}

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function formatResetTime(resetAt) {
    try {
        return new Date(resetAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    } catch (_error) {
        return 'later';
    }
}

function checkUsageLimit(userId, plan) {
    const runtime = PLAN_RUNTIME[plan] || PLAN_RUNTIME.free;
    const key = String(userId);
    const now = Date.now();
    const current = usageWindowByUser.get(key);

    if (!current || now >= current.resetAt) {
        const next = {
            count: 1,
            resetAt: now + runtime.windowMs
        };
        usageWindowByUser.set(key, next);
        return { allowed: true, resetAt: next.resetAt, remaining: runtime.maxMessagesPerWindow - 1 };
    }

    if (current.count >= runtime.maxMessagesPerWindow) {
        return { allowed: false, resetAt: current.resetAt, remaining: 0 };
    }

    current.count += 1;
    usageWindowByUser.set(key, current);
    return {
        allowed: true,
        resetAt: current.resetAt,
        remaining: Math.max(0, runtime.maxMessagesPerWindow - current.count)
    };
}

function getUsageStatus(userId, plan) {
    const runtime = PLAN_RUNTIME[plan] || PLAN_RUNTIME.free;
    const key = String(userId);
    const now = Date.now();
    const current = usageWindowByUser.get(key);

    if (!current || now >= current.resetAt) {
        return {
            used: 0,
            limit: runtime.maxMessagesPerWindow,
            remaining: runtime.maxMessagesPerWindow,
            resetAt: now + runtime.windowMs
        };
    }

    return {
        used: current.count,
        limit: runtime.maxMessagesPerWindow,
        remaining: Math.max(0, runtime.maxMessagesPerWindow - current.count),
        resetAt: current.resetAt
    };
}

app.get('/api/models', requireAuth, async (req, res) => {
    try {
        const plan = await getUserPlan(req.user.id);
        const models = getAllowedModelsForPlan(plan).map(({ id, label, tier }) => ({ id, label, tier }));
        res.json({
            plan,
            defaultModelId: models[0]?.id || 'vantage-4o',
            models
        });
    } catch (error) {
        console.error('Model list error:', error);
        res.status(500).json({ error: 'Failed to load models' });
    }
});

app.get('/api/usage/status', requireAuth, async (req, res) => {
    try {
        const plan = await getUserPlan(req.user.id);
        const usage = getUsageStatus(req.user.id, plan);
        res.json({ plan, ...usage });
    } catch (error) {
        console.error('Usage status error:', error);
        res.status(500).json({ error: 'Failed to load usage status' });
    }
});

async function persistChatMessages(chatId, history = [], responseText = '') {
    if (!chatId) return;

    // Save user message (last in history array)
    const lastUserMessage = history.filter((msg) => msg.role === 'user').pop();
    if (lastUserMessage) {
        await dbRun(
            'INSERT INTO messages (chat_id, role, content) VALUES (?, ?, ?)',
            [chatId, 'user', lastUserMessage.content]
        );

    }

    // Save assistant response
    await dbRun(
        'INSERT INTO messages (chat_id, role, content) VALUES (?, ?, ?)',
        [chatId, 'assistant', responseText]
    );

    // Auto-title from the first 1-2 user turns unless the user renamed it.
    const existingChat = await dbGet('SELECT title FROM chats WHERE id = ?', [chatId]).catch(() => null);
    const normalizedTitle = String(existingChat?.title || '').trim().toLowerCase();
    const defaultTitles = new Set(['', 'new chat', 'new conversation', 'chat']);
    const canAutoRetitle = defaultTitles.has(normalizedTitle);

    const userTurns = await dbAll(
        `SELECT content
         FROM messages
         WHERE chat_id = ? AND role = 'user'
         ORDER BY id ASC
         LIMIT 2`,
        [chatId]
    ).catch(() => []);

    if ((canAutoRetitle || userTurns.length <= 2) && userTurns.length > 0) {
        const titleSource = userTurns.length === 1
            ? userTurns[0].content
            : `${userTurns[0].content} ${userTurns[1].content}`;
        const generatedTitle = buildChatTitleFromMessage(titleSource);
        if (generatedTitle && generatedTitle !== existingChat?.title) {
            await dbRun('UPDATE chats SET title = ? WHERE id = ?', [generatedTitle, chatId]);
        }
    }

    // Update chat timestamp
    await dbRun('UPDATE chats SET updated_at = datetime(\'now\') WHERE id = ?', [chatId]);
}

app.post('/upload', upload.single('file'), (req, res) => {
    if (!req.file) return res.status(400).send({ error: 'No file' });
    res.json({ filePath: `/uploads/${req.file.filename}` });
});

app.post('/chat', requireAuth, async (req, res) => {
    const { history = [], chatId, stream: shouldStream } = req.body || {};
    const requestedModelId = String((req.body && req.body.modelId) || 'vantage-4o');
    const memoryInput = req.body && typeof req.body.memory === 'object' ? req.body.memory : {};
    const formattedMessages = formatMessagesForModel(history);
    const includesImage = hasImageInMessages(formattedMessages);

    try {
        const userDisplayName = String(req.user?.display_name || req.user?.email || '').trim();
        const userNameHint = userDisplayName
            ? `The user's name is ${userDisplayName}. Remember it, but use their name sparingly (about once every 4-6 replies) and only when it adds value, like greetings, encouragement, or clarifying who you're addressing. Do not use their name in every response or every sentence.`
            : 'If the user shares their name, remember it for this session and use it sparingly only when useful.';
        const memoryEnabled = memoryInput && memoryInput.enabled === true;
        const memoryProfile = String(memoryInput && memoryInput.profile ? memoryInput.profile : '').trim().slice(0, 500);
        const memoryPrompt = memoryEnabled && memoryProfile
            ? `User memory is enabled. Personal context: ${memoryProfile}. Respect this context when relevant, but do not mention memory explicitly unless asked.`
            : 'User memory is disabled or empty. Do not assume persistent preferences beyond this chat.';

        const plan = await getUserPlan(req.user.id);
        const runtime = PLAN_RUNTIME[plan] || PLAN_RUNTIME.free;
        const usageCheck = checkUsageLimit(req.user.id, plan);
        if (!usageCheck.allowed) {
            const resetLabel = formatResetTime(usageCheck.resetAt);
            return res.status(429).json({
                error: `You hit the limit. Try again at ${resetLabel}.`,
                resetAt: usageCheck.resetAt
            });
        }

        const allowedModels = getAllowedModelsForPlan(plan);
        const selectedModel = allowedModels.find((item) => item.id === requestedModelId);
        if (!selectedModel) {
            return res.status(403).json({ error: 'This model requires VANTAGE Plus.' });
        }

        const stylePrompt = selectedModel.mode === 'thinking'
            ? 'Use clear, step-by-step reasoning and show concise thought structure for complex tasks.'
            : selectedModel.mode === 'pro'
                ? 'Provide richer and more complete answers, with practical detail when useful.'
                : 'Keep answers clear and concise.';

        const personaPrompt = selectedModel.persona === 'chill'
            ? 'Use a calm, casual tone while staying helpful and accurate.'
            : selectedModel.persona === 'coach'
                ? 'Use a supportive coaching tone focused on practical next steps.'
                : selectedModel.persona === 'creative'
                    ? 'Bring creative ideas, strong examples, and interesting angles.'
                    : selectedModel.persona === 'coder'
                        ? 'Prioritize clean technical answers, concise code, and debugging clarity.'
                        : selectedModel.persona === 'analyst'
                            ? 'Be analytical, structured, and rigorous in problem solving.'
                            : selectedModel.persona === 'pro'
                                ? 'Give high-quality polished answers with depth and clarity.'
                                : 'Use a helpful, friendly default tone.';

        const specializationPrompt = selectedModel.persona === 'coder'
            ? 'You are a senior software engineer. Be excellent at debugging, refactoring, and architecture. For Unity, prefer C# scripts and include where to place scripts in a project. For Roblox, prefer Luau patterns used in ServerScriptService/StarterPlayerScripts and call out replication/security best practices.'
            : selectedModel.persona === 'analyst'
                ? 'Handle requests with deeper analysis: identify assumptions, compare alternatives, and provide a concise recommendation with tradeoffs.'
                : selectedModel.persona === 'creative'
                    ? 'Generate high-quality concepts, names, hooks, and variations. Offer multiple options and a best pick.'
                    : selectedModel.persona === 'coach'
                        ? 'Turn goals into clear action plans with milestones and accountability steps.'
                        : 'No special domain specialization required.';

        const responseContract = selectedModel.persona === 'coder'
            ? 'When giving code, include runnable snippets, short inline comments only where needed, and a quick test checklist.'
            : selectedModel.mode === 'thinking'
                ? 'Think carefully before answering. Return concise structured reasoning as: Summary, Steps, and Final answer.'
                : selectedModel.mode === 'pro'
                    ? 'Prioritize correctness, practical detail, and useful examples.'
                    : 'Keep responses focused and readable.';

        const highEnergyModel = selectedModel.id === 'vantage-4o' || selectedModel.id === 'vantage-1.0-pro';
        const energyMatchPrompt = highEnergyModel
            ? 'For casual/hype messages (like "YOOOO", "wsg", "bro"), mirror that vibe in a short opener (1 brief line), then continue with a helpful answer. Keep it natural and do not overdo slang.'
            : 'Keep tone stable for this model; do not force hype slang.';

        const vibePrompt = plan === 'plus'
            ? 'When the user is casual or says things like "YOOOO", match the vibe naturally while staying helpful and respectful.'
            : 'Stay friendly and direct.';

        const modelMessages = [
            { role: "system", content: `You are AURA, VANTAGE's AI assistant. ${userNameHint} ${memoryPrompt} ${stylePrompt} ${personaPrompt} ${specializationPrompt} ${responseContract} ${energyMatchPrompt} ${vibePrompt}` },
            ...formattedMessages
        ];
        const runtimeModels = includesImage
            ? [ACTIVE_VISION_MODEL, selectedModel.model, ACTIVE_CHAT_MODEL]
            : [selectedModel.model];

        if (shouldStream) {
            if (runtime.initialDelayMs > 0) {
                await sleep(runtime.initialDelayMs);
            }
            const completion = await createCompletionWithFallback({
                models: runtimeModels,
                messages: modelMessages,
                maxTokens: runtime.maxTokens,
                stream: true
            });

            res.setHeader('Content-Type', 'text/plain; charset=utf-8');
            res.setHeader('Cache-Control', 'no-cache');
            res.setHeader('Connection', 'keep-alive');

            let responseText = '';
            let clientDisconnected = false;
            req.on('close', () => {
                clientDisconnected = true;
            });

            for await (const part of completion) {
                if (clientDisconnected) break;
                const delta = part?.choices?.[0]?.delta?.content || '';
                if (!delta) continue;
                responseText += delta;
                if (!res.writableEnded) {
                    res.write(delta);
                }
                if (runtime.chunkDelayMs > 0) {
                    await sleep(runtime.chunkDelayMs);
                }
            }
            if (responseText.trim()) {
                await persistChatMessages(chatId, history, responseText);
            }
            if (!res.writableEnded) {
                return res.end();
            }
            return;
        }

        const completion = await createCompletionWithFallback({
            models: runtimeModels,
            messages: modelMessages,
            maxTokens: runtime.maxTokens,
            stream: false
        });

        const responseText = completion.choices[0].message.content;
        await persistChatMessages(chatId, history, responseText);
        res.json({ text: responseText });
    } catch (error) {
        console.error('Chat completion error:', error);
        if (shouldStream) {
            return res.status(500).end();
        }
        res.status(400).json({ text: `AURA Link Error: ${error.message}` });
    }
});

// Return JSON for malformed JSON requests (instead of default HTML error page).
app.use((err, req, res, next) => {
    if (err && err.type === 'entity.parse.failed') {
        return res.status(400).json({ error: 'Invalid JSON payload' });
    }
    return next(err);
});

app.listen(3000, () => console.log(`🚀 AURA ONLINE: http://localhost:3000`));

