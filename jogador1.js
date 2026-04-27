import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getAuth,
  onAuthStateChanged,
  signOut
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  getFirestore,
  collection,
  query,
  where,
  getDocs,
  doc,
  getDoc,
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
const clean = (v) => String(v ?? '').trim();
const cleanEmail = (v) => clean(v).toLowerCase();
const isNumericDocId = (id) => /^\d+$/.test(String(id || ''));

const els = {
  sidebar: qs('sidebar'),
  overlay: qs('sidebar-overlay'),
  openMenu: qs('mobile-menu-btn'),
  closeMenu: qs('mobile-close-btn'),
  logout: qs('btn-logout'),
  loading: qs('loading-state'),
  dashboard: qs('player-dashboard'),

  sidebarAvatar: qs('sidebar-avatar'),
  sidebarAvatarIcon: qs('sidebar-avatar-icon'),
  heroAvatar: qs('hero-avatar'),
  heroAvatarIcon: qs('hero-avatar-icon'),

  userRole: qs('user-role'),
  userEmail: qs('user-email'),
  playerName: qs('player-name'),
  playerSubtitle: qs('player-subtitle'),
  playerGameId: qs('player-game-id'),
  playerEmail: qs('player-email'),
  playerRole: qs('player-role'),
  playerCreated: qs('player-created'),
  toastRoot: qs('toast-root')
};

function initIcons() {
  try {
    if (window.lucide?.createIcons) window.lucide.createIcons();
  } catch (_) {}
}

function openSidebar() {
  els.sidebar?.classList.remove('-translate-x-full');
  els.overlay?.classList.remove('hidden');
}

function closeSidebar() {
  els.sidebar?.classList.add('-translate-x-full');
  els.overlay?.classList.add('hidden');
}

function showToast(type, message) {
  const root = els.toastRoot;
  if (!root) return;

  const isError = type === 'error';
  const box = document.createElement('div');
  box.className = `rounded-2xl px-4 py-3 shadow-xl border text-sm font-semibold max-w-sm ${isError ? 'bg-red-50 text-red-700 border-red-100' : 'bg-white text-gray-700 border-gray-100'}`;
  box.textContent = message;
  root.appendChild(box);

  setTimeout(() => {
    box.style.opacity = '0';
    box.style.transform = 'translateY(6px)';
    box.style.transition = 'all .2s ease';
    setTimeout(() => box.remove(), 220);
  }, 3200);
}

function dateFromFirestoreValue(val) {
  if (!val) return null;

  if (typeof val.toDate === 'function') return val.toDate();

  const seconds = typeof val.seconds === 'number'
    ? val.seconds
    : (typeof val._seconds === 'number' ? val._seconds : null);

  if (seconds !== null) {
    const nanos = typeof val.nanoseconds === 'number'
      ? val.nanoseconds
      : (typeof val._nanoseconds === 'number' ? val._nanoseconds : 0);
    return new Date((seconds * 1000) + Math.floor(nanos / 1000000));
  }

  if (typeof val === 'number') return new Date(val > 9999999999 ? val : val * 1000);

  if (typeof val === 'string') {
    const d = new Date(val);
    return Number.isNaN(d.getTime()) ? null : d;
  }

  return null;
}

function formatDateBR(val) {
  const d = dateFromFirestoreValue(val);
  if (!d || Number.isNaN(d.getTime())) return '--';
  return d.toLocaleDateString('pt-BR');
}

function setPhoto(base64) {
  const hasPhoto = !!base64;

  for (const img of [els.sidebarAvatar, els.heroAvatar]) {
    if (!img) continue;
    img.src = hasPhoto ? base64 : '';
    img.classList.toggle('hidden', !hasPhoto);
  }

  for (const icon of [els.sidebarAvatarIcon, els.heroAvatarIcon]) {
    icon?.classList.toggle('hidden', hasPhoto);
  }
}

function setDashboardVisible(visible) {
  els.loading?.classList.toggle('hidden', visible);
  els.dashboard?.classList.toggle('hidden', !visible);
}

function profileBelongsToUser(data, user) {
  if (!data || !user) return false;
  const email = cleanEmail(user.email);

  return (
    clean(data.uid) === clean(user.uid) ||
    cleanEmail(data.email) === email ||
    cleanEmail(data.playerEmail) === email
  );
}

async function findCurrentUserProfile(user) {
  const found = new Map();

  function add(id, data) {
    if (!id || !data) return;
    found.set(id, { id, ...data });
  }

  // Fallback: caso ainda exista algum doc antigo /users/{auth.uid}
  try {
    const uidSnap = await getDoc(doc(db, 'users', user.uid));
    if (uidSnap.exists()) add(uidSnap.id, uidSnap.data());
  } catch (_) {}

  // Padrão novo: /users/{ID_DO_USUARIO} com uid == auth.uid
  try {
    const q = query(collection(db, 'users'), where('uid', '==', user.uid), limit(10));
    const snap = await getDocs(q);
    snap.docs.forEach((d) => add(d.id, d.data()));
  } catch (_) {}

  // Fallback por email, cobrindo registros antigos.
  const email = cleanEmail(user.email);
  if (email) {
    try {
      const q = query(collection(db, 'users'), where('email', '==', email), limit(10));
      const snap = await getDocs(q);
      snap.docs.forEach((d) => add(d.id, d.data()));
    } catch (_) {}

    try {
      const q = query(collection(db, 'users'), where('playerEmail', '==', email), limit(10));
      const snap = await getDocs(q);
      snap.docs.forEach((d) => add(d.id, d.data()));
    } catch (_) {}
  }

  const profiles = Array.from(found.values()).filter((p) => profileBelongsToUser(p, user));
  const numeric = profiles.find((p) => isNumericDocId(p.id));

  return numeric || profiles[0] || null;
}

function fillPlayerDashboard(user, profile = {}) {
  const role = clean(profile.role) || 'Jogador';
  const nick = clean(profile.nick) || clean(profile.nome) || clean(profile.name) || 'Jogador';
  const email = clean(profile.email) || clean(user.email) || '--';
  const gameId = clean(profile.id) || clean(profile.gameId) || (isNumericDocId(profile.id) ? profile.id : '') || '--';
  const created = profile.createdAt || profile.criadoEm || profile.created_at || profile.created;

  if (els.userRole) els.userRole.textContent = role || 'Jogador';
  if (els.userEmail) els.userEmail.textContent = email;
  if (els.playerName) els.playerName.textContent = nick;
  if (els.playerSubtitle) els.playerSubtitle.textContent = `ID ${gameId} • ${email}`;
  if (els.playerGameId) els.playerGameId.textContent = gameId;
  if (els.playerEmail) els.playerEmail.textContent = email;
  if (els.playerRole) els.playerRole.textContent = role || 'Jogador';
  if (els.playerCreated) els.playerCreated.textContent = formatDateBR(created);

  setPhoto(profile.foto || '');
  initIcons();
}

async function logout() {
  try {
    await signOut(auth);
    window.location.href = 'index.html';
  } catch (error) {
    console.error(error);
    showToast('error', 'Erro ao sair da conta.');
  }
}

function bindEvents() {
  els.openMenu?.addEventListener('click', openSidebar);
  els.closeMenu?.addEventListener('click', closeSidebar);
  els.overlay?.addEventListener('click', closeSidebar);
  els.logout?.addEventListener('click', logout);

  window.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') closeSidebar();
  });
}

async function bootPlayer(user) {
  try {
    const profile = await findCurrentUserProfile(user);

    if (!profile) {
      fillPlayerDashboard(user, {
        role: 'Jogador',
        email: user.email || '',
        nick: 'Jogador'
      });
      showToast('error', 'Perfil de jogador não encontrado. Abra o perfil para concluir seu cadastro.');
      setDashboardVisible(true);
      return;
    }

    fillPlayerDashboard(user, profile);
    setDashboardVisible(true);
  } catch (error) {
    console.error(error);
    showToast('error', 'Não foi possível carregar seu painel.');
    setDashboardVisible(true);
  }
}

bindEvents();
initIcons();
setDashboardVisible(false);

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    window.location.href = 'index.html';
    return;
  }

  await bootPlayer(user);
});
