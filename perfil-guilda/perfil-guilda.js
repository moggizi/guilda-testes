import {
  doc,
  getDoc,
  getDocs,
  writeBatch,
  collection,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import {
  checkAuth,
  setupSidebar,
  initIcons,
  logout,
  getGuildContext,
  showToast,
  db as normalDb
} from '../logic.js';

const STATS_COLLECTION = 'estatisticas';
const STATS_CACHE_PREFIX = 'guildStats_';
const STATS_CACHE_VERSION = 2;
const STATS_CACHE_TTL_MS = 3 * 24 * 60 * 60 * 1000;
const WEEKLY_RANK_CACHE_PREFIX = 'guildWeeklyRanking_';
const WEEKLY_RANK_CACHE_VERSION = 2;
const WEEKLY_RANK_CACHE_TTL_MS = 3 * 24 * 60 * 60 * 1000;
const WEEK_UPDATE_COOLDOWN_DAYS = 4;
const WEEK_UPDATE_COOLDOWN_MS = WEEK_UPDATE_COOLDOWN_DAYS * 24 * 60 * 60 * 1000;
const PROFILE_EXPIRES_DAYS = 4;
const PROFILE_EXPIRES_MS = PROFILE_EXPIRES_DAYS * 24 * 60 * 60 * 1000;

let charts = {};
let currentUid = null;
let currentProfileData = null;
let isBooted = false;
let currentRankingMode = 'general';

function normalizeVipTierValue(v) {
  const s = (v || '').toString().toLowerCase().trim();
  if (s.includes('vital') || s.includes('life') || s.includes('parceiro') || s.includes('partner')) return 'parceiro';
  if (s.includes('ultra')) return 'ultra';
  if (s.includes('business') || s.includes('buss')) return 'business';
  if (s.includes('pro')) return 'pro';
  if (s.includes('plus')) return 'plus';
  return 'free';
}

function canUseStatsTier(tierValue) {
  return ['plus', 'pro', 'business', 'ultra', 'parceiro'].includes(normalizeVipTierValue(tierValue));
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

function escapeHtml(str) {
  return String(str || '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function fmtDate(value) {
  if (value == null || value === '') return 'Sem informacao ainda';
  let ms = null;
  if (typeof value === 'number' && isFinite(value)) ms = value;
  else if (typeof value === 'string') {
    const t = Date.parse(value);
    ms = isFinite(t) ? t : null;
  } else if (value && typeof value.toMillis === 'function') ms = value.toMillis();
  if (!ms) return 'Sem informacao ainda';
  try {
    const d = new Date(ms);
    return d.toLocaleDateString('pt-BR') + ' ' + d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  } catch (_) {
    return 'Sem informacao ainda';
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

function statsDocRef(guildId) {
  const gid = normalizeString(guildId);
  return gid ? doc(normalDb, STATS_COLLECTION, gid) : null;
}

function statsCacheKey(guildId) {
  return `${STATS_CACHE_PREFIX}${normalizeString(guildId)}`;
}

function readStatsCache(guildId) {
  try {
    const raw = localStorage.getItem(statsCacheKey(guildId));
    if (!raw) return null;
    const cached = JSON.parse(raw);
    if (!cached || cached.guildId !== normalizeString(guildId)) return null;
    if (cached.v !== STATS_CACHE_VERSION) return null;
    if ((Date.now() - Number(cached.ts || 0)) > STATS_CACHE_TTL_MS) return null;
    return cached.data || null;
  } catch (_) {
    return null;
  }
}

function writeStatsCache(guildId, data) {
  try {
    localStorage.setItem(statsCacheKey(guildId), JSON.stringify({
      v: STATS_CACHE_VERSION,
      guildId: normalizeString(guildId),
      ts: Date.now(),
      data
    }));
  } catch (_) {}
}

function weeklyRankCacheKey(guildId) {
  return `${WEEKLY_RANK_CACHE_PREFIX}${normalizeString(guildId)}`;
}

function readWeeklyRankCache(guildId) {
  try {
    const raw = localStorage.getItem(weeklyRankCacheKey(guildId));
    if (!raw) return [];
    const cached = JSON.parse(raw);
    if (!cached || cached.guildId !== normalizeString(guildId)) return [];
    if (cached.v !== WEEKLY_RANK_CACHE_VERSION) return [];
    if ((Date.now() - Number(cached.ts || 0)) > WEEKLY_RANK_CACHE_TTL_MS) return [];
    return normalizeWeeklyRanking(cached.ranking);
  } catch (_) {
    return [];
  }
}

function writeWeeklyRankCache(guildId, ranking) {
  try {
    localStorage.setItem(weeklyRankCacheKey(guildId), JSON.stringify({
      v: WEEKLY_RANK_CACHE_VERSION,
      guildId: normalizeString(guildId),
      ts: Date.now(),
      ranking: normalizeWeeklyRanking(ranking)
    }));
  } catch (_) {}
}

function getCachedGuildInfo(guildId) {
  const gid = normalizeString(guildId);
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

async function getGuildInfo(guildId) {
  const cached = getCachedGuildInfo(guildId);
  if (cached.name && cached.createdAtMs && cached.tag) return cached;
  try {
    const [guildSnap, cfgSnap] = await Promise.all([
      getDoc(doc(normalDb, 'guildas', guildId)).catch(() => null),
      getDoc(doc(normalDb, 'configGuilda', guildId)).catch(() => null)
    ]);
    const guild = guildSnap?.exists?.() ? (guildSnap.data() || {}) : {};
    const cfg = cfgSnap?.exists?.() ? (cfgSnap.data() || {}) : {};
    const name = normalizeString(cfg.name, guild.name, getGuildCtx()?.guildName);
    const tag = normalizeString(cfg.tagMembros, cfg.tag, cfg.tagGuilda, guild.tagMembros, guild.tag, cached.tag);
    const createdAtRaw = guild.createdAt ?? cfg.createdAt ?? guild.dataCriacao ?? cfg.dataCriacao;
    const createdAtMs = toMillis(createdAtRaw);
    return {
      guildId,
      name: normalizeString(name, cached.name),
      createdAtMs: createdAtMs ?? cached.createdAtMs,
      tag
    };
  } catch (_) {
    return cached;
  }
}

function toMillis(value) {
  try {
    if (value == null || value === '') return null;
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string') {
      const n = Number(value);
      if (Number.isFinite(n)) return n;
      const parsed = Date.parse(value);
      return Number.isFinite(parsed) ? parsed : null;
    }
    if (value && typeof value.toMillis === 'function') return value.toMillis();
    if (typeof value?.seconds === 'number') return Math.floor(Number(value.seconds) * 1000);
  } catch (_) {}
  return null;
}

function getMembersCacheKeys(guildId) {
  const gid = normalizeString(guildId);
  return gid ? [`membersList_${gid}_membros`, `membersList_${gid}`, 'membersList'] : ['membersList'];
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
    raw?.jogadorId,
    raw?.jogadorID,
    raw?.idff,
    raw?.idFreeFire
  );
  if (!playerId || playerId === '__meta__') return null;

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
    raw?.metaSemanal,
    raw?.honraSemanal,
    raw?.honraAtual,
    raw?.pontosMeta,
    raw?.meta,
    raw?.points,
    raw?.pontos
  );
  const guildWar = toNumber(
    raw?.guildWarMeta,
    raw?.guildWarMetaValue,
    raw?.pontosGuerra,
    raw?.guerraGuilda,
    raw?.pontosGuerraGuilda,
    raw?.guildWarPoints,
    raw?.guildWar,
    raw?.weeklyGuildWar,
    raw?.warPoints,
    raw?.metaGuerra,
    raw?.guerraAtual,
    raw?.guerra,
    raw?.gg
  );

  return { playerId, nick, weeklyHonor, guildWar, updatedAtMs: Date.now() };
}

function normalizeStatsMember(raw) {
  const playerId = normalizeString(raw?.playerId, raw?.visibleId, raw?.id);
  if (!playerId || playerId === '__meta__') return null;
  return {
    playerId,
    nick: normalizeString(raw?.nick, raw?.name, `Jogador ${playerId}`),
    honraSemanaAtual: toNumber(raw?.honraSemanaAtual, raw?.weeklyHonor),
    guerraSemanaAtual: toNumber(raw?.guerraSemanaAtual, raw?.guildWar),
    totalHonra: toNumber(raw?.totalHonra),
    totalGuerra: toNumber(raw?.totalGuerra),
    updatedAtMs: toNumber(raw?.updatedAtMs)
  };
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

async function getCurrentGuildMembers(options = {}) {
  const ctx = getGuildCtx();
  const guildId = normalizeString(options.guildId, ctx?.guildId);
  if (!guildId) return [];
  if (options.forceRefresh !== true) {
    const cached = normalizeMembersArray(readMembersCache(guildId));
    if (cached.length) return cached;
  }

  try {
    const snap = await getDocs(collection(normalDb, 'guildas', guildId, 'membros'));
    const fresh = [];
    snap.forEach((d) => {
      if (d.id === '__meta__') return;
      fresh.push({ id: d.id, ...(d.data() || {}) });
    });
    try {
      localStorage.setItem(`membersList_${guildId}_membros`, JSON.stringify(fresh));
      localStorage.setItem(`membersList_${guildId}`, JSON.stringify(fresh));
    } catch (_) {}
    return normalizeMembersArray(fresh);
  } catch (_) {
    if (options.forceRefresh === true) {
      throw new Error('Nao foi possivel ler a lista atual de membros.');
    }
    return normalizeMembersArray(readMembersCache(guildId));
  }
}

function getTop3(list, field) {
  return [...(list || [])]
    .sort((a, b) => Number(b?.[field] || 0) - Number(a?.[field] || 0))
    .slice(0, 3)
    .map((item) => ({ playerId: item.playerId, nick: item.nick, pontos: Number(item[field] || 0) }));
}

function hasPointItems(list) {
  return Array.isArray(list) && list.some((item) => Number(item?.pontos || 0) > 0);
}

function getWeeklyTopFromStatsMembers(members, field) {
  return [...(members || [])]
    .sort((a, b) => Number(b?.[field] || 0) - Number(a?.[field] || 0))
    .slice(0, 3)
    .map((item) => ({ playerId: item.playerId, nick: item.nick, pontos: Number(item[field] || 0) }));
}

function normalizeWeeklyRanking(list) {
  return (Array.isArray(list) ? list : [])
    .map((member) => {
      const playerId = normalizeString(member?.playerId, member?.visibleId, member?.id);
      if (!playerId) return null;
      const honra = toNumber(member?.honra, member?.honraSemanaAtual, member?.weeklyHonor);
      const guerra = toNumber(member?.guerra, member?.guerraSemanaAtual, member?.guildWar);
      return {
        playerId,
        nick: normalizeString(member?.nick, member?.name, `Jogador ${playerId}`),
        honra,
        guerra,
        total: toNumber(member?.total, honra + guerra)
      };
    })
    .filter(Boolean)
    .sort((a, b) => Number(b.total || 0) - Number(a.total || 0));
}

function buildWeeklyRanking(members, liveMembers) {
  const source = Array.isArray(members) && members.length
    ? members.map((member) => ({
        playerId: member.playerId,
        nick: member.nick,
        honra: Number(member.honraSemanaAtual || 0),
        guerra: Number(member.guerraSemanaAtual || 0)
      }))
    : (Array.isArray(liveMembers) ? liveMembers : []).map((member) => ({
        playerId: member.playerId,
        nick: member.nick,
        honra: Number(member.weeklyHonor || 0),
        guerra: Number(member.guildWar || 0)
      }));

  return normalizeWeeklyRanking(source.map((member) => ({
    ...member,
    total: Number(member.honra || 0) + Number(member.guerra || 0)
  })));
}

async function loadGuildProfile(guildId, options = {}) {
  const gid = normalizeString(guildId);
  if (!gid) throw new Error('Guilda nao encontrada.');

  if (options.forceRefresh !== true) {
    const cached = readStatsCache(gid);
    if (cached) return cached;
  }

  const statsRef = statsDocRef(gid);
  const guildInfo = await getGuildInfo(gid);
  let profile = {
    nomeGuilda: normalizeString(guildInfo.name, getGuildCtx()?.guildName, 'Sem informacao ainda'),
    dataCriacao: guildInfo.createdAtMs ?? null,
    tag: normalizeString(guildInfo.tag),
    updatedAtMs: null
  };
  let members = [];
  let previousWeek = {};
  let weeklyRanking = readWeeklyRankCache(gid);

  try {
    const profileSnap = await getDoc(statsRef);
    if (profileSnap.exists()) profile = { ...profile, ...(profileSnap.data() || {}) };
  } catch (_) {}
  profile.tag = normalizeString(guildInfo.tag, profile.tag);

  const savedWeeklyRanking = normalizeWeeklyRanking(profile.rankingSemanaAtual);
  const savedWeeklyRankingExpiresAt = Number(profile.rankingSemanaAtualExpiresAtMs || 0);
  if (savedWeeklyRanking.length && (!savedWeeklyRankingExpiresAt || savedWeeklyRankingExpiresAt > Date.now())) {
    weeklyRanking = savedWeeklyRanking;
  }

  try {
    const membersSnap = await getDocs(collection(normalDb, STATS_COLLECTION, gid, 'membros'));
    const list = [];
    membersSnap.forEach((d) => {
      const item = normalizeStatsMember({ id: d.id, ...(d.data() || {}) });
      if (item) list.push(item);
    });
    members = list;
  } catch (_) {}

  try {
    const prevSnap = await getDoc(doc(normalDb, STATS_COLLECTION, gid, 'semanaPassada', 'resumo'));
    previousWeek = prevSnap.exists() ? (prevSnap.data() || {}) : {};
  } catch (_) {}

  if (!hasPointItems(profile.topHonraSemanaAtual)) {
    const fromStats = getWeeklyTopFromStatsMembers(members, 'honraSemanaAtual');
    profile.topHonraSemanaAtual = hasPointItems(fromStats) ? fromStats : [];
  }
  if (!hasPointItems(profile.topGuerraSemanaAtual)) {
    const fromStats = getWeeklyTopFromStatsMembers(members, 'guerraSemanaAtual');
    profile.topGuerraSemanaAtual = hasPointItems(fromStats) ? fromStats : [];
  }
  if (!hasPointItems(previousWeek.topHonra)) {
    previousWeek.topHonra = [];
  }
  if (!hasPointItems(previousWeek.topGuerra)) {
    previousWeek.topGuerra = [];
  }
  if (!weeklyRanking.length) weeklyRanking = buildWeeklyRanking(members, []);
  if (weeklyRanking.length) writeWeeklyRankCache(gid, weeklyRanking);

  const data = { profile, members, previousWeek, liveMembers: [], weeklyRanking };
  writeStatsCache(gid, data);
  return data;
}

function createBatchState() {
  return { batch: writeBatch(normalDb), ops: 0 };
}

async function commitBatchIfNeeded(state, force = false) {
  if (!state.ops) return;
  if (!force && state.ops < 450) return;
  await state.batch.commit();
  state.batch = writeBatch(normalDb);
  state.ops = 0;
}

async function updateWeeklyData(guildId) {
  const gid = normalizeString(guildId);
  if (!gid) throw new Error('Guilda nao encontrada.');

  const members = await getCurrentGuildMembers({ guildId: gid, forceRefresh: true });
  if (!members.length) throw new Error('Nenhum membro encontrado para atualizar.');

  const before = await loadGuildProfile(gid, { forceRefresh: true });
  const existingMap = new Map((before.members || []).map((item) => [String(item.playerId), item]));
  const currentIds = new Set();
  const now = Date.now();
  const guildInfo = await getGuildInfo(gid);
  const currentTopHonra = getTop3(members, 'weeklyHonor');
  const currentTopGuerra = getTop3(members, 'guildWar');
  const fallbackOldTopHonra = getWeeklyTopFromStatsMembers(before.members || [], 'honraSemanaAtual');
  const fallbackOldTopGuerra = getWeeklyTopFromStatsMembers(before.members || [], 'guerraSemanaAtual');
  const visibleProfile = currentProfileData?.profile || {};
  const visibleWeeklyRanking = normalizeWeeklyRanking(currentProfileData?.weeklyRanking);
  const beforeWeeklyRanking = normalizeWeeklyRanking(before.profile?.rankingSemanaAtual).length
    ? normalizeWeeklyRanking(before.profile?.rankingSemanaAtual)
    : normalizeWeeklyRanking(before.weeklyRanking);
  const oldTopHonra = hasPointItems(before.profile?.topHonraSemanaAtual)
    ? before.profile.topHonraSemanaAtual
    : (hasPointItems(visibleProfile?.topHonraSemanaAtual)
        ? visibleProfile.topHonraSemanaAtual
        : (hasPointItems(fallbackOldTopHonra) ? fallbackOldTopHonra : []));
  const oldTopGuerra = hasPointItems(before.profile?.topGuerraSemanaAtual)
    ? before.profile.topGuerraSemanaAtual
    : (hasPointItems(visibleProfile?.topGuerraSemanaAtual)
        ? visibleProfile.topGuerraSemanaAtual
        : (hasPointItems(fallbackOldTopGuerra) ? fallbackOldTopGuerra : []));
  const oldWeeklyRanking = beforeWeeklyRanking.length ? beforeWeeklyRanking : visibleWeeklyRanking;
  const currentWeeklyRanking = buildWeeklyRanking([], members);

  const statsRef = statsDocRef(gid);
  const state = createBatchState();

  for (const member of members) {
    currentIds.add(member.playerId);
    const prev = existingMap.get(member.playerId) || {};
    const totalHonra = Number(prev.totalHonra || 0) + Number(member.weeklyHonor || 0);
    const totalGuerra = Number(prev.totalGuerra || 0) + Number(member.guildWar || 0);

    state.batch.set(doc(normalDb, STATS_COLLECTION, gid, 'membros', member.playerId), {
      playerId: member.playerId,
      nick: member.nick,
      honraSemanaAtual: Number(member.weeklyHonor || 0),
      guerraSemanaAtual: Number(member.guildWar || 0),
      totalHonra,
      totalGuerra,
      updatedAtMs: now
    }, { merge: true });
    state.ops += 1;
    await commitBatchIfNeeded(state);
  }

  for (const [docId] of existingMap) {
    if (!currentIds.has(docId) && members.length > 0) {
      state.batch.delete(doc(normalDb, STATS_COLLECTION, gid, 'membros', docId));
      state.ops += 1;
      await commitBatchIfNeeded(state);
    }
  }

  state.batch.set(doc(normalDb, STATS_COLLECTION, gid, 'semanaPassada', 'resumo'), {
    topHonra: oldTopHonra,
    topGuerra: oldTopGuerra,
    rankingSemana: oldWeeklyRanking,
    updatedAtMs: now
  }, { merge: true });
  state.ops += 1;

  state.batch.set(statsRef, {
    guildId: gid,
    nomeGuilda: normalizeString(guildInfo.name, before.profile?.nomeGuilda, getGuildCtx()?.guildName),
    dataCriacao: guildInfo.createdAtMs ?? before.profile?.dataCriacao ?? null,
    tag: normalizeString(guildInfo.tag, before.profile?.tag),
    topHonraSemanaAtual: currentTopHonra,
    topGuerraSemanaAtual: currentTopGuerra,
    rankingSemanaAtual: currentWeeklyRanking,
    rankingSemanaAtualUpdatedAtMs: now,
    rankingSemanaAtualExpiresAtMs: now + WEEKLY_RANK_CACHE_TTL_MS,
    updatedAt: serverTimestamp(),
    updatedAtMs: now,
    lastWeekUpdateAtMs: now,
    nextWeekUpdateAtMs: now + WEEK_UPDATE_COOLDOWN_MS,
    expiresAtMs: now + PROFILE_EXPIRES_MS
  }, { merge: true });
  state.ops += 1;

  await commitBatchIfNeeded(state, true);
  writeWeeklyRankCache(gid, currentWeeklyRanking);
  const data = await loadGuildProfile(gid, { forceRefresh: true });
  writeStatsCache(gid, data);
  return { updatedCount: members.length, data };
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
    data: { labels: ['Sem informacao ainda'], datasets: [{ data: [1], backgroundColor: ['#10b981'] }] },
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
      datasets: [{
        data: valid.map((x) => Number(x.pontos || 0)),
        backgroundColor: ['#13d440', '#cad413', '#d43313'],
        borderColor: 'transparent',
        borderWidth: 0,
        hoverBorderColor: 'transparent',
        hoverBorderWidth: 0,
        spacing: 0
      }]
    },
    options: chartOptions(labelText)
  });
}

function renderWeeklyRanking(weeklyRanking, members, liveMembers) {
  const container = document.getElementById('weekly-ranking-list');
  if (!container) return;
  const sorted = normalizeWeeklyRanking(weeklyRanking).length
    ? normalizeWeeklyRanking(weeklyRanking)
    : buildWeeklyRanking(members, liveMembers);

  if (!sorted.length) {
    container.innerHTML = `<div class="rounded-xl border border-dashed border-gray-200 bg-gray-50 px-4 py-5 text-sm text-gray-500">Sem informacao ainda</div>`;
    return;
  }

  container.innerHTML = sorted.map((member, index) => `
    <div class="rounded-xl border border-gray-100 bg-white px-4 py-4 flex items-center justify-between gap-3">
      <div class="min-w-0">
        <p class="text-sm font-semibold text-gray-900">${index + 1}. ${escapeHtml(member.nick || member.playerId)}</p>
        <p class="text-xs text-gray-500 mt-1">ID: ${escapeHtml(member.playerId || '-')}</p>
      </div>
      <div class="text-right shrink-0">
        <p class="text-sm font-bold text-emerald-700">${Number(member.total || 0)}</p>
        <p class="text-[11px] text-gray-500">Honra: ${Number(member.honra || 0)} - GG: ${Number(member.guerra || 0)}</p>
      </div>
    </div>
  `).join('');
}

function renderMemberList(members) {
  const container = document.getElementById('members-ranking-list');
  if (!container) return;
  const sorted = [...(members || [])].sort((a, b) => (Number(b.totalHonra || 0) + Number(b.totalGuerra || 0)) - (Number(a.totalHonra || 0) + Number(a.totalGuerra || 0)));
  if (!sorted.length) {
    container.innerHTML = `<div class="rounded-xl border border-dashed border-gray-200 bg-gray-50 px-4 py-5 text-sm text-gray-500">Sem informacao ainda</div>`;
    return;
  }
  container.innerHTML = sorted.map((member, index) => {
    const total = Number(member.totalHonra || 0) + Number(member.totalGuerra || 0);
    return `<div class="rounded-xl border border-gray-100 bg-white px-4 py-4 flex items-center justify-between gap-3"><div class="min-w-0"><p class="text-sm font-semibold text-gray-900">${index + 1}. ${escapeHtml(member.nick || member.playerId)}</p><p class="text-xs text-gray-500 mt-1">ID: ${escapeHtml(member.playerId || '-')}</p></div><div class="text-right shrink-0"><p class="text-sm font-bold text-emerald-700">${total}</p><p class="text-[11px] text-gray-500">Honra: ${Number(member.totalHonra || 0)} - GG: ${Number(member.totalGuerra || 0)}</p></div></div>`;
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
  btn.title = allowed ? '' : `A atualizacao estara liberada em ${fmtDate(getNextWeekUpdateMs(profile))}.`;
}

function setAccessCard(state = 'loading', message = '') {
  const card = document.getElementById('guild-access-card');
  if (!card) return;
  const icon = state === 'locked' ? 'lock' : (state === 'error' ? 'circle-alert' : 'loader-circle');
  const title = state === 'locked'
    ? 'Disponivel no plano PLUS ou superior'
    : (state === 'error' ? 'Nao foi possivel carregar' : 'Carregando estatisticas');
  const extra = state === 'locked'
    ? `<a href="/upgrade" class="mt-4 inline-flex items-center justify-center gap-2 px-4 py-2 rounded-xl bg-emerald-600 text-white text-xs font-bold hover:bg-emerald-700"><i data-lucide="zap" class="w-4 h-4"></i>Ver planos</a>`
    : '';
  card.classList.remove('hidden');
  card.innerHTML = `
    <div class="flex items-start gap-3">
      <div class="w-10 h-10 rounded-xl bg-emerald-50 text-emerald-700 flex items-center justify-center shrink-0">
        <i data-lucide="${icon}" class="w-5 h-5 ${state === 'loading' ? 'animate-spin' : ''}"></i>
      </div>
      <div class="min-w-0">
        <h3 class="font-semibold text-gray-900">${title}</h3>
        <p class="text-xs text-gray-500 mt-1">${escapeHtml(message || 'Abrindo os dados da guilda logada no painel.')}</p>
        ${extra}
      </div>
    </div>
  `;
  try { initIcons(); } catch (_) {}
}

function setAccessUiLoaded(isLoaded) {
  const card = document.getElementById('guild-access-card');
  const btn = document.getElementById('btn-update-week');
  if (card) card.classList.toggle('hidden', !!isLoaded);
  if (btn) btn.classList.toggle('hidden', !isLoaded);
}

function setRankingButtonState(button, active) {
  if (!button) return;
  button.classList.toggle('bg-emerald-600', active);
  button.classList.toggle('text-white', active);
  button.classList.toggle('shadow-sm', active);
  button.classList.toggle('bg-white', !active);
  button.classList.toggle('text-gray-600', !active);
  button.classList.toggle('hover:bg-gray-50', !active);
}

function setRankingMode(mode = 'general') {
  currentRankingMode = mode === 'weekly' ? 'weekly' : 'general';
  const title = document.getElementById('ranking-title');
  const subtitle = document.getElementById('ranking-subtitle');
  const generalList = document.getElementById('members-ranking-list');
  const weeklyList = document.getElementById('weekly-ranking-list');
  const isWeekly = currentRankingMode === 'weekly';

  if (generalList) generalList.classList.toggle('hidden', isWeekly);
  if (weeklyList) weeklyList.classList.toggle('hidden', !isWeekly);
  if (title) title.textContent = isWeekly ? 'Ranking semanal' : 'Ranking geral';
  if (subtitle) {
    subtitle.textContent = isWeekly
      ? 'Ordem da maior pontuacao da semana para a menor.'
      : 'Ordem do maior total acumulado para o menor.';
  }
  document.querySelectorAll('[data-ranking-mode]').forEach((button) => {
    setRankingButtonState(button, button.dataset.rankingMode === currentRankingMode);
  });
}

function bindRankingFilter() {
  document.querySelectorAll('[data-ranking-mode]').forEach((button) => {
    if (button.dataset.bound === '1') return;
    button.dataset.bound = '1';
    button.addEventListener('click', () => setRankingMode(button.dataset.rankingMode));
  });
  setRankingMode(currentRankingMode);
}

function renderGuildCard(profile) {
  const nameEl = document.getElementById('profile-guild-name');
  const dateEl = document.getElementById('profile-created-at');
  const tagEl = document.getElementById('profile-guild-tag');
  const statusEl = document.getElementById('profile-status-text');
  if (nameEl) nameEl.textContent = normalizeString(profile?.nomeGuilda, 'Sem informacao ainda');
  if (dateEl) dateEl.textContent = fmtDate(profile?.dataCriacao);
  if (tagEl) tagEl.textContent = normalizeString(profile?.tag, 'Sem informacao ainda');
  if (statusEl) statusEl.textContent = profile?.updatedAtMs ? `Ultima atualizacao: ${fmtDate(profile.updatedAtMs)}` : 'Sem informacao ainda';
  renderUpdateInfo(profile || {});
}

function renderProfileState(data) {
  currentProfileData = data;
  const { profile, members, previousWeek, liveMembers, weeklyRanking } = data;
  renderGuildCard(profile || {});
  destroyCharts();
  makePieChart('chart-honra-atual', 'Honra - Semana atual', Array.isArray(profile?.topHonraSemanaAtual) ? profile.topHonraSemanaAtual : []);
  makePieChart('chart-honra-passada', 'Honra - Semana passada', Array.isArray(previousWeek?.topHonra) ? previousWeek.topHonra : []);
  makePieChart('chart-guerra-atual', 'Guerra - Semana atual', Array.isArray(profile?.topGuerraSemanaAtual) ? profile.topGuerraSemanaAtual : []);
  makePieChart('chart-guerra-passada', 'Guerra - Semana passada', Array.isArray(previousWeek?.topGuerra) ? previousWeek.topGuerra : []);
  renderWeeklyRanking(weeklyRanking || [], members || [], liveMembers || []);
  renderMemberList(members || []);
  const profileContent = document.getElementById('guild-profile-content');
  if (profileContent) profileContent.classList.remove('hidden');
  setAccessUiLoaded(true);
  bindRankingFilter();
  try { initIcons(); } catch (_) {}
}

async function loadCurrentGuildStats(options = {}) {
  const ctx = getGuildCtx();
  const guildId = normalizeString(ctx?.guildId);
  if (!guildId) throw new Error('Guilda nao encontrada.');
  currentUid = guildId;

  if (options.useCache !== false) {
    const cached = readStatsCache(guildId);
    if (cached) {
      renderProfileState(cached);
      return;
    }
  }

  const data = await loadGuildProfile(guildId, { forceRefresh: options.forceRefresh === true });
  renderProfileState(data);
}

function setUpdateButtonLoading(button, isLoading) {
  if (!button) return;
  if (isLoading) {
    button.dataset.loading = '1';
    if (!button.dataset.defaultHtml) button.dataset.defaultHtml = button.innerHTML;
    button.disabled = true;
    button.classList.add('opacity-70', 'cursor-not-allowed');
    button.innerHTML = '<i data-lucide="refresh-cw" class="w-4 h-4 animate-spin"></i>Atualizando...';
  } else {
    button.dataset.loading = '0';
    button.disabled = false;
    button.classList.remove('opacity-70', 'cursor-not-allowed');
    if (button.dataset.defaultHtml) button.innerHTML = button.dataset.defaultHtml;
  }
  try { initIcons(); } catch (_) {}
}

async function handleUpdateWeek() {
  if (!currentUid) {
    showToast('error', 'A guilda ainda nao foi carregada.');
    return;
  }

  const vipTier = await getCurrentGuildVipTier();
  if (!canUseStatsTier(vipTier)) {
    showWarningToast('Opcao disponivel apenas no plano PLUS ou superior.');
    return;
  }

  const button = document.getElementById('btn-update-week');
  if (button?.dataset.loading === '1') return;
  const latestProfile = currentProfileData?.profile || {};
  const nextMs = getNextWeekUpdateMs(latestProfile);
  if (nextMs && Date.now() < nextMs) {
    showWarningToast(`Voce so pode atualizar novamente em ${formatRemainingTime(nextMs - Date.now())}.`);
    renderUpdateInfo(latestProfile);
    return;
  }
  try {
    setUpdateButtonLoading(button, true);
    const result = await updateWeeklyData(currentUid);
    renderProfileState(result.data);
    showToast('success', `${result.updatedCount} membro(s) processado(s)!`);
  } catch (e) {
    console.error(e);
    showToast('error', e?.message || 'Nao foi possivel atualizar a semana.');
  } finally {
    if (button) {
      setUpdateButtonLoading(button, false);
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

  const updateBtn = document.getElementById('btn-update-week');
  if (updateBtn && updateBtn.dataset.bound !== '1') {
    updateBtn.dataset.bound = '1';
    updateBtn.addEventListener('click', handleUpdateWeek);
  }

  bindRankingFilter();
}

async function boot() {
  if (isBooted) return;
  isBooted = true;
  try { setupSidebar(); } catch (e) { console.error(e); }
  try { initIcons(); } catch (e) { console.error(e); }
  setAccessUiLoaded(false);
  setAccessCard('loading');
  bindInitialEvents();

  try {
    const user = await checkAuth();
    if (!user) return;
    bindInitialEvents();

    const tier = await getCurrentGuildVipTier();
    if (!canUseStatsTier(tier)) {
      setAccessUiLoaded(false);
      setAccessCard('locked', 'As estatisticas da guilda ficam liberadas a partir do plano PLUS.');
      return;
    }

    await loadCurrentGuildStats({ useCache: true });
  } catch (e) {
    console.error(e);
    setAccessCard('error', e?.message || 'Nao foi possivel carregar as estatisticas.');
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot, { once: true });
} else {
  boot();
}
