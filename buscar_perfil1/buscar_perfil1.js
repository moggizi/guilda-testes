import {
  auth,
  checkAuth,
  getGuildContext,
  initIcons,
  logout,
  setupSidebar,
  showToast,
  db
} from '../logic.js';
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const byId = (id) => document.getElementById(id);
const form = byId('profile-search-form');
const input = byId('profile-id-input');
const searchButton = byId('profile-search-button');
const emptyState = byId('profile-empty-state');
const loadingState = byId('profile-loading-state');
const errorState = byId('profile-error-state');
const resultCard = byId('profile-result-card');
const modal = byId('public-profile-modal');
const backdrop = byId('public-profile-backdrop');
const sheet = byId('public-profile-sheet');
const closeButton = byId('public-profile-close');

let currentProfile = null;
let modalCloseTimer = null;

function normalizeRoleKey(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();
}

function canUseProfileSearch(ctx = {}) {
  const role = normalizeRoleKey(ctx.role);
  return ctx.isOwner === true || ['lider', 'leader', 'dono', 'owner', 'admin', 'administrador'].includes(role);
}

function cleanGameId(value) {
  return String(value || '').replace(/\D+/g, '').slice(0, 15);
}

function setVisible(element, visible) {
  element?.classList.toggle('hidden', !visible);
}

function showState(state) {
  setVisible(emptyState, state === 'empty');
  setVisible(loadingState, state === 'loading');
  setVisible(errorState, state === 'error');
  setVisible(resultCard, state === 'result');
}

function setError(title, message) {
  byId('profile-error-title').textContent = title;
  byId('profile-error-message').textContent = message;
  showState('error');
}

function setPhoto(img, placeholder, value, nick) {
  const photo = String(value || '').trim();
  img.alt = photo ? `Foto de ${nick || 'jogador'}` : '';
  img.onerror = () => {
    img.removeAttribute('src');
    img.classList.add('hidden');
    placeholder.classList.remove('hidden');
  };

  if (photo) {
    img.src = photo;
    img.classList.remove('hidden');
    placeholder.classList.add('hidden');
  } else {
    img.removeAttribute('src');
    img.classList.add('hidden');
    placeholder.classList.remove('hidden');
  }
}

function roleClasses(role) {
  const key = normalizeRoleKey(role);
  if (['lider', 'leader', 'dono', 'owner'].includes(key)) {
    return 'bg-amber-50 text-amber-700 ring-1 ring-amber-100';
  }
  if (key === 'admin' || key === 'administrador') {
    return 'bg-fuchsia-50 text-fuchsia-700 ring-1 ring-fuchsia-100';
  }
  if (key === 'jogador' || key === 'player') {
    return 'bg-blue-50 text-blue-700 ring-1 ring-blue-100';
  }
  return 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-100';
}

function applyRoleBadge(element, role) {
  if (!element) return;
  element.textContent = role || 'Membro';
  element.className = `inline-flex rounded-full px-2.5 py-1 text-[10px] font-black uppercase tracking-wider ${roleClasses(role)}`;
  if (element.id === 'modal-profile-role') {
    element.className = `mt-1 inline-flex rounded-full px-2.5 py-1 text-[10px] font-black uppercase tracking-wider ${roleClasses(role)}`;
  }
}

function formatJoinDate(value) {
  if (!value) return 'Nao informada';

  if (typeof value === 'object') {
    if (typeof value.toDate === 'function') return formatJoinDate(value.toDate());
    if (typeof value.toMillis === 'function') return formatJoinDate(value.toMillis());
    if (typeof value.seconds === 'number') return formatJoinDate(value.seconds * 1000);
  }

  const raw = String(value).trim();
  let date = null;

  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    const [year, month, day] = raw.split('-').map(Number);
    date = new Date(year, month - 1, day);
  } else if (/^\d{10,13}$/.test(raw)) {
    const numeric = Number(raw);
    date = new Date(raw.length === 10 ? numeric * 1000 : numeric);
  } else {
    const parsed = new Date(raw);
    if (!Number.isNaN(parsed.getTime())) date = parsed;
  }

  if (!date || Number.isNaN(date.getTime())) return raw || 'Nao informada';
  return new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit',
    month: 'long',
    year: 'numeric'
  }).format(date);
}

function publicProfileFromUserDoc(snap) {
  const data = snap.data() || {};
  const id = cleanGameId(data.id || data.gameIdMigrated || data.gameId || snap.id) || snap.id;

  return {
    id,
    nick: String(data.nick || data.nome || data.name || 'Jogador').trim() || 'Jogador',
    bio: String(data.cat || data.bio || '').trim().slice(0, 100),
    photo: String(data.foto || data.photo || data.avatar || '').trim(),
    guildName: String(data.guilda || data.guildName || 'Sem guilda').trim() || 'Sem guilda',
    role: String(data.role || data.cargo || 'Membro').trim() || 'Membro',
    joinDate: data.createdAt || data.criadoEm || data.created_at || data.created || null,
    isVerifiedPartner: data.parceiroVerificado === true || String(data.parceiroTipo || '').toLowerCase().trim() === 'verificado'
  };
}

function renderProfile(profile) {
  currentProfile = profile;

  byId('result-nick').textContent = profile.nick || 'Jogador';
  byId('result-id').textContent = profile.id || '--';
  byId('result-guild').textContent = profile.guildName || 'Sem guilda';
  setPhoto(byId('result-photo'), byId('result-photo-placeholder'), profile.photo, profile.nick);

  byId('modal-profile-nick').textContent = profile.nick || 'Jogador';
  byId('modal-profile-id').textContent = profile.id || '--';
  byId('modal-profile-bio').textContent = profile.bio || 'Este jogador ainda nao adicionou uma bio.';
  byId('modal-profile-guild').textContent = profile.guildName || 'Sem guilda';
  byId('modal-profile-join-date').textContent = formatJoinDate(profile.joinDate);
  applyRoleBadge(byId('modal-profile-role'), profile.role);
  setPhoto(byId('modal-profile-photo'), byId('modal-profile-photo-placeholder'), profile.photo, profile.nick);
  byId('modal-partner-badge')?.classList.toggle('hidden', profile.isVerifiedPartner !== true);

  showState('result');
  initIcons();
}

function setSearching(searching) {
  searchButton.disabled = searching;
  searchButton.innerHTML = searching
    ? '<i data-lucide="loader-2" class="h-5 w-5 animate-spin"></i><span>Buscando...</span>'
    : '<i data-lucide="search" class="h-5 w-5"></i><span>Buscar</span>';
  initIcons();
}

function errorMessage(code) {
  const messages = {
    'profile-not-found': ['Perfil nao encontrado', 'Nao existe um perfil publico cadastrado com esse ID.'],
    'invalid-id': ['ID invalido', 'Digite um ID de jogador valido com 3 a 15 numeros.'],
    forbidden: ['Acesso nao permitido', 'A busca de perfis esta disponivel apenas para donos, lideres e admins.'],
    'auth-required': ['Sessao encerrada', 'Entre novamente para continuar.'],
    'auth-invalid': ['Sessao encerrada', 'Entre novamente para continuar.'],
    'internal-error': ['Nao foi possivel buscar agora', 'Tente novamente em alguns instantes.']
  };
  return messages[code] || ['Erro na busca', 'Nao foi possivel carregar esse perfil agora.'];
}

async function searchProfile(gameId) {
  if (!auth.currentUser) throw new Error('auth-required');
  const snap = await getDoc(doc(db, 'users', gameId));
  if (!snap.exists()) throw new Error('profile-not-found');
  return publicProfileFromUserDoc(snap);
}

async function handleSearch(event) {
  event.preventDefault();
  const gameId = cleanGameId(input.value);
  input.value = gameId;

  if (gameId.length < 3 || gameId.length > 15) {
    setError('ID invalido', 'Digite um ID de 3 a 15 numeros.');
    input.focus();
    return;
  }

  closeProfileModal(true);
  setSearching(true);
  showState('loading');

  try {
    const profile = await searchProfile(gameId);
    renderProfile(profile);
    const url = new URL(window.location.href);
    url.searchParams.set('id', gameId);
    window.history.replaceState({}, '', url);
  } catch (error) {
    const code = String(error?.message || 'internal-error');
    const [title, message] = errorMessage(code);
    setError(title, message);
    if (code === 'auth-required' || code === 'auth-invalid') {
      setTimeout(() => { window.location.href = '/'; }, 900);
    }
  } finally {
    setSearching(false);
  }
}

function openProfileModal() {
  if (!currentProfile) return;
  clearTimeout(modalCloseTimer);
  modal.classList.remove('hidden');
  modal.setAttribute('aria-hidden', 'false');
  document.body.style.overflow = 'hidden';

  requestAnimationFrame(() => {
    backdrop.classList.remove('opacity-0');
    backdrop.classList.add('opacity-100');
    sheet.classList.remove('translate-y-full');
  });

  closeButton.focus();
}

function closeProfileModal(immediate = false) {
  if (modal.classList.contains('hidden')) return;
  backdrop.classList.add('opacity-0');
  backdrop.classList.remove('opacity-100');
  sheet.classList.add('translate-y-full');
  modal.setAttribute('aria-hidden', 'true');
  document.body.style.overflow = '';

  const finish = () => {
    modal.classList.add('hidden');
    if (!immediate) resultCard.focus();
  };

  if (immediate) finish();
  else modalCloseTimer = setTimeout(finish, 300);
}

function bindEvents() {
  form.addEventListener('submit', handleSearch);
  input.addEventListener('input', () => {
    const clean = cleanGameId(input.value);
    if (input.value !== clean) input.value = clean;
  });
  resultCard.addEventListener('click', openProfileModal);
  backdrop.addEventListener('click', () => closeProfileModal());
  closeButton.addEventListener('click', () => closeProfileModal());
  byId('btn-logout')?.addEventListener('click', logout);
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !modal.classList.contains('hidden')) closeProfileModal();
  });
}

async function init() {
  setupSidebar();
  initIcons();
  bindEvents();

  const user = await checkAuth();
  if (!user) return;

  const context = getGuildContext() || {};
  if (!canUseProfileSearch(context)) {
    showToast('error', 'A busca de perfis e exclusiva para donos, lideres e admins.');
    setTimeout(() => { window.location.href = '/dashboard'; }, 900);
    return;
  }

  const initialId = cleanGameId(new URLSearchParams(window.location.search).get('id'));
  if (initialId) {
    input.value = initialId;
    form.requestSubmit();
  } else {
    input.focus();
  }

  try { window.GuildaHubLoader?.done(); } catch (_) {}
  window.dispatchEvent(new Event('guildahub:page-ready'));
}

init().catch((error) => {
  console.error('Erro ao iniciar busca de perfis:', error);
  setError('Nao foi possivel abrir a busca', 'Atualize a pagina e tente novamente.');
  try { window.GuildaHubLoader?.done(); } catch (_) {}
});
