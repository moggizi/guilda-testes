import { initializeApp, deleteApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getFirestore,
  doc,
  getDoc,
  setDoc,
  getDocs,
  collection,
  writeBatch
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { checkAuth, setupSidebar, initIcons, logout, getGuildContext, showToast, db as normalDb } from './logic.js';

const hubPerfisFirebaseConfig = {
  apiKey: "AIzaSyASInYDbSFxfgbF7yjXDM4THipLYdZwjXs",
  authDomain: "hub-perfis.firebaseapp.com",
  projectId: "hub-perfis",
  storageBucket: "hub-perfis.firebasestorage.app",
  messagingSenderId: "231971973267",
  appId: "1:231971973267:web:8b67cca5cfbe7b3f934566",
  measurementId: "G-0N7WY0984C"
};

const PROFILE_ACCESS_CACHE_PREFIX = 'guildProfileAccess_';
const WEEK_UPDATE_COOLDOWN_DAYS = 4;
const WEEK_UPDATE_COOLDOWN_MS = WEEK_UPDATE_COOLDOWN_DAYS * 24 * 60 * 60 * 1000;
const PROFILE_EXPIRES_DAYS = 4;
const PROFILE_EXPIRES_MS = PROFILE_EXPIRES_DAYS * 24 * 60 * 60 * 1000;

let charts = {};
let currentUid = null;
let currentProfileData = null;
let isBooted = false;

function normalizeVipTierValue(v) {
  const s = (v || '').toString().toLowerCase().trim();
  if (s.includes('business') || s.includes('buss')) return 'business';
  if (s.includes('pro')) return 'pro';
  if (s.includes('plus')) return 'plus';
  return 'free';
}

async function getCurrentGuildVipTier() {
  const ctx = getGuildCtx();
  const guildId = normalizeString(ctx?.guildId);
  if (!guildId) return 'free';
  try {
    const snap = await getDoc(doc(normalDb, 'configGuilda', guildId));
    if (!snap.exists()) return normalizeVipTierValue(ctx?.vipTier);
    const data = snap.data() || {};
    return normalizeVipTierValue(data.vipTier ?? data.vip ?? data.planoVip ?? data.planoVIP ?? data.vipLevel ?? data.vipPlano ?? data.vipName ?? data.plano ?? data.plan ?? data.tier ?? ctx?.vipTier);
  } catch (_) {
    return normalizeVipTierValue(ctx?.vipTier);
  }
}

function showWarningToast(message) {
  const containerId = 'toast-container';
  let container = document.getElementById(containerId);
  if (!container) {
    container = document.createElement('div');
    container.id = containerId;
    container.className = 'fixed top-4 right-4 z-[9999] flex flex-col gap-2';
    document.body.appendChild(container);
  }
  const toast = document.createElement('div');
  toast.className = 'px-4 py-3 rounded-xl shadow-lg border text-sm font-medium flex items-start gap-2 max-w-[340px] bg-amber-50 text-amber-900 border-amber-200';
  toast.innerHTML = `<div class="flex-1 leading-snug">${escapeHtml(message)}</div>`;
  container.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(-4px)';
    toast.style.transition = 'all 180ms ease';
  }, 2600);
  setTimeout(() => { try { toast.remove(); } catch (_) {} }, 3000);
}

function formatRemainingTime(ms) {
  const totalMs = Math.max(0, Number(ms || 0));
  let totalMinutes = Math.ceil(totalMs / 60000);
  if (totalMinutes < 1) totalMinutes = 1;

  const days = Math.floor(totalMinutes / 1440);
  totalMinutes -= days * 1440;
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes - (hours * 60);

  const parts = [];
  if (days > 0) parts.push(`${days} dia(s)`);
  if (hours > 0) parts.push(`${hours} hora(s)`);
  if (minutes > 0) parts.push(`${minutes} min`);

  if (!parts.length) return '1 min';
  if (parts.length === 1) return parts[0];
  if (parts.length === 2) return `${parts[0]} e ${parts[1]}`;
  return `${parts[0]}, ${parts[1]} e ${parts[2]}`;
}

function createHubDb(tag = 'perfil') {
  const name = `hub_perfis_${tag}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const app = initializeApp(hubPerfisFirebaseConfig, name);
  return { app, db: getFirestore(app) };
}

async function withHubDb(tag, run) {
  const { app, db } = createHubDb(tag);
  try {
    return await run(db);
  } finally {
    try { await deleteApp(app); } catch (_) {}
  }
}

function escapeHtml(str) {
  return String(str || '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function fmtDate(value) {
  if (value == null || value === '') return 'Sem informação ainda';
  let ms = null;
  if (typeof value === 'number' && isFinite(value)) ms = value;
  else if (typeof value === 'string') {
    const t = Date.parse(value);
    ms = isFinite(t) ? t : null;
  } else if (value && typeof value.toMillis === 'function') ms = value.toMillis();
  if (!ms) return 'Sem informação ainda';
  try {
    const d = new Date(ms);
    return d.toLocaleDateString('pt-BR') + ' ' + d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  } catch (_) {
    return 'Sem informação ainda';
  }
}

function normalizeString(...values) {
  for (const v of values) {
    const s = (v ?? '').toString().trim();
    if (s) return s;
  }
  return '';
}

function toNumber(...values) {
  for (const v of values) {
    if (v == null || v === '') continue;
    const n = Number(v);
    if (isFinite(n)) return n;
  }
  return 0;
}

function getGuildCtx() {
  try { return getGuildContext() || null; } catch (_) { return null; }
}

function getCachedGuildInfo(guildId) {
  const gid = (guildId || '').toString().trim();
  let name = '';
  let createdAtMs = null;
  let tag = '';
  try {
    const rawInfo = localStorage.getItem(`guildInfo_${gid}`);
    if (rawInfo) {
      const parsed = JSON.parse(rawInfo) || {};
      name = normalizeString(parsed.name);
      createdAtMs = parsed.createdAtMs != null ? Number(parsed.createdAtMs) : null;
    }
  } catch (_) {}
  try {
    const rawTag = localStorage.getItem(`tagMembros_${gid}`);
    if (rawTag) {
      const parsed = JSON.parse(rawTag) || {};
      tag = normalizeString(parsed.value);
    }
  } catch (_) {}
  return { guildId: gid, name, createdAtMs, tag };
}

function getMembersCacheKeys(guildId) {
  const gid = (guildId || '').toString().trim();
  return gid ? [`membersList_${gid}`, 'membersList'] : ['membersList'];
}

function readMembersCache(guildId) {
  for (const key of getMembersCacheKeys(guildId)) {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) continue;
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length) return parsed;
    } catch (_) {}
  }
  return [];
}

function normalizeMember(raw) {
  const playerId = normalizeString(
    raw?.visibleId,
    raw?.idJogador,
    raw?.playerId,
    raw?.playerID,
    raw?.uid,
    raw?.id,
    raw?.userId,
    raw?.gameId,
    raw?.jogadorId
  );
  if (!playerId) return null;

  const nick = normalizeString(raw?.nick, raw?.nickname, raw?.nome, raw?.name, `Jogador ${playerId}`);

  const weeklyHonor = toNumber(
    raw?.weeklyMetaValue,
    raw?.pontosSemanais,
    raw?.pontosHonra,
    raw?.pontosDeHonra,
    raw?.honra,
    raw?.honor,
    raw?.weeklyHonor,
    raw?.weeklyHonorPoints,
    raw?.honorPoints,
    raw?.points
  );

  const guildWar = toNumber(
    raw?.guildWarMeta,
    raw?.pontosGuerra,
    raw?.guerraGuilda,
    raw?.pontosGuerraGuilda,
    raw?.guildWarPoints,
    raw?.guildWar,
    raw?.warPoints,
    raw?.guerra,
    raw?.gg
  );

  return { playerId, nick, weeklyHonor, guildWar, updatedAtMs: Date.now() };
}

function normalizeMembersArray(list) {
  const map = new Map();
  for (const raw of Array.isArray(list) ? list : []) {
    const item = normalizeMember(raw);
    if (!item) continue;
    map.set(item.playerId, item);
  }
  return Array.from(map.values());
}

async function getCurrentGuildMembers() {
  const ctx = getGuildCtx();
  const guildId = normalizeString(ctx?.guildId);
  const cached = normalizeMembersArray(readMembersCache(guildId));
  if (cached.length) return cached;
  if (!guildId) return [];
  try {
    const snap = await getDocs(collection(normalDb, 'guildas', guildId, 'membros'));
    const fresh = [];
    snap.forEach((d) => fresh.push({ id: d.id, ...(d.data() || {}) }));
    if (fresh.length) {
      try { localStorage.setItem(`membersList_${guildId}`, JSON.stringify(fresh)); } catch (_) {}
    }
    return normalizeMembersArray(fresh);
  } catch (_) {
    return [];
  }
}

function getTop3(list, field) {
  return [...(list || [])]
    .sort((a, b) => Number(b?.[field] || 0) - Number(a?.[field] || 0))
    .slice(0, 3)
    .map((item) => ({ playerId: item.playerId, nick: item.nick, pontos: Number(item[field] || 0) }));
}

function saveAccessCache(keyValue, uid) {
  try {
    localStorage.setItem(`${PROFILE_ACCESS_CACHE_PREFIX}${String(keyValue).trim()}`, JSON.stringify({ uid: String(uid).trim(), ts: Date.now() }));
  } catch (_) {}
}

function getAccessCache(keyValue) {
  try {
    const raw = localStorage.getItem(`${PROFILE_ACCESS_CACHE_PREFIX}${String(keyValue).trim()}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed?.uid ? String(parsed.uid) : null;
  } catch (_) {
    return null;
  }
}

async function resolveUidByKey(keyValue) {
  const key = String(keyValue || '').trim();
  if (!key) throw new Error('Digite a chave da guilda.');
  const cached = getAccessCache(key);
  if (cached) return cached;
  return withHubDb('resolve_key', async (db) => {
    const snap = await getDoc(doc(db, 'chave', key));
    if (!snap.exists()) throw new Error('Chave da guilda não encontrada.');
    const uid = normalizeString(snap.data()?.uid);
    if (!uid) throw new Error('UID da guilda não encontrado para essa chave.');
    saveAccessCache(key, uid);
    return uid;
  });
}

async function loadGuildProfile(uid) {
  return withHubDb('load_profile', async (db) => {
    const profileSnap = await getDoc(doc(db, 'perfil', uid));
    if (!profileSnap.exists()) throw new Error('Perfil da guilda não encontrado.');
    const profile = profileSnap.data() || {};
    let members = [];
    try {
      const membersSnap = await getDocs(collection(db, 'perfil', uid, 'membros'));
      members = membersSnap.docs.map((d) => ({ id: d.id, ...(d.data() || {}) }));
    } catch (_) {}
    let previousWeek = {};
    try {
      const prevSnap = await getDoc(doc(db, 'perfil', uid, 'semanaPassada', 'resumo'));
      previousWeek = prevSnap.exists() ? (prevSnap.data() || {}) : {};
    } catch (_) {}
    return { profile, members, previousWeek };
  });
}

async function updateWeeklyData(uid) {
  const guildInfo = getCachedGuildInfo(uid);
  const members = await getCurrentGuildMembers();
  const currentTopHonra = getTop3(members, 'weeklyHonor');
  const currentTopGuerra = getTop3(members, 'guildWar');

  return withHubDb('update_week', async (db) => {
    const profileRef = doc(db, 'perfil', uid);
    const profileSnap = await getDoc(profileRef);
    if (!profileSnap.exists()) throw new Error('Perfil da guilda não encontrado para atualizar.');
    const profileData = profileSnap.data() || {};

    const oldTopHonra = Array.isArray(profileData.topHonraSemanaAtual) ? profileData.topHonraSemanaAtual : [];
    const oldTopGuerra = Array.isArray(profileData.topGuerraSemanaAtual) ? profileData.topGuerraSemanaAtual : [];

    const batch = writeBatch(db);
    const membersCol = collection(db, 'perfil', uid, 'membros');
    const existingSnap = await getDocs(membersCol);
    const existingMap = new Map(existingSnap.docs.map((d) => [d.id, d.data() || {}]));
    const currentIds = new Set();

    for (const member of members) {
      currentIds.add(member.playerId);
      const memberRef = doc(db, 'perfil', uid, 'membros', member.playerId);
      const prev = existingMap.get(member.playerId) || {};
      const totalHonra = Number(prev.totalHonra || 0) + Number(member.weeklyHonor || 0);
      const totalGuerra = Number(prev.totalGuerra || 0) + Number(member.guildWar || 0);
      batch.set(memberRef, {
        playerId: member.playerId,
        nick: member.nick,
        honraSemanaAtual: Number(member.weeklyHonor || 0),
        guerraSemanaAtual: Number(member.guildWar || 0),
        totalHonra,
        totalGuerra,
        updatedAtMs: Date.now()
      }, { merge: true });
    }

    for (const [docId] of existingMap) {
      if (!currentIds.has(docId)) batch.delete(doc(db, 'perfil', uid, 'membros', docId));
    }

    const now = Date.now();
    batch.set(doc(db, 'perfil', uid, 'semanaPassada', 'resumo'), {
      topHonra: oldTopHonra,
      topGuerra: oldTopGuerra,
      updatedAtMs: now
    }, { merge: true });

    batch.set(profileRef, {
      nomeGuilda: normalizeString(guildInfo.name, profileData.nomeGuilda),
      dataCriacao: guildInfo.createdAtMs ?? profileData.dataCriacao ?? null,
      tag: normalizeString(guildInfo.tag, profileData.tag),
      topHonraSemanaAtual: currentTopHonra,
      topGuerraSemanaAtual: currentTopGuerra,
      updatedAtMs: now,
      lastWeekUpdateAtMs: now,
      nextWeekUpdateAtMs: now + WEEK_UPDATE_COOLDOWN_MS,
      expiresAtMs: now + PROFILE_EXPIRES_MS
    }, { merge: true });

    await batch.commit();
    return { updatedCount: members.length };
  });
}

function destroyCharts() {
  Object.values(charts).forEach((chart) => {
    try { chart.destroy(); } catch (_) {}
  });
  charts = {};
}

function chartOptions(labelText) {
  return {
    responsive: true,
    maintainAspectRatio: false,
    layout: { padding: 1 },
    plugins: {
      legend: {
        position: 'bottom',
        labels: { usePointStyle: true, pointStyle: 'circle', boxWidth: 7, padding: 5, font: { size: 8 } }
      },
      title: {
        display: true,
        text: labelText,
        font: { size: 9, weight: '700' },
        padding: { bottom: 4 }
      }
    }
  };
}

function ensureNoInfoCanvas(canvasId, labelText) {
  const canvas = document.getElementById(canvasId);
  if (!canvas || !window.Chart) return null;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  return new window.Chart(ctx, {
    type: 'pie',
    data: { labels: ['Sem informação ainda'], datasets: [{ data: [1], backgroundColor: ['#10b981'] }] },
    options: chartOptions(labelText)
  });
}

function makePieChart(canvasId, labelText, items) {
  const canvas = document.getElementById(canvasId);
  if (!canvas || !window.Chart) return;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const valid = Array.isArray(items) ? items.filter((x) => Number(x?.pontos || 0) > 0) : [];
  if (!valid.length) {
    charts[canvasId] = ensureNoInfoCanvas(canvasId, labelText);
    return;
  }
  charts[canvasId] = new window.Chart(ctx, {
    type: 'pie',
    data: {
      labels: valid.map((x) => `${x.nick} (${x.pontos})`),
      datasets: [{ data: valid.map((x) => Number(x.pontos || 0)), backgroundColor: ['#10b981', '#22c55e', '#86efac'], borderColor: '#ffffff', borderWidth: 2 }]
    },
    options: chartOptions(labelText)
  });
}

function renderMemberList(members) {
  const container = document.getElementById('members-ranking-list');
  if (!container) return;
  const sorted = [...(members || [])].sort((a, b) => (Number(b.totalHonra || 0) + Number(b.totalGuerra || 0)) - (Number(a.totalHonra || 0) + Number(a.totalGuerra || 0)));
  if (!sorted.length) {
    container.innerHTML = `<div class="rounded-xl border border-dashed border-gray-200 bg-gray-50 px-4 py-5 text-sm text-gray-500">Sem informação ainda</div>`;
    return;
  }
  container.innerHTML = sorted.map((member, index) => {
    const total = Number(member.totalHonra || 0) + Number(member.totalGuerra || 0);
    return `<div class="rounded-xl border border-gray-100 bg-white px-4 py-4 flex items-center justify-between gap-3"><div class="min-w-0"><p class="text-sm font-semibold text-gray-900">${index + 1}. ${escapeHtml(member.nick || member.playerId)}</p><p class="text-xs text-gray-500 mt-1">ID: ${escapeHtml(member.playerId || '-')}</p></div><div class="text-right shrink-0"><p class="text-sm font-bold text-emerald-700">${total}</p><p class="text-[11px] text-gray-500">Honra: ${Number(member.totalHonra || 0)} • GG: ${Number(member.totalGuerra || 0)}</p></div></div>`;
  }).join('');
}

function getNextWeekUpdateMs(profile) {
  const explicit = Number(profile?.nextWeekUpdateAtMs || 0);
  if (isFinite(explicit) && explicit > 0) return explicit;
  const last = Number(profile?.lastWeekUpdateAtMs || profile?.updatedAtMs || 0);
  if (isFinite(last) && last > 0) return last + WEEK_UPDATE_COOLDOWN_MS;
  return null;
}

function canUpdateWeek(profile) {
  const nextMs = getNextWeekUpdateMs(profile);
  if (!nextMs) return true;
  return Date.now() >= nextMs;
}

function renderUpdateInfo(profile) {
  const btn = document.getElementById('btn-update-week');
  if (!btn) return;
  const allowed = canUpdateWeek(profile);
  btn.dataset.cooldownBlocked = allowed ? '0' : '1';
  btn.classList.toggle('opacity-50', !allowed);
  btn.classList.toggle('cursor-not-allowed', !allowed);
  btn.title = allowed ? '' : `A atualização estará liberada em ${fmtDate(getNextWeekUpdateMs(profile))}.`;
}


function setAccessUiLoaded(isLoaded) {
  const card = document.getElementById('guild-access-card');
  const btn = document.getElementById('btn-update-week');
  if (card) card.classList.toggle('hidden', !!isLoaded);
  if (btn) btn.classList.toggle('hidden', !isLoaded);
}

function bindRankingToggle() {
  const btn = document.getElementById('btn-toggle-ranking');
  const text = document.getElementById('btn-toggle-ranking-text');
  const list = document.getElementById('members-ranking-list');
  if (!btn || !text || !list || btn.dataset.bound === '1') return;
  btn.dataset.bound = '1';
  btn.addEventListener('click', () => {
    const hidden = list.classList.toggle('hidden');
    text.textContent = hidden ? 'Mostrar' : 'Ocultar';
    const icon = btn.querySelector('i');
    if (icon) icon.setAttribute('data-lucide', hidden ? 'eye' : 'eye-off');
    try { if (window.lucide && typeof window.lucide.createIcons === 'function') window.lucide.createIcons(); } catch (_) {}
  });
}

function renderGuildCard(profile) {
  const nameEl = document.getElementById('profile-guild-name');
  const dateEl = document.getElementById('profile-created-at');
  const tagEl = document.getElementById('profile-guild-tag');
  const statusEl = document.getElementById('profile-status-text');
  if (nameEl) nameEl.textContent = normalizeString(profile?.nomeGuilda, 'Sem informação ainda');
  if (dateEl) dateEl.textContent = fmtDate(profile?.dataCriacao);
  if (tagEl) tagEl.textContent = normalizeString(profile?.tag, 'Sem informação ainda');
  if (statusEl) statusEl.textContent = profile?.updatedAtMs ? `Última atualização: ${fmtDate(profile.updatedAtMs)}` : 'Sem informação ainda';
  renderUpdateInfo(profile || {});
}

function renderProfileState(data) {
  currentProfileData = data;
  const { profile, members, previousWeek } = data;
  renderGuildCard(profile || {});
  destroyCharts();
  makePieChart('chart-honra-atual', 'Honra • Semana atual', Array.isArray(profile?.topHonraSemanaAtual) ? profile.topHonraSemanaAtual : []);
  makePieChart('chart-honra-passada', 'Honra • Semana passada', Array.isArray(previousWeek?.topHonra) ? previousWeek.topHonra : []);
  makePieChart('chart-guerra-atual', 'Guerra • Semana atual', Array.isArray(profile?.topGuerraSemanaAtual) ? profile.topGuerraSemanaAtual : []);
  makePieChart('chart-guerra-passada', 'Guerra • Semana passada', Array.isArray(previousWeek?.topGuerra) ? previousWeek.topGuerra : []);
  renderMemberList(members || []);
  const profileContent = document.getElementById('guild-profile-content');
  if (profileContent) profileContent.classList.remove('hidden');
  setAccessUiLoaded(true);
  bindRankingToggle();
  try { initIcons(); } catch (_) {}
}

async function handleEnterProfile() {
  const input = document.getElementById('guild-key-input');
  const button = document.getElementById('btn-enter-guild-profile');
  const keyValue = normalizeString(input?.value);
  if (!keyValue) {
    showToast('error', 'Digite a chave da guilda.');
    return;
  }
  try {
    if (button) {
      button.disabled = true;
      button.classList.add('opacity-50', 'cursor-not-allowed');
    }
    const uid = await resolveUidByKey(keyValue);
    currentUid = uid;
    const data = await loadGuildProfile(uid);
    renderProfileState(data);
    showToast('success', 'Perfil carregado com sucesso!');
  } catch (e) {
    console.error(e);
    showToast('error', e?.message || 'Não foi possível carregar o perfil.');
  } finally {
    if (button) {
      button.disabled = false;
      button.classList.remove('opacity-50', 'cursor-not-allowed');
    }
  }
}

async function handleUpdateWeek() {
  if (!currentUid) {
    showToast('error', 'Entre no perfil antes de atualizar.');
    return;
  }

  const vipTier = await getCurrentGuildVipTier();
  if (!['plus', 'pro', 'business'].includes(vipTier)) {
    showWarningToast('Opção disponível apenas para usuários VIP!');
    return;
  }

  const button = document.getElementById('btn-update-week');
  const latestProfile = currentProfileData?.profile || {};
  const nextMs = getNextWeekUpdateMs(latestProfile);
  if (nextMs && Date.now() < nextMs) {
    showWarningToast(`Você só pode atualizar novamente em ${formatRemainingTime(nextMs - Date.now())}.`);
    renderUpdateInfo(latestProfile);
    return;
  }
  try {
    if (button) {
      button.disabled = true;
      button.classList.add('opacity-50', 'cursor-not-allowed');
    }
    const result = await updateWeeklyData(currentUid);
    const data = await loadGuildProfile(currentUid);
    renderProfileState(data);
    showToast('success', `${result.updatedCount} membro(s) processado(s)!`);
  } catch (e) {
    console.error(e);
    showToast('error', e?.message || 'Não foi possível atualizar a semana.');
  } finally {
    if (button) {
      button.disabled = false;
      button.classList.remove('opacity-50', 'cursor-not-allowed');
      renderUpdateInfo(currentProfileData?.profile || {});
    }
  }
}


function bindInitialEvents() {
  const logoutBtn = document.getElementById('btn-logout');
  if (logoutBtn && logoutBtn.dataset.bound !== '1') {
    logoutBtn.dataset.bound = '1';
    logoutBtn.addEventListener('click', logout);
  }

  const enterBtn = document.getElementById('btn-enter-guild-profile');
  if (enterBtn && enterBtn.dataset.bound !== '1') {
    enterBtn.dataset.bound = '1';
    enterBtn.addEventListener('click', handleEnterProfile);
  }

  const updateBtn = document.getElementById('btn-update-week');
  if (updateBtn && updateBtn.dataset.bound !== '1') {
    updateBtn.dataset.bound = '1';
    updateBtn.addEventListener('click', handleUpdateWeek);
  }

  const input = document.getElementById('guild-key-input');
  if (input && input.dataset.bound !== '1') {
    input.dataset.bound = '1';
    input.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter') handleEnterProfile();
    });
  }

  bindRankingToggle();
}

async function boot() {
  if (isBooted) return;
  isBooted = true;
  try { setupSidebar(); } catch (e) { console.error(e); }
  try { initIcons(); } catch (e) { console.error(e); }
  setAccessUiLoaded(false);
  bindInitialEvents();

  try {
    const user = await checkAuth();
    if (!user) return;
    bindInitialEvents();
  } catch (e) {
    console.error(e);
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot, { once: true });
} else {
  boot();
}
