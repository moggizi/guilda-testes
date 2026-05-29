// cache.js - camada global de cache do site.
// Nao importa Firebase: pode ser usado por qualquer tela sem aumentar leituras.

export const CACHE_DEFAULT_TTL_MS = 24 * 60 * 60 * 1000;
export const GUILD_CONTEXT_CACHE_KEY = 'guildCtx_cache_v1';
export const GUILD_CONTEXT_CACHE_VERSION = 7;
export const CEO_CACHE_KEY = 'ceo_cache_v1';
export const SIDEBAR_PROFILE_CACHE_PREFIX = 'sidebarProfile_v1_';

export function cacheGet(key) {
  try {
    return key ? localStorage.getItem(key) : null;
  } catch (_) {
    return null;
  }
}

export function cacheSet(key, value) {
  try {
    if (key) localStorage.setItem(key, value);
  } catch (_) {}
}

export function cacheRemove(key) {
  try {
    if (key) localStorage.removeItem(key);
  } catch (_) {}
}

export function cacheReadJson(key, fallback = null) {
  try {
    const raw = cacheGet(key);
    return raw ? (JSON.parse(raw) || fallback) : fallback;
  } catch (_) {
    return fallback;
  }
}

export function cacheWriteJson(key, value) {
  try {
    if (!key) return null;
    cacheSet(key, JSON.stringify(value));
    return value;
  } catch (_) {
    return null;
  }
}

export function cacheWriteJsonStamped(key, value = {}) {
  return cacheWriteJson(key, { ...(value || {}), ts: Date.now() });
}

export function cacheIsFresh(cached, ttlMs = CACHE_DEFAULT_TTL_MS) {
  try {
    if (!cached) return false;
    const ts = Number(cached.ts || 0);
    if (!Number.isFinite(ts) || ts <= 0) return false;
    const ttl = Number(ttlMs);
    if (!Number.isFinite(ttl) || ttl <= 0) return false;
    return (Date.now() - ts) < ttl;
  } catch (_) {
    return false;
  }
}

export const getSharedCache = cacheGet;
export const setSharedCache = cacheSet;
export const removeSharedCache = cacheRemove;
export const readSharedJsonCache = cacheReadJson;
export const writeSharedJsonCache = cacheWriteJson;
export const isSharedCacheFresh = cacheIsFresh;

export function cleanCacheEmail(value = '') {
  return String(value || '').trim().toLowerCase();
}

function normalizeRoleFlags(roleValue, ctx = {}) {
  const role = String(roleValue || ctx?.role || 'Membro');
  const roleKey = role
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();
  return {
    role,
    isLeader: ctx?.isLeader === true || roleKey === 'lider' || roleKey === 'leader',
    isAdmin: ctx?.isAdmin === true || roleKey === 'admin' || roleKey === 'administrador',
    isOwner: ctx?.isOwner === true
  };
}

export function getSharedGuildContextCache(options = {}) {
  const cacheVersion = Number(options?.cacheVersion ?? GUILD_CONTEXT_CACHE_VERSION);
  const ttlMs = Number(options?.ttlMs ?? CACHE_DEFAULT_TTL_MS);
  const cached = cacheReadJson(GUILD_CONTEXT_CACHE_KEY, null);

  if (cached && cached.guildId && cached.uid && (cached.email || cached.emailLower) && cached.role) {
    const oldFreeCache = cached.cacheVersion !== cacheVersion
      && (!cached.vipTier || String(cached.vipTier).toLowerCase().trim() === 'free');
    if (oldFreeCache) return null;

    const email = cleanCacheEmail(cached.email || cached.emailLower || '');
    const ceoCached = cacheReadJson(CEO_CACHE_KEY, null);
    const ceoEmail = cleanCacheEmail(ceoCached?.email || ceoCached?.emailLower || '');
    const ceoFresh = ceoCached && ceoEmail === email && cacheIsFresh(ceoCached, ttlMs);

    return {
      ...cached,
      email,
      emailLower: cleanCacheEmail(cached.emailLower || cached.email || ''),
      ...normalizeRoleFlags(cached.role, cached),
      ...(typeof cached.isCeo === 'boolean' ? { isCeo: cached.isCeo === true } : {}),
      ...(ceoFresh ? { isCeo: ceoCached.isCeo === true } : {})
    };
  }

  return null;
}

export function setSharedGuildContextCache(ctx = {}, options = {}) {
  const cacheVersion = Number(options?.cacheVersion ?? GUILD_CONTEXT_CACHE_VERSION);
  const email = cleanCacheEmail(ctx?.email || ctx?.emailLower || '');
  const next = {
    ...(ctx || {}),
    email,
    emailLower: email,
    ...normalizeRoleFlags(ctx?.role, ctx),
    ...(typeof ctx?.isCeo === 'boolean' ? { isCeo: ctx.isCeo === true } : {}),
    cacheVersion,
    ts: Date.now()
  };

  cacheWriteJson(GUILD_CONTEXT_CACHE_KEY, next);
  return next;
}

export function clearSharedGuildContextCache() {
  cacheRemove(GUILD_CONTEXT_CACHE_KEY);
}

function profileUidFrom(userOrUid = null, profile = {}) {
  if (typeof userOrUid === 'string') return String(userOrUid || '').trim();
  return String(userOrUid?.uid || profile?.uid || '').trim();
}

export function sidebarProfileCacheKey(userOrUid = null, profile = {}) {
  const uid = profileUidFrom(userOrUid, profile);
  return uid ? `${SIDEBAR_PROFILE_CACHE_PREFIX}${uid}` : '';
}

export function applySidebarAvatarPhoto(photoValue = '') {
  const foto = String(photoValue || '').trim();
  const hasPhoto = !!foto;

  try {
    document.querySelectorAll('#sidebar-avatar').forEach((img) => {
      if (!img) return;
      if (hasPhoto) {
        if (img.getAttribute('src') !== foto) img.setAttribute('src', foto);
        img.classList.remove('hidden');
      } else {
        img.setAttribute('src', '');
        img.classList.add('hidden');
      }
    });

    document.querySelectorAll('#sidebar-avatar-icon').forEach((icon) => {
      icon?.classList.toggle('hidden', hasPhoto);
    });
  } catch (_) {}
}

export function readCachedSidebarProfile(userOrUid = null) {
  const uid = profileUidFrom(userOrUid);
  const key = sidebarProfileCacheKey(uid);
  const cached = key ? cacheReadJson(key, null) : null;
  if (!cached || String(cached.uid || '') !== uid) return null;
  return cached;
}

export function cacheSidebarProfile(profile = {}, userOrUid = null) {
  const source = profile || {};
  const uid = profileUidFrom(userOrUid, source);
  if (!uid) return null;

  const bio = String(source.cat || source.bio || '').trim().slice(0, 100);
  const payload = {
    uid,
    profileId: String(source.id || source.gameIdMigrated || source.gameId || source.profileId || '').trim(),
    email: cleanCacheEmail(source.email || source.playerEmail || userOrUid?.email || ''),
    nick: String(source.nick || source.nome || source.name || '').trim(),
    foto: String(source.foto || source.photo || source.avatar || '').trim(),
    bio,
    cat: bio,
    guildId: String(source.guildId || '').trim(),
    guilda: String(source.guilda || source.guildName || '').trim(),
    role: String(source.role || '').trim(),
    updatedAtMs: Date.now(),
    ts: Date.now()
  };

  cacheWriteJson(sidebarProfileCacheKey(uid), payload);
  return payload;
}

export function applyCachedSidebarProfile(userOrUid = null) {
  const cached = readCachedSidebarProfile(userOrUid);
  if (!cached) return false;
  applySidebarAvatarPhoto(cached.foto || '');
  return true;
}
