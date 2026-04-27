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
import { checkAuth, setupSidebar, initIcons, logout, getGuildContext, getGuildAccessKeyConfig, getGuildMultiConfig, showToast, auth, db } from './logic.js';

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

function bootMarketplaceMode() {
  // preserve the existing shared script behavior for eventos.html pages that use the recruitment marketplace.
  const els = {
    grid: qs('grid'), status: qs('status'), q: qs('q'), filter: qs('filter'), filterBtn: qs('filterBtn'), filterMenu: qs('filterMenu'), filterLabel: qs('filterLabel'),
    modal: qs('request-modal'), modalGuild: qs('request-modal-guild'), helper: qs('request-helper'), form: qs('request-form'),
    applicantId: qs('applicant-id'), applicantNick: qs('applicant-nick'), applicantWhatsapp: qs('applicant-whatsapp'), applicantWhatsappDdi: qs('applicant-whatsapp-ddi'),
    applicantAge: qs('applicant-age'), applicantAvailability: qs('applicant-availability'), applicantWeekend: qs('applicant-weekend'), applicantGg: qs('applicant-gg'), applicantNickChange: qs('applicant-nick-change')
  };
  if (!els.grid || !els.q || !els.filter) return;
  let allItems = [], activeRecruitment = null;
  const params = new URLSearchParams(window.location.search);

  function getMarketplaceSimpleOptions(options = [], placeholder = 'Selecione') {
    const list = Array.isArray(options) ? options : [];
    return [`<option value="">${placeholder}</option>`].concat(list.map((value) => `<option value="${escapeHtml(value)}">${escapeHtml(value)}</option>`)).join('');
  }

  function getMarketplaceCountrySelectOptions() {
    return WHATSAPP_COUNTRY_OPTIONS.map((country) => `<option value="${country.code}" ${country.code === DEFAULT_WHATSAPP_COUNTRY_CODE ? 'selected' : ''}>${country.flag} +${country.code}</option>`).join('');
  }

  function syncMarketplaceWhatsappConstraints() {
    if (!els.applicantWhatsapp) return;
    const country = getWhatsappCountryMeta(els.applicantWhatsappDdi?.value || DEFAULT_WHATSAPP_COUNTRY_CODE);
    let digits = normalizeDigits(els.applicantWhatsapp.value || '');
    if (digits.startsWith(country.code) && digits.length > country.maxDigits) {
      digits = digits.slice(country.code.length);
    }
    digits = digits.slice(0, country.maxDigits);
    els.applicantWhatsapp.value = digits;
    els.applicantWhatsapp.maxLength = country.maxDigits;
    els.applicantWhatsapp.placeholder = `${country.placeholder} (${country.maxDigits} dígitos)`;
  }

  function bindMarketplaceWhatsappField() {
    if (els.applicantWhatsappDdi && !els.applicantWhatsappDdi.dataset.marketplaceBound) {
      els.applicantWhatsappDdi.dataset.marketplaceBound = '1';
      els.applicantWhatsappDdi.addEventListener('change', syncMarketplaceWhatsappConstraints);
    }
    if (els.applicantWhatsapp && !els.applicantWhatsapp.dataset.marketplaceBound) {
      els.applicantWhatsapp.dataset.marketplaceBound = '1';
      els.applicantWhatsapp.addEventListener('input', syncMarketplaceWhatsappConstraints);
      els.applicantWhatsapp.addEventListener('paste', () => setTimeout(syncMarketplaceWhatsappConstraints, 0));
    }
    syncMarketplaceWhatsappConstraints();
  }

  function ensureMarketplaceNickLookupElements() {
    const form = els.form;
    const idInput = els.applicantId;
    if (!form || !idInput) return;

    let field = idInput.closest('[data-marketplace-id-field="true"]');
    if (!field) {
      field = idInput.parentElement;
      if (!field) return;
      field.setAttribute('data-marketplace-id-field', 'true');
    }

    let row = field.querySelector('[data-marketplace-id-row="true"]');
    if (!row) {
      row = document.createElement('div');
      row.setAttribute('data-marketplace-id-row', 'true');
      row.className = 'mt-1 flex items-center gap-2';
      if (idInput.parentNode === field) {
        field.insertBefore(row, idInput);
      } else {
        field.prepend(row);
      }
    }

    idInput.classList.remove('mt-1');
    idInput.classList.add('flex-1');
    if (idInput.parentElement !== row) {
      row.prepend(idInput);
    }

    let buttons = [...row.querySelectorAll('[data-marketplace-fetch-nick="true"]')];
    let button = buttons.shift() || null;
    buttons.forEach((el) => el.remove());
    if (!button) {
      button = document.createElement('button');
      button.type = 'button';
      button.setAttribute('data-marketplace-fetch-nick', 'true');
      button.className = 'shrink-0 rounded-2xl bg-emerald-600 px-4 py-3 text-sm font-bold text-white hover:bg-emerald-700';
      button.textContent = 'Buscar';
    }
    if (button.parentElement !== row) {
      row.appendChild(button);
    }

    let feedbacks = [...field.querySelectorAll('[data-marketplace-api-feedback="true"]')];
    let feedback = feedbacks.shift() || null;
    feedbacks.forEach((el) => el.remove());
    if (!feedback) {
      feedback = document.createElement('div');
      feedback.setAttribute('data-marketplace-api-feedback', 'true');
      feedback.className = 'mt-2 text-xs leading-5';
    }
    if (feedback.previousElementSibling !== row) {
      row.insertAdjacentElement('afterend', feedback);
    }

    els.fetchNickBtn = button;
    els.applicantApiFeedback = feedback;
  }

  function resetMarketplaceNickLookupState() {
    if (els.applicantApiFeedback) els.applicantApiFeedback.innerHTML = '';
    if (els.fetchNickBtn) {
      els.fetchNickBtn.disabled = false;
      els.fetchNickBtn.textContent = 'Buscar';
      els.fetchNickBtn.classList.remove('opacity-70', 'cursor-not-allowed');
    }
  }

  async function fetchMarketplaceNick() {
    const uid = normalizeDigits(els.applicantId?.value || '');
    const feedback = els.applicantApiFeedback;
    if (!uid) {
      if (feedback) feedback.innerHTML = '<span class="text-red-500">Digite o ID para buscar.</span>';
      showToast('error', 'Digite o ID');
      return;
    }

    if (feedback) feedback.innerHTML = '<span class="text-blue-500">Buscando...</span>';
    if (els.fetchNickBtn) {
      els.fetchNickBtn.disabled = true;
      els.fetchNickBtn.textContent = 'Buscando...';
      els.fetchNickBtn.classList.add('opacity-70', 'cursor-not-allowed');
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 12000);

    try {
      const url = `/api/proxy?endpoint=ff_info&query=${encodeURIComponent(uid)}`;
      const res = await fetch(url, { method: 'GET', signal: controller.signal });
      const data = await res.json().catch(() => ({}));
      const name = String(data?.nick || '').trim();
      const levelNum = Number(data?.level);

      if (res.ok && data?.success && name) {
        if (els.applicantNick) els.applicantNick.value = name;
        if (feedback) {
          feedback.innerHTML = `<div class="text-emerald-600 font-bold">✓ ${escapeHtml(name)} (Nível ${Number.isFinite(levelNum) ? levelNum : '?'})</div><div class="text-slate-500">Verifique se o nick realmente é esse! A api pode conter erros..</div>`;
        }
      } else if (feedback) {
        feedback.innerHTML = '<span class="text-red-500">Jogador não encontrado ou API indisponivel no momento!</span>';
      }
    } catch (error) {
      const message = error?.name === 'AbortError'
        ? 'A API demorou demais para responder.'
        : 'Jogador não encontrado ou erro na API.';
      if (feedback) feedback.innerHTML = `<span class="text-red-500">${message}</span>`;
    } finally {
      clearTimeout(timeoutId);
      if (els.fetchNickBtn) {
        els.fetchNickBtn.disabled = false;
        els.fetchNickBtn.textContent = 'Buscar';
        els.fetchNickBtn.classList.remove('opacity-70', 'cursor-not-allowed');
      }
    }
  }

  function bindMarketplaceNickLookup() {
    ensureMarketplaceNickLookupElements();

    if (els.fetchNickBtn && !els.fetchNickBtn.dataset.marketplaceBound) {
      els.fetchNickBtn.dataset.marketplaceBound = '1';
      els.fetchNickBtn.addEventListener('click', fetchMarketplaceNick);
    }

    if (els.applicantId && !els.applicantId.dataset.marketplaceNickBound) {
      els.applicantId.dataset.marketplaceNickBound = '1';
      els.applicantId.addEventListener('input', () => {
        const digits = normalizeDigits(els.applicantId.value || '');
        if (els.applicantId.value !== digits) els.applicantId.value = digits;
        if (els.applicantApiFeedback) els.applicantApiFeedback.innerHTML = '';
      });
      els.applicantId.addEventListener('keydown', (event) => {
        if (event.key !== 'Enter') return;
        event.preventDefault();
        fetchMarketplaceNick();
      });
    }
  }

  function closeMarketplaceCustomSelects(exceptSelect = null) {
    document.querySelectorAll('[data-rq-dd-select-id]').forEach((menu) => {
      const selectId = menu.getAttribute('data-rq-dd-select-id') || '';
      const trigger = document.querySelector(`[data-rq-dd-trigger-for="${selectId}"]`);
      if (exceptSelect && String(exceptSelect.id || '') === selectId) return;
      menu.classList.add('hidden');
      trigger?.classList.remove('is-open');
    });
  }

  function syncMarketplaceCustomSelect(select) {
    if (!select) return;
    const selectId = String(select.id || '');
    const trigger = document.querySelector(`[data-rq-dd-trigger-for="${selectId}"]`);
    const label = trigger?.querySelector('.rq-dd-label');
    const selectedOption = select.options[select.selectedIndex] || select.options[0] || null;
    if (label) label.textContent = selectedOption ? selectedOption.textContent : 'Selecione';
    document.querySelectorAll(`[data-rq-dd-option-for="${selectId}"]`).forEach((btn) => {
      const active = String(btn.getAttribute('data-value') || '') === String(select.value || '');
      btn.classList.toggle('is-selected', active);
      btn.setAttribute('aria-selected', active ? 'true' : 'false');
    });
  }

  function enhanceMarketplaceCustomSelect(select) {
    if (!select || select.dataset.rqDdInit === '1') {
      if (select) syncMarketplaceCustomSelect(select);
      return;
    }
    const wrap = select.closest('.rq-select-wrap') || select.parentElement;
    if (!wrap) return;

    wrap.classList.add('rq-dd');
    select.dataset.rqDdInit = '1';
    select.classList.add('rq-dd-native');

    wrap.querySelectorAll('[data-rq-dd-trigger-for], [data-rq-dd-select-id], .rq-dd-menu, .rq-dd-btn').forEach((node) => node.remove());
    wrap.querySelectorAll('i[data-lucide="chevron-down"]').forEach((icon) => icon.remove());

    const trigger = document.createElement('button');
    trigger.type = 'button';
    trigger.className = 'rq-dd-btn';
    trigger.setAttribute('data-rq-dd-trigger-for', select.id);
    trigger.innerHTML = `<span class="rq-dd-label">Selecione</span><span class="rq-dd-arrow">▾</span>`;

    const menu = document.createElement('div');
    menu.className = 'rq-dd-menu hidden';
    menu.setAttribute('data-rq-dd-select-id', select.id);

    [...select.options].forEach((option) => {
      const item = document.createElement('button');
      item.type = 'button';
      item.className = 'rq-dd-item';
      item.setAttribute('data-rq-dd-option-for', select.id);
      item.setAttribute('data-value', option.value);
      item.setAttribute('aria-selected', option.selected ? 'true' : 'false');
      item.textContent = option.textContent || '';
      item.addEventListener('click', () => {
        select.value = option.value;
        select.dispatchEvent(new Event('change', { bubbles: true }));
        syncMarketplaceCustomSelect(select);
        closeMarketplaceCustomSelects();
      });
      menu.appendChild(item);
    });

    trigger.addEventListener('click', (event) => {
      event.preventDefault();
      const willOpen = menu.classList.contains('hidden');
      closeMarketplaceCustomSelects(wrap.contains(menu) ? select : null);
      menu.classList.toggle('hidden', !willOpen);
      trigger.classList.toggle('is-open', willOpen);
    });

    select.addEventListener('change', () => syncMarketplaceCustomSelect(select));

    wrap.appendChild(trigger);
    wrap.appendChild(menu);
    syncMarketplaceCustomSelect(select);
  }

  function initMarketplaceCustomSelects() {
    const ids = [
      'applicant-age', 'applicant-availability', 'applicant-weekend', 'applicant-gg', 'applicant-nick-change',
      'applicant-age-dynamic', 'applicant-availability-dynamic', 'applicant-weekend-dynamic', 'applicant-gg-dynamic', 'applicant-nick-change-dynamic'
    ];
    ids.forEach((id) => {
      const select = document.getElementById(id);
      if (select) enhanceMarketplaceCustomSelect(select);
    });
  }

  function ensureMarketplaceRequestModal() {
    let dynamicModal = document.getElementById('request-modal-dynamic');

    const staticModal = document.getElementById('request-modal');
    const staticForm = document.getElementById('request-form');
    const staticModes = document.getElementById('request-modes');
    const staticId = document.getElementById('applicant-id');
    const staticNick = document.getElementById('applicant-nick');
    const staticWhatsapp = document.getElementById('applicant-whatsapp');
    const staticWhatsappDdi = document.getElementById('applicant-whatsapp-ddi');

    const staticModalIsComplete = !!(staticModal && staticForm && staticModes && staticId && staticNick && staticWhatsapp && staticWhatsappDdi);

    if (!staticModalIsComplete && !dynamicModal) {
      const wrap = document.createElement('div');
      wrap.innerHTML = `
        <div id="request-modal-dynamic" class="fixed inset-0 z-[70] hidden items-center justify-center overflow-y-auto bg-black/60 px-4 py-5">
          <div class="w-full max-w-md max-h-[calc(100dvh-2.5rem)] rounded-3xl bg-white shadow-2xl border border-slate-200 overflow-hidden flex flex-col">
            <div class="flex items-start justify-between gap-3 border-b border-slate-100 px-5 py-4">
              <div class="min-w-0">
                <p class="text-[11px] font-extrabold uppercase tracking-[0.14em] text-emerald-600">Pedido de recrutamento</p>
                <h3 class="mt-1 text-lg font-black text-slate-900">Enviar pedido</h3>
                <div id="request-modal-guild-dynamic" class="mt-2 inline-flex max-w-full items-center rounded-full bg-slate-100 px-3 py-1.5 text-sm font-bold text-slate-700">
                  <span class="truncate">-</span>
                </div>
                <p id="request-helper-dynamic" class="mt-2 text-xs text-slate-500">Preencha seus dados para enviar a solicitação.</p>
              </div>
              <button type="button" data-close-marketplace-request class="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl border border-slate-200 text-slate-500 hover:bg-slate-50">
                <i data-lucide="x" class="h-4 w-4"></i>
              </button>
            </div>
            <form id="request-form-dynamic" class="space-y-3.5 px-5 py-4 overflow-y-auto overscroll-contain min-h-0">
              <div class="grid gap-4 sm:grid-cols-2">
                <div>
                  <label for="applicant-id-dynamic" class="mb-2 block text-sm font-bold text-slate-700">ID</label>
                  <input id="applicant-id-dynamic" type="text" inputmode="numeric" placeholder="Somente números" class="w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm outline-none focus:border-emerald-400 focus:ring-4 focus:ring-emerald-100">
                </div>
                <div>
                  <label for="applicant-nick-dynamic" class="mb-2 block text-sm font-bold text-slate-700">Nick</label>
                  <input id="applicant-nick-dynamic" type="text" placeholder="Seu nick" class="w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm outline-none focus:border-emerald-400 focus:ring-4 focus:ring-emerald-100">
                </div>
              </div>
              <div>
                <label for="applicant-whatsapp-dynamic" class="mb-2 block text-sm font-bold text-slate-700">WhatsApp</label>
                <div class="grid grid-cols-[132px_minmax(0,1fr)] gap-2">
                  <select id="applicant-whatsapp-ddi-dynamic" class="rounded-2xl border border-slate-200 bg-white px-3 py-3 text-sm font-semibold outline-none focus:border-emerald-400 focus:ring-4 focus:ring-emerald-100">${getMarketplaceCountrySelectOptions()}</select>
                  <input id="applicant-whatsapp-dynamic" type="text" inputmode="tel" placeholder="DDD + número" class="w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm outline-none focus:border-emerald-400 focus:ring-4 focus:ring-emerald-100">
                </div>
              </div>
              <div>
                <p class="mb-2 block text-sm font-bold text-slate-700">Modo de jogo</p>
                <div id="request-modes-dynamic" class="grid grid-cols-2 gap-2"></div>
              </div>
              <div class="grid gap-4 sm:grid-cols-2">
                <div>
                  <label for="applicant-age-dynamic" class="mb-2 block text-sm font-bold text-slate-700">Idade</label>
                  <div class="rq-select-wrap relative">
                    <select id="applicant-age-dynamic" data-marketplace-custom-select="true" class="w-full appearance-none rounded-2xl border border-slate-200 bg-white px-4 py-3 pr-11 text-sm font-semibold outline-none focus:border-emerald-400 focus:ring-4 focus:ring-emerald-100">${getMarketplaceSimpleOptions(MARKETPLACE_AGE_OPTIONS, 'Selecione sua idade')}</select>
                    <i data-lucide="chevron-down" class="pointer-events-none absolute right-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500"></i>
                  </div>
                </div>
                <div>
                  <label for="applicant-availability-dynamic" class="mb-2 block text-sm font-bold text-slate-700">Horário disponível</label>
                  <div class="rq-select-wrap relative">
                    <select id="applicant-availability-dynamic" data-marketplace-custom-select="true" class="w-full appearance-none rounded-2xl border border-slate-200 bg-white px-4 py-3 pr-11 text-sm font-semibold outline-none focus:border-emerald-400 focus:ring-4 focus:ring-emerald-100">${getMarketplaceSimpleOptions(MARKETPLACE_AVAILABILITY_OPTIONS, 'Selecione um horário')}</select>
                    <i data-lucide="chevron-down" class="pointer-events-none absolute right-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500"></i>
                  </div>
                </div>
                <div>
                  <label for="applicant-weekend-dynamic" class="mb-2 block text-sm font-bold text-slate-700">Disponível sexta e sábado?</label>
                  <div class="rq-select-wrap relative">
                    <select id="applicant-weekend-dynamic" data-marketplace-custom-select="true" class="w-full appearance-none rounded-2xl border border-slate-200 bg-white px-4 py-3 pr-11 text-sm font-semibold outline-none focus:border-emerald-400 focus:ring-4 focus:ring-emerald-100">${getMarketplaceSimpleOptions(MARKETPLACE_BOOLEAN_OPTIONS, 'Selecione')}</select>
                    <i data-lucide="chevron-down" class="pointer-events-none absolute right-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500"></i>
                  </div>
                </div>
                <div>
                  <label for="applicant-gg-dynamic" class="mb-2 block text-sm font-bold text-slate-700">Já jogou GG?</label>
                  <div class="rq-select-wrap relative">
                    <select id="applicant-gg-dynamic" data-marketplace-custom-select="true" class="w-full appearance-none rounded-2xl border border-slate-200 bg-white px-4 py-3 pr-11 text-sm font-semibold outline-none focus:border-emerald-400 focus:ring-4 focus:ring-emerald-100">${getMarketplaceSimpleOptions(MARKETPLACE_BOOLEAN_OPTIONS, 'Selecione')}</select>
                    <i data-lucide="chevron-down" class="pointer-events-none absolute right-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500"></i>
                  </div>
                </div>
                <div class="sm:col-span-2">
                  <label for="applicant-nick-change-dynamic" class="mb-2 block text-sm font-bold text-slate-700">Possui troca nick?</label>
                  <div class="rq-select-wrap relative">
                    <select id="applicant-nick-change-dynamic" data-marketplace-custom-select="true" class="w-full appearance-none rounded-2xl border border-slate-200 bg-white px-4 py-3 pr-11 text-sm font-semibold outline-none focus:border-emerald-400 focus:ring-4 focus:ring-emerald-100">${getMarketplaceSimpleOptions(MARKETPLACE_BOOLEAN_OPTIONS, 'Selecione')}</select>
                    <i data-lucide="chevron-down" class="pointer-events-none absolute right-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500"></i>
                  </div>
                </div>
              </div>
              <div class="flex items-center justify-end gap-3 pt-2">
                <button type="button" data-close-marketplace-request class="rounded-2xl border border-slate-200 px-4 py-3 text-sm font-bold text-slate-600 hover:bg-slate-50">Cancelar</button>
                <button type="submit" class="rounded-2xl bg-slate-900 px-5 py-3 text-sm font-extrabold text-white hover:bg-slate-800">Enviar pedido</button>
              </div>
            </form>
          </div>
        </div>`;
      document.body.appendChild(wrap.firstElementChild);
      dynamicModal = document.getElementById('request-modal-dynamic');
    }

    els.modal = staticModalIsComplete ? staticModal : dynamicModal;
    els.modalGuild = staticModalIsComplete
      ? (document.getElementById('request-modal-guild') || document.getElementById('request-modal-guild-dynamic'))
      : document.getElementById('request-modal-guild-dynamic');
    els.helper = staticModalIsComplete
      ? (document.getElementById('request-helper') || document.getElementById('request-helper-dynamic'))
      : document.getElementById('request-helper-dynamic');
    els.form = staticModalIsComplete ? staticForm : document.getElementById('request-form-dynamic');
    els.applicantId = staticModalIsComplete ? staticId : document.getElementById('applicant-id-dynamic');
    els.applicantNick = staticModalIsComplete ? staticNick : document.getElementById('applicant-nick-dynamic');
    els.applicantWhatsapp = staticModalIsComplete ? staticWhatsapp : document.getElementById('applicant-whatsapp-dynamic');
    els.applicantWhatsappDdi = staticModalIsComplete ? staticWhatsappDdi : document.getElementById('applicant-whatsapp-ddi-dynamic');
    els.applicantAge = staticModalIsComplete ? document.getElementById('applicant-age') : document.getElementById('applicant-age-dynamic');
    els.applicantAvailability = staticModalIsComplete ? document.getElementById('applicant-availability') : document.getElementById('applicant-availability-dynamic');
    els.applicantWeekend = staticModalIsComplete ? document.getElementById('applicant-weekend') : document.getElementById('applicant-weekend-dynamic');
    els.applicantGg = staticModalIsComplete ? document.getElementById('applicant-gg') : document.getElementById('applicant-gg-dynamic');
    els.applicantNickChange = staticModalIsComplete ? document.getElementById('applicant-nick-change') : document.getElementById('applicant-nick-change-dynamic');

    const modesWrap = staticModalIsComplete ? staticModes : document.getElementById('request-modes-dynamic');
    if (modesWrap && !modesWrap.id) modesWrap.id = 'request-modes-dynamic';

    if (els.form && !els.form.dataset.marketplaceBound) {
      els.form.dataset.marketplaceBound = '1';
      els.form.addEventListener('submit', submitMarketplaceRequest);
    }

    if (els.modal && !els.modal.dataset.marketplaceBound) {
      els.modal.dataset.marketplaceBound = '1';
      els.modal.addEventListener('click', (event) => {
        if (event.target === els.modal) closeMarketplaceRequestModal();
      });
    }

    document.querySelectorAll('[data-close-marketplace-request], [data-close-request]').forEach((btn) => {
      if (btn.dataset.marketplaceBound) return;
      btn.dataset.marketplaceBound = '1';
      btn.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        closeMarketplaceRequestModal();
      });
    });

    if (!document.body.dataset.marketplaceCustomSelectCloseBound) {
      document.body.dataset.marketplaceCustomSelectCloseBound = '1';
      document.addEventListener('click', (event) => {
        if (event.target.closest('.rq-dd')) return;
        closeMarketplaceCustomSelects();
      });
      document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') closeMarketplaceCustomSelects();
      });
    }

    bindMarketplaceWhatsappField();
    bindMarketplaceNickLookup();
    initMarketplaceCustomSelects();
    initIcons();
  }

  function renderMarketplaceModes(item) {
    let wrap = document.getElementById('request-modes') || document.getElementById('request-modes-dynamic');
    if (!wrap && els.form) {
      const block = document.createElement('div');
      block.innerHTML = `
        <p class="mb-2 block text-sm font-bold text-slate-700">Modo de jogo</p>
        <div id="request-modes-dynamic" class="grid grid-cols-2 gap-2"></div>
      `;
      const actions = els.form.querySelector('.flex.items-center.justify-end.gap-3.pt-2');
      if (actions) els.form.insertBefore(block, actions);
      else els.form.appendChild(block);
      wrap = document.getElementById('request-modes-dynamic');
    }
    if (!wrap) return;
    const recruitmentRoles = Array.isArray(item?.roles) ? item.roles.map((role) => String(role || '').trim()).filter(Boolean) : [];
    const roleOptions = [...new Set([...MARKETPLACE_ROLE_OPTIONS, ...recruitmentRoles])];
    wrap.innerHTML = roleOptions.length ? roleOptions.map((role) => `
      <label class="flex items-center gap-2 rounded-2xl border border-slate-200 px-3 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50 cursor-pointer min-w-0">
        <input type="checkbox" name="marketplace-roles" value="${escapeHtml(role)}" class="h-4 w-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500">
        <span>${escapeHtml(role)}</span>
      </label>`).join('') : '<div class="rounded-2xl border border-dashed border-slate-200 px-4 py-3 text-sm text-slate-400">Esse recrutamento não informou modos de jogo.</div>';
  }

  function openMarketplaceRequestModal(item) {
    ensureMarketplaceRequestModal();
    if (!els.modal || !els.form) return;
    els.form.reset();
    if (els.applicantWhatsappDdi) els.applicantWhatsappDdi.value = DEFAULT_WHATSAPP_COUNTRY_CODE;
    if (els.applicantAge) els.applicantAge.value = '';
    if (els.applicantAvailability) els.applicantAvailability.value = '';
    if (els.applicantWeekend) els.applicantWeekend.value = '';
    if (els.applicantGg) els.applicantGg.value = '';
    if (els.applicantNickChange) els.applicantNickChange.value = '';
    syncMarketplaceWhatsappConstraints();
    initMarketplaceCustomSelects();
    [els.applicantAge, els.applicantAvailability, els.applicantWeekend, els.applicantGg, els.applicantNickChange].forEach((select) => { if (select) syncMarketplaceCustomSelect(select); });
    resetMarketplaceNickLookupState();
    if (els.modalGuild) els.modalGuild.textContent = item?.guildName || 'Guilda';
    if (els.helper) els.helper.textContent = 'Preencha seus dados para enviar a solicitação para essa guilda.';
    renderMarketplaceModes(item);
    els.modal.classList.remove('hidden');
    els.modal.classList.add('flex');
    initIcons();
  }

  function closeMarketplaceRequestModal() {
    if (!els.modal) return;
    els.modal.classList.add('hidden');
    els.modal.classList.remove('flex');
    closeMarketplaceCustomSelects();
    activeRecruitment = null;
  }

  async function submitMarketplaceRequest(event) {
    event.preventDefault();
    if (!activeRecruitment?.id) return;
    const applicantId = normalizeDigits(els.applicantId?.value || '');
    const applicantNick = String(els.applicantNick?.value || '').trim();
    const whatsappPayload = buildWhatsappPayload(els.applicantWhatsapp?.value || '', els.applicantWhatsappDdi?.value || DEFAULT_WHATSAPP_COUNTRY_CODE);
    const roles = [...document.querySelectorAll('input[name="marketplace-roles"]:checked')].map((el) => String(el.value || '').trim()).filter(Boolean);
    const applicantAge = String(els.applicantAge?.value || '').trim();
    const applicantAvailability = String(els.applicantAvailability?.value || '').trim();
    const applicantWeekend = String(els.applicantWeekend?.value || '').trim();
    const applicantGg = String(els.applicantGg?.value || '').trim();
    const applicantNickChange = String(els.applicantNickChange?.value || '').trim();
    if (!applicantId) { showToast('error', 'Informe seu ID.'); return; }
    if (!applicantNick) { showToast('error', 'Informe seu nick.'); return; }
    if (!whatsappPayload.localNumber) { showToast('error', 'Informe seu WhatsApp.'); return; }
    if (!roles.length) { showToast('error', 'Selecione pelo menos um modo de jogo.'); return; }
    if (!applicantAge) { showToast('error', 'Selecione sua idade.'); return; }
    if (!applicantAvailability) { showToast('error', 'Selecione seu horário disponível.'); return; }
    if (!applicantWeekend) { showToast('error', 'Selecione se está disponível sexta e sábado.'); return; }
    if (!applicantGg) { showToast('error', 'Selecione se já jogou GG.'); return; }
    if (!applicantNickChange) { showToast('error', 'Selecione se possui troca nick.'); return; }
    try {
      const reqRef = doc(recDb, 'rec', activeRecruitment.id, 'pedidos', applicantId);
      const existing = await getDoc(reqRef);
      if (existing.exists()) { showToast('error', 'Já existe uma solicitação enviada com esse ID.'); return; }
      await setDoc(reqRef, {
        id: applicantId,
        nick: applicantNick,
        whatsapp: whatsappPayload.localNumber,
        whatsappCountryCode: whatsappPayload.countryCode,
        roles,
        age: applicantAge,
        availableTime: applicantAvailability,
        availableFridaySaturday: applicantWeekend,
        playedGg: applicantGg,
        hasNickChange: applicantNickChange,
        status: 'pendente',
        guildId: activeRecruitment.id,
        guildName: activeRecruitment.guildName || '',
        createdAt: serverTimestamp()
      }, { merge: true });
      closeMarketplaceRequestModal();
      showToast('success', 'Pedido enviado com sucesso!');
    } catch (err) {
      console.error(err);
      showToast('error', 'Não foi possível enviar o pedido.');
    }
  }
  function setStatus(msg=''){ if (els.status) els.status.textContent = msg; }
  function itemMatchesFilter(item, value) {
    if (!value || value === 'all') return true;
    const test = String(value).toLowerCase();
    const arrays = [item.guildType || [], item.focus || [], item.roles || [], item.contacts || []].flat().map(v => String(v).toLowerCase());
    return arrays.includes(test);
  }
  function itemMatchesQuery(item, value) {
    const q = String(value || '').trim().toLowerCase();
    if (!q) return true;
    const hay = [item.id, item.guildName, item.description, item.platform, item.minimumAge, item.nickChangeRequired, item.nickChangeDeadline, item.teamPlay, item.useCall, ...(item.roles || []), ...(item.contacts || []), ...(item.guildType || []), ...(item.focus || [])].join(' ').toLowerCase();
    return hay.includes(q);
  }
  function syncUrl(){
    const sp = new URLSearchParams(window.location.search);
    const q = String(els.q.value || '').trim();
    const f = String(els.filter.value || 'all').trim();
    q ? sp.set('q', q) : sp.delete('q');
    f && f !== 'all' ? sp.set('filter', f) : sp.delete('filter');
    const url = `${window.location.pathname}${sp.toString() ? '?' + sp.toString() : ''}`;
    window.history.replaceState({}, '', url);
  }
  function renderGrid(items) {
    if (!items.length) {
      els.grid.innerHTML = '<div class="col-span-full rounded-3xl border border-dashed border-slate-200 bg-white p-8 text-center text-sm text-slate-500">Nenhum recrutamento encontrado.</div>';
      return;
    }
    els.grid.innerHTML = items.map(item => {
      const photo = item.photoBase64 ? `<img src="${item.photoBase64}" alt="${escapeHtml(item.guildName || 'Guilda')}" class="h-16 w-16 rounded-2xl object-cover border border-slate-200 bg-slate-100">` : '<div class="h-16 w-16 rounded-2xl border border-slate-200 bg-slate-100"></div>';
      const roles = (item.roles || []).map(v => tagChip(v,'role')).join(' ');
      const types = (item.guildType || []).map(v => tagChip(v,'type')).join(' ');
      const focuses = (item.focus || []).map(v => tagChip(v,'focus')).join(' ');
      const contacts = (item.contacts || []).map(v => tagChip(v,'contact')).join(' ');
      const requirements = renderRequirementChips(item);
      return `<article class="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm"><div class="flex items-start gap-3"><div class="shrink-0">${photo}</div><div class="min-w-0 flex-1"><div class="flex items-start justify-between gap-3"><div class="min-w-0"><h3 class="truncate text-base font-black text-slate-900">${escapeHtml(item.guildName || 'Sem nome')}</h3><p class="mt-1 text-xs text-slate-500">${escapeHtml(formatDateBR(item.createdAt || item.updatedAt || item.dateMs || Date.now()))}</p></div><span class="inline-flex rounded-full bg-emerald-50 px-2.5 py-1 text-[11px] font-extrabold text-emerald-700 ring-1 ring-emerald-200">ABERTO</span></div></div></div><div class="mt-4 space-y-3"><div><p class="mb-2 text-xs font-semibold text-slate-500">Descrição</p><div class="rounded-2xl border border-slate-200 bg-slate-50 px-3 py-3 text-sm text-slate-700 whitespace-pre-wrap">${escapeHtml(item.description || 'Sem descrição.')}</div></div><div><p class="mb-2 text-xs font-semibold text-slate-500">Modo de jogo</p><div class="flex flex-wrap gap-2">${roles || '<span class="text-xs text-slate-400">Não informado</span>'}</div></div><div><p class="mb-2 text-xs font-semibold text-slate-500">Tipo da guilda</p><div class="flex flex-wrap gap-2">${types || '<span class="text-xs text-slate-400">Não informado</span>'}</div></div><div><p class="mb-2 text-xs font-semibold text-slate-500">Foco de meta</p><div class="flex flex-wrap gap-2">${focuses || '<span class="text-xs text-slate-400">Não informado</span>'}</div></div><div><p class="mb-2 text-xs font-semibold text-slate-500">Contato</p><div class="flex flex-wrap gap-2">${contacts || '<span class="text-xs text-slate-400">Não informado</span>'}</div></div><div><p class="mb-2 text-xs font-semibold text-slate-500">Requisitos</p><div class="flex flex-wrap gap-2">${requirements}</div></div><button type="button" data-open-request="${escapeHtml(item.id)}" class="inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-slate-900 px-4 py-3 text-sm font-extrabold text-white hover:bg-slate-800"><i data-lucide="send" class="h-4 w-4"></i>Enviar pedido</button></div></article>`;
    }).join('');
    document.querySelectorAll('[data-open-request]').forEach(btn => btn.addEventListener('click', async () => {
      activeRecruitment = allItems.find(x => x.id === btn.getAttribute('data-open-request')) || null;
      if (!activeRecruitment) return;
      ensureMarketplaceRequestModal();
      openMarketplaceRequestModal(activeRecruitment);
    }));
    initIcons();
  }
  function applyFilters(){
    const filtered = allItems.filter(item => itemMatchesFilter(item, els.filter.value) && itemMatchesQuery(item, els.q.value));
    syncUrl();
    setStatus(`${filtered.length} recrutamento${filtered.length === 1 ? '' : 's'} encontrado${filtered.length === 1 ? '' : 's'}.`);
    renderGrid(filtered);
  }
  function shuffleMarketplaceItems(list = []) {
    const items = Array.isArray(list) ? [...list] : [];
    for (let i = items.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      [items[i], items[j]] = [items[j], items[i]];
    }
    return items;
  }

  async function loadMarketplace() {
    try {
      setStatus('Carregando recrutamentos...');
      const snap = await getDocs(collection(recDb,'rec'));
      allItems = shuffleMarketplaceItems(snap.docs.map(d => ({ id:d.id, ...d.data() })).filter(item => item && item.guildName));
      els.q.value = params.get('q') || '';
      els.filter.value = params.get('filter') || 'all';
      applyFilters();
    } catch (err) { console.error(err); setStatus('Erro ao carregar recrutamentos.'); }
  }
  els.q?.addEventListener('input', applyFilters);
  els.filterBtn?.addEventListener('click', () => els.filterMenu?.classList.toggle('hidden'));
  els.filterMenu?.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-value]');
    if (!btn) return;
    els.filter.value = btn.getAttribute('data-value') || 'all';
    if (els.filterLabel) els.filterLabel.textContent = btn.textContent.trim();
    els.filterMenu.classList.add('hidden');
    applyFilters();
  });
  loadMarketplace();
}

bootMarketplaceMode();
window.addEventListener('beforeunload', () => { deleteApp(secondaryApp).catch(() => {}); });
