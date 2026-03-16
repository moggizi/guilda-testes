import { initializeApp, deleteApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
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

setupSidebar();
initIcons();

function qs(id) { return document.getElementById(id); }
function normalizeTimestamp(value) {
  if (!value) return null;
  if (value instanceof Date) return value;
  if (typeof value?.toDate === 'function') return value.toDate();
  if (typeof value?.seconds === 'number') return new Date(value.seconds * 1000);
  const dt = new Date(value);
  return Number.isNaN(dt.getTime()) ? null : dt;
}
function formatDateBR(value) {
  try {
    const d = normalizeTimestamp(value) || new Date(value);
    if (!(d instanceof Date) || Number.isNaN(d.getTime())) return '-';
    return d.toLocaleDateString('pt-BR') + ' ' + d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  } catch (_) { return '-'; }
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
  document.querySelectorAll(`input[name="${name}"]`).forEach(el => { el.checked = wanted.has(el.value); });
}
function tagChip(text, style = 'default') {
  const styles = {
    role: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
    contact: 'bg-gray-100 text-gray-700 ring-gray-200',
    type: 'bg-fuchsia-50 text-fuchsia-700 ring-fuchsia-200',
    focus: 'bg-sky-50 text-sky-700 ring-sky-200',
    default: 'bg-slate-100 text-slate-700 ring-slate-200'
  };
  return `<span class="inline-flex items-center rounded-full ring-1 px-2.5 py-1 text-[11px] font-bold ${styles[style] || styles.default}">${escapeHtml(text)}</span>`;
}

// ========= shared image helpers for management =========
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
  const ctx = canvas.getContext('2d', { alpha: false });
  if (!ctx) throw new Error('Canvas indisponível.');

  let quality = 0.88, output = '', attempts = 0, currentWidth = width, currentHeight = height;
  while (attempts < 12) {
    canvas.width = currentWidth; canvas.height = currentHeight;
    ctx.clearRect(0, 0, currentWidth, currentHeight);
    ctx.drawImage(img, 0, 0, currentWidth, currentHeight);
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
  const finalSize = dataUrlSizeBytes(output);
  if (finalSize > maxBytes) throw new Error('Não foi possível comprimir a imagem abaixo de 800 KB.');
  return { base64: output, bytes: finalSize };
}

// ========= management mode (camp.html) =========
function bootManagementMode() {
  const els = {
    loadBtn: qs('btn-load-recruitment'), reloadBtn: qs('btn-reload'), newBtn: qs('btn-new-rec'),
    keyInput: qs('guild-access-key-input'), keyStatus: qs('key-status'), currentUid: qs('current-uid'),
    currentGuildName: qs('current-guild-name'), openedKey: qs('opened-key'), view: qs('recruitment-view'),
    modal: qs('rec-modal'), modalTitle: qs('rec-modal-title'), form: qs('rec-form'), guildName: qs('rec-guild-name'),
    desc: qs('rec-description'), descCount: qs('rec-desc-count'), photoInput: qs('rec-photo'),
    photoPreviewWrap: qs('rec-photo-preview-wrap'), photoPreview: qs('rec-photo-preview'), photoStatus: qs('rec-photo-status'),
    requestsSection: qs('requests-section'), requestsView: qs('requests-view'), requestsBadge: qs('requests-badge')
  };

  let linkedUid = null, openedKey = '', currentRecruitment = null, currentPhotoBase64 = '', currentPhotoBytes = 0, currentRequests = [];

  function setStatus(message, type = 'info') {
    const map = {
      info: 'hidden', success: 'border-emerald-200 bg-emerald-50 text-emerald-700', error: 'border-red-200 bg-red-50 text-red-700', warn: 'border-amber-200 bg-amber-50 text-amber-700'
    };
    if (!els.keyStatus) return;
    if (!message) {
      els.keyStatus.className = 'mt-4 hidden rounded-xl border px-4 py-3 text-sm';
      els.keyStatus.textContent = '';
      return;
    }
    els.keyStatus.className = `mt-4 rounded-xl border px-4 py-3 text-sm ${map[type] || map.info}`;
    els.keyStatus.textContent = message;
  }
  function resetPhotoState() {
    currentPhotoBase64 = ''; currentPhotoBytes = 0;
    if (els.photoInput) els.photoInput.value = '';
    if (els.photoPreview) els.photoPreview.src = '';
    if (els.photoPreviewWrap) els.photoPreviewWrap.classList.add('hidden');
    if (els.photoStatus) els.photoStatus.textContent = 'Nenhuma foto selecionada.';
  }
  function setPhotoPreview(base64 = '', bytes = 0) {
    currentPhotoBase64 = base64 || ''; currentPhotoBytes = Number(bytes) || 0;
    if (currentPhotoBase64) {
      els.photoPreview.src = currentPhotoBase64;
      els.photoPreviewWrap.classList.remove('hidden');
      const kb = Math.max(1, Math.round(currentPhotoBytes / 1024));
      els.photoStatus.textContent = `Foto pronta para salvar (${kb} KB).`;
    } else resetPhotoState();
  }
  function openModal(mode = 'create') {
    els.form.reset();
    els.descCount.textContent = '0/100';
    els.modalTitle.textContent = mode === 'edit' ? 'Editar recrutamento' : 'Novo recrutamento';
    const ctx = getGuildContext() || {};
    els.guildName.value = currentRecruitment?.guildName || ctx.guildName || '';
    resetPhotoState();
    if (mode === 'edit' && currentRecruitment) {
      els.guildName.value = currentRecruitment.guildName || ctx.guildName || '';
      setCheckedValues('roles', currentRecruitment.roles || []);
      setCheckedValues('contacts', currentRecruitment.contacts || []);
      setCheckedValues('guildType', currentRecruitment.guildType || []);
      setCheckedValues('focus', currentRecruitment.focus || []);
      els.desc.value = currentRecruitment.description || '';
      els.descCount.textContent = `${els.desc.value.length}/100`;
      if (currentRecruitment.photoBase64) setPhotoPreview(currentRecruitment.photoBase64, currentRecruitment.photoBytes || dataUrlSizeBytes(currentRecruitment.photoBase64));
    } else {
      setCheckedValues('roles', []); setCheckedValues('contacts', []); setCheckedValues('guildType', []); setCheckedValues('focus', []);
    }
    els.modal.classList.remove('hidden'); initIcons();
  }
  function closeModal() { els.modal.classList.add('hidden'); }
  function updateCreateButtonVisibility() {
    if (!els.newBtn) return;
    if (!linkedUid || currentRecruitment) els.newBtn.classList.add('hidden');
    else els.newBtn.classList.remove('hidden');
  }
  async function updateRequestStatus(requestId, status) {
    if (!linkedUid || !requestId) return;
    try {
      await setDoc(doc(recDb, 'rec', linkedUid, 'pedidos', requestId), { status, reviewedAt: serverTimestamp(), reviewedBy: auth.currentUser?.uid || linkedUid }, { merge: true });
      await loadRequests();
      showToast('success', status === 'accepted' ? 'Pedido aceito!' : 'Pedido recusado!');
    } catch (err) {
      console.error(err); showToast('error', 'Não foi possível atualizar o pedido.');
    }
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
      const roles = Array.isArray(pedido.roles) && pedido.roles.length ? pedido.roles.map(v => tagChip(v, 'role')).join(' ') : '<span class="text-xs text-gray-400">Modo não informado</span>';
      const status = (pedido.status || 'pendente').toString();
      const statusClass = status === 'accepted' ? 'bg-emerald-50 text-emerald-700 ring-emerald-200' : status === 'rejected' ? 'bg-red-50 text-red-700 ring-red-200' : 'bg-amber-50 text-amber-700 ring-amber-200';
      const contact = pedido.whatsapp || pedido.phone || pedido.discord || pedido.contact || '';
      return `
        <div class="rounded-2xl border border-gray-200 p-4">
          <div class="flex flex-col gap-4">
            <div class="flex items-start justify-between gap-3 flex-wrap">
              <div>
                <h5 class="text-base font-bold text-gray-900 break-words">${escapeHtml(name)}</h5>
                <p class="text-xs text-gray-500 mt-1">ID: ${escapeHtml(pedido.id || '-')} • Enviado em ${escapeHtml(formatDateBR(pedido.createdAt || pedido.dateMs || pedido.date || Date.now()))}</p>
              </div>
              <span class="inline-flex items-center rounded-full ring-1 px-2.5 py-1 text-[11px] font-extrabold ${statusClass}">${status === 'accepted' ? 'ACEITO' : status === 'rejected' ? 'RECUSADO' : 'PENDENTE'}</span>
            </div>
            <div><p class="text-xs font-semibold text-gray-500 mb-2">Modo de jogo</p><div class="flex flex-wrap gap-2">${roles}</div></div>
            ${contact ? `<p class="text-sm text-gray-600 break-all"><b>WhatsApp:</b> ${escapeHtml(contact)}</p>` : ''}
            <div class="mt-1 flex gap-2 flex-wrap">
              <button data-request-action="accepted" data-request-id="${escapeHtml(pedido.id || '')}" class="px-3 py-2 rounded-xl text-sm font-medium bg-emerald-500 text-white hover:bg-emerald-600 ${status === 'accepted' ? 'opacity-60' : ''}">Aceitar pedido</button>
              <button data-request-action="rejected" data-request-id="${escapeHtml(pedido.id || '')}" class="px-3 py-2 rounded-xl text-sm font-medium bg-red-50 text-red-600 hover:bg-red-100 ${status === 'rejected' ? 'opacity-60' : ''}">Recusar</button>
            </div>
          </div>
        </div>`;
    }).join('');
    document.querySelectorAll('[data-request-action]').forEach((btn) => btn.addEventListener('click', async () => updateRequestStatus(btn.getAttribute('data-request-id') || '', btn.getAttribute('data-request-action') || 'accepted')));
  }
  function renderRecruitment() {
    if (!linkedUid) {
      els.view.innerHTML = `<div class="bg-white rounded-2xl p-10 border border-gray-100 shadow-sm text-center"><p class="text-gray-500 font-medium">Abra uma chave da guilda para visualizar seu recrutamento.</p></div>`;
      updateCreateButtonVisibility(); renderRequests(); initIcons(); return;
    }
    if (!currentRecruitment) {
      els.view.innerHTML = `
        <div class="bg-white rounded-2xl p-10 border border-gray-100 shadow-sm text-center">
          <div class="w-14 h-14 rounded-2xl bg-gray-50 text-gray-500 flex items-center justify-center mx-auto mb-3"><i data-lucide="search-x" class="w-7 h-7"></i></div>
          <p class="text-gray-800 font-semibold">Nenhum recrutamento publicado ainda</p>
          <p class="text-gray-500 text-sm mt-1">Essa chave ainda não tem um anúncio ativo. Toque em <b>Criar recrutamento</b> para publicar o primeiro.</p>
        </div>`;
      updateCreateButtonVisibility(); renderRequests(); initIcons(); return;
    }
    const data = currentRecruitment;
    const roles = Array.isArray(data.roles) && data.roles.length ? data.roles.map(v => tagChip(v, 'role')).join(' ') : '<span class="text-sm text-gray-400">Nenhuma</span>';
    const contacts = Array.isArray(data.contacts) && data.contacts.length ? data.contacts.map(v => tagChip(v, 'contact')).join(' ') : '<span class="text-sm text-gray-400">Nenhuma</span>';
    const guildTypes = Array.isArray(data.guildType) && data.guildType.length ? data.guildType.map(v => tagChip(v, 'type')).join(' ') : '<span class="text-sm text-gray-400">Nenhum</span>';
    const focuses = Array.isArray(data.focus) && data.focus.length ? data.focus.map(v => tagChip(v, 'focus')).join(' ') : '<span class="text-sm text-gray-400">Nenhum</span>';
    const photo = data.photoBase64 ? `<img src="${data.photoBase64}" alt="Foto do recrutamento" class="w-full h-64 object-cover rounded-2xl border border-gray-200 bg-gray-50">` : '';
    els.view.innerHTML = `
      <div class="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
        <div class="p-5 border-b border-gray-100 flex items-start justify-between gap-4">
          <div>
            <div class="flex items-center gap-2 flex-wrap">
              <h4 class="text-xl font-bold text-gray-900">${escapeHtml(data.guildName || 'Sem nome')}</h4>
              <span class="inline-flex items-center rounded-full bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200 px-2.5 py-1 text-[11px] font-extrabold">ATIVO</span>
            </div>
            <p class="text-sm text-gray-500 mt-1">Chave usada: <span class="font-semibold break-all">${escapeHtml(openedKey)}</span></p>
            <p class="text-sm text-gray-500 mt-1">Publicado em: ${escapeHtml(formatDateBR(data.dateMs || data.createdAt || Date.now()))}</p>
          </div>
          <div class="flex items-center gap-2">
            <button id="btn-edit-rec" class="px-3 py-2 rounded-xl text-sm font-medium text-gray-600 hover:bg-gray-100">Editar</button>
            <button id="btn-delete-rec" class="px-3 py-2 rounded-xl text-sm font-medium text-red-500 hover:bg-red-50">Excluir</button>
          </div>
        </div>
        <div class="p-5 space-y-5">
          ${photo}
          <div class="grid md:grid-cols-2 gap-5">
            <div><p class="text-xs font-semibold text-gray-500 mb-2">Funções</p><div class="flex flex-wrap gap-2">${roles}</div></div>
            <div><p class="text-xs font-semibold text-gray-500 mb-2">Mais opções</p><div class="flex flex-wrap gap-2">${contacts}</div></div>
            <div><p class="text-xs font-semibold text-gray-500 mb-2">Tipo da guilda</p><div class="flex flex-wrap gap-2">${guildTypes}</div></div>
            <div><p class="text-xs font-semibold text-gray-500 mb-2">Foco</p><div class="flex flex-wrap gap-2">${focuses}</div></div>
          </div>
          <div><p class="text-xs font-semibold text-gray-500 mb-2">Descrição</p><div class="rounded-xl bg-gray-50 border border-gray-200 p-4 text-sm text-gray-700 min-h-[84px] whitespace-pre-wrap">${escapeHtml(data.description || 'Sem descrição.')}</div></div>
        </div>
      </div>`;
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
      currentRequests = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      currentRequests.sort((a, b) => (normalizeTimestamp(b.createdAt || b.dateMs || b.date)?.getTime?.() || 0) - (normalizeTimestamp(a.createdAt || a.dateMs || a.date)?.getTime?.() || 0));
    } catch (err) { console.error(err); currentRequests = []; }
    renderRequests();
  }
  async function resolveKeyAndLoad(forceMessage = true) {
    const key = (els.keyInput.value || '').trim();
    if (!key) { setStatus('Digite a chave da guilda para continuar.', 'warn'); return; }
    const currentUid = auth.currentUser?.uid || '';
    if (!currentUid) { showToast('error', 'Sessão inválida. Faça login novamente.'); return; }
    try {
      els.loadBtn.disabled = true;
      const keyRef = doc(recDb, 'chave', key);
      let keySnap = await getDoc(keyRef);
      if (!keySnap.exists()) {
        await setDoc(keyRef, { uid: currentUid, createdAt: serverTimestamp() }, { merge: true });
        keySnap = await getDoc(keyRef);
        setStatus('Essa chave foi vinculada à sua conta e já está pronta para uso.', 'success');
      }
      const keyData = keySnap.data() || {};
      linkedUid = (keyData.uid || '').toString().trim();
      openedKey = key;
      if (els.openedKey) els.openedKey.textContent = key;
      if (!linkedUid) { currentRecruitment = null; setStatus('Encontramos a chave, mas ela está sem uma conta vinculada.', 'error'); renderRecruitment(); return; }
      const recSnap = await getDoc(doc(recDb, 'rec', linkedUid));
      currentRecruitment = recSnap.exists() ? ({ id: recSnap.id, ...recSnap.data() }) : null;
      if (forceMessage) {
        if (currentRecruitment) setStatus('Pronto! Seu recrutamento foi encontrado e carregado.', 'success');
        else setStatus('Tudo certo com a chave. Agora você já pode criar o recrutamento dessa guilda.', 'warn');
      }
      renderRecruitment();
      await loadRequests();
    } catch (err) {
      console.error(err); setStatus('Não foi possível abrir essa chave agora.', 'error'); showToast('error', 'Erro ao carregar recrutamento.');
    } finally { els.loadBtn.disabled = false; }
  }
  async function saveRecruitment(event) {
    event.preventDefault();
    if (!linkedUid) { showToast('error', 'Abra uma chave antes de salvar.'); return; }
    const guildName = (els.guildName.value || '').trim();
    const roles = getCheckedValues('roles');
    const contacts = getCheckedValues('contacts');
    const guildType = getCheckedValues('guildType');
    const focus = getCheckedValues('focus');
    const description = (els.desc.value || '').trim().slice(0, 100);
    if (!guildName) { showToast('error', 'O nome da guilda é obrigatório.'); return; }
    if (!roles.length) { showToast('error', 'Marque pelo menos uma função.'); return; }
    if (!currentPhotoBase64 && !currentRecruitment?.photoBase64) { showToast('error', 'Envie uma foto para o recrutamento.'); return; }
    try {
      const payload = {
        guildName, dateMs: currentRecruitment?.dateMs || Date.now(), roles, contacts, guildType, focus, description,
        key: openedKey, ownerUid: linkedUid, photoBase64: currentPhotoBase64 || currentRecruitment?.photoBase64 || '',
        photoBytes: currentPhotoBytes || currentRecruitment?.photoBytes || dataUrlSizeBytes(currentPhotoBase64 || currentRecruitment?.photoBase64 || ''),
        updatedAt: serverTimestamp()
      };
      if (!currentRecruitment) payload.createdAt = serverTimestamp();
      await setDoc(doc(recDb, 'rec', linkedUid), payload, { merge: true });
      currentRecruitment = { ...currentRecruitment, ...payload, id: linkedUid };
      closeModal(); renderRecruitment(); await loadRequests(); setStatus('Seu recrutamento foi salvo com sucesso.', 'success'); showToast('success', 'Recrutamento salvo!');
    } catch (err) { console.error(err); showToast('error', 'Não foi possível salvar o recrutamento.'); }
  }
  async function deleteRecruitment() {
    if (!linkedUid || !currentRecruitment) return;
    if (!window.confirm('Excluir este recrutamento?')) return;
    try {
      await deleteDoc(doc(recDb, 'rec', linkedUid));
      currentRecruitment = null; currentRequests = []; renderRecruitment(); setStatus('Seu recrutamento foi excluído com sucesso.', 'success'); showToast('success', 'Recrutamento excluído!');
    } catch (err) { console.error(err); showToast('error', 'Não foi possível excluir o recrutamento.'); }
  }
  function bindEvents() {
    document.querySelectorAll('[data-close-rec]').forEach(el => el.addEventListener('click', closeModal));
    els.newBtn?.addEventListener('click', () => openModal('create'));
    els.loadBtn?.addEventListener('click', () => resolveKeyAndLoad(true));
    els.reloadBtn?.addEventListener('click', () => resolveKeyAndLoad(false));
    els.form?.addEventListener('submit', saveRecruitment);
    qs('btn-logout')?.addEventListener('click', logout);
    els.desc?.addEventListener('input', () => {
      els.desc.value = els.desc.value.slice(0, 100);
      els.descCount.textContent = `${els.desc.value.length}/100`;
    });
    els.keyInput?.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); resolveKeyAndLoad(true); } });
    els.photoInput?.addEventListener('change', async (e) => {
      const file = e.target.files?.[0];
      if (!file) { if (!currentRecruitment?.photoBase64) resetPhotoState(); return; }
      try {
        els.photoStatus.textContent = 'Comprimindo imagem...';
        const result = await compressImageToBase64(file, 800 * 1024);
        setPhotoPreview(result.base64, result.bytes);
      } catch (err) { console.error(err); resetPhotoState(); showToast('error', err?.message || 'Não foi possível processar a imagem.'); }
    });
  }

  (async function boot() {
    bindEvents();
    const user = await checkAuth(true);
    if (!user) return;
    const ctx = getGuildContext() || {};
    if (els.currentUid) els.currentUid.textContent = auth.currentUser?.uid || '-';
    if (els.currentGuildName) els.currentGuildName.textContent = ctx.guildName || '-';
    resetPhotoState(); renderRecruitment(); initIcons();
  })();
}

// ========= marketplace mode (eventos.html) =========
function bootMarketplaceMode() {
  const els = {
    grid: qs('grid'), status: qs('status'), q: qs('q'), filter: qs('filter'), filterBtn: qs('filterBtn'), filterMenu: qs('filterMenu'), filterLabel: qs('filterLabel'),
    modal: qs('request-modal'), modalGuild: qs('request-modal-guild'), helper: qs('request-helper'), form: qs('request-form'),
    applicantId: qs('applicant-id'), applicantNick: qs('applicant-nick'), applicantWhatsapp: qs('applicant-whatsapp'), modesWrap: qs('applicant-modes-wrap')
  };
  let allItems = [], activeRecruitment = null;

  function setStatus(msg='') { if (els.status) els.status.textContent = msg; }
  function isUidSearch(value) {
    const clean = String(value || '').trim();
    return !!clean && /^\d+$/.test(clean);
  }
  function syncUidSearchInUrl(rawValue, replace = true) {
    const url = new URL(window.location.href);
    const value = String(rawValue || '').trim();
    if (isUidSearch(value)) url.searchParams.set('uid', value);
    else url.searchParams.delete('uid');
    const next = `${url.pathname}${url.search}${url.hash}`;
    if (replace) window.history.replaceState({}, '', next);
    else window.history.pushState({}, '', next);
  }
  function getInitialUidSearch() {
    const url = new URL(window.location.href);
    const uid = String(url.searchParams.get('uid') || '').trim();
    return isUidSearch(uid) ? uid : '';
  }
  function openReqModal(item) {
    activeRecruitment = item;
    els.form.reset();
    els.modalGuild.textContent = item.guildName || 'Guilda';
    els.helper.textContent = 'Preencha seus dados para enviar o pedido para essa guilda.';
    const modes = Array.isArray(item.roles) && item.roles.length ? item.roles : ['Rush', 'Fuzileiro', 'Full Gás', 'Curandeiro', 'Suporte'];
    els.modesWrap.innerHTML = modes.map((mode, idx) => `
      <label class="select-chip">
        <input type="checkbox" name="applicantRoles" value="${escapeHtml(mode)}">
        <span><i data-lucide="check-circle" class="h-4 w-4"></i>${escapeHtml(mode)}</span>
      </label>`).join('');
    els.modal.classList.remove('hidden');
    initIcons();
  }
  function closeReqModal() { els.modal.classList.add('hidden'); activeRecruitment = null; }
  function itemMatchesFilter(item, filterValue) {
    const v = String(filterValue || 'all').toLowerCase();
    if (v === 'all') return true;
    const roles = (item.roles || []).map(x => String(x).toLowerCase());
    const contacts = (item.contacts || []).map(x => String(x).toLowerCase());
    const types = (item.guildType || []).map(x => String(x).toLowerCase());
    const focuses = (item.focus || []).map(x => String(x).toLowerCase());
    return roles.includes(v) || contacts.includes(v) || types.includes(v) || focuses.includes(v);
  }
  function itemMatchesQuery(item, query) {
    const raw = String(query || '').trim();
    const q = raw.toLowerCase();
    if (!q) return true;
    if (isUidSearch(raw)) {
      const itemUid = String(item.id || item.ownerUid || '').trim();
      return itemUid === raw || itemUid.includes(raw);
    }
    const hay = [item.guildName, item.description, item.id, item.ownerUid, ...(item.roles || []), ...(item.contacts || []), ...(item.guildType || []), ...(item.focus || [])].join(' ').toLowerCase();
    return hay.includes(q);
  }
  function renderGrid(items) {
    if (!items.length) {
      els.grid.innerHTML = `<div class="col-span-full rounded-3xl border border-dashed border-slate-200 bg-white p-8 text-center text-slate-500">Nenhum recrutamento encontrado com esse filtro.</div>`;
      initIcons();
      return;
    }
    els.grid.innerHTML = items.map(item => {
      const photo = item.photoBase64 ? `<img src="${item.photoBase64}" alt="Foto da guilda" class="h-52 w-full object-cover">` : `<div class="h-52 w-full bg-gradient-to-br from-emerald-50 to-sky-50"></div>`;
      const roles = (item.roles || []).map(v => tagChip(v, 'role')).join(' ') || '<span class="text-xs text-slate-400">Não informado</span>';
      const types = (item.guildType || []).map(v => tagChip(v, 'type')).join(' ') || '<span class="text-xs text-slate-400">Não informado</span>';
      const focuses = (item.focus || []).map(v => tagChip(v, 'focus')).join(' ') || '<span class="text-xs text-slate-400">Não informado</span>';
      const contacts = (item.contacts || []).map(v => tagChip(v, 'contact')).join(' ') || '<span class="text-xs text-slate-400">Não informado</span>';
      return `
        <article class="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
          ${photo}
          <div class="p-5 space-y-4">
            <div class="flex items-start justify-between gap-3">
              <div>
                <h3 class="text-lg font-black text-slate-900">${escapeHtml(item.guildName || 'Sem nome')}</h3>
                <p class="mt-1 text-xs text-slate-500">Publicado em ${escapeHtml(formatDateBR(item.dateMs || item.createdAt || Date.now()))}</p>
              </div>
              <span class="inline-flex items-center rounded-full bg-emerald-50 px-2.5 py-1 text-[11px] font-extrabold text-emerald-700 ring-1 ring-emerald-200">ABERTO</span>
            </div>
            <div class="rounded-2xl bg-slate-50 p-3 text-sm text-slate-600 min-h-[84px] whitespace-pre-wrap">${escapeHtml(item.description || 'Sem descrição.')}</div>
            <div class="space-y-3">
              <div><p class="mb-2 text-[11px] font-black uppercase tracking-wide text-slate-500">Modo de jogo</p><div class="flex flex-wrap gap-2">${roles}</div></div>
              <div><p class="mb-2 text-[11px] font-black uppercase tracking-wide text-slate-500">Tipo de guilda</p><div class="flex flex-wrap gap-2">${types}</div></div>
              <div><p class="mb-2 text-[11px] font-black uppercase tracking-wide text-slate-500">Foco de meta</p><div class="flex flex-wrap gap-2">${focuses}</div></div>
              <div><p class="mb-2 text-[11px] font-black uppercase tracking-wide text-slate-500">Contato</p><div class="flex flex-wrap gap-2">${contacts}</div></div>
            </div>
            <button type="button" data-open-request="${escapeHtml(item.id)}" class="inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-slate-900 px-4 py-3 text-sm font-extrabold text-white hover:bg-slate-800">
              <i data-lucide="send" class="h-4 w-4"></i>Enviar pedido
            </button>
          </div>
        </article>`;
    }).join('');
    document.querySelectorAll('[data-open-request]').forEach(btn => btn.addEventListener('click', () => {
      const item = allItems.find(x => x.id === btn.getAttribute('data-open-request'));
      if (item) openReqModal(item);
    }));
    initIcons();
  }
  function applyFilters() {
    const queryValue = els.q?.value || '';
    const filtered = allItems.filter(item => itemMatchesFilter(item, els.filter.value) && itemMatchesQuery(item, queryValue));
    if (isUidSearch(queryValue)) {
      const uid = String(queryValue).trim();
      setStatus(filtered.length
        ? `${filtered.length} recrutamento${filtered.length === 1 ? '' : 's'} encontrado${filtered.length === 1 ? '' : 's'} para o UID ${uid}.`
        : `Nenhum recrutamento encontrado para o UID ${uid}.`);
    } else {
      setStatus(`${filtered.length} recrutamento${filtered.length === 1 ? '' : 's'} encontrado${filtered.length === 1 ? '' : 's'}.`);
    }
    renderGrid(filtered);
  }
  async function loadMarketplace() {
    try {
      setStatus('Carregando recrutamentos...');
      const snap = await getDocs(collection(recDb, 'rec'));
      allItems = snap.docs.map(d => ({ id: d.id, ...d.data() })).filter(item => item && item.guildName);
      allItems.sort((a,b) => (normalizeTimestamp(b.createdAt || b.updatedAt || b.dateMs)?.getTime?.() || 0) - (normalizeTimestamp(a.createdAt || a.updatedAt || a.dateMs)?.getTime?.() || 0));
      applyFilters();
    } catch (err) {
      console.error(err);
      setStatus('Erro ao carregar recrutamentos.');
      els.grid.innerHTML = `<div class="col-span-full rounded-3xl border border-red-200 bg-red-50 p-6 text-sm text-red-700">Erro ao carregar recrutamentos.</div>`;
    }
  }
  async function submitRequest(event) {
    event.preventDefault();
    if (!activeRecruitment?.id) { showToast('error', 'Recrutamento inválido.'); return; }
    const playerId = String(els.applicantId.value || '').replace(/\D+/g, '');
    const nick = String(els.applicantNick.value || '').trim();
    const whatsapp = String(els.applicantWhatsapp.value || '').replace(/\D+/g, '');
    const roles = [...document.querySelectorAll('input[name="applicantRoles"]:checked')].map(el => el.value);
    if (!playerId) { showToast('error', 'Informe seu ID.'); return; }
    if (!nick) { showToast('error', 'Informe seu nick.'); return; }
    if (!whatsapp) { showToast('error', 'Informe seu WhatsApp.'); return; }
    if (!roles.length) { showToast('error', 'Selecione pelo menos um modo de jogo.'); return; }
    try {
      const requestRef = doc(recDb, 'rec', activeRecruitment.id, 'pedidos', playerId);
      const existing = await getDoc(requestRef);
      if (existing.exists()) { showToast('error', 'Já existe um pedido enviado com esse ID.'); return; }
      await setDoc(requestRef, { id: playerId, nick, whatsapp, roles, status: 'pendente', createdAt: serverTimestamp(), recUid: activeRecruitment.id, guildName: activeRecruitment.guildName || '' }, { merge: true });
      showToast('success', 'Pedido enviado com sucesso!');
      closeReqModal();
    } catch (err) {
      console.error(err); showToast('error', 'Não foi possível enviar o pedido.');
    }
  }
  function bindFilters() {
    els.filterBtn?.addEventListener('click', () => els.filterMenu.classList.toggle('hidden'));
    document.addEventListener('click', (e) => {
      if (!els.filterMenu || !els.filterBtn) return;
      if (els.filterMenu.contains(e.target) || els.filterBtn.contains(e.target)) return;
      els.filterMenu.classList.add('hidden');
    });
    els.filterMenu?.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-value]');
      if (!btn) return;
      const value = btn.getAttribute('data-value') || 'all';
      els.filter.value = value;
      els.filterLabel.textContent = btn.textContent.trim();
      els.filterMenu.querySelectorAll('[data-value]').forEach(x => x.setAttribute('aria-selected', 'false'));
      btn.setAttribute('aria-selected', 'true');
      els.filterMenu.classList.add('hidden');
      applyFilters();
      initIcons();
    });
    els.q?.addEventListener('input', () => {
      syncUidSearchInUrl(els.q.value, true);
      applyFilters();
    });
  }
  function bindModal() {
    document.querySelectorAll('[data-close-request]').forEach(el => el.addEventListener('click', closeReqModal));
    els.form?.addEventListener('submit', submitRequest);
    els.applicantId?.addEventListener('input', () => { els.applicantId.value = String(els.applicantId.value || '').replace(/\D+/g, ''); });
    els.applicantWhatsapp?.addEventListener('input', () => { els.applicantWhatsapp.value = String(els.applicantWhatsapp.value || '').replace(/\D+/g, ''); });
  }
  (async function boot() {
    bindFilters();
    bindModal();
    const initialUid = getInitialUidSearch();
    if (initialUid && els.q) els.q.value = initialUid;
    initIcons();
    await loadMarketplace();
  })();
}

const isManagementMode = !!qs('btn-load-recruitment') && !!qs('recruitment-view');
const isMarketplaceMode = !!qs('grid') && !!qs('request-form');
if (isManagementMode) bootManagementMode();
if (isMarketplaceMode) bootMarketplaceMode();

window.addEventListener('beforeunload', () => { deleteApp(secondaryApp).catch(() => {}); });
