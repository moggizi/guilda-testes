// caches_loja.js — cache local leve da Loginha.
// Não substitui validações do backend. Use apenas para dados que podem ficar alguns minutos desatualizados.

const CACHE_PREFIX = 'ghub_loja_cache_v1';

export const LOJA_CACHE_TTL = Object.freeze({
  PROFILE: 24 * 60 * 60 * 1000,
  CATEGORIES: 24 * 60 * 60 * 1000,
  PRODUCTS: 30 * 60 * 1000,
  STORE_STATUS: 10 * 60 * 1000,
  SELLER_PRODUCTS: 15 * 60 * 1000,
});

function now() {
  return Date.now();
}

function safeUserKey(userKey = '') {
  return String(userKey || 'global').trim().replace(/[^a-zA-Z0-9_.:@-]+/g, '_') || 'global';
}

function cacheKey(scope, userKey = '') {
  return `${CACHE_PREFIX}:${safeUserKey(userKey)}:${String(scope || 'default')}`;
}

export function lojaCacheGet(scope, ttlMs, userKey = '') {
  try {
    const raw = localStorage.getItem(cacheKey(scope, userKey));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    const savedAt = Number(parsed.savedAt || 0);
    if (!savedAt || now() - savedAt > Number(ttlMs || 0)) {
      localStorage.removeItem(cacheKey(scope, userKey));
      return null;
    }
    return parsed.value ?? null;
  } catch (_) {
    return null;
  }
}

export function lojaCacheSet(scope, value, userKey = '') {
  try {
    localStorage.setItem(cacheKey(scope, userKey), JSON.stringify({ savedAt: now(), value }));
  } catch (_) {}
}

export function lojaCacheRemove(scope, userKey = '') {
  try {
    localStorage.removeItem(cacheKey(scope, userKey));
  } catch (_) {}
}

export function lojaCacheClearUser(userKey = '') {
  try {
    const suffix = `:${safeUserKey(userKey)}:`;
    Object.keys(localStorage)
      .filter((key) => key.startsWith(`${CACHE_PREFIX}:`) && key.includes(suffix))
      .forEach((key) => localStorage.removeItem(key));
  } catch (_) {}
}

export async function lojaCacheWrap(scope, ttlMs, loader, { userKey = '', force = false, onCache = null } = {}) {
  if (!force) {
    const cached = lojaCacheGet(scope, ttlMs, userKey);
    if (cached !== null && cached !== undefined) {
      if (typeof onCache === 'function') onCache(cached);
      return cached;
    }
  }

  const fresh = await loader();
  lojaCacheSet(scope, fresh, userKey);
  return fresh;
}
