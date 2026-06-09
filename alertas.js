import { initializeApp, getApps } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getAuth,
  onAuthStateChanged,
  signOut
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
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

const els = {
  sidebar: qs('sidebar'),
  overlay: qs('sidebar-overlay'),
  openMenu: qs('mobile-menu-btn') || qs('sidebar-open'),
  closeMenu: qs('mobile-close-btn') || qs('sidebar-close'),
  logout: qs('btn-logout'),
  authState: qs('alert-auth-state'),
  reporterCard: qs('reporter-card'),
  reporterNick: qs('reporter-nick'),
  reporterMeta: qs('reporter-meta'),
  registerSection: qs('register-section'),
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
  item.className = `flex max-w-sm items-start gap-3 rounded-2xl border px-4 py-3 text-sm font-bold shadow-xl ${palette}`;
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
    button.classList.toggle('bg-emerald-50', button.dataset.reason === selectedReason);
    button.classList.toggle('text-emerald-700', button.dataset.reason === selectedReason);
  });
}

function renderReasonOptions() {
  if (!els.reasonMenu) return;
  els.reasonMenu.innerHTML = PLAYER_ALERT_REASONS.map((reason) => `
    <button type="button" data-reason="${escapeHtml(reason)}" class="w-full px-4 py-3 text-left text-sm font-bold text-slate-700 hover:bg-slate-50 transition-colors">
      ${escapeHtml(reason)}
    </button>
  `).join('');
  els.reasonMenu.querySelectorAll('[data-reason]').forEach((button) => {
    button.addEventListener('click', () => selectReason(button.dataset.reason || ''));
  });
}

function renderReporter() {
  if (!reporter || !els.reporterCard) return;
  els.reporterCard.classList.remove('hidden');
  if (els.reporterNick) els.reporterNick.textContent = reporter.nick || 'Usuário';
  if (els.reporterMeta) {
    els.reporterMeta.textContent = `ID ${reporter.playerId || '-'} • ${reporter.guildName || 'Sem guilda'}`;
  }
}

function renderResults(data) {
  if (!data?.exists || !Array.isArray(data.records) || !data.records.length) {
    setSearchState('empty');
    return;
  }

  if (els.resultTitle) {
    els.resultTitle.textContent = `${data.lastNick || 'Jogador'} • ID ${data.playerId}`;
  }
  if (els.resultCount) {
    els.resultCount.textContent = `${data.total}/${PLAYER_ALERT_LIMIT} alertas`;
  }
  if (els.resultList) {
    els.resultList.innerHTML = data.records.map((record) => `
      <article class="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5 shadow-sm">
        <div class="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div class="min-w-0">
            <div class="flex flex-wrap items-center gap-2">
              <span class="inline-flex items-center gap-1.5 rounded-full bg-red-50 px-2.5 py-1 text-[11px] font-black uppercase text-red-700 ring-1 ring-red-100">
                <i data-lucide="triangle-alert" class="h-3.5 w-3.5"></i> Alerta registrado
              </span>
              <span class="text-xs font-bold text-slate-400">${escapeHtml(formatAlertDate(record.createdAt, record.createdAtMs))}</span>
            </div>
            <h3 class="mt-3 text-base font-black text-slate-900">${escapeHtml(record.reason || 'Motivo não informado')}</h3>
            <p class="mt-1 text-sm font-semibold text-slate-500">Nick usado no registro: ${escapeHtml(record.targetNick || data.lastNick || '-')}</p>
          </div>
          <div class="rounded-xl bg-slate-50 px-3 py-2 text-xs font-bold text-slate-500 sm:text-right">
            Registro ${escapeHtml(String(record.id || '').slice(0, 8))}
          </div>
        </div>
        <div class="mt-4 grid grid-cols-1 gap-2 border-t border-slate-100 pt-4 text-xs sm:grid-cols-3">
          <div><span class="block font-bold text-slate-400">Registrado por</span><strong class="mt-0.5 block text-slate-700">${escapeHtml(record.reporterNick || 'Usuário')}</strong></div>
          <div><span class="block font-bold text-slate-400">ID do responsável</span><strong class="mt-0.5 block text-slate-700">${escapeHtml(record.reporterPlayerId || '-')}</strong></div>
          <div><span class="block font-bold text-slate-400">Guilda</span><strong class="mt-0.5 block text-slate-700">${escapeHtml(record.reporterGuildName || 'Sem guilda')}</strong></div>
        </div>
      </article>
    `).join('');
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
    const data = await loadPlayerAlerts(db, cleanId);
    renderResults(data);
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

  const playerId = normalizePlayerId(els.targetId?.value || '');
  const targetNick = String(els.targetNick?.value || '').trim();
  const reason = reasonValue();
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
    const result = await registerPlayerAlert(db, { playerId, targetNick, reason }, reporter);
    showToast('success', `Alerta registrado. Este ID agora tem ${result.total}/${PLAYER_ALERT_LIMIT} alertas.`);
    if (els.searchId) els.searchId.value = result.playerId;
    els.registerForm?.reset();
    selectReason('');
    if (els.customReasonCount) els.customReasonCount.textContent = '0/50';
    await searchAlerts(result.playerId);
  } catch (error) {
    console.error(error);
    const message = error instanceof PlayerAlertError
      ? error.message
      : 'Não foi possível registrar o alerta.';
    showToast('error', message);
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
    const willOpen = els.reasonMenu?.classList.contains('hidden');
    els.reasonMenu?.classList.toggle('hidden', !willOpen);
    els.reasonTrigger?.setAttribute('aria-expanded', willOpen ? 'true' : 'false');
  });
  document.addEventListener('click', (event) => {
    if (!els.reasonTrigger?.contains(event.target) && !els.reasonMenu?.contains(event.target)) {
      els.reasonMenu?.classList.add('hidden');
      els.reasonTrigger?.setAttribute('aria-expanded', 'false');
    }
  });

  els.searchForm?.addEventListener('submit', (event) => {
    event.preventDefault();
    searchAlerts(els.searchId?.value || '');
  });
  els.registerForm?.addEventListener('submit', handleRegister);
}

function bootLoggedMode() {
  onAuthStateChanged(auth, async (user) => {
    if (!user) {
      window.location.href = '/';
      return;
    }

    try {
      reporter = await resolveAlertReporter(db, user);
      const roleKey = String(reporter.role || '').toLowerCase();
      const isPlayer = roleKey === 'jogador' || roleKey === 'player';
      if (mode === 'guild' && isPlayer && !reporter.guildId) {
        window.location.replace('/alertajg');
        return;
      }
      if (mode === 'player' && !isPlayer && reporter.guildId) {
        window.location.replace('/alertagd');
        return;
      }
      if (els.authState) els.authState.textContent = user.email || '';
      els.registerSection?.classList.remove('hidden');
      renderReporter();
    } catch (error) {
      console.error(error);
      showToast('error', 'Não foi possível carregar os dados da sua conta.');
    }
  });
}

bindEvents();
initIcons();
setSearchState('initial');

if (isPublic) {
  els.registerSection?.classList.add('hidden');
} else {
  bootLoggedMode();
}

const params = new URLSearchParams(window.location.search || '');
const initialId = normalizePlayerId(params.get('id') || '');
if (initialId) searchAlerts(initialId);

