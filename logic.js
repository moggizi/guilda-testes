// logic.js — módulo compartilhado (Firebase + UI helpers)

import { initializeApp, deleteApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getAuth,
  onAuthStateChanged,
  signOut,
  fetchSignInMethodsForEmail,
  createUserWithEmailAndPassword
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  getFirestore,
  doc,
  getDoc,
  setDoc,
  updateDoc,
  writeBatch,
  serverTimestamp,
  addDoc,
  collection,
  deleteField
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

import { getFunctions, httpsCallable } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-functions.js";
import {
  cacheGet as __cacheGetGlobal,
  cacheSet as __cacheSetGlobal,
  cacheRemove as __cacheRemoveGlobal,
  cacheReadJson as __cacheReadJsonGlobal,
  cacheWriteJson as __cacheWriteJsonGlobal,
  cacheWriteJsonStamped as __cacheWriteJsonStampedGlobal,
  cacheIsFresh as __cacheIsFreshGlobal,
  readCachedSidebarProfile as __readCachedSidebarProfileGlobal,
  cacheSidebarProfile as __cacheSidebarProfileGlobal,
  applyCachedSidebarProfile as __applyCachedSidebarProfileGlobal
} from "./cache.js";

// Firebase config
export const firebaseConfig = {
  apiKey: "AIzaSyC7UJxBOViZj8ELjw-Xvy645QYfDfpBzxM",
  authDomain: "guilda-hubb.firebaseapp.com",
  projectId: "guilda-hubb",
  storageBucket: "guilda-hubb.firebasestorage.app",
  messagingSenderId: "117135418619",
  appId: "1:117135418619:web:e8ca8ec52eb0eeeff87c5e",
  measurementId: "G-9CHV67E64Y"
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
export const functions = getFunctions(app);

// --- Contexto da Guilda -----------------------------------------------------
let __guildCtx = null;

const __GUILDCTX_LS_KEY = 'guildCtx_cache_v1';
const __GUILDCTX_CACHE_VERSION = 8;
try {
  const raw = localStorage.getItem(__GUILDCTX_LS_KEY);
  if (raw) {
    const cached = JSON.parse(raw);
    if (cached && cached.guildId && cached.uid && (cached.email || cached.emailLower) && cached.role) {
      const oldFreeCache = cached.cacheVersion !== __GUILDCTX_CACHE_VERSION && (!cached.vipTier || String(cached.vipTier).toLowerCase().trim() === 'free');
      if (!oldFreeCache) __guildCtx = {
        guildId: String(cached.guildId),
        guildName: cached.guildName ? String(cached.guildName) : null,
        role: String(cached.role),
        email: String(cached.email || cached.emailLower || ''),
        uid: String(cached.uid),
        vipTier: cached.vipTier ? String(cached.vipTier) : 'free',
        vipExpiresAtMs: (cached.vipExpiresAtMs != null ? Number(cached.vipExpiresAtMs) : null),
        isOwner: cached.isOwner === true || (String(cached.uid || '').trim() && String(cached.guildId || '').trim() && String(cached.uid || '').trim() === String(cached.guildId || '').trim())
      };
    }
  }
} catch (_) {}

const __CEO_LS_KEY = 'ceo_cache_v1';
let __isCeo = false;
try {
  const raw = localStorage.getItem(__CEO_LS_KEY);
  if (raw) {
    const cached = JSON.parse(raw);
    if (cached && cached.email && cached.ts && (Date.now() - cached.ts) < 10 * 60 * 1000) {
      __isCeo = !!cached.isCeo;
    }
  }
} catch (_) {}


export function getGuildContext() {
  return __guildCtx;
}

export function getVipTier() {
  return (__guildCtx && __guildCtx.vipTier) ? String(__guildCtx.vipTier) : 'free';
}

export function getVipExpiresAtMs() {
  return (__guildCtx && __guildCtx.vipExpiresAtMs != null) ? Number(__guildCtx.vipExpiresAtMs) : null;
}

// Cache padrão das configurações: 24 horas.
// Leituras usam cache primeiro; Firebase só entra quando expira ou quando forceRefresh=true.
const __SETTINGS_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

// Cache de autenticação/navegação: reduz leituras repetidas ao trocar de tela.
// 24h para manter guildCtx_cache_v1 reaproveitável durante o dia inteiro.
const __AUTH_CONTEXT_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

// Admin/Líder secundário NÃO revalida em toda tela.
// Ele revalida só no início da sessão/login; depois usa cache normal para navegar sem gastar leituras.
const __SECONDARY_ACCESS_SESSION_PREFIX = 'secondaryAccessValidated_v1_';

function __secondaryAccessSessionKey(userUid = '', guildId = '', emailLower = '') {
  return `${__SECONDARY_ACCESS_SESSION_PREFIX}${String(userUid || '').trim()}_${String(guildId || '').trim()}_${cleanEmail(emailLower || '')}`;
}

function __hasSecondaryAccessSessionValidation(user, ctx = {}) {
  try {
    const key = __secondaryAccessSessionKey(user?.uid, ctx?.guildId, ctx?.email || ctx?.emailLower || user?.email || '');
    return !!key && sessionStorage.getItem(key) === '1';
  } catch (_) {
    return false;
  }
}

function __markSecondaryAccessSessionValidated(user, guildId = '', emailLower = '') {
  try {
    const key = __secondaryAccessSessionKey(user?.uid, guildId, emailLower || user?.email || '');
    if (key) sessionStorage.setItem(key, '1');
  } catch (_) {}
}

function __clearSecondaryAccessSessionValidation() {
  try {
    for (let i = sessionStorage.length - 1; i >= 0; i--) {
      const k = sessionStorage.key(i) || '';
      if (k.startsWith(__SECONDARY_ACCESS_SESSION_PREFIX)) sessionStorage.removeItem(k);
    }
  } catch (_) {}
}

function __cacheIsFresh(cached, ttlMs = __SETTINGS_CACHE_TTL_MS) {
  return __cacheIsFreshGlobal(cached, ttlMs);
}

function __shouldUseCache(cached, options = {}) {
  return options?.forceRefresh !== true && __cacheIsFresh(cached, options?.ttlMs ?? __SETTINGS_CACHE_TTL_MS);
}

function __readJsonCache(key) {
  return __cacheReadJsonGlobal(key, null);
}

function __writeJsonCache(key, value = {}) {
  __cacheWriteJsonStampedGlobal(key, value);
}

const __SIDEBAR_PROFILE_CACHE_PREFIX = 'sidebarProfile_v1_';

function __sidebarProfileUid(userOrUid = null) {
  if (typeof userOrUid === 'string') return String(userOrUid || '').trim();
  return String(
    userOrUid?.uid ||
    auth.currentUser?.uid ||
    __guildCtx?.uid ||
    ''
  ).trim();
}

function __sidebarProfileCacheKey(userOrUid = null) {
  const uid = __sidebarProfileUid(userOrUid);
  return uid ? `${__SIDEBAR_PROFILE_CACHE_PREFIX}${uid}` : '';
}

function __applySidebarAvatarPhoto(photoValue = '') {
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
  const uid = __sidebarProfileUid(userOrUid);
  return uid ? __readCachedSidebarProfileGlobal(uid) : null;
}

export function cacheSidebarProfile(profile = {}, userOrUid = null) {
  const uid = __sidebarProfileUid(userOrUid);
  if (!uid) return null;
  const source = profile || {};

  return __cacheSidebarProfileGlobal({
    ...source,
    uid,
    email: source.email || source.playerEmail || auth.currentUser?.email || '',
    id: source.id || source.gameIdMigrated || source.gameId || source.profileId || ''
  }, uid);
}

export function applyCachedSidebarProfile(userOrUid = null) {
  const uid = __sidebarProfileUid(userOrUid);
  return uid ? __applyCachedSidebarProfileGlobal(uid) : false;
}


// --- Cache compartilhado oficial -------------------------------------------
// Mantém um único ponto de leitura/escrita de cache para as telas novas.
// As telas antigas continuam usando as funções já existentes neste arquivo.
export function getSharedCache(key) {
  return __cacheGetGlobal(key);
}

export function setSharedCache(key, value) {
  __cacheSetGlobal(key, value);
}

export function removeSharedCache(key) {
  __cacheRemoveGlobal(key);
}

export function readSharedJsonCache(key, fallback = null) {
  return __cacheReadJsonGlobal(key, fallback);
}

export function writeSharedJsonCache(key, value) {
  __cacheWriteJsonGlobal(key, value);
}

export function isSharedCacheFresh(cached, ttlMs = __SETTINGS_CACHE_TTL_MS) {
  return __cacheIsFresh(cached, ttlMs);
}

function __roleCacheFlags(roleValue, ctx = {}) {
  const role = String(roleValue || ctx?.role || 'Membro');
  return {
    role,
    isLeader: ctx?.isLeader === true || role === 'Líder',
    isAdmin: ctx?.isAdmin === true || role === 'Admin',
    isOwner: ctx?.isOwner === true
  };
}

export function getSharedGuildContextCache() {
  const cached = readSharedJsonCache(__GUILDCTX_LS_KEY, null);
  if (cached && cached.guildId && cached.uid && (cached.email || cached.emailLower) && cached.role) {
    // Cache antigo, criado antes da correção do plano, podia salvar vipTier como free
    // mesmo quando a guilda era paga. Rejeita só esse caso para forçar 1 refresh seguro.
    if (cached.cacheVersion !== __GUILDCTX_CACHE_VERSION && (!cached.vipTier || String(cached.vipTier).toLowerCase().trim() === 'free')) {
      return null;
    }
    const flags = __roleCacheFlags(cached.role, cached);
    const email = cleanEmail(cached.email || cached.emailLower || '');
    const ceoCached = readSharedJsonCache(__CEO_LS_KEY, null);
    const ceoEmail = cleanEmail(ceoCached?.email || ceoCached?.emailLower || '');
    const ceoFresh = ceoCached && ceoEmail === email && __cacheIsFresh(ceoCached, __SETTINGS_CACHE_TTL_MS);
    return {
      ...cached,
      email,
      emailLower: cleanEmail(cached.emailLower || cached.email || ''),
      ...flags,
      ...(typeof cached.isCeo === 'boolean' ? { isCeo: cached.isCeo === true } : {}),
      ...(ceoFresh ? { isCeo: ceoCached.isCeo === true } : {})
    };
  }
  return null;
}

export function setSharedGuildContextCache(ctx = {}) {
  const flags = __roleCacheFlags(ctx?.role, ctx);
  const email = cleanEmail(ctx?.email || ctx?.emailLower || '');
  const next = {
    ...(ctx || {}),
    email,
    emailLower: email,
    ...flags,
    ...(typeof ctx?.isCeo === 'boolean' ? { isCeo: ctx.isCeo === true } : {}),
    cacheVersion: __GUILDCTX_CACHE_VERSION,
    ts: Date.now()
  };
  writeSharedJsonCache(__GUILDCTX_LS_KEY, next);
  try { __scheduleSecondaryVipLogoutFromCtx(next); } catch (_) {}
  return next;
}

export function clearSharedGuildContextCache() {
  removeSharedCache(__GUILDCTX_LS_KEY);
}



// --- Guilda: info básica com cache (1 leitura no máximo) --------------------
// Cache em localStorage: guildInfo_<guildId>
// Retorna: { guildId, name, createdAtMs }
export async function getGuildInfoCached(guildId, options = {}) {
  const gid = (guildId || getGuildContext()?.guildId || "").toString().trim();
  if (!gid) return { guildId: null, name: null, createdAtMs: null };

  const key = `guildInfo_${gid}`;
  const cached = __readJsonCache(key);
  if (__shouldUseCache(cached, options) && cached?.guildId === gid) {
    return {
      guildId: gid,
      name: cached.name || null,
      createdAtMs: (cached.createdAtMs != null ? Number(cached.createdAtMs) : null)
    };
  }

  try {
    const snap = await getDoc(doc(db, "guildas", gid));
    const data = snap.exists() ? (snap.data() || {}) : {};
    const name = (data.name || "").toString().trim() || null;

    let createdAtMs = null;
    const rawCreated = data.createdAt;
    if (rawCreated && typeof rawCreated.toMillis === "function") createdAtMs = rawCreated.toMillis();
    else if (typeof rawCreated === "number") createdAtMs = rawCreated;
    else if (typeof rawCreated === "string") {
      const t = Date.parse(rawCreated);
      createdAtMs = isFinite(t) ? t : null;
    }

    __writeJsonCache(key, { guildId: gid, name, createdAtMs });
    return { guildId: gid, name, createdAtMs };
  } catch (_) {
    if (cached && cached.guildId === gid) {
      return {
        guildId: gid,
        name: cached?.name || null,
        createdAtMs: (cached?.createdAtMs != null ? Number(cached.createdAtMs) : null)
      };
    }
    return { guildId: gid, name: null, createdAtMs: null };
  }
}

// --- UI: aplica cache no menu lateral (sem esperar Firebase) -----------------
function __applyCachedSidebarNow() {
  try {
    const roleEl = document.getElementById("user-role");
    const emailEl = document.getElementById("user-email");
    try { applyCachedSidebarProfile(__guildCtx?.uid || auth.currentUser); } catch (_) {}

    if (__guildCtx) {
      if (emailEl) {
        const curE = (emailEl.textContent || "").trim();
        if (!curE) emailEl.textContent = __guildCtx.email || "";
      }
      if (roleEl) {
        const cur = (roleEl.textContent || "").trim();
        if (!cur || cur === "...") roleEl.textContent = __guildCtx.role || "Membro";
      }

      // VIP label (mantém dias no menu como já existe)
      try { applyVipUiAndGates(__guildCtx.vipTier || 'free'); } catch (_) {}

      // CEO visibilidade com o cache (pode estar desatualizado, mas evita "...")
      try { applyCeoNavVisibility(); } catch (_) {}
    } else {
      // Mesmo sem guildCtx, ainda aplica o cache de CEO se existir
      try { applyCeoNavVisibility(); } catch (_) {}
    }
  } catch (_) {}
}

// Auto: roda o quanto antes (quando o DOM existir)
(function __bootCachedSidebar() {
  try {
    if (typeof window === "undefined" || typeof document === "undefined") return;

    const run = () => __applyCachedSidebarNow();

    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", run, { once: true });
    } else {
      run();
    }

    // Atualiza se outra aba mudar o cache (ex: entrou em Membros e atualizou role/vip)
    window.addEventListener("storage", (e) => {
      try {
        if (!e) return;

        if (e.key === __GUILDCTX_LS_KEY && e.newValue) {
          const cached = JSON.parse(e.newValue);
          if (cached && cached.guildId && cached.uid && cached.email && cached.role) {
            __guildCtx = {
              guildId: String(cached.guildId),
              guildName: cached.guildName ? String(cached.guildName) : null,
              role: String(cached.role),
              email: String(cached.email),
              uid: String(cached.uid),
              vipTier: cached.vipTier ? String(cached.vipTier) : 'free',
              vipExpiresAtMs: (cached.vipExpiresAtMs != null ? Number(cached.vipExpiresAtMs) : null),
              isOwner: cached.isOwner === true
            };
            try { __scheduleSecondaryVipLogoutFromCtx(__guildCtx); } catch (_) {}
          }
          __applyCachedSidebarNow();
        }

        if (e.key === __CEO_LS_KEY && e.newValue) {
          const cached = JSON.parse(e.newValue);
          if (cached && cached.email && cached.ts && (Date.now() - cached.ts) < 10 * 60 * 1000) {
            __isCeo = !!cached.isCeo;
          }
          __applyCachedSidebarNow();
        }
      } catch (_) {}
    });
  } catch (_) {}
})();



async function __persistExpiredVipAsFree(guildId) {
  try {
    const gid = String(guildId || '').trim();
    if (!gid) return false;

    return false;
  } catch (_) {
    return false;
  }
}

function __maybeDowngradeVipSync() {
  return;
}

export function getVipRemainingDays() {
  __maybeDowngradeVipSync();
  const ms = getVipExpiresAtMs();
  if (!ms) return null;
  const diff = ms - Date.now();
  if (!isFinite(diff)) return null;
  const days = Math.ceil(diff / 86400000);
  return Math.max(0, days);
}

function vipTierFromValue(v) {
  const s = (v || '').toString().toLowerCase().trim();
  if (!s || s === 'free') return 'free';
  if (s === 'vitalicio' || s === 'vitalício' || s.includes('vital') || s.includes('life') || s.includes('parceiro') || s.includes('partner')) return 'parceiro';
  if (s === 'ultra' || s.includes('ultra')) return 'ultra';
  if (s === 'business' || s === 'bussines' || s.includes('buss') || s.includes('business')) return 'business';
  if (s === 'pro' || s.includes('pro')) return 'pro';
  if (s === 'plus' || s.includes('plus')) return 'plus';
  return s;
}



// --- VIP: permissões de Admin/Líder secundário (campo único) ---------------
// Em /configGuilda/{guildId}:
// - permissoesAtivas: true quando VIP pago esta ativo no cadastro
// - permissoesAtivas: false quando o plano esta free
// Importante: só escreve se for necessário (quando muda)
async function __syncPermissoesAtivasIfNeeded(guildId, cfgData, vipTier, vipExpiresAtMs) {
  try {
    if (!guildId) return null;

    const tier = (vipTier || cfgData?.vipTier || "free").toString().toLowerCase().trim();
    const paid = !!tier && tier !== "free";

    const vipAtivo = paid;

    const atual = (cfgData && cfgData.permissoesAtivas !== undefined) ? (cfgData.permissoesAtivas !== false) : null;
    const novo = !!vipAtivo;

    if (atual === null || atual !== novo) {
      await setDoc(doc(db, "configGuilda", guildId), {
        permissoesAtivas: novo,
        updatedAt: serverTimestamp()
      }, { merge: true });
    }
    return novo;
  } catch (_) {
    return null;
  }
}


function requireGuildId() {
  if (!__guildCtx || !__guildCtx.guildId) throw new Error("Guilda não resolvida. Faça login novamente.");
  return __guildCtx.guildId;
}

function cleanEmail(email) {
  return (email || "").toString().toLowerCase().trim();
}

function emailDocId(emailLower) {
  // Firestore doc IDs não aceitam '/', então usamos uma normalização simples.
  // Mantém estável para lookup futuro.
  return cleanEmail(emailLower).replaceAll('.', ',');
}

// --- Chefe (CEO) -----------------------------------------------------------
export function isCeo() {
  return !!__isCeo;
}

async function __refreshCeoStatus(emailLower) {
  const email = cleanEmail(emailLower);
  if (!email) return false;
  try {
    const snap = await getDoc(doc(db, "chefe", "security"));
    const data = snap.exists() ? (snap.data() || {}) : {};
    const list = Array.isArray(data.ceo) ? data.ceo : [];
    const ok = list.map(cleanEmail).includes(email);
    __isCeo = ok;
    try {
      localStorage.setItem(__CEO_LS_KEY, JSON.stringify({ email, isCeo: ok, ts: Date.now() }));
    } catch (_) {}
    return ok;
  } catch (_) {
    __isCeo = false;
    return false;
  }
}

export async function ensureCeoStatus() {
  try {
    const user = auth.currentUser;
    const email = cleanEmail(user?.email);
    return await __refreshCeoStatus(email);
  } catch (_) {
    return false;
  }
}

export function applyCeoNavVisibility() {
  try {
    document.querySelectorAll('[data-ceo-only="true"], #nav-chefe').forEach((el) => {
      if (!el) return;
      if (__isCeo) el.classList.remove('hidden');
      else el.classList.add('hidden');
    });
  } catch (_) {}
}

function uniq(arr) {
  const out = [];
  const seen = new Set();
  for (const v of (arr || [])) {
    const s = (v || "").toString();
    if (!s) continue;
    if (seen.has(s)) continue;
    seen.add(s);
    out.push(s);
  }
  return out;
}

async function getGuildName(guildId) {
  try {
    const snap = await getDoc(doc(db, "guildas", guildId));
    if (!snap.exists()) return null;
    const data = snap.data() || {};
    return (data.name || "").toString().trim() || null;
  } catch {
    return null;
  }
}

async function findGuildByEmail(emailLower) {
  // Desativado de propósito para economizar leituras.
  // Não fazemos mais query/varredura em configGuilda para descobrir guilda por e-mail.
  // O vínculo correto deve vir de users/{uid}. Depois disso, cada tela lê apenas:
  // - configGuilda/{guildId}
  // - guildas/{guildId}
  // sempre o próprio documento da guilda.
  return null;
}

async function resolveRoleInGuild(guildId, email) {
  const e = cleanEmail(email);
  if (!guildId || !e) return "Membro";

  try {
    const snap = await getDoc(doc(db, "configGuilda", guildId));
    if (snap.exists()) {
      const data = snap.data() || {};
      const leaders = Array.isArray(data.leaders) ? data.leaders : [];
      const admins = Array.isArray(data.admins) ? data.admins : [];

      const leadersL = uniq(leaders.map((x) => cleanEmail(x))).filter(Boolean);
      const adminsL = uniq(admins.map((x) => cleanEmail(x))).filter(Boolean);

      if (leadersL.includes(e)) return "Líder";
      if (adminsL.includes(e)) return "Admin";

      const playerEmail = cleanEmail(data.playerEmail);
      if (playerEmail && playerEmail === e) return "Jogador";
    }

    const g = await getDoc(doc(db, "guildas", guildId));
    if (g.exists()) {
      const gd = g.data() || {};
      const ownerEmail = cleanEmail(gd.ownerEmail);
      const ownerUid = (gd.ownerUid || "").toString().trim();
      if (ownerUid && ownerUid === auth.currentUser?.uid) return "Líder";
      if (ownerEmail && ownerEmail === e) return "Líder";
    }

    return "Membro";
  } catch {
    return "Membro";
  }
}

async function normalizeConfigGuilda(guildId) {
  try {
    const ref = doc(db, "configGuilda", guildId);
    const snap = await getDoc(ref);
    if (!snap.exists()) return;

    const data = snap.data() || {};
    const leaders = Array.isArray(data.leaders) ? data.leaders : [];
    const admins = Array.isArray(data.admins) ? data.admins : [];

    const leadersN = uniq(leaders.map((x) => cleanEmail(x))).filter(Boolean);
    const adminsN = uniq(admins.map((x) => cleanEmail(x))).filter(Boolean);
    const ownerEmailN = data.ownerEmail ? cleanEmail(data.ownerEmail) : null;

    const changed =
      JSON.stringify(leadersN) !== JSON.stringify(leaders) ||
      JSON.stringify(adminsN) !== JSON.stringify(admins) ||
      (data.ownerEmail ? ownerEmailN !== data.ownerEmail : false);

    if (!changed) return;

    await setDoc(ref, {
      ...(ownerEmailN ? { ownerEmail: ownerEmailN } : {}),
      leaders: leadersN,
      admins: adminsN,
      updatedAt: serverTimestamp()
    }, { merge: true });
  } catch (_) {}
}


// Bootstrap de primeira criação (signup): NÃO faz leituras antes, porque as regras
// podem bloquear read quando a guilda ainda não existe.
async function getSignupPromoDays() {
  try {
    const snap = await getDoc(doc(db, "novo", "Mnovo"));
    if (!snap.exists()) return 0;

    const data = snap.data() || {};
    const rawDays = data.dias;
    const parsed = parseInt(String(rawDays ?? "").trim(), 10);
    if (!Number.isFinite(parsed) || parsed <= 0) return 0;

    return Math.max(0, Math.floor(parsed));
  } catch (_) {
    return 0;
  }
}

async function bootstrapNewGuildAndUser(user, username, promoDays = 0) {
  const uid = user.uid;
  const email = cleanEmail(user.email);
  const uname = (username || "").toString().trim();
  const safePromoDays = (Number.isFinite(Number(promoDays)) && Number(promoDays) > 0)
    ? Math.floor(Number(promoDays))
    : 0;
  const promoExpiresAtMs = safePromoDays > 0 ? (Date.now() + (safePromoDays * 86400000)) : null;

  if (!uid) throw new Error("UID inválido.");
  if (!uname) throw new Error("Nome de guilda inválido.");

  const batch = writeBatch(db);

  // ✅ users/{uid}
  batch.set(doc(db, "users", uid), {
    uid,
    email,
    guildId: uid,
    role: "Líder",
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  }, { merge: true });

  // ✅ guildas/{uid}
  batch.set(doc(db, "guildas", uid), {
    name: uname || "Minha Guilda",
    ownerUid: uid,
    ownerEmail: email,
    ...(safePromoDays > 0 ? {
      vipTier: "pro",
      vipExpiresAt: promoExpiresAtMs
    } : {}),
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  }, { merge: true });

  // ✅ configGuilda/{uid}
  batch.set(doc(db, "configGuilda", uid), {
    ownerUid: uid,
    ownerEmail: email,
    tagMembros: "",
    leaders: email ? [email] : [],
    admins: [],
    ...(safePromoDays > 0 ? { permissoesAtivas: true } : {}),
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  }, { merge: true });

  await batch.commit();
  return { promoDays: safePromoDays, promoExpiresAtMs };
}

// Garantia leve (logins futuros do dono): não mexe no nome, só garante timestamps.
async function ensureOwnerDocsLight(user) {
  const uid = user.uid;
  if (!uid) return;

  const batch = writeBatch(db);
  batch.set(doc(db, "guildas", uid), { updatedAt: serverTimestamp() }, { merge: true });
  batch.set(doc(db, "configGuilda", uid), { updatedAt: serverTimestamp() }, { merge: true });
  batch.set(doc(db, "users", uid), { updatedAt: serverTimestamp() }, { merge: true });
  await batch.commit();
}

export async function finalizeSignup(user, username) {
  if (!user || !user.uid) throw new Error("Usuário inválido.");
  const uname = (username || "").toString().trim();
  if (!uname) throw new Error("Nome de usuário inválido.");

  const promoDays = await getSignupPromoDays();
  const signupResult = await bootstrapNewGuildAndUser(user, uname, promoDays);
  return {
    guildId: user.uid,
    promoDays: signupResult?.promoDays || 0,
    promoExpiresAtMs: signupResult?.promoExpiresAtMs ?? null
  };
}

export async function getMemberTagConfig(options = {}) {
  let guildId = null;
  try {
    guildId = requireGuildId();
  } catch (_) {
    return null;
  }

  const cacheKey = `tagMembros_${guildId}`;
  const cached = __readJsonCache(cacheKey);
  if (__shouldUseCache(cached, options) && cached?.value) {
    return String(cached.value);
  }

  try {
    const snap = await getDoc(doc(db, "configGuilda", guildId));
    if (!snap.exists()) {
      try { localStorage.removeItem(cacheKey); } catch (_) {}
      return null;
    }
    const data = snap.data() || {};
    const tag = (data.tagMembros || "").toString().trim();
    try {
      if (tag) __writeJsonCache(cacheKey, { value: tag });
      else localStorage.removeItem(cacheKey);
    } catch (_) {}
    return tag || null;
  } catch (e) {
    if (cached?.value) return String(cached.value);
    return null;
  }
}

export async function setMemberTagConfig(tag) {
  const clean = (tag || "").toString().trim();
  if (!clean) throw new Error("Tag inválida.");

  const guildId = requireGuildId();
  await setDoc(
    doc(db, "configGuilda", guildId),
    { tagMembros: clean, updatedAt: serverTimestamp() },
    { merge: true }
  );
  try { localStorage.setItem(`tagMembros_${guildId}`, JSON.stringify({ value: clean, ts: Date.now() })); } catch (_) {}
  return true;
}

const GG_GOAL_FIELDS = [
  ['metaGGRush', 'Rush'],
  ['metaGGCurandeiro', 'Curandeiro'],
  ['metaGGFullGas', 'Full Gás'],
  ['metaGGSuporte', 'Suporte'],
  ['metaGGFuzileiro', 'Fuzileiro'],
  ['metaGGCoringa', 'Coringa 🃏']
];

function __numberOrNull(value) {
  return (value != null && Number.isFinite(Number(value))) ? Math.max(0, Math.floor(Number(value))) : null;
}

function __normalizeGuildGoals(data = {}) {
  const legacyMetaGG = __numberOrNull(data.metaGG);
  const out = {
    metaGG: legacyMetaGG,
    metaHonra: __numberOrNull(data.metaHonra),
    metaLineGG: __numberOrNull(data.metaLineGG ?? data.metaLinesGG ?? data.lineMetaGG),
    metaLineHonra: __numberOrNull(data.metaLineHonra ?? data.metaLinesHonra ?? data.lineMetaHonra)
  };

  GG_GOAL_FIELDS.forEach(([field]) => {
    out[field] = __numberOrNull(data[field]);
    if (out[field] == null && legacyMetaGG != null) out[field] = legacyMetaGG;
  });

  out.metaGGByRole = {
    Rush: out.metaGGRush,
    Curandeiro: out.metaGGCurandeiro,
    'Full Gás': out.metaGGFullGas,
    Suporte: out.metaGGSuporte,
    Fuzileiro: out.metaGGFuzileiro,
    Coringa: out.metaGGCoringa,
    'Coringa 🃏': out.metaGGCoringa
  };

  return out;
}

export async function getGuildGoalsConfig(options = {}) {
  let guildId = null;
  try {
    guildId = requireGuildId();
  } catch (_) {
    return __normalizeGuildGoals({});
  }

  const cacheKey = `guildGoals_${guildId}`;
  const cached = __readJsonCache(cacheKey);
  if (__shouldUseCache(cached, options)) {
    return __normalizeGuildGoals(cached || {});
  }

  try {
    const snap = await getDoc(doc(db, "configGuilda", guildId));
    if (!snap.exists()) {
      const empty = __normalizeGuildGoals({});
      __writeJsonCache(cacheKey, empty);
      return empty;
    }
    const data = snap.data() || {};
    const goals = __normalizeGuildGoals(data);
    __writeJsonCache(cacheKey, goals);
    return goals;
  } catch (_) {
    if (cached) return __normalizeGuildGoals(cached || {});
    return __normalizeGuildGoals({});
  }
}

export async function setGuildGoalsConfig({
  metaGG = null,
  metaHonra = null,
  metaGGRush = null,
  metaGGCurandeiro = null,
  metaGGFullGas = null,
  metaGGSuporte = null,
  metaGGFuzileiro = null,
  metaGGCoringa = null,
  metaLineGG = null,
  metaLineHonra = null
} = {}) {
  const guildId = requireGuildId();
  const normalized = __normalizeGuildGoals({
    metaGG,
    metaHonra,
    metaGGRush,
    metaGGCurandeiro,
    metaGGFullGas,
    metaGGSuporte,
    metaGGFuzileiro,
    metaGGCoringa,
    metaLineGG,
    metaLineHonra
  });

  const payload = {
    metaGG: normalized.metaGGRush ?? normalized.metaGG,
    metaGGRush: normalized.metaGGRush,
    metaGGCurandeiro: normalized.metaGGCurandeiro,
    metaGGFullGas: normalized.metaGGFullGas,
    metaGGSuporte: normalized.metaGGSuporte,
    metaGGFuzileiro: normalized.metaGGFuzileiro,
    metaGGCoringa: normalized.metaGGCoringa,
    metaHonra: normalized.metaHonra,
    metaLineGG: normalized.metaLineGG,
    metaLineHonra: normalized.metaLineHonra,
    updatedAt: serverTimestamp()
  };

  await setDoc(doc(db, "configGuilda", guildId), payload, { merge: true });
  try { localStorage.setItem(`guildGoals_${guildId}`, JSON.stringify({ ...payload, metaGGByRole: normalized.metaGGByRole, ts: Date.now() })); } catch (_) {}
  return true;
}

export async function setGuildNameConfig(name) {
  const guildId = requireGuildId();
  const clean = (name || '').toString().trim();
  if (!clean) throw new Error('Nome da guilda inválido.');

  await Promise.all([
    setDoc(doc(db, "guildas", guildId), {
      name: clean,
      updatedAt: serverTimestamp()
    }, { merge: true }),
    setDoc(doc(db, "configGuilda", guildId), {
      name: clean,
      updatedAt: serverTimestamp()
    }, { merge: true })
  ]);

  try {
    const key = `guildInfo_${guildId}`;
    const raw = localStorage.getItem(key);
    const cached = raw ? (JSON.parse(raw) || {}) : {};
    localStorage.setItem(key, JSON.stringify({
      guildId,
      name: clean,
      createdAtMs: (cached.createdAtMs != null ? Number(cached.createdAtMs) : null),
      ts: Date.now()
    }));
  } catch (_) {}

  try {
    if (__guildCtx && __guildCtx.guildId === guildId) {
      __guildCtx.guildName = clean;
      localStorage.setItem(__GUILDCTX_LS_KEY, JSON.stringify({
        guildId: __guildCtx.guildId,
        guildName: clean,
        role: __guildCtx.role,
        vipTier: __guildCtx.vipTier,
        vipExpiresAtMs: __guildCtx.vipExpiresAtMs,
        email: __guildCtx.email,
        uid: __guildCtx.uid,
        isOwner: __guildCtx.isOwner === true || (String(__guildCtx.uid || '').trim() && String(__guildCtx.guildId || '').trim() && String(__guildCtx.uid || '').trim() === String(__guildCtx.guildId || '').trim()),
        cacheVersion: __GUILDCTX_CACHE_VERSION,
        ts: Date.now()
      }));
    }
  } catch (_) {}

  try {
    const cached = __readGuildMultiCache(guildId) || [];
    const slot1 = {
      slot: 1,
      nameField: 'name',
      tagField: 'tagMembros',
      name: clean,
      tag: Array.isArray(cached) ? ((cached.find((item) => Number(item?.slot) === 1)?.tag) || '') : '',
      exists: true
    };
    const rest = (Array.isArray(cached) ? cached : []).filter((item) => Number(item?.slot) !== 1);
    __writeGuildMultiCache(guildId, [slot1, ...rest].sort((a, b) => Number(a?.slot || 0) - Number(b?.slot || 0)));
  } catch (_) {}

  return true;
}


function __normalizeGuildSlot(slot) {
  const n = Math.floor(Number(slot));
  if (!Number.isFinite(n) || n < 1 || n > 4) throw new Error('Slot de guilda inválido.');
  return n;
}

function __slotField(base, slot) {
  return slot <= 1 ? base : `${base}${slot}`;
}

function __sanitizeOptionalText(value) {
  const clean = (value ?? '').toString().trim();
  return clean;
}

function __guildMultiCacheKey(guildId) {
  const gid = (guildId || '').toString().trim();
  return gid ? `guildMulti_${gid}` : '';
}

function __readGuildMultiCache(guildId) {
  try {
    const key = __guildMultiCacheKey(guildId);
    if (!key) return null;
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : null;
  } catch (_) {
    return null;
  }
}

function __guildMultiCacheTsKey(guildId) {
  const gid = (guildId || '').toString().trim();
  return gid ? `${__guildMultiCacheKey(gid)}_ts` : '';
}

function __readGuildMultiCacheTs(guildId) {
  try {
    const key = __guildMultiCacheTsKey(guildId);
    if (!key) return 0;
    return Number(localStorage.getItem(key) || 0) || 0;
  } catch (_) {
    return 0;
  }
}

function __writeGuildMultiCache(guildId, slots) {
  try {
    const key = __guildMultiCacheKey(guildId);
    if (!key) return;
    localStorage.setItem(key, JSON.stringify(Array.isArray(slots) ? slots : []));
    const tsKey = __guildMultiCacheTsKey(guildId);
    if (tsKey) localStorage.setItem(tsKey, String(Date.now()));
  } catch (_) {}
}


export async function getGuildMultiConfig(maxSlots = 4, options = {}) {
  if (typeof maxSlots === 'object' && maxSlots !== null) {
    options = maxSlots;
    maxSlots = 4;
  }

  const guildId = requireGuildId();
  const safeMax = Math.max(1, Math.min(4, Math.floor(Number(maxSlots) || 4)));
  const cachedSlots = __readGuildMultiCache(guildId);
  const cachedTs = __readGuildMultiCacheTs(guildId);

  if (options?.forceRefresh !== true && cachedSlots && cachedSlots.length && __cacheIsFresh({ ts: cachedTs }, options?.ttlMs ?? __SETTINGS_CACHE_TTL_MS)) {
    return cachedSlots.filter(Boolean).slice(0, safeMax);
  }

  let cfg = {};
  try {
    const snap = await getDoc(doc(db, "configGuilda", guildId));
    cfg = snap.exists() ? (snap.data() || {}) : {};
  } catch (_) {
    if (cachedSlots && cachedSlots.length) return cachedSlots.filter(Boolean).slice(0, safeMax);
    cfg = {};
  }

  let primaryName = (cfg.name || '').toString().trim();
  if (!primaryName) {
    try {
      const info = await getGuildInfoCached(guildId, options);
      primaryName = (info?.name || '').toString().trim();
    } catch (_) {
      primaryName = '';
    }
  }

  const primaryTag = (cfg.tagMembros || '').toString().trim();
  const slots = [];

  for (let slot = 1; slot <= safeMax; slot++) {
    const nameField = __slotField('name', slot);
    const tagField = __slotField('tagMembros', slot);
    const nameValue = slot === 1 ? primaryName : __sanitizeOptionalText(cfg[nameField]);
    const tagValue = slot === 1 ? primaryTag : __sanitizeOptionalText(cfg[tagField]);
    slots.push({
      slot,
      nameField,
      tagField,
      name: nameValue,
      tag: tagValue,
      exists: slot === 1 ? true : !!nameValue
    });
  }

  __writeGuildMultiCache(guildId, slots);
  return slots;
}

export async function addGuildSlotConfig(maxSlots = 4) {
  const guildId = requireGuildId();
  const safeMax = Math.max(2, Math.min(4, Math.floor(Number(maxSlots) || 4)));
  const existing = await getGuildMultiConfig(safeMax);

  const target = existing.find((item) => item.slot >= 2 && !item.exists);
  if (!target) throw new Error('Limite de guildas extras atingido.');

  const defaultName = `Nova guilda ${target.slot}`;
  const payload = {
    [target.nameField]: defaultName,
    [target.tagField]: '',
    updatedAt: serverTimestamp()
  };

  await setDoc(doc(db, "configGuilda", guildId), payload, { merge: true });

  const created = {
    slot: target.slot,
    nameField: target.nameField,
    tagField: target.tagField,
    name: defaultName,
    tag: '',
    exists: true
  };

  try {
    const next = existing.map((item) => Number(item?.slot) === target.slot ? created : item);
    __writeGuildMultiCache(guildId, next);
  } catch (_) {}

  return created;
}

export async function setGuildSlotConfig(slot, { name, tag } = {}) {
  const guildId = requireGuildId();
  const safeSlot = __normalizeGuildSlot(slot);
  const payload = { updatedAt: serverTimestamp() };
  let cleanNameForCache;
  let cleanTagForCache;

  if (name !== undefined) {
    const cleanName = __sanitizeOptionalText(name);
    if (!cleanName) throw new Error('Nome da guilda inválido.');
    cleanNameForCache = cleanName;

    if (safeSlot === 1) {
      await setGuildNameConfig(cleanName);
    } else {
      payload[__slotField('name', safeSlot)] = cleanName;
    }
  }

  if (tag !== undefined) {
    const cleanTag = __sanitizeOptionalText(tag);
    cleanTagForCache = cleanTag;
    payload[__slotField('tagMembros', safeSlot)] = cleanTag;
  }

  if (Object.keys(payload).length > 1) {
    await setDoc(doc(db, "configGuilda", guildId), payload, { merge: true });
  }

  if (safeSlot === 1 && tag !== undefined) {
    try {
      if (payload.tagMembros) {
        localStorage.setItem(`tagMembros_${guildId}`, JSON.stringify({ value: payload.tagMembros, ts: Date.now() }));
      } else {
        localStorage.removeItem(`tagMembros_${guildId}`);
      }
    } catch (_) {}
  }

  try {
    const cached = await getGuildMultiConfig(4);
    const next = cached.map((item) => {
      if (Number(item?.slot) !== safeSlot) return item;
      return {
        ...item,
        name: cleanNameForCache !== undefined ? cleanNameForCache : item.name,
        tag: cleanTagForCache !== undefined ? cleanTagForCache : item.tag,
        exists: true
      };
    });
    __writeGuildMultiCache(guildId, next);
  } catch (_) {}

  return true;
}

const GUILD_ACCESS_KEY_PREFIX = 'guildAccessKey_';
const GUILD_STATS_EXISTS_CACHE_PREFIX = 'guildStatsExists_';

function makeGuildAccessKey() {
  const random = Math.floor(100000000 + Math.random() * 900000000);
  return `ghub-${random}`;
}

function getGuildProfileCacheKey(guildId) {
  return `${GUILD_STATS_EXISTS_CACHE_PREFIX}${(guildId || '').toString().trim()}`;
}

function readGuildInfoFromLocalCache(guildId) {
  const gid = (guildId || '').toString().trim();
  if (!gid) return { guildId: null, name: null, createdAtMs: null, tag: '' };

  let name = null;
  let createdAtMs = null;
  let tag = '';

  try {
    const rawInfo = localStorage.getItem(`guildInfo_${gid}`);
    if (rawInfo) {
      const cached = JSON.parse(rawInfo) || {};
      name = cached.name ? String(cached.name) : null;
      createdAtMs = (cached.createdAtMs != null ? Number(cached.createdAtMs) : null);
    }
  } catch (_) {}

  try {
    const rawTag = localStorage.getItem(`tagMembros_${gid}`);
    if (rawTag) {
      const cached = JSON.parse(rawTag) || {};
      tag = cached.value ? String(cached.value) : '';
    }
  } catch (_) {}

  return { guildId: gid, name, createdAtMs, tag };
}

export async function getGuildAccessKeyConfig(options = {}) {
  let guildId = null;
  try {
    guildId = requireGuildId();
  } catch (_) {
    return null;
  }

  const cacheKey = `${GUILD_ACCESS_KEY_PREFIX}${guildId}`;
  const cached = __readJsonCache(cacheKey);
  if (__shouldUseCache(cached, options) && cached?.value) {
    return String(cached.value);
  }

  try {
    const snap = await getDoc(doc(db, 'configGuilda', guildId));
    if (!snap.exists()) {
      try { localStorage.removeItem(cacheKey); } catch (_) {}
      return null;
    }
    const data = snap.data() || {};
    const value = (data.guildAccessKey || '').toString().trim();
    try {
      if (value) __writeJsonCache(cacheKey, { value });
      else localStorage.removeItem(cacheKey);
    } catch (_) {}
    return value || null;
  } catch (_) {
    if (cached?.value) return String(cached.value);
    return null;
  }
}

export async function generateGuildAccessKey() {
  const guildId = requireGuildId();
  const cacheKey = `${GUILD_ACCESS_KEY_PREFIX}${guildId}`;

  try {
    const current = await getGuildAccessKeyConfig();
    if (current) return current;
  } catch (_) {}

  const value = makeGuildAccessKey();
  await setDoc(
    doc(db, 'configGuilda', guildId),
    { guildAccessKey: value, updatedAt: serverTimestamp() },
    { merge: true }
  );
  try { localStorage.setItem(cacheKey, JSON.stringify({ value, ts: Date.now() })); } catch (_) {}
  return value;
}

export function getCachedGuildProfileState(guildId) {
  const gid = (guildId || getGuildContext()?.guildId || '').toString().trim();
  if (!gid) return null;
  try {
    const raw = localStorage.getItem(getGuildProfileCacheKey(gid));
    if (!raw) return null;
    const cached = JSON.parse(raw);
    if (!cached || cached.exists == null) return null;
    return !!cached.exists;
  } catch (_) {
    return null;
  }
}

function writeCachedGuildProfileState(guildId, exists) {
  const gid = (guildId || '').toString().trim();
  if (!gid) return;
  try {
    localStorage.setItem(getGuildProfileCacheKey(gid), JSON.stringify({ exists: !!exists, ts: Date.now() }));
  } catch (_) {}
}

export async function getGuildProfileExists(options = {}) {
  const guildId = requireGuildId();
  const profileCacheKey = getGuildProfileCacheKey(guildId);
  const cachedProfile = __readJsonCache(profileCacheKey);
  if (options?.forceRefresh !== true && cachedProfile?.exists != null && __cacheIsFresh(cachedProfile, options?.ttlMs ?? __SETTINGS_CACHE_TTL_MS)) {
    return !!cachedProfile.exists;
  }

  try {
    const snap = await getDoc(doc(db, 'estatisticas', guildId));
    const exists = !!snap.exists();
    writeCachedGuildProfileState(guildId, exists);
    return exists;
  } catch (_) {
    const cached = getCachedGuildProfileState(guildId);
    return cached === true;
  }
}

export async function createGuildProfile() {
  const guildId = requireGuildId();
  const info = readGuildInfoFromLocalCache(guildId);
  const guildName = (info.name || getGuildContext()?.guildName || '').toString().trim();
  if (!guildName) throw new Error('Nome da guilda nao encontrado no cache.');

  const profileRef = doc(db, 'estatisticas', guildId);
  const existingProfile = await getDoc(profileRef);
  const nowMs = Date.now();
  const payload = {
    guildId,
    nomeGuilda: guildName,
    dataCriacao: (info.createdAtMs != null && isFinite(Number(info.createdAtMs))) ? Number(info.createdAtMs) : null,
    tag: (info.tag || '').toString().trim(),
    updatedAt: serverTimestamp(),
    updatedAtMs: nowMs
  };

  await setDoc(profileRef, payload, { merge: true });
  writeCachedGuildProfileState(guildId, true);
  return { alreadyExists: existingProfile.exists() };
}

export function showToast(type = "info", message = "", durationMs = 3000) {
  const containerId = "toast-container";
  let container = document.getElementById(containerId);
  if (!container) {
    container = document.createElement("div");
    container.id = containerId;
    container.className = "fixed top-4 right-4 z-[9999] flex flex-col gap-2";
    document.body.appendChild(container);
  }

  const toast = document.createElement("div");
  toast.className =
    "px-4 py-3 rounded-xl shadow-lg border text-sm font-medium flex items-start gap-2 max-w-[340px] " +
    (type === "success"
      ? "bg-emerald-50 text-emerald-800 border-emerald-200"
      : type === "error"
      ? "bg-red-50 text-red-800 border-red-200"
      : "bg-gray-900 text-white border-white/10");

  toast.innerHTML = `<div class="flex-1 leading-snug">${escapeHtml(message)}</div>`;
  container.appendChild(toast);

  const safeDurationMs = Math.max(1200, Math.min(10000, Number(durationMs) || 3000));
  const fadeDelayMs = Math.max(700, safeDurationMs - 400);

  setTimeout(() => {
    toast.style.opacity = "0";
    toast.style.transform = "translateY(-4px)";
    toast.style.transition = "all 180ms ease";
  }, fadeDelayMs);

  setTimeout(() => toast.remove(), safeDurationMs);
}

function escapeHtml(str) {
  return String(str)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function __flushOneTimeSignupToast() {
  try {
    if (typeof sessionStorage === "undefined") return;
    const message = sessionStorage.getItem("hub_signup_promo_toast");
    if (!message) return;
    sessionStorage.removeItem("hub_signup_promo_toast");
    showToast("success", message);
  } catch (_) {}
}

export async function createUpgradeSolicitacao(planId, payerName) {
  const user = auth.currentUser;
  if (!user) throw new Error("Você precisa estar logado para solicitar upgrade.");

  const plan = (planId || "").toString().toLowerCase().trim();
  if (!plan || plan === "free" || plan === "parceiro" || plan === "vitalicio" || plan.includes("/")) {
    throw new Error("Plano inválido.");
  }

  const name = (payerName || "").toString().trim();
  if (!name) throw new Error("Informe o nome real do pagador.");

  const email = cleanEmail(user.email);
  const uid = user.uid;
  const guildId = (__guildCtx && __guildCtx.guildId) ? String(__guildCtx.guildId) : null;

  await addDoc(collection(db, "solicita"), {
    email,
    uid,
    plano: plan,
    nomePagador: name,
    ...(guildId ? { guildId } : {}),
    status: "pendente",
    createdAt: serverTimestamp()
  });

  return true;
}



function __isPrivilegedGuildRole(roleValue) {
  const role = String(roleValue || '').trim();
  return role === "Admin" || role === "Líder";
}

function __vipAllowsSecondaryAccess(tierValue, expiresAtMs) {
  const tier = vipTierFromValue(tierValue || 'free');
  if (!tier || tier === 'free') return false;
  return true;
}

function __isCurrentUserGuildOwner(guildId, user, cfgData = {}, guildData = {}) {
  try {
    const uid = String(user?.uid || '').trim();
    const email = cleanEmail(user?.email || '');
    const gid = String(guildId || '').trim();

    if (uid && gid && uid === gid) return true;

    const cfgOwnerUid = String(cfgData?.ownerUid || '').trim();
    const guildOwnerUid = String(guildData?.ownerUid || '').trim();
    if (uid && (cfgOwnerUid === uid || guildOwnerUid === uid)) return true;

    const cfgOwnerEmail = cleanEmail(cfgData?.ownerEmail || '');
    const guildOwnerEmail = cleanEmail(guildData?.ownerEmail || '');
    if (email && (cfgOwnerEmail === email || guildOwnerEmail === email)) return true;
  } catch (_) {}

  return false;
}

function __emailStillHasPrivilegedAccess(cfgData = {}, emailLower = '', roleValue = '') {
  const email = cleanEmail(emailLower || '');
  const role = String(roleValue || '').trim();
  if (!email || !role) return false;

  const leaders = uniq((Array.isArray(cfgData?.leaders) ? cfgData.leaders : []).map(cleanEmail)).filter(Boolean);
  const admins = uniq((Array.isArray(cfgData?.admins) ? cfgData.admins : []).map(cleanEmail)).filter(Boolean);

  if (role === "Líder") return leaders.includes(email);
  if (role === "Admin") return admins.includes(email);
  return false;
}

function __emailHasAnyPrivilegedAccess(cfgData = {}, emailLower = '') {
  const email = cleanEmail(emailLower || '');
  if (!email) return false;

  const leaders = uniq((Array.isArray(cfgData?.leaders) ? cfgData.leaders : []).map(cleanEmail)).filter(Boolean);
  const admins = uniq((Array.isArray(cfgData?.admins) ? cfgData.admins : []).map(cleanEmail)).filter(Boolean);

  return leaders.includes(email) || admins.includes(email);
}

async function __downgradeOwnUserToPlayerAfterAccessRemoval(user, guildId, reason = 'access-removed') {
  try {
    const uid = String(user?.uid || '').trim();
    if (!uid) return false;

    await setDoc(doc(db, "users", uid), {
      role: "Jogador",
      guildId: deleteField(),
      removedGuildId: String(guildId || ''),
      accessRemovedReason: reason,
      accessRevokedAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    }, { merge: true });

    return true;
  } catch (_) {
    return false;
  }
}

function __clearAuthAndGuildCachesForCurrentUser(guildId = '') {
  try { clearSharedGuildContextCache(); } catch (_) {}
  try { localStorage.removeItem(__GUILDCTX_LS_KEY); } catch (_) {}
  try { __clearSecondaryAccessSessionValidation(); } catch (_) {}

  try {
    const gid = String(guildId || '').trim();
    if (!gid) return;

    localStorage.removeItem(`securityConfig_${gid}`);
    localStorage.removeItem(`guildInfo_${gid}`);
    localStorage.removeItem(`guildGoals_${gid}`);
    localStorage.removeItem(`tagMembros_${gid}`);
  } catch (_) {}
}

async function __logoutWithToast(message, guildId = '') {
  try { showToast("error", message || "Conta expirada"); } catch (_) {}
  try { __stopSecondaryAccessLiveWatch(); } catch (_) {}
  try { __clearAuthAndGuildCachesForCurrentUser(guildId); } catch (_) {}
  try { await signOut(auth); } catch (_) {}

  try {
    setTimeout(() => {
      try { window.location.href = "/"; } catch (_) {}
    }, 900);
  } catch (_) {
    try { window.location.href = "/"; } catch (_) {}
  }
}

let __secondaryVipLogoutInProgress = false;

function __stopSecondaryAccessLiveWatch() {
  // Mantido como no-op por compatibilidade com chamadas antigas.
  // Não abrimos listener extra aqui para não gerar leitura nova.
  __secondaryVipLogoutInProgress = false;
}

function __secondaryVipIsBlockedByCtx(ctx = {}) {
  try {
    if (!ctx || !ctx.guildId) return false;

    const role = String(ctx.role || '').trim();
    const uid = String(ctx.uid || '').trim();
    const gid = String(ctx.guildId || '').trim();
    const isOwner = ctx.isOwner === true || (!!uid && !!gid && uid === gid);
    if (!__isPrivilegedGuildRole(role) || isOwner) return false;

    const tier = vipTierFromValue(ctx.vipTier || 'free');
    const exp = (ctx.vipExpiresAtMs != null && isFinite(Number(ctx.vipExpiresAtMs))) ? Number(ctx.vipExpiresAtMs) : null;
    return !__vipAllowsSecondaryAccess(tier, exp);
  } catch (_) {
    return false;
  }
}

async function __logoutSecondaryIfVipBlockedFromCtx(ctx = {}) {
  try {
    if (__secondaryVipLogoutInProgress) return false;
    if (!__secondaryVipIsBlockedByCtx(ctx)) return false;

    const current = auth.currentUser;
    if (!current) return false;

    const expectedUid = String(ctx.uid || '').trim();
    if (expectedUid && String(current.uid || '').trim() !== expectedUid) return false;

    __secondaryVipLogoutInProgress = true;
    await __logoutWithToast('Conta expirada', ctx.guildId || '');
    return true;
  } catch (_) {
    return false;
  }
}

function __scheduleSecondaryVipLogoutFromCtx(ctx = {}) {
  try {
    if (!__secondaryVipIsBlockedByCtx(ctx)) return false;
    setTimeout(() => {
      try { __logoutSecondaryIfVipBlockedFromCtx(ctx); } catch (_) {}
    }, 0);
    return true;
  } catch (_) {
    return false;
  }
}

function __startSecondaryAccessLiveWatch(user, ctx = {}) {
  // Sem listener extra em configGuilda/guildas.
  // Se alguma tela já atualizar guildCtx_cache_v1/vipTier em tempo real,
  // este ponto só reaproveita esse valor em cache para derrubar secundários quando virar free.
  try {
    const nextCtx = {
      ...(ctx || {}),
      uid: String(user?.uid || ctx?.uid || ''),
      email: cleanEmail(ctx?.email || ctx?.emailLower || user?.email || '')
    };
    __scheduleSecondaryVipLogoutFromCtx(nextCtx);
  } catch (_) {}
}


function __isProtectedRouteAllowedByCachedCtx(ctx, isLoginPage) {
  try {
    if (!ctx || !ctx.guildId) return { allowed: false };

    const role = String(ctx.role || 'Membro');
    const path = (window.location.pathname || "").toLowerCase();
    const isAdminPage = path.endsWith("/admin") || path.endsWith("/admin.html") || path.includes("admin.html");
    const isMembersPage = path.endsWith("/membros") || path.endsWith("/membros.html") || path.includes("membros.html");
    const isDashboardPage = path.endsWith("/dashboard") || path.endsWith("/dashboard.html") || path.includes("/dashboard");
    const isSettingsPage = path.endsWith("/ajustes") || path.endsWith("/ajustes.html") || path.includes("ajustes.html");
    const isLinesPage = path.endsWith("/lines") || path.endsWith("/lines.html") || path.includes("lines.html");
    const isUpgradePage = path.endsWith("/upgrade") || path.endsWith("/upgrade.html") || path.includes("upgrade.html");
    const isChefePage = path.endsWith("/chefe") || path.endsWith("/chefe.html") || path.includes("chefe.html");
    const isRecruitmentPage =
      path.endsWith("/eventos") || path.endsWith("/eventos.html") || path.includes("eventos.html") ||
      path.endsWith("/recrutar") || path.endsWith("/recrutar.html") || path.includes("recrutar.html") ||
      path.endsWith("/recrutamento") || path.endsWith("/recrutamento.html") || path.includes("recrutamento.html") ||
      path.endsWith("/rec") || path.endsWith("/rec.html") || path.includes("rec.html") ||
      path.endsWith("/camp") || path.endsWith("/camp.html") || path.includes("camp.html");
    const isPlayerPage = path.endsWith("/jogador") || path.endsWith("/jogador.html") || path.includes("/jogador");

    if (isChefePage && ctx.isCeo !== true) return { allowed: false, redirectTo: '/dashboard' };

    if (role === "Jogador") {
      if (!isPlayerPage) return { allowed: false, redirectTo: '/jogador' };
      return { allowed: true };
    }

    if (role === "Admin") {
      if (isAdminPage) return { allowed: false, redirectTo: '/dashboard' };
      if (!isDashboardPage && !isMembersPage && !isSettingsPage && !isLinesPage && !isRecruitmentPage && !isUpgradePage) {
        return { allowed: false, redirectTo: '/dashboard' };
      }
    }

    // O fluxo original permite role "Membro" quando existe vínculo em /users.
    // Como o cache só é aceito quando tem guildId/uid válidos, não derrubamos aqui.
    return { allowed: true };
  } catch (_) {
    return { allowed: false };
  }
}

function __getUsableAuthContextFromCache(user) {
  try {
    const cached = getSharedGuildContextCache();
    if (!cached || !cached.guildId || !cached.uid || !cached.role) return null;
    if (!__cacheIsFresh(cached, __AUTH_CONTEXT_CACHE_TTL_MS)) return null;

    const userUid = String(user?.uid || '').trim();
    const userEmail = cleanEmail(user?.email || '');
    const cachedUid = String(cached.uid || '').trim();
    const cachedEmail = cleanEmail(cached.email || cached.emailLower || '');

    if (!userUid || cachedUid !== userUid) return null;
    if (userEmail && cachedEmail && cachedEmail !== userEmail) return null;

    const role = String(cached.role || 'Membro');

    // Admin/Líder secundário não revalidam em toda página, para não aumentar leituras.
    // Eles revalidam no login/início da sessão; depois a navegação usa cache de 24h.
    // Se vier de login=1 ou ainda não validou nesta sessão, força uma checagem real.
    if (__isPrivilegedGuildRole(role) && cached.isOwner !== true) {
      let isLoginFlow = false;
      try { isLoginFlow = new URLSearchParams(window.location.search || '').get('login') === '1'; } catch (_) {}
      if (isLoginFlow || !__hasSecondaryAccessSessionValidation(user, cached)) return null;
    }

    return {
      ...cached,
      role,
      email: cachedEmail || userEmail,
      emailLower: cachedEmail || userEmail,
      uid: userUid,
      isLeader: cached.isLeader === true || role === 'Líder',
      isAdmin: cached.isAdmin === true || role === 'Admin',
      isOwner: cached.isOwner === true
    };
  } catch (_) {
    return null;
  }
}

function __applyAuthContextFromCache(ctx, user) {
  const role = String(ctx.role || 'Membro');
  __guildCtx = {
    guildId: String(ctx.guildId),
    guildName: ctx.guildName ? String(ctx.guildName) : null,
    role,
    vipTier: ctx.vipTier ? String(ctx.vipTier) : 'free',
    vipExpiresAtMs: (ctx.vipExpiresAtMs != null ? Number(ctx.vipExpiresAtMs) : null),
    email: cleanEmail(ctx.email || ctx.emailLower || user?.email || ''),
    uid: String(user?.uid || ctx.uid || ''),
    isOwner: ctx.isOwner === true || (String(user?.uid || ctx.uid || '').trim() && String(ctx.guildId || '').trim() && String(user?.uid || ctx.uid || '').trim() === String(ctx.guildId || '').trim())
  };

  try {
    const ceoCached = readSharedJsonCache(__CEO_LS_KEY, null);
    const ceoEmail = cleanEmail(ceoCached?.email || ceoCached?.emailLower || '');
    const email = cleanEmail(__guildCtx.email || '');
    if (ceoCached && ceoEmail === email && __cacheIsFresh(ceoCached, __AUTH_CONTEXT_CACHE_TTL_MS)) {
      __isCeo = ceoCached.isCeo === true;
    } else if (typeof ctx.isCeo === 'boolean') {
      __isCeo = ctx.isCeo === true;
    }
  } catch (_) {}

  const emailEl = document.getElementById("user-email");
  if (emailEl) emailEl.textContent = user?.email || __guildCtx.email || "";
  const roleEl = document.getElementById("user-role");
  if (roleEl) roleEl.textContent = role;
  try { applyCachedSidebarProfile(user || __guildCtx?.uid); } catch (_) {}
  try { applyVipUiAndGates(__guildCtx.vipTier || 'free'); } catch (_) {}
  try { __scheduleSecondaryVipLogoutFromCtx(__guildCtx); } catch (_) {}
  try { applyCeoNavVisibility(); } catch (_) {}
}

export function checkAuth(redirectToLogin = true) {
  return new Promise((resolve) => {
    onAuthStateChanged(auth, async (user) => {
      const isLoginPage = /(^\/$)|(^\/index\/?$)|(^\/index\/index\.html$)|index\.html$/i.test(window.location.pathname || "");

      if (!user) {
        try { __stopSecondaryAccessLiveWatch(); } catch (_) {}
        if (redirectToLogin && !isLoginPage) window.location.href = "/";
        resolve(null);
        return;
      }

      const emailLower = cleanEmail(user.email);
      const emailEl = document.getElementById("user-email");
      if (emailEl) emailEl.textContent = user.email || "";

      // Caminho rápido: se o contexto da guilda ainda está fresco no cache,
      // evita reler /users, /configGuilda, /guildas e /chefe ao trocar de tela.
      const cachedCtx = __getUsableAuthContextFromCache(user);
      if (cachedCtx) {
        const routeCheck = __isProtectedRouteAllowedByCachedCtx(cachedCtx, isLoginPage);
        if (routeCheck.allowed) {
          __applyAuthContextFromCache(cachedCtx, user);
          try { __startSecondaryAccessLiveWatch(user, cachedCtx); } catch (_) {}
          try { __flushOneTimeSignupToast(); } catch (_) {}
          resolve(user);
          return;
        }
        if (routeCheck.redirectTo) {
          window.location.href = routeCheck.redirectTo;
          resolve(null);
          return;
        }
      }

      let guildId = null;
      let username = "";

      // 0) Primeiro tenta resolver pela coleção /users (mais rápida e evita logout indevido)
      let roleHint = null;
      let userProfile = null;
      try {
        const uSnap = await getDoc(doc(db, "users", user.uid));
        if (uSnap.exists()) {
          userProfile = uSnap.data() || {};
          try {
            cacheSidebarProfile(userProfile, user);
            applyCachedSidebarProfile(user);
          } catch (_) {}
          if (userProfile.guildId) guildId = String(userProfile.guildId);
          if (userProfile.role) roleHint = String(userProfile.role);
        }
      } catch (_) {}

      // Não fazemos mais busca por e-mail varrendo/consultando configGuilda.
      // Para evitar leituras desnecessárias, o guildId precisa vir de users/{uid}.

      // Se /users não trouxe guildId, só aceitamos como "dono" quando já existe configGuilda com id == uid.
      // Isso evita o bug de criar uma guilda nova ao logar com contas secundárias.
      if (!guildId) {
        try {
          const selfCfg = await getDoc(doc(db, "configGuilda", user.uid));
          if (selfCfg.exists()) guildId = user.uid;
        } catch (_) {}
      }

      // Se ainda não resolveu, a conta não está vinculada a nenhuma guilda -> não criar nada automaticamente.
      if (!guildId) {
        try { await signOut(auth); } catch (_) {}
        if (!isLoginPage) window.location.href = "/";
        resolve(null);
        return;
      }

      // Após o login: não tente ler antes de existir (regras podem bloquear).
      // Se for o dono (guildId === uid), apenas garante docs com merge sem mexer em nome.
      try {
        if (guildId === user.uid) {
          await ensureOwnerDocsLight(user);
        }
      } catch (e) {
        // Se falhar aqui, não derruba o login: isso é apenas uma garantia leve.
      }

      let role = null;

      // Se o /users já informa o role, usamos como base (e ainda tentamos confirmar via configGuilda).
      const hint = (roleHint || "").toString().trim();
      if (hint && ["Líder", "Admin", "Jogador"].includes(hint)) role = hint;

      const resolved = await resolveRoleInGuild(guildId, user.email || "");
      if (resolved && resolved !== "Membro") {
        role = resolved;
      } else if (!role) {
        role = resolved || "Membro";
      }

      // Importante: Admin/Líder secundário precisa estar na lista atual de configGuilda.
      // Não confiamos mais apenas no role salvo em users/{uid}, pois o e-mail pode ter sido removido.
      if (role === "Líder") {
        normalizeConfigGuilda(guildId);
      }

      const guildName = await getGuildName(guildId);

      let vipTier = 'free';
      let vipExpiresAtMs = null;
      let __cfgData = null;
      let __guildData = null;

      // Preferência: vipTier e vipExpiresAt vêm de /configGuilda/{guildId}
      try {
        const cfgSnap = await getDoc(doc(db, "configGuilda", guildId));
        if (cfgSnap.exists()) {
          const cfg = cfgSnap.data() || {};
          __cfgData = cfg;
          const rawVip = cfg.vipTier ?? cfg.vip ?? cfg.planoVip ?? cfg.planoVIP ?? cfg.vipLevel ?? cfg.vipPlano ?? cfg.vipName ?? cfg.plano ?? cfg.plan ?? cfg.tier;
          vipTier = vipTierFromValue(rawVip);

          // vipExpiresAt pode ser Timestamp, número (ms) ou string ISO — aceitamos qualquer um sem quebrar
          const rawExp = cfg.vipExpiresAt ?? cfg.vipExpiraEm ?? cfg.vipExpireAt ?? cfg.expiresAt ?? cfg.vipExpires;
          if (rawExp && typeof rawExp.toMillis === 'function') {
            vipExpiresAtMs = rawExp.toMillis();
          } else if (typeof rawExp === 'number') {
            vipExpiresAtMs = rawExp;
          } else if (typeof rawExp === 'string') {
            const t = Date.parse(rawExp);
            vipExpiresAtMs = isFinite(t) ? t : null;
          }
        }
      } catch (_) {}

      // Fallback: se configGuilda não tiver plano pago ou faltar expiração, tenta /guildas/{guildId}.
      // Importante: não sobrescreve um plano pago por free quando /guildas está vazio/desatualizado.
      if (!vipTier || vipTier === 'free' || vipExpiresAtMs == null) {
        try {
          const gSnap = await getDoc(doc(db, "guildas", guildId));
          if (gSnap.exists()) {
            const g = gSnap.data() || {};
            __guildData = g;
            const rawVip2 = g.vipTier ?? g.vip ?? g.planoVip ?? g.planoVIP ?? g.vipLevel ?? g.vipPlano ?? g.vipName ?? g.plano ?? g.plan ?? g.tier;
            const v2 = vipTierFromValue(rawVip2);
            if (v2 && (v2 !== 'free' || !vipTier || vipTier === 'free')) vipTier = v2;

            if (vipExpiresAtMs == null) {
              const rawExp2 = g.vipExpiresAt ?? g.vipExpiraEm ?? g.vipExpireAt ?? g.expiresAt ?? g.vipExpires;
              if (rawExp2 && typeof rawExp2.toMillis === 'function') {
                vipExpiresAtMs = rawExp2.toMillis();
              } else if (typeof rawExp2 === 'number') {
                vipExpiresAtMs = rawExp2;
              } else if (typeof rawExp2 === 'string') {
                const t2 = Date.parse(rawExp2);
                vipExpiresAtMs = isFinite(t2) ? t2 : null;
              }
            }
          }
        } catch (_) {}
      }


      // Se o /guildas não precisou ser lido para plano, ainda tentamos ler só o próprio doc
      // quando necessário para confirmar dono. Não consulta coleção inteira.
      if (!__guildData) {
        try {
          const gOwnerSnap = await getDoc(doc(db, "guildas", guildId));
          if (gOwnerSnap.exists()) __guildData = gOwnerSnap.data() || {};
        } catch (_) {}
      }

      // O navegador nao grava downgrade de plano no Firebase.
      // A expiracao deve ser aplicada por servidor/painel, evitando erro por relogio/cache local.



// (VIP) Sincroniza o campo único que libera/bloqueia Admin e Líder secundário
let __permissoesAtivas = null;
const __planoPermiteSecundarios = __vipAllowsSecondaryAccess(vipTier, vipExpiresAtMs);
try {
  __permissoesAtivas = await __syncPermissoesAtivasIfNeeded(guildId, __cfgData, vipTier, vipExpiresAtMs);

  // Se a escrita do campo permissoesAtivas falhar por regra, ainda assim a decisão
  // local precisa seguir o plano real. Free/expirado nunca libera secundários.
  if (!__planoPermiteSecundarios) {
    __permissoesAtivas = false;
  } else if (__permissoesAtivas == null) {
    // Plano ativo libera secundários mesmo se o campo permissoesAtivas estiver ausente/desatualizado.
    // O campo continua sendo sincronizado quando as regras permitirem.
    __permissoesAtivas = true;
  }
} catch (_) {
  __permissoesAtivas = !!__planoPermiteSecundarios;
}

const __isOwner = __isCurrentUserGuildOwner(guildId, user, __cfgData || {}, __guildData || {});
const __hintWasPrivileged = __isPrivilegedGuildRole(hint);
const __roleIsPrivileged = __isPrivilegedGuildRole(role);

// Se o e-mail foi removido de Admin/Líder, a própria conta rebaixa sozinha.
// Não fazemos busca em users; só atualizamos o próprio users/{uid}.
try {
  if (!__isOwner && __hintWasPrivileged) {
    const stillHasHintAccess = __emailHasAnyPrivilegedAccess(__cfgData || {}, emailLower);
    if (!stillHasHintAccess) {
      await __downgradeOwnUserToPlayerAfterAccessRemoval(user, guildId, 'removed-from-configGuilda');
      await __logoutWithToast("Seu acesso a esta guilda foi removido.", guildId);
      resolve(null);
      return;
    }
  }
} catch (_) {}

// (VIP) Se estiver bloqueado: derruba Admin e Líder secundário (o dono continua)
try {
  const permissoesAtivas = (__permissoesAtivas == null) ? true : !!__permissoesAtivas;

  if (!permissoesAtivas) {
    const isSecondaryLeader = (role === "Líder" && !__isOwner);
    const isAdmin = (role === "Admin");
    if (isSecondaryLeader || isAdmin || (__hintWasPrivileged && !__isOwner)) {
      await __logoutWithToast("Conta expirada", guildId);
      resolve(null);
      return;
    }
  }
} catch (_) {}

try {
  if (__roleIsPrivileged && !__isOwner) {
    __markSecondaryAccessSessionValidated(user, guildId, emailLower);
  }
} catch (_) {}

      __guildCtx = {
        guildId,
        guildName,
        role,
        vipTier,
        vipExpiresAtMs,
        email: emailLower,
        uid: user.uid,
        isOwner: __isOwner === true
      };

      let __ceoOkForCache = false;
      try { __ceoOkForCache = await __refreshCeoStatus(emailLower); } catch (_) {}
      try {
        setSharedGuildContextCache({ guildId, guildName, role, vipTier, vipExpiresAtMs, email: emailLower, uid: user.uid, isOwner: __isOwner === true, isCeo: __ceoOkForCache });
      } catch (_) {}
      try { __startSecondaryAccessLiveWatch(user, __guildCtx); } catch (_) {}
      try { applyVipUiAndGates(vipTier); } catch (_) {}
      try { applyCeoNavVisibility(); } catch (_) {}


      const roleEl = document.getElementById("user-role");
      if (roleEl) roleEl.textContent = role;

      const path = (window.location.pathname || "").toLowerCase();
      const isAdminPage = path.endsWith("/admin") || path.endsWith("/admin.html") || path.includes("admin.html");
      const isMembersPage = path.endsWith("/membros") || path.endsWith("/membros.html") || path.includes("membros.html");
      const isDashboardPage = path.endsWith("/dashboard") || path.endsWith("/dashboard.html") || path.includes("/dashboard");
      const isSettingsPage = path.endsWith("/ajustes") || path.endsWith("/ajustes.html") || path.includes("ajustes.html");
      const isLinesPage = path.endsWith("/lines") || path.endsWith("/lines.html") || path.includes("lines.html");
      const isUpgradePage = path.endsWith("/upgrade") || path.endsWith("/upgrade.html") || path.includes("upgrade.html");
      const isChefePage = path.endsWith("/chefe") || path.endsWith("/chefe.html") || path.includes("chefe.html");
      const isRecruitmentPage =
        path.endsWith("/eventos") || path.endsWith("/eventos.html") || path.includes("eventos.html") ||
        path.endsWith("/recrutar") || path.endsWith("/recrutar.html") || path.includes("recrutar.html") ||
        path.endsWith("/recrutamento") || path.endsWith("/recrutamento.html") || path.includes("recrutamento.html") ||
        path.endsWith("/rec") || path.endsWith("/rec.html") || path.includes("rec.html") ||
        path.endsWith("/camp") || path.endsWith("/camp.html") || path.includes("camp.html");

      // (Fix) Algumas versões antigas tinham uma tela "camp". Aqui garantimos que a variável exista
      // para não quebrar o fluxo quando o role for "Admin".
      const isCampPage = path.endsWith("/camp") || path.endsWith("/camp.html") || path.includes("camp.html");

      if (role === "Membro") {
        // Se users/{uid} ainda diz Admin/Líder, mas configGuilda não confirma mais,
        // a conta já foi tratada acima como acesso removido. Não deixa seguir com cache/role antigo.
        if (__hintWasPrivileged && !__isOwner) {
          await __downgradeOwnUserToPlayerAfterAccessRemoval(user, guildId, 'privileged-role-not-confirmed');
          await __logoutWithToast("Seu acesso a esta guilda foi removido.", guildId);
          resolve(null);
          return;
        }

        // Só derruba o login quando NÃO existe vínculo em /users e o papel realmente não foi reconhecido.
        const hasUserLink = !!(userProfile && userProfile.guildId);
        const hint = (roleHint || "").toString().trim();
        if (!hasUserLink && (!hint || hint === "Membro")) {
          try { await signOut(auth); } catch (_) {}
          if (!isLoginPage) window.location.href = "/";
          resolve(null);
          return;
        }
      }

      if (isChefePage && !__isCeo) {
        window.location.href = "/dashboard";
        resolve(null);
        return;
      }

      
      if (role === "Jogador") {
        const isPlayerPage = path.endsWith("/jogador") || path.endsWith("/jogador.html") || path.includes("/jogador");
        if (!isPlayerPage) {
          window.location.href = "/jogador";
          resolve(null);
          return;
        }
        resolve(user);
        return;
      }

      if (role === "Admin") {
        if (isAdminPage) {
          window.location.href = "/dashboard";
          resolve(null);
          return;
        }
        if (!isDashboardPage && !isMembersPage && !isSettingsPage && !isLinesPage && !isRecruitmentPage && !isUpgradePage) {
          window.location.href = "/dashboard";
          resolve(null);
          return;
        }
      }

      try { __flushOneTimeSignupToast(); } catch (_) {}
      resolve(user);
    });
  });
}


function normalizeVipTier(v) {
  const s = (v || '').toString().toLowerCase().trim();
  if (s.includes('vital') || s.includes('life') || s.includes('parceiro') || s.includes('partner')) return 'parceiro';
  if (s.includes('ultra')) return 'ultra';
  if (s.includes('buss') || s.includes('business')) return 'business';
  if (s.includes('pro')) return 'pro';
  if (s.includes('plus')) return 'plus';
  return s || 'free';
}

function __setDisabled(btn, disabled, reasonText) {
  if (!btn) return;
  btn.disabled = !!disabled;
  btn.classList.toggle("opacity-50", !!disabled);
  btn.classList.toggle("cursor-not-allowed", !!disabled);
  if (disabled) {
    btn.setAttribute("aria-disabled", "true");
    if (reasonText) btn.setAttribute("title", reasonText);
  } else {
    btn.removeAttribute("aria-disabled");
  }
}

function __setLockedLabel(btn, labelText) {
  if (!btn) return;
  btn.dataset.originalHtml = btn.dataset.originalHtml || btn.innerHTML;
  btn.innerHTML = `<span class="inline-flex items-center gap-2"><i data-lucide="lock" class="w-4 h-4"></i><span class="font-extrabold tracking-wide">${labelText}</span></span>`;
  try { if (window.lucide && typeof window.lucide.createIcons === "function") window.lucide.createIcons(); } catch (_) {}
}

function __restoreLabel(btn) {
  if (!btn) return;
  if (btn.dataset.originalHtml) btn.innerHTML = btn.dataset.originalHtml;
  try { if (window.lucide && typeof window.lucide.createIcons === "function") window.lucide.createIcons(); } catch (_) {}
}

function __ensureVipTagsIndex() {
  try {
    document.querySelectorAll("span").forEach((sp) => {
      if (sp.closest && sp.closest("#vip-label")) return;
      if (sp.dataset && sp.dataset.vipTag) return;
      const t = (sp.textContent || "").trim().toUpperCase();
      if (t === "PLUS") sp.dataset.vipTag = "plus";
      if (t === "PRO") sp.dataset.vipTag = "pro";
    });
  } catch (_) {}
}

export function applyVipUiAndGates(tierRaw) {
  const tier = normalizeVipTier(tierRaw || getVipTier());
  try {
    if (__guildCtx) {
      __guildCtx.vipTier = tier;
      __scheduleSecondaryVipLogoutFromCtx(__guildCtx);
    }
  } catch (_) {}

  const vipLabel = document.getElementById("vip-label");
  if (vipLabel) {
    const days = getVipRemainingDays();
    const daysTxt = (tier !== 'free' && tier !== 'parceiro' && days != null) ? ` • ${days} dias` : '';
    vipLabel.innerHTML = `Guilda: <span class="font-bold text-gray-800">${tier.toUpperCase()}${daysTxt}</span>`;
  }

  __ensureVipTagsIndex();
  const showPlusTags = tier === "free";
  const showProTags = (tier !== "pro" && tier !== "business" && tier !== "ultra" && tier !== "parceiro");
  document.querySelectorAll("[data-vip-tag]").forEach((el) => {
    const tag = (el.dataset.vipTag || "").toLowerCase();
    if (tag === "plus") el.style.display = showPlusTags ? "" : "none";
    if (tag === "pro") el.style.display = showProTags ? "" : "none";
  });

  const isPlusOrPro = tier !== "free";
  const isPro = (tier === "pro" || tier === "business" || tier === "ultra" || tier === "parceiro");

  __setDisabled(document.getElementById("btn-add-admin"), !isPlusOrPro, "Recurso PLUS");
  __setDisabled(document.getElementById("btn-add-leader"), !isPlusOrPro, "Recurso PLUS");

  const __btnNewLine = document.getElementById("btn-new-line");
  const __btnSaveLine = document.getElementById("btn-save-line");

  if (__btnNewLine) {
    __setDisabled(__btnNewLine, false);
    __restoreLabel(__btnNewLine);
  }

  if (__btnSaveLine) {
    __setDisabled(__btnSaveLine, !isPlusOrPro, "Recurso PLUS");
    if (!isPlusOrPro) __setLockedLabel(__btnSaveLine, "PLUS");
    else __restoreLabel(__btnSaveLine);
  }

  __setDisabled(document.getElementById("btn-new-camp"), !isPro, "Recurso PRO (BETA)");
}

(function __vipAutoApply() {
  try {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", () => applyVipUiAndGates(getVipTier()));
    } else {
      applyVipUiAndGates(getVipTier());
    }
  } catch (_) {}
})();

function __ensurePlayerAlertsNavLink() {
  const sidebar = document.getElementById("sidebar");
  const nav = sidebar?.querySelector("nav");
  if (!nav || nav.querySelector('[data-player-alerts-nav="true"]')) return;

  const path = String(window.location.pathname || "").toLowerCase();
  const active = path.includes("/alertagd") || path.includes("/alertajg");
  const linesLink = nav.querySelector('a[href="/lines"], a[href="/lines/"], a[href="/lines.html"]');
  if (!linesLink) return;
  const link = document.createElement("a");

  link.href = "/alertagd";
  link.dataset.playerAlertsNav = "true";
  link.className = active
    ? "flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-semibold bg-amber-50 text-amber-700 ring-1 ring-amber-100"
    : "flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-semibold text-gray-600 hover:bg-gray-50 hover:text-gray-900 transition-colors";
  link.innerHTML = '<i data-lucide="shield-alert" class="w-5 h-5"></i><span>Alertas de jogadores</span>';

  linesLink.insertAdjacentElement("afterend", link);
  try { initIcons(); } catch (_) {}
}

export function setupSidebar() {
  const sidebar = document.getElementById("sidebar");
  const overlay = document.getElementById("sidebar-overlay");
  const btn = document.getElementById("mobile-menu-btn");

  try { __applyCachedSidebarNow(); } catch (_) {}
  try { __ensurePlayerAlertsNavLink(); } catch (_) {}

  if (!sidebar || !overlay || !btn) return;

  const open = () => {
    sidebar.classList.remove("-translate-x-full");
    overlay.classList.remove("hidden");
  };

  const close = () => {
    sidebar.classList.add("-translate-x-full");
    overlay.classList.add("hidden");
  };

  btn.addEventListener("click", open);
  overlay.addEventListener("click", close);

  sidebar.querySelectorAll("a[href]").forEach((a) => {
    a.addEventListener("click", () => {
      if (window.innerWidth < 1024) close();
    });
  });

  if (window.innerWidth < 1024) {
    sidebar.classList.add("-translate-x-full");
    overlay.classList.add("hidden");
  }
}

export function initIcons() {
  try {
    if (window.lucide && typeof window.lucide.createIcons === "function") {
      window.lucide.createIcons();
    }
  } catch (_) {}
}

export async function logout() {
  try {
    await signOut(auth);
  } finally {
    try {
      __clearSecondaryAccessSessionValidation();
      localStorage.removeItem(__GUILDCTX_LS_KEY);
      localStorage.removeItem("membersList");
      localStorage.removeItem("dashboard_stats");
      localStorage.removeItem("campsList");
      for (let i = localStorage.length - 1; i >= 0; i--) {
        const k = localStorage.key(i) || "";
        if (k.startsWith("securityConfig_") || k.startsWith("tagMembros_")) {
          localStorage.removeItem(k);
        }
      }
    } catch (_) {}
    window.location.href = "/";
  }
}

export function showWelcomeLoginModal() {
  try {
    const params = new URLSearchParams(window.location.search || "");
    if (params.get("login") !== "1") return false;

    const overlay = document.getElementById("welcome-overlay");
    const modal = document.getElementById("welcome-modal");
    const closeBtn = document.getElementById("welcome-close");

    if (!overlay || !modal || !closeBtn) return false;
    if (modal.dataset.bound === "1") return true;

    const close = () => {
      modal.classList.remove("show");
      overlay.classList.remove("show");
      modal.setAttribute("aria-hidden", "true");
      document.documentElement.classList.remove("overflow-hidden");
      setTimeout(() => {
        modal.classList.add("hidden");
        overlay.classList.add("hidden");
      }, 240);
    };

    modal.dataset.bound = "1";
    closeBtn.addEventListener("click", close);
    overlay.addEventListener("click", close);
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && !modal.classList.contains("hidden")) close();
    });

    overlay.classList.remove("hidden");
    modal.classList.remove("hidden");
    modal.setAttribute("aria-hidden", "false");
    document.documentElement.classList.add("overflow-hidden");
    requestAnimationFrame(() => {
      overlay.classList.add("show");
      modal.classList.add("show");
    });

    try { initIcons(); } catch (_) {}
    return true;
  } catch (_) {
    return false;
  }
}

export function consumeLoginToasts() {
  try {
    const params = new URLSearchParams(window.location.search || "");
    if (params.get("login") !== "1") return;

    const email = (document.getElementById("user-email")?.textContent || auth.currentUser?.email || "").trim();
    const role = (document.getElementById("user-role")?.textContent || "Membro").trim();

    showToast("success", "Login realizado com sucesso!");
    showToast("info", `Perfil: ${role} • ${email}`);

    params.delete("login");
    const qs = params.toString();
    const newUrl = window.location.pathname + (qs ? `?${qs}` : "") + (window.location.hash || "");
    history.replaceState({}, "", newUrl);
  } catch (e) {}
}

export async function cleanupFailedUserAccount(idToken, opts = {}) {
  const token = String(idToken || '').trim();
  if (!token) return { ok: false, skipped: true, error: 'missing-token' };

  const payload = {
    reason: String(opts?.reason || 'admin-access-create-failed').slice(0, 160),
    ...(opts?.uid ? { guildId: String(opts.uid) } : {}),
    ...(opts?.gameId ? { gameId: String(opts.gameId) } : {})
  };

  const urls = [
    '/api/signup_cleanup_failed',
    './api/signup_cleanup_failed',
    '/api/signup_cleanup_failed.js',
    './api/signup_cleanup_failed.js'
  ];

  let lastError = null;
  for (const url of urls) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify(payload)
      });

      let data = null;
      try { data = await res.json(); } catch (_) { data = null; }

      if (res.ok && data?.ok !== false) return data || { ok: true };
      lastError = new Error(data?.error || `cleanup-failed-${res.status}`);

      // Se a rota não existir com este formato, tenta o próximo caminho.
      if (res.status === 404) continue;
      break;
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError || new Error('cleanup-failed');
}

export async function ensureUserAccount(email, password, opts = {}) {
  const e = cleanEmail(email);
  if (!e) throw new Error("E-mail inválido.");

  const methods = await fetchSignInMethodsForEmail(auth, e);
  if (methods && methods.length) {
    // Conta já existe.
    return { created: false, uid: null };
  }

  if (!password || String(password).length < 6) {
    throw new Error("Conta não existe. Informe uma senha (mínimo 6 caracteres) para criar.");
  }

  const secondaryName = "secondary_" + Date.now();
  const secondaryApp = initializeApp(firebaseConfig, secondaryName);
  const secondaryAuth = getAuth(secondaryApp);

  try {
    const cred = await createUserWithEmailAndPassword(secondaryAuth, e, password);
    const uid = cred.user.uid;
    const cleanupToken = await cred.user.getIdToken(true).catch(() => '');

    // Se foi criado a partir do Admin (conta secundária), cria/atualiza também em /users/{uid}
    // para o login conseguir resolver a guilda pelo documento do usuário.
    try {
      const guildId = opts && opts.guildId ? String(opts.guildId) : null;
      const role = opts && opts.role ? String(opts.role) : null;
      if (guildId) {
        await setDoc(doc(db, "users", uid), {
          email: e,
          guildId,
          role: role || "Membro",
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp()
        }, { merge: true });
      }
    } catch (_) {}

    return { created: true, uid, cleanupToken };
  } finally {
    try { await signOut(secondaryAuth); } catch (_) {}
    try { await deleteApp(secondaryApp); } catch (_) {}
  }
}

export async function createPlayer_DISABLED_BETAAccess(guildId, email, password) {
  if (!guildId) throw new Error("GuildId inválido.");
  email = cleanEmail(email || "");
  if (!email) throw new Error("Informe um e-mail válido para o Jogador.");

  if (!password || String(password).length < 6) {
    throw new Error("Defina uma senha com no mínimo 6 caracteres.");
  }

  const secondaryName = "secondary_player_" + Date.now();
  const secondaryApp = initializeApp(firebaseConfig, secondaryName);
  const secondaryAuth = getAuth(secondaryApp);

  try {
    const cred = await createUserWithEmailAndPassword(secondaryAuth, email, password);
    const uid = cred.user.uid;

    await setDoc(doc(db, "configGuilda", guildId), {
      playerEmail: email,
      playerEnabled: true,
      playerCreatedAt: serverTimestamp()
    }, { merge: true });

    return { email, uid };
  } finally {
    try { await signOut(secondaryAuth); } catch (_) {}
    try { await deleteApp(secondaryApp); } catch (_) {}
  }
}

export async function revokePlayerAccess(guildId) {
  if (!guildId) throw new Error("GuildId inválido.");
  await setDoc(doc(db, "configGuilda", guildId), {
    playerEmail: null,
    playerEnabled: false,
    playerRevokedAt: serverTimestamp()
  }, { merge: true });
  return true;
}

export async function deletePlayerAccount(playerEmail, password) {
  const email = cleanEmail(playerEmail);
  if (!email) throw new Error("E-mail inválido.");
  if (!password || String(password).length < 6) throw new Error("Informe a senha do jogador (mínimo 6).");

  const secondaryName = "secondary_delete_" + Date.now();
  const secondaryApp = initializeApp(firebaseConfig, secondaryName);
  const secondaryAuth = getAuth(secondaryApp);

  try {
    const { signInWithEmailAndPassword } = await import("https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js");
    const cred = await signInWithEmailAndPassword(secondaryAuth, email, password);
    const uid = cred.user.uid;

    await cred.user.delete();

    return { deleted: true };
  } finally {
    try { await signOut(secondaryAuth); } catch (_) {}
    try { await deleteApp(secondaryApp); } catch (_) {}
  }
}
