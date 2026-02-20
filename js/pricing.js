class PricingPage {
    constructor() {
        this.init();
    }

    async init() {
        const user = await this.loadCurrentUser();
        if (!user) return;

        const plusBtn = document.getElementById('plusPlanBtn');
        if (plusBtn) {
            plusBtn.addEventListener('click', () => this.startUpgrade());
        }

        await this.loadBillingStatus();

        const checkoutResult = new URLSearchParams(window.location.search).get('checkout');
        if (checkoutResult === 'success') {
            this.showNotification('Payment successful. Your plan is updating.');
            await this.refreshBillingFromStripe();
            await this.loadBillingStatus();
        }
        if (checkoutResult === 'cancel') {
            this.showNotification('Checkout was canceled.');
        }
    }

    async loadCurrentUser() {
        try {
            const response = await fetch('/api/auth/me');
            const data = await this.readJsonResponse(response);
            if (!data.user) {
                window.location.href = 'login.html';
                return null;
            }
            return data.user;
        } catch (_error) {
            window.location.href = 'login.html';
            return null;
        }
    }

    async loadBillingStatus() {
        const plusBtn = document.getElementById('plusPlanBtn');
        const freeBtn = document.getElementById('freePlanBtn');
        const plusCard = document.getElementById('plusPlanCard');
        if (!plusBtn || !freeBtn || !plusCard) return;

        try {
            const response = await fetch('/api/billing/status');
            const data = await this.readJsonResponse(response);
            if (!response.ok) throw new Error(data.error || 'Could not load billing status');

            const isPro = data.plan === 'pro';
            freeBtn.textContent = isPro ? 'Free' : 'Current plan';
            plusBtn.disabled = isPro;
            plusBtn.textContent = isPro ? 'You are on VANTAGE Plus' : 'Upgrade to VANTAGE Plus';
            plusCard.classList.toggle('featured', !isPro);
        } catch (error) {
            this.showNotification(error.message || 'Could not load billing status.');
        }
    }

    async startUpgrade() {
        const plusBtn = document.getElementById('plusPlanBtn');
        if (plusBtn) plusBtn.disabled = true;

        try {
            const response = await fetch('/api/billing/create-checkout-session', {
                method: 'POST'
            });
            const data = await this.readJsonResponse(response);
            if (!response.ok) throw new Error(data.error || 'Failed to start checkout');
            if (!data.url) throw new Error('Checkout URL missing');
            window.location.href = data.url;
        } catch (error) {
            this.showNotification(error.message || 'Failed to start checkout.');
            if (plusBtn) plusBtn.disabled = false;
        }
    }

    async refreshBillingFromStripe() {
        try {
            const response = await fetch('/api/billing/refresh', { method: 'POST' });
            await this.readJsonResponse(response);
        } catch (_error) {
            // Non-blocking; UI will still use /status fallback.
        }
    }

    async readJsonResponse(response) {
        const raw = await response.text();
        if (!raw) return {};
        try {
            return JSON.parse(raw);
        } catch (_error) {
            if (!response.ok) {
                return { error: 'Server returned a non-JSON response.' };
            }
            throw new Error('Server returned a non-JSON response.');
        }
    }

    showNotification(message) {
        const notification = document.getElementById('notification');
        if (!notification) return;
        notification.textContent = message;
        notification.className = 'notification show';
        setTimeout(() => {
            notification.className = 'notification';
        }, 3000);
    }
}

document.addEventListener('DOMContentLoaded', () => {
    new PricingPage();
});
