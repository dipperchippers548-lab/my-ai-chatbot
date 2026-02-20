class AccountPage {
    constructor() {
        this.currentUser = null;
        this.confirmResolver = null;
        this.init();
    }

    async init() {
        const user = await this.loadCurrentUser();
        if (!user) return;
        this.currentUser = user;
        this.setupTabs();

        const displayName = document.getElementById('displayName');
        const email = document.getElementById('email');
        if (displayName) displayName.value = user.display_name || '';
        if (email) email.value = user.email || '';

        const profileForm = document.getElementById('profileForm');
        if (profileForm) {
            profileForm.addEventListener('submit', (event) => this.saveProfile(event));
        }

        const generalForm = document.getElementById('generalForm');
        if (generalForm) {
            this.loadGeneralSettings();
            generalForm.addEventListener('submit', (event) => this.saveGeneralSettings(event));
        }

        const notificationsForm = document.getElementById('notificationsForm');
        if (notificationsForm) {
            this.loadNotificationSettings();
            notificationsForm.addEventListener('submit', (event) => this.saveNotificationSettings(event));
        }

        const personalizationForm = document.getElementById('personalizationForm');
        if (personalizationForm) {
            this.loadPersonalizationSettings();
            personalizationForm.addEventListener('submit', (event) => this.savePersonalizationSettings(event));
        }

        const exportPrefsBtn = document.getElementById('exportPrefsBtn');
        if (exportPrefsBtn) {
            exportPrefsBtn.addEventListener('click', () => this.exportPreferences());
        }

        const resetPrefsBtn = document.getElementById('resetPrefsBtn');
        if (resetPrefsBtn) {
            resetPrefsBtn.addEventListener('click', () => this.resetPreferences());
        }

        const clearChatsBtn = document.getElementById('clearChatsBtn');
        if (clearChatsBtn) {
            clearChatsBtn.addEventListener('click', () => this.clearAllChats());
        }

        const confirmCancelBtn = document.getElementById('confirmCancelBtn');
        if (confirmCancelBtn) {
            confirmCancelBtn.addEventListener('click', () => this.resolveConfirm(false));
        }
        const confirmOkBtn = document.getElementById('confirmOkBtn');
        if (confirmOkBtn) {
            confirmOkBtn.addEventListener('click', () => this.resolveConfirm(true));
        }
        const confirmOverlay = document.getElementById('confirmOverlay');
        if (confirmOverlay) {
            confirmOverlay.addEventListener('click', (event) => {
                if (event.target === confirmOverlay) this.resolveConfirm(false);
            });
        }
        document.addEventListener('keydown', (event) => {
            if (event.key === 'Escape') {
                const overlay = document.getElementById('confirmOverlay');
                if (overlay && overlay.style.display !== 'none') {
                    this.resolveConfirm(false);
                }
            }
        });

        const logoutBtn = document.getElementById('logoutBtn');
        if (logoutBtn) {
            logoutBtn.addEventListener('click', () => this.logout());
        }

        const sendResetBtn = document.getElementById('sendResetBtn');
        if (sendResetBtn) {
            sendResetBtn.addEventListener('click', () => this.sendResetEmail());
        }

        const openResetBtn = document.getElementById('openResetBtn');
        if (openResetBtn) {
            openResetBtn.addEventListener('click', () => this.openResetPage());
        }

        const manageBillingBtn = document.getElementById('manageBillingBtn');
        if (manageBillingBtn) {
            manageBillingBtn.addEventListener('click', () => this.openBillingPortal());
        }

        const upgradeBtn = document.getElementById('upgradeBtn');
        if (upgradeBtn) {
            upgradeBtn.addEventListener('click', () => this.startUpgrade());
        }

        const planPill = document.getElementById('planPill');
        if (planPill) {
            this.loadBillingStatus();
        }

        const checkoutResult = new URLSearchParams(window.location.search).get('checkout');
        if (checkoutResult === 'success') {
            this.showNotification('Payment successful. Updating your plan...', 'success');
            this.loadBillingStatus();
        }
        if (checkoutResult === 'cancel') {
            this.showNotification('Checkout was canceled.', 'info');
        }
    }

    setupTabs() {
        const tabs = Array.from(document.querySelectorAll('.settings-tab'));
        const panels = Array.from(document.querySelectorAll('.settings-panel'));
        if (tabs.length === 0 || panels.length === 0) return;

        const activate = (key) => {
            tabs.forEach((tab) => {
                const active = tab.dataset.tab === key;
                tab.classList.toggle('active', active);
                tab.setAttribute('aria-selected', active ? 'true' : 'false');
            });

            panels.forEach((panel) => {
                const active = panel.id === `panel${key.charAt(0).toUpperCase()}${key.slice(1)}`;
                panel.classList.toggle('active', active);
            });
        };

        tabs.forEach((tab) => {
            tab.addEventListener('click', () => activate(String(tab.dataset.tab || 'general')));
        });
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
        } catch (error) {
            window.location.href = 'login.html';
            return null;
        }
    }

    async saveProfile(event) {
        event.preventDefault();
        const submitBtn = document.getElementById('saveProfileBtn');
        if (submitBtn) submitBtn.disabled = true;

        const displayNameInput = document.getElementById('displayName');
        const displayName = String(displayNameInput ? displayNameInput.value : '').trim();

        if (!displayName) {
            this.showNotification('Display name cannot be empty.', 'error');
            if (submitBtn) submitBtn.disabled = false;
            return;
        }

        try {
            const response = await fetch('/api/auth/me', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ displayName })
            });
            const data = await this.readJsonResponse(response);
            if (!response.ok) {
                this.showNotification(data.error || 'Failed to save profile.', 'error');
                return;
            }
            this.showNotification('Profile updated.', 'success');
        } catch (error) {
            this.showNotification('Network error. Try again.', 'error');
        } finally {
            if (submitBtn) submitBtn.disabled = false;
        }
    }

    loadGeneralSettings() {
        const themeSelect = document.getElementById('themePreference');
        const enterToSend = document.getElementById('enterToSend');
        const memoryEnabled = document.getElementById('memoryEnabled');
        const memoryProfile = document.getElementById('memoryProfile');
        if (themeSelect) {
            const savedTheme = localStorage.getItem('theme');
            themeSelect.value = savedTheme === 'light' ? 'light' : (savedTheme === 'dark' ? 'dark' : 'system');
        }
        if (enterToSend) {
            const saved = localStorage.getItem('enterToSend');
            enterToSend.checked = saved !== '0';
        }
        if (memoryEnabled) {
            memoryEnabled.checked = localStorage.getItem('memoryEnabled') === '1';
        }
        if (memoryProfile) {
            memoryProfile.value = localStorage.getItem('memoryProfile') || '';
        }
    }

    loadNotificationSettings() {
        const notifyDesktop = document.getElementById('notifyDesktop');
        const notifySound = document.getElementById('notifySound');
        const notifyTips = document.getElementById('notifyTips');
        if (notifyDesktop) notifyDesktop.checked = localStorage.getItem('notifyDesktop') === '1';
        if (notifySound) notifySound.checked = localStorage.getItem('notifySound') !== '0';
        if (notifyTips) notifyTips.checked = localStorage.getItem('notifyTips') !== '0';
    }

    loadPersonalizationSettings() {
        const responseStyle = document.getElementById('responseStyle');
        const adaptiveStudyMode = document.getElementById('adaptiveStudyMode');
        const mirrorEnergy = document.getElementById('mirrorEnergy');
        if (responseStyle) {
            const saved = localStorage.getItem('responseStyle');
            responseStyle.value = ['short', 'balanced', 'detailed'].includes(saved) ? saved : 'balanced';
        }
        if (adaptiveStudyMode) adaptiveStudyMode.checked = localStorage.getItem('adaptiveStudyMode') === '1';
        if (mirrorEnergy) mirrorEnergy.checked = localStorage.getItem('mirrorEnergy') !== '0';
    }

    async saveGeneralSettings(event) {
        event.preventDefault();
        const themeSelect = document.getElementById('themePreference');
        const enterToSend = document.getElementById('enterToSend');
        const memoryEnabled = document.getElementById('memoryEnabled');
        const memoryProfile = document.getElementById('memoryProfile');

        const themeValue = themeSelect ? themeSelect.value : 'system';
        if (themeValue === 'light' || themeValue === 'dark') {
            localStorage.setItem('theme', themeValue);
        } else {
            localStorage.removeItem('theme');
        }

        localStorage.setItem('enterToSend', enterToSend && enterToSend.checked ? '1' : '0');
        localStorage.setItem('memoryEnabled', memoryEnabled && memoryEnabled.checked ? '1' : '0');
        localStorage.setItem('memoryProfile', String(memoryProfile ? memoryProfile.value : '').trim().slice(0, 500));
        this.showNotification('General settings saved.', 'success');
    }

    async saveNotificationSettings(event) {
        event.preventDefault();
        const notifyDesktop = document.getElementById('notifyDesktop');
        const notifySound = document.getElementById('notifySound');
        const notifyTips = document.getElementById('notifyTips');

        localStorage.setItem('notifyDesktop', notifyDesktop && notifyDesktop.checked ? '1' : '0');
        localStorage.setItem('notifySound', notifySound && notifySound.checked ? '1' : '0');
        localStorage.setItem('notifyTips', notifyTips && notifyTips.checked ? '1' : '0');
        this.showNotification('Notification settings saved.', 'success');
    }

    async savePersonalizationSettings(event) {
        event.preventDefault();
        const responseStyle = document.getElementById('responseStyle');
        const adaptiveStudyMode = document.getElementById('adaptiveStudyMode');
        const mirrorEnergy = document.getElementById('mirrorEnergy');

        localStorage.setItem('responseStyle', String(responseStyle ? responseStyle.value : 'balanced'));
        localStorage.setItem('adaptiveStudyMode', adaptiveStudyMode && adaptiveStudyMode.checked ? '1' : '0');
        localStorage.setItem('mirrorEnergy', mirrorEnergy && mirrorEnergy.checked ? '1' : '0');
        this.showNotification('Personalization settings saved.', 'success');
    }

    getPreferenceSnapshot() {
        const keys = [
            'theme',
            'enterToSend',
            'memoryEnabled',
            'memoryProfile',
            'notifyDesktop',
            'notifySound',
            'notifyTips',
            'responseStyle',
            'adaptiveStudyMode',
            'mirrorEnergy'
        ];
        const prefs = {};
        keys.forEach((key) => {
            prefs[key] = localStorage.getItem(key);
        });
        return {
            exportedAt: new Date().toISOString(),
            userEmail: this.currentUser?.email || null,
            preferences: prefs
        };
    }

    exportPreferences() {
        const payload = this.getPreferenceSnapshot();
        const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = 'vantage-preferences.json';
        document.body.appendChild(link);
        link.click();
        link.remove();
        URL.revokeObjectURL(url);
        this.showNotification('Preferences exported.', 'success');
    }

    async resetPreferences() {
        const ok = await this.showConfirm('Reset local settings to default?');
        if (!ok) return;

        const keys = [
            'theme',
            'enterToSend',
            'memoryEnabled',
            'memoryProfile',
            'notifyDesktop',
            'notifySound',
            'notifyTips',
            'responseStyle',
            'adaptiveStudyMode',
            'mirrorEnergy'
        ];
        keys.forEach((key) => localStorage.removeItem(key));
        this.loadGeneralSettings();
        this.loadNotificationSettings();
        this.loadPersonalizationSettings();
        this.showNotification('Preferences reset.', 'success');
    }

    async clearAllChats() {
        const ok = await this.showConfirm('Delete all chats for this account? This cannot be undone.', 'Delete all');
        if (!ok) return;

        const clearChatsBtn = document.getElementById('clearChatsBtn');
        if (clearChatsBtn) {
            clearChatsBtn.disabled = true;
            clearChatsBtn.textContent = 'Deleting...';
        }

        try {
            const listResponse = await fetch('/api/chats');
            const chats = await this.readJsonResponse(listResponse);
            if (!listResponse.ok || !Array.isArray(chats)) {
                throw new Error('Could not load chat list');
            }

            for (const chat of chats) {
                await fetch(`/api/chats/${chat.id}`, { method: 'DELETE' });
            }
            this.showNotification('All chats deleted.', 'success');
        } catch (error) {
            this.showNotification(error.message || 'Failed to delete chats.', 'error');
        } finally {
            if (clearChatsBtn) {
                clearChatsBtn.disabled = false;
                clearChatsBtn.textContent = 'Delete all chats';
            }
        }
    }

    async sendResetEmail() {
        const email = String(this.currentUser?.email || '').trim().toLowerCase();
        if (!email) {
            this.showNotification('Could not find account email.', 'error');
            return;
        }

        const sendResetBtn = document.getElementById('sendResetBtn');
        if (sendResetBtn) {
            sendResetBtn.disabled = true;
            sendResetBtn.textContent = 'Sending...';
        }

        try {
            const response = await fetch('/api/auth/forgot-password', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email })
            });
            const data = await this.readJsonResponse(response);
            if (!response.ok) throw new Error(data.error || 'Failed to request password reset');

            if (data.resetToken) {
                this.showNotification('Reset email requested. Opening reset form...', 'success');
                window.location.href = `forgot-password.html?token=${encodeURIComponent(data.resetToken)}`;
                return;
            }
            this.showNotification('Password reset email sent. Opening reset page...', 'success');
            this.openResetPage();
        } catch (error) {
            this.showNotification(error.message || 'Could not send reset email.', 'error');
        } finally {
            if (sendResetBtn) {
                sendResetBtn.disabled = false;
                sendResetBtn.textContent = 'Send password reset email';
            }
        }
    }

    openResetPage() {
        const email = encodeURIComponent(String(this.currentUser?.email || '').trim());
        const target = email
            ? `forgot-password.html?email=${email}`
            : 'forgot-password.html';
        window.location.href = target;
    }

    async logout() {
        try {
            await fetch('/api/auth/logout', { method: 'POST' });
        } catch (error) {
            console.error(error);
        } finally {
            window.location.href = 'login.html';
        }
    }

    async loadBillingStatus() {
        const planPill = document.getElementById('planPill');
        const planDescription = document.getElementById('planDescription');
        const upgradeBtn = document.getElementById('upgradeBtn');
        const manageBillingBtn = document.getElementById('manageBillingBtn');
        if (!planPill || !planDescription) return;

        try {
            const response = await fetch('/api/billing/status');
            const data = await this.readJsonResponse(response);
            if (!response.ok) throw new Error(data.error || 'Failed to load billing');

            const isPro = data.plan === 'pro';
            planPill.textContent = isPro ? 'VANTAGE Plus' : 'Free';
            planDescription.textContent = isPro
                ? 'Your Plus subscription is active.'
                : 'Upgrade to Plus for higher limits and premium models.';
            if (upgradeBtn) {
                upgradeBtn.disabled = isPro;
                upgradeBtn.textContent = isPro ? 'You are on Plus' : 'Upgrade to VANTAGE Plus';
            }
            if (manageBillingBtn) {
                manageBillingBtn.style.display = isPro ? 'inline-block' : 'none';
            }
        } catch (error) {
            this.showNotification(error.message || 'Could not load billing status.', 'error');
        }
    }

    async startUpgrade() {
        const upgradeBtn = document.getElementById('upgradeBtn');
        if (upgradeBtn) upgradeBtn.disabled = true;
        try {
            const response = await fetch('/api/billing/create-checkout-session', { method: 'POST' });
            const data = await this.readJsonResponse(response);
            if (!response.ok) throw new Error(data.error || 'Failed to start checkout');
            if (!data.url) throw new Error('Checkout URL missing');
            window.location.href = data.url;
        } catch (error) {
            this.showNotification(error.message || 'Failed to start checkout.', 'error');
            if (upgradeBtn) upgradeBtn.disabled = false;
        }
    }

    async openBillingPortal() {
        const manageBillingBtn = document.getElementById('manageBillingBtn');
        if (manageBillingBtn) manageBillingBtn.disabled = true;

        try {
            const response = await fetch('/api/billing/create-portal-session', { method: 'POST' });
            const data = await this.readJsonResponse(response);
            if (!response.ok) throw new Error(data.error || 'Failed to open billing portal');
            if (!data.url) throw new Error('Portal URL missing');
            window.location.href = data.url;
        } catch (error) {
            this.showNotification(error.message || 'Failed to open billing portal.', 'error');
            if (manageBillingBtn) manageBillingBtn.disabled = false;
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

    showConfirm(message, confirmLabel = 'Confirm') {
        const overlay = document.getElementById('confirmOverlay');
        const messageEl = document.getElementById('confirmMessage');
        const okBtn = document.getElementById('confirmOkBtn');
        if (!overlay || !messageEl || !okBtn) return Promise.resolve(false);

        messageEl.textContent = String(message || 'Are you sure?');
        okBtn.textContent = confirmLabel;
        overlay.style.display = 'flex';
        overlay.setAttribute('aria-hidden', 'false');

        return new Promise((resolve) => {
            this.confirmResolver = resolve;
        });
    }

    resolveConfirm(confirmed) {
        const overlay = document.getElementById('confirmOverlay');
        if (overlay) {
            overlay.style.display = 'none';
            overlay.setAttribute('aria-hidden', 'true');
        }

        const resolver = this.confirmResolver;
        this.confirmResolver = null;
        if (resolver) resolver(Boolean(confirmed));
    }

    showNotification(message, type = 'info') {
        const notification = document.getElementById('notification');
        if (!notification) return;
        notification.textContent = message;
        notification.className = `notification ${type} show`;
        setTimeout(() => {
            notification.className = 'notification';
        }, 2800);
    }
}

document.addEventListener('DOMContentLoaded', () => {
    window.accountPage = new AccountPage();
});

function sendResetFromSettings() {
    if (window.accountPage) {
        window.accountPage.sendResetEmail();
    }
}

function openResetFromSettings() {
    if (window.accountPage) {
        window.accountPage.openResetPage();
    } else {
        window.location.href = 'forgot-password.html';
    }
}

// Explicitly bind handlers to window so inline onclick always works.
window.sendResetFromSettings = sendResetFromSettings;
window.openResetFromSettings = openResetFromSettings;
