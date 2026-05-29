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
  setDoc,
  limit,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { cacheSidebarProfile } from '../cache.js';

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
  preview: qs('profile-preview'),
  placeholder: qs('profile-placeholder'),

  inputFoto: qs('input-foto'),
  inputNick: qs('input-nick'),
  inputBio: qs('input-bio'),
  bioCounter: qs('bio-counter'),
  saveBtn: qs('btn-save-profile'),
  profileForm: qs('player-profile-form'),
  profileStatus: qs('profile-status'),

  userRole: qs('user-role'),
  userEmail: qs('user-email'),
  playerName: qs('player-name'),
  playerSubtitle: qs('player-subtitle'),
  viewGameId: qs('view-gameid'),
  viewEmail: qs('view-email'),
  toastRoot: qs('toast-root')
};

let currentUser = null;
let currentProfileId = null;
let currentProfile = null;
let currentBase64Photo = '';

function cacheSidebarProfileLocal(profile = {}, user = currentUser) {
  try {
    cacheSidebarProfile({
      ...(profile || {}),
      id: profile.id || profile.gameIdMigrated || profile.gameId || currentProfileId || '',
      email: profile.email || profile.playerEmail || user?.email || ''
    }, user);
  } catch (_) {}
}

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
  const isSuccess = type === 'success';
  const box = document.createElement('div');
  box.className = `rounded-2xl px-4 py-3 shadow-xl border text-sm font-semibold max-w-sm transition-all ${
    isError
      ? 'bg-red-50 text-red-700 border-red-100'
      : isSuccess
        ? 'bg-emerald-50 text-emerald-700 border-emerald-100'
        : 'bg-white text-slate-700 border-slate-100'
  }`;
  box.textContent = message;
  root.appendChild(box);

  setTimeout(() => {
    box.style.opacity = '0';
    box.style.transform = 'translateY(6px)';
    setTimeout(() => box.remove(), 220);
  }, 3200);
}

function dataUrlSizeBytes(dataUrl = '') {
  if (!dataUrl || !dataUrl.includes(',')) return 0;
  const base64 = dataUrl.split(',')[1] || '';
  const padding = (base64.match(/=*$/)?.[0]?.length) || 0;
  return Math.ceil((base64.length * 3) / 4) - padding;
}

function loadImageFromFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('Imagem inválida.'));
      img.src = String(reader.result || '');
    };
    reader.onerror = () => reject(new Error('Falha ao ler a imagem.'));
    reader.readAsDataURL(file);
  });
}

async function compressImageToBase64(file, maxBytes = 900 * 1024) {
  const img = await loadImageFromFile(file);
  let width = img.width || 0;
  let height = img.height || 0;
  const maxDim = 800;

  if (width > maxDim || height > maxDim) {
    const scale = Math.min(maxDim / width, maxDim / height);
    width = Math.max(1, Math.round(width * scale));
    height = Math.max(1, Math.round(height * scale));
  }

  const canvas = document.createElement('canvas');
  const size = Math.min(width, height);
  canvas.width = size;
  canvas.height = size;

  const ctx = canvas.getContext('2d', { alpha: false });
  if (!ctx) throw new Error('Canvas indisponível.');

  let quality = 0.88;
  let output = '';
  let attempts = 0;

  while (attempts < 12) {
    ctx.clearRect(0, 0, size, size);
    const offsetX = (width - size) / 2;
    const offsetY = (height - size) / 2;
    ctx.drawImage(img, offsetX, offsetY, size, size, 0, 0, size, size);

    output = canvas.toDataURL('image/jpeg', quality);
    if (dataUrlSizeBytes(output) <= maxBytes) return output;

    quality -= 0.1;
    attempts += 1;
  }

  return output;
}

function setPhoto(base64) {
  currentBase64Photo = base64 || '';
  const hasPhoto = !!currentBase64Photo;

  for (const img of [els.sidebarAvatar, els.heroAvatar, els.preview]) {
    if (!img) continue;
    img.src = hasPhoto ? currentBase64Photo : '';
    img.classList.toggle('hidden', !hasPhoto);
  }

  for (const icon of [els.sidebarAvatarIcon, els.heroAvatarIcon, els.placeholder]) {
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

  try {
    const uidSnap = await getDoc(doc(db, 'users', user.uid));
    if (uidSnap.exists()) add(uidSnap.id, uidSnap.data());
  } catch (_) {}

  try {
    const q = query(collection(db, 'users'), where('uid', '==', user.uid), limit(10));
    const snap = await getDocs(q);
    snap.docs.forEach((d) => add(d.id, d.data()));
  } catch (_) {}

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

function resolveGameId(profile = {}) {
  if (isNumericDocId(profile.id)) return String(profile.id);
  return clean(profile.id) || clean(profile.gameId) || clean(profile.gameIdMigrated) || '--';
}

function fillPlayerDashboard(user, profile = {}) {
  currentProfile = profile || {};
  currentProfileId = profile?.id || null;

  const role = clean(profile.role) || 'Jogador';
  const nick = clean(profile.nick) || clean(profile.nome) || clean(profile.name) || 'Jogador';
  const email = clean(profile.email) || clean(user.email) || '--';
  const gameId = resolveGameId(profile);
  const bio = clean(profile.cat) || clean(profile.bio) || '';

  if (els.userRole) els.userRole.textContent = role || 'Jogador';
  if (els.userEmail) els.userEmail.textContent = email;
  if (els.playerName) els.playerName.textContent = nick;
  if (els.playerSubtitle) els.playerSubtitle.textContent = gameId !== '--' ? `ID ${gameId} • ${email}` : email;
  if (els.inputNick) els.inputNick.value = nick === 'Jogador' ? '' : nick;
  if (els.inputBio) els.inputBio.value = bio;
  if (els.bioCounter) els.bioCounter.textContent = `${bio.length}/100`;
  if (els.viewGameId) els.viewGameId.value = gameId;
  if (els.viewEmail) els.viewEmail.value = email;
  if (els.profileStatus) els.profileStatus.textContent = 'Perfil carregado.';

  setPhoto(profile.foto || '');
  cacheSidebarProfileLocal(currentProfile, user);
  initIcons();
}

async function saveProfile(event) {
  event.preventDefault();

  if (!currentUser) {
    showToast('error', 'Sessão inválida. Faça login novamente.');
    return;
  }

  if (!currentProfileId) {
    showToast('error', 'Perfil de jogador não encontrado.');
    return;
  }

  const nick = clean(els.inputNick?.value);
  const bio = clean(els.inputBio?.value).slice(0, 100);

  if (!nick) {
    showToast('error', 'Digite seu nick.');
    return;
  }

  const email = cleanEmail(currentUser.email);
  const gameId = resolveGameId(currentProfile);

  els.saveBtn.disabled = true;
  els.saveBtn.innerHTML = `<i data-lucide="loader-2" class="w-4 h-4 animate-spin"></i> Salvando...`;
  initIcons();

  try {
    await setDoc(doc(db, 'users', currentProfileId), {
      uid: currentUser.uid,
      email,
      id: gameId !== '--' ? gameId : currentProfileId,
      role: clean(currentProfile.role) || 'Jogador',
      nick,
      cat: bio,
      foto: currentBase64Photo,
      updatedAt: serverTimestamp()
    }, { merge: true });

    currentProfile = {
      ...currentProfile,
      uid: currentUser.uid,
      email,
      id: gameId !== '--' ? gameId : currentProfileId,
      nick,
      cat: bio,
      foto: currentBase64Photo
    };

    fillPlayerDashboard(currentUser, currentProfile);
    cacheSidebarProfileLocal(currentProfile, currentUser);
    showToast('success', 'Perfil atualizado com sucesso!');
  } catch (error) {
    console.error(error);
    showToast('error', 'Erro ao salvar o perfil.');
  } finally {
    els.saveBtn.disabled = false;
    els.saveBtn.innerHTML = `<i data-lucide="save" class="w-4 h-4"></i> Salvar perfil`;
    initIcons();
  }
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
  els.profileForm?.addEventListener('submit', saveProfile);

  els.inputBio?.addEventListener('input', () => {
    els.inputBio.value = clean(els.inputBio.value).slice(0, 100);
    if (els.bioCounter) els.bioCounter.textContent = `${els.inputBio.value.length}/100`;
  });

  els.inputFoto?.addEventListener('change', async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;

    try {
      showToast('info', 'Processando imagem...');
      const base64 = await compressImageToBase64(file, 900 * 1024);
      setPhoto(base64);
      showToast('success', 'Foto pronta para salvar.');
    } catch (error) {
      console.error(error);
      showToast('error', 'Não foi possível processar a foto.');
    }
  });

  window.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') closeSidebar();
  });
}

async function bootPlayer(user) {
  try {
    currentUser = user;
    const profile = await findCurrentUserProfile(user);

    if (!profile) {
      fillPlayerDashboard(user, {
        role: 'Jogador',
        email: user.email || '',
        uid: user.uid,
        nick: ''
      });
      showToast('error', 'Perfil de jogador não encontrado.');
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
