// ==========================================
// HRMS Professional Login Screen
// ==========================================

import { auth } from '../auth.js';
import { i18n, t } from '../i18n.js';
import { Icons } from '../icons.js';
import { storage } from '../storage.js';
import { toast } from './Toast.js';

export function renderLoginView(container, onLoginSuccess) {
  const isEn = i18n.getLang() === 'en';
  const st = storage.get('hrms_settings_v3', {});
  const companyPhone = st.companyPhone || '';
  const companyEmail = st.companyEmail || '';
  const companyWhatsApp = st.companyWhatsApp || '';

  container.innerHTML = `
    <div style="min-height: 100vh; display: flex; align-items: center; justify-content: center; background: radial-gradient(circle at 50% 50%, rgba(79, 70, 229, 0.15) 0%, var(--bg-app) 100%); padding: 20px;">
      
      <!-- Top Floating Lang Switcher -->
      <div style="position: absolute; top: 24px; right: 24px; display: flex; align-items: center; gap: 10px;">
        <button type="button" class="btn btn-outline btn-sm" id="login-lang-btn" style="background: var(--bg-card);">
          ${isEn ? '🇸🇦 العربية' : '🇺🇸 English'}
        </button>
      </div>

      <!-- Login Card -->
      <div class="card" style="width: 100%; max-width: 440px; padding: 36px; border-radius: var(--radius-xl); box-shadow: var(--shadow-xl); border: 1px solid var(--border-color); background: var(--bg-card);">
        
        <!-- Brand Header -->
        <div style="text-align: center; margin-bottom: 28px;">
          <div style="width: 56px; height: 56px; margin: 0 auto 16px; border-radius: var(--radius-lg); background: var(--primary-gradient); display: flex; align-items: center; justify-content: center; color: #fff; box-shadow: var(--shadow-glow);">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
              <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/>
              <circle cx="9" cy="7" r="4"/>
              <path d="M22 21v-2a4 4 0 0 0-3-3.87"/>
              <path d="M16 3.13a4 4 0 0 1 0 7.75"/>
            </svg>
          </div>
          <h2 style="font-size: 22px; font-weight: 900; color: var(--text-main);">${isEn ? 'BenoSoft' : 'بينو سوفت'}</h2>
          <p style="font-size: 13px; color: var(--text-muted); margin-top: 4px;">
            ${isEn ? 'Sign in to access your company dashboard & HR tools' : 'تسجيل الدخول للوصول إلى لوحة التحكم وأدوات الموارد البشرية'}
          </p>
        </div>

        <!-- Login Form -->
        <form id="login-form">
          <div class="form-group">
            <label class="form-label">${isEn ? 'Username or Email' : 'اسم المستخدم أو البريد الإلكتروني'} *</label>
            <div class="search-box">
              <input type="text" class="form-input" id="login-username" name="username" required autocomplete="username" placeholder="${isEn ? 'Enter username or email' : 'اسم المستخدم (مثال: admin)'}">
              <span class="search-icon">${Icons.users(16)}</span>
            </div>
          </div>

          <div class="form-group" style="margin-bottom: 20px;">
            <label class="form-label">${isEn ? 'Password' : 'كلمة المرور'} *</label>
            <div style="position: relative;">
              <input type="password" class="form-input" id="login-password" name="password" required autocomplete="current-password" placeholder="${isEn ? 'Enter your password' : 'كلمة المرور'}" style="padding-left: 40px;">
              <button type="button" id="btn-toggle-password" style="position: absolute; left: 10px; top: 50%; transform: translateY(-50%); background: none; border: none; cursor: pointer; color: var(--text-muted);">
                ${Icons.eye(16)}
              </button>
            </div>
          </div>

          <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 24px; font-size: 13px;">
            <label style="display: flex; align-items: center; gap: 8px; cursor: pointer; color: var(--text-muted);">
              <input type="checkbox" id="login-remember" checked style="width: 16px; height: 16px;">
              <span>${isEn ? 'Remember me' : 'تذكرني'}</span>
            </label>
          </div>

          <button type="submit" class="btn btn-primary" id="btn-submit-login" style="width: 100%; padding: 12px; font-size: 15px; font-weight: 800; justify-content: center;">
            ${Icons.check(18)} ${isEn ? 'Sign In' : 'تسجيل الدخول'}
          </button>
        </form>

        <!-- Server-side verified login, or local fallback when offline -->
        ${''}

        ${companyPhone || companyEmail || companyWhatsApp ? `
          <div style="margin-top: 14px; display: flex; flex-direction: column; gap: 6px; font-size: 12px; color: var(--text-muted);">
            ${companyPhone ? `
              <div style="display:flex; align-items:center; justify-content:center; gap:6px;">
                <span>📞</span><span dir="ltr">${companyPhone}</span>
              </div>
            ` : ''}
            ${companyEmail ? `
              <div style="display:flex; align-items:center; justify-content:center; gap:6px;">
                <span>✉️</span><span dir="ltr">${companyEmail}</span>
              </div>
            ` : ''}
            ${companyWhatsApp ? `
              <a href="https://wa.me/${companyWhatsApp.replace(/\D/g, '')}" target="_blank" rel="noopener" style="display:flex; align-items:center; justify-content:center; gap:6px; color:var(--primary); text-decoration:none;">
                <span>💬</span><span>${isEn ? 'WhatsApp / Call' : 'واتساب / اتصال'}</span>
              </a>
            ` : ''}
          </div>
        ` : ''}

      </div>
    </div>
  `;

  // Toggle Lang
  container.querySelector('#login-lang-btn')?.addEventListener('click', () => {
    i18n.toggleLang();
    renderLoginView(container, onLoginSuccess);
  });

  // Toggle Password Visibility
  const passInput = container.querySelector('#login-password');
  const toggleBtn = container.querySelector('#btn-toggle-password');
  toggleBtn?.addEventListener('click', () => {
    if (passInput) {
      passInput.type = passInput.type === 'password' ? 'text' : 'password';
    }
  });

  // Form Submit
  const form = container.querySelector('#login-form');
  form?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const username = container.querySelector('#login-username').value;
    const password = container.querySelector('#login-password').value;
    const submitBtn = container.querySelector('#btn-submit-login');
    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.textContent = isEn ? 'Signing in...' : 'جارٍ تسجيل الدخول...';
    }

    // Online: the server checks the credentials (rate limited) and returns a
    // real session. Offline: fall back to the local copy.
    const result = await storage.serverLogin(username, password);

    if (result && result.rateLimited) {
      toast.error(isEn ? 'Too many attempts. Wait 15 minutes and try again.' : 'محاولات كثيرة جدًا. انتظر 15 دقيقة ثم حاول مجددًا.');
    } else if (result && result.ok) {
      // Session issued — pull the freshest data, then build the local session.
      await storage.syncFromServer();
      const res = await auth.login(username, password, { verified: true });
      if (res.success) {
        toast.success(`${isEn ? 'Welcome back' : 'مرحباً بك'}: ${res.user.name}`);
        if (onLoginSuccess) onLoginSuccess(res.user);
      } else {
        toast.error(isEn ? 'Invalid username or password' : 'اسم المستخدم أو كلمة المرور غير صحيحة');
      }
    } else if (result && result.offline) {
      const res = await auth.login(username, password);
      if (res.success) {
        toast.success(`${isEn ? 'Welcome back (offline)' : 'مرحباً بك (بدون اتصال)'}: ${res.user.name}`);
        if (onLoginSuccess) onLoginSuccess(res.user);
      } else {
        toast.error(res.error);
      }
    } else {
      toast.error(isEn ? 'Invalid username or password' : 'اسم المستخدم أو كلمة المرور غير صحيحة');
    }

    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.textContent = `${Icons.check(18)} ${isEn ? 'Sign In' : 'تسجيل الدخول'}`;
    }
  });
}
