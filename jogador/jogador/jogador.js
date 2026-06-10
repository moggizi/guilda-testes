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

const NOTICE_CACHE_TTL_MS = 12 * 60 * 60 * 1000;

function noticeText(value, max = 1200) {
  return String(value ?? '').trim().slice(0, max);
}

function noticeCacheKey() {
  return `avisos_jogador_${currentUser?.uid || currentProfileId || 'sem-user'}`;
}

function readNoticeCache() {
  try {
    const raw = localStorage.getItem(noticeCacheKey());
    return raw ? (JSON.parse(raw) || null) : null;
  } catch (_) {
    return null;
  }
}

function writeNoticeCache(payload = {}) {
  try {
    localStorage.setItem(noticeCacheKey(), JSON.stringify({ ...(payload || {}), ts: Date.now() }));
  } catch (_) {}
}

function isNoticeCacheFresh(entry) {
  const ts = Number(entry?.ts || 0);
  return !!ts && Number.isFinite(ts) && (Date.now() - ts) < NOTICE_CACHE_TTL_MS;
}

function normalizeNoticeDoc(id, data = {}) {
  const titulo = noticeText(data?.titulo, 120);
  const aviso = noticeText(data?.aviso, 2000);
  if (!titulo && !aviso) return null;
  return {
    id,
    tipo: id === 'geral' ? 'Geral' : 'Jogador',
    titulo: titulo || 'Aviso',
    aviso: aviso || titulo || ''
  };
}

function ensureNoticeModal() {
  let modal = qs('notice-modal-player');
  if (modal) return modal;

  modal = document.createElement('div');
  modal.id = 'notice-modal-player';
  modal.className = 'fixed inset-0 z-[10000] hidden items-center justify-center bg-black/45 px-4 backdrop-blur-sm';
  modal.innerHTML = `
    <div class="w-full max-w-lg overflow-hidden rounded-3xl border border-white/70 bg-white shadow-2xl">
      <div class="flex items-start justify-between gap-4 border-b border-gray-100 px-5 py-4">
        <div class="min-w-0">
          <p id="notice-modal-kind-player" class="text-[11px] font-extrabold uppercase tracking-wide text-emerald-600">Aviso</p>
          <h3 id="notice-modal-title-player" class="mt-1 text-lg font-extrabold text-gray-900 break-words">Aviso</h3>
        </div>
        <button type="button" data-close-player-notice class="shrink-0 rounded-xl p-2 text-gray-400 hover:bg-gray-100 hover:text-gray-700" aria-label="Fechar aviso">
          <i data-lucide="x" class="h-5 w-5"></i>
        </button>
      </div>
      <div id="notice-modal-body-player" class="max-h-[65vh] overflow-y-auto whitespace-pre-wrap px-5 py-5 text-sm leading-relaxed text-gray-700"></div>
    </div>
  `;
  document.body.appendChild(modal);
  modal.querySelectorAll('[data-close-player-notice]').forEach((btn) => {
    btn.addEventListener('click', closeNoticeModal);
  });
  modal.addEventListener('click', (event) => {
    if (event.target === modal) closeNoticeModal();
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !modal.classList.contains('hidden')) closeNoticeModal();
  });
  initIcons();
  return modal;
}

function openNoticeModal(notice) {
  const modal = ensureNoticeModal();
  const kind = qs('notice-modal-kind-player');
  const title = qs('notice-modal-title-player');
  const body = qs('notice-modal-body-player');
  if (kind) kind.textContent = notice?.tipo || 'Aviso';
  if (title) title.textContent = notice?.titulo || 'Aviso';
  if (body) body.textContent = notice?.aviso || notice?.titulo || '';
  modal.classList.remove('hidden');
  modal.classList.add('flex');
  initIcons();
}

function closeNoticeModal() {
  const modal = qs('notice-modal-player');
  if (!modal) return;
  modal.classList.add('hidden');
  modal.classList.remove('flex');
}

function showNoticeToast(notice) {
  let root = qs('notice-toast-root-player');
  if (!root) {
    root = document.createElement('div');
    root.id = 'notice-toast-root-player';
    root.className = 'fixed top-4 right-4 z-[9999] flex w-[calc(100vw-2rem)] max-w-sm flex-col gap-2';
    document.body.appendChild(root);
  }

  const box = document.createElement('button');
  box.type = 'button';
  box.className = 'group w-full rounded-2xl border border-emerald-200 bg-white/95 p-4 text-left shadow-2xl shadow-emerald-950/10 ring-1 ring-white/70 backdrop-blur transition hover:-translate-y-0.5 hover:border-emerald-300';
  box.innerHTML = `
    <div class="flex gap-3">
      <span class="mt-0.5 inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-700">
        <i data-lucide="megaphone" class="h-5 w-5"></i>
      </span>
      <span class="min-w-0 flex-1">
        <span class="block text-[11px] font-extrabold uppercase tracking-wide text-emerald-600">${notice.tipo || 'Aviso'}</span>
        <span class="mt-0.5 block text-sm font-extrabold leading-snug text-gray-900"></span>
        <span class="mt-1 block text-xs font-semibold text-gray-500">Toque para ler o aviso completo.</span>
      </span>
    </div>
  `;
  const titleEl = box.querySelector('.text-gray-900');
  if (titleEl) titleEl.textContent = notice.titulo || 'Aviso';
  box.addEventListener('click', () => {
    openNoticeModal(notice);
    box.remove();
  });
  root.appendChild(box);
  initIcons();

  setTimeout(() => {
    box.style.opacity = '0';
    box.style.transform = 'translateY(-6px)';
    box.style.transition = 'all 220ms ease';
  }, 4000);
  setTimeout(() => box.remove(), 4300);
}

async function fetchPlayerNotices() {
  const ids = ['jogador', 'geral'];
  const out = [];
  for (const id of ids) {
    try {
      const snap = await getDoc(doc(db, 'avisos', id));
      if (!snap.exists()) continue;
      const notice = normalizeNoticeDoc(id, snap.data() || {});
      if (notice) out.push(notice);
    } catch (error) {
      console.warn('[avisos-jogador]', error);
    }
  }
  return out;
}

async function maybeShowPlayerNotices() {
  if (!currentUser) return;
  const cached = readNoticeCache();
  if (isNoticeCacheFresh(cached)) return;

  const notices = await fetchPlayerNotices();
  writeNoticeCache({ notices, shownAt: notices.length ? Date.now() : 0 });
  notices.forEach((notice, index) => {
    setTimeout(() => showNoticeToast(notice), index * 250);
  });
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
    window.location.href = '/inicio';
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
      maybeShowPlayerNotices().catch((error) => console.warn('[avisos-jogador]', error));
      return;
    }

    fillPlayerDashboard(user, profile);
    setDashboardVisible(true);
    maybeShowPlayerNotices().catch((error) => console.warn('[avisos-jogador]', error));
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
    window.location.href = '/inicio';
    return;
  }

  await bootPlayer(user);
});
