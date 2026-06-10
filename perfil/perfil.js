import {
  doc,
  getDoc,
  setDoc,
  collection,
  query,
  where,
  getDocs,
  serverTimestamp,
  writeBatch
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { setupSidebar, initIcons, logout, getGuildContext, showToast, auth, db } from '../logic.js';
import {
  readCachedSidebarProfile,
  cacheSidebarProfile,
  applyCachedSidebarProfile,
  cacheReadJson,
  cacheWriteJsonStamped,
  cacheIsFresh
} from '../cache.js';

const qs = (id) => document.getElementById(id);
const normalizeDigits = (v) => String(v ?? '').replace(/\D+/g, '');
const normalizeEmail = (v) => String(v ?? '').trim().toLowerCase();
const isNumericDocId = (id) => /^\d+$/.test(String(id || ''));
const PROFILE_GUILD_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const PROFILE_GUILD_CACHE_PREFIX = 'profileGuildContext_v1_';
const PARTNER_CACHE_TTL_MS = 60 * 60 * 1000;
const PARTNER_DATA_CACHE_PREFIX = 'profilePartnerData_v2_';
const PARTNER_COMMISSIONS_CACHE_PREFIX = 'profilePartnerCommissions_v1_';
const PARTNER_PLANS_CACHE_KEY = 'profilePartnerPlans_v1';

const PARTNER_PLAN_DEFAULTS = [
  { id: 'free', name: 'FREE', price: 0, affiliatePercent: 0, order: 0, active: true, visible: true, purchasable: false },
  { id: 'plus', name: 'PLUS', price: 6.99, affiliatePercent: 20, order: 10, active: true, visible: true, purchasable: true },
  { id: 'pro', name: 'PRO', price: 9.99, affiliatePercent: 20, order: 20, active: true, visible: true, purchasable: true },
  { id: 'business', name: 'BUSINESS', price: 99.9, affiliatePercent: 10, order: 30, active: true, visible: true, purchasable: true },
  { id: 'ultra', name: 'ULTRA', price: 14.99, affiliatePercent: 20, order: 40, active: true, visible: true, purchasable: true },
  { id: 'parceiro', name: 'PARCEIRO', price: 0, affiliatePercent: 0, order: 50, active: true, visible: true, purchasable: false }
];

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

function normalizarTextoImproprio(texto) {
  return String(texto || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[@4]/g, 'a')
    .replace(/[3]/g, 'e')
    .replace(/[1!|]/g, 'i')
    .replace(/[0]/g, 'o')
    .replace(/[5$]/g, 's')
    .replace(/[7]/g, 't')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function escaparRegexImproprio(texto) {
  return String(texto || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function contemPalavraImpropria(texto) {
  const textoNormalizado = ` ${normalizarTextoImproprio(texto)} `;

  return palavrasBloqueioDireto.some((palavra) => {
    const palavraNormalizada = normalizarTextoImproprio(palavra);
    if (!palavraNormalizada) return false;

    const palavraRegex = escaparRegexImproprio(palavraNormalizada).replace(/\s+/g, '\\s+');
    const regex = new RegExp(`\\s${palavraRegex}\\s`, 'i');

    return regex.test(textoNormalizado);
  });
}

function contemNomeReservadoDaPlataforma(texto) {
  const normalizado = normalizarTextoImproprio(texto).replace(/\s+/g, '');
  return normalizado.includes('guildahub') || normalizado.includes('guildmanager');
}

function validarTextoPermitido(valor, campo) {
  if (contemPalavraImpropria(valor)) {
    showToast('error', `${campo} contém palavra imprópria.`);
    return false;
  }
  if (contemNomeReservadoDaPlataforma(valor)) {
    showToast('error', `${campo} não pode usar o nome da plataforma.`);
    return false;
  }
  return true;
}


function sameEmail(a, b) {
  const ea = normalizeEmail(a);
  const eb = normalizeEmail(b);
  return !!ea && !!eb && ea === eb;
}

function normalizeRoleKey(value = '') {
  return String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();
}

function normalizeRoleLabel(value = '') {
  const key = normalizeRoleKey(value);
  if (key === 'lider' || key === 'leader' || key === 'chefe' || key === 'dono' || key === 'owner') return 'Líder';
  if (key === 'admin' || key === 'administrador' || key.includes('admin')) return 'Admin';
  if (key === 'jogador' || key === 'player') return 'Jogador';
  return String(value || '').trim() || 'Membro';
}

function getProfileAccessContext() {
  return profileAccessContext || getGuildContext() || {};
}

function applyProfileSidebarContext(ctx = {}, user = auth.currentUser) {
  const role = normalizeRoleLabel(ctx.role || getGuildContext()?.role || 'Membro');
  const email = String(user?.email || ctx.email || '').trim();
  const roleEl = document.getElementById('user-role');
  const emailEl = document.getElementById('user-email');

  if (roleEl) roleEl.textContent = role;
  if (emailEl) emailEl.textContent = email;

  // Importante: isso só controla links do menu. Não bloqueia acesso ao perfil.
  const canManage = ['lider', 'leader', 'admin', 'administrador'].includes(normalizeRoleKey(role));
  document.querySelectorAll('.only-leader, [data-rec-admin-leader-only="true"]').forEach((el) => {
    el.classList.toggle('hidden', !canManage);
  });
}

function profileGuildCacheKey(uid, guildId) {
  return `${PROFILE_GUILD_CACHE_PREFIX}${String(uid || '').trim()}_${String(guildId || '').trim()}`;
}

function emailInConfigList(email, value) {
  const cleanEmailValue = normalizeEmail(email);
  return !!cleanEmailValue && Array.isArray(value) && value.some((item) => normalizeEmail(item) === cleanEmailValue);
}

function roleFromGuildConfig(user, guildId, config = {}, guild = {}, fallbackRole = 'Membro') {
  const uid = String(user?.uid || '').trim();
  const email = normalizeEmail(user?.email || '');
  const ownerUid = String(config.ownerUid || guild.ownerUid || '').trim();
  const ownerEmail = normalizeEmail(config.ownerEmail || guild.ownerEmail || '');

  if (uid && (uid === guildId || uid === ownerUid)) return 'Líder';
  if (email && ownerEmail === email) return 'Líder';
  if (emailInConfigList(email, config.leaders)) return 'Líder';
  if (emailInConfigList(email, config.admins)) return 'Admin';
  if (email && normalizeEmail(config.playerEmail) === email) return 'Jogador';
  if (!Object.keys(config).length && !Object.keys(guild).length) return normalizeRoleLabel(fallbackRole);
  return 'Membro';
}

async function refreshProfileGuildContext(user, baseContext) {
  const guildId = String(baseContext?.guildId || '').trim();
  if (!guildId) return baseContext;

  const cacheKey = profileGuildCacheKey(user?.uid, guildId);
  const cached = cacheReadJson(cacheKey, null);
  if (
    cached &&
    cached.guildId === guildId &&
    cached.uid === String(user?.uid || '') &&
    cacheIsFresh(cached, PROFILE_GUILD_CACHE_TTL_MS)
  ) {
    return {
      ...baseContext,
      ...cached,
      email: normalizeEmail(user?.email || cached.email || '')
    };
  }

  try {
    const [configSnap, guildSnap] = await Promise.all([
      getDoc(doc(db, 'configGuilda', guildId)),
      getDoc(doc(db, 'guildas', guildId))
    ]);
    const config = configSnap.exists() ? (configSnap.data() || {}) : {};
    const guild = guildSnap.exists() ? (guildSnap.data() || {}) : {};
    const guildName = String(
      config.name ||
      config.nome ||
      config.guildName ||
      config.guilda ||
      guild.name ||
      guild.nome ||
      baseContext.guildName ||
      ''
    ).trim() || 'Sem guilda';
    const role = normalizeRoleLabel(roleFromGuildConfig(user, guildId, config, guild, baseContext.role));
    const refreshed = {
      ...baseContext,
      uid: String(user?.uid || ''),
      email: normalizeEmail(user?.email || ''),
      guildId,
      guildName,
      role
    };
    cacheWriteJsonStamped(cacheKey, refreshed);
    return refreshed;
  } catch (error) {
    console.warn('Não foi possível renovar os dados da guilda do perfil:', error);
    return cached ? { ...baseContext, ...cached } : baseContext;
  }
}

async function resolveProfileAccessContext(user) {
  const uid = String(user?.uid || '').trim();
  const email = normalizeEmail(user?.email || '');
  const ctx = getGuildContext() || {};

  let userProfile = null;
  try {
    const userSnap = await getDoc(doc(db, 'users', uid));
    userProfile = userSnap.exists() ? (userSnap.data() || {}) : null;
  } catch (_) {
    // Se as regras bloquearem alguma leitura extra, a tela continua funcionando com o usuário autenticado.
  }

  const guildId = String(userProfile?.guildId || ctx.guildId || '').trim();
  const guildName = String(
    userProfile?.guilda ||
    userProfile?.guildName ||
    ctx.guildName ||
    ''
  ).trim();
  const role = normalizeRoleLabel(userProfile?.role || ctx.role || 'Membro');

  return refreshProfileGuildContext(user, {
    guildId,
    guildName: guildName || 'Sem guilda',
    role,
    email,
    uid
  });
}

function waitForProfileAuth() {
  return new Promise((resolve) => {
    let unsubscribe = () => {};
    unsubscribe = onAuthStateChanged(auth, async (user) => {
      try { unsubscribe(); } catch (_) {}

      if (!user) {
        window.location.href = '/inicio';
        resolve(null);
        return;
      }

      try { hydrateProfileFromCache(user); } catch (_) {}

      try {
        profileAccessContext = await resolveProfileAccessContext(user);
      } catch (error) {
        console.error('Erro ao carregar contexto do perfil:', error);
        profileAccessContext = {
          uid: user.uid,
          email: normalizeEmail(user.email || ''),
          role: 'Membro',
          guildId: '',
          guildName: 'Sem guilda'
        };
      }

      applyProfileSidebarContext(profileAccessContext, user);
      try { hydrateProfileFromCache(user); } catch (_) {}
      resolve(user);
    });
  });
}

function snapToProfile(snap) {
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

function profileBelongsToCurrentUser(data, uid, email) {
  if (!data) return false;

  return (
    data.uid === uid ||
    sameEmail(data.email, email) ||
    sameEmail(data.playerEmail, email)
  );
}

async function queryUsersByField(field, value) {
  const clean = String(value || '').trim();
  if (!clean) return [];

  const q = query(collection(db, 'users'), where(field, '==', clean));
  const snap = await getDocs(q);

  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

async function findEmailConflictsForProfileCreation(uid, email, gameId) {
  const rawEmail = String(email || '').trim();
  const lowerEmail = normalizeEmail(email);
  const searches = [];
  const seenSearches = new Set();

  function addSearch(field, value) {
    const clean = String(value || '').trim();
    if (!clean) return;
    const key = String(field || '') + ':' + clean;
    if (seenSearches.has(key)) return;
    seenSearches.add(key);
    searches.push([field, clean]);
  }

  addSearch('email', rawEmail);
  addSearch('email', lowerEmail);
  addSearch('playerEmail', rawEmail);
  addSearch('playerEmail', lowerEmail);

  const found = new Map();
  for (const [field, value] of searches) {
    const profiles = await queryUsersByField(field, value);
    profiles.forEach((profile) => {
      if (profile?.id) found.set(String(profile.id), profile);
    });
  }

  const allowedIds = new Set([String(uid || ''), String(gameId || '')].filter(Boolean));

  return Array.from(found.values()).filter((profile) => {
    const profileId = String(profile?.id || '').trim();
    if (!profileId) return false;
    if (allowedIds.has(profileId)) return false;
    if (String(profile?.uid || '').trim() === String(uid || '').trim()) return false;

    const linkedGameId = normalizeDigits(profile?.gameIdMigrated || profile?.gameId || '');
    if (linkedGameId && linkedGameId === String(gameId || '').trim()) return false;

    return true;
  });
}

async function findProfilesForCurrentUser(uid, email) {
  const found = new Map();

  function add(profile) {
    if (profile && profile.id) found.set(profile.id, profile);
  }

  function addMany(list) {
    list.forEach(add);
  }

  // 1. Documento antigo pelo UID do Auth: /users/{auth.uid}
  const authDocSnap = await getDoc(doc(db, 'users', uid));
  const authDoc = snapToProfile(authDocSnap);
  add(authDoc);

  // 2. Se o documento antigo já aponta para um Game ID migrado
  const migratedId = normalizeDigits(
    authDoc?.gameIdMigrated ||
    authDoc?.gameId ||
    authDoc?.id ||
    ''
  );

  if (migratedId) {
    const migratedSnap = await getDoc(doc(db, 'users', migratedId));
    add(snapToProfile(migratedSnap));
  }

  // 3. Busca por UID
  addMany(await queryUsersByField('uid', uid));

  // 4. Busca por e-mail. Alguns registros antigos podem estar com caixa diferente.
  const rawEmail = String(email || '').trim();
  const lowerEmail = normalizeEmail(email);

  addMany(await queryUsersByField('email', rawEmail));
  if (lowerEmail && lowerEmail !== rawEmail) {
    addMany(await queryUsersByField('email', lowerEmail));
  }

  // 5. Fallback para campo antigo/player
  addMany(await queryUsersByField('playerEmail', rawEmail));
  if (lowerEmail && lowerEmail !== rawEmail) {
    addMany(await queryUsersByField('playerEmail', lowerEmail));
  }

  return {
    authDoc,
    profiles: Array.from(found.values())
  };
}

const els = {
  loading: qs('loading-state'),
  formMain: qs('profile-form'),
  preview: qs('profile-preview'),
  placeholder: qs('profile-placeholder'),
  inputFoto: qs('input-foto'),
  inputNick: qs('input-nick'),
  inputBio: qs('input-bio'),
  bioCounter: qs('bio-counter'),
  viewGameId: qs('view-gameid'),
  viewUid: qs('view-uid'),
  viewEmail: qs('view-email'),
  viewGuild: qs('view-guild'),
  viewRole: qs('view-role'),
  viewCreated: qs('view-created'),
  btnSave: qs('btn-save-profile'),
  legacyPhotoAlert: qs('legacy-photo-alert'),
  btnUpdateLegacyPhoto: qs('btn-update-legacy-photo'),
  modalPhotoCrop: qs('modal-photo-crop'),
  cropCanvas: qs('photo-crop-canvas'),
  cropZoom: qs('photo-crop-zoom'),
  cropFileName: qs('photo-crop-file-name'),
  btnClosePhotoCrop: qs('btn-close-photo-crop'),
  btnCancelPhotoCrop: qs('btn-cancel-photo-crop'),
  btnConfirmPhotoCrop: qs('btn-confirm-photo-crop'),
  btnResetPhotoCrop: qs('btn-reset-photo-crop'),

  partnerEntryCard: qs('partner-entry-card'),
  partnerPanelCard: qs('partner-panel-card'),
  partnerPanelBody: qs('partner-panel-body'),
  partnerTypeBadge: qs('partner-type-badge'),
  partnerTypeDescription: qs('partner-type-description'),
  btnOpenPartnerModal: qs('btn-open-partner-modal'),
  modalPartner: qs('modal-partner-program'),
  btnClosePartnerModal: qs('btn-close-partner-modal'),
  btnAcceptPartner: qs('btn-accept-partner'),
  btnDeclinePartner: qs('btn-decline-partner'),
  inputPartnerSocials: qs('input-partner-socials'),
  btnTogglePartnerPanel: qs('btn-toggle-partner-panel'),
  partnerCurrentBalance: qs('partner-current-balance'),
  partnerWithdrawnBalance: qs('partner-withdrawn-balance'),
  partnerInvitedCount: qs('partner-invited-count'),
  partnerPaidCount: qs('partner-paid-count'),
  partnerRefLink: qs('partner-ref-link'),
  btnCopyPartnerLink: qs('btn-copy-partner-link'),
  inputPartnerPix: qs('input-partner-pix'),
  inputPartnerWithdrawAmount: qs('input-partner-withdraw-amount'),
  btnSavePartnerPix: qs('btn-save-partner-pix'),
  btnRequestPartnerWithdraw: qs('btn-request-partner-withdraw'),
  partnerWithdrawStatus: qs('partner-withdraw-status'),
  partnerPlanSummary: qs('partner-plan-summary'),
  partnerModalPlanList: qs('partner-modal-plan-list'),
  partnerPaymentsList: qs('partner-payments-list'),
  partnerPaymentsStatus: qs('partner-payments-status'),
  
  modalCreate: qs('modal-create-profile'),
  formCreate: qs('form-create-profile'),
  inputNewGameId: qs('input-new-gameid'),
  btnConfirm: qs('btn-confirm-creation'),

  sidebarAvatar: qs('sidebar-avatar'),
  sidebarIcon: qs('sidebar-avatar-icon')
};

let currentUserProfileId = null; 
let currentBase64Photo = '';
let currentPersistedPhoto = '';
let pendingProfilePhotoDataUrl = '';
let currentProfileData = null;
let currentMonetizeData = null;
let currentPartnerPlans = [];
let currentPartnerCommissions = [];
let isPartnerPanelCollapsed = false;
let profileAccessContext = null;
let cropState = null;
let cropPointer = null;

// --- Foto de perfil: recorte local + upload para R2 ---
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

function isLegacyBase64Photo(value = '') {
  return /^data:image\//i.test(String(value || '').trim());
}

function updateLegacyPhotoNotice(photoValue = '') {
  const show = isLegacyBase64Photo(photoValue) && !pendingProfilePhotoDataUrl;
  els.legacyPhotoAlert?.classList.toggle('hidden', !show);
  els.legacyPhotoAlert?.classList.toggle('flex', show);
}

function setPhotoCropVisible(isVisible) {
  els.modalPhotoCrop?.classList.toggle('hidden', !isVisible);
  els.modalPhotoCrop?.classList.toggle('flex', isVisible);
  if (!isVisible) {
    cropPointer = null;
    if (els.inputFoto) els.inputFoto.value = '';
  }
}

function clampCropOffsets() {
  if (!cropState || !els.cropCanvas) return;
  const canvasSize = els.cropCanvas.width;
  const imageWidth = cropState.image.naturalWidth || cropState.image.width || 1;
  const imageHeight = cropState.image.naturalHeight || cropState.image.height || 1;
  const coverScale = Math.max(canvasSize / imageWidth, canvasSize / imageHeight);
  const scale = coverScale * cropState.zoom;
  const maxX = Math.max(0, ((imageWidth * scale) - canvasSize) / 2);
  const maxY = Math.max(0, ((imageHeight * scale) - canvasSize) / 2);
  cropState.offsetX = Math.max(-maxX, Math.min(maxX, cropState.offsetX));
  cropState.offsetY = Math.max(-maxY, Math.min(maxY, cropState.offsetY));
}

function renderPhotoCrop() {
  if (!cropState || !els.cropCanvas) return;
  clampCropOffsets();
  const canvas = els.cropCanvas;
  const context = canvas.getContext('2d', { alpha: false });
  if (!context) return;
  const imageWidth = cropState.image.naturalWidth || cropState.image.width || 1;
  const imageHeight = cropState.image.naturalHeight || cropState.image.height || 1;
  const coverScale = Math.max(canvas.width / imageWidth, canvas.height / imageHeight);
  const scale = coverScale * cropState.zoom;
  const drawWidth = imageWidth * scale;
  const drawHeight = imageHeight * scale;
  const drawX = ((canvas.width - drawWidth) / 2) + cropState.offsetX;
  const drawY = ((canvas.height - drawHeight) / 2) + cropState.offsetY;

  context.fillStyle = '#020617';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = 'high';
  context.drawImage(cropState.image, drawX, drawY, drawWidth, drawHeight);
}

async function openPhotoCrop(file) {
  if (!file?.type?.startsWith('image/')) throw new Error('Selecione uma imagem válida.');
  if (file.size > 12 * 1024 * 1024) throw new Error('A imagem deve ter no máximo 12 MB.');
  const image = await loadImageFromFile(file);
  cropState = { image, zoom: 1, offsetX: 0, offsetY: 0 };
  if (els.cropZoom) els.cropZoom.value = '1';
  if (els.cropFileName) els.cropFileName.textContent = String(file.name || 'Foto selecionada');
  setPhotoCropVisible(true);
  renderPhotoCrop();
  initIcons();
}

function cropCanvasToDataUrl(maxBytes = 900 * 1024) {
  if (!els.cropCanvas || !cropState) throw new Error('Recorte não disponível.');
  let quality = 0.88;
  let output = '';
  while (quality >= 0.45) {
    output = els.cropCanvas.toDataURL('image/jpeg', quality);
    if (dataUrlSizeBytes(output) <= maxBytes) return output;
    quality -= 0.08;
  }
  return output;
}

async function requestProfileImage(action, payload = {}) {
  const user = auth.currentUser;
  if (!user || !currentUserProfileId) throw new Error('Perfil não encontrado.');
  const idToken = await user.getIdToken();
  const response = await fetch('/api/recruitment_image', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${idToken}`
    },
    body: JSON.stringify({
      scope: 'profile',
      action,
      profileId: currentUserProfileId,
      ...payload
    })
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data?.ok === false) {
    throw new Error(data?.error || 'Não foi possível processar a foto.');
  }
  return data;
}

async function uploadPendingProfilePhoto() {
  if (!pendingProfilePhotoDataUrl) return currentPersistedPhoto || currentBase64Photo || '';
  const result = await requestProfileImage('upload', { dataUrl: pendingProfilePhotoDataUrl });
  if (!result?.url) throw new Error('O R2 não retornou o link da foto.');
  return String(result.url);
}

async function deleteProfilePhoto(photoUrl) {
  const clean = String(photoUrl || '').trim();
  if (!/^https?:\/\//i.test(clean)) return;
  await requestProfileImage('delete', { url: clean });
}

// --- Funções de UI ---
function setPhotoUI(photoValue) {
  currentBase64Photo = photoValue || '';

  if (currentBase64Photo) {
    els.preview.src = currentBase64Photo;
    els.preview.classList.remove('hidden');
    els.placeholder.classList.add('hidden');

    if (els.sidebarAvatar && els.sidebarIcon) {
      els.sidebarAvatar.src = currentBase64Photo;
      els.sidebarAvatar.classList.remove('hidden');
      els.sidebarIcon.classList.add('hidden');
    }
  } else {
    els.preview.src = '';
    els.preview.classList.add('hidden');
    els.placeholder.classList.remove('hidden');

    if (els.sidebarAvatar && els.sidebarIcon) {
      els.sidebarAvatar.src = '';
      els.sidebarAvatar.classList.add('hidden');
      els.sidebarIcon.classList.remove('hidden');
    }
  }
  updateLegacyPhotoNotice(currentBase64Photo);
}

function dateFromFirestoreValue(val) {
  if (!val) return null;

  if (typeof val.toDate === 'function') {
    return val.toDate();
  }

  const seconds = typeof val.seconds === 'number'
    ? val.seconds
    : (typeof val._seconds === 'number' ? val._seconds : null);

  if (seconds !== null) {
    const nanos = typeof val.nanoseconds === 'number'
      ? val.nanoseconds
      : (typeof val._nanoseconds === 'number' ? val._nanoseconds : 0);

    return new Date((seconds * 1000) + Math.floor(nanos / 1000000));
  }

  if (typeof val === 'number') {
    return new Date(val > 9999999999 ? val : val * 1000);
  }

  if (typeof val === 'string') {
    const d = new Date(val);
    return Number.isNaN(d.getTime()) ? null : d;
  }

  return null;
}

const formatDateBR = (val) => {
  const d = dateFromFirestoreValue(val);
  if (!d || Number.isNaN(d.getTime())) return '--';
  return d.toLocaleDateString('pt-BR');
};

function getRoleStyle(role) {
  const r = String(role || 'Membro').trim().toLowerCase();
  if (r === 'líder' || r === 'lider' || r === 'chefe') return 'bg-amber-100 text-amber-800 ring-1 ring-amber-300';
  if (r === 'admin') return 'bg-fuchsia-100 text-fuchsia-800 ring-1 ring-fuchsia-300';
  return 'bg-slate-100 text-slate-700 ring-1 ring-slate-300';
}

function setLoadingVisible(isVisible) {
  els.loading?.classList.toggle('hidden', !isVisible);
}

function setMainFormVisible(isVisible) {
  els.formMain?.classList.toggle('hidden', !isVisible);
  if (els.btnSave) els.btnSave.disabled = !isVisible;
}

function setCreateModalVisible(isVisible) {
  els.modalCreate?.classList.toggle('hidden', !isVisible);
  els.modalCreate?.classList.toggle('flex', isVisible);
}

function hydrateProfileFromCache(user = auth.currentUser) {
  try {
    const cached = readCachedSidebarProfile(user);
    if (!cached) return false;

    const ctx = getProfileAccessContext();
    const profileId = String(cached.profileId || cached.id || cached.gameIdMigrated || cached.gameId || '').trim();
    const nick = String(cached.nick || cached.nome || cached.name || '').trim();
    const bio = String(cached.cat || cached.bio || '').trim().slice(0, 100);
    const foto = String(cached.foto || cached.photo || cached.avatar || '').trim();
    const role = normalizeRoleLabel(ctx.role || cached.role || 'Membro');
    const guildName = String(ctx.guildName || cached.guilda || cached.guildName || 'Sem guilda').trim();
    const email = String(user?.email || ctx.email || cached.email || '').trim();

    currentUserProfileId = currentUserProfileId || profileId;
    currentProfileData = {
      ...(currentProfileData || {}),
      ...(cached || {}),
      id: profileId || cached.id || currentUserProfileId || '',
      uid: user?.uid || cached.uid || '',
      email,
      cat: bio,
      bio,
      foto
    };

    if (els.inputNick && !els.inputNick.value && nick) els.inputNick.value = nick;
    if (els.inputBio && !els.inputBio.value && bio) {
      els.inputBio.value = bio;
      if (els.bioCounter) els.bioCounter.textContent = `${els.inputBio.value.length}/100`;
    }

    if (foto && !currentBase64Photo) {
      currentPersistedPhoto = foto;
      pendingProfilePhotoDataUrl = '';
      setPhotoUI(foto);
    }

    if (els.viewGameId && (!els.viewGameId.value || els.viewGameId.value === '--') && profileId) els.viewGameId.value = profileId;
    if (els.viewUid && (!els.viewUid.value || els.viewUid.value === '--') && user?.uid) els.viewUid.value = user.uid;
    if (els.viewEmail && (!els.viewEmail.value || els.viewEmail.value === '--') && email) els.viewEmail.value = email;
    if (els.viewGuild && (!els.viewGuild.value || els.viewGuild.value === '--')) els.viewGuild.value = guildName || 'Sem guilda';

    if (els.viewRole) {
      els.viewRole.textContent = role;
      els.viewRole.className = `inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-black uppercase tracking-wide ${getRoleStyle(role)}`;
    }

    applyCachedSidebarProfile(user);
    if (currentUserProfileId) hydratePartnerExperienceFromCache(currentProfileData);
    setLoadingVisible(false);
    setCreateModalVisible(false);
    setMainFormVisible(true);
    return true;
  } catch (_) {
    return false;
  }
}

function resetCreateBtn() {
  els.btnConfirm.disabled = false;
  els.btnConfirm.textContent = 'Criar meu Perfil';
}

function getOldDataFromModal() {
  try {
    return JSON.parse(els.formCreate.dataset.oldData || '{}');
  } catch (_) {
    return {};
  }
}

function buildBridgePayload(gameProfileDoc, oldAuthDocData = {}) {
  const uid = auth.currentUser.uid;
  const email = auth.currentUser.email || '';
  const accessContext = getProfileAccessContext();

  return {
    uid,
    email: email || gameProfileDoc.email || oldAuthDocData.email || '',
    id: gameProfileDoc.id,
    gameIdMigrated: gameProfileDoc.id,

    nick: gameProfileDoc.nick || oldAuthDocData.nick || '',
    foto: gameProfileDoc.foto || oldAuthDocData.foto || '',
    cat: gameProfileDoc.cat || gameProfileDoc.bio || oldAuthDocData.cat || oldAuthDocData.bio || '',

    guildId: accessContext.guildId || gameProfileDoc.guildId || oldAuthDocData.guildId || '',
    guilda: accessContext.guildName || gameProfileDoc.guilda || oldAuthDocData.guilda || '',
    role: accessContext.role || gameProfileDoc.role || oldAuthDocData.role || 'Membro',

    parceiro: gameProfileDoc.parceiro === true || oldAuthDocData.parceiro === true,
    parceiroTipo: gameProfileDoc.parceiroTipo || oldAuthDocData.parceiroTipo || (gameProfileDoc.parceiroVerificado || oldAuthDocData.parceiroVerificado ? 'verificado' : 'normal'),
    parceiroVerificado: gameProfileDoc.parceiroVerificado === true || oldAuthDocData.parceiroVerificado === true,
    monetizeId: gameProfileDoc.monetizeId || oldAuthDocData.monetizeId || '',

    updatedAt: serverTimestamp()
  };
}


// --- Monetização / Parceiros ---
function toMoneyNumber(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const clean = String(value ?? '')
    .replace(/[^0-9,.-]/g, '')
    .replace(/\.(?=\d{3}(\D|$))/g, '')
    .replace(',', '.');
  const parsed = Number(clean);
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatCurrencyBR(value) {
  return toMoneyNumber(value).toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL'
  });
}

function escapePartnerHtml(value = '') {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;'
  }[char]));
}

function partnerCacheKey(prefix, id = currentUserProfileId) {
  const uid = String(auth.currentUser?.uid || '').trim();
  const profileId = String(id || '').trim();
  return uid && profileId ? `${prefix}${uid}_${profileId}` : '';
}

function canonicalPartnerPlanId(value = '') {
  const clean = String(value || '').trim().toLowerCase();
  if (clean === 'bussines') return 'business';
  if (clean === 'vitalicio') return 'parceiro';
  return clean;
}

function partnerPlanField(data = {}, names = [], fallback = undefined) {
  for (const name of names) {
    if (Object.prototype.hasOwnProperty.call(data || {}, name) && data[name] !== undefined && data[name] !== null) {
      return data[name];
    }
  }
  return fallback;
}

function normalizePartnerPercent(value, fallback = 0) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return fallback;
  return parsed > 0 && parsed <= 1 ? parsed * 100 : parsed;
}

function defaultPartnerPercent(planId = '') {
  const plan = PARTNER_PLAN_DEFAULTS.find((item) => item.id === canonicalPartnerPlanId(planId));
  return Number(plan?.affiliatePercent || 0);
}

function booleanPartnerField(data = {}, names = [], fallback = true) {
  const value = partnerPlanField(data, names, undefined);
  if (value === undefined) return fallback;
  if (typeof value === 'string') return !['false', '0', 'nao', 'não', 'off'].includes(value.trim().toLowerCase());
  return value !== false && value !== 0;
}

function isPartnerAddonPlan(id = '', data = {}) {
  const planId = String(id || '').toLowerCase();
  const type = String(partnerPlanField(data, ['type', 'tipo', 'kind'], '') || '').toLowerCase();
  return planId.includes('adicional') || planId.includes('addon') || planId.includes('extra')
    || type.includes('adicional') || type.includes('addon') || type.includes('extra');
}

function hydratePartnerPlan(id, data = {}) {
  const normalizedId = canonicalPartnerPlanId(id);
  const base = PARTNER_PLAN_DEFAULTS.find((item) => item.id === normalizedId) || {
    id: normalizedId,
    name: normalizedId.toUpperCase(),
    price: 0,
    affiliatePercent: 0,
    order: 999,
    active: true,
    visible: true,
    purchasable: true
  };
  const isFreeBenefit = normalizedId === 'free' || normalizedId === 'parceiro';

  return {
    ...base,
    id: normalizedId,
    sourceId: id,
    name: String(partnerPlanField(data, ['name', 'nome', 'titulo', 'title'], base.name || normalizedId)).trim(),
    price: toMoneyNumber(partnerPlanField(data, ['price', 'preco', 'valor', 'amount'], base.price || 0)),
    affiliatePercent: normalizePartnerPercent(
      partnerPlanField(data, ['affiliatePercent', 'afiliadoPercent', 'commissionPercent', 'comissaoPercentual'], base.affiliatePercent),
      defaultPartnerPercent(normalizedId)
    ),
    order: Number(partnerPlanField(data, ['order', 'ordem', 'posicao'], base.order || 999)) || 999,
    active: booleanPartnerField(data, ['active', 'ativo', 'enabled'], base.active !== false),
    visible: booleanPartnerField(data, ['visible', 'visivel', 'show', 'mostrar'], base.visible !== false),
    purchasable: isFreeBenefit
      ? false
      : booleanPartnerField(data, ['purchasable', 'vendavel', 'compravel', 'checkout', 'allowCheckout'], base.purchasable !== false)
  };
}

function partnerPlanPercent(plan = {}) {
  const normalized = canonicalPartnerPlanId(plan.id);
  const maps = [
    currentMonetizeData?.comissaoPorPlano,
    currentMonetizeData?.comissaoPlanos,
    currentMonetizeData?.percentualPorPlano,
    currentMonetizeData?.planPercents,
    currentMonetizeData?.planos
  ];

  for (const map of maps) {
    if (!map || typeof map !== 'object') continue;
    const item = map[normalized] || map[plan.name] || map[String(plan.name || '').toUpperCase()];
    if (item === undefined || item === null) continue;
    const value = typeof item === 'object'
      ? partnerPlanField(item, ['percent', 'percentual', 'comissaoPercentual', 'affiliatePercent'], null)
      : item;
    const normalizedValue = normalizePartnerPercent(value, -1);
    if (normalizedValue >= 0) return normalizedValue;
  }

  return normalizePartnerPercent(plan.affiliatePercent, defaultPartnerPercent(normalized));
}

function commissionPlanId(entry = {}) {
  return canonicalPartnerPlanId(
    entry.plano ||
    entry.plan ||
    entry.comissaoParceiroPlano ||
    entry.vipTier ||
    entry.tier ||
    ''
  );
}

function commissionAmount(entry = {}) {
  return toMoneyNumber(
    entry.comissao ??
    entry.valorComissao ??
    entry.comissaoParceiroValor ??
    entry.affiliateFee ??
    entry.partnerCommission ??
    entry.valor ??
    0
  );
}

function commissionPlanValue(entry = {}, planId = commissionPlanId(entry)) {
  const stored = toMoneyNumber(
    entry.valorPlano ??
    entry.planValue ??
    entry.precoPlano ??
    entry.valorPagamento ??
    entry.amount ??
    entry.valorPago ??
    0
  );
  if (stored > 0) return stored;
  return toMoneyNumber(currentPartnerPlans.find((plan) => plan.id === planId)?.price || 0);
}

function renderPartnerPlanLists() {
  const plans = currentPartnerPlans
    .filter((plan) => plan.active !== false && plan.visible !== false && plan.purchasable !== false)
    .filter((plan) => !['free', 'parceiro'].includes(plan.id))
    .sort((a, b) => (a.price - b.price) || (a.order - b.order));

  const listHtml = plans.length
    ? plans.map((plan) => {
        const percent = partnerPlanPercent(plan);
        return `
          <div class="flex items-center justify-between gap-3 rounded-xl border border-gray-100 bg-gray-50/70 px-3 py-2.5">
            <div class="min-w-0">
              <p class="truncate text-xs font-black text-gray-900">${escapePartnerHtml(plan.name || plan.id.toUpperCase())}</p>
              <p class="mt-0.5 text-[11px] font-semibold text-gray-500">${escapePartnerHtml(formatCurrencyBR(plan.price))}</p>
            </div>
            <span class="shrink-0 rounded-lg bg-emerald-100 px-2.5 py-1 text-xs font-black text-emerald-800">${escapePartnerHtml(`${percent}%`)}</span>
          </div>`;
      }).join('')
    : '<p class="text-xs font-semibold text-gray-400">Nenhum plano comissionado disponível no momento.</p>';

  if (els.partnerPlanSummary) els.partnerPlanSummary.innerHTML = listHtml;
  if (els.partnerModalPlanList) els.partnerModalPlanList.innerHTML = listHtml;
}

function renderPartnerPayments(statusMessage = '') {
  if (!els.partnerPaymentsList) return;

  if (statusMessage && !currentPartnerCommissions.length) {
    els.partnerPaymentsList.innerHTML = '';
    if (els.partnerPaymentsStatus) {
      els.partnerPaymentsStatus.textContent = statusMessage;
      els.partnerPaymentsStatus.classList.remove('hidden');
    }
    return;
  }

  if (els.partnerPaymentsStatus) {
    els.partnerPaymentsStatus.textContent = '';
    els.partnerPaymentsStatus.classList.add('hidden');
  }

  if (!currentPartnerCommissions.length) {
    els.partnerPaymentsList.innerHTML = `
      <div class="rounded-xl border border-dashed border-gray-200 px-4 py-5 text-center">
        <p class="text-xs font-bold text-gray-400">Nenhum pagamento com comissão registrado ainda.</p>
      </div>`;
    return;
  }

  els.partnerPaymentsList.innerHTML = [...currentPartnerCommissions]
    .sort((a, b) => {
      const aDate = dateFromFirestoreValue(a.createdAt || a.criadoEm || a.data || a.updatedAt)?.getTime() || 0;
      const bDate = dateFromFirestoreValue(b.createdAt || b.criadoEm || b.data || b.updatedAt)?.getTime() || 0;
      return bDate - aDate;
    })
    .map((entry) => {
      const planId = commissionPlanId(entry);
      const plan = currentPartnerPlans.find((item) => item.id === planId);
      const planName = String(entry.nomePlano || entry.planName || plan?.name || planId || 'Plano').trim();
      return `
        <div class="grid grid-cols-[minmax(0,1fr),auto,auto] items-center gap-3 rounded-xl border border-gray-100 bg-white px-3 py-3">
          <div class="min-w-0">
            <p class="truncate text-xs font-black text-gray-900">${escapePartnerHtml(planName)}</p>
            <p class="mt-0.5 text-[10px] font-bold uppercase tracking-wide text-gray-400">Plano</p>
          </div>
          <div class="text-right">
            <p class="text-xs font-black text-gray-700">${escapePartnerHtml(formatCurrencyBR(commissionPlanValue(entry, planId)))}</p>
            <p class="mt-0.5 text-[10px] font-bold uppercase tracking-wide text-gray-400">Valor</p>
          </div>
          <div class="text-right">
            <p class="text-xs font-black text-emerald-700">${escapePartnerHtml(formatCurrencyBR(commissionAmount(entry)))}</p>
            <p class="mt-0.5 text-[10px] font-bold uppercase tracking-wide text-gray-400">Comissão</p>
          </div>
        </div>`;
    }).join('');
}

function cachePartnerData(data = currentMonetizeData) {
  const key = partnerCacheKey(PARTNER_DATA_CACHE_PREFIX);
  if (key && data) cacheWriteJsonStamped(key, { data });
}

function cachePartnerCommissions(items = currentPartnerCommissions, monetizeId = currentMonetizeData?.id || currentUserProfileId) {
  const key = partnerCacheKey(PARTNER_COMMISSIONS_CACHE_PREFIX, monetizeId);
  if (key) cacheWriteJsonStamped(key, { items: Array.isArray(items) ? items : [] });
}

function hydratePartnerExperienceFromCache(profile = currentProfileData) {
  const dataKey = partnerCacheKey(PARTNER_DATA_CACHE_PREFIX);
  const dataCache = dataKey ? cacheReadJson(dataKey, null) : null;
  if (dataCache?.data) currentMonetizeData = dataCache.data;

  const plansCache = cacheReadJson(PARTNER_PLANS_CACHE_KEY, null);
  currentPartnerPlans = Array.isArray(plansCache?.items) && plansCache.items.length
    ? plansCache.items
    : PARTNER_PLAN_DEFAULTS.map((plan) => ({ ...plan }));

  const monetizeId = currentMonetizeData?.id || currentProfileData?.monetizeId || currentUserProfileId;
  const commissionsKey = partnerCacheKey(PARTNER_COMMISSIONS_CACHE_PREFIX, monetizeId);
  const commissionsCache = commissionsKey ? cacheReadJson(commissionsKey, null) : null;
  currentPartnerCommissions = Array.isArray(commissionsCache?.items) ? commissionsCache.items : [];

  renderPartnerState(profile, currentMonetizeData);
  renderPartnerPlanLists();
  renderPartnerPayments();

  return {
    dataFresh: cacheIsFresh(dataCache, PARTNER_CACHE_TTL_MS),
    plansFresh: cacheIsFresh(plansCache, PARTNER_CACHE_TTL_MS),
    commissionsFresh: cacheIsFresh(commissionsCache, PARTNER_CACHE_TTL_MS)
  };
}

async function loadPartnerPlans(force = false) {
  const cached = cacheReadJson(PARTNER_PLANS_CACHE_KEY, null);
  if (!force && cacheIsFresh(cached, PARTNER_CACHE_TTL_MS) && Array.isArray(cached.items)) {
    currentPartnerPlans = cached.items;
    renderPartnerPlanLists();
    renderPartnerPayments();
    return currentPartnerPlans;
  }

  try {
    const snap = await getDocs(collection(db, 'planos'));
    const map = new Map();
    snap.docs.forEach((planDoc) => {
      const data = planDoc.data() || {};
      if (isPartnerAddonPlan(planDoc.id, data)) return;
      const plan = hydratePartnerPlan(planDoc.id, data);
      if (plan.id) map.set(plan.id, plan);
    });
    currentPartnerPlans = map.size
      ? Array.from(map.values())
      : PARTNER_PLAN_DEFAULTS.map((plan) => ({ ...plan }));
    cacheWriteJsonStamped(PARTNER_PLANS_CACHE_KEY, { items: currentPartnerPlans });
  } catch (error) {
    console.warn('Não foi possível atualizar os planos do programa de parceiros:', error);
    if (!currentPartnerPlans.length) currentPartnerPlans = PARTNER_PLAN_DEFAULTS.map((plan) => ({ ...plan }));
  }

  renderPartnerPlanLists();
  renderPartnerPayments();
  return currentPartnerPlans;
}

async function loadPartnerCommissions(force = false) {
  const monetizeId = String(currentMonetizeData?.id || currentProfileData?.monetizeId || currentUserProfileId || '').trim();
  if (!monetizeId || !isAcceptedPartner()) return [];

  const key = partnerCacheKey(PARTNER_COMMISSIONS_CACHE_PREFIX, monetizeId);
  const cached = key ? cacheReadJson(key, null) : null;
  if (!force && cacheIsFresh(cached, PARTNER_CACHE_TTL_MS) && Array.isArray(cached.items)) {
    currentPartnerCommissions = cached.items;
    renderPartnerPayments();
    return currentPartnerCommissions;
  }

  renderPartnerPayments('Carregando pagamentos...');
  try {
    const snap = await getDocs(collection(db, 'monetize', monetizeId, 'comissoes'));
    currentPartnerCommissions = snap.docs.map((commissionDoc) => ({
      id: commissionDoc.id,
      ...commissionDoc.data()
    }));
    cachePartnerCommissions(currentPartnerCommissions, monetizeId);
    renderPartnerPayments();
  } catch (error) {
    console.warn('Não foi possível atualizar a lista de comissões:', error);
    if (Array.isArray(cached?.items)) currentPartnerCommissions = cached.items;
    renderPartnerPayments(currentPartnerCommissions.length ? '' : 'Sem dados de pagamentos no momento.');
  }

  return currentPartnerCommissions;
}

function getPartnerSocialsInput() {
  return String(els.inputPartnerSocials?.value || '').trim().slice(0, 600);
}

function formatMoneyInputBR(value) {
  const n = toMoneyNumber(value);
  if (!Number.isFinite(n) || n <= 0) return '';
  return n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function setPartnerModalVisible(isVisible) {
  els.modalPartner?.classList.toggle('hidden', !isVisible);
  els.modalPartner?.classList.toggle('flex', isVisible);

  if (isVisible && els.inputPartnerSocials) {
    renderPartnerPlanLists();
    loadPartnerPlans(false).catch(() => {});
    els.inputPartnerSocials.value = String(
      currentMonetizeData?.redesSociais ||
      currentMonetizeData?.redes ||
      currentProfileData?.redesSociaisParceiro ||
      ''
    ).slice(0, 600);
  }
}

function buildPartnerReferralLink() {
  const ref = encodeURIComponent(String(currentUserProfileId || auth.currentUser?.uid || '').trim());
  return `${window.location.origin}/?ref=${ref}`;
}

function isAcceptedPartner(profile = currentProfileData, monetize = currentMonetizeData) {
  return profile?.parceiro === true || monetize?.parceiro === true;
}

function getPartnerType(profile = currentProfileData, monetize = currentMonetizeData) {
  const rawType = String(
    monetize?.tipoParceiro ||
    monetize?.tipo ||
    ''
  ).trim().toLowerCase();

  if (rawType === 'verificado' || monetize?.verificado === true) {
    return 'verificado';
  }

  return 'normal';
}

function renderPartnerWithdrawStatus(monetize = currentMonetizeData) {
  if (!els.partnerWithdrawStatus) return;

  const saque = monetize?.saque || {};
  const hasPendingWithdraw = saque?.status === 'pendente' || monetize?.saquePendente === true;

  if (!hasPendingWithdraw) {
    els.partnerWithdrawStatus.textContent = '';
    els.partnerWithdrawStatus.classList.add('hidden');
    return;
  }

  const amount = toMoneyNumber(saque?.valor || monetize?.valorSaqueSolicitado || monetize?.saldoAtual || 0);
  els.partnerWithdrawStatus.textContent = `Saque pendente de análise: ${formatCurrencyBR(amount)}. O saldo só deve ser baixado pela equipe/admin após o pagamento.`;
  els.partnerWithdrawStatus.classList.remove('hidden');
}

function renderPartnerState(profile = currentProfileData, monetize = currentMonetizeData) {
  const accepted = isAcceptedPartner(profile, monetize);

  els.partnerEntryCard?.classList.toggle('hidden', accepted);
  els.partnerPanelCard?.classList.toggle('hidden', !accepted);

  if (!accepted) return;

  const type = getPartnerType(profile, monetize);
  const isVerified = type === 'verificado';
  const saldoAtual = toMoneyNumber(monetize?.saldoAtual ?? monetize?.saldoDisponivel ?? 0);
  const saldoSacado = toMoneyNumber(monetize?.saldoSacado ?? monetize?.totalSacado ?? 0);
  const convidados = Number(monetize?.totalConvidados ?? monetize?.convidados ?? 0) || 0;
  const pagantes = Number(monetize?.totalPagantes ?? monetize?.pagantes ?? monetize?.convertidos ?? 0) || 0;
  const hasPendingWithdraw = monetize?.saque?.status === 'pendente' || monetize?.saquePendente === true;

  if (els.partnerTypeBadge) {
    els.partnerTypeBadge.textContent = isVerified ? 'Parceiro verificado' : 'Parceiro normal';
    els.partnerTypeBadge.className = isVerified
      ? 'inline-flex items-center rounded-full bg-amber-300 text-amber-950 px-2.5 py-1 text-[10px] font-black uppercase tracking-wider'
      : 'inline-flex items-center rounded-full bg-emerald-400/10 text-emerald-200 ring-1 ring-emerald-300/20 px-2.5 py-1 text-[10px] font-black uppercase tracking-wider';
  }

  if (els.partnerTypeDescription) {
    els.partnerTypeDescription.textContent = isVerified
      ? 'Você recebe comissão e mantém os recursos pagos liberados enquanto a plataforma considerar sua performance boa.'
      : 'Você recebe comissão por usuários indicados que assinarem um plano pago.';
  }

  if (els.partnerCurrentBalance) els.partnerCurrentBalance.textContent = formatCurrencyBR(saldoAtual);
  if (els.partnerWithdrawnBalance) els.partnerWithdrawnBalance.textContent = formatCurrencyBR(saldoSacado);
  if (els.partnerInvitedCount) els.partnerInvitedCount.textContent = String(convidados);
  if (els.partnerPaidCount) els.partnerPaidCount.textContent = String(pagantes);
  if (els.partnerRefLink) els.partnerRefLink.value = monetize?.linkIndicacao || buildPartnerReferralLink();
  if (els.inputPartnerPix) els.inputPartnerPix.value = monetize?.pix || '';
  if (els.inputPartnerWithdrawAmount && !String(els.inputPartnerWithdrawAmount.value || '').trim()) {
    els.inputPartnerWithdrawAmount.value = saldoAtual >= 10 ? formatMoneyInputBR(saldoAtual) : '';
  }

  if (els.btnRequestPartnerWithdraw) {
    els.btnRequestPartnerWithdraw.disabled = saldoAtual < 10 || hasPendingWithdraw;
  }

  renderPartnerWithdrawStatus(monetize);
  renderPartnerPlanLists();
  renderPartnerPayments();

  els.partnerPanelBody?.classList.toggle('hidden', isPartnerPanelCollapsed);
  if (els.btnTogglePartnerPanel) {
    els.btnTogglePartnerPanel.innerHTML = isPartnerPanelCollapsed
      ? '<i data-lucide="eye" class="w-4 h-4"></i> Mostrar painel'
      : '<i data-lucide="eye-off" class="w-4 h-4"></i> Ocultar painel';
  }

  initIcons();
}

async function getMonetizeDocData() {
  if (!currentUserProfileId) return null;
  const candidates = [
    currentMonetizeData?.id,
    currentProfileData?.monetizeId,
    currentUserProfileId
  ].map((value) => String(value || '').trim()).filter(Boolean);

  for (const id of [...new Set(candidates)]) {
    const snap = await getDoc(doc(db, 'monetize', id));
    if (snap.exists()) return { id: snap.id, ...snap.data() };
  }
  return null;
}

function buildPartnerDocPayload(profile = currentProfileData, existing = currentMonetizeData) {
  const uid = auth.currentUser?.uid || '';
  const email = auth.currentUser?.email || profile?.email || '';
  const redesSociais = getPartnerSocialsInput() || String(existing?.redesSociais || existing?.redes || '').trim().slice(0, 600);

  // Importante: este payload é seguro para o front-end.
  // Saldo, convidados, pagantes, comissões, verificação e benefícios NÃO são gravados pelo navegador.
  return {
    uid,
    email,
    userId: currentUserProfileId,
    gameId: currentUserProfileId,
    nick: String(els.inputNick?.value || profile?.nick || '').trim(),
    parceiro: true,
    pix: existing?.pix || '',
    redesSociais,
    linkIndicacao: existing?.linkIndicacao || buildPartnerReferralLink(),
    createdAt: existing?.createdAt || serverTimestamp(),
    updatedAt: serverTimestamp()
  };
}

async function loadPartnerData(profile = currentProfileData, force = false) {
  if (!currentUserProfileId) return;

  const cachedState = hydratePartnerExperienceFromCache(profile);
  if (!force && cachedState.dataFresh) {
    loadPartnerPlans(false).catch(() => {});
    if (isAcceptedPartner(profile, currentMonetizeData)) loadPartnerCommissions(false).catch(() => {});
  }

  try {
    const freshMonetizeData = await getMonetizeDocData();
    if (freshMonetizeData) currentMonetizeData = freshMonetizeData;

    if (profile?.parceiro === true && !currentMonetizeData) {
      const payload = buildPartnerDocPayload(profile, null);
      await setDoc(doc(db, 'monetize', currentUserProfileId), payload, { merge: true });
      currentMonetizeData = await getMonetizeDocData();
    }
    if (currentMonetizeData) cachePartnerData(currentMonetizeData);
  } catch (error) {
    console.error('Erro ao carregar monetização:', error);
  }

  renderPartnerState(profile, currentMonetizeData);
  loadPartnerPlans(false).catch(() => {});
  if (isAcceptedPartner(profile, currentMonetizeData)) loadPartnerCommissions(false).catch(() => {});
}

async function handleAcceptPartner() {
  if (!currentUserProfileId) {
    showToast('error', 'Perfil não encontrado.');
    return;
  }

  const partnerSocials = getPartnerSocialsInput();
  if (partnerSocials && !validarTextoPermitido(partnerSocials, 'As redes sociais')) return;

  const originalHtml = els.btnAcceptPartner?.innerHTML || '';
  if (els.btnAcceptPartner) {
    els.btnAcceptPartner.disabled = true;
    els.btnAcceptPartner.innerHTML = '<i data-lucide="loader-2" class="w-4 h-4 animate-spin"></i> Ativando...';
    initIcons();
  }

  try {
    const userPayload = {
      parceiro: true,
      monetizeId: currentUserProfileId,
      redesSociaisParceiro: partnerSocials,
      updatedAt: serverTimestamp()
    };

    await setDoc(doc(db, 'users', currentUserProfileId), userPayload, { merge: true });
    await setDoc(doc(db, 'users', auth.currentUser.uid), userPayload, { merge: true });

    currentProfileData = {
      ...(currentProfileData || {}),
      ...userPayload,
      id: currentUserProfileId
    };

    const partnerPayload = buildPartnerDocPayload(currentProfileData, currentMonetizeData);
    await setDoc(doc(db, 'monetize', currentUserProfileId), partnerPayload, { merge: true });

    currentMonetizeData = await getMonetizeDocData();
    cachePartnerData(currentMonetizeData);
    setPartnerModalVisible(false);
    renderPartnerState(currentProfileData, currentMonetizeData);
    loadPartnerCommissions(true).catch(() => {});
    showToast('success', 'Programa de parceiros ativado.');
  } catch (error) {
    console.error(error);
    showToast('error', 'Não foi possível ativar o programa de parceiros.');
  } finally {
    if (els.btnAcceptPartner) {
      els.btnAcceptPartner.disabled = false;
      els.btnAcceptPartner.innerHTML = originalHtml || '<i data-lucide="check-circle" class="w-4 h-4"></i> Aceitar e ativar';
      initIcons();
    }
  }
}

async function handleDeclinePartner() {
  if (!currentUserProfileId) {
    setPartnerModalVisible(false);
    return;
  }

  try {
    const payload = {
      parceiro: false,
      updatedAt: serverTimestamp()
    };

    await setDoc(doc(db, 'users', currentUserProfileId), payload, { merge: true });
    await setDoc(doc(db, 'users', auth.currentUser.uid), payload, { merge: true });

    currentProfileData = {
      ...(currentProfileData || {}),
      ...payload
    };

    setPartnerModalVisible(false);
    renderPartnerState(currentProfileData, currentMonetizeData);
    showToast('info', 'Sem problema. Você pode aceitar depois.');
  } catch (error) {
    console.error(error);
    showToast('error', 'Não foi possível salvar sua escolha.');
  }
}

async function handleSavePartnerPix() {
  if (!isAcceptedPartner()) {
    showToast('error', 'Ative o programa de parceiros primeiro.');
    return;
  }

  const pix = String(els.inputPartnerPix?.value || '').trim();
  if (pix.length < 4) {
    showToast('error', 'Informe uma chave Pix válida.');
    return;
  }

  const originalHtml = els.btnSavePartnerPix?.innerHTML || '';
  if (els.btnSavePartnerPix) {
    els.btnSavePartnerPix.disabled = true;
    els.btnSavePartnerPix.innerHTML = '<i data-lucide="loader-2" class="w-4 h-4 animate-spin"></i> Salvando...';
    initIcons();
  }

  try {
    const monetizeDocId = String(currentMonetizeData?.id || currentProfileData?.monetizeId || currentUserProfileId);
    await setDoc(doc(db, 'monetize', monetizeDocId), {
      pix,
      updatedAt: serverTimestamp()
    }, { merge: true });

    currentMonetizeData = {
      ...(currentMonetizeData || {}),
      pix
    };
    cachePartnerData(currentMonetizeData);

    showToast('success', 'Pix salvo com sucesso.');
  } catch (error) {
    console.error(error);
    showToast('error', 'Não foi possível salvar o Pix.');
  } finally {
    if (els.btnSavePartnerPix) {
      els.btnSavePartnerPix.disabled = false;
      els.btnSavePartnerPix.innerHTML = originalHtml || '<i data-lucide="save" class="w-4 h-4"></i> Salvar Pix';
      initIcons();
    }
  }
}

async function handleRequestPartnerWithdraw() {
  if (!isAcceptedPartner()) {
    showToast('error', 'Ative o programa de parceiros primeiro.');
    return;
  }

  const saldoAtual = toMoneyNumber(currentMonetizeData?.saldoAtual ?? currentMonetizeData?.saldoDisponivel ?? 0);
  const pix = String(els.inputPartnerPix?.value || currentMonetizeData?.pix || '').trim();
  const amount = toMoneyNumber(els.inputPartnerWithdrawAmount?.value || 0);
  const hasPendingWithdraw = currentMonetizeData?.saque?.status === 'pendente' || currentMonetizeData?.saquePendente === true;

  if (saldoAtual < 10) {
    showToast('error', 'O saque mínimo é de R$ 10,00.');
    return;
  }

  if (!Number.isFinite(amount) || amount <= 0) {
    showToast('error', 'Informe o valor que deseja sacar.');
    return;
  }

  if (amount < 10) {
    showToast('error', 'O valor mínimo de saque é R$ 10,00.');
    return;
  }

  if (amount > saldoAtual) {
    showToast('error', 'O valor solicitado não pode ser maior que seu saldo disponível.');
    return;
  }

  if (pix.length < 4) {
    showToast('error', 'Informe uma chave Pix antes de solicitar o saque.');
    return;
  }

  if (hasPendingWithdraw) {
    showToast('info', 'Você já tem um saque pendente.');
    return;
  }

  const originalHtml = els.btnRequestPartnerWithdraw?.innerHTML || '';
  if (els.btnRequestPartnerWithdraw) {
    els.btnRequestPartnerWithdraw.disabled = true;
    els.btnRequestPartnerWithdraw.innerHTML = '<i data-lucide="loader-2" class="w-4 h-4 animate-spin"></i> Solicitando...';
    initIcons();
  }

  try {
    const idToken = await auth.currentUser.getIdToken(true);
    const res = await fetch('/api/monetize_request_withdraw', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${idToken}`
      },
      body: JSON.stringify({
        userId: currentUserProfileId,
        amount,
        pix
      })
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok || data?.ok === false) {
      throw new Error(data?.error || 'Não foi possível solicitar o saque.');
    }

    currentMonetizeData = {
      ...(currentMonetizeData || {}),
      ...(data.monetize || {}),
      pix,
      saque: data.saque || { status: 'pendente', valor: amount, pix, solicitadoEm: new Date() },
      saquePendente: true,
      valorSaqueSolicitado: amount
    };

    cachePartnerData(currentMonetizeData);
    renderPartnerState(currentProfileData, currentMonetizeData);
    showToast('success', 'Saque solicitado. Aguarde a análise da equipe.');
  } catch (error) {
    console.error(error);
    showToast('error', error?.message || 'Não foi possível solicitar o saque.');
  } finally {
    if (els.btnRequestPartnerWithdraw) {
      els.btnRequestPartnerWithdraw.innerHTML = originalHtml || '<i data-lucide="wallet" class="w-4 h-4"></i> Solicitar saque';
      initIcons();
    }
  }
}

async function handleCopyPartnerLink() {
  const link = els.partnerRefLink?.value || buildPartnerReferralLink();

  try {
    await navigator.clipboard.writeText(link);
    showToast('success', 'Link copiado.');
  } catch (_) {
    els.partnerRefLink?.select();
    document.execCommand('copy');
    showToast('success', 'Link copiado.');
  }
}

// --- Lógica Principal ---
async function loadProfile() {
  const uid = auth.currentUser.uid;
  const email = auth.currentUser.email || '';
  
  try {
    const { authDoc, profiles } = await findProfilesForCurrentUser(uid, email);

    let gameProfileDoc = profiles.find(p =>
      isNumericDocId(p.id) &&
      profileBelongsToCurrentUser(p, uid, email)
    );

    const oldAuthDocData = authDoc && !isNumericDocId(authDoc.id)
      ? authDoc
      : null;

    if (gameProfileDoc) {
      currentUserProfileId = gameProfileDoc.id;

      const patch = {};

      if (!gameProfileDoc.uid) patch.uid = uid;
      if (!gameProfileDoc.email && email) patch.email = email;
      if (!gameProfileDoc.id) patch.id = gameProfileDoc.id;

      if (Object.keys(patch).length > 0) {
        await setDoc(doc(db, 'users', gameProfileDoc.id), {
          ...patch,
          updatedAt: serverTimestamp()
        }, { merge: true });

        gameProfileDoc = {
          ...gameProfileDoc,
          ...patch
        };
      }

      await setDoc(doc(db, 'users', uid), buildBridgePayload(gameProfileDoc, oldAuthDocData || {}), { merge: true });

      fillProfileForm(gameProfileDoc);
      setLoadingVisible(false);
      setCreateModalVisible(false);
      setMainFormVisible(true);
      initIcons();
      hydratePartnerExperienceFromCache(gameProfileDoc);
      loadPartnerData(gameProfileDoc).catch((error) => {
        console.warn('A monetização continuará com os dados salvos:', error);
      });
      return;
    }

    // Não existe perfil oficial numérico confiável para este usuário.
    // Guarda os dados antigos, se existirem, para criação/migração no submit.
    els.formCreate.dataset.oldData = JSON.stringify(oldAuthDocData || {});

    setLoadingVisible(false);
    setMainFormVisible(false);
    setCreateModalVisible(true);
    initIcons();
  } catch (error) {
    console.error(error);
    showToast('error', 'Erro ao carregar os dados do perfil.');
    setLoadingVisible(false);
  }
}

function fillProfileForm(data) {
  const ctx = getProfileAccessContext();
  
  const actualGuildName = ctx.guildName || data.guilda || 'Sem guilda';
  const actualRole = ctx.role || data.role || 'Membro';
  currentProfileData = {
    ...(data || {}),
    guildId: ctx.guildId || data.guildId || '',
    guilda: actualGuildName,
    role: actualRole
  };

  els.inputNick.value = data.nick || '';
  els.inputBio.value = data.cat || data.bio || '';
  els.bioCounter.textContent = `${els.inputBio.value.length}/100`;
  
  currentPersistedPhoto = String(data.foto || '').trim();
  pendingProfilePhotoDataUrl = '';
  setPhotoUI(currentPersistedPhoto);
  try {
    cacheSidebarProfile({
      ...(data || {}),
      id: data.id || currentUserProfileId,
      email: data.email || auth.currentUser?.email || '',
      foto: data.foto || '',
      cat: data.cat || data.bio || '',
      guildId: data.guildId || ctx.guildId || '',
      guilda: actualGuildName,
      role: actualRole
    }, auth.currentUser);
    applyCachedSidebarProfile(auth.currentUser);
  } catch (_) {}

  els.viewGameId.value = data.id || currentUserProfileId || '--';
  els.viewUid.value = data.uid || '--';
  els.viewEmail.value = data.email || auth.currentUser.email || '--';
  els.viewGuild.value = actualGuildName;
  
  els.viewRole.textContent = actualRole;
  els.viewRole.className = `inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-black uppercase tracking-wide ${getRoleStyle(actualRole)}`;
  
  els.viewCreated.textContent = formatDateBR(data.createdAt || data.criadoEm || data.created_at || data.created);
}

// Lógica de Criar/Migrar
async function handleCreateProfile(e) {
  e.preventDefault();
  
  const uid = auth.currentUser.uid;
  const email = auth.currentUser.email || '';
  const rawId = els.inputNewGameId.value;
  const gameId = normalizeDigits(rawId);
  
  if (!gameId) {
    showToast('error', 'Digite um ID válido contendo apenas números.');
    return;
  }

  els.btnConfirm.disabled = true;
  els.btnConfirm.innerHTML = `<i data-lucide="loader-2" class="w-4 h-4 animate-spin"></i> Criando...`;
  initIcons();

  try {
    const existingRef = doc(db, 'users', gameId);
    const checkSnap = await getDoc(existingRef);
    const existingData = checkSnap.exists() ? checkSnap.data() : null;

    if (existingData && !profileBelongsToCurrentUser(existingData, uid, email)) {
      showToast('error', 'Esse ID de jogo já está vinculado a outro perfil.');
      resetCreateBtn();
      return;
    }

    const emailConflicts = await findEmailConflictsForProfileCreation(uid, email, gameId);
    if (emailConflicts.length) {
      showToast('error', 'Esse e-mail já está vinculado a outro perfil.');
      resetCreateBtn();
      return;
    }

    const oldData = getOldDataFromModal();
    const ctx = getProfileAccessContext();
    const baseData = {
      ...oldData,
      ...(existingData || {})
    };

    const payload = {
      ...baseData,

      id: gameId,
      uid,
      email: email || baseData.email || '',

      guildId: ctx.guildId || baseData.guildId || '',
      guilda: ctx.guildName || baseData.guilda || '',
      role: ctx.role || baseData.role || 'Membro',

      nick: baseData.nick || '',
      foto: baseData.foto || '',
      cat: baseData.cat || baseData.bio || '',

      createdAt: baseData.createdAt || serverTimestamp(),
      updatedAt: serverTimestamp()
    };

    await setDoc(existingRef, payload, { merge: true });

    await setDoc(doc(db, 'users', uid), {
      ...payload,
      gameIdMigrated: gameId
    }, { merge: true });

    currentUserProfileId = gameId;

    showToast('success', existingData ? 'Perfil migrado com sucesso!' : 'Perfil criado com sucesso!');

    setCreateModalVisible(false);
    setLoadingVisible(false);
    setMainFormVisible(true);

    fillProfileForm(payload);
    currentMonetizeData = null;
    renderPartnerState(payload, null);
    initIcons();
  } catch (error) {
    console.error(error);
    showToast('error', 'Não foi possível criar ou migrar o perfil.');
    resetCreateBtn();
  }
}

// Lógica de Salvar Edição
async function handleSaveProfile(e) {
  e.preventDefault();
  
  if (!currentUserProfileId) {
    showToast('error', 'Perfil não encontrado.');
    return;
  }

  const nick = String(els.inputNick.value || '').trim();
  const bio = String(els.inputBio.value || '').trim().slice(0, 100);

  if (!nick) {
    showToast('error', 'O Nick/Nome não pode ficar em branco.');
    return;
  }

  if (!validarTextoPermitido(nick, 'O Nick/Nome')) return;
  if (!validarTextoPermitido(bio, 'A Bio do jogador')) return;

  els.btnSave.disabled = true;
  els.btnSave.innerHTML = `<i data-lucide="loader-2" class="w-4 h-4 animate-spin"></i> Salvando...`;
  initIcons();

  let uploadedPhotoUrl = '';
  let profileCommitted = false;
  const oldPhotoBeforeSave = currentPersistedPhoto;

  try {
    const photoUrl = pendingProfilePhotoDataUrl
      ? await uploadPendingProfilePhoto()
      : (currentPersistedPhoto || currentBase64Photo || '');
    if (pendingProfilePhotoDataUrl) uploadedPhotoUrl = photoUrl;

    const payload = {
      nick,
      cat: bio,
      updatedAt: serverTimestamp()
    };
    if (!isLegacyBase64Photo(photoUrl)) payload.foto = photoUrl;

    const batch = writeBatch(db);
    batch.set(doc(db, 'users', currentUserProfileId), payload, { merge: true });
    batch.set(doc(db, 'users', auth.currentUser.uid), payload, { merge: true });
    await batch.commit();
    profileCommitted = true;

    currentPersistedPhoto = photoUrl;
    pendingProfilePhotoDataUrl = '';
    setPhotoUI(photoUrl);

    currentProfileData = {
      ...(currentProfileData || {}),
      id: currentUserProfileId,
      email: auth.currentUser?.email || currentProfileData?.email || '',
      ...payload
    };
    try {
      cacheSidebarProfile(currentProfileData, auth.currentUser);
      applyCachedSidebarProfile(auth.currentUser);
    } catch (_) {}

    if (uploadedPhotoUrl && oldPhotoBeforeSave && oldPhotoBeforeSave !== uploadedPhotoUrl) {
      deleteProfilePhoto(oldPhotoBeforeSave).catch((error) => {
        console.warn('A foto antiga não pôde ser removida do R2:', error);
      });
    }

    if (isAcceptedPartner(currentProfileData, currentMonetizeData)) {
      try {
        const monetizeDocId = String(currentMonetizeData?.id || currentProfileData?.monetizeId || currentUserProfileId);
        await setDoc(doc(db, 'monetize', monetizeDocId), {
          nick,
          updatedAt: serverTimestamp()
        }, { merge: true });
        currentMonetizeData = {
          ...(currentMonetizeData || {}),
          nick
        };
        cachePartnerData(currentMonetizeData);
      } catch (error) {
        console.warn('O perfil foi salvo, mas o nome do parceiro não foi sincronizado:', error);
      }
    }

    showToast('success', 'Perfil atualizado com sucesso!');
  } catch (error) {
    console.error(error);
    if (uploadedPhotoUrl && !profileCommitted) {
      deleteProfilePhoto(uploadedPhotoUrl).catch(() => {});
    }
    showToast('error', 'Erro ao salvar alterações.');
  } finally {
    els.btnSave.disabled = false;
    els.btnSave.innerHTML = `<i data-lucide="save" class="w-4 h-4"></i><span class="hidden sm:inline">Salvar alterações</span><span class="sm:hidden">Salvar</span>`;
    initIcons();
  }
}

function cropPointerPosition(event) {
  const rect = els.cropCanvas?.getBoundingClientRect();
  if (!rect || !els.cropCanvas) return { x: 0, y: 0 };
  return {
    x: (event.clientX - rect.left) * (els.cropCanvas.width / Math.max(1, rect.width)),
    y: (event.clientY - rect.top) * (els.cropCanvas.height / Math.max(1, rect.height))
  };
}

function resetPhotoCrop() {
  if (!cropState) return;
  cropState.zoom = 1;
  cropState.offsetX = 0;
  cropState.offsetY = 0;
  if (els.cropZoom) els.cropZoom.value = '1';
  renderPhotoCrop();
}

function confirmPhotoCrop() {
  try {
    pendingProfilePhotoDataUrl = cropCanvasToDataUrl();
    setPhotoUI(pendingProfilePhotoDataUrl);
    setPhotoCropVisible(false);
    showToast('success', 'Foto ajustada. Salve o perfil para concluir.');
  } catch (error) {
    console.error(error);
    showToast('error', error?.message || 'Não foi possível ajustar a foto.');
  }
}

// --- Event Listeners Básicos ---
function bindEvents() {
  qs('btn-logout')?.addEventListener('click', logout);
  setupSidebar();

  els.inputBio.addEventListener('input', () => {
    els.inputBio.value = els.inputBio.value.slice(0, 100);
    els.bioCounter.textContent = `${els.inputBio.value.length}/100`;
  });

  els.inputNewGameId.addEventListener('input', () => {
    els.inputNewGameId.value = normalizeDigits(els.inputNewGameId.value);
  });

  els.inputFoto.addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      await openPhotoCrop(file);
    } catch (err) {
      console.error(err);
      if (els.inputFoto) els.inputFoto.value = '';
      showToast('error', err?.message || 'Não foi possível processar a foto.');
    }
  });

  els.btnUpdateLegacyPhoto?.addEventListener('click', () => els.inputFoto?.click());
  els.btnClosePhotoCrop?.addEventListener('click', () => setPhotoCropVisible(false));
  els.btnCancelPhotoCrop?.addEventListener('click', () => setPhotoCropVisible(false));
  els.btnResetPhotoCrop?.addEventListener('click', resetPhotoCrop);
  els.btnConfirmPhotoCrop?.addEventListener('click', confirmPhotoCrop);

  els.cropZoom?.addEventListener('input', () => {
    if (!cropState) return;
    cropState.zoom = Math.max(1, Math.min(3, Number(els.cropZoom.value) || 1));
    renderPhotoCrop();
  });

  els.cropCanvas?.addEventListener('pointerdown', (event) => {
    if (!cropState) return;
    const point = cropPointerPosition(event);
    cropPointer = {
      id: event.pointerId,
      x: point.x,
      y: point.y,
      offsetX: cropState.offsetX,
      offsetY: cropState.offsetY
    };
    els.cropCanvas.setPointerCapture?.(event.pointerId);
  });

  els.cropCanvas?.addEventListener('pointermove', (event) => {
    if (!cropState || !cropPointer || cropPointer.id !== event.pointerId) return;
    const point = cropPointerPosition(event);
    cropState.offsetX = cropPointer.offsetX + (point.x - cropPointer.x);
    cropState.offsetY = cropPointer.offsetY + (point.y - cropPointer.y);
    renderPhotoCrop();
  });

  const endCropPointer = (event) => {
    if (!cropPointer || cropPointer.id !== event.pointerId) return;
    cropPointer = null;
    try { els.cropCanvas?.releasePointerCapture?.(event.pointerId); } catch (_) {}
  };
  els.cropCanvas?.addEventListener('pointerup', endCropPointer);
  els.cropCanvas?.addEventListener('pointercancel', endCropPointer);

  els.modalPhotoCrop?.addEventListener('click', (event) => {
    if (event.target === els.modalPhotoCrop || event.target === els.modalPhotoCrop.firstElementChild) {
      setPhotoCropVisible(false);
    }
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !els.modalPhotoCrop?.classList.contains('hidden')) {
      setPhotoCropVisible(false);
    }
  });

  els.btnOpenPartnerModal?.addEventListener('click', () => setPartnerModalVisible(true));
  els.btnClosePartnerModal?.addEventListener('click', () => setPartnerModalVisible(false));
  els.btnAcceptPartner?.addEventListener('click', handleAcceptPartner);
  els.btnDeclinePartner?.addEventListener('click', handleDeclinePartner);
  els.btnSavePartnerPix?.addEventListener('click', handleSavePartnerPix);
  els.btnRequestPartnerWithdraw?.addEventListener('click', handleRequestPartnerWithdraw);
  els.btnCopyPartnerLink?.addEventListener('click', handleCopyPartnerLink);

  els.btnTogglePartnerPanel?.addEventListener('click', () => {
    isPartnerPanelCollapsed = !isPartnerPanelCollapsed;
    renderPartnerState(currentProfileData, currentMonetizeData);
  });

  els.inputPartnerPix?.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') event.preventDefault();
  });

  els.inputPartnerWithdrawAmount?.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') event.preventDefault();
  });

  els.inputPartnerWithdrawAmount?.addEventListener('blur', () => {
    const formatted = formatMoneyInputBR(els.inputPartnerWithdrawAmount.value);
    if (formatted) els.inputPartnerWithdrawAmount.value = formatted;
  });

  els.modalPartner?.addEventListener('click', (event) => {
    if (event.target === els.modalPartner) setPartnerModalVisible(false);
  });

  els.formCreate.addEventListener('submit', handleCreateProfile);
  els.formMain.addEventListener('submit', handleSaveProfile);
}

// Inicialização
(async function boot() {
  bindEvents();
  initIcons();

  const user = await waitForProfileAuth();
  if (!user) return;
  
  await loadProfile();
})();
