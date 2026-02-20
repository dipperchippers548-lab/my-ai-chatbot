// VANTAGE 4o - Authentication JavaScript

class AuthManager {
    constructor() {
        this.apiBase = '/api/auth';
        this.firebaseAuth = null;
        this.init();
    }

    init() {
        this.initFirebase();

        // Handle login form
        const loginForm = document.getElementById('loginForm');
        if (loginForm) {
            loginForm.addEventListener('submit', this.handleLogin.bind(this));
        }

        // Handle signup form
        const signupForm = document.getElementById('signupForm');
        if (signupForm) {
            signupForm.addEventListener('submit', this.handleSignup.bind(this));
            
            // Password strength checker
            const passwordInput = document.getElementById('password');
            if (passwordInput) {
                passwordInput.addEventListener('input', this.checkPasswordStrength.bind(this));
            }
        }

        // Handle forgot password form
        const forgotForm = document.getElementById('forgotForm');
        if (forgotForm) {
            forgotForm.addEventListener('submit', this.handleForgotPassword.bind(this));
        }

        // Handle reset password form
        const resetForm = document.getElementById('resetForm');
        if (resetForm) {
            resetForm.addEventListener('submit', this.handleResetPassword.bind(this));
        }

        // Handle dev reset button
        const devResetBtn = document.getElementById('devResetBtn');
        if (devResetBtn) {
            devResetBtn.addEventListener('click', this.showResetForm.bind(this));
        }

        // Check for reset token in URL
        this.checkResetToken();
        
        // Check if user is already logged in
        this.checkAuthStatus();
    }

    initFirebase() {
        if (!window.firebase) return;
        if (!firebase.apps || firebase.apps.length === 0) {
            firebase.initializeApp({
                apiKey: 'AIzaSyCAdInE9zpi2AWKyOgkahE1KMEzPxJLfAc',
                authDomain: 'aura-studio-b930f.firebaseapp.com',
                projectId: 'aura-studio-b930f',
                storageBucket: 'aura-studio-b930f.firebasestorage.app',
                messagingSenderId: '80034410095',
                appId: '1:80034410095:web:d85bbbe4b369a4283aa79a',
                measurementId: 'G-5BTNS60ECZ'
            });
        }
        this.firebaseAuth = firebase.auth();
    }

    async handleLogin(e) {
        e.preventDefault();
        const formData = new FormData(e.target);
        const email = formData.get('email');
        const password = formData.get('password');
        const rememberMe = formData.get('rememberMe');

        this.setLoading(e.target.querySelector('button[type="submit"]'), true);

        try {
            const response = await fetch(`${this.apiBase}/login`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ email, password, rememberMe })
            });

            const data = await response.json();

            if (response.ok) {
                this.showNotification('Login successful! Redirecting...', 'success');
                setTimeout(() => {
                    window.location.href = '/';
                }, 1500);
            } else {
                this.showNotification(data.error || 'Login failed', 'error');
            }
        } catch (error) {
            this.showNotification('Network error. Please try again.', 'error');
        } finally {
            this.setLoading(e.target.querySelector('button[type="submit"]'), false);
        }
    }

    async handleSignup(e) {
        e.preventDefault();
        const formData = new FormData(e.target);
        
        const password = formData.get('password');
        const confirmPassword = formData.get('confirmPassword');
        
        if (password !== confirmPassword) {
            this.showNotification('Passwords do not match', 'error');
            return;
        }

        if (password.length < 8) {
            this.showNotification('Password must be at least 8 characters', 'error');
            return;
        }

        const agreeTerms = formData.get('agreeTerms');
        if (!agreeTerms) {
            this.showNotification('Please agree to the Terms of Service and Privacy Policy', 'error');
            return;
        }

        this.setLoading(e.target.querySelector('button[type="submit"]'), true);

        try {
            const response = await fetch(`${this.apiBase}/register`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    email: formData.get('email'),
                    password: password,
                    displayName: formData.get('displayName')
                })
            });

            const data = await response.json();

            if (response.ok) {
                this.showNotification('Account created successfully! Redirecting...', 'success');
                setTimeout(() => {
                    window.location.href = '/';
                }, 1500);
            } else {
                this.showNotification(data.error || 'Registration failed', 'error');
            }
        } catch (error) {
            this.showNotification('Network error. Please try again.', 'error');
        } finally {
            this.setLoading(e.target.querySelector('button[type="submit"]'), false);
        }
    }

    async handleForgotPassword(e) {
        e.preventDefault();
        const formData = new FormData(e.target);
        const email = formData.get('email');

        this.setLoading(e.target.querySelector('button[type="submit"]'), true);

        try {
            const response = await fetch(`${this.apiBase}/forgot-password`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ email })
            });

            const data = await response.json();

            // Always show success message for security
            this.showNotification('If an account exists, a reset link has been sent.', 'info');
            
            // Show dev reset section if in development
            if (data.resetToken) {
                const devSection = document.getElementById('devResetSection');
                if (devSection) {
                    devSection.style.display = 'block';
                    // Store token for later use
                    window.resetToken = data.resetToken;
                }
            }

            // Show step 2
            document.getElementById('resetStep1').style.display = 'none';
            document.getElementById('resetStep2').style.display = 'block';

        } catch (error) {
            this.showNotification('Network error. Please try again.', 'error');
        } finally {
            this.setLoading(e.target.querySelector('button[type="submit"]'), false);
        }
    }

    showResetForm() {
        const token = window.resetToken;
        if (!token) {
            this.showNotification('No reset token available', 'error');
            return;
        }

        document.getElementById('resetToken').value = token;
        document.getElementById('resetStep2').style.display = 'none';
        document.getElementById('resetStep3').style.display = 'block';
    }

    async handleResetPassword(e) {
        e.preventDefault();
        const formData = new FormData(e.target);
        
        const password = formData.get('newPassword');
        const confirmPassword = formData.get('confirmPassword');
        
        if (password !== confirmPassword) {
            this.showNotification('Passwords do not match', 'error');
            return;
        }

        if (password.length < 8) {
            this.showNotification('Password must be at least 8 characters', 'error');
            return;
        }

        this.setLoading(e.target.querySelector('button[type="submit"]'), true);

        try {
            const response = await fetch(`${this.apiBase}/reset-password`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    token: formData.get('resetToken'),
                    newPassword: password
                })
            });

            const data = await response.json();

            if (response.ok) {
                this.showNotification('Password reset successful! Redirecting to login...', 'success');
                setTimeout(() => {
                    window.location.href = 'login.html';
                }, 2000);
            } else {
                this.showNotification(data.error || 'Password reset failed', 'error');
            }
        } catch (error) {
            this.showNotification('Network error. Please try again.', 'error');
        } finally {
            this.setLoading(e.target.querySelector('button[type="submit"]'), false);
        }
    }

    checkPasswordStrength(e) {
        const password = e.target.value;
        const strengthBar = e.target.parentElement.querySelector('.strength-bar');
        const strengthText = e.target.parentElement.querySelector('.strength-text');
        
        if (!strengthBar || !strengthText) return;

        let strength = 0;
        
        // Length check
        if (password.length >= 8) strength++;
        if (password.length >= 12) strength++;
        
        // Character variety
        if (/[a-z]/.test(password)) strength++;
        if (/[A-Z]/.test(password)) strength++;
        if (/[0-9]/.test(password)) strength++;
        if (/[^a-zA-Z0-9]/.test(password)) strength++;

        strengthBar.className = 'strength-bar';
        
        if (password.length === 0) {
            strengthText.textContent = 'Use 8+ characters';
        } else if (strength <= 2) {
            strengthBar.classList.add('weak');
            strengthText.textContent = 'Weak password';
        } else if (strength <= 4) {
            strengthBar.classList.add('medium');
            strengthText.textContent = 'Medium strength';
        } else {
            strengthBar.classList.add('strong');
            strengthText.textContent = 'Strong password';
        }
    }

    checkResetToken() {
        const urlParams = new URLSearchParams(window.location.search);
        const token = urlParams.get('token');
        const email = urlParams.get('email');

        const emailInput = document.getElementById('email');
        if (email && emailInput) {
            emailInput.value = email;
        }
        
        if (token && document.getElementById('resetStep3')) {
            document.getElementById('resetToken').value = token;
            document.getElementById('resetStep1').style.display = 'none';
            document.getElementById('resetStep3').style.display = 'block';
        }
    }

    async checkAuthStatus() {
        const path = String(window.location.pathname || '').toLowerCase();
        const isResetFlowPage = path.endsWith('/forgot-password.html') || path.endsWith('forgot-password.html');
        try {
            const response = await fetch(`${this.apiBase}/me`);
            const data = await response.json();
            
            // Keep logged-in users on forgot/reset page when opened from Settings security actions.
            if (data.user && !isResetFlowPage) {
                // User is logged in, redirect to main app
                window.location.href = '/';
            }
        } catch (error) {
            // User is not logged in, stay on auth page
        }
    }

    async handleSocialLogin(provider) {
        if (!this.firebaseAuth) {
            this.showNotification('Firebase is not ready. Refresh and try again.', 'error');
            return;
        }

        if (provider !== 'google') {
            this.showNotification(`${provider} login is coming soon.`, 'info');
            return;
        }

        try {
            const googleProvider = new firebase.auth.GoogleAuthProvider();
            googleProvider.setCustomParameters({ prompt: 'select_account' });
            const result = await this.firebaseAuth.signInWithPopup(googleProvider);
            const idToken = await result.user.getIdToken(true);

            const response = await fetch(`${this.apiBase}/firebase/google`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ idToken })
            });
            const raw = await response.text();
            let data = {};
            try {
                data = raw ? JSON.parse(raw) : {};
            } catch (parseError) {
                data = { error: 'Server returned a non-JSON response.' };
            }

            if (!response.ok) {
                throw new Error(data.error || 'Google login failed');
            }

            this.showNotification('Google login successful! Redirecting...', 'success');
            setTimeout(() => {
                window.location.href = '/';
            }, 900);
        } catch (error) {
            console.error('Social login error:', error);
            this.showNotification(error.message || 'Social login failed.', 'error');
        } finally {
            // Firebase login state is only used to mint token for backend cookie session.
            if (this.firebaseAuth && this.firebaseAuth.currentUser) {
                this.firebaseAuth.signOut().catch(() => {});
            }
        }
    }

    setLoading(button, loading) {
        if (!button) return;
        
        if (loading) {
            button.classList.add('loading');
            button.disabled = true;
            const originalText = button.textContent;
            button.dataset.originalText = originalText;
        } else {
            button.classList.remove('loading');
            button.disabled = false;
            if (button.dataset.originalText) {
                button.textContent = button.dataset.originalText;
            }
        }
    }

    showNotification(message, type = 'info') {
        const notification = document.getElementById('notification');
        if (!notification) return;

        notification.textContent = message;
        notification.className = `notification ${type}`;
        notification.classList.add('show');

        setTimeout(() => {
            notification.classList.remove('show');
        }, 5000);
    }
}

let authManager;

function socialLogin(provider) {
    if (authManager) {
        authManager.handleSocialLogin(provider);
    }
}

// Initialize auth manager when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    authManager = new AuthManager();
});

// Utility functions
function getCookie(name) {
    const value = `; ${document.cookie}`;
    const parts = value.split(`; ${name}=`);
    if (parts.length === 2) return parts.pop().split(';').shift();
}

function logout() {
    fetch('/api/auth/logout', { method: 'POST' })
        .then(() => {
            window.location.href = 'login.html';
        })
        .catch(error => {
            console.error('Logout error:', error);
            window.location.href = 'login.html';
        });
}
