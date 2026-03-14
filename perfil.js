import { initializeApp, deleteApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getFirestore,
  doc,
  getDoc,
  setDoc,
  getDocs,
  collection,
  writeBatch,
  deleteDoc
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { checkAuth, setupSidebar, initIcons, logout, getGuildContext, showToast } from './logic.js';

const hubPerfisFirebaseConfig = {
  apiKey: "AIzaSyASInYDbSFxfgbF7yjXDM4THipLYdZwjXs",
  authDomain: "hub-perfis.firebaseapp.com",
  projectId: "hub-perfis",
  storageBucket: "hub-perfis.firebasestorage.app",
  messagingSenderId: "231971973267",
  appId: "1:231971973267:web:8b67cca5cfbe7b3f934566",
  measurementId: "G-0N7WY0984C"
};

const MEMBERS_CACHE_KEY = 'membersList';
const PROFILE_ACCESS_CACHE_PREFIX = 'guildProfileAccess_';

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

function fmtShortDate(value) {
  if (value == null || value === '') return 'Sem informação ainda';
  let ms = null;
  if (typeof value === 'number' && isFinite(value)) ms = value;
  else if (typeof value === 'string') {
    const t = Date.parse(value);
    ms = isFinite(t) ? t : null;
  } else if (value && typeof value.toMillis === 'function') ms = value.toMillis();
  if (!ms) return 'Sem informação ainda';
  try { return new Date(ms).toLocaleDateString('pt-BR'); } catch (_) { return 'Sem informação ainda'; }
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

function readMembersCache() {
  try {
    const raw = localStorage.getItem(MEMBERS_CACHE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (_) {
    return [];
  }
}

function normalizeMember(raw) {
  const playerId = normalizeString(
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
    raw?.pontosSemanais,
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
    raw?.pontosGuerra,
    raw?.guerraGuilda,
    raw?.pontosGuerraGuilda,
    raw?.guildWar,
    raw?.guildWarPoints,
    raw?.warPoints,
    raw?.guerra,
    raw?.gg
  );

  return {
    playerId,
    nick,
    weeklyHonor,
    guildWar,
    updatedAtMs: Date.now()
  };
}

function getNormalizedMembersFromCache() {
  const map = new Map();
  for (const raw of readMembersCache()) {
    const item = normalizeMember(raw);
    if (!item) continue;
    map.set(item.playerId, item);
  }
  return Array.from(map.values());
}

function getTop3(list, field) {
  return [...(list || [])]
    .sort((a, b) => Number(b?.[field] || 0) - Number(a?.[field] || 0))
    .slice(0, 3)
    .map((item) => ({
      playerId: item.playerId,
      nick: item.nick,
      pontos: Number(item[field] || 0)
    }));
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
    } catch (_) {
      members = [];
    }

    let previousWeek = {};
    try {
      const prevSnap = await getDoc(doc(db, 'perfil', uid, 'semanaPassada', 'resumo'));
      previousWeek = prevSnap.exists() ? (prevSnap.data() || {}) : {};
    } catch (_) {
      previousWeek = {};
    }

    return { profile, members, previousWeek };
  });
}

async function updateWeeklyData(uid) {
  const guildInfo = getCachedGuildInfo(uid);
  const members = getNormalizedMembersFromCache();
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
      if (!currentIds.has(docId)) {
        batch.delete(doc(db, 'perfil', uid, 'membros', docId));
      }
    }

    batch.set(doc(db, 'perfil', uid, 'semanaPassada', 'resumo'), {
      topHonra: oldTopHonra,
      topGuerra: oldTopGuerra,
      updatedAtMs: Date.now()
    }, { merge: true });

    batch.set(profileRef, {
      nomeGuilda: normalizeString(guildInfo.name, profileData.nomeGuilda),
      dataCriacao: guildInfo.createdAtMs ?? profileData.dataCriacao ?? null,
      tag: normalizeString(guildInfo.tag, profileData.tag),
      topHonraSemanaAtual: currentTopHonra,
      topGuerraSemanaAtual: currentTopGuerra,
      updatedAtMs: Date.now()
    }, { merge: true });

    await batch.commit();
    return {
      updatedCount: members.length,
      currentTopHonra,
      currentTopGuerra,
      previousTopHonra: oldTopHonra,
      previousTopGuerra: oldTopGuerra
    };
  });
}

let charts = {};
let currentUid = null;
let currentProfileData = null;

function destroyCharts() {
  Object.values(charts).forEach((chart) => {
    try { chart.destroy(); } catch (_) {}
  });
  charts = {};
}

function ensureNoInfoCanvas(canvasId, labelText) {
  const canvas = document.getElementById(canvasId);
  if (!canvas) return null;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  if (!window.Chart) return null;
  return new window.Chart(ctx, {
    type: 'pie',
    data: {
      labels: ['Sem informação ainda'],
      datasets: [{ data: [1] }]
    },
    options: {
      responsive: true,
      plugins: {
        legend: { position: 'bottom' },
        title: { display: true, text: labelText }
      }
    }
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
      datasets: [{ data: valid.map((x) => Number(x.pontos || 0)) }]
    },
    options: {
      responsive: true,
      plugins: {
        legend: { position: 'bottom' },
        title: { display: true, text: labelText }
      }
    }
  });
}

function renderMemberList(members) {
  const container = document.getElementById('members-ranking-list');
  if (!container) return;
  const sorted = [...(members || [])].sort((a, b) => {
    const scoreA = Number(a.totalHonra || 0) + Number(a.totalGuerra || 0);
    const scoreB = Number(b.totalHonra || 0) + Number(b.totalGuerra || 0);
    return scoreB - scoreA;
  });

  if (!sorted.length) {
    container.innerHTML = `<div class="rounded-xl border border-dashed border-gray-200 bg-gray-50 px-4 py-5 text-sm text-gray-500">Sem informação ainda</div>`;
    return;
  }

  container.innerHTML = sorted.map((member, index) => {
    const total = Number(member.totalHonra || 0) + Number(member.totalGuerra || 0);
    return `
      <div class="rounded-xl border border-gray-100 bg-white px-4 py-4 flex items-center justify-between gap-3">
        <div class="min-w-0">
          <p class="text-sm font-semibold text-gray-900">${index + 1}. ${escapeHtml(member.nick || member.playerId)}</p>
          <p class="text-xs text-gray-500 mt-1">ID: ${escapeHtml(member.playerId || '-')}</p>
        </div>
        <div class="text-right shrink-0">
          <p class="text-sm font-bold text-emerald-700">${total}</p>
          <p class="text-[11px] text-gray-500">Honra: ${Number(member.totalHonra || 0)} • GG: ${Number(member.totalGuerra || 0)}</p>
        </div>
      </div>`;
  }).join('');
}

function renderGuildCard(profile) {
  const nameEl = document.getElementById('profile-guild-name');
  const dateEl = document.getElementById('profile-created-at');
  const tagEl = document.getElementById('profile-guild-tag');
  const statusEl = document.getElementById('profile-status-text');

  if (nameEl) nameEl.textContent = normalizeString(profile?.nomeGuilda, 'Sem informação ainda');
  if (dateEl) dateEl.textContent = fmtDate(profile?.dataCriacao);
  if (tagEl) tagEl.textContent = normalizeString(profile?.tag, 'Sem informação ainda');
  if (statusEl) statusEl.textContent = normalizeString(profile?.updatedAtMs ? `Última atualização: ${fmtDate(profile.updatedAtMs)}` : '', 'Sem informação ainda');
}

function renderProfileState(data) {
  currentProfileData = data;
  const { profile, members, previousWeek } = data;
  renderGuildCard(profile || {});
  destroyCharts();
  makePieChart('chart-honra-atual', 'Honra • Semana atual', Array.isArray(profile?.topHonraSemanaAtual) ? profile.topHonraSemanaAtual : []);
  makePieChart('chart-guerra-atual', 'Guerra de guilda • Semana atual', Array.isArray(profile?.topGuerraSemanaAtual) ? profile.topGuerraSemanaAtual : []);
  makePieChart('chart-honra-passada', 'Honra • Semana passada', Array.isArray(previousWeek?.topHonra) ? previousWeek.topHonra : []);
  makePieChart('chart-guerra-passada', 'Guerra de guilda • Semana passada', Array.isArray(previousWeek?.topGuerra) ? previousWeek.topGuerra : []);
  renderMemberList(members || []);

  const profileContent = document.getElementById('guild-profile-content');
  if (profileContent) profileContent.classList.remove('hidden');
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
    button.disabled = true;
    button.classList.add('opacity-50', 'cursor-not-allowed');
    const uid = await resolveUidByKey(keyValue);
    currentUid = uid;
    const data = await loadGuildProfile(uid);
    renderProfileState(data);
    showToast('success', 'Perfil carregado com sucesso!');
  } catch (e) {
    console.error(e);
    showToast('error', e?.message || 'Não foi possível carregar o perfil.');
  } finally {
    button.disabled = false;
    button.classList.remove('opacity-50', 'cursor-not-allowed');
  }
}

async function handleRefreshWeek() {
  if (!currentUid) {
    showToast('error', 'Entre no perfil da guilda antes de atualizar a semana.');
    return;
  }
  const btn = document.getElementById('btn-refresh-week');
  try {
    btn.disabled = true;
    btn.classList.add('opacity-50', 'cursor-not-allowed');
    const result = await updateWeeklyData(currentUid);
    const data = await loadGuildProfile(currentUid);
    renderProfileState(data);
    showToast('success', `Semana atualizada! ${Number(result.updatedCount || 0)} membro(s) processado(s).`);
  } catch (e) {
    console.error(e);
    showToast('error', e?.message || 'Não foi possível atualizar a semana.');
  } finally {
    btn.disabled = false;
    btn.classList.remove('opacity-50', 'cursor-not-allowed');
  }
}

function bindUi() {
  const logoutBtn = document.getElementById('btn-logout');
  if (logoutBtn) logoutBtn.onclick = logout;

  const enterBtn = document.getElementById('btn-enter-guild-profile');
  const input = document.getElementById('guild-key-input');
  const refreshBtn = document.getElementById('btn-refresh-week');

  enterBtn?.addEventListener('click', handleEnterProfile);
  input?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') handleEnterProfile();
  });
  refreshBtn?.addEventListener('click', handleRefreshWeek);
}

setupSidebar();
initIcons();
checkAuth().then((user) => {
  if (!user) return;
  bindUi();
});
