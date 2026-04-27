import {
  getFirestore,
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

async function compressImageToBase64(file, maxBytes = 900 * 1024) {
  const img = await loadImageFromFile(file);
  let width = img.width || 0;
  let height = img.height || 0;
  const maxDim = 800; // Reduzindo proporção pra perfil (geralmente foto quadrada pequena)
  
  if (width > maxDim || height > maxDim) {
    const scale = Math.min(maxDim / width, maxDim / height);
    width = Math.max(1, Math.round(width * scale));
    height = Math.max(1, Math.round(height * scale));
  }
  
  const canvas = document.createElement('canvas');
  // Cortar quadrado perfeito para perfil
  const size = Math.min(width, height);
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d', { alpha: false });
  if (!ctx) throw new Error('Canvas indisponível.');
  
  let quality = 0.88, output = '', attempts = 0;
  
  while (attempts < 12) {
    ctx.clearRect(0, 0, size, size);
    // Centraliza a imagem no quadrado
    const offsetX = (width - size) / 2;
    const offsetY = (height - size) / 2;
    ctx.drawImage(img, offsetX, offsetY, size, size, 0, 0, size, size);
    
    output = canvas.toDataURL('image/jpeg', quality);
    const byteSize = dataUrlSizeBytes(output);
    if (byteSize <= maxBytes) return output;
    
    quality -= 0.1;
    attempts += 1;
  }
  return output; // Retorna o mais comprimido possível
}

// --- Funções de UI ---
function setPhotoUI(base64Str) {
  currentBase64Photo = base64Str || '';
  if (currentBase64Photo) {
    els.preview.src = currentBase64Photo;
    els.preview.classList.remove('hidden');
    els.placeholder.classList.add('hidden');
    if(els.sidebarAvatar && els.sidebarIcon) {
        els.sidebarAvatar.src = currentBase64Photo;
        els.sidebarAvatar.classList.remove('hidden');
        els.sidebarIcon.classList.add('hidden');
    }
  } else {
    els.preview.src = '';
    els.preview.classList.add('hidden');
    els.placeholder.classList.remove('hidden');
  }
}

const formatDateBR = (val) => {
  if (!val) return '--';
  const d = val.toDate ? val.toDate() : new Date(val);
  if (Number.isNaN(d.getTime())) return '--';
  return d.toLocaleDateString('pt-BR');
};

function getRoleStyle(role) {
  const r = String(role || 'Membro').trim().toLowerCase();
  if (r === 'líder' || r === 'lider' || r === 'chefe') return 'bg-amber-100 text-amber-800 ring-1 ring-amber-300';
  if (r === 'admin') return 'bg-fuchsia-100 text-fuchsia-800 ring-1 ring-fuchsia-300';
  return 'bg-slate-100 text-slate-700 ring-1 ring-slate-300';
}

// --- Lógica Principal ---
async function loadProfile() {
  const uid = auth.currentUser.uid;
  
  try {
    // 1. Busca perfis onde uid == auth.uid
    const q = query(collection(db, 'users'), where('uid', '==', uid));
    const snap = await getDocs(q);

    
    let gameProfileDoc = null;
    let oldAuthDocData = null; // Backup das infos antigas caso precise migrar

    snap.docs.forEach(d => {
      // Se o ID do documento for APENAS números, consideramos como perfil migrado (ID do jogo)
      if (/^\d+$/.test(d.id)) {
        gameProfileDoc = { id: d.id, ...d.data() };
      } else {
        // Doc antigo (geralmente tem o mesmo ID do Auth contendo letras)
        if (d.id === uid) {
          oldAuthDocData = d.data();
        }
      }
    });

    if (gameProfileDoc) {
      // PERFIL JÁ EXISTE E ESTÁ MIGRADO
      currentUserProfileId = gameProfileDoc.id;
      fillProfileForm(gameProfileDoc);
      els.loading.classList.add('hidden');
      els.formMain.classList.remove('hidden');
      initIcons();
    } else {
      // NÃO TEM PERFIL NUMÉRICO -> Forçar criação/migração
      els.loading.classList.add('hidden');
      els.modalCreate.classList.remove('hidden');
      els.modalCreate.classList.add('flex');
      
      // Guarda temporariamente os dados antigos no form do modal para usar no submit
      els.formCreate.dataset.oldData = JSON.stringify(oldAuthDocData || {});
      initIcons();
    }
  } catch (error) {
    console.error(error);
    showToast('error', 'Erro ao carregar os dados do perfil.');
  }
}

function fillProfileForm(data) {
  const ctx = getGuildContext() || {};
  
  // O contexto da sessão (logic.js) é a fonte mais atual para Guilda e Role
  const actualGuildName = ctx.guildName || data.guilda || 'Sem guilda';
  const actualRole = ctx.role || data.role || 'Membro';

  els.inputNick.value = data.nick || '';
  els.inputBio.value = data.cat || data.bio || ''; // No seu doc antigo "cat" parecia ser bio
  els.bioCounter.textContent = `${els.inputBio.value.length}/100`;
  
  setPhotoUI(data.foto || '');

  els.viewGameId.value = data.id || currentUserProfileId || '--';
  els.viewUid.value = data.uid || '--';
  els.viewEmail.value = data.email || '--';
  els.viewGuild.value = actualGuildName;
  
  els.viewRole.textContent = actualRole;
  els.viewRole.className = `inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-black uppercase tracking-wide ${getRoleStyle(actualRole)}`;
  
  els.viewCreated.textContent = formatDateBR(data.createdAt);
}

// Lógica de Criar/Migrar
async function handleCreateProfile(e) {
  e.preventDefault();
  
  const rawId = els.inputNewGameId.value;
  const gameId = normalizeDigits(rawId);
  
  if (!gameId) {
    showToast('error', 'Digite um ID válido contendo apenas números.');
    return;
  }

  // Previne duplo clique
  els.btnConfirm.disabled = true;
  els.btnConfirm.innerHTML = `<i data-lucide="loader-2" class="w-4 h-4 animate-spin"></i> Criando...`;
  initIcons();

  try {
    // Verifica se esse GameID já existe na base
    const existingRef = doc(db, 'users', gameId);
    const checkSnap = await getDoc(existingRef);
    if (checkSnap.exists()) {
      showToast('error', 'Esse ID de jogo já está vinculado a outro perfil.');
      resetCreateBtn();
      return;
    }

    // Pega os dados antigos recuperados na hora do load
    const oldData = JSON.parse(els.formCreate.dataset.oldData || '{}');
    const ctx = getGuildContext() || {};
    
    // Constrói payload do novo perfil (mantendo tudo que já tinha, adicionando o ID)
    const payload = {
      ...oldData,
      id: gameId, // Id definitivo
      uid: auth.currentUser.uid, // Mantém a amarração com a autenticação
      email: auth.currentUser.email || oldData.email || '',
      guildId: ctx.guildId || oldData.guildId || '',
      guilda: ctx.guildName || oldData.guilda || '',
      role: ctx.role || oldData.role || 'Membro',
      nick: oldData.nick || '',
      foto: oldData.foto || '',
      cat: oldData.cat || '', // A bio antiga
      createdAt: oldData.createdAt || serverTimestamp(),
      updatedAt: serverTimestamp()
    };

    // Cria o documento oficial
    await setDoc(existingRef, payload);
    
    // Atualiza o documento "antigo" (do Auth UID) para não quebrar o checkAuth do logic.js.
    // Assim logic.js continua achando o guildId e o role na raiz
    await setDoc(doc(db, 'users', auth.currentUser.uid), {
      ...payload,
      gameIdMigrated: gameId // Flag indicando que foi migrado
    }, { merge: true });

    showToast('success', 'Perfil criado com sucesso!');
    
    els.modalCreate.classList.add('hidden');
    els.modalCreate.classList.remove('flex');
    
    // Recarrega a tela para ler o novo doc
    els.loading.classList.remove('hidden');
    await loadProfile();

  } catch (error) {
    console.error(error);
    showToast('error', 'Não foi possível criar o perfil.');
    resetCreateBtn();
  }
}

function resetCreateBtn() {
  els.btnConfirm.disabled = false;
  els.btnConfirm.textContent = 'Criar meu Perfil';
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
      nick: nick,
      cat: bio, // Mantendo o nome de campo "cat" como no seu DB original
      foto: currentBase64Photo,
      updatedAt: serverTimestamp()
    };

    // 1. Salva no documento oficial do perfil numérico
    await setDoc(doc(db, 'users', currentUserProfileId), payload, { merge: true });
    
    // 2. Replica pro doc do Auth UID pro sistema geral ter o nick/foto atualizado
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
