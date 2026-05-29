// inicio.js — JS exclusivo da tela index.html

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getAuth,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  getFirestore,
  doc,
  getDoc,
  setDoc,
  writeBatch,
  serverTimestamp,
  collection,
  query,
  where,
  getDocs,
  limit
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyC7UJxBOViZj8ELjw-Xvy645QYfDfpBzxM",
  authDomain: "guilda-hubb.firebaseapp.com",
  projectId: "guilda-hubb",
  storageBucket: "guilda-hubb.firebasestorage.app",
  messagingSenderId: "117135418619",
  appId: "1:117135418619:web:e8ca8ec52eb0eeeff87c5e",
  measurementId: "G-9CHV67E64Y"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

const qs = (id) => document.getElementById(id);
const cleanEmail = (email) => String(email || '').trim().toLowerCase();
const normalizeDigits = (v) => String(v ?? '').replace(/\D+/g, '');

function validateSignupEmailDomain(email) {
  const clean = cleanEmail(email);
  return /^[a-z0-9._%+-]+@(gmail\.com|yahoo\.com)$/.test(clean);
}

function validateSignupPasswordValue(password) {
  const pass = String(password || '');
  if (pass.length < 6) return 'A senha precisa ter pelo menos 6 caracteres.';
  if (/\s/.test(pass)) return 'A senha não pode conter espaços.';
  if (!/^[A-Za-z0-9?.!#@_]+$/.test(pass)) {
    return 'A senha só pode usar letras, números e estes caracteres: ? . ! # @ _';
  }
  return '';
}

function normalizeSignupPasswordInput(value) {
  return String(value || '').replace(/\s+/g, '').replace(/[^A-Za-z0-9?.!#@_]/g, '');
}
const PARTNER_REF_KEY = 'ghub_partner_ref';

function safeStorageGet(key) {
  try {
    const value = localStorage.getItem(key);
    if (value) return value;
  } catch (_) {}

  try {
    return sessionStorage.getItem(key) || '';
  } catch (_) {
    return '';
  }
}

function safeStorageSet(key, value) {
  const clean = String(value || '').trim();
  if (!clean) return;

  try { localStorage.setItem(key, clean); } catch (_) {}
  try { sessionStorage.setItem(key, clean); } catch (_) {}
}

function safeStorageRemove(key) {
  try { localStorage.removeItem(key); } catch (_) {}
  try { sessionStorage.removeItem(key); } catch (_) {}
}

function sanitizePartnerRef(value) {
  return String(value || '').trim().replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 80);
}

function getStoredPartnerRef() {
  return sanitizePartnerRef(safeStorageGet(PARTNER_REF_KEY));
}

function capturePartnerRefFromUrl() {
  try {
    const ref = sanitizePartnerRef(new URLSearchParams(window.location.search || '').get('ref'));
    if (ref) safeStorageSet(PARTNER_REF_KEY, ref);
  } catch (_) {}
}

function decorateInternalLinksWithPartnerRef() {
  try {
    const ref = getStoredPartnerRef();
    if (!ref) return;

    document.querySelectorAll('a[href]').forEach((link) => {
      const rawHref = String(link.getAttribute('href') || '').trim();
      if (!rawHref || rawHref.startsWith('#') || rawHref.startsWith('javascript:') || rawHref.startsWith('mailto:') || rawHref.startsWith('tel:')) return;
      if (/^https?:\/\//i.test(rawHref) && !rawHref.startsWith(window.location.origin)) return;
      if (rawHref.includes('/api/') || rawHref.match(/\.(png|jpg|jpeg|webp|gif|svg|css|js)(\?|$)/i)) return;

      const url = new URL(rawHref, window.location.origin);
      if (url.origin !== window.location.origin) return;
      if (!url.searchParams.get('ref')) url.searchParams.set('ref', ref);

      link.setAttribute('href', `${url.pathname}${url.search}${url.hash}`);
    });
  } catch (_) {}
}

function withStoredPartnerRef(urlValue) {
  try {
    const ref = getStoredPartnerRef();
    const raw = String(urlValue || '').trim();
    if (!raw || !ref) return raw;
    const url = new URL(raw, window.location.origin);
    if (url.origin !== window.location.origin) return raw;
    if (!url.searchParams.get('ref')) url.searchParams.set('ref', ref);
    return `${url.pathname.replace(/^\//, '')}${url.search}${url.hash}`;
  } catch (_) {
    return String(urlValue || '');
  }
}

function getPartnerRefForOwnerSignup(user, gameId) {
  const ref = getStoredPartnerRef();
  const uid = String(user?.uid || '').trim();

  if (!ref || !uid || !gameId) return '';
  if (ref === uid || ref === gameId) return '';
  return ref;
}

function buildConfigGuildReferralPayload(ref, user, gameId) {
  const uid = String(user?.uid || '').trim();
  if (!ref || !uid || !gameId) return {};

  const nowMs = Date.now();
  return {
    indicadoPorParceiro: ref,
    parceiroRef: ref,
    indicadoPorEmMs: nowMs,
    indicadoPorEm: serverTimestamp(),
    referralGuildUid: uid,
    referralOwnerUid: uid,
    referralOwnerGameId: gameId,
    comissaoParceiroUsada: false,
    comissaoParceiroCreditada: false
  };
}

async function bindPartnerReferralAfterSignup(user, gameId, guildId, explicitRef = '') {
  const ref = sanitizePartnerRef(explicitRef) || getStoredPartnerRef();
  if (!user || !gameId || !guildId || !ref) return { ok: true, skipped: true };

  const idToken = await user.getIdToken(true);
  const res = await fetch('/api/monetize_bind_referral', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${idToken}`
    },
    body: JSON.stringify({ ref, gameId, guildId })
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok || data?.ok !== true || (data?.linked !== true && data?.alreadyLinked !== true)) {
    const err = new Error(data?.error || 'referral-bind-failed');
    err.code = 'referral-bind-failed';
    err.details = data;
    throw err;
  }

  // Não removemos o ref do storage: isso preserva o rastreio se a pessoa for ao dashboard
  // e depois voltar para a tela inicial durante o mesmo fluxo.
  return data;
}

async function cleanupFailedSignup(user, { gameId = '', guildId = '', ref = '', reason = 'signup-failed' } = {}) {
  try {
    if (!user) return;
    const idToken = await user.getIdToken(true);
    await fetch('/api/signup_cleanup_failed', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${idToken}`
      },
      body: JSON.stringify({ gameId, guildId: guildId || user.uid, ref, reason })
    });
  } catch (error) {
    console.warn('[signup-cleanup]', error);
  }
}

async function verifySignupCreation(user, { gameId = '', isOwner = false } = {}) {
  const uid = String(user?.uid || '').trim();
  const gid = String(gameId || '').trim();
  if (!uid || !gid) throw new Error('signup-incomplete');

  const userSnap = await getDoc(doc(db, 'users', gid));
  if (!userSnap.exists()) throw new Error('signup-incomplete');

  if (isOwner) {
    const [guildSnap, cfgSnap] = await Promise.all([
      getDoc(doc(db, 'guildas', uid)),
      getDoc(doc(db, 'configGuilda', uid))
    ]);
    if (!guildSnap.exists() || !cfgSnap.exists()) throw new Error('signup-incomplete');

    const cfg = cfgSnap.data() || {};
    if (String(cfg.ownerUid || '').trim() !== uid) throw new Error('signup-incomplete');
  }

  return true;
}

capturePartnerRefFromUrl();
const palavrasBloqueioDireto = [
  "arrombado",
  "arrombada",
  "babaca",
  "bosta",
  "buceta",
  "caralho",
  "corno",
  "corna",
  "cu",
  "cuzão",
  "cuzao",
  "desgraçado",
  "desgracado",
  "desgraçada",
  "desgracada",
  "fdp",
  "filho da puta",
  "filha da puta",
  "foda-se",
  "fodase",
  "idiota",
  "imbecil",
  "lixo",
  "otário",
  "otario",
  "otária",
  "otaria",
  "pau no cu",
  "porra",
  "puta",
  "puto",
  "putaria",
  "retardado",
  "retardada",
  "vagabundo",
  "vagabunda",
  "vai se foder",
  "vai tomar no cu",
  "vsf",
  "vtmnc",
  "boiola",
  "bicha",
  "traveco",
  "aleijado",
  "doente mental",
  "autista",
  "mongol",
  "mongoloide",
  "boquete",
  "gozar",
  "gozada",
  "gozei",
  "masturbação",
  "masturbacao",
  "punheta",
  "sexo explícito",
  "sexo explicito",
  "nude",
  "nudes",
  "pelado",
  "pelada",
  "pornô",
  "porno",
  "pornografia",
  "xvideos",
  "onlyfans",
  "hitler",
  "maconha",
  "cocaína",
  "cocaina"
];

function normalizarTextoImproprio(texto) {
  return String(texto || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[@4]/g, 'a')
    .replace(/[3]/g, 'e')
    .replace(/[1!|]/g, 'i')
    .replace(/[0]/g, 'o')
    .replace(/[5$]/g, 's')
    .replace(/[7]/g, 't')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function escaparRegexImproprio(texto) {
  return String(texto || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function contemPalavraImpropria(texto) {
  const textoNormalizado = ` ${normalizarTextoImproprio(texto)} `;

  return palavrasBloqueioDireto.some((palavra) => {
    const palavraNormalizada = normalizarTextoImproprio(palavra);
    if (!palavraNormalizada) return false;

    const palavraRegex = escaparRegexImproprio(palavraNormalizada).replace(/\s+/g, '\\s+');
    const regex = new RegExp(`\\s${palavraRegex}\\s`, 'i');

    return regex.test(textoNormalizado);
  });
}

function validarTextoPermitido(valor, campo) {
  if (!contemPalavraImpropria(valor)) return true;
  showToast('error', `${campo} contém palavra imprópria.`);
  return false;
}

const setHtml = (el, html) => { if (el) el.innerHTML = html; };

function initIcons() {
  try {
    if (window.lucide && typeof window.lucide.createIcons === 'function') {
      window.lucide.createIcons();
    }
  } catch (_) {}
}

function showToast(type = 'info', message = '') {
  const box = qs('toast-container');
  if (!box) {
    if (type === 'error') console.error(message);
    return;
  }

  const color = type === 'success'
    ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
    : type === 'error'
      ? 'border-red-200 bg-red-50 text-red-800'
      : 'border-slate-200 bg-white text-slate-800';

  const icon = type === 'success' ? 'check-circle' : type === 'error' ? 'alert-circle' : 'info';
  const el = document.createElement('div');
  el.className = `pointer-events-auto flex items-start gap-2 rounded-2xl border px-4 py-3 text-sm font-semibold shadow-lg ${color}`;
  el.innerHTML = `<i data-lucide="${icon}" class="mt-0.5 h-4 w-4 shrink-0"></i><span>${String(message || '')}</span>`;
  box.appendChild(el);
  initIcons();

  setTimeout(() => {
    el.style.opacity = '0';
    el.style.transform = 'translateY(-6px)';
    el.style.transition = 'all .2s ease';
    setTimeout(() => el.remove(), 220);
  }, 3800);
}

function setButtonLoading(btn, loading, label = 'Criar conta') {
  if (!btn) return;
  btn.disabled = !!loading;
  btn.innerHTML = loading ? '<span class="btn-spinner"></span>' : `<span>${label}</span>`;
}

function openAuth() {
  qs('auth-backdrop')?.classList.add('show');
  qs('auth-drawer')?.classList.add('show');
  document.documentElement.style.overflow = 'hidden';
  setTimeout(() => {
    try { qs('email')?.focus(); } catch (_) {}
  }, 50);
}

function closeAuth() {
  qs('auth-backdrop')?.classList.remove('show');
  qs('auth-drawer')?.classList.remove('show');
  document.documentElement.style.overflow = '';
}

window.openAuth = openAuth;
window.closeAuth = closeAuth;

function setupAuthDrawer() {
  const backdrop = qs('auth-backdrop');
  ['open-auth', 'open-auth-2', 'open-auth-3', 'open-auth-top'].forEach((id) => {
    qs(id)?.addEventListener('click', openAuth);
  });
  qs('close-auth')?.addEventListener('click', closeAuth);
  backdrop?.addEventListener('click', closeAuth);
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeAuth();
  });
}

function setupSidebar() {
  const openBtn = qs('sidebar-open');
  const closeBtn = qs('sidebar-close');
  const overlay = qs('sidebar-overlay');
  const sidebar = qs('sidebar');

  function open() {
    overlay?.classList.remove('hidden');
    sidebar?.classList.remove('-translate-x-full');
    document.body.style.overflow = 'hidden';
  }

  function close() {
    overlay?.classList.add('hidden');
    sidebar?.classList.add('-translate-x-full');
    document.body.style.overflow = '';
  }

  openBtn?.addEventListener('click', open);
  closeBtn?.addEventListener('click', close);
  overlay?.addEventListener('click', close);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') close();
  });
}

function setupReveal() {
  try {
    const items = Array.from(document.querySelectorAll('[data-reveal]'));
    if (!items.length || !('IntersectionObserver' in window)) return;

    const io = new IntersectionObserver((entries) => {
      for (const ent of entries) {
        if (ent.isIntersecting) ent.target.classList.add('show');
        else ent.target.classList.remove('show');
      }
    }, { threshold: 0.18 });

    items.forEach((el) => {
      el.classList.add('reveal');
      io.observe(el);
    });
  } catch (_) {}
}

async function getSignupPromoDays() {
  try {
    const snap = await getDoc(doc(db, 'novo', 'Mnovo'));
    if (!snap.exists()) return 0;

    const rawDays = snap.data()?.dias;
    const parsed = parseInt(String(rawDays ?? '').trim(), 10);
    if (!Number.isFinite(parsed) || parsed <= 0) return 0;
    return Math.max(0, Math.floor(parsed));
  } catch (_) {
    return 0;
  }
}

async function ensureGameIdAvailable(gameId) {
  const ref = doc(db, 'users', gameId);
  const snap = await getDoc(ref);
  if (snap.exists()) {
    throw new Error('game-id-in-use');
  }
  return ref;
}

async function ensureEmailAvailable(email) {
  const emailLower = cleanEmail(email);
  if (!emailLower) return true;

  const fields = ['email', 'playerEmail'];

  for (const field of fields) {
    const snap = await getDocs(query(collection(db, 'users'), where(field, '==', emailLower), limit(1)));
    if (!snap.empty) {
      throw new Error('email-profile-in-use');
    }
  }

  return true;
}

async function ensureSignupAvailable(gameId, email) {
  await ensureGameIdAvailable(gameId);
  await ensureEmailAvailable(email);
}

async function createOwnerAccount(user, { gameId, guildName, nick }) {
  const uid = user.uid;
  const email = cleanEmail(user.email);
  const cleanGuildName = String(guildName || '').trim();
  const cleanNick = String(nick || '').trim();

  if (!uid) throw new Error('UID inválido.');
  if (!gameId) throw new Error('ID de usuário inválido.');
  if (!cleanGuildName) throw new Error('Nome da guilda inválido.');
  if (!cleanNick) throw new Error('Nick inválido.');

  const userRef = await ensureGameIdAvailable(gameId);
  const promoDays = await getSignupPromoDays();
  const promoExpiresAtMs = promoDays > 0 ? Date.now() + (promoDays * 86400000) : null;
  const partnerRef = getPartnerRefForOwnerSignup(user, gameId);
  const partnerReferralPayload = buildConfigGuildReferralPayload(partnerRef, user, gameId);

  const batch = writeBatch(db);

  batch.set(userRef, {
    id: gameId,
    uid,
    email,
    playerEmail: email,
    nick: cleanNick,
    guildId: uid,
    guilda: cleanGuildName,
    role: 'Líder',
    cat: '',
    foto: '',
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  }, { merge: true });

  batch.set(doc(db, 'guildas', uid), {
    name: cleanGuildName,
    ownerUid: uid,
    ownerEmail: email,
    ...(promoDays > 0 ? {
      vipTier: 'pro',
      vipExpiresAt: promoExpiresAtMs
    } : {}),
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  }, { merge: true });

  batch.set(doc(db, 'configGuilda', uid), {
    name: cleanGuildName,
    ownerUid: uid,
    ownerEmail: email,
    tagMembros: '',
    leaders: email ? [email] : [],
    admins: [],
    ...(promoDays > 0 ? {
      permissoesAtivas: true
    } : {}),
    ...partnerReferralPayload,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  }, { merge: true });

  await batch.commit();
  return { redirectTo: '/dashboard?login=1', promoDays, partnerRef };
}

async function createPlayerAccount(user, { gameId, nick }) {
  const uid = user.uid;
  const email = cleanEmail(user.email);
  const cleanNick = String(nick || '').trim();

  if (!uid) throw new Error('UID inválido.');
  if (!gameId) throw new Error('ID de usuário inválido.');
  if (!cleanNick) throw new Error('Nick inválido.');

  const userRef = await ensureGameIdAvailable(gameId);

  await setDoc(userRef, {
    id: gameId,
    uid,
    email,
    playerEmail: email,
    nick: cleanNick,
    role: 'Jogador',
    cat: '',
    foto: '',
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  }, { merge: true });

  return { redirectTo: '/jogador?login=1', promoDays: 0 };
}

async function findUserProfile(user) {
  if (!user) return null;
  const uid = user.uid || '';
  const email = cleanEmail(user.email);
  const found = new Map();

  function add(snap) {
    if (snap?.exists?.()) found.set(snap.id, { id: snap.id, ...snap.data() });
  }

  try { add(await getDoc(doc(db, 'users', uid))); } catch (_) {}

  const searches = [
    ['uid', uid],
    ['email', email],
    ['playerEmail', email]
  ];

  for (const [field, value] of searches) {
    if (!value) continue;
    try {
      const s = await getDocs(query(collection(db, 'users'), where(field, '==', value), limit(5)));
      s.docs.forEach(add);
    } catch (_) {}
  }

  return Array.from(found.values())[0] || null;
}

async function findGuildByEmail(emailLower) {
  // Desativado de propósito para economizar leituras.
  // O login não consulta mais configGuilda por e-mail para descobrir guilda.
  // O vínculo deve vir de users/{uid}; se for dono antigo, ainda validamos configGuilda/{uid}.
  return null;
}

async function resolveLoginRedirect(user) {
  const profile = await findUserProfile(user);
  const role = String(profile?.role || '').trim();

  if (role === 'Jogador' && !profile?.guildId) {
    return '/jogador?login=1';
  }

  if (role === 'Jogador') {
    return '/jogador?login=1';
  }

  if (profile?.guildId) {
    return '/dashboard?login=1';
  }

  // Não consulta/varre configGuilda para descobrir guilda por e-mail.
  // Para economizar leituras, o vínculo deve vir de users/{uid}.

  try {
    const ownerCfg = await getDoc(doc(db, 'configGuilda', user.uid));
    if (ownerCfg.exists()) return '/dashboard?login=1';
  } catch (_) {}

  throw new Error('incomplete-account');
}

function setupAuthForms() {
  const btnShowSignup = qs('btn-show-signup');
  const btnShowLogin = qs('btn-show-login');
  const loginForm = qs('login-form');
  const signupForm = qs('signup-form');
  const loginHint = qs('login-hint');

  function showSignup() {
    loginForm?.classList.add('hidden');
    signupForm?.classList.remove('hidden');
    btnShowSignup?.classList.add('hidden');
    btnShowLogin?.classList.remove('hidden');
    if (loginHint) loginHint.textContent = 'Já tem conta?';
  }

  function showLogin() {
    signupForm?.classList.add('hidden');
    loginForm?.classList.remove('hidden');
    btnShowLogin?.classList.add('hidden');
    btnShowSignup?.classList.remove('hidden');
    if (loginHint) loginHint.textContent = 'Não tem conta?';
  }

  btnShowSignup?.addEventListener('click', showSignup);
  btnShowLogin?.addEventListener('click', showLogin);

  loginForm?.addEventListener('submit', async (e) => {
    e.preventDefault();

    const email = String(qs('email')?.value || '').trim();
    const pass = String(qs('password')?.value || '');
    const btn = qs('btn-login');

    setButtonLoading(btn, true, 'Entrar');

    try {
      const cred = await signInWithEmailAndPassword(auth, email, pass);
      const redirectTo = await resolveLoginRedirect(cred.user);
      try { sessionStorage.setItem('hub_do_preload', '1'); } catch (_) {}
      window.location.href = withStoredPartnerRef(redirectTo);
    } catch (err) {
      console.error(err);
      let msg = 'Erro ao entrar.';
      if (err.code === 'auth/invalid-credential') msg = 'Email ou senha incorretos.';
      showToast('error', msg);
      setButtonLoading(btn, false, 'Entrar');
    }
  });

  const ownerSwitch = qs('signup-is-owner');
  const guildWrap = qs('signup-guild-wrap');
  const guildInput = qs('signup-guild-name');
  const modeDesc = qs('signup-mode-desc');

  function updateSignupMode() {
    const isOwner = !!ownerSwitch?.checked;
    guildWrap?.classList.toggle('hidden', !isOwner);
    if (guildInput) guildInput.required = isOwner;
    if (modeDesc) {
      modeDesc.textContent = isOwner
        ? 'Ative se você vai criar e administrar uma guilda na plataforma.'
        : 'Desative se você quer apenas criar um perfil de jogador.';
    }
  }

  ownerSwitch?.addEventListener('change', updateSignupMode);
  updateSignupMode();

  qs('signup-gameid')?.addEventListener('input', (e) => {
    e.target.value = normalizeDigits(e.target.value);
  });

  qs('signup-email')?.addEventListener('input', (e) => {
    e.target.value = cleanEmail(e.target.value);
  });

  qs('signup-password')?.addEventListener('input', (e) => {
    const clean = normalizeSignupPasswordInput(e.target.value);
    if (e.target.value !== clean) e.target.value = clean;
  });

  signupForm?.addEventListener('submit', async (e) => {
    e.preventDefault();

    const isOwner = !!qs('signup-is-owner')?.checked;
    const gameId = normalizeDigits(qs('signup-gameid')?.value || '');
    const guildName = String(qs('signup-guild-name')?.value || '').trim();
    const nick = String(qs('signup-nick')?.value || '').trim();
    const email = String(qs('signup-email')?.value || '').trim();
    const pass = String(qs('signup-password')?.value || '');
    const btn = qs('btn-signup');

    if (!validateSignupEmailDomain(email)) {
      showToast('error', 'Use apenas e-mail @gmail.com ou @yahoo.com.');
      return;
    }

    const passwordError = validateSignupPasswordValue(pass);
    if (passwordError) {
      showToast('error', passwordError);
      return;
    }

    if (!gameId) {
      showToast('error', 'Digite o ID do usuário/personagem. Não use o ID da guilda.');
      return;
    }

    if (!nick) {
      showToast('error', 'Digite seu nome/nick.');
      return;
    }

    if (isOwner && !guildName) {
      showToast('error', 'Digite o nome da guilda.');
      return;
    }

    if (!validarTextoPermitido(nick, 'O nick')) {
      return;
    }

    if (isOwner && !validarTextoPermitido(guildName, 'O nome da guilda')) {
      return;
    }

    setButtonLoading(btn, true, 'Criar conta');

    let createdUser = null;
    let createdResult = null;
    let createdRef = '';

    try {
      await ensureSignupAvailable(gameId, email);

      const cred = await createUserWithEmailAndPassword(auth, email, pass);
      createdUser = cred.user;

      const result = isOwner
        ? await createOwnerAccount(cred.user, { gameId, guildName, nick })
        : await createPlayerAccount(cred.user, { gameId, nick });
      createdResult = result;
      createdRef = result?.partnerRef || getStoredPartnerRef();

      await verifySignupCreation(cred.user, { gameId, isOwner });

      if (isOwner && createdRef) {
        await bindPartnerReferralAfterSignup(cred.user, gameId, cred.user.uid, createdRef);
      }

      if ((result?.promoDays || 0) > 0) {
        try {
          sessionStorage.setItem('hub_signup_promo_toast', `Promoção de ${result.promoDays} dias ativada!`);
        } catch (_) {}
      }

      showToast('success', 'Conta criada com sucesso!');
      try { sessionStorage.setItem('hub_do_preload', '1'); } catch (_) {}
      window.location.href = withStoredPartnerRef(result.redirectTo);
    } catch (err) {
      console.error(err);

      if (createdUser) {
        await cleanupFailedSignup(createdUser, {
          gameId,
          guildId: createdUser.uid,
          ref: createdRef,
          reason: String(err?.code || err?.message || 'signup-failed')
        });
      }

      try { await signOut(auth); } catch (_) {}

      let msg = 'Não foi possível criar a conta. Tente novamente com os dados corretos.';
      if (err?.message === 'game-id-in-use') msg = 'Esse ID de usuário já está vinculado a outra conta.';
      if (err?.message === 'email-profile-in-use') msg = 'Esse e-mail já está vinculado a outra conta.';
      if (err.code === 'auth/email-already-in-use') msg = 'Esse e-mail já está em uso.';
      if (err.code === 'auth/weak-password') msg = 'Senha fraca (mínimo 6 caracteres).';
      if (err?.message === 'signup-incomplete') msg = 'Não foi possível criar a conta. Tente novamente com os dados corretos.';
      if (err?.code === 'referral-bind-failed') msg = 'Não foi possível concluir o vínculo do convite. Tente novamente pelo link de convite.';
      if (String(err?.code || '').includes('permission-denied') || String(err?.message || '').includes('permission')) {
        msg = 'Não foi possível finalizar a criação da conta (permissões). Tente novamente com os dados corretos.';
      }

      showToast('error', msg);
      setButtonLoading(btn, false, 'Criar conta');
    }
  });
}

function redirectIfAlreadyLogged() {
  onAuthStateChanged(auth, async (user) => {
    if (!user) return;
    try {
      const redirectTo = await resolveLoginRedirect(user);
      window.location.href = withStoredPartnerRef(redirectTo);
    } catch (error) {
      console.warn('[redirectIfAlreadyLogged]', error);
      if (String(error?.message || '') === 'incomplete-account') {
        await cleanupFailedSignup(user, { guildId: user.uid, reason: 'incomplete-existing-session' });
      }
      try { await signOut(auth); } catch (_) {}
    }
  });
}

(function boot() {
  setupAuthDrawer();
  setupSidebar();
  setupReveal();
  setupAuthForms();
  decorateInternalLinksWithPartnerRef();
  initIcons();
  redirectIfAlreadyLogged();
})();

// Toggle de senha migrado de index-inline-1.js
document.addEventListener('DOMContentLoaded', () => {
      document.querySelectorAll('[data-password-toggle]').forEach((button) => {
        button.addEventListener('click', () => {
          const inputId = button.getAttribute('data-password-toggle');
          const input = inputId ? document.getElementById(inputId) : null;
          if (!input) return;

          const shouldShow = input.type === 'password';
          input.type = shouldShow ? 'text' : 'password';
          button.textContent = shouldShow ? 'Ocultar' : 'Mostrar';
          button.setAttribute('aria-label', shouldShow ? 'Ocultar senha' : 'Mostrar senha');
        });
      });
    });
