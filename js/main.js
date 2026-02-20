// VANTAGE 4o - Main Chat Interface JavaScript

class ChatApp {
    constructor() {
        this.currentUser = null;
        this.currentChatId = null;
        this.messages = [];
        this.isTyping = false;
        this.isSending = false;
        this.selectedImage = null;
        this.isUserNearBottom = true;
        this.streamAbortController = null;
        this.chatById = new Map();
        this.chatList = [];
        this.chatSearchQuery = '';
        this.renamingChatId = null;
        this.renameDraft = '';
        this.pendingDeleteChatId = null;
        this.pendingDeleteTimer = null;
        this.isSidebarHidden = localStorage.getItem('sidebarHidden') === '1';
        this.availableModels = [];
        this.selectedModelId = localStorage.getItem('selectedModelId') || 'vantage-4o';
        this.maxLength = 4000;
        this.allowedImageTypes = ['image/jpeg', 'image/png', 'image/webp'];
        this.recognition = null;
        this.isListening = false;
        this.speechSupported = false;
        this.voiceBaseText = '';
        this.memoryEnabled = localStorage.getItem('memoryEnabled') === '1';
        this.memoryProfile = localStorage.getItem('memoryProfile') || '';
        this.rateLimitResetAt = Number(localStorage.getItem('rateLimitResetAt') || 0);
        this.limitTickInterval = null;
        this.defaultComposerPlaceholder = 'Message AURA...';
        this.usageUsed = 0;
        this.usageLimit = 0;
        this.usageResetAt = 0;
        this.studyNudgesShown = new Set(JSON.parse(localStorage.getItem('studyNudgesShown') || '[]'));
        this.init();
    }

    async init() {
        await this.checkAuth();
        this.setupEventListeners();
        this.applySidebarState();
        this.updateUserInterface();
        if (this.isPlusUser()) {
            await this.loadModelOptions();
        } else {
            this.selectedModelId = 'vantage-4o';
            localStorage.setItem('selectedModelId', this.selectedModelId);
            this.hideModelSelector();
        }
        this.loadChatHistory();
        this.setupCharCounter();
        this.setupFileUpload();
        this.setupVoiceInput();
        this.setupRateLimitState();
        this.renderDailyInsight();
        await this.refreshUsageStatus();
        this.handleInputChange();
    }

    isPlusUser() {
        return Boolean(
            this.currentUser
            && this.currentUser.plan === 'pro'
            && ['active', 'trialing'].includes(String(this.currentUser.plan_status || '').toLowerCase())
        );
    }

    hideModelSelector() {
        const select = document.getElementById('modelSelect');
        if (select) {
            select.style.display = 'none';
            select.setAttribute('aria-hidden', 'true');
            select.disabled = true;
        }
    }

    showModelSelector() {
        const select = document.getElementById('modelSelect');
        if (select) {
            select.style.display = 'block';
            select.removeAttribute('aria-hidden');
            select.disabled = false;
        }
    }

    async checkAuth() {
        try {
            const response = await fetch('/api/auth/me');
            const data = await response.json();
            if (data.user) {
                this.currentUser = data.user;
                return;
            }
        } catch (error) {
            console.error('Auth check failed:', error);
        }

        window.location.href = 'login.html';
    }

    setupEventListeners() {
        const messageInput = document.getElementById('messageInput');
        if (messageInput) {
            messageInput.addEventListener('input', () => {
                this.autoResizeTextarea();
                this.handleInputChange();
            });
        }

        const chatSearchInput = document.getElementById('chatSearchInput');
        if (chatSearchInput) {
            chatSearchInput.addEventListener('input', (event) => {
                this.setChatSearchQuery(event.target.value);
            });
        }

        const chatContainer = document.getElementById('chatContainer');
        if (chatContainer) {
            chatContainer.addEventListener('scroll', () => {
                this.isUserNearBottom = this.isNearBottom();
                this.updateJumpButtonVisibility();
            });
        }

        window.addEventListener('resize', () => {
            if (window.innerWidth > 900) {
                this.closeMobileSidebar();
            }
        });
    }

    applySidebarState() {
        const sidebar = document.getElementById('sidebar');
        const mainContent = document.querySelector('.main-content');
        if (!sidebar || !mainContent) return;

        if (this.isSidebarHidden) {
            sidebar.classList.add('hidden');
            mainContent.classList.add('sidebar-hidden');
        } else {
            sidebar.classList.remove('hidden');
            mainContent.classList.remove('sidebar-hidden');
        }
    }

    toggleSidebarDesktop() {
        this.isSidebarHidden = !this.isSidebarHidden;
        localStorage.setItem('sidebarHidden', this.isSidebarHidden ? '1' : '0');
        this.applySidebarState();
    }

    openMobileSidebar() {
        if (window.innerWidth > 900) return;
        const sidebar = document.getElementById('sidebar');
        const backdrop = document.getElementById('mobileSidebarBackdrop');
        if (sidebar) sidebar.classList.add('open');
        if (backdrop) backdrop.classList.add('show');
    }

    closeMobileSidebar() {
        const sidebar = document.getElementById('sidebar');
        const backdrop = document.getElementById('mobileSidebarBackdrop');
        if (sidebar) sidebar.classList.remove('open');
        if (backdrop) backdrop.classList.remove('show');
    }

    setChatSearchQuery(query) {
        this.chatSearchQuery = String(query || '').trim().toLowerCase();
        this.renderChatHistory(this.chatList);
    }

    buildChatTitleFromContent(content) {
        const cleaned = String(content || '').replace(/\s+/g, ' ').trim();
        if (!cleaned) return 'New conversation';
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

    async ensureTopicTitleForCurrentChat(content) {
        if (!this.currentChatId) return;
        const chat = this.chatById.get(Number(this.currentChatId));
        if (chat && chat.title && chat.title !== 'New Chat') return;

        const nextTitle = this.buildChatTitleFromContent(content);
        if (!nextTitle || nextTitle === 'New Chat') return;

        try {
            await fetch(`/api/chats/${this.currentChatId}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ title: nextTitle })
            });
        } catch (_error) {
            // Non-blocking fallback only.
        }
    }

    updateUserInterface() {
        if (!this.currentUser) return;

        const name = this.currentUser.display_name || this.currentUser.email;
        const shortName = this.currentUser.display_name || this.currentUser.email.split('@')[0];
        const userName = document.getElementById('userName');
        const welcomeUserName = document.getElementById('welcomeUserName');
        const userAvatar = document.getElementById('userAvatar');
        const usageInfo = document.getElementById('usageInfo');
        const modelInfo = document.getElementById('modelInfo');
        const planBadge = document.getElementById('planBadge');
        const upgradeLink = document.querySelector('.header-upgrade-link');
        const isPlus = this.isPlusUser();

        if (userName) userName.textContent = name;
        if (welcomeUserName) welcomeUserName.textContent = shortName;
        if (userAvatar && this.currentUser.email) {
            userAvatar.src = `https://api.dicebear.com/7.x/avataaars/svg?seed=${encodeURIComponent(this.currentUser.email)}`;
        }
        if (usageInfo) usageInfo.textContent = this.getUsageInfoText();
        if (modelInfo) {
            modelInfo.textContent = isPlus ? 'Plus Mode Active' : 'AURA Model';
        }
        if (planBadge) {
            planBadge.textContent = isPlus ? 'Plus' : 'Free';
            planBadge.classList.toggle('plus', isPlus);
        }
        if (upgradeLink) {
            upgradeLink.style.display = isPlus ? 'none' : 'inline-block';
        }
        if (isPlus) {
            this.showModelSelector();
        } else {
            this.hideModelSelector();
        }
        this.renderDailyInsight();
        this.handleInputChange();
    }

    getUsageInfoText() {
        const isPlus = this.isPlusUser();
        if (this.isRateLimitLocked()) {
            return `Limit reached. Try again at ${this.formatLocalTime(this.rateLimitResetAt)}.`;
        }
        if (this.usageLimit > 0) {
            return `${isPlus ? 'VANTAGE Plus' : 'Free plan'} - ${this.usageUsed}/${this.usageLimit} this hour (resets ${this.formatLocalTime(this.usageResetAt)})`;
        }
        return isPlus ? 'VANTAGE Plus - Premium models enabled' : 'Free plan - Limited usage';
    }

    formatLocalTime(timestamp) {
        if (!Number.isFinite(Number(timestamp)) || Number(timestamp) <= 0) return 'later';
        try {
            return new Date(Number(timestamp)).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
        } catch (_error) {
            return 'later';
        }
    }

    isRateLimitLocked() {
        return Number.isFinite(this.rateLimitResetAt) && this.rateLimitResetAt > Date.now();
    }

    setRateLimitLock(resetAt, showNotice = true) {
        const nextReset = Number(resetAt);
        if (!Number.isFinite(nextReset) || nextReset <= Date.now()) {
            this.clearRateLimitLock();
            return;
        }
        this.rateLimitResetAt = nextReset;
        localStorage.setItem('rateLimitResetAt', String(nextReset));
        if (showNotice) {
            this.showNotification(`Limit reached. Try again at ${this.formatLocalTime(nextReset)}.`, 'info');
        }
        this.startRateLimitTicker();
        this.handleInputChange();
    }

    clearRateLimitLock() {
        this.rateLimitResetAt = 0;
        localStorage.removeItem('rateLimitResetAt');
        if (this.limitTickInterval) {
            clearInterval(this.limitTickInterval);
            this.limitTickInterval = null;
        }
        this.handleInputChange();
    }

    startRateLimitTicker() {
        if (this.limitTickInterval) return;
        this.limitTickInterval = setInterval(() => {
            if (!this.isRateLimitLocked()) {
                this.clearRateLimitLock();
                this.showNotification('Limit reset. You can send messages again.', 'success');
                return;
            }
            this.handleInputChange();
        }, 15000);
    }

    setupRateLimitState() {
        if (this.isRateLimitLocked()) {
            this.startRateLimitTicker();
        } else if (this.rateLimitResetAt) {
            this.clearRateLimitLock();
        }
    }

    async refreshUsageStatus() {
        try {
            const response = await fetch('/api/usage/status');
            if (!response.ok) return;
            const data = await response.json();
            this.usageUsed = Number(data.used || 0);
            this.usageLimit = Number(data.limit || 0);
            this.usageResetAt = Number(data.resetAt || 0);
            this.handleInputChange();
        } catch (_error) {
            // Non-blocking; keep previous usage text.
        }
    }

    renderDailyInsight() {
        const insightEl = document.getElementById('dailyInsight');
        if (!insightEl) return;

        const prompts = [
            'Tip of the day: Ask for an answer plus a 3-step action plan to move faster.',
            'Insight: If you are debugging, share the exact error and expected output for better fixes.',
            'Prompt idea: "Review this and give me the top 3 risks first, then quick fixes."',
            'Creator tip: Ask for 5 variations, then combine your favorite parts into one final version.',
            'Growth idea: Ask AURA to turn one idea into a weekly roadmap with milestones.',
            'Pitch helper: "Rewrite this pitch for a 30-second version and a 2-minute version."'
        ];
        const seed = `${new Date().toISOString().slice(0, 10)}|${this.currentUser?.id || this.currentUser?.email || 'guest'}`;
        let hash = 0;
        for (let i = 0; i < seed.length; i += 1) {
            hash = (hash * 31 + seed.charCodeAt(i)) % 2147483647;
        }
        const index = Math.abs(hash) % prompts.length;
        insightEl.innerHTML = `<strong>Daily insight:</strong> ${this.escapeHtml(prompts[index])}`;
    }

    async loadModelOptions() {
        if (!this.isPlusUser()) {
            this.selectedModelId = 'vantage-4o';
            this.hideModelSelector();
            return;
        }
        this.showModelSelector();
        try {
            const response = await fetch('/api/models');
            if (!response.ok) throw new Error('Failed to load models');
            const data = await response.json();
            this.availableModels = Array.isArray(data.models) ? data.models : [];
            if (!this.availableModels.some((model) => model.id === this.selectedModelId)) {
                this.selectedModelId = data.defaultModelId || this.availableModels[0]?.id || 'vantage-4o';
            }
            this.renderModelOptions();
        } catch (_error) {
            this.availableModels = [{ id: 'vantage-4o', label: 'VANTAGE 4o', tier: 'free' }];
            this.selectedModelId = 'vantage-4o';
            this.renderModelOptions();
        }
    }

    renderModelOptions() {
        const select = document.getElementById('modelSelect');
        if (!select) return;

        const options = this.availableModels.length
            ? this.availableModels
            : [{ id: 'vantage-4o', label: 'VANTAGE 4o', tier: 'free' }];

        select.innerHTML = options
            .map((model) => `<option value="${model.id}">${this.escapeHtml(model.label)}</option>`)
            .join('');
        select.value = this.selectedModelId;
        this.selectModel(this.selectedModelId, true);
    }

    selectModel(modelId, silent = false) {
        if (!this.isPlusUser()) {
            this.selectedModelId = 'vantage-4o';
            localStorage.setItem('selectedModelId', this.selectedModelId);
            this.hideModelSelector();
            return;
        }

        const id = String(modelId || '').trim();
        if (!id) return;
        if (!this.availableModels.some((model) => model.id === id)) {
            if (!silent) this.showNotification('That model is available on VANTAGE Plus only.', 'info');
            this.renderModelOptions();
            return;
        }

        this.selectedModelId = id;
        localStorage.setItem('selectedModelId', id);
        const selected = this.availableModels.find((model) => model.id === id);
        const modelInfo = document.getElementById('modelInfo');
        if (modelInfo && selected) {
            modelInfo.textContent = selected.tier === 'plus' ? `${selected.label} - Plus` : selected.label;
        }
    }

    async loadChatHistory() {
        this.renderChatHistoryLoadingState();
        try {
            const response = await fetch('/api/chats');
            if (!response.ok) return;

            const chats = await response.json();
            this.renderChatHistory(chats);
            this.updateEmptyState(chats);
        } catch (error) {
            console.error('Failed to load chat history:', error);
        }
    }

    renderChatHistoryLoadingState() {
        const chatHistory = document.getElementById('chatHistory');
        if (!chatHistory) return;

        const section = `
            <div class="history-section">
                <h3>Loading</h3>
                <div class="chat-items">
                    <div class="chat-item-skeleton"></div>
                    <div class="chat-item-skeleton"></div>
                    <div class="chat-item-skeleton"></div>
                    <div class="chat-item-skeleton"></div>
                </div>
            </div>
        `;
        chatHistory.innerHTML = section;
    }

    updateEmptyState(chats) {
        const emptyStateMessage = document.getElementById('emptyStateMessage');
        if (!emptyStateMessage) return;

        emptyStateMessage.textContent = chats.length
            ? 'How can I help you today?'
            : 'No chats yet. Start with a simple prompt or upload an image.';
    }

    renderChatHistory(chats) {
        const chatHistory = document.getElementById('chatHistory');
        if (!chatHistory) return;
        this.chatList = Array.isArray(chats) ? chats : [];
        this.chatById = new Map(chats.map((chat) => [Number(chat.id), chat]));

        const visibleChats = this.chatSearchQuery
            ? this.chatList.filter((chat) => String(chat.title || 'New Chat').toLowerCase().includes(this.chatSearchQuery))
            : this.chatList;

        const today = new Date();
        const sevenDaysAgo = new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000);
        const thirtyDaysAgo = new Date(today.getTime() - 30 * 24 * 60 * 60 * 1000);
        const grouped = { today: [], sevenDays: [], thirtyDays: [] };

        visibleChats.forEach((chat) => {
            const chatDate = new Date(chat.created_at);
            if (chatDate >= sevenDaysAgo) {
                grouped.today.push(chat);
            } else if (chatDate >= thirtyDaysAgo) {
                grouped.sevenDays.push(chat);
            } else {
                grouped.thirtyDays.push(chat);
            }
        });

        let html = '';
        if (grouped.today.length > 0) {
            html += '<div class="history-section"><h3>Today</h3><div class="chat-items">';
            grouped.today.forEach((chat) => { html += this.createChatItemHtml(chat); });
            html += '</div></div>';
        }
        if (grouped.sevenDays.length > 0) {
            html += '<div class="history-section"><h3>Previous 7 Days</h3><div class="chat-items">';
            grouped.sevenDays.forEach((chat) => { html += this.createChatItemHtml(chat); });
            html += '</div></div>';
        }
        if (grouped.thirtyDays.length > 0) {
            html += '<div class="history-section"><h3>Previous 30 Days</h3><div class="chat-items">';
            grouped.thirtyDays.forEach((chat) => { html += this.createChatItemHtml(chat); });
            html += '</div></div>';
        }

        chatHistory.innerHTML = html || `<div class="history-section"><div class="chat-items"><p style="padding:12px;color:var(--text-muted);font-size:13px;">${this.chatSearchQuery ? 'No matching chats' : 'No chat history yet'}</p></div></div>`;
    }

    createChatItemHtml(chat) {
        const title = chat.title || 'New Chat';
        const active = chat.id === this.currentChatId ? 'active' : '';
        const isRenaming = Number(chat.id) === Number(this.renamingChatId);
        const pinIcon = chat.pinned
            ? '<svg class="pin-icon" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>'
            : '';

        if (isRenaming) {
            return `
                <div class="chat-item ${active} renaming">
                    ${pinIcon}
                    <input
                        class="chat-rename-input"
                        data-chat-id="${chat.id}"
                        value="${this.escapeHtml(this.renameDraft)}"
                        oninput="setRenameDraft(event)"
                        onkeydown="handleRenameKey(event, ${chat.id})"
                        onclick="event.stopPropagation()"
                    />
                    <button class="chat-rename-action" onclick="saveRename(event, ${chat.id})" title="Save rename" aria-label="Save rename">Save</button>
                    <button class="chat-rename-action" onclick="cancelRename(event)" title="Cancel rename" aria-label="Cancel rename">Cancel</button>
                </div>
            `;
        }

        return `
            <div class="chat-item ${active}" onclick="loadChat(${chat.id})">
                ${pinIcon}
                <span class="chat-item-title">${this.escapeHtml(title)}</span>
                <button class="chat-item-rename" onclick="startRename(event, ${chat.id})" title="Rename chat" aria-label="Rename chat">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M12 20h9"></path>
                        <path d="M16.5 3.5a2.1 2.1 0 1 1 3 3L7 19l-4 1 1-4 12.5-12.5z"></path>
                    </svg>
                </button>
                <button class="chat-item-delete" onclick="deleteChatById(event, ${chat.id})" title="Delete chat" aria-label="Delete chat">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <polyline points="3 6 5 6 21 6"></polyline>
                        <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                    </svg>
                </button>
            </div>
        `;
    }

    startRenameChat(chatId) {
        const id = Number(chatId);
        const chat = this.chatById.get(id);
        if (!chat) {
            this.showNotification('Chat not found.', 'error');
            return;
        }

        this.renamingChatId = id;
        this.renameDraft = (chat.title || 'New Chat').trim();
        this.renderChatHistory(this.chatList);

        setTimeout(() => {
            const input = document.querySelector(`.chat-rename-input[data-chat-id="${id}"]`);
            if (input) {
                input.focus();
                input.select();
            }
        }, 0);
    }

    setRenameDraft(value) {
        this.renameDraft = String(value || '');
    }

    cancelRename() {
        this.renamingChatId = null;
        this.renameDraft = '';
        this.renderChatHistory(this.chatList);
    }

    async renameChat(chatId) {
        const id = Number(chatId);
        const chat = this.chatById.get(id);
        if (!chat) return;

        const currentTitle = (chat.title || 'New Chat').trim();
        const nextTitle = this.renameDraft.trim();
        if (!nextTitle) {
            this.showNotification('Title cannot be empty.', 'error');
            return;
        }
        if (nextTitle === currentTitle) return;

        try {
            const response = await fetch(`/api/chats/${id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ title: nextTitle })
            });

            if (!response.ok) throw new Error('Rename failed');
            this.renamingChatId = null;
            this.renameDraft = '';
            await this.loadChatHistory();
            this.showNotification('Chat renamed.', 'success');
        } catch (error) {
            console.error('Rename chat error:', error);
            this.showNotification('Failed to rename chat.', 'error');
        }
    }

    async deleteChat(chatId) {
        const id = Number(chatId);
        if (!id) return;

        if (this.pendingDeleteChatId !== id) {
            this.pendingDeleteChatId = id;
            if (this.pendingDeleteTimer) clearTimeout(this.pendingDeleteTimer);
            this.pendingDeleteTimer = setTimeout(() => {
                this.pendingDeleteChatId = null;
                this.pendingDeleteTimer = null;
            }, 4000);
            this.showNotification('Click delete again to confirm.', 'info');
            return;
        }

        this.pendingDeleteChatId = null;
        if (this.pendingDeleteTimer) {
            clearTimeout(this.pendingDeleteTimer);
            this.pendingDeleteTimer = null;
        }

        try {
            const response = await fetch(`/api/chats/${id}`, { method: 'DELETE' });
            if (!response.ok) throw new Error('Delete failed');

            if (this.currentChatId === id) {
                this.currentChatId = null;
                this.messages = [];
                const messagesContainer = document.getElementById('messages');
                const welcomeScreen = document.getElementById('welcomeScreen');
                if (messagesContainer) {
                    messagesContainer.innerHTML = '';
                    messagesContainer.style.display = 'none';
                }
                if (welcomeScreen) welcomeScreen.style.display = 'flex';
            }

            await this.loadChatHistory();
            this.showNotification('Chat deleted.', 'success');
        } catch (error) {
            console.error('Delete chat error:', error);
            this.showNotification('Failed to delete chat.', 'error');
        }
    }

    setupCharCounter() {
        const messageInput = document.getElementById('messageInput');
        const charCount = document.getElementById('charCount');
        if (!messageInput || !charCount) return;

        messageInput.addEventListener('input', () => {
            const length = messageInput.value.length;
            charCount.textContent = `${length} / ${this.maxLength}`;
            charCount.style.color = length > this.maxLength ? 'var(--danger)' : 'var(--text-muted)';
        });
    }

    setupFileUpload() {
        // File input change is already wired in HTML for a simple flow.
    }

    setupVoiceInput() {
        const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
        this.speechSupported = Boolean(SpeechRecognition);
        this.updateMicButtonState();
        if (!SpeechRecognition) return;

        this.recognition = new SpeechRecognition();
        this.recognition.lang = 'en-US';
        this.recognition.continuous = true;
        this.recognition.interimResults = true;

        this.recognition.onstart = () => {
            this.isListening = true;
            this.updateMicButtonState();
        };

        this.recognition.onresult = (event) => {
            const messageInput = document.getElementById('messageInput');
            if (!messageInput) return;

            let transcript = '';
            for (let i = event.resultIndex; i < event.results.length; i += 1) {
                transcript += event.results[i][0].transcript;
            }

            const spacer = this.voiceBaseText && !this.voiceBaseText.endsWith(' ') ? ' ' : '';
            messageInput.value = `${this.voiceBaseText}${spacer}${transcript}`.trimStart();
            this.autoResizeTextarea();
            this.handleInputChange();
        };

        this.recognition.onerror = () => {
            this.isListening = false;
            this.updateMicButtonState();
        };

        this.recognition.onend = () => {
            this.isListening = false;
            this.voiceBaseText = '';
            this.updateMicButtonState();
        };
    }

    toggleVoiceInput() {
        if (!this.speechSupported || !this.recognition) {
            this.showNotification('Voice input is not supported in this browser.', 'info');
            return;
        }
        if (this.isSending) return;

        if (this.isListening) {
            this.stopVoiceInput(false);
            return;
        }

        const messageInput = document.getElementById('messageInput');
        this.voiceBaseText = String(messageInput?.value || '').trim();
        try {
            this.recognition.start();
            this.showNotification('Listening...', 'info');
        } catch (_error) {
            this.showNotification('Could not start microphone.', 'error');
        }
    }

    stopVoiceInput(showToast = true) {
        if (!this.recognition || !this.isListening) return;
        try {
            this.recognition.stop();
            if (showToast) this.showNotification('Voice input stopped.', 'info');
        } catch (_error) {
            // Ignore stop errors.
        }
    }

    updateMicButtonState() {
        const micButton = document.getElementById('micButton');
        if (!micButton) return;

        micButton.disabled = this.isSending || this.isRateLimitLocked() || !this.speechSupported;
        micButton.classList.toggle('active', this.isListening);
        micButton.title = this.isListening ? 'Stop voice input' : 'Voice input';
    }

    autoResizeTextarea() {
        const messageInput = document.getElementById('messageInput');
        if (!messageInput) return;
        messageInput.style.height = 'auto';
        messageInput.style.height = `${Math.min(messageInput.scrollHeight, 180)}px`;
    }

    handleInputChange() {
        const messageInput = document.getElementById('messageInput');
        const sendButton = document.querySelector('.send-button');
        const attachButton = document.querySelector('.attach-button');
        const inputContainer = document.querySelector('.input-container');
        const usageInfo = document.getElementById('usageInfo');
        if (!messageInput || !sendButton) return;

        const hasText = messageInput.value.trim().length > 0;
        const exceedsLimit = messageInput.value.length > this.maxLength;
        const isLocked = this.isRateLimitLocked();

        if (!this.isSending) {
            messageInput.disabled = isLocked;
        }
        messageInput.placeholder = isLocked
            ? `Limit reached until ${this.formatLocalTime(this.rateLimitResetAt)}`
            : this.defaultComposerPlaceholder;
        if (attachButton) attachButton.disabled = this.isSending || isLocked;
        if (inputContainer) inputContainer.classList.toggle('rate-limited', isLocked);
        if (usageInfo) usageInfo.textContent = this.getUsageInfoText();

        sendButton.disabled = this.isSending || isLocked || (!hasText && !this.hasAttachments()) || exceedsLimit;
        this.updateMicButtonState();
    }

    hasAttachments() {
        return Boolean(this.selectedImage?.file);
    }

    setComposerDisabled(disabled) {
        const input = document.getElementById('messageInput');
        const send = document.querySelector('.send-button');
        const attach = document.querySelector('.attach-button');
        const mic = document.getElementById('micButton');
        const stop = document.getElementById('stopButton');
        if (input) input.disabled = disabled;
        if (send) send.disabled = disabled || send.disabled;
        if (attach) attach.disabled = disabled;
        if (mic) mic.disabled = disabled || !this.speechSupported;
        if (disabled) this.stopVoiceInput(false);
        if (stop) stop.style.display = disabled ? 'inline-flex' : 'none';
        if (!disabled) this.handleInputChange();
        this.updateMicButtonState();
    }

    getLastRoleIndex(role) {
        for (let i = this.messages.length - 1; i >= 0; i -= 1) {
            if (this.messages[i].role === role) return i;
        }
        return -1;
    }

    renderAllMessages() {
        const messagesContainer = document.getElementById('messages');
        const welcomeScreen = document.getElementById('welcomeScreen');
        if (!messagesContainer || !welcomeScreen) return;

        messagesContainer.innerHTML = '';
        if (this.messages.length === 0) {
            messagesContainer.style.display = 'none';
            welcomeScreen.style.display = 'flex';
            return;
        }

        welcomeScreen.style.display = 'none';
        messagesContainer.style.display = 'grid';
        this.messages.forEach((message, index) => this.renderMessage(message, false, index));
        this.scrollMessagesToBottom(true);
    }

    isNearBottom() {
        const chatContainer = document.getElementById('chatContainer');
        if (!chatContainer) return true;
        const distance = chatContainer.scrollHeight - chatContainer.scrollTop - chatContainer.clientHeight;
        return distance < 120;
    }

    updateJumpButtonVisibility() {
        const jumpButton = document.getElementById('jumpToLatest');
        if (!jumpButton) return;
        const shouldShow = !this.isNearBottom() && (this.isSending || this.messages.length > 0);
        jumpButton.style.display = shouldShow ? 'inline-flex' : 'none';
    }

    jumpToLatest() {
        this.scrollMessagesToBottom(true);
        this.updateJumpButtonVisibility();
    }

    stopStreaming() {
        if (!this.streamAbortController) return;
        this.streamAbortController.abort();
        this.streamAbortController = null;
        this.showNotification('Generation stopped.', 'info');
    }

    async sendMessage() {
        if (this.isSending) return;
        if (this.isRateLimitLocked()) {
            this.showNotification(`Limit reached. Try again at ${this.formatLocalTime(this.rateLimitResetAt)}.`, 'info');
            this.handleInputChange();
            return;
        }

        const messageInput = document.getElementById('messageInput');
        const content = messageInput ? messageInput.value.trim() : '';
        if (!content && !this.hasAttachments()) return;
        if (messageInput && messageInput.value.length > this.maxLength) return;

        if (!this.currentChatId) {
            await this.createNewChat();
        }

        let imagePayload = null;
        if (this.selectedImage?.file) {
            try {
                const dataUrl = await this.fileToDataUrl(this.selectedImage.file);
                imagePayload = {
                    name: this.selectedImage.file.name,
                    url: this.selectedImage.url,
                    dataUrl
                };
            } catch (_error) {
                this.showNotification('Could not read image. Please try another file.', 'error');
                return;
            }
        }

        const userMessage = {
            role: 'user',
            content,
            image: imagePayload,
            created_at: new Date().toISOString()
        };

        this.messages.push(userMessage);
        this.renderMessage(userMessage, true, this.messages.length - 1);
        await this.ensureTopicTitleForCurrentChat(content);
        this.maybeShowAdaptiveStudyNudge();

        if (messageInput) {
            messageInput.value = '';
            messageInput.style.height = 'auto';
        }

        this.clearAttachment();
        this.handleInputChange();

        this.isSending = true;
        this.setComposerDisabled(true);
        this.streamAbortController = new AbortController();
        this.updateJumpButtonVisibility();

        try {
            const history = this.messages.map((message) => ({
                role: message.role,
                content: message.content,
                image: message.image
                    ? {
                        name: message.image.name,
                        dataUrl: message.image.dataUrl || null,
                        url: message.image.url || null
                    }
                    : null
            }));
            const memory = this.getMemoryPayload();

            const assistantMessage = {
                role: 'assistant',
                content: '',
                created_at: new Date().toISOString()
            };
            this.messages.push(assistantMessage);
            const assistantElement = this.renderMessage(assistantMessage, true, this.messages.length - 1);
            const assistantTextElement = assistantElement
                ? assistantElement.querySelector('.message-text')
                : null;
            if (assistantElement && assistantTextElement) {
                assistantElement.classList.add('assistant-loading');
                assistantTextElement.innerHTML = `
                    <div class="typing-indicator">
                        <div class="typing-dot"></div>
                        <div class="typing-dot"></div>
                        <div class="typing-dot"></div>
                    </div>
                `;
            }

            const response = await fetch('/chat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ chatId: this.currentChatId, history, modelId: this.selectedModelId, memory, stream: true }),
                signal: this.streamAbortController.signal
            });
            if (!response.ok) {
                let errorText = 'Failed to send message';
                let parsed = null;
                try {
                    const raw = await response.text();
                    parsed = raw ? JSON.parse(raw) : null;
                    errorText = parsed?.error || parsed?.text || errorText;
                } catch (_error) {
                    // Keep generic error text.
                }
                if (response.status === 429 && parsed?.resetAt) {
                    this.setRateLimitLock(parsed.resetAt, false);
                }
                throw new Error(errorText);
            }

            if (!response.body) {
                throw new Error('Streaming not available in this browser.');
            }

            const contentType = String(response.headers.get('content-type') || '').toLowerCase();
            if (contentType.includes('application/json')) {
                const fallback = await response.json().catch(() => ({}));
                const fallbackText = this.normalizeAssistantContent(fallback?.text || '');
                assistantMessage.content = fallbackText;
                if (assistantTextElement) {
                    assistantTextElement.innerHTML = this.formatMessageText(fallbackText);
                }
                if (assistantElement) assistantElement.classList.remove('assistant-loading');
                this.loadChatHistory();
                return;
            }

            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            let fullText = '';

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                const chunk = decoder.decode(value, { stream: true });
                if (!chunk) continue;

                fullText += chunk;
                assistantMessage.content = fullText;
                if (assistantTextElement) {
                    if (assistantElement) assistantElement.classList.remove('assistant-loading');
                    assistantTextElement.innerHTML = this.formatMessageText(fullText);
                    this.enhanceMessageCodeBlocks(assistantElement);
                }
                this.scrollMessagesToBottom();
                this.updateJumpButtonVisibility();
            }

            assistantMessage.content = this.normalizeAssistantContent(fullText.trimEnd());
            if (assistantTextElement) {
                if (assistantElement) assistantElement.classList.remove('assistant-loading');
                assistantTextElement.innerHTML = this.formatMessageText(assistantMessage.content);
                this.enhanceMessageCodeBlocks(assistantElement);
            }
            this.loadChatHistory();
            this.refreshUsageStatus();
        } catch (error) {
            console.error('Message send error:', error);
            if (error && error.name === 'AbortError') {
                // Keep any partial assistant text that already streamed.
                this.loadChatHistory();
                return;
            }
            const lastMessage = this.messages[this.messages.length - 1];
            if (lastMessage && lastMessage.role === 'assistant' && !lastMessage.content) {
                this.messages.pop();
                const messagesContainer = document.getElementById('messages');
                if (messagesContainer && messagesContainer.lastElementChild) {
                    messagesContainer.removeChild(messagesContainer.lastElementChild);
                }
            }
            this.showInlineErrorCard(error?.message || 'Failed to send message.');
            this.showNotification(error?.message || 'Failed to send message. Please try again.', 'error');
        } finally {
            this.streamAbortController = null;
            this.isSending = false;
            this.setComposerDisabled(false);
            this.handleInputChange();
            this.updateJumpButtonVisibility();
            this.refreshUsageStatus();
        }
    }

    renderMessage(message, scrollToBottom = true, messageIndex = this.messages.length - 1) {
        const messagesContainer = document.getElementById('messages');
        const welcomeScreen = document.getElementById('welcomeScreen');
        if (!messagesContainer || !welcomeScreen) return null;

        welcomeScreen.style.display = 'none';
        messagesContainer.style.display = 'grid';

        const messageElement = document.createElement('div');
        messageElement.className = `message ${message.role}`;
        const lastUserIndex = this.getLastRoleIndex('user');
        const lastAssistantIndex = this.getLastRoleIndex('assistant');
        const isLatestUser = message.role === 'user' && messageIndex === lastUserIndex;
        const isLatestAssistant = message.role === 'assistant' && messageIndex === lastAssistantIndex;
        const assistantActions = isLatestAssistant
            ? `<button class="message-action-btn" onclick="copyMessageByIndex(${messageIndex})">Copy</button><button class="message-action-btn" onclick="regenerateFromIndex(${messageIndex})">Regenerate</button>`
            : '';
        const userActions = isLatestUser
            ? `<button class="message-action-btn" onclick="editUserMessageByIndex(${messageIndex})">Edit</button>`
            : '';
        const branchAction = messageIndex >= 0
            ? `<button class="message-action-btn" onclick="branchFromIndex(${messageIndex})">Branch</button>`
            : '';

        // Bubble-only structure keeps the UI calm and visually lightweight.
        const imageHtml = message.image?.url
            ? `<img class="message-image" src="${message.image.url}" alt="${this.escapeHtml(message.image.name || 'Uploaded image')}">`
            : '';
        const assistantAvatar = message.role === 'assistant'
            ? '<img class="assistant-avatar" src="assets/vantage-mark.svg" alt="VANTAGE">'
            : '';

        messageElement.innerHTML = `
            <div class="message-content">
                ${assistantAvatar}
                <div class="message-bubble">
                    ${imageHtml}
                    <div class="message-text">${this.formatMessageText(message.content || '')}</div>
                    <div class="message-actions">${message.role === 'assistant' ? assistantActions : userActions}${branchAction}</div>
                </div>
            </div>
        `;

        messagesContainer.appendChild(messageElement);
        this.enhanceMessageCodeBlocks(messageElement);
        if (scrollToBottom) {
            this.scrollMessagesToBottom();
        }
        return messageElement;
    }

    scrollMessagesToBottom(force = false) {
        const chatContainer = document.getElementById('chatContainer');
        if (chatContainer && (force || this.isNearBottom())) {
            chatContainer.scrollTop = chatContainer.scrollHeight;
        }
    }

    enhanceMessageCodeBlocks(messageElement) {
        if (!messageElement) return;
        const preBlocks = messageElement.querySelectorAll('pre');
        preBlocks.forEach((pre) => {
            if (pre.querySelector('.code-copy-btn')) return;
            const button = document.createElement('button');
            button.className = 'code-copy-btn';
            button.textContent = 'Copy code';
            button.setAttribute('type', 'button');
            button.setAttribute('onclick', 'copyCodeFromButton(this)');
            pre.appendChild(button);
        });
    }

    async copyCodeFromButton(button) {
        const pre = button ? button.closest('pre') : null;
        const codeElement = pre ? pre.querySelector('code') : null;
        if (!codeElement) return;
        try {
            await navigator.clipboard.writeText(codeElement.textContent || '');
            const oldText = button.textContent;
            button.textContent = 'Copied';
            setTimeout(() => {
                button.textContent = oldText;
            }, 1200);
        } catch (_error) {
            this.showNotification('Could not copy code.', 'error');
        }
    }

    formatMessageText(text) {
        const escaped = this.escapeHtml(text || '');
        const codeBlocks = [];
        const withCodePlaceholders = escaped.replace(/```([\s\S]*?)```/g, (_match, code) => {
            const token = `__CODE_BLOCK_${codeBlocks.length}__`;
            codeBlocks.push(`<pre><code>${code}</code></pre>`);
            return token;
        });

        const lines = withCodePlaceholders.split('\n');
        const html = [];
        let inUl = false;
        let inOl = false;

        const closeLists = () => {
            if (inUl) {
                html.push('</ul>');
                inUl = false;
            }
            if (inOl) {
                html.push('</ol>');
                inOl = false;
            }
        };

        const inlineFormat = (value) => value
            .replace(/`([^`]+)`/g, '<code>$1</code>')
            .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
            .replace(/\*(.*?)\*/g, '<em>$1</em>')
            .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');

        lines.forEach((rawLine) => {
            const line = rawLine.trimEnd();
            const trimmed = line.trim();

            if (!trimmed) {
                closeLists();
                html.push('<br>');
                return;
            }

            const ulMatch = trimmed.match(/^[-*]\s+(.+)/);
            if (ulMatch) {
                if (!inUl) {
                    closeLists();
                    inUl = true;
                    html.push('<ul>');
                }
                html.push(`<li>${inlineFormat(ulMatch[1])}</li>`);
                return;
            }

            const olMatch = trimmed.match(/^\d+\.\s+(.+)/);
            if (olMatch) {
                if (!inOl) {
                    closeLists();
                    inOl = true;
                    html.push('<ol>');
                }
                html.push(`<li>${inlineFormat(olMatch[1])}</li>`);
                return;
            }

            closeLists();

            const headingMatch = trimmed.match(/^(#{1,3})\s+(.+)/);
            if (headingMatch) {
                const level = headingMatch[1].length;
                html.push(`<h${level}>${inlineFormat(headingMatch[2])}</h${level}>`);
                return;
            }

            const quoteMatch = trimmed.match(/^>\s?(.+)/);
            if (quoteMatch) {
                html.push(`<blockquote>${inlineFormat(quoteMatch[1])}</blockquote>`);
                return;
            }

            html.push(`<p>${inlineFormat(trimmed)}</p>`);
        });

        closeLists();
        let rendered = html.join('');
        codeBlocks.forEach((block, index) => {
            rendered = rendered.replace(`__CODE_BLOCK_${index}__`, block);
        });
        return rendered;
    }

    normalizeAssistantContent(content) {
        const raw = String(content ?? '').trim();
        if (!raw) return '';
        if (!(raw.startsWith('{') && raw.endsWith('}'))) {
            return raw;
        }
        try {
            const parsed = JSON.parse(raw);
            if (parsed && typeof parsed.text === 'string') {
                return parsed.text;
            }
        } catch (_error) {
            // Keep raw text when it's not valid JSON.
        }
        return raw;
    }

    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    showTypingIndicator() {
        const messagesContainer = document.getElementById('messages');
        const welcomeScreen = document.getElementById('welcomeScreen');
        if (!messagesContainer || this.isTyping) return;

        if (welcomeScreen) welcomeScreen.style.display = 'none';
        messagesContainer.style.display = 'grid';
        this.isTyping = true;

        const typingElement = document.createElement('div');
        typingElement.className = 'message assistant typing-message';
        typingElement.innerHTML = `
            <div class="message-content">
                <div class="message-bubble">
                    <div class="typing-indicator">
                        <div class="typing-dot"></div>
                        <div class="typing-dot"></div>
                        <div class="typing-dot"></div>
                    </div>
                </div>
            </div>
        `;

        messagesContainer.appendChild(typingElement);
        this.scrollMessagesToBottom();
    }

    hideTypingIndicator() {
        const messagesContainer = document.getElementById('messages');
        if (messagesContainer) {
            const typingMessage = messagesContainer.querySelector('.typing-message');
            if (typingMessage) typingMessage.remove();
        }
        this.isTyping = false;
    }

    async createNewChat() {
        try {
            const response = await fetch('/api/chats', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ title: 'New Chat' })
            });

            if (!response.ok) throw new Error('Failed to create chat');

            const chat = await response.json();
            this.currentChatId = chat.id;
            this.messages = [];

            const messagesContainer = document.getElementById('messages');
            const welcomeScreen = document.getElementById('welcomeScreen');
            if (messagesContainer) {
                messagesContainer.innerHTML = '';
                messagesContainer.style.display = 'none';
            }
            if (welcomeScreen) welcomeScreen.style.display = 'flex';

            this.closeMobileSidebar();
            this.loadChatHistory();
        } catch (error) {
            console.error('Failed to create new chat:', error);
            this.showNotification('Failed to create new chat', 'error');
        }
    }

    async loadChat(chatId) {
        const id = Number(chatId);
        if (!id) return;

        try {
            const response = await fetch(`/api/chats/${id}`);
            if (!response.ok) throw new Error('Failed to load chat');

            const data = await response.json();
            const loadedMessages = Array.isArray(data.messages) ? data.messages : [];

            this.currentChatId = id;
            this.messages = loadedMessages.map((message) => ({
                role: message.role,
                content: message.role === 'assistant'
                    ? this.normalizeAssistantContent(message.content)
                    : message.content,
                created_at: message.created_at
            }));

            this.renderAllMessages();
            this.closeMobileSidebar();
            this.loadChatHistory();
        } catch (error) {
            console.error('Load chat error:', error);
            this.showNotification('Failed to load chat.', 'error');
        }
    }

    handleFileSelect(event) {
        if (this.isRateLimitLocked()) {
            this.showNotification(`Image uploads are locked until ${this.formatLocalTime(this.rateLimitResetAt)}.`, 'info');
            if (event?.target) event.target.value = '';
            return;
        }

        const input = event.target;
        const file = input.files && input.files[0];
        if (!file) return;

        if (!this.allowedImageTypes.includes(file.type)) {
            this.showNotification('Only JPG, PNG, and WEBP images are supported.', 'error');
            input.value = '';
            return;
        }

        if (this.selectedImage?.url) {
            URL.revokeObjectURL(this.selectedImage.url);
        }

        this.selectedImage = {
            file,
            url: URL.createObjectURL(file)
        };

        this.renderAttachmentPreview();
        this.handleInputChange();
    }

    openAttachmentPicker() {
        if (this.isRateLimitLocked()) {
            this.showNotification(`Image uploads are locked until ${this.formatLocalTime(this.rateLimitResetAt)}.`, 'info');
            return;
        }
        const fileInput = document.getElementById('fileInput');
        if (fileInput) fileInput.click();
    }

    renderAttachmentPreview() {
        const preview = document.getElementById('attachmentPreview');
        const image = document.getElementById('attachmentPreviewImage');
        if (!preview || !image) return;

        if (this.selectedImage?.url) {
            image.src = this.selectedImage.url;
            preview.style.display = 'flex';
        } else {
            image.removeAttribute('src');
            preview.style.display = 'none';
        }
    }

    fileToDataUrl(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(String(reader.result || ''));
            reader.onerror = () => reject(new Error('File read error'));
            reader.readAsDataURL(file);
        });
    }

    clearAttachment() {
        if (this.selectedImage?.url) {
            URL.revokeObjectURL(this.selectedImage.url);
        }
        this.selectedImage = null;

        const fileInput = document.getElementById('fileInput');
        if (fileInput) fileInput.value = '';

        this.renderAttachmentPreview();
    }

    async copyMessageByIndex(index) {
        const message = this.messages[index];
        if (!message) return;
        try {
            if (navigator.clipboard) {
                await navigator.clipboard.writeText(String(message.content || ''));
                this.showNotification('Copied to clipboard.', 'success');
            }
        } catch (_error) {
            this.showNotification('Could not copy message.', 'error');
        }
    }

    async regenerateFromIndex(index) {
        if (this.isSending) return;
        if (this.isRateLimitLocked()) {
            this.showNotification(`Limit reached. Try again at ${this.formatLocalTime(this.rateLimitResetAt)}.`, 'info');
            this.handleInputChange();
            return;
        }
        const target = this.messages[index];
        if (!target || target.role !== 'assistant') return;
        if (index !== this.getLastRoleIndex('assistant')) {
            this.showNotification('Only the latest response can be regenerated.', 'info');
            return;
        }

        this.messages = this.messages.slice(0, index);
        this.renderAllMessages();
        this.loadChatHistory();

        const history = this.messages.map((message) => ({
            role: message.role,
            content: message.content,
            image: message.image
                ? {
                    name: message.image.name,
                    dataUrl: message.image.dataUrl || null,
                    url: message.image.url || null
                }
                : null
        }));
        const memory = this.getMemoryPayload();

        this.isSending = true;
        this.setComposerDisabled(true);
        this.streamAbortController = new AbortController();
        this.updateJumpButtonVisibility();

        try {
            const assistantMessage = {
                role: 'assistant',
                content: '',
                created_at: new Date().toISOString()
            };
            this.messages.push(assistantMessage);
            const assistantElement = this.renderMessage(assistantMessage, true, this.messages.length - 1);
            const assistantTextElement = assistantElement
                ? assistantElement.querySelector('.message-text')
                : null;
            if (assistantElement && assistantTextElement) {
                assistantElement.classList.add('assistant-loading');
                assistantTextElement.innerHTML = `
                    <div class="typing-indicator">
                        <div class="typing-dot"></div>
                        <div class="typing-dot"></div>
                        <div class="typing-dot"></div>
                    </div>
                `;
            }

            const response = await fetch('/chat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ chatId: this.currentChatId, history, modelId: this.selectedModelId, memory, stream: true }),
                signal: this.streamAbortController.signal
            });

            if (!response.ok) {
                let errorText = 'Failed to regenerate';
                let parsed = null;
                try {
                    const raw = await response.text();
                    parsed = raw ? JSON.parse(raw) : null;
                    errorText = parsed?.error || parsed?.text || errorText;
                } catch (_error) {
                    // Keep generic error.
                }
                if (response.status === 429 && parsed?.resetAt) {
                    this.setRateLimitLock(parsed.resetAt, false);
                }
                throw new Error(errorText);
            }
            if (!response.body) throw new Error('Streaming not available in this browser.');

            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            let fullText = '';

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                const chunk = decoder.decode(value, { stream: true });
                if (!chunk) continue;
                fullText += chunk;
                assistantMessage.content = fullText;
                if (assistantTextElement) {
                    if (assistantElement) assistantElement.classList.remove('assistant-loading');
                    assistantTextElement.innerHTML = this.formatMessageText(fullText);
                    this.enhanceMessageCodeBlocks(assistantElement);
                }
                this.scrollMessagesToBottom();
                this.updateJumpButtonVisibility();
            }

            assistantMessage.content = this.normalizeAssistantContent(fullText.trimEnd());
            if (assistantTextElement) {
                if (assistantElement) assistantElement.classList.remove('assistant-loading');
                assistantTextElement.innerHTML = this.formatMessageText(assistantMessage.content);
                this.enhanceMessageCodeBlocks(assistantElement);
            }
            this.loadChatHistory();
            this.refreshUsageStatus();
        } catch (error) {
            console.error('Regenerate error:', error);
            this.showInlineErrorCard(error?.message || 'Failed to regenerate.');
            this.showNotification(error?.message || 'Failed to regenerate.', 'error');
        } finally {
            this.streamAbortController = null;
            this.isSending = false;
            this.setComposerDisabled(false);
            this.handleInputChange();
            this.updateJumpButtonVisibility();
            this.refreshUsageStatus();
        }
    }

    maybeShowAdaptiveStudyNudge() {
        const adaptiveEnabled = localStorage.getItem('adaptiveStudyMode') === '1';
        if (!adaptiveEnabled) return;

        const recentUsers = this.messages
            .filter((m) => m.role === 'user' && String(m.content || '').trim())
            .slice(-5)
            .map((m) => String(m.content || '').toLowerCase());
        if (recentUsers.length < 3) return;

        const topicKeywords = {
            algebra: ['algebra', 'quadratic', 'factor', 'equation', 'polynomial'],
            calculus: ['calculus', 'derivative', 'integral', 'limit', 'differentiate'],
            physics: ['physics', 'force', 'velocity', 'acceleration', 'newton'],
            chemistry: ['chemistry', 'molecule', 'atom', 'reaction', 'stoichiometry'],
            grammar: ['grammar', 'essay', 'thesis', 'paragraph', 'punctuation']
        };

        let detectedTopic = null;
        Object.entries(topicKeywords).forEach(([topic, words]) => {
            if (detectedTopic) return;
            const hits = recentUsers.filter((msg) => words.some((w) => msg.includes(w))).length;
            if (hits >= 3) detectedTopic = topic;
        });
        if (!detectedTopic) return;
        if (this.studyNudgesShown.has(detectedTopic)) return;

        this.studyNudgesShown.add(detectedTopic);
        localStorage.setItem('studyNudgesShown', JSON.stringify(Array.from(this.studyNudgesShown)));

        const labels = {
            algebra: 'algebra and quadratics',
            calculus: 'calculus basics',
            physics: 'core physics concepts',
            chemistry: 'chemistry fundamentals',
            grammar: 'writing and grammar'
        };
        const label = labels[detectedTopic] || detectedTopic;
        this.showNotification(`Study nudge: Want a quick refresher on ${label}?`, 'info');
    }

    editUserMessageByIndex(index) {
        if (this.isSending) return;
        const message = this.messages[index];
        if (!message || message.role !== 'user') return;
        if (index !== this.getLastRoleIndex('user')) {
            this.showNotification('Only the latest user message can be edited.', 'info');
            return;
        }

        const messageInput = document.getElementById('messageInput');
        if (!messageInput) return;

        this.messages = this.messages.slice(0, index);
        this.renderAllMessages();
        this.loadChatHistory();

        messageInput.value = message.content || '';
        this.autoResizeTextarea();
        this.handleInputChange();
        messageInput.focus();
        this.showNotification('Message moved to composer. Edit and send again.', 'info');
    }

    async branchFromIndex(index) {
        if (this.isSending) return;
        const cutoff = Number(index);
        if (!Number.isFinite(cutoff) || cutoff < 0 || cutoff >= this.messages.length) return;

        const branched = this.messages.slice(0, cutoff + 1).map((msg) => ({
            role: msg.role,
            content: msg.content,
            image: msg.image || null,
            created_at: msg.created_at
        }));

        await this.createNewChat();
        this.messages = branched;
        this.renderAllMessages();
        this.showNotification('Branched conversation. Continue from here.', 'success');
    }

    getMemoryPayload() {
        this.memoryEnabled = localStorage.getItem('memoryEnabled') === '1';
        this.memoryProfile = localStorage.getItem('memoryProfile') || '';
        if (!this.memoryEnabled) return { enabled: false };
        return {
            enabled: true,
            profile: String(this.memoryProfile || '').trim().slice(0, 500)
        };
    }

    showNotification(message, type = 'info') {
        const notification = document.getElementById('notification');
        if (!notification) return;

        notification.textContent = message;
        notification.className = `notification ${type}`;
        notification.classList.add('show');

        setTimeout(() => notification.classList.remove('show'), 4000);
    }

    showInlineErrorCard(message) {
        const messagesContainer = document.getElementById('messages');
        const welcomeScreen = document.getElementById('welcomeScreen');
        if (!messagesContainer || !welcomeScreen) return;

        const raw = String(message || '').trim();
        const lower = raw.toLowerCase();
        const isLimit = lower.includes('hit the limit') || lower.includes('try again at');
        const isUpgrade = lower.includes('requires vantage plus') || lower.includes('subscription');

        const prettyMessage = isLimit
            ? raw
            : isUpgrade
                ? 'Your premium access is unavailable on this account. Upgrade to Plus to continue with premium features.'
                : 'Something went wrong while generating a response. Please try again.';

        const actionHtml = isUpgrade
            ? '<a class="error-card-action" href="pricing.html">Upgrade to Plus</a>'
            : '';

        welcomeScreen.style.display = 'none';
        messagesContainer.style.display = 'grid';

        const card = document.createElement('div');
        card.className = `message system`;
        card.innerHTML = `
            <div class="message-content">
                <div class="error-card ${isLimit ? 'limit' : isUpgrade ? 'upgrade' : 'general'}">
                    <div class="error-card-title">${isLimit ? 'Rate limit reached' : isUpgrade ? 'Subscription needed' : 'Request failed'}</div>
                    <div class="error-card-text">${this.escapeHtml(prettyMessage)}</div>
                    ${actionHtml}
                </div>
            </div>
        `;
        messagesContainer.appendChild(card);
        this.scrollMessagesToBottom(true);
    }
}

let chatApp;

async function startNewChat() {
    if (chatApp) await chatApp.createNewChat();
}

async function sendMessage() {
    if (chatApp) await chatApp.sendMessage();
}

function handleKeyPress(event) {
    const enterToSend = localStorage.getItem('enterToSend') !== '0';
    if (enterToSend && event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        sendMessage();
    }
}

function sendSuggestion(text) {
    const messageInput = document.getElementById('messageInput');
    if (!messageInput || !chatApp) return;
    messageInput.value = text;
    chatApp.autoResizeTextarea();
    chatApp.handleInputChange();
    messageInput.focus();
}

function toggleSidebar() {
    if (window.innerWidth <= 900) {
        const sidebar = document.getElementById('sidebar');
        const backdrop = document.getElementById('mobileSidebarBackdrop');
        const willOpen = !sidebar || !sidebar.classList.contains('open');
        if (chatApp) {
            if (willOpen) {
                chatApp.openMobileSidebar();
            } else {
                chatApp.closeMobileSidebar();
            }
        } else if (sidebar) {
            sidebar.classList.toggle('open');
            if (backdrop) backdrop.classList.toggle('show');
        }
        return;
    }
    if (chatApp) chatApp.toggleSidebarDesktop();
}

function closeMobileSidebar() {
    if (chatApp) chatApp.closeMobileSidebar();
}

function toggleSidebarDesktop() {
    if (chatApp) chatApp.toggleSidebarDesktop();
}

function toggleUserMenu() {
    const dropdown = document.getElementById('userDropdown');
    if (dropdown) {
        dropdown.style.display = dropdown.style.display === 'none' ? 'block' : 'none';
    }
}

function toggleTheme() {
    const isLight = document.body.classList.toggle('light-theme');
    localStorage.setItem('theme', isLight ? 'light' : 'dark');
}

function shareConversation() {
    if (!chatApp || !chatApp.currentChatId) {
        if (chatApp) chatApp.showNotification('Start a conversation first to share it.', 'info');
        return;
    }

    const shareUrl = `${window.location.origin}/chat/${chatApp.currentChatId}`;
    if (navigator.clipboard) {
        navigator.clipboard.writeText(shareUrl).then(() => {
            chatApp.showNotification('Conversation link copied.', 'success');
        });
    }
}

function attachFile() {
    if (chatApp) chatApp.openAttachmentPicker();
}

function handleFileSelect(event) {
    if (chatApp) chatApp.handleFileSelect(event);
}

function removeAttachment() {
    if (chatApp) {
        chatApp.clearAttachment();
        chatApp.handleInputChange();
    }
}
function stopGenerating() {
    if (chatApp) chatApp.stopStreaming();
}
function handleChatSearch(event) {
    if (chatApp) chatApp.setChatSearchQuery(event.target.value);
}
function selectModel(event) {
    if (chatApp) chatApp.selectModel(event.target.value);
}
function copyCodeFromButton(button) {
    if (chatApp) chatApp.copyCodeFromButton(button);
}
function jumpToLatest() {
    if (chatApp) chatApp.jumpToLatest();
}
function deleteChatById(event, chatId) {
    event.stopPropagation();
    if (chatApp) chatApp.deleteChat(chatId);
}
function copyMessageByIndex(index) {
    if (chatApp) chatApp.copyMessageByIndex(index);
}
function regenerateFromIndex(index) {
    if (chatApp) chatApp.regenerateFromIndex(index);
}
function editUserMessageByIndex(index) {
    if (chatApp) chatApp.editUserMessageByIndex(index);
}
function branchFromIndex(index) {
    if (chatApp) chatApp.branchFromIndex(index);
}
function deleteMessage() {}
function clearChatHistory() {
    if (chatApp) chatApp.showNotification('Clear history is not wired yet.', 'info');
}
function logout() {
    fetch('/api/auth/logout', { method: 'POST' })
        .finally(() => {
            window.location.href = 'login.html';
        });
}
function loadChat(chatId) {
    if (chatApp) chatApp.loadChat(chatId);
}
function startRename(event, chatId) {
    event.stopPropagation();
    if (chatApp) chatApp.startRenameChat(chatId);
}
function setRenameDraft(event) {
    if (chatApp) chatApp.setRenameDraft(event.target.value);
}
function saveRename(event, chatId) {
    event.stopPropagation();
    if (chatApp) chatApp.renameChat(chatId);
}
function cancelRename(event) {
    event.stopPropagation();
    if (chatApp) chatApp.cancelRename();
}
function handleRenameKey(event, chatId) {
    if (event.key === 'Enter') {
        event.preventDefault();
        saveRename(event, chatId);
    }
    if (event.key === 'Escape') {
        event.preventDefault();
        cancelRename(event);
    }
}
function toggleVoiceInput() {
    if (chatApp) chatApp.toggleVoiceInput();
}

document.addEventListener('DOMContentLoaded', () => {
    const savedTheme = localStorage.getItem('theme');
    if (savedTheme === 'light') {
        document.body.classList.add('light-theme');
    }

    chatApp = new ChatApp();

    document.addEventListener('click', (event) => {
        const userMenu = document.getElementById('userMenu');
        const dropdown = document.getElementById('userDropdown');
        if (userMenu && !userMenu.contains(event.target) && dropdown) {
            dropdown.style.display = 'none';
        }
    });
});


