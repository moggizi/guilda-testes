import { initializeApp, deleteApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getFirestore,
  doc,
  getDoc,
  setDoc,
  deleteDoc,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

import { checkAuth, setupSidebar, initIcons, logout, getGuildContext, showToast, auth } from './logic.js';

const firebaseConfig = {
  apiKey: "AIzaSyA6CETOXLO6yp4Gm1JY7fwiWlWo0pKqzqw",
  authDomain: "hub-recruta.firebaseapp.com",
  projectId: "hub-recruta",
  storageBucket: "hub-recruta.firebasestorage.app",
  messagingSenderId: "35668832994",
  appId: "1:35668832994:web:2cbdaa54596e5a54cf24bb",
  measurementId: "G-N182HK85CQ"
};

const secondaryName = `hub_recruta_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
const secondaryApp = initializeApp(firebaseConfig, secondaryName);
const recDb = getFirestore(secondaryApp);

const els = {
  loadBtn: document.getElementById('btn-load-recruitment'),
  reloadBtn: document.getElementById('btn-reload'),
  newBtn: document.getElementById('btn-new-rec'),
  keyInput: document.getElementById('guild-access-key-input'),
  keyStatus: document.getElementById('key-status'),
  currentUid: document.getElementById('current-uid'),
  currentGuildName: document.getElementById('current-guild-name'),
  openedKey: document.getElementById('opened-key'),
  view: document.getElementById('recruitment-view'),
  modal: document.getElementById('rec-modal'),
  modalTitle: document.getElementById('rec-modal-title'),
  form: document.getElementById('rec-form'),
  guildName: document.getElementById('rec-guild-name'),
  desc: document.getElementById('rec-description'),
  descCount: document.getElementById('rec-desc-count')
};

let linkedUid = null;
let openedKey = '';
let currentRecruitment = null;

setupSidebar();
initIcons();

function formatDateBR(value) {
  try {
    const d = value instanceof Date ? value : new Date(value);
    return d.toLocaleDateString('pt-BR') + ' ' + d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  } catch (_) {
    return '-';
  }
}

function escapeHtml(str) {
  return String(str ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function getCheckedValues(name) {
  return [...document.querySelectorAll(`input[name="${name}"]:checked`)].map(el => el.value);
}

function setCheckedValues(name, values = []) {
  const wanted = new Set(values || []);
  document.querySelectorAll(`input[name="${name}"]`).forEach(el => {
    el.checked = wanted.has(el.value);
  });
}

function setStatus(message, type = 'info') {
  const map = {
    info: 'hidden',
    success: 'border-emerald-200 bg-emerald-50 text-emerald-700',
    error: 'border-red-200 bg-red-50 text-red-700',
    warn: 'border-amber-200 bg-amber-50 text-amber-700'
  };

  if (!message) {
    els.keyStatus.className = 'mt-4 hidden rounded-xl border px-4 py-3 text-sm';
    els.keyStatus.textContent = '';
    return;
  }

  els.keyStatus.className = `mt-4 rounded-xl border px-4 py-3 text-sm ${map[type] || map.info}`;
  els.keyStatus.textContent = message;
}

function openModal(mode = 'create') {
  els.form.reset();
  els.descCount.textContent = '0/100';
  els.modalTitle.textContent = mode === 'edit' ? 'Editar recrutamento' : 'Novo recrutamento';

  const ctx = getGuildContext() || {};
  els.guildName.value = currentRecruitment?.guildName || ctx.guildName || '';
  if (mode === 'edit' && currentRecruitment) {
    els.guildName.value = currentRecruitment.guildName || ctx.guildName || '';
    setCheckedValues('roles', currentRecruitment.roles || []);
    setCheckedValues('contacts', currentRecruitment.contacts || []);
    els.desc.value = currentRecruitment.description || '';
    els.descCount.textContent = `${els.desc.value.length}/100`;
  } else {
    setCheckedValues('roles', []);
    setCheckedValues('contacts', []);
  }

  els.modal.classList.remove('hidden');
  initIcons();
}

function closeModal() {
  els.modal.classList.add('hidden');
}

function updateCreateButtonVisibility() {
  if (!linkedUid || currentRecruitment) els.newBtn.classList.add('hidden');
  else els.newBtn.classList.remove('hidden');
}

function renderRecruitment() {
  if (!linkedUid) {
    els.view.innerHTML = `<div class="bg-white rounded-2xl p-10 border border-gray-100 shadow-sm text-center"><p class="text-gray-500 font-medium">Abra uma chave da guilda para ver o recrutamento.</p></div>`;
    updateCreateButtonVisibility();
    initIcons();
    return;
  }

  if (!currentRecruitment) {
    els.view.innerHTML = `
      <div class="bg-white rounded-2xl p-10 border border-gray-100 shadow-sm text-center">
        <div class="w-14 h-14 rounded-2xl bg-gray-50 text-gray-500 flex items-center justify-center mx-auto mb-3"><i data-lucide="search-x" class="w-7 h-7"></i></div>
        <p class="text-gray-800 font-semibold">Não existe recrutamento</p>
        <p class="text-gray-500 text-sm mt-1">Você pode criar um recrutamento para esse UID agora.</p>
      </div>`;
    updateCreateButtonVisibility();
    initIcons();
    return;
  }

  const data = currentRecruitment;
  const roles = Array.isArray(data.roles) && data.roles.length ? data.roles.map(v => `<span class="inline-flex items-center gap-1 rounded-full bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200 px-3 py-1 text-xs font-semibold">${escapeHtml(v)}</span>`).join(' ') : '<span class="text-sm text-gray-400">Nenhuma</span>';
  const contacts = Array.isArray(data.contacts) && data.contacts.length ? data.contacts.map(v => `<span class="inline-flex items-center gap-1 rounded-full bg-gray-100 text-gray-700 ring-1 ring-gray-200 px-3 py-1 text-xs font-semibold">${escapeHtml(v)}</span>`).join(' ') : '<span class="text-sm text-gray-400">Nenhuma</span>';

  els.view.innerHTML = `
    <div class="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
      <div class="p-5 border-b border-gray-100 flex items-start justify-between gap-4">
        <div>
          <div class="flex items-center gap-2 flex-wrap">
            <h4 class="text-xl font-bold text-gray-900">${escapeHtml(data.guildName || 'Sem nome')}</h4>
            <span class="inline-flex items-center rounded-full bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200 px-2.5 py-1 text-[11px] font-extrabold">ATIVO</span>
          </div>
          <p class="text-sm text-gray-500 mt-1">UID vinculado: <span class="font-semibold break-all">${escapeHtml(linkedUid)}</span></p>
          <p class="text-sm text-gray-500 mt-1">Data: ${escapeHtml(formatDateBR(data.dateMs || Date.now()))}</p>
        </div>
        <div class="flex items-center gap-2">
          <button id="btn-edit-rec" class="px-3 py-2 rounded-xl text-sm font-medium text-gray-600 hover:bg-gray-100">Editar</button>
          <button id="btn-delete-rec" class="px-3 py-2 rounded-xl text-sm font-medium text-red-500 hover:bg-red-50">Excluir</button>
        </div>
      </div>
      <div class="p-5 grid md:grid-cols-2 gap-5">
        <div>
          <p class="text-xs font-semibold text-gray-500 mb-2">Funções</p>
          <div class="flex flex-wrap gap-2">${roles}</div>
        </div>
        <div>
          <p class="text-xs font-semibold text-gray-500 mb-2">Outras opções</p>
          <div class="flex flex-wrap gap-2">${contacts}</div>
        </div>
        <div class="md:col-span-2">
          <p class="text-xs font-semibold text-gray-500 mb-2">Descrição</p>
          <div class="rounded-xl bg-gray-50 border border-gray-200 p-4 text-sm text-gray-700 min-h-[84px] whitespace-pre-wrap">${escapeHtml(data.description || 'Sem descrição.')}</div>
        </div>
      </div>
    </div>`;

  updateCreateButtonVisibility();
  document.getElementById('btn-edit-rec')?.addEventListener('click', () => openModal('edit'));
  document.getElementById('btn-delete-rec')?.addEventListener('click', deleteRecruitment);
  initIcons();
}

async function resolveKeyAndLoad(forceMessage = true) {
  const key = (els.keyInput.value || '').trim();
  if (!key) {
    setStatus('Digite a chave da guilda para continuar.', 'warn');
    return;
  }

  const currentUid = auth.currentUser?.uid || '';
  if (!currentUid) {
    showToast('error', 'Sessão inválida. Faça login novamente.');
    return;
  }

  try {
    els.loadBtn.disabled = true;
    const keyRef = doc(recDb, 'chave', key);
    let keySnap = await getDoc(keyRef);

    if (!keySnap.exists()) {
      await setDoc(keyRef, { uid: currentUid, createdAt: serverTimestamp() }, { merge: true });
      keySnap = await getDoc(keyRef);
      setStatus('Chave não existia e foi criada com o UID atual.', 'success');
    }

    const keyData = keySnap.data() || {};
    linkedUid = (keyData.uid || '').toString().trim();
    openedKey = key;
    els.openedKey.textContent = key;

    if (!linkedUid) {
      currentRecruitment = null;
      setStatus('A chave existe, mas está sem UID válido.', 'error');
      renderRecruitment();
      return;
    }

    const recSnap = await getDoc(doc(recDb, 'rec', linkedUid));
    currentRecruitment = recSnap.exists() ? ({ id: recSnap.id, ...recSnap.data() }) : null;

    if (forceMessage) {
      if (currentRecruitment) setStatus('Recrutamento carregado com sucesso.', 'success');
      else setStatus('Não existe recrutamento para essa chave.', 'warn');
    }

    renderRecruitment();
  } catch (err) {
    console.error(err);
    setStatus('Não foi possível abrir essa chave agora.', 'error');
    showToast('error', 'Erro ao carregar recrutamento.');
  } finally {
    els.loadBtn.disabled = false;
  }
}

async function saveRecruitment(event) {
  event.preventDefault();

  if (!linkedUid) {
    showToast('error', 'Abra uma chave antes de salvar.');
    return;
  }

  const guildName = (els.guildName.value || '').trim();
  const roles = getCheckedValues('roles');
  const contacts = getCheckedValues('contacts');
  const description = (els.desc.value || '').trim().slice(0, 100);

  if (!guildName) {
    showToast('error', 'O nome da guilda é obrigatório.');
    return;
  }
  if (!roles.length) {
    showToast('error', 'Marque pelo menos uma função.');
    return;
  }

  try {
    const payload = {
      guildName,
      dateMs: currentRecruitment?.dateMs || Date.now(),
      roles,
      contacts,
      description,
      key: openedKey,
      ownerUid: linkedUid,
      updatedAt: serverTimestamp()
    };

    if (!currentRecruitment) payload.createdAt = serverTimestamp();

    await setDoc(doc(recDb, 'rec', linkedUid), payload, { merge: true });
    currentRecruitment = { ...currentRecruitment, ...payload, id: linkedUid };
    closeModal();
    renderRecruitment();
    setStatus('Recrutamento salvo com sucesso.', 'success');
    showToast('success', 'Recrutamento salvo!');
  } catch (err) {
    console.error(err);
    showToast('error', 'Não foi possível salvar o recrutamento.');
  }
}

async function deleteRecruitment() {
  if (!linkedUid || !currentRecruitment) return;
  if (!window.confirm('Excluir este recrutamento?')) return;

  try {
    await deleteDoc(doc(recDb, 'rec', linkedUid));
    currentRecruitment = null;
    renderRecruitment();
    setStatus('Recrutamento excluído com sucesso.', 'success');
    showToast('success', 'Recrutamento excluído!');
  } catch (err) {
    console.error(err);
    showToast('error', 'Não foi possível excluir o recrutamento.');
  }
}

function bindEvents() {
  document.querySelectorAll('[data-close-rec]').forEach(el => el.addEventListener('click', closeModal));
  els.newBtn.addEventListener('click', () => openModal('create'));
  els.loadBtn.addEventListener('click', () => resolveKeyAndLoad(true));
  els.reloadBtn.addEventListener('click', () => resolveKeyAndLoad(false));
  els.form.addEventListener('submit', saveRecruitment);
  document.getElementById('btn-logout')?.addEventListener('click', logout);
  els.desc.addEventListener('input', () => {
    els.desc.value = els.desc.value.slice(0, 100);
    els.descCount.textContent = `${els.desc.value.length}/100`;
  });
  els.keyInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      resolveKeyAndLoad(true);
    }
  });
}

(async function boot() {
  bindEvents();
  const user = await checkAuth(true);
  if (!user) return;

  const ctx = getGuildContext() || {};
  els.currentUid.textContent = auth.currentUser?.uid || '-';
  els.currentGuildName.textContent = ctx.guildName || '-';

  renderRecruitment();
  initIcons();
})();

window.addEventListener('beforeunload', () => {
  deleteApp(secondaryApp).catch(() => {});
});
