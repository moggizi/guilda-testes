import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  doc,
  getDoc,
  setDoc,
  deleteDoc,
  serverTimestamp,
  collection,
  getDocs,
  query,
  where,
  limit,
  writeBatch,
  deleteField
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import {
  setupSidebar,
  initIcons,
  logout,
  getGuildContext,
  getGuildMultiConfig,
  getSharedGuildContextCache,
  setSharedGuildContextCache,
  readCachedSidebarProfile,
  showToast,
  auth,
  db
} from '../logic.js';
setupSidebar();
initIcons();

const qs = (id) => document.getElementById(id);
const RECRUITMENT_ROOT_COLLECTION = 'recrutamento';
const RECRUITMENT_ACTIVE_STATUS = 'ativo';
const RECRUITMENT_INACTIVE_STATUS = 'inativo';
const RECRUITMENT_ITEMS_COLLECTION = 'itens';
const RECRUITMENT_INACTIVE_DELETE_MS = 7 * 24 * 60 * 60 * 1000;
const RECRUITMENT_DATA_CACHE_PREFIX = 'recruitment_admin_data_v1_';
const RECRUITMENT_REQUESTS_CACHE_PREFIX = 'recruitment_admin_requests_v1_';
const RECRUITMENT_DATA_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const RECRUITMENT_REQUESTS_CACHE_TTL_MS = 10 * 60 * 1000;
const recruitmentDocRef = (status, guildId) => doc(db, RECRUITMENT_ROOT_COLLECTION, status, RECRUITMENT_ITEMS_COLLECTION, String(guildId || '').trim());
const recruitmentRequestsCollection = (status, guildId) => collection(db, RECRUITMENT_ROOT_COLLECTION, status, RECRUITMENT_ITEMS_COLLECTION, String(guildId || '').trim(), 'pedidos');
const recruitmentRequestDocRef = (status, guildId, requestId) => doc(db, RECRUITMENT_ROOT_COLLECTION, status, RECRUITMENT_ITEMS_COLLECTION, String(guildId || '').trim(), 'pedidos', String(requestId || '').trim());
const recruitmentPhotoSrc = (item = {}) => String(item.photoUrl || item.photoBase64 || '').trim();

const recruitmentDataCacheKey = (guildId) => `${RECRUITMENT_DATA_CACHE_PREFIX}${String(guildId || '').trim()}`;
const recruitmentRequestsCacheKey = (guildId, status) => `${RECRUITMENT_REQUESTS_CACHE_PREFIX}${String(guildId || '').trim()}_${String(status || RECRUITMENT_ACTIVE_STATUS).trim()}`;
const readRecruitmentLocalCache = (key, ttlMs) => {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const cached = JSON.parse(raw);
    const ts = Number(cached?.ts || 0);
    if (!ts || (Date.now() - ts) >= ttlMs) return null;
    return cached;
  } catch (_) {
    return null;
  }
};
const writeRecruitmentLocalCache = (key, payload = {}) => {
  try {
    localStorage.setItem(key, JSON.stringify({ ...(payload || {}), ts: Date.now() }));
  } catch (_) {}
};
const removeRecruitmentLocalCache = (key) => {
  try { localStorage.removeItem(key); } catch (_) {}
};

const RECRUITMENT_GUILDCTX_LS_KEY = 'guildCtx_cache_v1';
const RECRUITMENT_AUTH_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const RECRUITMENT_GUILDCTX_CACHE_VERSION = 8;
const cleanRecruitmentEmail = (email = '') => String(email || '').toLowerCase().trim();
const normalizeRecruitmentRole = (value = '') => String(value || '')
  .toLowerCase()
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .trim();
const isRecruitmentManagerRole = (value = '') => {
  const role = normalizeRecruitmentRole(value);
  return role === 'lider' || role === 'leader' || role === 'admin' || role === 'administrador';
};
const canonicalRecruitmentRole = (value = '') => {
  const role = normalizeRecruitmentRole(value);
  if (role === 'lider' || role === 'leader') return 'Líder';
  if (role === 'admin' || role === 'administrador') return 'Admin';
  if (role === 'jogador' || role === 'player') return 'Jogador';
  return String(value || '').trim() || 'Membro';
};
const normalizeRecruitmentVipTier = (value = '') => {
  const raw = String(value || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
  if (!raw) return 'free';
  if (raw.includes('vital') || raw.includes('life') || raw.includes('parceiro') || raw.includes('partner')) return 'parceiro';
  if (raw.includes('ultra')) return 'ultra';
  if (raw.includes('business') || raw.includes('buss')) return 'business';
  if (raw.includes('pro')) return 'pro';
  if (raw.includes('plus')) return 'plus';
  return raw === 'free' ? 'free' : raw;
};
const pickRecruitmentVipTier = (...sources) => {
  for (const source of sources) {
    if (!source || typeof source !== 'object') continue;
    const raw = source.vipTier ?? source.vip ?? source.planoVip ?? source.planoVIP ?? source.vipLevel ?? source.vipPlano ?? source.vipName ?? source.plano ?? source.plan ?? source.tier;
    const tier = normalizeRecruitmentVipTier(raw);
    if (tier && tier !== 'free') return tier;
  }
  return 'free';
};
const readRecruitmentCachedCtx = () => {
  try {
    const shared = getSharedGuildContextCache();
    if (shared?.guildId) return shared;

    const raw = localStorage.getItem(RECRUITMENT_GUILDCTX_LS_KEY);
    if (!raw) return null;
    const ctx = JSON.parse(raw);
    if (!ctx || !ctx.guildId) return null;
    return ctx;
  } catch (_) {
    return null;
  }
};
const isRecruitmentCachedCtxFresh = (ctx) => {
  try {
    const ts = Number(ctx?.ts || 0);
    return !!ts && Number.isFinite(ts) && (Date.now() - ts) < RECRUITMENT_AUTH_CACHE_TTL_MS;
  } catch (_) {
    return false;
  }
};
const recruitmentCachedCtxMatchesUser = (ctx, user) => {
  try {
    if (!ctx || !user) return false;
    const cachedUid = String(ctx.uid || '').trim();
    const userUid = String(user.uid || '').trim();
    const cachedEmail = cleanRecruitmentEmail(ctx.email || ctx.emailLower || '');
    const userEmail = cleanRecruitmentEmail(user.email || '');
    if (!cachedUid || !userUid || cachedUid !== userUid) return false;
    if (cachedEmail && userEmail && cachedEmail !== userEmail) return false;
    return true;
  } catch (_) {
    return false;
  }
};
const writeRecruitmentCachedCtx = (ctx = {}) => {
  try {
    if (!ctx?.guildId) return;
    const payload = {
      guildId: ctx.guildId,
      guildName: ctx.guildName || null,
      role: ctx.role || 'Membro',
      vipTier: ctx.vipTier || 'free',
      vipExpiresAtMs: ctx.vipExpiresAtMs ?? null,
      email: ctx.email || '',
      emailLower: ctx.emailLower || ctx.email || '',
      uid: ctx.uid || '',
      isLeader: ctx.role === 'Líder' || ctx.isLeader === true,
      isAdmin: ctx.role === 'Admin' || ctx.isAdmin === true,
      isOwner: ctx.isOwner === true,
      configGuilda: ctx.configGuilda && typeof ctx.configGuilda === 'object' ? ctx.configGuilda : null,
      cacheVersion: RECRUITMENT_GUILDCTX_CACHE_VERSION,
      ts: Date.now()
    };
    setSharedGuildContextCache(payload);
  } catch (_) {}
};
const waitRecruitmentAuthUser = () => new Promise((resolve) => {
  try {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      try { unsubscribe(); } catch (_) {}
      resolve(user || null);
    });
  } catch (_) {
    resolve(auth.currentUser || null);
  }
});
async function findRecruitmentGuildByEmail(emailLower) {
  // Desativado de propósito para economizar leituras.
  // O recrutamento não faz mais query/varredura em configGuilda para descobrir guilda por e-mail.
  // O guildId precisa vir de users/{uid}; depois lê apenas os docs próprios da guilda.
  return null;
}
function resolveRecruitmentRoleFromConfig(cfg = {}, emailLower = '', uid = '') {
  const leaders = Array.isArray(cfg.leaders) ? cfg.leaders.map(cleanRecruitmentEmail) : [];
  const admins = Array.isArray(cfg.admins) ? cfg.admins.map(cleanRecruitmentEmail) : [];
  const ownerEmail = cleanRecruitmentEmail(cfg.ownerEmail);
  const ownerUid = String(cfg.ownerUid || '').trim();
  if ((uid && ownerUid === uid) || (ownerEmail && ownerEmail === emailLower) || leaders.includes(emailLower)) return 'Líder';
  if (admins.includes(emailLower)) return 'Admin';
  return '';
}
async function resolveRecruitmentAccessContext() {
  const user = await waitRecruitmentAuthUser();
  if (!user) {
    window.location.href = '/inicio';
    return null;
  }

  const emailLower = cleanRecruitmentEmail(user.email);

  const cachedCtx = readRecruitmentCachedCtx();
  if (isRecruitmentCachedCtxFresh(cachedCtx) && recruitmentCachedCtxMatchesUser(cachedCtx, user) && isRecruitmentManagerRole(cachedCtx.role)) {
    const refreshedCtx = { ...cachedCtx, email: emailLower, emailLower, uid: user.uid };
    writeRecruitmentCachedCtx(refreshedCtx);
    const emailEl = document.getElementById('user-email');
    if (emailEl) emailEl.textContent = user.email || emailLower;
    const roleEl = document.getElementById('user-role');
    if (roleEl) roleEl.textContent = canonicalRecruitmentRole(cachedCtx.role || 'Membro');
    return { user, ctx: refreshedCtx };
  }

  let profile = {};
  let guildId = '';
  let role = '';
  let configGuilda = {};
  let guildData = {};

  try {
    const userSnap = await getDoc(doc(db, 'users', user.uid));
    if (userSnap.exists()) {
      profile = userSnap.data() || {};
      guildId = String(profile.guildId || '').trim();
      role = canonicalRecruitmentRole(profile.role || '');
    }
  } catch (_) {}

  if (!guildId) {
    try {
      const profileQuery = query(
        collection(db, 'users'),
        where('uid', '==', user.uid),
        limit(5)
      );
      const profileSnaps = await getDocs(profileQuery);
      const profileDoc = profileSnaps.docs
        .map((profileSnap) => ({ docId: profileSnap.id, ...(profileSnap.data() || {}) }))
        .find((candidate) => String(candidate.guildId || '').trim());
      if (profileDoc) {
        profile = { ...profile, ...profileDoc };
        guildId = String(profileDoc.guildId || '').trim();
        role = canonicalRecruitmentRole(profileDoc.role || role || '');
      }
    } catch (_) {}
  }

  if (!guildId && recruitmentCachedCtxMatchesUser(cachedCtx, user)) {
    guildId = String(cachedCtx.guildId || '').trim();
    role = guildId === String(user.uid || '').trim() ? canonicalRecruitmentRole('Lider') : '';
    configGuilda = cachedCtx.configGuilda && typeof cachedCtx.configGuilda === 'object'
      ? cachedCtx.configGuilda
      : {};
  }

  if (!guildId) {
    try {
      const cachedProfile = readCachedSidebarProfile(user);
      if (cachedProfile && String(cachedProfile.uid || '').trim() === String(user.uid || '').trim()) {
        profile = { ...cachedProfile, ...profile };
        guildId = String(cachedProfile.guildId || '').trim();
        role = canonicalRecruitmentRole(role || cachedProfile.role || '');
      }
    } catch (_) {}
  }

  if (!guildId) {
    try {
      const selfCfgSnap = await getDoc(doc(db, 'configGuilda', user.uid));
      if (selfCfgSnap.exists()) {
        guildId = user.uid;
        configGuilda = selfCfgSnap.data() || {};
        role = canonicalRecruitmentRole(role || 'Lider');
      }
    } catch (_) {}
  }

  if (!guildId) {
    try {
      const selfGuildSnap = await getDoc(doc(db, 'guildas', user.uid));
      if (selfGuildSnap.exists()) {
        guildId = user.uid;
        guildData = selfGuildSnap.data() || {};
        role = canonicalRecruitmentRole(role || 'Lider');
      }
    } catch (_) {}
  }

  if (!guildId) {
    showToast('warn', 'Não foi possível carregar a guilda agora. Sua conta continua conectada.');
    return { user, ctx: null, unresolvedGuild: true };
  }

  try {
    if (!Object.keys(configGuilda || {}).length) {
      const cfgSnap = await getDoc(doc(db, 'configGuilda', guildId));
      configGuilda = cfgSnap.exists() ? (cfgSnap.data() || {}) : {};
    }
  } catch (_) {}

  const roleFromConfig = resolveRecruitmentRoleFromConfig(configGuilda, emailLower, user.uid);
  if (roleFromConfig) role = roleFromConfig;
  role = canonicalRecruitmentRole(role || profile.role || '');

  try {
    const guildSnap = await getDoc(doc(db, 'guildas', guildId));
    guildData = guildSnap.exists() ? (guildSnap.data() || {}) : {};
    const ownerEmail = cleanRecruitmentEmail(guildData.ownerEmail);
    const ownerUid = String(guildData.ownerUid || '').trim();
    if ((ownerUid && ownerUid === user.uid) || (ownerEmail && ownerEmail === emailLower)) role = 'Líder';
  } catch (_) {}

  if (!isRecruitmentManagerRole(role)) {
    showToast('error', 'Apenas Líder ou Admin podem acessar o recrutamento.');
    window.location.href = '/dashboard';
    return null;
  }

  const guildName = String(configGuilda.name || guildData.name || profile.guildName || '').trim() || null;
  const vipTier = pickRecruitmentVipTier(configGuilda, guildData, profile);
  const ctx = {
    guildId,
    guildName,
    role,
    vipTier,
    vipExpiresAtMs: null,
    email: emailLower,
    uid: user.uid,
    configGuilda
  };

  writeRecruitmentCachedCtx(ctx);
  const emailEl = document.getElementById('user-email');
  if (emailEl) emailEl.textContent = user.email || emailLower;
  const roleEl = document.getElementById('user-role');
  if (roleEl) roleEl.textContent = role;

  return { user, ctx };
}

const normalizeTimestamp = (value) => {
  if (!value) return null;
  if (value instanceof Date) return value;
  if (typeof value?.toDate === 'function') return value.toDate();
  if (typeof value?.seconds === 'number') return new Date(value.seconds * 1000);
  const dt = new Date(value);
  return Number.isNaN(dt.getTime()) ? null : dt;
};
const formatDateBR = (value) => {
  const d = normalizeTimestamp(value) || new Date(value || Date.now());
  if (!(d instanceof Date) || Number.isNaN(d.getTime())) return '-';
  return d.toLocaleDateString('pt-BR') + ' ' + d.toLocaleTimeString('pt-BR', { hour:'2-digit', minute:'2-digit' });
};
const escapeHtml = (str) => String(str ?? '').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#039;');
const palavrasBloqueioDireto = [
  "arrombado",
  "arrombada",
  "babaca",
  "bosta",
  "buceta",
  "caralho",
  "corno",
  "corna",
  "cu",
  "cuzão",
  "cuzao",
  "desgraçado",
  "desgracado",
  "desgraçada",
  "desgracada",
  "fdp",
  "filho da puta",
  "filha da puta",
  "foda-se",
  "fodase",
  "idiota",
  "imbecil",
  "lixo",
  "otário",
  "otario",
  "otária",
  "otaria",
  "pau no cu",
  "porra",
  "puta",
  "puto",
  "putaria",
  "retardado",
  "retardada",
  "vagabundo",
  "vagabunda",
  "vai se foder",
  "vai tomar no cu",
  "vsf",
  "vtmnc",
  "boiola",
  "bicha",
  "traveco",
  "aleijado",
  "doente mental",
  "autista",
  "mongol",
  "mongoloide",
  "boquete",
  "gozar",
  "gozada",
  "gozei",
  "masturbação",
  "masturbacao",
  "punheta",
  "sexo explícito",
  "sexo explicito",
  "nude",
  "nudes",
  "pelado",
  "pelada",
  "pornô",
  "porno",
  "pornografia",
  "xvideos",
  "onlyfans",
  "hitler",
  "maconha",
  "cocaína",
  "cocaina"
];
const textoImproprioMensagem = 'Esse campo contém uma palavra imprópria. Remova antes de salvar.';
function normalizarTextoFiltro(texto) {
  return String(texto || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[@4]/g, 'a')
    .replace(/[3]/g, 'e')
    .replace(/[1|]/g, 'i')
    .replace(/[0]/g, 'o')
    .replace(/[5$]/g, 's')
    .replace(/[7]/g, 't')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
function escaparRegexFiltro(texto) {
  return String(texto || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
function encontrarPalavraImpropria(texto) {
  const textoNormalizado = ` ${normalizarTextoFiltro(texto)} `;
  if (!textoNormalizado.trim()) return '';
  return palavrasBloqueioDireto.find((palavra) => {
    const palavraNormalizada = normalizarTextoFiltro(palavra);
    if (!palavraNormalizada) return false;
    const palavraRegex = escaparRegexFiltro(palavraNormalizada).replace(/\s+/g, '\\s+');
    return new RegExp(`\\s${palavraRegex}\\s`, 'i').test(textoNormalizado);
  }) || '';
}
function validarTextoPermitido(valor, nomeCampo = 'campo') {
  const palavraEncontrada = encontrarPalavraImpropria(valor);
  if (!palavraEncontrada) return true;
  showToast('error', `${textoImproprioMensagem} Campo: ${nomeCampo}.`);
  return false;
}
function contemLinkBloqueado(texto = '') {
  const valor = String(texto || '').trim();
  if (!valor) return false;
  return /(?:https?:\/\/|www\.)\S+|(?:[a-z0-9-]+\.)+(?:com\.br|com|net|org|io|gg|br|app|dev|site|online|link|xyz|store|me|co)(?:\/\S*)?/i.test(valor);
}
function validarTextoSemLink(valor, nomeCampo = 'campo') {
  if (!contemLinkBloqueado(valor)) return true;
  showToast('error', `Remova links do campo ${nomeCampo}.`);
  return false;
}
const getCheckedValues = (name) => [...document.querySelectorAll(`input[name="${name}"]:checked`)].map(el => el.value);
const setCheckedValues = (name, values=[]) => {
  const wanted = new Set(values || []);
  document.querySelectorAll(`input[name="${name}"]`).forEach(el => { el.checked = wanted.has(el.value); });
};
function tagChip(text, style='default') {
  const styles = {
    role: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
    contact: 'bg-gray-100 text-gray-700 ring-gray-200',
    type: 'bg-fuchsia-50 text-fuchsia-700 ring-fuchsia-200',
    focus: 'bg-sky-50 text-sky-700 ring-sky-200',
    default: 'bg-slate-100 text-slate-700 ring-slate-200'
  };
  return `<span class="inline-flex items-center rounded-full ring-1 px-2.5 py-1 text-[11px] font-bold ${styles[style] || styles.default}">${escapeHtml(text)}</span>`;
}
function buildRecruitmentRequirements(data = {}) {
  const items = [];
  const pushItem = (label, value) => {
    const clean = String(value || '').trim();
    if (!clean) return;
    items.push(`${label}: ${clean}`);
  };
  pushItem('Plataforma', data.platform);
  pushItem('Idade', data.minimumAge);
  pushItem('Troca nick', data.nickChangeRequired);
  pushItem('Prazo nick', data.nickChangeDeadline);
  pushItem('Equipe', data.teamPlay);
  pushItem('Call', data.useCall);
  return items;
}
function renderRequirementChips(data = {}) {
  const items = buildRecruitmentRequirements(data);
  return items.length ? items.map(v => tagChip(v, 'default')).join(' ') : '<span class="text-sm text-gray-400">Nenhum</span>';
}
const MAX_RECRUITMENT_SECTIONS = 8;
const MAX_RECRUITMENT_FIELDS = 10;
const MAX_RECRUITMENT_OPTIONS = 8;
const RECRUITMENT_FIELD_TYPES = new Set(['text', 'select', 'multiselect', 'boolean']);
function createRecruitmentBuilderId(prefix = 'item') {
  const random = Math.random().toString(36).slice(2, 9);
  return `${prefix}_${Date.now().toString(36)}_${random}`.slice(0, 40);
}
function normalizeRecruitmentBuilderText(value, max = 80) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, max);
}
function normalizeRecruitmentBuilderOptions(value) {
  const source = Array.isArray(value) ? value : String(value || '').split(',');
  return [...new Set(source
    .map((item) => normalizeRecruitmentBuilderText(item, 50))
    .filter(Boolean))]
    .slice(0, MAX_RECRUITMENT_OPTIONS);
}
function normalizeRecruitmentCustomSections(data = {}) {
  const raw = Array.isArray(data.customSections) ? data.customSections : [];
  const normalized = raw.map((section, index) => ({
    id: normalizeRecruitmentBuilderText(section?.id, 40) || `section_${index + 1}`,
    title: normalizeRecruitmentBuilderText(section?.title, 50),
    items: normalizeRecruitmentBuilderOptions(section?.items)
  })).filter((section) => section.title && section.items.length).slice(0, MAX_RECRUITMENT_SECTIONS);
  if (normalized.length || Number(data.formVersion || 0) >= 2) return normalized;

  const legacy = [];
  const pushLegacy = (title, items) => {
    const clean = normalizeRecruitmentBuilderOptions(items);
    if (clean.length) legacy.push({ id: createRecruitmentBuilderId('section'), title, items: clean });
  };
  pushLegacy('Funções', data.roles);
  pushLegacy('Contato', data.contacts);
  pushLegacy('Tipo da guilda', data.guildType);
  pushLegacy('Foco', data.focus);
  pushLegacy('Requisitos', buildRecruitmentRequirements(data));
  return legacy.slice(0, MAX_RECRUITMENT_SECTIONS);
}
function normalizeRecruitmentApplicationFields(data = {}) {
  const raw = Array.isArray(data.applicationFields) ? data.applicationFields : [];
  const normalized = raw.map((field, index) => {
    const type = RECRUITMENT_FIELD_TYPES.has(String(field?.type || '')) ? String(field.type) : 'text';
    return {
      id: normalizeRecruitmentBuilderText(field?.id, 40) || `question_${index + 1}`,
      label: normalizeRecruitmentBuilderText(field?.label, 70),
      type,
      required: field?.required === true,
      options: ['select', 'multiselect'].includes(type) ? normalizeRecruitmentBuilderOptions(field?.options) : []
    };
  }).filter((field) => field.label).slice(0, MAX_RECRUITMENT_FIELDS);
  if (normalized.length || Number(data.formVersion || 0) >= 2) return normalized;

  const legacyRoles = normalizeRecruitmentBuilderOptions(data.roles);
  return [
    { id: 'legacy_roles', label: 'Qual modo você joga?', type: 'multiselect', required: true, options: legacyRoles.length ? legacyRoles : MARKETPLACE_ROLE_OPTIONS },
    { id: 'legacy_age', label: 'Idade', type: 'select', required: true, options: MARKETPLACE_AGE_OPTIONS },
    { id: 'legacy_availability', label: 'Horário disponível', type: 'select', required: true, options: MARKETPLACE_AVAILABILITY_OPTIONS },
    { id: 'legacy_weekend', label: 'Disponível sexta e sábado?', type: 'boolean', required: true, options: [] },
    { id: 'legacy_gg', label: 'Já jogou GG?', type: 'boolean', required: true, options: [] },
    { id: 'legacy_nick_change', label: 'Possui troca nick?', type: 'boolean', required: true, options: [] }
  ];
}
function renderRecruitmentCustomSections(data = {}) {
  const sections = normalizeRecruitmentCustomSections(data);
  if (!sections.length) return '<p class="text-sm text-gray-400">Nenhuma informação adicional.</p>';
  return `<div class="grid gap-4 md:grid-cols-2">${sections.map((section) => `
    <div class="min-w-0">
      <p class="mb-2 text-xs font-semibold text-gray-500">${escapeHtml(section.title)}</p>
      <div class="flex flex-wrap gap-2">${section.items.map((item) => tagChip(item, 'default')).join('')}</div>
    </div>`).join('')}</div>`;
}
const normalizeDigits = (v) => String(v ?? '').replace(/\D+/g, '');
const MARKETPLACE_ROLE_OPTIONS = ['Rush', 'Full Gás', 'Curandeiro', 'Fuzileiro', 'Suporte'];
const MARKETPLACE_AGE_OPTIONS = ['+10', '+11', '+12', '+13', '+14', '+15', '+16', '+17', '+18'];
const MARKETPLACE_AVAILABILITY_OPTIONS = ['Manhã', 'Tarde', 'Noite'];
const MARKETPLACE_BOOLEAN_OPTIONS = ['Sim', 'Não'];
const WHATSAPP_COUNTRY_OPTIONS = [
  { code: '55', flag: '🇧🇷', label: 'Brasil', maxDigits: 11, placeholder: 'DDD + número' },
  { code: '1', flag: '🇺🇸', label: 'Estados Unidos', maxDigits: 10, placeholder: 'Área + número' },
  { code: '54', flag: '🇦🇷', label: 'Argentina', maxDigits: 10, placeholder: 'Área + número' },
  { code: '351', flag: '🇵🇹', label: 'Portugal', maxDigits: 9, placeholder: 'Número' },
  { code: '52', flag: '🇲🇽', label: 'México', maxDigits: 10, placeholder: 'Área + número' },
  { code: '595', flag: '🇵🇾', label: 'Paraguai', maxDigits: 10, placeholder: 'Área + número' },
  { code: '56', flag: '🇨🇱', label: 'Chile', maxDigits: 9, placeholder: 'Número' },
  { code: '57', flag: '🇨🇴', label: 'Colômbia', maxDigits: 10, placeholder: 'Número' },
  { code: '51', flag: '🇵🇪', label: 'Peru', maxDigits: 9, placeholder: 'Número' }
];
const DEFAULT_WHATSAPP_COUNTRY_CODE = '55';
const getWhatsappCountryMeta = (countryCode) => {
  const wanted = normalizeDigits(countryCode || DEFAULT_WHATSAPP_COUNTRY_CODE);
  return WHATSAPP_COUNTRY_OPTIONS.find((item) => item.code === wanted) || WHATSAPP_COUNTRY_OPTIONS[0];
};
const buildWhatsappPayload = (rawNumber, rawCountryCode = DEFAULT_WHATSAPP_COUNTRY_CODE) => {
  const country = getWhatsappCountryMeta(rawCountryCode);
  const localNumber = normalizeDigits(rawNumber).slice(0, country.maxDigits);
  return {
    countryCode: country.code,
    localNumber,
    fullNumber: `${country.code}${localNumber}`,
    maxDigits: country.maxDigits,
    placeholder: country.placeholder,
    flag: country.flag,
    label: country.label
  };
};
const formatWhatsappHref = (v, countryCode) => {
  const digits = normalizeDigits(v);
  if (!digits) return '';
  const normalizedCountryCode = normalizeDigits(countryCode);
  const fullDigits = normalizedCountryCode ? `${normalizedCountryCode}${digits}` : digits.length <= 11 ? `${DEFAULT_WHATSAPP_COUNTRY_CODE}${digits}` : digits;
  return `https://wa.me/${fullDigits}`;
};
const formatWhatsappLabel = (v, countryCode) => {
  const digits = normalizeDigits(v);
  if (!digits) return '-';
  const normalizedCountryCode = normalizeDigits(countryCode);
  return normalizedCountryCode ? `+${normalizedCountryCode} ${digits}` : digits.length <= 11 ? `+${DEFAULT_WHATSAPP_COUNTRY_CODE} ${digits}` : `+${digits}`;
};
const REQUEST_CONTACT_LABELS = {
  whatsapp: 'WhatsApp',
  instagram: 'Instagram',
  discord: 'Discord'
};
const normalizeRequestContactType = (item = {}) => {
  const type = String(item.contactType || '').trim().toLowerCase();
  if (REQUEST_CONTACT_LABELS[type]) return type;
  if (item.instagram) return 'instagram';
  if (item.discord) return 'discord';
  return 'whatsapp';
};
const cleanRequestUsername = (value, type) => {
  let clean = String(value || '').trim()
    .replace(/^https?:\/\/(www\.)?instagram\.com\//i, '')
    .replace(/^https?:\/\/(www\.)?discord(?:app)?\.com\/users\//i, '')
    .replace(/^@+/, '')
    .replace(/[/?#].*$/, '');
  if (type === 'instagram') return clean.replace(/[^a-zA-Z0-9._]/g, '').slice(0, 30);
  return clean.replace(/[^a-zA-Z0-9._]/g, '').slice(0, 32);
};
const getRequestContact = (item = {}) => {
  const type = normalizeRequestContactType(item);
  const countryCode = normalizeDigits(item.contactCountryCode || item.whatsappCountryCode || item.phoneCountryCode || DEFAULT_WHATSAPP_COUNTRY_CODE);
  const rawValue = item.contactValue
    || (type === 'instagram' ? item.instagram : '')
    || (type === 'discord' ? item.discord : '')
    || item.whatsapp
    || item.phone
    || '';
  let value = type === 'whatsapp' ? normalizeDigits(rawValue) : cleanRequestUsername(rawValue, type);
  if (type === 'whatsapp') {
    const country = getWhatsappCountryMeta(countryCode);
    if (value.startsWith(country.code) && value.length > country.maxDigits) value = value.slice(country.code.length);
    value = value.slice(0, country.maxDigits);
  }
  return { type, value, countryCode: countryCode || DEFAULT_WHATSAPP_COUNTRY_CODE };
};
const formatRequestContactLabel = (item = {}) => {
  const contact = getRequestContact(item);
  if (!contact.value) return 'Não informado';
  return contact.type === 'whatsapp'
    ? formatWhatsappLabel(contact.value, contact.countryCode)
    : `@${contact.value}`;
};
const formatRequestContactHref = (item = {}) => {
  const contact = getRequestContact(item);
  if (!contact.value) return '';
  if (contact.type === 'whatsapp') return formatWhatsappHref(contact.value, contact.countryCode);
  if (contact.type === 'instagram') return `https://instagram.com/${encodeURIComponent(contact.value)}`;
  return /^\d{15,22}$/.test(contact.value)
    ? `https://discord.com/users/${contact.value}`
    : 'https://discord.com/app';
};
function getRequestStatusMeta(status) {
  const s = String(status || 'pendente').toLowerCase();
  if (s === 'accepted' || s === 'aceito') return { label: 'ACEITO', className: 'bg-emerald-50 text-emerald-700 ring-emerald-200' };
  if (s === 'rejected' || s === 'recusado') return { label: 'RECUSADO', className: 'bg-red-50 text-red-700 ring-red-200' };
  return { label: 'PENDENTE', className: 'bg-amber-50 text-amber-700 ring-amber-200' };
}

function dataUrlSizeBytes(dataUrl='') {
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
async function compressImageToBase64(file, maxBytes = 800 * 1024) {
  const img = await loadImageFromFile(file);
  let width = img.width || 0;
  let height = img.height || 0;
  const maxDim = 1600;
  if (width > maxDim || height > maxDim) {
    const scale = Math.min(maxDim / width, maxDim / height);
    width = Math.max(1, Math.round(width * scale));
    height = Math.max(1, Math.round(height * scale));
  }
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d', { alpha:false });
  if (!ctx) throw new Error('Canvas indisponível.');
  let quality = 0.88, output = '', attempts = 0, currentWidth = width, currentHeight = height;
  while (attempts < 12) {
    canvas.width = currentWidth; canvas.height = currentHeight;
    ctx.clearRect(0,0,currentWidth,currentHeight);
    ctx.drawImage(img,0,0,currentWidth,currentHeight);
    output = canvas.toDataURL('image/jpeg', quality);
    const size = dataUrlSizeBytes(output);
    if (size <= maxBytes) return { base64: output, bytes: size };
    if (quality > 0.55) quality -= 0.08;
    else {
      currentWidth = Math.max(500, Math.round(currentWidth * 0.88));
      currentHeight = Math.max(500, Math.round(currentHeight * 0.88));
    }
    attempts += 1;
  }
  throw new Error('Não foi possível comprimir a imagem abaixo de 800 KB.');
}

function bootManagementMode() {
  const els = {
    loadBtn: qs('btn-load-recruitment'), reloadBtn: qs('btn-reload'), newBtn: qs('btn-new-rec'), copyBtn: qs('btn-copy-rec-link'),
    keyInput: qs('guild-access-key-input'), keyStatus: qs('key-status'), currentUid: qs('current-uid'),
    currentGuildName: qs('current-guild-name'), openedKey: qs('opened-key'), view: qs('recruitment-view'),
    keyLabel: document.querySelector('label[for="guild-access-key-input"]'),
    modal: qs('rec-modal'), modalTitle: qs('rec-modal-title'), form: qs('rec-form'), guildName: qs('rec-guild-name'),
    customSections: qs('rec-custom-sections'), applicationFields: qs('rec-application-fields'),
    addSectionBtn: qs('btn-add-rec-section'), addQuestionBtn: qs('btn-add-rec-question'),
    desc: qs('rec-description'), descCount: qs('rec-desc-count'), photoInput: qs('rec-photo'),
    photoPreviewWrap: qs('rec-photo-preview-wrap'), photoPreview: qs('rec-photo-preview'), photoStatus: qs('rec-photo-status'),
    photoFileName: qs('rec-photo-file-name'),
    requestsSection: qs('requests-section'), requestsView: qs('requests-view'), requestsBadge: qs('requests-badge'),
    requestModal: qs('request-detail-modal'), requestModalName: qs('request-detail-name'), requestModalId: qs('request-detail-id'),
    requestModalStatus: qs('request-detail-status'), requestModalDate: qs('request-detail-date'), requestModalModes: qs('request-detail-modes'),
    requestModalWhatsapp: qs('request-detail-whatsapp'), requestTargetSlot: qs('request-target-slot'), requestAcceptBtn: qs('btn-request-accept'), requestRejectBtn: qs('btn-request-reject'),
    requestModalAnswersWrap: qs('request-detail-answers-wrap'), requestModalAnswers: qs('request-detail-answers'),
    deleteRecModal: qs('delete-rec-modal'), cancelDeleteRecBtn: qs('btn-cancel-delete-rec'), confirmDeleteRecBtn: qs('btn-confirm-delete-rec'),
    planWarning: qs('recruitment-plan-warning')
  };
  let linkedUid = null, openedKey = '', currentRecruitment = null, currentRecruitmentStatus = RECRUITMENT_ACTIVE_STATUS, currentPhotoBase64 = '', currentPhotoBytes = 0, currentRequests = [], activeRequest = null;
  let recruitmentCustomSections = [], recruitmentApplicationFields = [];
  let isSavingRecruitment = false, isReloadingRecruitment = false;
  let managementGuildSlotsCache = [];
  let recruitmentGuildCtx = readRecruitmentCachedCtx() || getGuildContext() || null;

  function collectRecruitmentSectionsFromEditor() {
    if (!els.customSections) return recruitmentCustomSections;
    return [...els.customSections.querySelectorAll('[data-rec-section]')].map((node) => ({
      id: String(node.dataset.recSection || createRecruitmentBuilderId('section')),
      title: normalizeRecruitmentBuilderText(node.querySelector('[data-rec-section-title]')?.value, 50),
      items: normalizeRecruitmentBuilderOptions(node.querySelector('[data-rec-section-items]')?.value)
    })).slice(0, MAX_RECRUITMENT_SECTIONS);
  }
  function collectRecruitmentQuestionsFromEditor() {
    if (!els.applicationFields) return recruitmentApplicationFields;
    return [...els.applicationFields.querySelectorAll('[data-rec-question]')].map((node) => {
      const typeValue = String(node.querySelector('[data-rec-question-type]')?.value || 'text');
      const type = RECRUITMENT_FIELD_TYPES.has(typeValue) ? typeValue : 'text';
      return {
        id: String(node.dataset.recQuestion || createRecruitmentBuilderId('question')),
        label: normalizeRecruitmentBuilderText(node.querySelector('[data-rec-question-label]')?.value, 70),
        type,
        required: node.querySelector('[data-rec-question-required]')?.checked === true,
        options: ['select', 'multiselect'].includes(type)
          ? normalizeRecruitmentBuilderOptions(node.querySelector('[data-rec-question-options]')?.value)
          : []
      };
    }).slice(0, MAX_RECRUITMENT_FIELDS);
  }
  function renderRecruitmentSectionEditor() {
    if (!els.customSections) return;
    if (!recruitmentCustomSections.length) {
      els.customSections.innerHTML = '<div class="rounded-xl border border-dashed border-gray-200 bg-gray-50 px-4 py-5 text-center text-xs text-gray-500">Nenhum bloco criado. Use o botão <b>Bloco</b> para adicionar informações.</div>';
      return;
    }
    els.customSections.innerHTML = recruitmentCustomSections.map((section, index) => `
      <div data-rec-section="${escapeHtml(section.id)}" class="rounded-xl border border-gray-200 bg-gray-50/70 p-3">
        <div class="mb-3 flex items-center justify-between gap-2">
          <span class="text-[11px] font-extrabold uppercase text-gray-400">Bloco ${index + 1}</span>
          <div class="flex items-center gap-1">
            <button type="button" data-rec-section-action="up" title="Mover para cima" class="grid h-8 w-8 place-items-center rounded-lg text-gray-500 hover:bg-white disabled:opacity-30" ${index === 0 ? 'disabled' : ''}><i data-lucide="arrow-up" class="h-4 w-4"></i></button>
            <button type="button" data-rec-section-action="down" title="Mover para baixo" class="grid h-8 w-8 place-items-center rounded-lg text-gray-500 hover:bg-white disabled:opacity-30" ${index === recruitmentCustomSections.length - 1 ? 'disabled' : ''}><i data-lucide="arrow-down" class="h-4 w-4"></i></button>
            <button type="button" data-rec-section-action="remove" title="Remover bloco" class="grid h-8 w-8 place-items-center rounded-lg text-red-500 hover:bg-red-50"><i data-lucide="trash-2" class="h-4 w-4"></i></button>
          </div>
        </div>
        <div class="grid gap-3 sm:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]">
          <div>
            <label class="mb-1.5 block text-xs font-semibold text-gray-600">Título</label>
            <input data-rec-section-title type="text" maxlength="50" value="${escapeHtml(section.title)}" placeholder="Ex: Requisitos" class="w-full rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-emerald-500">
          </div>
          <div>
            <label class="mb-1.5 block text-xs font-semibold text-gray-600">Itens separados por vírgula</label>
            <input data-rec-section-items type="text" maxlength="400" value="${escapeHtml(section.items.join(', '))}" placeholder="Ex: +16, usar call, jogar em equipe" class="w-full rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-emerald-500">
          </div>
        </div>
      </div>`).join('');
    initIcons();
  }
  function renderRecruitmentQuestionEditor() {
    if (!els.applicationFields) return;
    if (!recruitmentApplicationFields.length) {
      els.applicationFields.innerHTML = '<div class="rounded-xl border border-dashed border-gray-200 bg-gray-50 px-4 py-5 text-center text-xs text-gray-500">Nenhuma pergunta personalizada. ID, nick e contato continuarão obrigatórios.</div>';
      return;
    }
    els.applicationFields.innerHTML = recruitmentApplicationFields.map((field, index) => {
      const needsOptions = ['select', 'multiselect'].includes(field.type);
      return `
        <div data-rec-question="${escapeHtml(field.id)}" class="rounded-xl border border-gray-200 bg-gray-50/70 p-3">
          <div class="mb-3 flex items-center justify-between gap-2">
            <span class="text-[11px] font-extrabold uppercase text-gray-400">Pergunta ${index + 1}</span>
            <div class="flex items-center gap-1">
              <button type="button" data-rec-question-action="up" title="Mover para cima" class="grid h-8 w-8 place-items-center rounded-lg text-gray-500 hover:bg-white disabled:opacity-30" ${index === 0 ? 'disabled' : ''}><i data-lucide="arrow-up" class="h-4 w-4"></i></button>
              <button type="button" data-rec-question-action="down" title="Mover para baixo" class="grid h-8 w-8 place-items-center rounded-lg text-gray-500 hover:bg-white disabled:opacity-30" ${index === recruitmentApplicationFields.length - 1 ? 'disabled' : ''}><i data-lucide="arrow-down" class="h-4 w-4"></i></button>
              <button type="button" data-rec-question-action="remove" title="Remover pergunta" class="grid h-8 w-8 place-items-center rounded-lg text-red-500 hover:bg-red-50"><i data-lucide="trash-2" class="h-4 w-4"></i></button>
            </div>
          </div>
          <div class="grid gap-3 sm:grid-cols-[minmax(0,1.2fr)_minmax(0,0.8fr)]">
            <div>
              <label class="mb-1.5 block text-xs font-semibold text-gray-600">Pergunta</label>
              <input data-rec-question-label type="text" maxlength="70" value="${escapeHtml(field.label)}" placeholder="Ex: Qual horário você joga?" class="w-full rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-emerald-500">
            </div>
            <div>
              <label class="mb-1.5 block text-xs font-semibold text-gray-600">Tipo de resposta</label>
              <div class="rq-select-wrap">
                <select data-rec-question-type data-rec-custom-select="true" class="rq-select">
                  <option value="text" ${field.type === 'text' ? 'selected' : ''}>Resposta escrita (35 caracteres)</option>
                  <option value="select" ${field.type === 'select' ? 'selected' : ''}>Escolha única</option>
                  <option value="multiselect" ${field.type === 'multiselect' ? 'selected' : ''}>Múltipla escolha</option>
                  <option value="boolean" ${field.type === 'boolean' ? 'selected' : ''}>Sim ou não</option>
                </select>
                <i data-lucide="chevron-down" class="h-4 w-4"></i>
              </div>
            </div>
          </div>
          <div data-rec-question-options-wrap class="${needsOptions ? '' : 'hidden'} mt-3">
            <label class="mb-1.5 block text-xs font-semibold text-gray-600">Opções separadas por vírgula</label>
            <input data-rec-question-options type="text" maxlength="400" value="${escapeHtml(field.options.join(', '))}" placeholder="Ex: Manhã, Tarde, Noite" class="w-full rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-emerald-500">
          </div>
          <label class="mt-3 inline-flex cursor-pointer items-center gap-2 text-xs font-semibold text-gray-600">
            <input data-rec-question-required type="checkbox" class="h-4 w-4 rounded border-gray-300 text-emerald-600 focus:ring-emerald-500" ${field.required ? 'checked' : ''}>
            Resposta obrigatória
          </label>
        </div>`;
    }).join('');
    initManagementCustomSelects();
    initIcons();
  }
  function renderRecruitmentBuilders() {
    renderRecruitmentSectionEditor();
    renderRecruitmentQuestionEditor();
  }
  function validateRecruitmentBuilderContent(sections, fields) {
    for (const [index, section] of sections.entries()) {
      if (!section.title || !section.items.length) {
        showToast('error', `Complete o título e os itens do bloco ${index + 1}.`);
        return false;
      }
      if (!validarTextoSemLink(section.title, `Título do bloco ${index + 1}`) || !validarTextoPermitido(section.title, `Título do bloco ${index + 1}`)) return false;
      for (const item of section.items) {
        if (!validarTextoSemLink(item, `Item do bloco ${index + 1}`) || !validarTextoPermitido(item, `Item do bloco ${index + 1}`)) return false;
      }
    }
    for (const [index, field] of fields.entries()) {
      if (!field.label) {
        showToast('error', `Escreva a pergunta ${index + 1}.`);
        return false;
      }
      if (!validarTextoSemLink(field.label, `Pergunta ${index + 1}`) || !validarTextoPermitido(field.label, `Pergunta ${index + 1}`)) return false;
      if (['select', 'multiselect'].includes(field.type) && field.options.length < 2) {
        showToast('error', `Adicione pelo menos duas opções na pergunta ${index + 1}.`);
        return false;
      }
      for (const option of field.options) {
        if (!validarTextoSemLink(option, `Opção da pergunta ${index + 1}`) || !validarTextoPermitido(option, `Opção da pergunta ${index + 1}`)) return false;
      }
    }
    return true;
  }

  const activeGuildContext = () => recruitmentGuildCtx || getGuildContext() || readRecruitmentCachedCtx() || {};

  const ctxGuildId = () => String(activeGuildContext()?.guildId || '').trim();
  const ctxGuildName = () => String(activeGuildContext()?.guildName || '').trim();
  const readRecruitmentDataCache = (guildId = ctxGuildId()) => {
    const gid = String(guildId || '').trim();
    if (!gid) return null;
    const cached = readRecruitmentLocalCache(recruitmentDataCacheKey(gid), RECRUITMENT_DATA_CACHE_TTL_MS);
    return cached && String(cached.guildId || '') === gid ? cached : null;
  };
  const writeRecruitmentDataCache = (guildId = ctxGuildId()) => {
    const gid = String(guildId || '').trim();
    if (!gid) return;
    writeRecruitmentLocalCache(recruitmentDataCacheKey(gid), {
      guildId: gid,
      status: normalizeRecruitmentStatus(currentRecruitmentStatus),
      recruitment: currentRecruitment || null
    });
  };
  const clearRecruitmentDataCache = (guildId = ctxGuildId()) => {
    const gid = String(guildId || '').trim();
    if (gid) removeRecruitmentLocalCache(recruitmentDataCacheKey(gid));
  };
  const readRecruitmentRequestsCache = (guildId = ctxGuildId(), status = currentRecruitmentStatus) => {
    const gid = String(guildId || '').trim();
    if (!gid) return null;
    const normalizedStatus = normalizeRecruitmentStatus(status);
    const cached = readRecruitmentLocalCache(
      recruitmentRequestsCacheKey(gid, normalizedStatus),
      RECRUITMENT_REQUESTS_CACHE_TTL_MS
    );
    return cached && String(cached.guildId || '') === gid && cached.status === normalizedStatus && Array.isArray(cached.requests)
      ? cached.requests
      : null;
  };
  const writeRecruitmentRequestsCache = (guildId = ctxGuildId(), status = currentRecruitmentStatus) => {
    const gid = String(guildId || '').trim();
    if (!gid) return;
    const normalizedStatus = normalizeRecruitmentStatus(status);
    writeRecruitmentLocalCache(recruitmentRequestsCacheKey(gid, normalizedStatus), {
      guildId: gid,
      status: normalizedStatus,
      requests: currentRequests || []
    });
  };
  const clearRecruitmentRequestsCache = (guildId = ctxGuildId()) => {
    const gid = String(guildId || '').trim();
    if (!gid) return;
    removeRecruitmentLocalCache(recruitmentRequestsCacheKey(gid, RECRUITMENT_ACTIVE_STATUS));
    removeRecruitmentLocalCache(recruitmentRequestsCacheKey(gid, RECRUITMENT_INACTIVE_STATUS));
  };
  const normalizeAccessRole = (value = '') => String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();
  const canManageRecruitmentRole = () => {
    return isRecruitmentManagerRole(activeGuildContext()?.role);
  };
  const syncRecruitmentRoleUi = () => {
    const allowed = canManageRecruitmentRole();
    document.querySelectorAll('[data-rec-admin-leader-only="true"]').forEach((el) => {
      el.classList.toggle('hidden', !allowed);
    });
    return allowed;
  };
  const getGuildContextData = () => activeGuildContext() || {};
  const getGuildConfigData = () => {
    const ctx = getGuildContextData();
    const nested = ctx?.configGuilda;
    return nested && typeof nested === 'object' ? nested : ctx;
  };
  const pickGuildValue = (...keys) => {
    const ctx = getGuildContextData();
    const cfg = getGuildConfigData();
    for (const key of keys) {
      const direct = ctx?.[key];
      if (direct != null && String(direct).trim()) return String(direct).trim();
      const nested = cfg?.[key];
      if (nested != null && String(nested).trim()) return String(nested).trim();
    }
    return '';
  };
  const buildFallbackManagementGuildSlots = () => {
    const slots = [
      { value: '1', label: pickGuildValue('name', 'guildName') || ctxGuildName() || 'Guilda principal', collection: 'membros' },
      { value: '2', label: pickGuildValue('name2', 'guildName2'), collection: 'membros2' },
      { value: '3', label: pickGuildValue('name3', 'guildName3'), collection: 'membros3' },
      { value: '4', label: pickGuildValue('name4', 'guildName4'), collection: 'membros4' }
    ];
    return slots.filter((slot, index) => index === 0 || !!String(slot.label || '').trim());
  };
  const normalizeManagementGuildSlots = (slots = []) => {
    const mapped = (Array.isArray(slots) ? slots : []).map((slot, index) => {
      const safeSlot = String(slot?.slot || (index + 1));
      const numericSlot = Number(safeSlot) || (index + 1);
      const cleanLabel = String(slot?.name || '').trim();
      return {
        value: safeSlot,
        label: cleanLabel || (numericSlot === 1 ? (ctxGuildName() || 'Guilda principal') : ''),
        collection: numericSlot === 1 ? 'membros' : `membros${numericSlot}`
      };
    });
    return mapped.filter((slot, index) => index === 0 || !!String(slot.label || '').trim());
  };
  const refreshManagementGuildSlots = async () => {
    try {
      const slots = await getRecruitmentGuildMultiConfig(4);
      const normalized = normalizeManagementGuildSlots(slots);
      managementGuildSlotsCache = normalized.length ? normalized : buildFallbackManagementGuildSlots();
    } catch (_) {
      managementGuildSlotsCache = buildFallbackManagementGuildSlots();
    }
    return managementGuildSlotsCache;
  };
  const getManagementGuildSlots = () => {
    return managementGuildSlotsCache.length ? managementGuildSlotsCache : buildFallbackManagementGuildSlots();
  };
  const renderManagementGuildCard = () => {
    if (!els.currentGuildName) return;
    const slots = getManagementGuildSlots();
    if (!slots.length) {
      els.currentGuildName.textContent = String(ctxGuildName() || '-');
      return;
    }
    els.currentGuildName.innerHTML = slots
      .map((slot) => `<span class="block">${escapeHtml(slot.label || 'Guilda principal')}</span>`)
      .join('');
  };
  const getManagementMembersCollection = (slotValue) => {
    const wanted = String(slotValue || '1').trim();
    return getManagementGuildSlots().find((slot) => slot.value === wanted)?.collection || 'membros';
  };
  const refreshManagementCustomSelect = (select) => {
    if (!select) return;
    const wrap = select.closest('.rq-select-wrap') || select.parentElement;
    if (!wrap) return;
    wrap.classList.remove('rq-dd', 'rq-dd-open');
    wrap.querySelectorAll('[data-rec-dd-trigger-for], [data-rec-dd-select-id]').forEach((node) => node.remove());
    select.classList.remove('rq-dd-native');
    delete select.dataset.recDdInit;
    enhanceManagementCustomSelect(select);
    syncManagementCustomSelect(select);
  };
  const populateRequestTargetSlotOptions = (preferredValue = '1') => {
    const select = els.requestTargetSlot;
    if (!select) return;
    const slots = getManagementGuildSlots();
    select.innerHTML = slots.map((slot) => `<option value="${escapeHtml(slot.value)}">${escapeHtml(slot.label)}</option>`).join('');
    const hasPreferred = slots.some((slot) => slot.value === String(preferredValue || '1'));
    select.value = hasPreferred ? String(preferredValue || '1') : String(slots[0]?.value || '1');
    refreshManagementCustomSelect(select);
  };
  const getRecruitmentGuildAccessKeyConfig = async () => {
    return ctxGuildId() || null;
  };
  const getRecruitmentGuildMultiConfig = async (maxSlots = 4) => {
    const safeMax = Math.max(1, Math.min(4, Math.floor(Number(maxSlots) || 4)));
    const ctx = activeGuildContext();
    const guildId = ctxGuildId();
    let cfg = ctx?.configGuilda && typeof ctx.configGuilda === 'object' ? ctx.configGuilda : {};
    if (guildId && !Object.keys(cfg || {}).length) {
      try {
        const snap = await getDoc(doc(db, 'configGuilda', guildId));
        cfg = snap.exists() ? (snap.data() || {}) : {};
      } catch (_) {}
    }
    let primaryName = String(cfg.name || ctx.guildName || '').trim();
    if (!primaryName && guildId) {
      try {
        const guildSnap = await getDoc(doc(db, 'guildas', guildId));
        const guildData = guildSnap.exists() ? (guildSnap.data() || {}) : {};
        primaryName = String(guildData.name || '').trim();
      } catch (_) {}
    }
    const slots = [];
    for (let slot = 1; slot <= safeMax; slot += 1) {
      const nameField = slot === 1 ? 'name' : `name${slot}`;
      const tagField = slot === 1 ? 'tagMembros' : `tagMembros${slot}`;
      const name = slot === 1 ? (primaryName || ctxGuildName() || 'Guilda principal') : String(cfg[nameField] || '').trim();
      slots.push({ slot, nameField, tagField, name, tag: String(cfg[tagField] || '').trim(), exists: slot === 1 ? true : !!name });
    }
    return slots;
  };
  const getNormalizedVipTier = () => {
    const raw = String(activeGuildContext()?.vipTier || 'free').toLowerCase().trim();
    if (!raw) return 'free';
    if (raw.includes('vital') || raw.includes('life') || raw.includes('parceiro') || raw.includes('partner')) return 'parceiro';
    if (raw.includes('ultra')) return 'ultra';
    if (raw.includes('business') || raw.includes('buss')) return 'business';
    if (raw.includes('pro')) return 'pro';
    if (raw.includes('plus')) return 'plus';
    return 'free';
  };
  const canOpenRecruitment = () => {
    const tier = getNormalizedVipTier();
    return recruitmentAllowedPlanIds.has(tier);
  };
  const parseRecruitmentPlanPrice = (data = {}) => {
    const raw = data.valor ?? data.price ?? data.preco ?? data.amount ?? data.monthlyPrice ?? data.value ?? 0;
    const normalized = String(raw ?? '0').replace(/[^\d,.-]/g, '').replace(',', '.');
    const n = Number(normalized);
    return Number.isFinite(n) ? n : 0;
  };
  let recruitmentAllowedPlanIds = new Set(['pro', 'business', 'ultra', 'parceiro']);
  async function refreshRecruitmentAllowedPlans() {
    try {
      const snap = await getDocs(collection(db, 'planos'));
      const plans = snap.docs.map((planDoc) => {
        const data = planDoc.data() || {};
        const id = normalizeRecruitmentVipTier(data.id || data.slug || data.tier || data.nome || data.name || planDoc.id);
        return { id, price: parseRecruitmentPlanPrice(data), active: data.active !== false && data.ativo !== false && data.enabled !== false };
      }).filter((plan) => plan.id && plan.active);
      const pro = plans.find((plan) => plan.id === 'pro');
      const proPrice = Number(pro?.price || 0);
      if (!proPrice) return;
      const allowed = new Set(['pro', 'business', 'ultra', 'parceiro']);
      plans.forEach((plan) => {
        if (plan.id === 'parceiro' || plan.price >= proPrice) allowed.add(plan.id);
      });
      recruitmentAllowedPlanIds = allowed;
    } catch (err) {
      console.warn('Nao foi possivel carregar planos para recrutamento:', err);
    }
  }
  const normalizeGuildAccessKey = (value = '') => String(value || '').trim().toLowerCase();
  const isValidGuildAccessKey = (value = '') => /^ghub-\d{9}$/.test(normalizeGuildAccessKey(value));
  const invalidGuildKeyMessage = 'Digite uma chave válida. Ela deve começar com ghub- e ter 9 números depois.';
  function setManualKeyMode(showManual = true) {
    const method = showManual ? 'remove' : 'add';
    [els.keyInput, els.loadBtn, els.keyLabel].forEach((el) => {
      if (!el) return;
      el.classList[method]('hidden');
    });
    if (els.keyInput) {
      els.keyInput.disabled = !showManual || !canOpenRecruitment();
    }
    if (els.loadBtn) {
      els.loadBtn.disabled = !showManual || !canOpenRecruitment();
    }
  }
  function applyRecruitmentVipGate() {
    const allowed = canOpenRecruitment();
    const disabledText = 'O recrutamento está disponível apenas para os planos Pro, Business, Ultra ou Parceiro.';
    [els.loadBtn, els.reloadBtn, els.newBtn].forEach((btn) => {
      if (!btn) return;
      btn.disabled = !allowed;
      btn.classList.toggle('opacity-50', !allowed);
      btn.classList.toggle('cursor-not-allowed', !allowed);
      if (!allowed) btn.setAttribute('title', disabledText);
      else btn.removeAttribute('title');
    });
    if (els.keyInput) {
      els.keyInput.disabled = !allowed || els.keyInput.classList.contains('hidden');
      els.keyInput.classList.toggle('opacity-60', !allowed);
      if (!allowed) els.keyInput.setAttribute('title', disabledText);
      else els.keyInput.removeAttribute('title');
    }
    if (els.loadBtn) {
      els.loadBtn.disabled = !allowed || els.loadBtn.classList.contains('hidden');
      if (!allowed) els.loadBtn.setAttribute('title', disabledText);
      else els.loadBtn.removeAttribute('title');
    }
    if (els.planWarning) {
      els.planWarning.classList.toggle('hidden', allowed);
    }
    initIcons();
    return allowed;
  }


  const normalizeRecruitmentStatus = (status = '') => {
    const raw = String(status || '').toLowerCase().trim();
    return raw === RECRUITMENT_INACTIVE_STATUS ? RECRUITMENT_INACTIVE_STATUS : RECRUITMENT_ACTIVE_STATUS;
  };
  const recruitmentStatusLabel = (status = currentRecruitmentStatus) => (
    normalizeRecruitmentStatus(status) === RECRUITMENT_INACTIVE_STATUS ? 'INATIVO' : 'ATIVO'
  );
  function getRecruitmentDoc(status = currentRecruitmentStatus, guildId = linkedUid || ctxGuildId()) {
    return recruitmentDocRef(normalizeRecruitmentStatus(status), guildId);
  }
  function getRecruitmentRequests(status = currentRecruitmentStatus, guildId = linkedUid || ctxGuildId()) {
    return recruitmentRequestsCollection(normalizeRecruitmentStatus(status), guildId);
  }
  function getRecruitmentRequestDoc(status, guildId, requestId) {
    return recruitmentRequestDocRef(normalizeRecruitmentStatus(status), guildId, requestId);
  }
  function extractR2KeyFromUrl(value = '') {
    const clean = String(value || '').trim();
    if (!clean) return '';
    if (!/^https?:\/\//i.test(clean)) return clean.replace(/^\/+/, '');
    try {
      return decodeURIComponent(new URL(clean).pathname.replace(/^\/+/, ''));
    } catch (_) {
      return '';
    }
  }
  async function callRecruitmentImageApi(payload = {}) {
    const token = await auth.currentUser?.getIdToken?.();
    if (!token) throw new Error('Sessao expirada. Entre novamente.');
    const resp = await fetch('/api/recruitment_image', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify(payload)
    });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok || data?.ok === false) throw new Error(data?.error || 'Falha ao processar imagem.');
    return data || {};
  }
  async function uploadRecruitmentPhotoIfNeeded() {
    if (!currentPhotoBase64) {
      const oldBase64 = String(currentRecruitment?.photoBase64 || '').trim();
      if (oldBase64.startsWith('data:image/')) {
        const migrated = await callRecruitmentImageApi({
          action: 'upload',
          guildId: linkedUid || ctxGuildId(),
          dataUrl: oldBase64,
          oldKey: currentRecruitment?.photoKey || extractR2KeyFromUrl(currentRecruitment?.photoUrl || ''),
          oldUrl: currentRecruitment?.photoUrl || ''
        });
        return {
          photoUrl: migrated.url || '',
          photoKey: migrated.key || '',
          photoBytes: Number(migrated.bytes || currentRecruitment?.photoBytes || dataUrlSizeBytes(oldBase64) || 0)
        };
      }
      return {
        photoUrl: currentRecruitment?.photoUrl || currentRecruitment?.photoBase64 || '',
        photoKey: currentRecruitment?.photoKey || extractR2KeyFromUrl(currentRecruitment?.photoUrl || ''),
        photoBytes: currentRecruitment?.photoBytes || 0
      };
    }
    const oldKey = currentRecruitment?.photoKey || extractR2KeyFromUrl(currentRecruitment?.photoUrl || '');
    const result = await callRecruitmentImageApi({
      action: 'upload',
      guildId: linkedUid || ctxGuildId(),
      dataUrl: currentPhotoBase64,
      oldKey,
      oldUrl: currentRecruitment?.photoUrl || ''
    });
    return {
      photoUrl: result.url || '',
      photoKey: result.key || '',
      photoBytes: Number(result.bytes || currentPhotoBytes || dataUrlSizeBytes(currentPhotoBase64) || 0)
    };
  }
  async function deleteRecruitmentPhotoIfNeeded(item = currentRecruitment) {
    const key = item?.photoKey || extractR2KeyFromUrl(item?.photoUrl || '');
    if (!key) return;
    try {
      await callRecruitmentImageApi({
        action: 'delete',
        guildId: linkedUid || ctxGuildId(),
        key,
        url: item?.photoUrl || ''
      });
    } catch (err) {
      console.warn('Falha ao remover foto do R2:', err);
    }
  }
  async function commitRecruitmentBatch(actions = []) {
    const list = Array.isArray(actions) ? actions : [];
    for (let i = 0; i < list.length; i += 450) {
      const batch = writeBatch(db);
      list.slice(i, i + 450).forEach((action) => action(batch));
      await batch.commit();
    }
  }
  async function deleteRecruitmentRequests(status, guildId) {
    const snap = await getDocs(recruitmentRequestsCollection(normalizeRecruitmentStatus(status), guildId));
    const actions = snap.docs.map((requestDoc) => (batch) => batch.delete(requestDoc.ref));
    if (actions.length) await commitRecruitmentBatch(actions);
  }
  async function copyRecruitmentRequests(fromStatus, toStatus, guildId) {
    const snap = await getDocs(recruitmentRequestsCollection(normalizeRecruitmentStatus(fromStatus), guildId));
    const actions = [];
    snap.docs.forEach((requestDoc) => {
      const targetRef = recruitmentRequestDocRef(normalizeRecruitmentStatus(toStatus), guildId, requestDoc.id);
      actions.push((batch) => batch.set(targetRef, requestDoc.data() || {}, { merge: true }));
      actions.push((batch) => batch.delete(requestDoc.ref));
    });
    if (actions.length) await commitRecruitmentBatch(actions);
  }
  async function moveRecruitmentStatus(fromStatus, toStatus, sourceData = null, reason = 'manual') {
    const guildId = linkedUid || ctxGuildId();
    if (!guildId) return false;
    const from = normalizeRecruitmentStatus(fromStatus);
    const to = normalizeRecruitmentStatus(toStatus);
    if (from === to) return true;
    const fromRef = recruitmentDocRef(from, guildId);
    const fromSnap = sourceData ? null : await getDoc(fromRef);
    const data = sourceData || (fromSnap?.exists() ? fromSnap.data() : null);
    if (!data) return false;
    const now = Date.now();
    const nextData = {
      ...data,
      id: guildId,
      guildId,
      status: to,
      active: to === RECRUITMENT_ACTIVE_STATUS,
      updatedAt: serverTimestamp(),
      updatedAtMs: now
    };
    if (nextData.photoUrl) nextData.photoBase64 = deleteField();
    if (to === RECRUITMENT_INACTIVE_STATUS) {
      nextData.inactivatedAtMs = Number(data.inactivatedAtMs || 0) || now;
      nextData.inactiveReason = reason || 'manual';
    } else {
      nextData.activatedAtMs = now;
      nextData.inactivatedAtMs = null;
      nextData.inactiveReason = null;
    }
    await setDoc(recruitmentDocRef(to, guildId), nextData, { merge: true });
    await copyRecruitmentRequests(from, to, guildId);
    await deleteDoc(fromRef);
    currentRecruitmentStatus = to;
    currentRecruitment = { ...nextData, id: guildId };
    clearRecruitmentRequestsCache(guildId);
    writeRecruitmentDataCache(guildId);
    return true;
  }
  async function deleteRecruitmentTree(status = currentRecruitmentStatus, guildId = linkedUid || ctxGuildId(), options = {}) {
    const ref = recruitmentDocRef(normalizeRecruitmentStatus(status), guildId);
    const snap = await getDoc(ref);
    const data = snap.exists() ? ({ id: snap.id, ...snap.data() }) : null;
    if (options.deletePhoto !== false && data) await deleteRecruitmentPhotoIfNeeded(data);
    await deleteRecruitmentRequests(status, guildId);
    if (snap.exists()) await deleteDoc(ref);
    clearRecruitmentDataCache(guildId);
    clearRecruitmentRequestsCache(guildId);
  }
  async function cleanupInactiveRecruitmentIfNeeded() {
    const guildId = linkedUid || ctxGuildId();
    if (!guildId || canOpenRecruitment()) return false;
    const snap = await getDoc(recruitmentDocRef(RECRUITMENT_INACTIVE_STATUS, guildId));
    if (!snap.exists()) return false;
    const data = snap.data() || {};
    const inactiveAt = Number(data.inactivatedAtMs || data.updatedAtMs || data.dateMs || 0) || Date.now();
    if ((Date.now() - inactiveAt) < RECRUITMENT_INACTIVE_DELETE_MS) return false;
    await deleteRecruitmentTree(RECRUITMENT_INACTIVE_STATUS, guildId, { deletePhoto: true });
    currentRecruitment = null;
    currentRequests = [];
    writeRecruitmentDataCache(guildId);
    return true;
  }

  function closeManagementCustomSelects(exceptSelect = null) {
    document.querySelectorAll('[data-rec-dd-select-id]').forEach((menu) => {
      const selectId = menu.getAttribute('data-rec-dd-select-id') || '';
      const trigger = document.querySelector(`[data-rec-dd-trigger-for="${selectId}"]`);
      const wrap = menu.closest('.rq-dd');
      if (exceptSelect && String(exceptSelect.id || '') === selectId) return;
      menu.classList.add('hidden');
      trigger?.classList.remove('is-open');
      wrap?.classList.remove('rq-dd-open');
    });
  }
  function syncManagementCustomSelect(select) {
    if (!select) return;
    const selectId = String(select.id || '');
    const trigger = document.querySelector(`[data-rec-dd-trigger-for="${selectId}"]`);
    const label = trigger?.querySelector('.rq-dd-label');
    const selectedOption = select.options[select.selectedIndex] || select.options[0] || null;
    const isPlaceholder = !String(select.value || '').trim();
    if (label) {
      label.textContent = selectedOption ? selectedOption.textContent : 'Selecione';
      label.classList.toggle('is-placeholder', isPlaceholder);
    }
    if (trigger) trigger.disabled = !!select.disabled;
    document.querySelectorAll(`[data-rec-dd-option-for="${selectId}"]`).forEach((btn) => {
      const active = String(btn.getAttribute('data-value') || '') === String(select.value || '');
      btn.classList.toggle('is-selected', active);
      btn.setAttribute('aria-selected', active ? 'true' : 'false');
    });
  }
  function enhanceManagementCustomSelect(select) {
    if (!select || select.dataset.recCustomSelect !== 'true') return;
    if (!select.id) {
      const owner = select.closest('[data-rec-question]')?.dataset.recQuestion || createRecruitmentBuilderId('select');
      select.id = `rec-select-${String(owner).replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 40)}-${Math.random().toString(36).slice(2, 7)}`;
    }
    if (select.dataset.recDdInit === '1') {
      syncManagementCustomSelect(select);
      return;
    }
    const wrap = select.closest('.rq-select-wrap') || select.parentElement;
    if (!wrap) return;

    wrap.classList.add('rq-dd');
    select.dataset.recDdInit = '1';
    select.classList.add('rq-dd-native');

    wrap.querySelectorAll('[data-rec-dd-trigger-for], [data-rec-dd-select-id]').forEach((node) => node.remove());
    wrap.querySelectorAll('i[data-lucide="chevron-down"]').forEach((icon) => icon.remove());

    const trigger = document.createElement('button');
    trigger.type = 'button';
    trigger.className = 'rq-dd-btn';
    trigger.setAttribute('data-rec-dd-trigger-for', select.id);
    trigger.innerHTML = `<span class="rq-dd-label">Selecione</span><span class="rq-dd-arrow">▾</span>`;

    const menu = document.createElement('div');
    menu.className = 'rq-dd-menu hidden';
    menu.setAttribute('data-rec-dd-select-id', select.id);

    [...select.options].forEach((option) => {
      const item = document.createElement('button');
      item.type = 'button';
      item.className = 'rq-dd-item';
      item.setAttribute('data-rec-dd-option-for', select.id);
      item.setAttribute('data-value', option.value);
      item.setAttribute('aria-selected', option.selected ? 'true' : 'false');
      item.innerHTML = `<span class="rq-dd-item-text">${escapeHtml(option.textContent || '')}</span><span class="rq-dd-check">✓</span>`;
      item.addEventListener('click', () => {
        select.value = option.value;
        select.dispatchEvent(new Event('change', { bubbles: true }));
        syncManagementCustomSelect(select);
        wrap.classList.remove('rq-dd-open');
        closeManagementCustomSelects();
      });
      menu.appendChild(item);
    });

    trigger.addEventListener('click', (event) => {
      event.preventDefault();
      if (select.disabled) return;
      const willOpen = menu.classList.contains('hidden');
      closeManagementCustomSelects(willOpen ? select : null);
      menu.classList.toggle('hidden', !willOpen);
      trigger.classList.toggle('is-open', willOpen);
      wrap.classList.toggle('rq-dd-open', willOpen);
    });

    select.addEventListener('change', () => syncManagementCustomSelect(select));

    wrap.appendChild(trigger);
    wrap.appendChild(menu);
    syncManagementCustomSelect(select);
  }
  function initManagementCustomSelects() {
    document.querySelectorAll('select[data-rec-custom-select="true"]').forEach((select) => {
      enhanceManagementCustomSelect(select);
      syncManagementCustomSelect(select);
    });
  }

  function setStatus(message, type='info') {
    const map = { info:'hidden', loading:'border-gray-200 bg-gray-50 text-gray-600', success:'border-emerald-200 bg-emerald-50 text-emerald-700', error:'border-red-200 bg-red-50 text-red-700', warn:'border-amber-200 bg-amber-50 text-amber-700' };
    if (!els.keyStatus) return;
    if (!message) {
      els.keyStatus.className = 'mt-4 hidden rounded-xl border px-4 py-3 text-sm';
      els.keyStatus.textContent = '';
      return;
    }
    els.keyStatus.className = `mt-4 rounded-xl border px-4 py-3 text-sm ${map[type] || map.info}`;
    els.keyStatus.textContent = message;
  }

  const RECRUITMENT_JSON_IMPORT_MAX_BYTES = 5 * 1024 * 1024;

  function downloadJsonFile(filename, payload) {
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  function readJsonFile(file, maxBytes = RECRUITMENT_JSON_IMPORT_MAX_BYTES) {
    return new Promise((resolve, reject) => {
      if (!file) {
        reject(new Error('Selecione um arquivo JSON.'));
        return;
      }
      const isJson = file.type === 'application/json' || /\.json$/i.test(file.name || '');
      if (!isJson) {
        reject(new Error('O arquivo precisa estar no formato .json.'));
        return;
      }
      if (file.size > maxBytes) {
        reject(new Error('Esse JSON esta grande demais. A foto do recrutamento pode estar muito pesada.'));
        return;
      }
      const reader = new FileReader();
      reader.onload = () => {
        try { resolve(JSON.parse(String(reader.result || '{}'))); }
        catch (_) { reject(new Error('Nao foi possivel ler o JSON. Verifique se o arquivo nao esta corrompido.')); }
      };
      reader.onerror = () => reject(new Error('Nao foi possivel abrir o arquivo.'));
      reader.readAsText(file, 'utf-8');
    });
  }

  function backupString(value, max = 160) {
    return String(value ?? '').trim().slice(0, max);
  }

  function backupNumber(value, fallback = 0) {
    const n = Number(value);
    if (!Number.isFinite(n) || n < 0) return fallback;
    return Math.floor(n);
  }

  function backupArray(value, maxItems = 12, maxText = 80) {
    const list = Array.isArray(value) ? value : (value != null && value !== '' ? [value] : []);
    return list.map(v => backupString(v, maxText)).filter(Boolean).slice(0, maxItems);
  }
  function backupRecruitmentSections(value) {
    return (Array.isArray(value) ? value : []).map((section, index) => ({
      id: backupString(section?.id || `section_${index + 1}`, 40),
      title: backupString(section?.title || '', 50),
      items: backupArray(section?.items, MAX_RECRUITMENT_OPTIONS, 50)
    })).filter((section) => section.title && section.items.length).slice(0, MAX_RECRUITMENT_SECTIONS);
  }
  function backupRecruitmentFields(value) {
    return (Array.isArray(value) ? value : []).map((field, index) => {
      const type = RECRUITMENT_FIELD_TYPES.has(String(field?.type || '')) ? String(field.type) : 'text';
      return {
        id: backupString(field?.id || `question_${index + 1}`, 40),
        label: backupString(field?.label || '', 70),
        type,
        required: field?.required === true,
        options: ['select', 'multiselect'].includes(type) ? backupArray(field?.options, MAX_RECRUITMENT_OPTIONS, 50) : []
      };
    }).filter((field) => field.label).slice(0, MAX_RECRUITMENT_FIELDS);
  }
  function backupCustomAnswers(value) {
    return (Array.isArray(value) ? value : []).map((answer, index) => ({
      id: backupString(answer?.id || `answer_${index + 1}`, 40),
      label: backupString(answer?.label || '', 70),
      type: backupString(answer?.type || 'text', 20),
      value: backupString(answer?.value || '', 240)
    })).filter((answer) => answer.label && answer.value).slice(0, MAX_RECRUITMENT_FIELDS);
  }

  function sanitizeRecruitmentForBackup(item = {}) {
    if (!item || typeof item !== 'object') return null;
    return {
      id: backupString(item.id || linkedUid || ctxGuildId(), 120),
      guildName: backupString(item.guildName || ctxGuildName(), 120),
      dateMs: backupNumber(item.dateMs || Date.now(), Date.now()),
      roles: backupArray(item.roles, 12, 60),
      contacts: backupArray(item.contacts, 12, 60),
      guildType: backupArray(item.guildType, 12, 60),
      focus: backupArray(item.focus, 12, 60),
      description: backupString(item.description || '', 100),
      platform: backupString(item.platform || '', 80),
      minimumAge: backupString(item.minimumAge || '', 40),
      nickChangeRequired: backupString(item.nickChangeRequired || '', 80),
      nickChangeDeadline: backupString(item.nickChangeDeadline || '', 80),
      teamPlay: backupString(item.teamPlay || '', 80),
      useCall: backupString(item.useCall || '', 80),
      customSections: backupRecruitmentSections(item.customSections),
      applicationFields: backupRecruitmentFields(item.applicationFields),
      formVersion: Number(item.formVersion || 0) >= 2 ? 2 : 1,
      key: normalizeGuildAccessKey(item.key || openedKey || ''),
      ownerUid: backupString(item.ownerUid || ctxGuildId() || linkedUid, 120),
      guildId: backupString(item.guildId || linkedUid || ctxGuildId(), 120),
      status: normalizeRecruitmentStatus(item.status || currentRecruitmentStatus),
      photoUrl: backupString(item.photoUrl || '', 600),
      photoKey: backupString(item.photoKey || '', 300),
      photoBase64: backupString(item.photoBase64 || '', 1200000),
      photoBytes: backupNumber(item.photoBytes || dataUrlSizeBytes(item.photoBase64 || ''), 0)
    };
  }

  function sanitizeImportedRecruitment(raw = {}) {
    const clean = sanitizeRecruitmentForBackup(raw);
    if (!clean) return null;
    clean.guildName = clean.guildName || ctxGuildName() || 'Guilda';
    clean.key = normalizeGuildAccessKey(clean.key || openedKey || '');
    clean.guildId = backupString(clean.guildId || linkedUid || ctxGuildId(), 120);
    clean.ownerUid = backupString(clean.ownerUid || ctxGuildId() || linkedUid, 120);
    clean.photoBytes = clean.photoBase64 ? dataUrlSizeBytes(clean.photoBase64) : backupNumber(clean.photoBytes || 0, 0);
    if (!clean.guildName) return null;
    if (!clean.roles.length && !clean.customSections.length && Number(clean.formVersion || 0) < 2) return null;
    if (!clean.photoUrl && (!clean.photoBase64 || !String(clean.photoBase64).startsWith('data:image/'))) return null;
    if (clean.photoBytes > 900 * 1024) return null;
    return clean;
  }

  function sanitizeRequestForBackup(item = {}) {
    if (!item || typeof item !== 'object') return null;
    const id = backupString(item.id || item.visibleId || item.uid || item.playerId, 80);
    if (!id || id.includes('/')) return null;
    const contact = getRequestContact(item);
    return {
      id,
      nick: backupString(item.nick || item.nickname || item.name || item.nome || '', 80),
      nickname: backupString(item.nickname || '', 80),
      name: backupString(item.name || '', 80),
      nome: backupString(item.nome || '', 80),
      contactType: contact.type,
      contactValue: backupString(contact.value, 80),
      contactCountryCode: backupString(contact.countryCode, 8),
      whatsapp: contact.type === 'whatsapp' ? backupString(contact.value, 32) : '',
      phone: contact.type === 'whatsapp' ? backupString(contact.value, 32) : '',
      whatsappCountryCode: contact.type === 'whatsapp' ? backupString(contact.countryCode, 8) : '',
      phoneCountryCode: contact.type === 'whatsapp' ? backupString(contact.countryCode, 8) : '',
      instagram: contact.type === 'instagram' ? backupString(contact.value, 40) : '',
      discord: contact.type === 'discord' ? backupString(contact.value, 40) : '',
      roles: backupArray(item.roles, 8, 60),
      age: backupString(item.age || '', 20),
      availableTime: backupString(item.availableTime || '', 80),
      availableFridaySaturday: backupString(item.availableFridaySaturday || '', 80),
      playedGg: backupString(item.playedGg || '', 80),
      hasNickChange: backupString(item.hasNickChange || '', 80),
      customAnswers: backupCustomAnswers(item.customAnswers),
      formVersion: Number(item.formVersion || 0) >= 2 ? 2 : 1,
      status: backupString(item.status || 'pendente', 40),
      createdAt: item.createdAt || null,
      createdAtMs: backupNumber(item.createdAtMs || item.dateMs, 0),
      dateMs: backupNumber(item.dateMs || item.createdAtMs, 0),
      date: item.date || null
    };
  }

  function mountRecruitmentJsonBackupPanel() {
    if (document.getElementById('recruitment-json-backup-panel')) return;
    const view = els.view;
    const parent = view?.parentElement;
    if (!parent || !view) return;

    const panel = document.createElement('section');
    panel.id = 'recruitment-json-backup-panel';
    panel.className = 'rounded-2xl border border-emerald-100 bg-white p-4 shadow-sm';
    panel.innerHTML = `
      <div class="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div class="min-w-0">
          <div class="flex items-center gap-2">
            <span class="inline-flex h-9 w-9 items-center justify-center rounded-xl bg-emerald-50 text-emerald-700">
              <i data-lucide="file-json" class="w-5 h-5"></i>
            </span>
            <div>
              <h3 class="text-sm font-extrabold text-gray-900">Backup em JSON do recrutamento</h3>
              <p class="text-xs text-gray-500 mt-0.5">Baixe o anuncio e os pedidos desta guilda, ou restaure um JSON gerado por esta tela.</p>
            </div>
          </div>
          <p class="text-[11px] text-gray-500 mt-3 leading-relaxed">
            A importacao atualiza o anuncio e adiciona/atualiza pedidos com o mesmo ID. Ela nao apaga pedidos existentes e rejeita arquivo de outra tela, outra guilda ou foto pesada demais.
          </p>
        </div>
        <div class="flex shrink-0 flex-wrap gap-2 sm:justify-end">
          <button id="btn-export-recruitment-json" type="button" class="inline-flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-3 py-2 text-xs font-bold text-gray-700 hover:bg-gray-50">
            <i data-lucide="download" class="w-4 h-4"></i> Exportar JSON
          </button>
          <button id="btn-import-recruitment-json" type="button" class="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-3 py-2 text-xs font-bold text-white hover:bg-emerald-700">
            <i data-lucide="upload" class="w-4 h-4"></i> Importar JSON
          </button>
          <input id="input-import-recruitment-json" type="file" accept=".json,application/json" class="hidden" />
        </div>
      </div>
    `;
    parent.insertBefore(panel, view);

    document.getElementById('btn-export-recruitment-json')?.addEventListener('click', exportRecruitmentJson);
    document.getElementById('btn-import-recruitment-json')?.addEventListener('click', () => {
      document.getElementById('input-import-recruitment-json')?.click();
    });
    document.getElementById('input-import-recruitment-json')?.addEventListener('change', async (event) => {
      const input = event.currentTarget;
      try { await importRecruitmentJson(input.files?.[0]); }
      finally { if (input) input.value = ''; }
    });
    initIcons();
  }

  function exportRecruitmentJson() {
    const gid = ctxGuildId();
    const targetUid = linkedUid || gid;
    if (!targetUid) {
      showToast('error', 'Abra a chave da guilda antes de exportar.');
      return;
    }
    const payload = {
      app: 'guilda-hub',
      screen: 'recrutar',
      version: 1,
      guildId: gid,
      linkedUid: targetUid,
      openedKey,
      guildName: ctxGuildName(),
      exportedAt: new Date().toISOString(),
      data: {
        recruitment: currentRecruitment ? sanitizeRecruitmentForBackup(currentRecruitment) : null,
        requests: (currentRequests || []).map(sanitizeRequestForBackup).filter(Boolean)
      }
    };
    downloadJsonFile(`guilda-recrutamento-${targetUid}.json`, payload);
    showToast('success', 'JSON do recrutamento baixado.');
  }

  async function importRecruitmentJson(file) {
    const gid = ctxGuildId();
    const targetUid = linkedUid || gid;
    if (!targetUid) {
      showToast('error', 'Abra a chave da guilda antes de importar.');
      return;
    }
    try {
      const payload = await readJsonFile(file);
      if (!payload || payload.screen !== 'recrutar' || !payload.data || typeof payload.data !== 'object') {
        throw new Error('Esse arquivo nao parece ser um backup da tela de recrutamento.');
      }
      if (payload.guildId && gid && String(payload.guildId) !== String(gid)) {
        throw new Error('Esse JSON foi gerado para outra guilda.');
      }
      if (payload.linkedUid && String(payload.linkedUid) !== String(targetUid)) {
        throw new Error('Esse JSON pertence a outro recrutamento.');
      }

      const recruitment = payload.data.recruitment ? sanitizeImportedRecruitment(payload.data.recruitment) : null;
      const requests = Array.isArray(payload.data.requests)
        ? payload.data.requests.map(sanitizeRequestForBackup).filter(Boolean)
        : [];
      if (!recruitment && !requests.length) {
        throw new Error('Nao encontrei recrutamento ou pedidos validos dentro desse JSON.');
      }

      const ok = window.confirm(`Importar este JSON? O anuncio sera atualizado e ${requests.length} pedido(s) serao adicionados/atualizados. Nada sera apagado.`);
      if (!ok) return;

      if (recruitment) {
        const recPayload = {
          ...recruitment,
          key: normalizeGuildAccessKey(recruitment.key || openedKey || ''),
          ownerUid: ctxGuildId() || targetUid,
          guildId: targetUid,
          status: currentRecruitmentStatus,
          active: currentRecruitmentStatus === RECRUITMENT_ACTIVE_STATUS,
          updatedAt: serverTimestamp()
        };
        if (recPayload.photoBase64 && !recPayload.photoUrl) {
          const uploaded = await callRecruitmentImageApi({
            action: 'upload',
            guildId: targetUid,
            dataUrl: recPayload.photoBase64,
            oldKey: currentRecruitment?.photoKey || extractR2KeyFromUrl(currentRecruitment?.photoUrl || ''),
            oldUrl: currentRecruitment?.photoUrl || ''
          });
          recPayload.photoUrl = uploaded.url || '';
          recPayload.photoKey = uploaded.key || '';
          recPayload.photoBytes = Number(uploaded.bytes || recPayload.photoBytes || 0);
        }
        delete recPayload.photoBase64;
        recPayload.photoBase64 = deleteField();
        if (!currentRecruitment) recPayload.createdAt = serverTimestamp();
        await setDoc(getRecruitmentDoc(currentRecruitmentStatus, targetUid), recPayload, { merge: true });
        currentRecruitment = { ...currentRecruitment, ...recPayload, id: targetUid };
        openedKey = recPayload.key || openedKey;
        if (els.openedKey && openedKey) els.openedKey.textContent = openedKey;
      }

      for (const request of requests) {
        const { id, ...data } = request;
        await setDoc(getRecruitmentRequestDoc(currentRecruitmentStatus, targetUid, id), {
          ...data,
          id,
          updatedAt: serverTimestamp()
        }, { merge: true });
      }

      if (requests.length) {
        const merged = new Map((currentRequests || []).map(item => [String(item.id || ''), item]));
        requests.forEach((request) => merged.set(String(request.id), { ...(merged.get(String(request.id)) || {}), ...request }));
        currentRequests = Array.from(merged.values());
      }
      writeRecruitmentDataCache(targetUid);
      writeRecruitmentRequestsCache(targetUid, currentRecruitmentStatus);
      renderRecruitment();
      renderRequests();
      setStatus('JSON importado no recrutamento.', 'success');
      showToast('success', 'JSON importado no recrutamento.');
    } catch (err) {
      console.error(err);
      showToast('error', err?.message || 'Nao foi possivel importar o JSON.');
    }
  }

  function setKeyCheckingState(message = 'Verificando chave de guilda...') {
    setManualKeyMode(false);
    setStatus(message, 'loading');
    if (els.openedKey) els.openedKey.textContent = 'Verificando...';
  }
  function setPhotoFileName(text = 'Nenhuma imagem escolhida') {
    if (els.photoFileName) els.photoFileName.textContent = text;
  }
  function setButtonBusy(button, busy, label = 'Aguarde...') {
    if (!button) return;
    if (busy) {
      if (!button.dataset.originalHtml) button.dataset.originalHtml = button.innerHTML;
      button.disabled = true;
      button.classList.add('opacity-70', 'cursor-not-allowed');
      button.innerHTML = `<span class="inline-flex items-center justify-center gap-2"><i data-lucide="loader-2" class="w-4 h-4 animate-spin"></i>${escapeHtml(label)}</span>`;
      initIcons();
      return;
    }
    button.disabled = false;
    button.classList.remove('opacity-70', 'cursor-not-allowed');
    if (button.dataset.originalHtml) {
      button.innerHTML = button.dataset.originalHtml;
      delete button.dataset.originalHtml;
      initIcons();
    }
  }
  function resetPhotoState() {
    currentPhotoBase64 = ''; currentPhotoBytes = 0;
    if (els.photoInput) els.photoInput.value = '';
    if (els.photoPreview) els.photoPreview.src = '';
    if (els.photoPreviewWrap) els.photoPreviewWrap.classList.add('hidden');
    if (els.photoStatus) els.photoStatus.textContent = 'Nenhuma foto selecionada.';
    setPhotoFileName();
  }
  function setPhotoPreview(base64='', bytes=0, fileName='Foto selecionada') {
    currentPhotoBase64 = base64 || ''; currentPhotoBytes = Number(bytes) || 0;
    if (currentPhotoBase64 && els.photoPreview && els.photoPreviewWrap) {
      els.photoPreview.src = currentPhotoBase64;
      els.photoPreviewWrap.classList.remove('hidden');
      if (els.photoStatus) els.photoStatus.textContent = `Foto pronta para salvar (${Math.max(1, Math.round(currentPhotoBytes/1024))} KB).`;
      setPhotoFileName(fileName || 'Foto selecionada');
    } else resetPhotoState();
  }
  async function handleRecruitmentPhotoFile(file) {
    if (!file) {
      if (!recruitmentPhotoSrc(currentRecruitment)) resetPhotoState();
      return;
    }
    if (!String(file.type || '').startsWith('image/')) {
      if (els.photoInput) els.photoInput.value = '';
      showToast('error', 'Selecione um arquivo de imagem válido.');
      return;
    }
    try {
      setPhotoFileName(file.name || 'Imagem selecionada');
      if (els.photoStatus) els.photoStatus.textContent = 'Comprimindo imagem...';
      const result = await compressImageToBase64(file, 800 * 1024);
      setPhotoPreview(result.base64, result.bytes, file.name || 'Imagem selecionada');
    } catch (err) {
      console.error(err);
      resetPhotoState();
      showToast('error', err?.message || 'Não foi possível processar a imagem.');
    }
  }
  function updateCreateButtonVisibility() {
    if (!els.newBtn) return;
    const allowed = canOpenRecruitment();
    els.newBtn.classList.toggle('hidden', !allowed || !linkedUid || !!currentRecruitment);
    els.newBtn.disabled = !allowed;
    updateCopyLinkVisibility();
  }
  function getRecruitmentShareLink() {
    const uid = String(currentRecruitment?.id || linkedUid || '').trim();
    if (!uid) return '';
    return `https://guildahub.online/eventos?q=${encodeURIComponent(uid)}`;
  }
  function updateCopyLinkVisibility() {
    if (!els.copyBtn) return;
    const hasRecruitment = !!String(currentRecruitment?.id || linkedUid || '').trim() && !!currentRecruitment;
    els.copyBtn.classList.toggle('hidden', !hasRecruitment);
  }
  async function copyRecruitmentLink() {
    const link = getRecruitmentShareLink();
    if (!link) {
      showToast('error', 'Abra ou crie um recrutamento antes de copiar o link.');
      return;
    }
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(link);
      } else {
        const input = document.createElement('input');
        input.value = link;
        document.body.appendChild(input);
        input.select();
        document.execCommand('copy');
        input.remove();
      }
      showToast('success', 'Link do recrutamento copiado!');
    } catch (err) {
      console.error(err);
      showToast('error', 'Não foi possível copiar o link.');
    }
  }
  function closeModal(){ els.modal?.classList.add('hidden'); }
  function openModal(mode='create') {
    if (!els.form || !els.modal) return;
    if (!canOpenRecruitment()) {
      setStatus('O recrutamento está disponível apenas para os planos Pro, Business, Ultra ou Parceiro.','warn');
      showToast('error', 'Libere o plano Pro, Business, Ultra ou Parceiro para criar recrutamento.');
      return;
    }
    els.form.reset();
    if (els.descCount) els.descCount.textContent = '0/100';
    if (els.modalTitle) els.modalTitle.textContent = mode === 'edit' ? 'Editar recrutamento' : 'Novo recrutamento';
    if (els.guildName) els.guildName.value = currentRecruitment?.guildName || ctxGuildName() || '';
    recruitmentCustomSections = mode === 'edit' && currentRecruitment
      ? normalizeRecruitmentCustomSections(currentRecruitment)
      : [];
    recruitmentApplicationFields = mode === 'edit' && currentRecruitment
      ? normalizeRecruitmentApplicationFields(currentRecruitment)
      : [];
    renderRecruitmentBuilders();
    resetPhotoState();
    if (mode === 'edit' && currentRecruitment) {
      if (els.desc) {
        els.desc.value = currentRecruitment.description || '';
        if (els.descCount) els.descCount.textContent = `${els.desc.value.length}/100`;
      }
      const currentPhoto = recruitmentPhotoSrc(currentRecruitment);
      if (currentPhoto) {
        if (String(currentPhoto).startsWith('data:image/')) {
          setPhotoPreview(currentPhoto, currentRecruitment.photoBytes || dataUrlSizeBytes(currentPhoto), 'Foto atual do recrutamento');
        } else {
          currentPhotoBase64 = '';
          currentPhotoBytes = 0;
          if (els.photoPreview) els.photoPreview.src = currentPhoto;
          if (els.photoPreviewWrap) els.photoPreviewWrap.classList.remove('hidden');
          if (els.photoStatus) els.photoStatus.textContent = 'Foto atual pronta.';
          setPhotoFileName('Foto atual do recrutamento');
        }
      }
    }
    els.modal.classList.remove('hidden');
    initManagementCustomSelects();
    initIcons();
  }
  function closeRequestModal() { activeRequest = null; els.requestModal?.classList.add('hidden'); }
  function closeDeleteRecModal() {
    if (!els.deleteRecModal) return;
    els.deleteRecModal.classList.add('hidden');
    els.deleteRecModal.classList.remove('flex');
  }
  function openDeleteRecModal() {
    if (!linkedUid || !currentRecruitment || !els.deleteRecModal) return;
    els.deleteRecModal.classList.remove('hidden');
    els.deleteRecModal.classList.add('flex');
    initIcons();
  }
  function openRequestModal(item) {
    if (!item || !els.requestModal) return;
    activeRequest = item;
    const meta = getRequestStatusMeta(item.status || 'pendente');
    if (els.requestModalName) els.requestModalName.textContent = item.nick || item.nickname || item.name || item.nome || 'Sem nome';
    if (els.requestModalId) els.requestModalId.textContent = item.id || '-';
    if (els.requestModalStatus) {
      els.requestModalStatus.textContent = meta.label;
      els.requestModalStatus.className = `inline-flex items-center rounded-full ring-1 px-2.5 py-1 text-[11px] font-extrabold ${meta.className}`;
    }
    if (els.requestModalDate) els.requestModalDate.textContent = formatDateBR(item.createdAt || item.dateMs || item.date || Date.now());
    if (els.requestModalModes) {
      const chips = [];
      if (Array.isArray(item.roles) && item.roles.length) chips.push(...item.roles.map(v => tagChip(v,'role')));
      if (item.age) chips.push(tagChip(`Idade: ${item.age}`,'default'));
      if (item.availableTime) chips.push(tagChip(`Horário: ${item.availableTime}`,'default'));
      if (item.availableFridaySaturday) chips.push(tagChip(`Sex/Sáb: ${item.availableFridaySaturday}`,'default'));
      if (item.playedGg) chips.push(tagChip(`Já jogou GG: ${item.playedGg}`,'default'));
      if (item.hasNickChange) chips.push(tagChip(`Troca nick: ${item.hasNickChange}`,'default'));
      els.requestModalModes.parentElement?.classList.toggle('hidden', !chips.length);
      els.requestModalModes.innerHTML = chips.join(' ');
    }
    if (els.requestModalWhatsapp) {
      const contact = getRequestContact(item);
      const href = formatRequestContactHref(item);
      const label = formatRequestContactLabel(item);
      const platform = REQUEST_CONTACT_LABELS[contact.type] || 'Contato';
      const discordCopy = contact.type === 'discord' && !/^\d{15,22}$/.test(contact.value)
        ? ` data-copy-discord="${escapeHtml(contact.value)}"`
        : '';
      els.requestModalWhatsapp.innerHTML = href
        ? `<p class="mb-1 text-[11px] font-bold uppercase text-gray-400">${escapeHtml(platform)}</p><a href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer"${discordCopy} class="text-emerald-600 font-semibold hover:underline break-all">${escapeHtml(label)}</a>`
        : '<span class="text-gray-400">Não informado</span>';
    }
    const customAnswers = backupCustomAnswers(item.customAnswers);
    if (els.requestModalAnswersWrap && els.requestModalAnswers) {
      els.requestModalAnswersWrap.classList.toggle('hidden', !customAnswers.length);
      els.requestModalAnswers.innerHTML = customAnswers.map((answer) => `
        <div class="rounded-xl border border-gray-200 bg-gray-50 px-3 py-2.5">
          <p class="text-[11px] font-bold text-gray-500">${escapeHtml(answer.label)}</p>
          <p class="mt-1 whitespace-pre-wrap break-words text-sm font-semibold text-gray-900">${escapeHtml(answer.value)}</p>
        </div>`).join('');
    }
    populateRequestTargetSlotOptions('1');
    els.requestModal.classList.remove('hidden');
    initManagementCustomSelects();
    initIcons();
  }
  async function removeRequest(requestId) {
    if (!linkedUid || !requestId) return;
    await deleteDoc(getRecruitmentRequestDoc(currentRecruitmentStatus, linkedUid, requestId));
    currentRequests = currentRequests.filter((item) => String(item.id || '') !== String(requestId));
    writeRecruitmentRequestsCache(linkedUid, currentRecruitmentStatus);
  }
  async function acceptRequest(item) {
    const guildId = ctxGuildId() || String(linkedUid || '').trim();
    if (!guildId || !item?.id) throw new Error('Guilda ou pedido inválido.');
    const targetSlot = String(els.requestTargetSlot?.value || '1').trim() || '1';
    const targetCollection = getManagementMembersCollection(targetSlot);
    let requestPlayMode = Array.isArray(item.roles)
      ? item.roles.map(v => String(v || '').trim()).filter(Boolean)
      : [];
    if (!requestPlayMode.length && Array.isArray(item.customAnswers)) {
      const modeAnswer = item.customAnswers.find((answer) => /modo|fun[cç][aã]o|posi[cç][aã]o/i.test(String(answer?.label || '')));
      requestPlayMode = String(modeAnswer?.value || '').split('|').map((value) => value.trim()).filter(Boolean).slice(0, 8);
    }
    const requestNick = String(item.nick || item.nickname || item.name || item.nome || '').trim() || 'Sem nick';
    const requestContact = getRequestContact(item);
    if (encontrarPalavraImpropria(requestNick)) {
      throw new Error('O nick do pedido contém palavra imprópria. Recuse ou peça para o jogador enviar novamente.');
    }
    const payload = {
      visibleId: String(item.id || '').trim(),
      nick: requestNick,
      contactType: requestContact.type,
      contactValue: requestContact.value,
      contactCountryCode: requestContact.countryCode,
      whatsapp: requestContact.type === 'whatsapp' ? requestContact.value : '',
      whatsappCountryCode: requestContact.type === 'whatsapp' ? requestContact.countryCode : '',
      instagram: requestContact.type === 'instagram' ? requestContact.value : '',
      discord: requestContact.type === 'discord' ? requestContact.value : '',
      guildWar: false,
      guildWarMeta: 0,
      weeklyMeta: false,
      weeklyMetaValue: 0,
      hasTag: false,
      playMode: requestPlayMode,
      mode: requestPlayMode,
      role: requestPlayMode[0] || '',
      status: 'ativo',
      source: 'recrutamento',
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    };
    await setDoc(doc(db, 'guildas', guildId, targetCollection, String(item.id)), payload, { merge: true });
    await removeRequest(String(item.id));
  }
  async function rejectRequest(item) {
    await removeRequest(String(item?.id || ''));
  }
  function renderRequests() {
    if (!els.requestsSection || !els.requestsView || !els.requestsBadge) return;
    if (!linkedUid || !currentRecruitment) {
      els.requestsSection.classList.add('hidden');
      els.requestsBadge.textContent = '0';
      els.requestsView.innerHTML = '<div class="rounded-2xl border border-dashed border-gray-200 bg-gray-50 p-6 text-sm text-gray-500 text-center">Abra um recrutamento para visualizar os pedidos.</div>';
      return;
    }
    els.requestsSection.classList.remove('hidden');
    els.requestsBadge.textContent = String(currentRequests.length || 0);
    if (!currentRequests.length) {
      els.requestsView.innerHTML = '<div class="rounded-2xl border border-dashed border-gray-200 bg-gray-50 p-6 text-sm text-gray-500 text-center">Ainda não chegou nenhum pedido para esse recrutamento.</div>';
      return;
    }
    els.requestsView.innerHTML = currentRequests.map((pedido) => {
      const name = pedido.nick || pedido.nickname || pedido.name || pedido.nome || 'Sem nome';
      const meta = getRequestStatusMeta(pedido.status || 'pendente');
      const contact = getRequestContact(pedido);
      return `<button type="button" data-open-request="${escapeHtml(pedido.id || '')}" class="w-full rounded-2xl border border-gray-200 bg-white p-4 text-left hover:border-emerald-200 hover:bg-emerald-50/30 transition">
        <div class="flex items-start justify-between gap-3">
          <div>
            <h5 class="text-sm font-bold text-gray-900 break-words">${escapeHtml(name)}</h5>
            <p class="mt-1 text-xs text-gray-500">ID: ${escapeHtml(pedido.id || '-')}</p>
            <p class="mt-1 text-xs text-gray-400">${escapeHtml(REQUEST_CONTACT_LABELS[contact.type] || 'Contato')}: ${escapeHtml(formatRequestContactLabel(pedido))}</p>
          </div>
          <span class="inline-flex items-center rounded-full ring-1 px-2.5 py-1 text-[11px] font-extrabold ${meta.className}">${meta.label}</span>
        </div>
      </button>`;
    }).join('');
    document.querySelectorAll('[data-open-request]').forEach((btn) => btn.addEventListener('click', () => {
      const item = currentRequests.find(x => String(x.id) === String(btn.getAttribute('data-open-request') || ''));
      if (item) openRequestModal(item);
    }));
  }
  async function toggleRecruitmentStatus() {
    if (!linkedUid || !currentRecruitment || !canOpenRecruitment()) return;
    const from = currentRecruitmentStatus;
    const to = from === RECRUITMENT_ACTIVE_STATUS ? RECRUITMENT_INACTIVE_STATUS : RECRUITMENT_ACTIVE_STATUS;
    const btn = qs('btn-toggle-rec-status');
    try {
      if (btn) {
        btn.disabled = true;
        btn.classList.add('opacity-70', 'cursor-not-allowed');
        btn.textContent = to === RECRUITMENT_ACTIVE_STATUS ? 'Ativando...' : 'Inativando...';
      }
      await moveRecruitmentStatus(from, to, currentRecruitment, 'manual');
      setStatus(to === RECRUITMENT_ACTIVE_STATUS ? 'Recrutamento ativado.' : 'Recrutamento inativado.', 'success');
      showToast('success', to === RECRUITMENT_ACTIVE_STATUS ? 'Recrutamento ativado!' : 'Recrutamento inativado!');
      renderRecruitment();
      await loadRequests();
    } catch (err) {
      console.error(err);
      showToast('error', 'Nao foi possivel mudar o status.');
      renderRecruitment();
    }
  }
  function renderRecruitment() {
    if (!linkedUid) {
      if (els.view) els.view.innerHTML = '<div class="bg-white rounded-2xl p-10 border border-gray-100 shadow-sm text-center"><p class="text-gray-500 font-medium">Carregando sua guilda...</p></div>';
      updateCreateButtonVisibility(); renderRequests(); initIcons(); return;
    }
    if (!currentRecruitment) {
      if (els.view) els.view.innerHTML = '<div class="bg-white rounded-2xl p-10 border border-gray-100 shadow-sm text-center"><div class="w-14 h-14 rounded-2xl bg-gray-50 text-gray-500 flex items-center justify-center mx-auto mb-3"><i data-lucide="search-x" class="w-7 h-7"></i></div><p class="text-gray-800 font-semibold">Nenhum recrutamento publicado ainda</p><p class="text-gray-500 text-sm mt-1">Toque em <b>Criar recrutamento</b> para publicar o primeiro anuncio da sua guilda.</p></div>';
      updateCreateButtonVisibility(); renderRequests(); initIcons(); return;
      if (els.view) els.view.innerHTML = '<div class="bg-white rounded-2xl p-10 border border-gray-100 shadow-sm text-center"><div class="w-14 h-14 rounded-2xl bg-gray-50 text-gray-500 flex items-center justify-center mx-auto mb-3"><i data-lucide="search-x" class="w-7 h-7"></i></div><p class="text-gray-800 font-semibold">Nenhum recrutamento publicado ainda</p><p class="text-gray-500 text-sm mt-1">Essa chave ainda não tem um anúncio ativo. Toque em <b>Criar recrutamento</b> para publicar o primeiro.</p></div>';
      updateCreateButtonVisibility(); renderRequests(); initIcons(); return;
    }
    const d = currentRecruitment;
    const customSections = renderRecruitmentCustomSections(d);
    const questionCount = normalizeRecruitmentApplicationFields(d).length;
    const questionSummary = questionCount
      ? `<span class="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-1 text-[11px] font-bold text-emerald-700 ring-1 ring-emerald-200"><i data-lucide="list-checks" class="h-3.5 w-3.5"></i>${questionCount} pergunta${questionCount === 1 ? '' : 's'}</span>`
      : '<span class="text-xs text-gray-400">Somente ID, nick e contato</span>';
    const photoSrc = recruitmentPhotoSrc(d);
    const photoNew = photoSrc ? `<img src="${escapeHtml(photoSrc)}" alt="Foto do recrutamento" class="w-full h-64 object-cover rounded-2xl border border-gray-200 bg-gray-50">` : '';
    const inactive = currentRecruitmentStatus === RECRUITMENT_INACTIVE_STATUS;
    const statusClass = inactive ? 'bg-amber-50 text-amber-700 ring-amber-200' : 'bg-emerald-50 text-emerald-700 ring-emerald-200';
    const canEdit = canOpenRecruitment();
    const actions = canEdit
      ? `<div class="flex items-center gap-2 flex-wrap"><button id="btn-toggle-rec-status" class="px-3 py-2 rounded-xl text-sm font-medium text-amber-700 bg-amber-50 hover:bg-amber-100">${inactive ? 'Ativar' : 'Inativar'}</button><button id="btn-edit-rec" class="px-3 py-2 rounded-xl text-sm font-medium text-gray-600 hover:bg-gray-100">Editar</button><button id="btn-delete-rec" class="px-3 py-2 rounded-xl text-sm font-medium text-red-500 hover:bg-red-50">Excluir</button></div>`
      : '<span class="rounded-xl bg-gray-50 px-3 py-2 text-xs font-bold text-gray-500 ring-1 ring-gray-200">Edicao bloqueada pelo plano</span>';
    if (els.view) els.view.innerHTML = `<div class="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden"><div class="p-5 border-b border-gray-100 flex items-start justify-between gap-4"><div><div class="flex items-center gap-2 flex-wrap"><h4 class="text-xl font-bold text-gray-900">${escapeHtml(d.guildName || 'Sem nome')}</h4><span class="inline-flex items-center rounded-full ${statusClass} ring-1 px-2.5 py-1 text-[11px] font-extrabold">${recruitmentStatusLabel()}</span></div><p class="text-sm text-gray-500 mt-1">UID do recrutamento: <span class="font-semibold break-all">${escapeHtml(linkedUid || d.guildId || d.id || '-')}</span></p><p class="text-sm text-gray-500 mt-1">Publicado em: ${escapeHtml(formatDateBR(d.dateMs || d.createdAt || Date.now()))}</p></div>${actions}</div><div class="p-5 space-y-5">${photoNew}${customSections}<div><p class="text-xs font-semibold text-gray-500 mb-2">Ficha de pedido</p>${questionSummary}</div><div><p class="text-xs font-semibold text-gray-500 mb-2">Descrição</p><div class="rounded-xl bg-gray-50 border border-gray-200 p-4 text-sm text-gray-700 min-h-[84px] whitespace-pre-wrap">${escapeHtml(d.description || 'Sem descrição.')}</div></div></div></div>`;
    updateCreateButtonVisibility(); renderRequests();
    qs('btn-edit-rec')?.addEventListener('click', () => openModal('edit'));
    qs('btn-delete-rec')?.addEventListener('click', deleteRecruitment);
    qs('btn-toggle-rec-status')?.addEventListener('click', toggleRecruitmentStatus);
    initIcons();
  }
  async function loadRequests(forceRefresh = false) {
    currentRequests = [];
    if (!linkedUid || !currentRecruitment) { renderRequests(); return; }
    if (!forceRefresh) {
      const cachedRequests = readRecruitmentRequestsCache(linkedUid, currentRecruitmentStatus);
      if (cachedRequests) {
        currentRequests = cachedRequests;
        renderRequests();
        return;
      }
    }
    try {
      const snap = await getDocs(getRecruitmentRequests(currentRecruitmentStatus, linkedUid));
      currentRequests = snap.docs.map(d => ({ id:d.id, ...d.data() }));
      currentRequests.sort((a,b) => (normalizeTimestamp(b.createdAt || b.dateMs || b.date)?.getTime?.() || 0) - (normalizeTimestamp(a.createdAt || a.dateMs || a.date)?.getTime?.() || 0));
      writeRecruitmentRequestsCache(linkedUid, currentRecruitmentStatus);
    } catch (err) { console.error(err); }
    renderRequests();
  }
  async function resolveKeyAndLoad(forceMessage=true, providedKey=null, forceRequests=false) {
    const guildId = ctxGuildId();
    if (!guildId) { showToast('error', 'Guilda nao encontrada na sessao.'); return false; }
    linkedUid = guildId;
    openedKey = guildId;
    if (els.openedKey) els.openedKey.textContent = guildId;
    if (els.currentUid) els.currentUid.textContent = guildId;
    const allowed = canOpenRecruitment();
    const cachedRecruitment = readRecruitmentDataCache(guildId);
    const hasCachedRecruitment = !!cachedRecruitment;
    if (cachedRecruitment) {
      currentRecruitmentStatus = allowed
        ? normalizeRecruitmentStatus(cachedRecruitment.status)
        : RECRUITMENT_INACTIVE_STATUS;
      currentRecruitment = cachedRecruitment.recruitment || null;
      if (currentRecruitment) {
        currentRecruitment = {
          ...currentRecruitment,
          id: currentRecruitment.id || guildId,
          status: currentRecruitmentStatus,
          active: currentRecruitmentStatus === RECRUITMENT_ACTIVE_STATUS
        };
      }
      renderRecruitment();
      setStatus('Recrutamento carregado do cache. Verificando atualizações...', 'loading');
    }
    try {
      if (els.loadBtn) els.loadBtn.disabled = true;
      if (els.reloadBtn) els.reloadBtn.disabled = true;
      const activeSnap = await getDoc(recruitmentDocRef(RECRUITMENT_ACTIVE_STATUS, guildId));
      if (!allowed && activeSnap.exists()) {
        await moveRecruitmentStatus(RECRUITMENT_ACTIVE_STATUS, RECRUITMENT_INACTIVE_STATUS, activeSnap.data() || {}, 'plan_inactive');
        showToast('warn', 'Seu recrutamento foi movido para inativo porque o plano atual nao libera essa area.');
      }
      const removedExpired = await cleanupInactiveRecruitmentIfNeeded();
      if (removedExpired) {
        currentRecruitment = null;
        currentRecruitmentStatus = RECRUITMENT_INACTIVE_STATUS;
        setStatus('Recrutamento inativo removido apos 7 dias sem plano ativo.', 'warn');
        renderRecruitment();
        return true;
      }
      const freshActiveSnap = allowed ? await getDoc(recruitmentDocRef(RECRUITMENT_ACTIVE_STATUS, guildId)) : null;
      const inactiveSnap = await getDoc(recruitmentDocRef(RECRUITMENT_INACTIVE_STATUS, guildId));
      if (freshActiveSnap?.exists()) {
        currentRecruitmentStatus = RECRUITMENT_ACTIVE_STATUS;
        currentRecruitment = { id: freshActiveSnap.id, ...freshActiveSnap.data() };
      } else if (inactiveSnap.exists()) {
        currentRecruitmentStatus = RECRUITMENT_INACTIVE_STATUS;
        currentRecruitment = { id: inactiveSnap.id, ...inactiveSnap.data() };
      } else {
        currentRecruitmentStatus = RECRUITMENT_ACTIVE_STATUS;
        currentRecruitment = null;
      }
      writeRecruitmentDataCache(guildId);
      if (!allowed) {
        setStatus('Seu plano atual não libera a edição. Se houver recrutamento ativo, ele será mantido como inativo e poderá ser apagado após 7 dias sem um plano compatível.', 'warn');
      } else {
        setStatus(currentRecruitment ? 'Recrutamento carregado.' : 'Tudo pronto. Agora você já pode criar o recrutamento dessa guilda.', 'success');
      }
      renderRecruitment();
      await loadRequests(forceRequests);
      return true;
    } catch (err) {
      console.error(err);
      if (hasCachedRecruitment) {
        setStatus('Exibindo as informações salvas. Não foi possível verificar atualizações agora.', 'warn');
        return true;
      }
      setStatus('Não foi possível carregar o recrutamento agora.', 'error');
      showToast('error', 'Erro ao carregar recrutamento.');
      return false;
    } finally {
      if (els.loadBtn) els.loadBtn.disabled = !canOpenRecruitment() || els.loadBtn.classList.contains('hidden');
      if (els.reloadBtn) els.reloadBtn.disabled = false;
    }

    if (!canOpenRecruitment()) {
      setStatus('O recrutamento está disponível apenas para os planos Pro, Business, Ultra ou Parceiro.','warn');
      showToast('error', 'Libere o plano Pro, Business, Ultra ou Parceiro para usar o recrutamento.');
      return false;
    }
    const key = normalizeGuildAccessKey(providedKey != null ? providedKey : els.keyInput?.value);
    if (!isValidGuildAccessKey(key)) {
      setStatus(invalidGuildKeyMessage, 'error');
      showToast('error', invalidGuildKeyMessage);
      return false;
    }
    if (els.keyInput) els.keyInput.value = key;
    const legacyGuildId = ctxGuildId();
    if (!guildId) { showToast('error', 'Guilda não encontrada na sessão.'); return false; }
    try {
      if (els.loadBtn) els.loadBtn.disabled = true;
      if (els.reloadBtn) els.reloadBtn.disabled = true;
      const keyRef = getRecruitmentDoc(RECRUITMENT_ACTIVE_STATUS, guildId);
      let keySnap = await getDoc(keyRef);
      if (!keySnap.exists()) {
        await setDoc(keyRef, { uid: guildId, ownerAccountUid: auth.currentUser?.uid || null, guildName: ctxGuildName() || null, createdAt: serverTimestamp() }, { merge:true });
        keySnap = await getDoc(keyRef);
        if (forceMessage) setStatus('Essa chave foi vinculada à sua guilda e já está pronta para uso.','success');
      }
      const keyData = keySnap.data() || {};
      linkedUid = String(keyData.uid || '').trim();
      const currentGuildId = guildId;
      if (currentGuildId && linkedUid !== currentGuildId) {
        linkedUid = currentGuildId;
        await setDoc(keyRef, { uid: currentGuildId, guildName: ctxGuildName() || null, updatedAt: serverTimestamp() }, { merge:true });
      }
      openedKey = key;
      if (els.openedKey) els.openedKey.textContent = key;
      if (!linkedUid) {
        currentRecruitment = null;
        setStatus('Encontramos a chave, mas ela está sem uma guilda vinculada.','error');
        renderRecruitment();
        return false;
      }
      const recSnap = await getDoc(getRecruitmentDoc(RECRUITMENT_ACTIVE_STATUS, linkedUid));
      currentRecruitment = recSnap.exists() ? ({ id: recSnap.id, ...recSnap.data() }) : null;
      if (forceMessage) setStatus(currentRecruitment ? 'Pronto! Seu recrutamento foi encontrado e carregado.' : 'Tudo certo com a chave. Agora você já pode criar o recrutamento dessa guilda.','success');
      renderRecruitment();
      await loadRequests();
      return true;
    } catch (err) {
      console.error(err);
      setStatus('Não foi possível abrir essa chave agora.','error');
      showToast('error', 'Erro ao carregar recrutamento.');
      return false;
    } finally {
      if (els.loadBtn) els.loadBtn.disabled = !canOpenRecruitment() || els.loadBtn.classList.contains('hidden');
      if (els.reloadBtn) els.reloadBtn.disabled = !canOpenRecruitment();
    }
  }
  async function tryBootWithSavedKey() {
    setKeyCheckingState('Carregando recrutamento da sua guilda...');
    return resolveKeyAndLoad(false);

    if (!canOpenRecruitment()) return false;

    setKeyCheckingState();

    let savedKey = '';
    try {
      savedKey = normalizeGuildAccessKey(await getRecruitmentGuildAccessKeyConfig() || '');
    } catch (_) {
      savedKey = '';
    }

    if (!savedKey) {
      setManualKeyMode(false);
      if (els.openedKey) els.openedKey.textContent = 'Nenhuma';
      setStatus('Nenhuma chave de guilda encontrada automaticamente. Digite sua chave para abrir o recrutamento.','warn');
      return false;
    }

    if (!isValidGuildAccessKey(savedKey)) {
      setManualKeyMode(true);
      if (els.keyInput) els.keyInput.value = savedKey;
      if (els.openedKey) els.openedKey.textContent = 'Nenhuma';
      setStatus('A chave salva não está no formato válido. Ela deve começar com ghub- e ter 9 números depois.','warn');
      return false;
    }

    setManualKeyMode(false);
    const loaded = await resolveKeyAndLoad(false, savedKey);
    if (loaded) {
      setManualKeyMode(false);
      setStatus(currentRecruitment ? 'Chave encontrada e recrutamento carregado automaticamente.' : 'Chave válida encontrada. Agora você já pode criar seu recrutamento.','success');
      if (currentRecruitment) showToast('success', 'Recrutamento carregado automaticamente!');
      return true;
    }

    setManualKeyMode(true);
    return false;
  }

  async function saveRecruitment(event) {
    event.preventDefault();
    if (isSavingRecruitment) return;
    if (!canOpenRecruitment()) { showToast('error','Apenas Pro, Business, Ultra ou Parceiro podem salvar recrutamento.'); return; }
    if (!linkedUid) linkedUid = ctxGuildId();
    if (!linkedUid) { showToast('error','Guilda nao encontrada para salvar.'); return; }
    const guildName = String(els.guildName?.value || '').trim();
    const customSections = collectRecruitmentSectionsFromEditor();
    const applicationFields = collectRecruitmentQuestionsFromEditor();
    const findSectionItems = (pattern) => customSections.find((section) => pattern.test(normalizarTextoFiltro(section.title)))?.items || [];
    const roles = findSectionItems(/func|modo|posic/).slice(0, 8);
    const contacts = findSectionItems(/contato/).slice(0, 8);
    const guildType = findSectionItems(/tipo/).slice(0, 8);
    const focus = findSectionItems(/foco|meta/).slice(0, 8);
    const description = String(els.desc?.value || '').trim().slice(0,100);
    if (!guildName) { showToast('error','O nome da guilda é obrigatório.'); return; }
    if (!validarTextoSemLink(guildName, 'Nome da guilda')) return;
    if (!validarTextoPermitido(guildName, 'Nome da guilda')) return;
    if (description && !validarTextoSemLink(description, 'Descricao')) return;
    if (description && !validarTextoPermitido(description, 'Descrição')) return;
    if (!validateRecruitmentBuilderContent(customSections, applicationFields)) return;
    if (!currentPhotoBase64 && !recruitmentPhotoSrc(currentRecruitment)) { showToast('error','Envie uma foto para o recrutamento.'); return; }
    const submitBtn = els.form?.querySelector('button[type="submit"]');
    isSavingRecruitment = true;
    setButtonBusy(submitBtn, true, 'Salvando...');
    try {
      const photoData = await uploadRecruitmentPhotoIfNeeded();
      const now = Date.now();
      const status = normalizeRecruitmentStatus(currentRecruitmentStatus);
      const payload = {
        guildName, dateMs: currentRecruitment?.dateMs || now, roles, contacts, guildType, focus, description,
        customSections, applicationFields, formVersion: 2,
        platform: '', minimumAge: '', nickChangeRequired: '', nickChangeDeadline: '', teamPlay: '', useCall: '',
        key: linkedUid, ownerUid: ctxGuildId() || linkedUid, guildId: linkedUid,
        status, active: status === RECRUITMENT_ACTIVE_STATUS,
        photoUrl: photoData.photoUrl || '',
        photoKey: photoData.photoKey || '',
        photoBytes: photoData.photoBytes || 0,
        photoBase64: deleteField(),
        updatedAt: serverTimestamp(),
        updatedAtMs: now
      };
      if (!currentRecruitment) payload.createdAt = serverTimestamp();
      if (!currentRecruitment?.dateMs) payload.createdAtMs = now;
      await setDoc(getRecruitmentDoc(status, linkedUid), payload, { merge:true });
      currentRecruitment = { ...currentRecruitment, ...payload, id: linkedUid };
      writeRecruitmentDataCache(linkedUid);
      currentPhotoBase64 = '';
      currentPhotoBytes = 0;
      closeModal(); renderRecruitment(); await loadRequests(); setStatus('Seu recrutamento foi salvo com sucesso.','success'); showToast('success','Recrutamento salvo!');
      return;
    } catch (err) {
      console.error(err);
      showToast('error', err?.message || 'Nao foi possivel salvar o recrutamento.');
      return;
    } finally {
      isSavingRecruitment = false;
      setButtonBusy(submitBtn, false);
    }
    try {
      const payload = {
        guildName, dateMs: currentRecruitment?.dateMs || Date.now(), roles, contacts, guildType, focus, description,
        customSections, applicationFields, formVersion: 2,
        platform: '', minimumAge: '', nickChangeRequired: '', nickChangeDeadline: '', teamPlay: '', useCall: '',
        key: openedKey, ownerUid: ctxGuildId() || linkedUid, photoBase64: currentPhotoBase64 || currentRecruitment?.photoBase64 || '',
        photoBytes: currentPhotoBytes || currentRecruitment?.photoBytes || dataUrlSizeBytes(currentPhotoBase64 || currentRecruitment?.photoBase64 || ''),
        updatedAt: serverTimestamp(), guildId: linkedUid
      };
      if (!currentRecruitment) payload.createdAt = serverTimestamp();
      await setDoc(getRecruitmentDoc(currentRecruitmentStatus, linkedUid), payload, { merge:true });
      currentRecruitment = { ...currentRecruitment, ...payload, id: linkedUid };
      closeModal(); renderRecruitment(); await loadRequests(); setStatus('Seu recrutamento foi salvo com sucesso.','success'); showToast('success','Recrutamento salvo!');
    } catch (err) { console.error(err); showToast('error','Não foi possível salvar o recrutamento.'); }
  }
  function deleteRecruitment() {
    if (!linkedUid || !currentRecruitment) return;
    openDeleteRecModal();
  }
  async function confirmDeleteRecruitment() {
    if (!linkedUid || !currentRecruitment) {
      closeDeleteRecModal();
      return;
    }
    if (els.confirmDeleteRecBtn) {
      els.confirmDeleteRecBtn.disabled = true;
      els.confirmDeleteRecBtn.classList.add('opacity-70', 'cursor-not-allowed');
    }
    try {
      await deleteRecruitmentTree(currentRecruitmentStatus, linkedUid, { deletePhoto: true });
      currentRecruitment = null; currentRequests = [];
      closeDeleteRecModal();
      renderRecruitment(); setStatus('Seu recrutamento foi excluido com sucesso.','success'); showToast('success','Recrutamento excluido!');
      return;
      await deleteDoc(getRecruitmentDoc(currentRecruitmentStatus, linkedUid));
      currentRecruitment = null; currentRequests = [];
      closeDeleteRecModal();
      renderRecruitment(); setStatus('Seu recrutamento foi excluído com sucesso.','success'); showToast('success','Recrutamento excluído!');
    } catch (err) {
      console.error(err);
      showToast('error','Não foi possível excluir o recrutamento.');
    } finally {
      if (els.confirmDeleteRecBtn) {
        els.confirmDeleteRecBtn.disabled = false;
        els.confirmDeleteRecBtn.classList.remove('opacity-70', 'cursor-not-allowed');
      }
    }
  }
  function bindEvents() {
    document.querySelectorAll('[data-close-rec]').forEach(el => el.addEventListener('click', closeModal));
    document.querySelectorAll('[data-close-request-detail]').forEach(el => el.addEventListener('click', closeRequestModal));
    els.requestModalWhatsapp?.addEventListener('click', async (event) => {
      const link = event.target.closest('[data-copy-discord]');
      if (!link) return;
      const username = String(link.getAttribute('data-copy-discord') || '');
      try {
        await navigator.clipboard.writeText(username);
        showToast('success', 'Usuário do Discord copiado. Cole na busca do Discord.');
      } catch (_) {
        showToast('info', `Usuário do Discord: ${username}`);
      }
    });
    document.querySelectorAll('[data-close-delete-rec]').forEach(el => el.addEventListener('click', closeDeleteRecModal));
    els.cancelDeleteRecBtn?.addEventListener('click', closeDeleteRecModal);
    els.confirmDeleteRecBtn?.addEventListener('click', confirmDeleteRecruitment);
    if (!document.body.dataset.recManagementCustomSelectCloseBound) {
      document.body.dataset.recManagementCustomSelectCloseBound = '1';
      document.addEventListener('click', (event) => {
        if (event.target.closest('.rq-dd')) return;
        closeManagementCustomSelects();
      });
    }
    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      closeModal();
      closeRequestModal();
      closeDeleteRecModal();
    });
    els.newBtn?.addEventListener('click', () => openModal('create'));
    els.copyBtn?.addEventListener('click', copyRecruitmentLink);
    els.loadBtn?.addEventListener('click', () => resolveKeyAndLoad(true));
    els.addSectionBtn?.addEventListener('click', () => {
      recruitmentCustomSections = collectRecruitmentSectionsFromEditor();
      if (recruitmentCustomSections.length >= MAX_RECRUITMENT_SECTIONS) {
        showToast('error', `Você pode criar até ${MAX_RECRUITMENT_SECTIONS} blocos.`);
        return;
      }
      recruitmentCustomSections.push({ id: createRecruitmentBuilderId('section'), title: '', items: [] });
      renderRecruitmentSectionEditor();
    });
    els.addQuestionBtn?.addEventListener('click', () => {
      recruitmentApplicationFields = collectRecruitmentQuestionsFromEditor();
      if (recruitmentApplicationFields.length >= MAX_RECRUITMENT_FIELDS) {
        showToast('error', `Você pode criar até ${MAX_RECRUITMENT_FIELDS} perguntas.`);
        return;
      }
      recruitmentApplicationFields.push({ id: createRecruitmentBuilderId('question'), label: '', type: 'text', required: false, options: [] });
      renderRecruitmentQuestionEditor();
    });
    els.customSections?.addEventListener('click', (event) => {
      const button = event.target.closest('[data-rec-section-action]');
      const row = event.target.closest('[data-rec-section]');
      if (!button || !row) return;
      recruitmentCustomSections = collectRecruitmentSectionsFromEditor();
      const index = recruitmentCustomSections.findIndex((item) => item.id === row.dataset.recSection);
      if (index < 0) return;
      const action = button.dataset.recSectionAction;
      if (action === 'remove') recruitmentCustomSections.splice(index, 1);
      if (action === 'up' && index > 0) [recruitmentCustomSections[index - 1], recruitmentCustomSections[index]] = [recruitmentCustomSections[index], recruitmentCustomSections[index - 1]];
      if (action === 'down' && index < recruitmentCustomSections.length - 1) [recruitmentCustomSections[index + 1], recruitmentCustomSections[index]] = [recruitmentCustomSections[index], recruitmentCustomSections[index + 1]];
      renderRecruitmentSectionEditor();
    });
    els.applicationFields?.addEventListener('click', (event) => {
      const button = event.target.closest('[data-rec-question-action]');
      const row = event.target.closest('[data-rec-question]');
      if (!button || !row) return;
      recruitmentApplicationFields = collectRecruitmentQuestionsFromEditor();
      const index = recruitmentApplicationFields.findIndex((item) => item.id === row.dataset.recQuestion);
      if (index < 0) return;
      const action = button.dataset.recQuestionAction;
      if (action === 'remove') recruitmentApplicationFields.splice(index, 1);
      if (action === 'up' && index > 0) [recruitmentApplicationFields[index - 1], recruitmentApplicationFields[index]] = [recruitmentApplicationFields[index], recruitmentApplicationFields[index - 1]];
      if (action === 'down' && index < recruitmentApplicationFields.length - 1) [recruitmentApplicationFields[index + 1], recruitmentApplicationFields[index]] = [recruitmentApplicationFields[index], recruitmentApplicationFields[index + 1]];
      renderRecruitmentQuestionEditor();
    });
    els.applicationFields?.addEventListener('change', (event) => {
      if (!event.target.matches('[data-rec-question-type]')) return;
      recruitmentApplicationFields = collectRecruitmentQuestionsFromEditor();
      renderRecruitmentQuestionEditor();
    });
    els.reloadBtn?.addEventListener('click', async () => {
      if (isReloadingRecruitment) return;
      isReloadingRecruitment = true;
      setButtonBusy(els.reloadBtn, true, 'Atualizando...');
      setStatus('Recarregando recrutamento...', 'loading');
      try {
        await resolveKeyAndLoad(false, null, true);
        setStatus(currentRecruitment ? 'Recrutamento atualizado.' : 'Tudo pronto. Agora voce ja pode criar seu recrutamento.','success');
      } finally {
        isReloadingRecruitment = false;
        setButtonBusy(els.reloadBtn, false);
      }
      return;
      const keyToReload = normalizeGuildAccessKey(openedKey || els.keyInput?.value || await getRecruitmentGuildAccessKeyConfig() || '');
      if (!isValidGuildAccessKey(keyToReload)) {
        setStatus(invalidGuildKeyMessage, 'error');
        showToast('error', invalidGuildKeyMessage);
        return;
      }
      await resolveKeyAndLoad(false, keyToReload);
      setStatus(currentRecruitment ? 'Recrutamento atualizado.' : 'Chave atualizada. Agora você já pode criar seu recrutamento.','success');
    });
    els.form?.addEventListener('submit', saveRecruitment);
    qs('btn-logout')?.addEventListener('click', logout);
    els.desc?.addEventListener('input', () => {
      els.desc.value = els.desc.value.slice(0,100);
      if (els.descCount) els.descCount.textContent = `${els.desc.value.length}/100`;
    });
    els.keyInput?.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); resolveKeyAndLoad(true); } });
    els.photoInput?.addEventListener('change', async (e) => {
      await handleRecruitmentPhotoFile(e.target.files?.[0]);
    });
    els.requestAcceptBtn?.addEventListener('click', async () => {
      if (!activeRequest) return;
      try { await acceptRequest(activeRequest); closeRequestModal(); await loadRequests(); showToast('success','Pedido aceito e membro adicionado!'); }
      catch (err) { console.error(err); showToast('error', err?.message || 'Não foi possível aceitar o pedido.'); }
    });
    els.requestRejectBtn?.addEventListener('click', async () => {
      if (!activeRequest) return;
      try { await rejectRequest(activeRequest); closeRequestModal(); await loadRequests(); showToast('success','Pedido recusado!'); }
      catch (err) { console.error(err); showToast('error', err?.message || 'Não foi possível recusar o pedido.'); }
    });
  }
  (async function boot(){
    bindEvents();
    const authResult = await resolveRecruitmentAccessContext();
    if (!authResult?.user) return;
    if (authResult.unresolvedGuild) {
      setManualKeyMode(false);
      setStatus('Não foi possível carregar o vínculo da guilda agora. Atualize a página em alguns instantes; sua conta continua conectada.', 'warn');
      resetPhotoState();
      renderRecruitment();
      updateCopyLinkVisibility();
      initManagementCustomSelects();
      initIcons();
      return;
    }
    recruitmentGuildCtx = authResult.ctx || recruitmentGuildCtx;
    const user = authResult.user;
    const roleAllowed = syncRecruitmentRoleUi();
    if (!roleAllowed) {
      showToast('error', 'Apenas Líder ou Admin podem acessar o recrutamento.');
      window.location.href = '/dashboard';
      return;
    }
    const ctx = activeGuildContext() || {};
    if (els.currentUid) els.currentUid.textContent = String(ctx.guildId || '-');
    await refreshManagementGuildSlots();
    renderManagementGuildCard();
    mountRecruitmentJsonBackupPanel();
    if (els.openedKey) els.openedKey.textContent = 'Nenhuma';
    await refreshRecruitmentAllowedPlans();
    const vipAllowed = applyRecruitmentVipGate();
    if (!vipAllowed) {
      setManualKeyMode(true);
      setStatus('Seu plano atual não libera o recrutamento. Para abrir essa área, use Pro, Business, Ultra ou Parceiro.','warn');
      await tryBootWithSavedKey();
      populateRequestTargetSlotOptions('1');
      resetPhotoState(); renderRecruitment(); updateCopyLinkVisibility(); initManagementCustomSelects(); initIcons();
      return;
    }
    await tryBootWithSavedKey();
    populateRequestTargetSlotOptions('1');
    resetPhotoState(); renderRecruitment(); updateCopyLinkVisibility(); initManagementCustomSelects(); initIcons();
  })();
}

bootManagementMode();


