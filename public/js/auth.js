// ==========================================
// Authentication & Session Management Service
// ==========================================

import { storage } from './storage.js';
import { can as hasPermission, getEffectivePermissions } from './types.js';
import { t } from './i18n.js';

const AUTH_KEY = 'hrms_auth_session_v3';
const API_BASE = (typeof window !== 'undefined' && window.API_BASE) || '/api';

class AuthService {
  constructor() {
    this.sessionUser = this.getSession();
  }

  getSession() {
    try {
      const data = localStorage.getItem(AUTH_KEY);
      return data ? JSON.parse(data) : null;
    } catch {
      return null;
    }
  }

  setSession(user) {
    this.sessionUser = user;
    if (user) {
      localStorage.setItem(AUTH_KEY, JSON.stringify(user));
      storage.setActiveUser(user.id);
    } else {
      localStorage.removeItem(AUTH_KEY);
    }
  }

  async login(usernameOrEmail, password, opts = {}) {
    const state = storage.getState();
    const users = state.users || [];

    const cleanInput = (usernameOrEmail || '').trim().toLowerCase();
    const cached = users.find(
      (u) =>
        (u.username && u.username.toLowerCase() === cleanInput) ||
        (u.email && u.email.toLowerCase() === cleanInput)
    );

    let user;

    // Server-side verification (preferred). opts.verified means the caller
    // already authenticated against the server (storage.serverLogin). The
    // identity MUST come from that authenticated server response (serverUser);
    // a cached/local user alone is never accepted as "verified". The local
    // cache may only supply local-only fields (e.g. an offline password hash)
    // that the safeUser response omits.
    if (opts.verified) {
      if (!opts.serverUser || !opts.serverUser.id) {
        return { success: false, error: t('auth.invalidPassword') };
      }
      const cachedForId = users.find((u) => u && u.id === opts.serverUser.id);
      user = { ...(cachedForId || {}), ...opts.serverUser };
    } else {
      user = cached;
      if (!user) {
        return { success: false, error: t('auth.userNotFound') };
      }
      // Offline / online fallback verification for non-verified logins.
      let ok = false;
      try {
        const resp = await fetch(`${API_BASE}/auth/login`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username: cleanInput, password }),
        });
        const data = await resp.json();
        ok = resp.ok && data.session;
        if (ok) {
          // Server authenticated — merge returned user data (server may have newer fields)
          Object.assign(user, data.user || {});
        }
      } catch {
        // Offline / network failure — fall back to local verification
        ok = await this.verifyPasswordLocal(user, password);
      }
      if (!ok) {
        return { success: false, error: t('auth.invalidPassword') };
      }
    }

    // If server authenticated, we already have session; if local, create session
    this.setSession(user);
    return { success: true, user };
  }

  async verifyPasswordLocal(user, password) {
    // Legacy plaintext: direct comparison
    if (!user.password || typeof user.password !== 'string') return false;
    if (!user.password.startsWith('pbkdf2$')) {
      return user.password === password;
    }
    // PBKDF2 hash: pbkdf2$<saltB64>$<iterations>$<hashB64>
    const parts = user.password.split('$');
    if (parts.length !== 4) return user.password === password;
    const [, saltB64, iterationsStr, hashB64] = parts;
    const iterations = parseInt(iterationsStr, 10);
    if (!iterations || iterations <= 0) return false;
    if (!window.crypto || !window.crypto.subtle) return false; // non-secure context — cannot verify, deny
    try {
      const salt = Uint8Array.from(atob(saltB64), (c) => c.charCodeAt(0));
      const expectedHash = Uint8Array.from(atob(hashB64), (c) => c.charCodeAt(0));
      const keyMaterial = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
      const bits = await crypto.subtle.deriveBits(
        { name: 'PBKDF2', hash: 'SHA-256', salt, iterations },
        keyMaterial,
        expectedHash.length * 8
      );
      const derived = new Uint8Array(bits);
      if (derived.length !== expectedHash.length) return false;
      let diff = 0;
      for (let i = 0; i < derived.length; i++) diff |= derived[i] ^ expectedHash[i];
      return diff === 0;
    } catch {
      return false;
    }
  }

  /**
   * Hash a NEW plaintext password into a PBKDF2 hash, safe to store locally
   * and on the server. Only runs in secure contexts that expose WebCrypto.
   * Already-hashed values (pbkdf2$...) are returned unchanged so editing a
   * user never double-hashes the stored credential.
   */
  async hashPassword(password, isHashed = false) {
    if (isHashed) return password; // value already a hash — keep as-is
    if (!password) return '';
    if (!window.crypto || !window.crypto.subtle) return password; // cannot hash — store as entered
    const iterations = 100000;
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const keyMaterial = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
    const bits = await crypto.subtle.deriveBits(
      { name: 'PBKDF2', hash: 'SHA-256', salt, iterations },
      keyMaterial,
      256
    );
    const saltB64 = btoa(String.fromCharCode(...salt));
    const hashB64 = btoa(String.fromCharCode(...new Uint8Array(bits)));
    return `pbkdf2$${saltB64}$${iterations}$${hashB64}`;
  }

  /**
   * Check if the currently logged-in user holds a permission.
   * Always resolves against the live user record so permission edits apply
   * without needing to log out and in again.
   */
  can(permission) {
    return hasPermission(storage.getActiveUser(), permission);
  }

  /**
   * Effective permission ids of the current user (resolves legacy roles).
   */
  permissions() {
    return getEffectivePermissions(storage.getActiveUser());
  }

  logout() {
    this.setSession(null);
    storage.clearUserSessionToken();
    window.location.reload();
  }

  isLoggedIn() {
    return !!this.getSession();
  }

  getCurrentUser() {
    return this.getSession();
  }
}

export const auth = new AuthService();
