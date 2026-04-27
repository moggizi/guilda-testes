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
  
  modalCreate: qs('modal-create-profile'),
  formCreate: qs('form-create-profile'),
  inputNewGameId: qs('input-new-gameid'),
  btnConfirm: qs('btn-confirm-creation'),

  sidebarAvatar: qs('sidebar-avatar'),
  sidebarIcon: qs('sidebar-avatar-icon')
};

let currentUserProfileId = null; 
let currentBase64Photo = '';

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

    updatedAt: serverTimestamp()
  };
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
