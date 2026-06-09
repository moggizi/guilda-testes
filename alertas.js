import { initializeApp, getApps } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import {
  PLAYER_ALERT_CUSTOM_REASON,
  PLAYER_ALERT_LIMIT,
  PLAYER_ALERT_REASONS,
  PlayerAlertError,
  loadPlayerAlerts,
  normalizePlayerId,
  registerPlayerAlert,
  resolveAlertReporter
} from './alertas-service.js';

const firebaseConfig = {
  apiKey: "AIzaSyC7UJxBOViZj8ELjw-Xvy645QYfDfpBzxM",
  authDomain: "guilda-hubb.firebaseapp.com",
  projectId: "guilda-hubb",
  storageBucket: "guilda-hubb.firebasestorage.app",
  messagingSenderId: "117135418619",
  appId: "1:117135418619:web:e8ca8ec52eb0eeeff87c5e",
  measurementId: "G-9CHV67E64Y"
};

const app = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const qs = (id) => document.getElementById(id);
const mode = String(document.body.dataset.alertMode || 'public').trim();
const isPublic = mode === 'public';
let reporter = null;
let selectedReason = '';
let submitBusy = false;
let visibleRecords = [];

const els = {
  sidebar: qs('sidebar'),
  overlay: qs('sidebar-overlay'),
  openMenu: qs('mobile-menu-btn') || qs('sidebar-open'),
  closeMenu: qs('mobile-close-btn') || qs('sidebar-close'),
  logout: qs('btn-logout'),
  userEmail: qs('user-email'),
  userRole: qs('user-role'),
  openRegister: qs('btn-open-register'),
  registerModal: qs('register-modal'),
  registerBackdrop: qs('register-modal-backdrop'),
  closeRegister: qs('btn-close-register'),
  cancelRegister: qs('btn-cancel-register'),
  registerForm: qs('alert-register-form'),
  targetId: qs('alert-player-id'),
  targetNick: qs('alert-player-nick'),
  reasonTrigger: qs('alert-reason-trigger'),
  reasonLabel: qs('alert-reason-label'),
  reasonMenu: qs('alert-reason-menu'),
  customReasonWrap: qs('custom-reason-wrap'),
  customReason: qs('alert-custom-reason'),
  customReasonCount: qs('custom-reason-count'),
  submitAlert: qs('btn-register-alert'),
  searchForm: qs('alert-search-form'),
  searchId: qs('alert-search-id'),
  searchButton: qs('btn-search-alert'),
  initialState: qs('alerts-initial-state'),
  loadingState: qs('alerts-loading-state'),
  emptyState: qs('alerts-empty-state'),
  resultState: qs('alerts-result-state'),
  resultTitle: qs('alerts-result-title'),
  resultCount: qs('alerts-result-count'),
  resultList: qs('alerts-result-list'),
  detailModal: qs('alert-detail-modal'),
  detailBackdrop: qs('alert-detail-backdrop'),
  closeDetail: qs('btn-close-detail'),
  detailPlayerTitle: qs('detail-player-title'),
  detailPlayerId: qs('detail-player-id'),
  detailReason: qs('detail-reason'),
  detailReporter: qs('detail-reporter'),
  detailReporterId: qs('detail-reporter-id'),
  detailGuild: qs('detail-guild'),
  detailDate: qs('detail-date'),
  toastRoot: qs('toast-root')
};

function initIcons() {
  try { window.lucide?.createIcons?.(); } catch (_) {}
}

function showToast(type, message) {
  if (!els.toastRoot) return;
  const palette = type === 'success'
    ? 'border-emerald-200 bg-emerald-50 text-emerald-900'
    : type === 'info'
      ? 'border-sky-200 bg-sky-50 text-sky-900'
      : 'border-red-200 bg-red-50 text-red-900';
  const icon = type === 'success' ? 'check-circle-2' : type === 'info' ? 'info' : 'circle-alert';
  const item = document.createElement('div');
  item.className = `flex max-w-sm items-start gap-3 rounded-xl border px-4 py-3 text-sm font-bold shadow-xl ${palette}`;
  item.innerHTML = `<i data-lucide="${icon}" class="mt-0.5 h-4 w-4 shrink-0"></i><span></span>`;
  item.querySelector('span').textContent = String(message || '');
  els.toastRoot.appendChild(item);
  initIcons();
  setTimeout(() => item.remove(), 4500);
}

function setupSidebar() {
  if (!els.sidebar || !els.openMenu) return;
  const open = () => {
    els.sidebar.classList.remove('-translate-x-full');
    els.overlay?.classList.remove('hidden');
  };
  const close = () => {
    els.sidebar.classList.add('-translate-x-full');
    els.overlay?.classList.add('hidden');
  };
  els.openMenu.addEventListener('click', open);
  els.closeMenu?.addEventListener('click', close);
  els.overlay?.addEventListener('click', close);
  els.sidebar.querySelectorAll('a[href]').forEach((link) => {
    link.addEventListener('click', () => {
      if (window.innerWidth < 1024) close();
    });
  });
}

function escapeHtml(value = '') {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function formatAlertDate(value, fallbackMs = 0) {
  try {
    const date = value?.toDate?.() || new Date(Number(fallbackMs || 0));
    if (!date || Number.isNaN(date.getTime())) return 'Data indisponível';
    return new Intl.DateTimeFormat('pt-BR', {
      dateStyle: 'short',
      timeStyle: 'short'
    }).format(date);
  } catch (_) {
    return 'Data indisponível';
  }
}

function setSearchState(name) {
  ['initial', 'loading', 'empty', 'result'].forEach((state) => {
    const element = state === 'initial'
      ? els.initialState
      : state === 'loading'
        ? els.loadingState
        : state === 'empty'
          ? els.emptyState
          : els.resultState;
    element?.classList.toggle('hidden', state !== name);
  });
}

function setModalOpen(modal, open) {
  if (!modal) return;
  modal.classList.toggle('hidden', !open);
  modal.classList.toggle('flex', open);
  document.body.classList.toggle('overflow-hidden', open);
  if (open) initIcons();
}

function resetRegisterForm() {
  els.registerForm?.reset();
  selectReason('');
  if (els.customReasonCount) els.customReasonCount.textContent = '0/50';
}

function openRegisterModal() {
  if (!reporter || isPublic) return;
  setModalOpen(els.registerModal, true);
  setTimeout(() => els.targetId?.focus(), 60);
}

function closeRegisterModal() {
  if (submitBusy) return;
  setModalOpen(els.registerModal, false);
  resetRegisterForm();
}

function closeDetailModal() {
  setModalOpen(els.detailModal, false);
}

function reasonValue() {
  if (selectedReason === PLAYER_ALERT_CUSTOM_REASON) {
    return String(els.customReason?.value || '').replace(/\s+/g, ' ').trim();
  }
  return selectedReason;
}

function selectReason(value) {
  selectedReason = PLAYER_ALERT_REASONS.includes(value) ? value : '';
  if (els.reasonLabel) els.reasonLabel.textContent = selectedReason || 'Selecione um motivo';
  const custom = selectedReason === PLAYER_ALERT_CUSTOM_REASON;
  els.customReasonWrap?.classList.toggle('hidden', !custom);
  els.reasonMenu?.classList.add('hidden');
  els.reasonTrigger?.setAttribute('aria-expanded', 'false');
  els.reasonMenu?.querySelectorAll('[data-reason]').forEach((button) => {
    button.classList.toggle('is-selected', button.dataset.reason === selectedReason);
  });
}

function renderReasonOptions() {
  if (!els.reasonMenu) return;
  els.reasonMenu.innerHTML = PLAYER_ALERT_REASONS.map((reason) => `
    <button type="button" data-reason="${escapeHtml(reason)}" class="alert-reason-option w-full rounded-lg px-3 py-2.5 text-left text-sm font-bold">
      ${escapeHtml(reason)}
    </button>
  `).join('');
  els.reasonMenu.querySelectorAll('[data-reason]').forEach((button) => {
    button.addEventListener('click', () => selectReason(button.dataset.reason || ''));
  });
}

function openAlertDetail(index) {
  const record = visibleRecords[Number(index)];
  if (!record) return;
  if (els.detailPlayerTitle) els.detailPlayerTitle.textContent = record.targetNick || 'Jogador';
  if (els.detailPlayerId) els.detailPlayerId.textContent = `ID ${record.playerId || '-'}`;
  if (els.detailReason) els.detailReason.textContent = record.reason || 'Motivo não informado';
  if (els.detailReporter) els.detailReporter.textContent = record.reporterNick || 'Usuário';
  if (els.detailReporterId) els.detailReporterId.textContent = record.reporterPlayerId || '-';
  if (els.detailGuild) els.detailGuild.textContent = record.reporterGuildName || 'Sem guilda';
  if (els.detailDate) els.detailDate.textContent = formatAlertDate(record.createdAt, record.createdAtMs);
  setModalOpen(els.detailModal, true);
}

function renderResults(data) {
  if (!data?.exists || !Array.isArray(data.records) || !data.records.length) {
    visibleRecords = [];
    setSearchState('empty');
    return;
  }

  visibleRecords = data.records.map((record) => ({
    ...record,
    playerId: record.playerId || data.playerId,
    targetNick: record.targetNick || data.lastNick || 'Jogador'
  }));
  if (els.resultTitle) els.resultTitle.textContent = `${data.lastNick || 'Jogador'} • ID ${data.playerId}`;
  if (els.resultCount) els.resultCount.textContent = `${data.total}/${PLAYER_ALERT_LIMIT}`;
  if (els.resultList) {
    els.resultList.innerHTML = visibleRecords.map((record, index) => {
      const nick = String(record.targetNick || 'Jogador');
      const initial = nick.trim().charAt(0).toUpperCase() || '?';
      return `
        <button type="button" data-alert-index="${index}" class="alert-result-card group flex min-h-[128px] w-full flex-col rounded-2xl border border-gray-200 bg-white p-4 text-left shadow-sm transition hover:border-red-200 hover:shadow-md">
          <div class="flex items-start gap-3">
            <span class="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-red-50 text-sm font-black text-red-600">${escapeHtml(initial)}</span>
            <span class="min-w-0 flex-1">
              <span class="block truncate text-sm font-bold text-gray-900">${escapeHtml(nick)}</span>
              <span class="mt-0.5 block text-xs font-semibold text-gray-400">ID ${escapeHtml(record.playerId || data.playerId)}</span>
            </span>
            <i data-lucide="chevron-right" class="h-4 w-4 shrink-0 text-gray-300 transition group-hover:text-red-400"></i>
          </div>
          <span class="mt-4 block line-clamp-2 text-sm font-semibold leading-relaxed text-gray-600">${escapeHtml(record.reason || 'Motivo não informado')}</span>
          <span class="mt-auto pt-3 text-[11px] font-bold text-gray-400">${escapeHtml(formatAlertDate(record.createdAt, record.createdAtMs))}</span>
        </button>
      `;
    }).join('');
  }
  setSearchState('result');
  initIcons();
}

async function searchAlerts(playerId) {
  const cleanId = normalizePlayerId(playerId);
  if (els.searchId) els.searchId.value = cleanId;
  if (cleanId.length < 6) {
    showToast('error', 'Informe um ID de jogador válido.');
    return;
  }

  setSearchState('loading');
  if (els.searchButton) els.searchButton.disabled = true;
  try {
    renderResults(await loadPlayerAlerts(db, cleanId));
  } catch (error) {
    console.error(error);
    setSearchState('initial');
    showToast('error', error?.message || 'Não foi possível buscar os alertas.');
  } finally {
    if (els.searchButton) els.searchButton.disabled = false;
  }
}

async function handleRegister(event) {
  event.preventDefault();
  if (submitBusy || !reporter) return;
  if (!selectedReason) {
    showToast('error', 'Selecione um motivo para o alerta.');
    return;
  }

  submitBusy = true;
  if (els.submitAlert) {
    els.submitAlert.disabled = true;
    els.submitAlert.innerHTML = '<i data-lucide="loader-2" class="h-4 w-4 animate-spin"></i> Registrando...';
    initIcons();
  }

  try {
    const result = await registerPlayerAlert(db, {
      playerId: normalizePlayerId(els.targetId?.value || ''),
      targetNick: String(els.targetNick?.value || '').trim(),
      reason: reasonValue()
    }, reporter);
    setModalOpen(els.registerModal, false);
    resetRegisterForm();
    if (els.searchId) els.searchId.value = result.playerId;
    showToast('success', 'Alerta registrado com sucesso.');
    await searchAlerts(result.playerId);
  } catch (error) {
    console.error(error);
    showToast('error', error instanceof PlayerAlertError ? error.message : 'Não foi possível registrar o alerta.');
  } finally {
    submitBusy = false;
    if (els.submitAlert) {
      els.submitAlert.disabled = false;
      els.submitAlert.innerHTML = '<i data-lucide="shield-alert" class="h-4 w-4"></i> Registrar alerta';
      initIcons();
    }
  }
}

function bindEvents() {
  setupSidebar();
  renderReasonOptions();
  els.logout?.addEventListener('click', async () => {
    try { await signOut(auth); } catch (_) {}
    window.location.href = '/';
  });
  els.openRegister?.addEventListener('click', openRegisterModal);
  els.closeRegister?.addEventListener('click', closeRegisterModal);
  els.cancelRegister?.addEventListener('click', closeRegisterModal);
  els.registerBackdrop?.addEventListener('click', closeRegisterModal);
  els.closeDetail?.addEventListener('click', closeDetailModal);
  els.detailBackdrop?.addEventListener('click', closeDetailModal);
  els.searchId?.addEventListener('input', () => {
    els.searchId.value = normalizePlayerId(els.searchId.value);
  });
  els.targetId?.addEventListener('input', () => {
    els.targetId.value = normalizePlayerId(els.targetId.value);
  });
  els.customReason?.addEventListener('input', () => {
    els.customReason.value = String(els.customReason.value || '').slice(0, 50);
    if (els.customReasonCount) els.customReasonCount.textContent = `${els.customReason.value.length}/50`;
  });
  els.reasonTrigger?.addEventListener('click', () => {
    const open = els.reasonMenu?.classList.contains('hidden');
    els.reasonMenu?.classList.toggle('hidden', !open);
    els.reasonTrigger?.setAttribute('aria-expanded', open ? 'true' : 'false');
  });
  document.addEventListener('click', (event) => {
    if (!els.reasonTrigger?.contains(event.target) && !els.reasonMenu?.contains(event.target)) {
      els.reasonMenu?.classList.add('hidden');
      els.reasonTrigger?.setAttribute('aria-expanded', 'false');
    }
  });
  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    if (!els.detailModal?.classList.contains('hidden')) closeDetailModal();
    else if (!els.registerModal?.classList.contains('hidden')) closeRegisterModal();
  });
  els.resultList?.addEventListener('click', (event) => {
    const card = event.target.closest('[data-alert-index]');
    if (card) openAlertDetail(card.dataset.alertIndex);
  });
  els.searchForm?.addEventListener('submit', (event) => {
    event.preventDefault();
    searchAlerts(els.searchId?.value || '');
  });
  els.registerForm?.addEventListener('submit', handleRegister);
}

function destinationForReporter(profile) {
  const role = String(profile?.role || '').toLowerCase();
  const player = role === 'jogador' || role === 'player';
  return player ? '/alertajg' : '/alertagd';
}

function bootAuth() {
  onAuthStateChanged(auth, async (user) => {
    if (!user) {
      if (!isPublic) window.location.href = '/';
      return;
    }

    try {
      const profile = await resolveAlertReporter(db, user);
      if (isPublic) {
        window.location.replace(destinationForReporter(profile));
        return;
      }

      reporter = profile;
      const destination = destinationForReporter(profile);
      if ((mode === 'guild' && destination === '/alertajg') || (mode === 'player' && destination === '/alertagd')) {
        window.location.replace(destination);
        return;
      }
      if (els.userEmail) els.userEmail.textContent = user.email || '';
      if (els.userRole) els.userRole.textContent = profile.role || (mode === 'player' ? 'Jogador' : 'Meu Perfil');
      els.openRegister?.classList.remove('hidden');
      els.openRegister?.classList.add('flex');
    } catch (error) {
      console.error(error);
      if (!isPublic) showToast('error', 'Não foi possível carregar os dados da sua conta.');
    }
  });
}

bindEvents();
initIcons();
setSearchState('initial');
bootAuth();
window.dispatchEvent(new CustomEvent('guildahub:page-ready'));

const params = new URLSearchParams(window.location.search || '');
const initialId = normalizePlayerId(params.get('id') || '');
if (initialId) searchAlerts(initialId);
