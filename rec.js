import { initializeApp, deleteApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getFirestore,
  collection,
  doc,
  getDoc,
  getDocs,
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
  els.newBtn?.addEventListener('click', () => openModal('create'));
  els.loadBtn?.addEventListener('click', () => resolveKeyAndLoad(true));
  els.reloadBtn?.addEventListener('click', () => resolveKeyAndLoad(false));
  els.form?.addEventListener('submit', saveRecruitment);
  document.getElementById('btn-logout')?.addEventListener('click', logout);
  els.desc?.addEventListener('input', () => {
    els.desc.value = els.desc.value.slice(0, 100);
    els.descCount.textContent = `${els.desc.value.length}/100`;
  });
  els.keyInput?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      resolveKeyAndLoad(true);
    }
  });
}

export async function initRecruitmentManager() {
  if (!els.view || !els.keyInput || !els.form) return;
  bindEvents();
  const user = await checkAuth(true);
  if (!user) return;

  const ctx = getGuildContext() || {};
  if (els.currentUid) els.currentUid.textContent = auth.currentUser?.uid || '-';
  if (els.currentGuildName) els.currentGuildName.textContent = ctx.guildName || '-';

  renderRecruitment();
  initIcons();
}

function normalizeList(values) {
  return Array.isArray(values) ? values.filter(Boolean).map(v => String(v).trim()).filter(Boolean) : [];
}

function matchesRecruitmentFilter(rec, filterValue) {
  const f = String(filterValue || 'all').trim().toLowerCase();
  if (!f || f === 'all') return true;
  const buckets = [normalizeList(rec.roles), normalizeList(rec.contacts), normalizeList(rec.guildType), normalizeList(rec.focus)]
    .flat()
    .map(v => v.toLowerCase());
  return buckets.includes(f);
}

function matchesRecruitmentQuery(rec, queryValue) {
  const q = String(queryValue || '').trim().toLowerCase();
  if (!q) return true;
  const hay = [rec.guildName, rec.description, ...normalizeList(rec.roles), ...normalizeList(rec.contacts), ...normalizeList(rec.guildType), ...normalizeList(rec.focus)].join(' ').toLowerCase();
  return hay.includes(q);
}

function badge(text, cls) {
  return `<span class="inline-flex items-center rounded-full ring-1 px-2.5 py-1 text-[11px] font-extrabold ${cls}">${escapeHtml(text)}</span>`;
}

export async function initRecruitmentMarketplace() {
  const grid = document.getElementById('grid');
  const status = document.getElementById('status');
  const q = document.getElementById('q');
  const filter = document.getElementById('filter');
  const filterBtn = document.getElementById('filterBtn');
  const filterLabel = document.getElementById('filterLabel');
  const filterMenu = document.getElementById('filterMenu');
  const modal = document.getElementById('request-modal');
  const form = document.getElementById('request-form');
  const modalGuild = document.getElementById('request-modal-guild');
  const applicantId = document.getElementById('applicant-id');
  const applicantNick = document.getElementById('applicant-nick');
  const applicantWhats = document.getElementById('applicant-whatsapp');
  const applicantModesWrap = document.getElementById('applicant-modes-wrap');
  const requestSubmit = document.getElementById('btn-send-request');
  const requestHelper = document.getElementById('request-helper');
  if (!grid || !status || !q || !filter || !filterBtn || !filterLabel || !filterMenu || !modal || !form || !modalGuild || !applicantId || !applicantNick || !applicantWhats || !applicantModesWrap || !requestSubmit) return;

  let allItems = [];
  let selected = null;

  const setStatusText = (msg='') => { status.textContent = msg; };
  const toggleMenu = (force=null) => {
    const open = force != null ? !!force : filterMenu.classList.contains('hidden');
    filterMenu.classList.toggle('hidden', !open);
  };

  function closeModalRequest() {
    modal.classList.add('hidden');
    form.reset();
    applicantModesWrap.innerHTML = '';
    selected = null;
    if (requestHelper) requestHelper.textContent = 'Preencha seus dados para enviar o pedido.';
  }

  function openModalRequest(item) {
    selected = item;
    modal.classList.remove('hidden');
    form.reset();
    modalGuild.textContent = item.raw?.guildName || 'Guilda';
    const options = normalizeList(item.raw?.roles);
    applicantModesWrap.innerHTML = options.length
      ? options.map(mode => `<label class="select-chip"><input type="checkbox" name="applicantModes" value="${escapeHtml(mode)}"><span><i data-lucide="check-circle-2" class="w-4 h-4"></i>${escapeHtml(mode)}</span></label>`).join('')
      : '<div class="rounded-2xl border border-dashed border-slate-200 bg-slate-50 p-4 text-sm text-slate-500">Esse recrutamento não informou modos disponíveis.</div>';
    initIcons();
  }

  function render(items) {
    if (!items.length) {
      grid.innerHTML = `<div class="col-span-full rounded-3xl border border-slate-200 bg-white p-8 text-center shadow-sm"><div class="mx-auto mb-3 grid h-14 w-14 place-items-center rounded-2xl bg-slate-100 text-slate-500"><i data-lucide="search-x" class="h-7 w-7"></i></div><p class="text-base font-bold text-slate-900">Nenhum recrutamento encontrado</p><p class="mt-1 text-sm text-slate-500">Tente outro filtro ou pesquise por outra palavra.</p></div>`;
      initIcons();
      return;
    }
    grid.innerHTML = items.map(it => {
      const d = it.raw || {};
      const photo = d.photoBase64
        ? `<img src="${d.photoBase64}" alt="Foto da guilda" class="h-56 w-full object-cover" loading="lazy">`
        : `<div class="h-56 w-full bg-gradient-to-br from-emerald-100 via-white to-sky-100 flex items-center justify-center text-emerald-700"><div class="text-center px-6"><div class="mx-auto mb-3 grid h-16 w-16 place-items-center rounded-3xl bg-white/90 shadow-sm ring-1 ring-emerald-200"><i data-lucide="shield" class="h-8 w-8"></i></div><p class="font-black text-lg">${escapeHtml(d.guildName || 'Guilda')}</p></div></div>`;
      const chips = [
        ...normalizeList(d.roles).map(v => badge(v, 'bg-emerald-50 text-emerald-700 ring-emerald-200')),
        ...normalizeList(d.contacts).map(v => badge(v, 'bg-slate-100 text-slate-700 ring-slate-200')),
        ...normalizeList(d.guildType).map(v => badge(v, 'bg-fuchsia-50 text-fuchsia-700 ring-fuchsia-200')),
        ...normalizeList(d.focus).map(v => badge(v, 'bg-sky-50 text-sky-700 ring-sky-200'))
      ].join(' ');
      return `<article class="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm transition hover:-translate-y-0.5 hover:shadow-lg">${photo}<div class="p-5"><div class="flex items-start justify-between gap-3"><div class="min-w-0"><h3 class="truncate text-xl font-black text-slate-900">${escapeHtml(d.guildName || 'Guilda sem nome')}</h3><p class="mt-1 text-sm text-slate-500">Publicado em ${escapeHtml(formatDateBR(d.dateMs || d.createdAt || Date.now()))}</p></div><span class="inline-flex items-center rounded-full bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200 px-2.5 py-1 text-[11px] font-extrabold">RECRUTANDO</span></div><div class="mt-4 flex flex-wrap gap-2">${chips || '<span class="text-sm text-slate-400">Sem filtros extras.</span>'}</div><div class="mt-4 rounded-2xl bg-slate-50 border border-slate-200 p-4 text-sm leading-relaxed text-slate-600 min-h-[96px] whitespace-pre-wrap">${escapeHtml(d.description || 'Essa guilda não adicionou descrição.')}</div><button class="mt-5 inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-slate-900 px-4 py-3 text-sm font-extrabold text-white hover:bg-slate-800" data-open-request="${escapeHtml(it.id)}"><i data-lucide="send" class="h-4 w-4"></i> Enviar pedido</button></div></article>`;
    }).join('');
    document.querySelectorAll('[data-open-request]').forEach(btn => btn.addEventListener('click', () => {
      const id = btn.getAttribute('data-open-request') || '';
      const item = allItems.find(x => x.id === id);
      if (item) openModalRequest(item);
    }));
    initIcons();
  }

  function applyFilters() {
    const filtered = allItems.filter(it => matchesRecruitmentFilter(it.raw || {}, filter.value || 'all') && matchesRecruitmentQuery(it.raw || {}, q.value || ''));
    render(filtered);
  }

  async function loadRecruitments() {
    setStatusText('Carregando recrutamentos...');
    grid.innerHTML = '<div class="col-span-full rounded-3xl border border-slate-200 bg-white p-8 text-center text-slate-500 shadow-sm">Carregando...</div>';
    try {
      const snap = await getDocs(collection(recDb, 'rec'));
      allItems = snap.docs.map(d => ({ id: d.id, raw: { id: d.id, ...d.data() } }));
      allItems.sort((a,b) => Number(b.raw.dateMs || 0) - Number(a.raw.dateMs || 0));
      setStatusText(allItems.length ? `${allItems.length} recrutamento(s) encontrado(s)` : 'Ainda não há recrutamentos publicados.');
      applyFilters();
    } catch (err) {
      console.error(err);
      setStatusText('Não foi possível carregar os recrutamentos agora.');
      grid.innerHTML = '<div class="col-span-full rounded-3xl border border-red-200 bg-red-50 p-8 text-center text-red-700 shadow-sm">Erro ao carregar recrutamentos.</div>';
    }
  }

  async function submitRequest(event) {
    event.preventDefault();
    if (!selected?.id) return showToast('error', 'Selecione um recrutamento antes de enviar.');
    const idValue = String(applicantId.value || '').replace(/\D+/g, '');
    const nickValue = String(applicantNick.value || '').trim();
    const whatsappValue = String(applicantWhats.value || '').replace(/\D+/g, '');
    const modes = [...document.querySelectorAll('input[name="applicantModes"]:checked')].map(el => el.value);
    if (!idValue) return showToast('error', 'Digite seu ID somente com números.');
    if (!nickValue) return showToast('error', 'Digite seu nick.');
    if (!whatsappValue) return showToast('error', 'Digite seu WhatsApp.');
    if (!modes.length) return showToast('error', 'Marque pelo menos um modo que você joga.');
    try {
      requestSubmit.disabled = true;
      const ref = doc(recDb, 'rec', selected.id, 'pedidos', idValue);
      const existsSnap = await getDoc(ref);
      if (existsSnap.exists()) {
        if (requestHelper) requestHelper.textContent = 'Já existe um pedido com esse ID nessa guilda.';
        return showToast('error', 'Já existe uma solicitação com esse ID.');
      }
      await setDoc(ref, {
        id: idValue,
        nick: nickValue,
        whatsapp: whatsappValue,
        roles: modes,
        status: 'pending',
        guildName: selected.raw?.guildName || '',
        recruitmentUid: selected.id,
        createdAt: serverTimestamp(),
        dateMs: Date.now()
      });
      closeModalRequest();
      showToast('success', 'Pedido enviado com sucesso!');
    } catch (err) {
      console.error(err);
      showToast('error', 'Não foi possível enviar seu pedido.');
    } finally {
      requestSubmit.disabled = false;
    }
  }

  filterBtn.addEventListener('click', () => toggleMenu());
  document.addEventListener('click', (e) => {
    const inside = filterMenu.contains(e.target) || filterBtn.contains(e.target);
    if (!inside) toggleMenu(false);
  });
  filterMenu.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-value]');
    if (!btn) return;
    filter.value = btn.getAttribute('data-value') || 'all';
    filterMenu.querySelectorAll('[data-value]').forEach(item => item.setAttribute('aria-selected', 'false'));
    btn.setAttribute('aria-selected', 'true');
    filterLabel.textContent = btn.textContent.trim();
    toggleMenu(false);
    applyFilters();
    initIcons();
  });
  q.addEventListener('input', applyFilters);
  form.addEventListener('submit', submitRequest);
  document.querySelectorAll('[data-close-request]').forEach(el => el.addEventListener('click', closeModalRequest));
  applicantId.addEventListener('input', () => { applicantId.value = String(applicantId.value || '').replace(/\D+/g, '').slice(0, 20); });
  applicantWhats.addEventListener('input', () => { applicantWhats.value = String(applicantWhats.value || '').replace(/\D+/g, '').slice(0, 15); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeModalRequest(); });

  await loadRecruitments();
}

if (els.view && els.keyInput && els.form) initRecruitmentManager();
if (document.getElementById('grid') && document.getElementById('request-modal')) initRecruitmentMarketplace();

window.addEventListener('beforeunload', () => {
  deleteApp(secondaryApp).catch(() => {});
});
