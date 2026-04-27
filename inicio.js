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
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  }, { merge: true });

  await batch.commit();
  return { redirectTo: 'dashboard.html?login=1', promoDays };
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

  return { redirectTo: 'jogador.html?login=1', promoDays: 0 };
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
  const email = cleanEmail(emailLower);
  if (!email) return null;

  const attempts = [
    ['leaders', 'array-contains', email],
    ['admins', 'array-contains', email],
    ['ownerEmail', '==', email],
    ['playerEmail', '==', email]
  ];

  for (const [field, op, value] of attempts) {
    try {
      const snap = await getDocs(query(collection(db, 'configGuilda'), where(field, op, value), limit(1)));
      if (!snap.empty) return snap.docs[0].id;
    } catch (_) {}
  }

  return null;
}

async function resolveLoginRedirect(user) {
  const profile = await findUserProfile(user);
  const role = String(profile?.role || '').trim();

  if (role === 'Jogador' && !profile?.guildId) {
    return 'jogador.html?login=1';
  }

  if (role === 'Jogador') {
    return 'jogador.html?login=1';
  }

  if (profile?.guildId) {
    return 'dashboard.html?login=1';
  }

  const email = cleanEmail(user?.email);
  const guildByEmail = await findGuildByEmail(email);
  if (guildByEmail) return 'dashboard.html?login=1';

  try {
    const ownerCfg = await getDoc(doc(db, 'configGuilda', user.uid));
    if (ownerCfg.exists()) return 'dashboard.html?login=1';
  } catch (_) {}

  return 'dashboard.html?login=1';
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
      window.location.href = redirectTo;
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

  signupForm?.addEventListener('submit', async (e) => {
    e.preventDefault();

    const isOwner = !!qs('signup-is-owner')?.checked;
    const gameId = normalizeDigits(qs('signup-gameid')?.value || '');
    const guildName = String(qs('signup-guild-name')?.value || '').trim();
    const nick = String(qs('signup-nick')?.value || '').trim();
    const email = String(qs('signup-email')?.value || '').trim();
    const pass = String(qs('signup-password')?.value || '');
    const btn = qs('btn-signup');

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

    setButtonLoading(btn, true, 'Criar conta');

    try {
      const cred = await createUserWithEmailAndPassword(auth, email, pass);
      const result = isOwner
        ? await createOwnerAccount(cred.user, { gameId, guildName, nick })
        : await createPlayerAccount(cred.user, { gameId, nick });

      if ((result?.promoDays || 0) > 0) {
        try {
          sessionStorage.setItem('hub_signup_promo_toast', `Promoção de ${result.promoDays} dias ativada!`);
        } catch (_) {}
      }

      showToast('success', 'Conta criada com sucesso!');
      try { sessionStorage.setItem('hub_do_preload', '1'); } catch (_) {}
      window.location.href = result.redirectTo;
    } catch (err) {
      console.error(err);
      try { await signOut(auth); } catch (_) {}

      let msg = 'Não foi possível criar a conta.';
      if (err?.message === 'game-id-in-use') msg = 'Esse ID de usuário já está vinculado a outra conta.';
      if (err.code === 'auth/email-already-in-use') msg = 'Esse e-mail já está em uso.';
      if (err.code === 'auth/weak-password') msg = 'Senha fraca (mínimo 6 caracteres).';
      if (String(err?.code || '').includes('permission-denied') || String(err?.message || '').includes('permission')) {
        msg = 'Não foi possível finalizar a criação da conta (permissões).';
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
      window.location.href = redirectTo;
    } catch (_) {
      window.location.href = 'dashboard.html?login=1';
    }
  });
}

(function boot() {
  setupAuthDrawer();
  setupSidebar();
  setupReveal();
  setupAuthForms();
  initIcons();
  redirectIfAlreadyLogged();
})();
