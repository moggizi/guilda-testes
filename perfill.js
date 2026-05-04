import {
  doc,
  getDoc,
  setDoc,
  collection,
  query,
  where,
  getDocs,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { checkAuth, setupSidebar, initIcons, logout, getGuildContext, showToast, auth, db } from './logic.js';

const qs = (id) => document.getElementById(id);
const normalizeDigits = (v) => String(v ?? '').replace(/\D+/g, '');
const normalizeEmail = (v) => String(v ?? '').trim().toLowerCase();
const isNumericDocId = (id) => /^\d+$/.test(String(id || ''));

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

function validarTextoPermitido(valor, campo) {
  if (!contemPalavraImpropria(valor)) return true;
  showToast('error', `${campo} contém palavra imprópria.`);
  return false;
}


function sameEmail(a, b) {
  const ea = normalizeEmail(a);
  const eb = normalizeEmail(b);
  return !!ea && !!eb && ea === eb;
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
  btnTogglePartnerPanel: qs('btn-toggle-partner-panel'),
  partnerCurrentBalance: qs('partner-current-balance'),
  partnerWithdrawnBalance: qs('partner-withdrawn-balance'),
  partnerInvitedCount: qs('partner-invited-count'),
  partnerPaidCount: qs('partner-paid-count'),
  partnerRefLink: qs('partner-ref-link'),
  btnCopyPartnerLink: qs('btn-copy-partner-link'),
  inputPartnerPix: qs('input-partner-pix'),
  btnSavePartnerPix: qs('btn-save-partner-pix'),
  btnRequestPartnerWithdraw: qs('btn-request-partner-withdraw'),
  partnerWithdrawStatus: qs('partner-withdraw-status'),
  
  modalCreate: qs('modal-create-profile'),
  formCreate: qs('form-create-profile'),
  inputNewGameId: qs('input-new-gameid'),
  btnConfirm: qs('btn-confirm-creation'),

  sidebarAvatar: qs('sidebar-avatar'),
  sidebarIcon: qs('sidebar-avatar-icon')
};

let currentUserProfileId = null; 
let currentBase64Photo = '';
let currentProfileData = null;
let currentMonetizeData = null;
let isPartnerPanelCollapsed = false;

// --- Helpers de Imagem (Compressão < 1MB) ---
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
    const byteSize = dataUrlSizeBytes(output);
    if (byteSize <= maxBytes) return output;
    
    quality -= 0.1;
    attempts += 1;
  }

  return output;
}

// --- Funções de UI ---
function setPhotoUI(base64Str) {
  currentBase64Photo = base64Str || '';

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
}

function setCreateModalVisible(isVisible) {
  els.modalCreate?.classList.toggle('hidden', !isVisible);
  els.modalCreate?.classList.toggle('flex', isVisible);
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

  return {
    uid,
    email: email || gameProfileDoc.email || oldAuthDocData.email || '',
    id: gameProfileDoc.id,
    gameIdMigrated: gameProfileDoc.id,

    nick: gameProfileDoc.nick || oldAuthDocData.nick || '',
    foto: gameProfileDoc.foto || oldAuthDocData.foto || '',
    cat: gameProfileDoc.cat || gameProfileDoc.bio || oldAuthDocData.cat || oldAuthDocData.bio || '',

    guildId: gameProfileDoc.guildId || oldAuthDocData.guildId || '',
    guilda: gameProfileDoc.guilda || oldAuthDocData.guilda || '',
    role: gameProfileDoc.role || oldAuthDocData.role || 'Membro',

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

function setPartnerModalVisible(isVisible) {
  els.modalPartner?.classList.toggle('hidden', !isVisible);
  els.modalPartner?.classList.toggle('flex', isVisible);
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
    profile?.parceiroTipo ||
    profile?.partnerType ||
    ''
  ).trim().toLowerCase();

  if (rawType === 'verificado' || monetize?.verificado === true || profile?.parceiroVerificado === true) {
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

  if (els.btnRequestPartnerWithdraw) {
    els.btnRequestPartnerWithdraw.disabled = saldoAtual < 10 || hasPendingWithdraw;
  }

  renderPartnerWithdrawStatus(monetize);

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
  const snap = await getDoc(doc(db, 'monetize', currentUserProfileId));
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

function buildPartnerDocPayload(profile = currentProfileData, existing = currentMonetizeData) {
  const uid = auth.currentUser?.uid || '';
  const email = auth.currentUser?.email || profile?.email || '';
  const type = getPartnerType(profile, existing);
  const isVerified = type === 'verificado';

  return {
    uid,
    email,
    userId: currentUserProfileId,
    gameId: currentUserProfileId,
    nick: String(els.inputNick?.value || profile?.nick || '').trim(),
    parceiro: true,
    tipoParceiro: type,
    verificado: isVerified,
    beneficiosLiberados: existing?.beneficiosLiberados === true || isVerified,

    comissaoPercentual: 20,
    comissaoVitalicio: 40,
    saldoAtual: toMoneyNumber(existing?.saldoAtual ?? existing?.saldoDisponivel ?? 0),
    saldoSacado: toMoneyNumber(existing?.saldoSacado ?? existing?.totalSacado ?? 0),
    totalConvidados: Number(existing?.totalConvidados ?? existing?.convidados ?? 0) || 0,
    totalPagantes: Number(existing?.totalPagantes ?? existing?.pagantes ?? existing?.convertidos ?? 0) || 0,
    pix: existing?.pix || '',
    linkIndicacao: existing?.linkIndicacao || buildPartnerReferralLink(),
    createdAt: existing?.createdAt || serverTimestamp(),
    updatedAt: serverTimestamp()
  };
}

async function loadPartnerData(profile = currentProfileData) {
  if (!currentUserProfileId) return;

  try {
    currentMonetizeData = await getMonetizeDocData();

    if (profile?.parceiro === true && !currentMonetizeData) {
      const payload = buildPartnerDocPayload(profile, null);
      await setDoc(doc(db, 'monetize', currentUserProfileId), payload, { merge: true });
      currentMonetizeData = await getMonetizeDocData();
    }
  } catch (error) {
    console.error('Erro ao carregar monetização:', error);
    currentMonetizeData = null;
  }

  renderPartnerState(profile, currentMonetizeData);
}

async function handleAcceptPartner() {
  if (!currentUserProfileId) {
    showToast('error', 'Perfil não encontrado.');
    return;
  }

  const originalHtml = els.btnAcceptPartner?.innerHTML || '';
  if (els.btnAcceptPartner) {
    els.btnAcceptPartner.disabled = true;
    els.btnAcceptPartner.innerHTML = '<i data-lucide="loader-2" class="w-4 h-4 animate-spin"></i> Ativando...';
    initIcons();
  }

  try {
    const userPayload = {
      parceiro: true,
      parceiroTipo: getPartnerType(currentProfileData, currentMonetizeData),
      parceiroVerificado: getPartnerType(currentProfileData, currentMonetizeData) === 'verificado',
      monetizeId: currentUserProfileId,
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
    setPartnerModalVisible(false);
    renderPartnerState(currentProfileData, currentMonetizeData);
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
    await setDoc(doc(db, 'monetize', currentUserProfileId), {
      pix,
      updatedAt: serverTimestamp()
    }, { merge: true });

    currentMonetizeData = {
      ...(currentMonetizeData || {}),
      pix
    };

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
  const hasPendingWithdraw = currentMonetizeData?.saque?.status === 'pendente' || currentMonetizeData?.saquePendente === true;

  if (saldoAtual < 10) {
    showToast('error', 'O saque mínimo é de R$ 10,00.');
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
    const saque = {
      status: 'pendente',
      valor: saldoAtual,
      pix,
      solicitadoEm: serverTimestamp()
    };

    await setDoc(doc(db, 'monetize', currentUserProfileId), {
      pix,
      saque,
      saquePendente: true,
      valorSaqueSolicitado: saldoAtual,
      updatedAt: serverTimestamp()
    }, { merge: true });

    currentMonetizeData = {
      ...(currentMonetizeData || {}),
      pix,
      saque: { ...saque, solicitadoEm: new Date() },
      saquePendente: true,
      valorSaqueSolicitado: saldoAtual
    };

    renderPartnerState(currentProfileData, currentMonetizeData);
    showToast('success', 'Saque solicitado. Aguarde a análise da equipe.');
  } catch (error) {
    console.error(error);
    showToast('error', 'Não foi possível solicitar o saque.');
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
      await loadPartnerData(gameProfileDoc);

      setLoadingVisible(false);
      setCreateModalVisible(false);
      setMainFormVisible(true);
      initIcons();
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
  currentProfileData = { ...(data || {}) };
  const ctx = getGuildContext() || {};
  
  const actualGuildName = ctx.guildName || data.guilda || 'Sem guilda';
  const actualRole = ctx.role || data.role || 'Membro';

  els.inputNick.value = data.nick || '';
  els.inputBio.value = data.cat || data.bio || '';
  els.bioCounter.textContent = `${els.inputBio.value.length}/100`;
  
  setPhotoUI(data.foto || '');

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
    const ctx = getGuildContext() || {};
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

  try {
    const payload = {
      nick,
      cat: bio,
      foto: currentBase64Photo,
      updatedAt: serverTimestamp()
    };

    await setDoc(doc(db, 'users', currentUserProfileId), payload, { merge: true });
    await setDoc(doc(db, 'users', auth.currentUser.uid), payload, { merge: true });

    currentProfileData = {
      ...(currentProfileData || {}),
      ...payload
    };

    if (isAcceptedPartner(currentProfileData, currentMonetizeData)) {
      await setDoc(doc(db, 'monetize', currentUserProfileId), {
        nick,
        updatedAt: serverTimestamp()
      }, { merge: true });

      currentMonetizeData = {
        ...(currentMonetizeData || {}),
        nick
      };
    }

    showToast('success', 'Perfil atualizado com sucesso!');
  } catch (error) {
    console.error(error);
    showToast('error', 'Erro ao salvar alterações.');
  } finally {
    els.btnSave.disabled = false;
    els.btnSave.innerHTML = `<i data-lucide="save" class="w-4 h-4"></i> Salvar Alterações`;
    initIcons();
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
      showToast('info', 'Processando imagem...');
      const base64 = await compressImageToBase64(file, 900 * 1024);
      setPhotoUI(base64);
      showToast('success', 'Foto pronta para salvar!');
    } catch (err) {
      console.error(err);
      showToast('error', 'Não foi possível processar a foto.');
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

  const user = await checkAuth(true);
  if (!user) return;
  
  await loadProfile();
})();
