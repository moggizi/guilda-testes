import { initializeApp, deleteApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  getFirestore,
  doc,
  getDoc,
  setDoc,
  deleteDoc,
  serverTimestamp,
  collection,
  getDocs
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { setupSidebar, initIcons, logout, getGuildContext, getGuildAccessKeyConfig, getGuildMultiConfig, showToast, auth, db } from '../logic.js';

const firebaseConfig = {
  apiKey: "AIzaSyA6CETOXLO6yp4Gm1JY7fwiWlWo0pKqzqw",
  authDomain: "hub-recruta.firebaseapp.com",
  projectId: "hub-recruta",
  storageBucket: "hub-recruta.firebasestorage.app",
  messagingSenderId: "35668832994",
  appId: "1:35668832994:web:2cbdaa54596e5a54cf24bb",
  measurementId: "G-N182HK85CQ"
};

const secondaryApp = initializeApp(firebaseConfig, `hub_recruta_${Date.now()}_${Math.random().toString(36).slice(2,8)}`);
const recDb = getFirestore(secondaryApp);
setupSidebar();
initIcons();

const qs = (id) => document.getElementById(id);

const RECRUITMENT_GUILDCTX_LS_KEY = 'guildCtx_cache_v1';
const RECRUITMENT_AUTH_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const RECRUITMENT_GUILDCTX_CACHE_VERSION = 4;
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
  if (raw.includes('vital') || raw.includes('life')) return 'vitalicio';
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
    const raw = localStorage.getItem(RECRUITMENT_GUILDCTX_LS_KEY);
    if (!raw) return null;
    const ctx = JSON.parse(raw);
    if (!ctx || !ctx.guildId) return null;
    // Cache antigo podia vir com vipTier free por causa do fallback de plano.
    if (ctx.cacheVersion !== RECRUITMENT_GUILDCTX_CACHE_VERSION && (!ctx.vipTier || String(ctx.vipTier).toLowerCase().trim() === 'free')) return null;
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
    localStorage.setItem(RECRUITMENT_GUILDCTX_LS_KEY, JSON.stringify({
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
    }));
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
    window.location.href = '/';
    return null;
  }

  const emailLower = cleanRecruitmentEmail(user.email);

  const cachedCtx = readRecruitmentCachedCtx();
  if (isRecruitmentCachedCtxFresh(cachedCtx) && recruitmentCachedCtxMatchesUser(cachedCtx, user) && isRecruitmentManagerRole(cachedCtx.role)) {
    const emailEl = document.getElementById('user-email');
    if (emailEl) emailEl.textContent = user.email || emailLower;
    const roleEl = document.getElementById('user-role');
    if (roleEl) roleEl.textContent = canonicalRecruitmentRole(cachedCtx.role || 'Membro');
    return { user, ctx: { ...cachedCtx, email: emailLower, uid: user.uid } };
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

  // Não consulta/varre configGuilda para descobrir guilda por e-mail.
  // Para economizar leituras, o vínculo deve vir de users/{uid}.

  if (!guildId) {
    showToast('error', 'Essa conta não está vinculada a uma guilda.');
    window.location.href = '/';
    return null;
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
    platform: qs('rec-platform'), age: qs('rec-age'), nickRequired: qs('rec-nick-required'), nickDeadline: qs('rec-nick-deadline'), teamPlay: qs('rec-teamplay'), useCall: qs('rec-call'),
    desc: qs('rec-description'), descCount: qs('rec-desc-count'), photoInput: qs('rec-photo'),
    photoPreviewWrap: qs('rec-photo-preview-wrap'), photoPreview: qs('rec-photo-preview'), photoStatus: qs('rec-photo-status'),
    photoFileName: qs('rec-photo-file-name'),
    requestsSection: qs('requests-section'), requestsView: qs('requests-view'), requestsBadge: qs('requests-badge'),
    requestModal: qs('request-detail-modal'), requestModalName: qs('request-detail-name'), requestModalId: qs('request-detail-id'),
    requestModalStatus: qs('request-detail-status'), requestModalDate: qs('request-detail-date'), requestModalModes: qs('request-detail-modes'),
    requestModalWhatsapp: qs('request-detail-whatsapp'), requestTargetSlot: qs('request-target-slot'), requestAcceptBtn: qs('btn-request-accept'), requestRejectBtn: qs('btn-request-reject'),
    deleteRecModal: qs('delete-rec-modal'), cancelDeleteRecBtn: qs('btn-cancel-delete-rec'), confirmDeleteRecBtn: qs('btn-confirm-delete-rec')
  };
  let linkedUid = null, openedKey = '', currentRecruitment = null, currentPhotoBase64 = '', currentPhotoBytes = 0, currentRequests = [], activeRequest = null;
  let managementGuildSlotsCache = [];
  let recruitmentGuildCtx = readRecruitmentCachedCtx() || getGuildContext() || null;

  const activeGuildContext = () => recruitmentGuildCtx || getGuildContext() || readRecruitmentCachedCtx() || {};

  const ctxGuildId = () => String(activeGuildContext()?.guildId || '').trim();
  const ctxGuildName = () => String(activeGuildContext()?.guildName || '').trim();
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
    const ctx = activeGuildContext();
    const cachedValue = String(ctx?.configGuilda?.guildAccessKey || ctx?.guildAccessKey || '').trim();
    if (cachedValue) return cachedValue;
    const guildId = ctxGuildId();
    if (guildId) {
      try {
        const snap = await getDoc(doc(db, 'configGuilda', guildId));
        const data = snap.exists() ? (snap.data() || {}) : {};
        const value = String(data.guildAccessKey || '').trim();
        if (value) return value;
      } catch (_) {}
    }
    try { return await getGuildAccessKeyConfig(); } catch (_) { return null; }
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
    if (raw.includes('vital') || raw.includes('life')) return 'vitalicio';
    if (raw.includes('business') || raw.includes('buss')) return 'business';
    if (raw.includes('pro')) return 'pro';
    if (raw.includes('plus')) return 'plus';
    return 'free';
  };
  const canOpenRecruitment = () => {
    const tier = getNormalizedVipTier();
    return tier === 'pro' || tier === 'business' || tier === 'vitalicio';
  };
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
    const disabledText = 'O recrutamento está disponível apenas para os planos Pro, Business ou Vitalício.';
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
    return allowed;
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
  function setKeyCheckingState(message = 'Verificando chave de guilda...') {
    setManualKeyMode(false);
    setStatus(message, 'loading');
    if (els.openedKey) els.openedKey.textContent = 'Verificando...';
  }
  function setPhotoFileName(text = 'Nenhuma imagem escolhida') {
    if (els.photoFileName) els.photoFileName.textContent = text;
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
      if (!currentRecruitment?.photoBase64) resetPhotoState();
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
      setStatus('O recrutamento está disponível apenas para os planos Pro, Business ou Vitalício.','warn');
      showToast('error', 'Libere o plano Pro, Business ou Vitalício para criar recrutamento.');
      return;
    }
    els.form.reset();
    if (els.descCount) els.descCount.textContent = '0/100';
    if (els.modalTitle) els.modalTitle.textContent = mode === 'edit' ? 'Editar recrutamento' : 'Novo recrutamento';
    if (els.guildName) els.guildName.value = currentRecruitment?.guildName || ctxGuildName() || '';
    resetPhotoState();
    if (mode === 'edit' && currentRecruitment) {
      setCheckedValues('roles', currentRecruitment.roles || []);
      setCheckedValues('contacts', currentRecruitment.contacts || []);
      setCheckedValues('guildType', currentRecruitment.guildType || []);
      setCheckedValues('focus', currentRecruitment.focus || []);
      if (els.platform) els.platform.value = currentRecruitment.platform || '';
      if (els.age) els.age.value = currentRecruitment.minimumAge || '';
      if (els.nickRequired) els.nickRequired.value = currentRecruitment.nickChangeRequired || '';
      if (els.nickDeadline) els.nickDeadline.value = currentRecruitment.nickChangeDeadline || '';
      if (els.teamPlay) els.teamPlay.value = currentRecruitment.teamPlay || '';
      if (els.useCall) els.useCall.value = currentRecruitment.useCall || '';
      if (els.desc) {
        els.desc.value = currentRecruitment.description || '';
        if (els.descCount) els.descCount.textContent = `${els.desc.value.length}/100`;
      }
      if (currentRecruitment.photoBase64) setPhotoPreview(currentRecruitment.photoBase64, currentRecruitment.photoBytes || dataUrlSizeBytes(currentRecruitment.photoBase64), 'Foto atual do recrutamento');
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
      els.requestModalModes.innerHTML = chips.length ? chips.join(' ') : '<span class="text-xs text-gray-400">Modo não informado</span>';
    }
    if (els.requestModalWhatsapp) {
      const href = formatWhatsappHref(item.whatsapp || item.phone || '', item.whatsappCountryCode || item.phoneCountryCode || '');
      const label = formatWhatsappLabel(item.whatsapp || item.phone || '', item.whatsappCountryCode || item.phoneCountryCode || '');
      els.requestModalWhatsapp.innerHTML = href ? `<a href="${href}" target="_blank" rel="noopener noreferrer" class="text-emerald-600 font-semibold hover:underline break-all">${escapeHtml(label)}</a>` : '<span class="text-gray-400">Não informado</span>';
    }
    populateRequestTargetSlotOptions('1');
    els.requestModal.classList.remove('hidden');
    initManagementCustomSelects();
    initIcons();
  }
  async function removeRequest(requestId) {
    if (!linkedUid || !requestId) return;
    await deleteDoc(doc(recDb, 'rec', linkedUid, 'pedidos', requestId));
  }
  async function acceptRequest(item) {
    const guildId = ctxGuildId() || String(linkedUid || '').trim();
    if (!guildId || !item?.id) throw new Error('Guilda ou pedido inválido.');
    const targetSlot = String(els.requestTargetSlot?.value || '1').trim() || '1';
    const targetCollection = getManagementMembersCollection(targetSlot);
    const requestPlayMode = Array.isArray(item.roles)
      ? item.roles.map(v => String(v || '').trim()).filter(Boolean)
      : [];
    const requestNick = String(item.nick || item.nickname || item.name || item.nome || '').trim() || 'Sem nick';
    if (encontrarPalavraImpropria(requestNick)) {
      throw new Error('O nick do pedido contém palavra imprópria. Recuse ou peça para o jogador enviar novamente.');
    }
    const payload = {
      visibleId: String(item.id || '').trim(),
      nick: requestNick,
      whatsapp: String(item.whatsapp || item.phone || '').trim(),
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
      return `<button type="button" data-open-request="${escapeHtml(pedido.id || '')}" class="w-full rounded-2xl border border-gray-200 bg-white p-4 text-left hover:border-emerald-200 hover:bg-emerald-50/30 transition">
        <div class="flex items-start justify-between gap-3">
          <div>
            <h5 class="text-sm font-bold text-gray-900 break-words">${escapeHtml(name)}</h5>
            <p class="mt-1 text-xs text-gray-500">ID: ${escapeHtml(pedido.id || '-')}</p>
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
  function renderRecruitment() {
    if (!linkedUid) {
      if (els.view) els.view.innerHTML = '<div class="bg-white rounded-2xl p-10 border border-gray-100 shadow-sm text-center"><p class="text-gray-500 font-medium">Abra uma chave da guilda para visualizar seu recrutamento.</p></div>';
      updateCreateButtonVisibility(); renderRequests(); initIcons(); return;
    }
    if (!currentRecruitment) {
      if (els.view) els.view.innerHTML = '<div class="bg-white rounded-2xl p-10 border border-gray-100 shadow-sm text-center"><div class="w-14 h-14 rounded-2xl bg-gray-50 text-gray-500 flex items-center justify-center mx-auto mb-3"><i data-lucide="search-x" class="w-7 h-7"></i></div><p class="text-gray-800 font-semibold">Nenhum recrutamento publicado ainda</p><p class="text-gray-500 text-sm mt-1">Essa chave ainda não tem um anúncio ativo. Toque em <b>Criar recrutamento</b> para publicar o primeiro.</p></div>';
      updateCreateButtonVisibility(); renderRequests(); initIcons(); return;
    }
    const d = currentRecruitment;
    const roles = Array.isArray(d.roles) && d.roles.length ? d.roles.map(v => tagChip(v,'role')).join(' ') : '<span class="text-sm text-gray-400">Nenhuma</span>';
    const contacts = Array.isArray(d.contacts) && d.contacts.length ? d.contacts.map(v => tagChip(v,'contact')).join(' ') : '<span class="text-sm text-gray-400">Nenhuma</span>';
    const types = Array.isArray(d.guildType) && d.guildType.length ? d.guildType.map(v => tagChip(v,'type')).join(' ') : '<span class="text-sm text-gray-400">Nenhum</span>';
    const focuses = Array.isArray(d.focus) && d.focus.length ? d.focus.map(v => tagChip(v,'focus')).join(' ') : '<span class="text-sm text-gray-400">Nenhum</span>';
    const requirements = renderRequirementChips(d);
    const photo = d.photoBase64 ? `<img src="${d.photoBase64}" alt="Foto do recrutamento" class="w-full h-64 object-cover rounded-2xl border border-gray-200 bg-gray-50">` : '';
    if (els.view) els.view.innerHTML = `<div class="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden"><div class="p-5 border-b border-gray-100 flex items-start justify-between gap-4"><div><div class="flex items-center gap-2 flex-wrap"><h4 class="text-xl font-bold text-gray-900">${escapeHtml(d.guildName || 'Sem nome')}</h4><span class="inline-flex items-center rounded-full bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200 px-2.5 py-1 text-[11px] font-extrabold">ATIVO</span></div><p class="text-sm text-gray-500 mt-1">Chave usada: <span class="font-semibold break-all">${escapeHtml(openedKey)}</span></p><p class="text-sm text-gray-500 mt-1">Publicado em: ${escapeHtml(formatDateBR(d.dateMs || d.createdAt || Date.now()))}</p></div><div class="flex items-center gap-2"><button id="btn-edit-rec" class="px-3 py-2 rounded-xl text-sm font-medium text-gray-600 hover:bg-gray-100">Editar</button><button id="btn-delete-rec" class="px-3 py-2 rounded-xl text-sm font-medium text-red-500 hover:bg-red-50">Excluir</button></div></div><div class="p-5 space-y-5">${photo}<div class="grid md:grid-cols-2 gap-5"><div><p class="text-xs font-semibold text-gray-500 mb-2">Funções</p><div class="flex flex-wrap gap-2">${roles}</div></div><div><p class="text-xs font-semibold text-gray-500 mb-2">Mais opções</p><div class="flex flex-wrap gap-2">${contacts}</div></div><div><p class="text-xs font-semibold text-gray-500 mb-2">Tipo da guilda</p><div class="flex flex-wrap gap-2">${types}</div></div><div><p class="text-xs font-semibold text-gray-500 mb-2">Foco</p><div class="flex flex-wrap gap-2">${focuses}</div></div><div class="md:col-span-2"><p class="text-xs font-semibold text-gray-500 mb-2">Requisitos</p><div class="flex flex-wrap gap-2">${requirements}</div></div></div><div><p class="text-xs font-semibold text-gray-500 mb-2">Descrição</p><div class="rounded-xl bg-gray-50 border border-gray-200 p-4 text-sm text-gray-700 min-h-[84px] whitespace-pre-wrap">${escapeHtml(d.description || 'Sem descrição.')}</div></div></div></div>`;
    updateCreateButtonVisibility(); renderRequests();
    qs('btn-edit-rec')?.addEventListener('click', () => openModal('edit'));
    qs('btn-delete-rec')?.addEventListener('click', deleteRecruitment);
    initIcons();
  }
  async function loadRequests() {
    currentRequests = [];
    if (!linkedUid || !currentRecruitment) { renderRequests(); return; }
    try {
      const snap = await getDocs(collection(recDb, 'rec', linkedUid, 'pedidos'));
      currentRequests = snap.docs.map(d => ({ id:d.id, ...d.data() }));
      currentRequests.sort((a,b) => (normalizeTimestamp(b.createdAt || b.dateMs || b.date)?.getTime?.() || 0) - (normalizeTimestamp(a.createdAt || a.dateMs || a.date)?.getTime?.() || 0));
    } catch (err) { console.error(err); }
    renderRequests();
  }
  async function resolveKeyAndLoad(forceMessage=true, providedKey=null) {
    if (!canOpenRecruitment()) {
      setStatus('O recrutamento está disponível apenas para os planos Pro, Business ou Vitalício.','warn');
      showToast('error', 'Libere o plano Pro, Business ou Vitalício para usar o recrutamento.');
      return false;
    }
    const key = normalizeGuildAccessKey(providedKey != null ? providedKey : els.keyInput?.value);
    if (!isValidGuildAccessKey(key)) {
      setStatus(invalidGuildKeyMessage, 'error');
      showToast('error', invalidGuildKeyMessage);
      return false;
    }
    if (els.keyInput) els.keyInput.value = key;
    const guildId = ctxGuildId();
    if (!guildId) { showToast('error', 'Guilda não encontrada na sessão.'); return false; }
    try {
      if (els.loadBtn) els.loadBtn.disabled = true;
      if (els.reloadBtn) els.reloadBtn.disabled = true;
      const keyRef = doc(recDb, 'chave', key);
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
      const recSnap = await getDoc(doc(recDb, 'rec', linkedUid));
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
    if (!canOpenRecruitment()) return false;

    setKeyCheckingState();

    let savedKey = '';
    try {
      savedKey = normalizeGuildAccessKey(await getRecruitmentGuildAccessKeyConfig() || '');
    } catch (_) {
      savedKey = '';
    }

    if (!savedKey) {
      setManualKeyMode(true);
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
    if (!canOpenRecruitment()) { showToast('error','Apenas Pro, Business ou Vitalício podem salvar recrutamento.'); return; }
    if (!linkedUid) { showToast('error','Abra uma chave antes de salvar.'); return; }
    const guildName = String(els.guildName?.value || '').trim();
    const roles = getCheckedValues('roles');
    const contacts = getCheckedValues('contacts');
    const guildType = getCheckedValues('guildType');
    const focus = getCheckedValues('focus');
    const platform = String(els.platform?.value || '').trim();
    const minimumAge = String(els.age?.value || '').trim();
    const nickChangeRequired = String(els.nickRequired?.value || '').trim();
    const nickChangeDeadline = String(els.nickDeadline?.value || '').trim();
    const teamPlay = String(els.teamPlay?.value || '').trim();
    const useCall = String(els.useCall?.value || '').trim();
    const description = String(els.desc?.value || '').trim().slice(0,100);
    if (!guildName) { showToast('error','O nome da guilda é obrigatório.'); return; }
    if (!validarTextoPermitido(guildName, 'Nome da guilda')) return;
    if (description && !validarTextoPermitido(description, 'Descrição')) return;
    if (!roles.length) { showToast('error','Marque pelo menos uma função.'); return; }
    if (!currentPhotoBase64 && !currentRecruitment?.photoBase64) { showToast('error','Envie uma foto para o recrutamento.'); return; }
    try {
      const payload = {
        guildName, dateMs: currentRecruitment?.dateMs || Date.now(), roles, contacts, guildType, focus, description,
        platform, minimumAge, nickChangeRequired, nickChangeDeadline, teamPlay, useCall,
        key: openedKey, ownerUid: ctxGuildId() || linkedUid, photoBase64: currentPhotoBase64 || currentRecruitment?.photoBase64 || '',
        photoBytes: currentPhotoBytes || currentRecruitment?.photoBytes || dataUrlSizeBytes(currentPhotoBase64 || currentRecruitment?.photoBase64 || ''),
        updatedAt: serverTimestamp(), guildId: linkedUid
      };
      if (!currentRecruitment) payload.createdAt = serverTimestamp();
      await setDoc(doc(recDb,'rec',linkedUid), payload, { merge:true });
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
      await deleteDoc(doc(recDb,'rec',linkedUid));
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
    els.reloadBtn?.addEventListener('click', async () => {
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
    if (els.openedKey) els.openedKey.textContent = 'Nenhuma';
    const vipAllowed = applyRecruitmentVipGate();
    if (!vipAllowed) {
      setManualKeyMode(true);
      setStatus('Seu plano atual não libera o recrutamento. Para abrir essa área, use Pro, Business ou Vitalício.','warn');
      resetPhotoState(); renderRecruitment(); updateCopyLinkVisibility(); initIcons();
      return;
    }
    await tryBootWithSavedKey();
    populateRequestTargetSlotOptions('1');
    resetPhotoState(); renderRecruitment(); updateCopyLinkVisibility(); initManagementCustomSelects(); initIcons();
  })();
}

bootManagementMode();
window.addEventListener('beforeunload', () => { deleteApp(secondaryApp).catch(() => {}); });
