const express = require('express');
const Stripe = require('stripe');
const { requireAuth } = require('../middleware/auth');
const { getDb } = require('../config/db');

const router = express.Router();

const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || '';
const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || '';
const STRIPE_PLUS_PRICE_ID = process.env.STRIPE_PLUS_PRICE_ID || '';
const APP_BASE_URL = process.env.APP_BASE_URL || 'http://localhost:3000';

const stripe = STRIPE_SECRET_KEY ? new Stripe(STRIPE_SECRET_KEY) : null;

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

function planFromSubscriptionStatus(status) {
    return status === 'active' || status === 'trialing' ? 'pro' : 'free';
}

function normalizePayload(payload) {
    if (!payload) return null;
    try {
        const text = Buffer.isBuffer(payload) ? payload.toString('utf8') : JSON.stringify(payload);
        return text.length > 4000 ? `${text.slice(0, 4000)}...` : text;
    } catch (_error) {
        return null;
    }
}

async function logWebhookEvent({
    eventId = null,
    eventType = null,
    status = 'received',
    errorMessage = null,
    payload = null
}) {
    const query = `
        INSERT INTO stripe_webhook_events (event_id, event_type, status, error_message, payload, updated_at)
        VALUES (?, ?, ?, ?, ?, datetime('now'))
        ON CONFLICT(event_id) DO UPDATE SET
            event_type = excluded.event_type,
            status = excluded.status,
            error_message = excluded.error_message,
            payload = COALESCE(excluded.payload, stripe_webhook_events.payload),
            updated_at = datetime('now')
    `;

    await dbRun(query, [eventId, eventType, status, errorMessage, payload]).catch((error) => {
        console.error('Webhook log write failed:', error);
    });
}

async function upsertSubscriptionByUser({
    userId,
    stripeCustomerId = null,
    stripeSubscriptionId = null,
    status = 'active',
    periodEnd = null
}) {
    const existing = await dbGet(
        'SELECT id FROM subscriptions WHERE user_id = ?',
        [userId]
    );
    const plan = planFromSubscriptionStatus(status);

    if (existing) {
        await dbRun(
            `UPDATE subscriptions
             SET plan = ?, stripe_customer_id = COALESCE(?, stripe_customer_id),
                 stripe_subscription_id = COALESCE(?, stripe_subscription_id),
                 status = ?, current_period_end = ?, updated_at = datetime('now')
             WHERE user_id = ?`,
            [plan, stripeCustomerId, stripeSubscriptionId, status, periodEnd, userId]
        );
        return;
    }

    await dbRun(
        `INSERT INTO subscriptions (user_id, plan, stripe_customer_id, stripe_subscription_id, status, current_period_end)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [userId, plan, stripeCustomerId, stripeSubscriptionId, status, periodEnd]
    );
}

async function upsertSubscriptionByCustomer({
    stripeCustomerId,
    stripeSubscriptionId = null,
    status = 'active',
    periodEnd = null
}) {
    const sub = await dbGet(
        'SELECT user_id FROM subscriptions WHERE stripe_customer_id = ?',
        [stripeCustomerId]
    );
    if (!sub) return;
    await upsertSubscriptionByUser({
        userId: sub.user_id,
        stripeCustomerId,
        stripeSubscriptionId,
        status,
        periodEnd
    });
}

router.get('/status', requireAuth, async (req, res) => {
    try {
        const sub = await dbGet(
            'SELECT plan, status, current_period_end FROM subscriptions WHERE user_id = ?',
            [req.user.id]
        );
        const status = String(sub?.status || 'inactive').toLowerCase();
        const normalizedPlan = status === 'active' || status === 'trialing' ? 'pro' : 'free';
        res.json({
            plan: normalizedPlan,
            status: sub?.status || 'inactive',
            currentPeriodEnd: sub?.current_period_end || null
        });
    } catch (error) {
        console.error('Billing status error:', error);
        res.status(500).json({ error: 'Failed to load billing status' });
    }
});

router.post('/create-checkout-session', requireAuth, async (req, res) => {
    if (!stripe || !STRIPE_PLUS_PRICE_ID) {
        return res.status(500).json({ error: 'Stripe is not configured yet' });
    }

    try {
        const sub = await dbGet(
            'SELECT plan, stripe_customer_id FROM subscriptions WHERE user_id = ?',
            [req.user.id]
        );
        if (sub?.plan === 'pro') {
            return res.status(400).json({ error: 'You are already on Plus.' });
        }

        let customerId = sub?.stripe_customer_id || null;
        if (!customerId) {
            const customer = await stripe.customers.create({
                email: req.user.email,
                name: req.user.display_name || req.user.email,
                metadata: { userId: String(req.user.id) }
            });
            customerId = customer.id;
        }

        await upsertSubscriptionByUser({
            userId: req.user.id,
            stripeCustomerId: customerId,
            status: sub?.status || 'inactive'
        });

        const session = await stripe.checkout.sessions.create({
            mode: 'subscription',
            customer: customerId,
            client_reference_id: String(req.user.id),
            line_items: [{ price: STRIPE_PLUS_PRICE_ID, quantity: 1 }],
            success_url: `${APP_BASE_URL}/pricing.html?checkout=success`,
            cancel_url: `${APP_BASE_URL}/pricing.html?checkout=cancel`,
            metadata: { userId: String(req.user.id) }
        });

        res.json({ url: session.url });
    } catch (error) {
        console.error('Create checkout session error:', error);
        res.status(500).json({ error: 'Failed to create checkout session' });
    }
});

router.post('/create-portal-session', requireAuth, async (req, res) => {
    if (!stripe) {
        return res.status(500).json({ error: 'Stripe is not configured yet' });
    }

    try {
        const sub = await dbGet(
            'SELECT stripe_customer_id, status FROM subscriptions WHERE user_id = ?',
            [req.user.id]
        );

        let customerId = sub?.stripe_customer_id || null;
        if (!customerId) {
            const customer = await stripe.customers.create({
                email: req.user.email,
                name: req.user.display_name || req.user.email,
                metadata: { userId: String(req.user.id) }
            });
            customerId = customer.id;

            await upsertSubscriptionByUser({
                userId: req.user.id,
                stripeCustomerId: customerId,
                status: sub?.status || 'inactive'
            });
        }

        const portal = await stripe.billingPortal.sessions.create({
            customer: customerId,
            return_url: `${APP_BASE_URL}/billing.html`
        });

        return res.json({ url: portal.url });
    } catch (error) {
        console.error('Create portal session error:', error);
        return res.status(500).json({ error: 'Failed to open billing portal' });
    }
});

router.post('/refresh', requireAuth, async (req, res) => {
    if (!stripe) {
        return res.status(500).json({ error: 'Stripe is not configured yet' });
    }

    try {
        const sub = await dbGet(
            'SELECT stripe_customer_id, stripe_subscription_id FROM subscriptions WHERE user_id = ?',
            [req.user.id]
        );

        if (!sub?.stripe_customer_id) {
            return res.json({ plan: 'free', status: 'inactive' });
        }

        let stripeSub = null;
        if (sub.stripe_subscription_id) {
            stripeSub = await stripe.subscriptions.retrieve(sub.stripe_subscription_id);
        } else {
            const listed = await stripe.subscriptions.list({
                customer: sub.stripe_customer_id,
                status: 'all',
                limit: 1
            });
            stripeSub = listed.data[0] || null;
        }

        if (!stripeSub) {
            await upsertSubscriptionByUser({
                userId: req.user.id,
                stripeCustomerId: sub.stripe_customer_id,
                status: 'inactive'
            });
            return res.json({ plan: 'free', status: 'inactive' });
        }

        const periodEnd = stripeSub.current_period_end
            ? new Date(stripeSub.current_period_end * 1000).toISOString()
            : null;

        await upsertSubscriptionByUser({
            userId: req.user.id,
            stripeCustomerId: sub.stripe_customer_id,
            stripeSubscriptionId: stripeSub.id,
            status: stripeSub.status || 'inactive',
            periodEnd
        });

        const plan = planFromSubscriptionStatus(stripeSub.status) === 'pro' ? 'pro' : 'free';
        res.json({ plan, status: stripeSub.status || 'inactive', currentPeriodEnd: periodEnd });
    } catch (error) {
        console.error('Billing refresh error:', error);
        res.status(500).json({ error: 'Failed to refresh billing status' });
    }
});

async function billingWebhookHandler(req, res) {
    if (!stripe || !STRIPE_WEBHOOK_SECRET) {
        return res.status(500).send('Stripe webhook not configured');
    }

    let event;
    try {
        const signature = req.headers['stripe-signature'];
        event = stripe.webhooks.constructEvent(req.body, signature, STRIPE_WEBHOOK_SECRET);
    } catch (error) {
        await logWebhookEvent({
            eventType: 'signature_verification',
            status: 'invalid_signature',
            errorMessage: error.message,
            payload: normalizePayload(req.body)
        });
        console.error('Webhook signature error:', error.message);
        return res.status(400).send(`Webhook Error: ${error.message}`);
    }

    await logWebhookEvent({
        eventId: event.id,
        eventType: event.type,
        status: 'received'
    });

    try {
        if (event.type === 'checkout.session.completed') {
            const session = event.data.object;
            const userId = Number(session.metadata?.userId || session.client_reference_id || 0);
            const customerId = session.customer || null;
            const subscriptionId = session.subscription || null;
            let status = 'active';
            let periodEnd = null;

            if (subscriptionId) {
                const stripeSub = await stripe.subscriptions.retrieve(subscriptionId);
                status = stripeSub.status || 'active';
                periodEnd = stripeSub.current_period_end
                    ? new Date(stripeSub.current_period_end * 1000).toISOString()
                    : null;
            }

            if (userId) {
                await upsertSubscriptionByUser({
                    userId,
                    stripeCustomerId: customerId,
                    stripeSubscriptionId: subscriptionId,
                    status,
                    periodEnd
                });
            } else if (customerId) {
                await upsertSubscriptionByCustomer({
                    stripeCustomerId: customerId,
                    stripeSubscriptionId: subscriptionId,
                    status,
                    periodEnd
                });
            }
        }

        if (
            event.type === 'customer.subscription.created' ||
            event.type === 'customer.subscription.updated' ||
            event.type === 'customer.subscription.deleted'
        ) {
            const subscription = event.data.object;
            await upsertSubscriptionByCustomer({
                stripeCustomerId: subscription.customer,
                stripeSubscriptionId: subscription.id,
                status: subscription.status || 'inactive',
                periodEnd: subscription.current_period_end
                    ? new Date(subscription.current_period_end * 1000).toISOString()
                    : null
            });
        }
    } catch (error) {
        await logWebhookEvent({
            eventId: event.id,
            eventType: event.type,
            status: 'failed',
            errorMessage: error.message
        });
        console.error('Webhook processing error:', error);
        return res.status(500).send('Webhook processing failed');
    }

    await logWebhookEvent({
        eventId: event.id,
        eventType: event.type,
        status: 'processed'
    });

    return res.json({ received: true });
}

module.exports = { billingRoutes: router, billingWebhookHandler };
