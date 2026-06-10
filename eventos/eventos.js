import {
  doc,
  getDoc,
  setDoc,
  deleteDoc,
  serverTimestamp,
  collection,
  getDocs,
  query,
  orderBy,
  limit,
  startAfter,
  startAt,
  endAt,
  documentId
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { checkAuth, setupSidebar, initIcons, logout, getGuildContext, getGuildMultiConfig, showToast, auth, db } from '../logic.js';
setupSidebar();
initIcons();

const RECRUITMENT_ROOT_COLLECTION = 'recrutamento';
const RECRUITMENT_ACTIVE_STATUS = 'ativo';
const RECRUITMENT_ITEMS_COLLECTION = 'itens';
const MARKETPLACE_PAGE_SIZE = 30;
const MARKETPLACE_DOC_ID_RANDOM_ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
const activeRecruitmentsCollection = () => collection(db, RECRUITMENT_ROOT_COLLECTION, RECRUITMENT_ACTIVE_STATUS, RECRUITMENT_ITEMS_COLLECTION);
const activeRecruitmentDocRef = (guildId) => doc(db, RECRUITMENT_ROOT_COLLECTION, RECRUITMENT_ACTIVE_STATUS, RECRUITMENT_ITEMS_COLLECTION, String(guildId || '').trim());
const activeRecruitmentRequestDocRef = (guildId, requestId) => doc(db, RECRUITMENT_ROOT_COLLECTION, RECRUITMENT_ACTIVE_STATUS, RECRUITMENT_ITEMS_COLLECTION, String(guildId || '').trim(), 'pedidos', String(requestId || '').trim());
const recruitmentPhotoSrc = (item = {}) => String(item.photoUrl || item.photoBase64 || '').trim();

const PARTNER_REF_KEY = 'ghub_partner_ref';
function sanitizePartnerRef(value) {
  return String(value || '').trim().replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 80);
}
function safeStorageGet(key) {
  try { const value = localStorage.getItem(key); if (value) return value; } catch (_) {}
  try { return sessionStorage.getItem(key) || ''; } catch (_) { return ''; }
}
function safeStorageSet(key, value) {
  const clean = String(value || '').trim();
  if (!clean) return;
  try { localStorage.setItem(key, clean); } catch (_) {}
  try { sessionStorage.setItem(key, clean); } catch (_) {}
}
function getStoredPartnerRef() {
  return sanitizePartnerRef(safeStorageGet(PARTNER_REF_KEY));
}
function capturePartnerRefFromUrl() {
  try {
    const ref = sanitizePartnerRef(new URLSearchParams(window.location.search || '').get('ref'));
    if (ref) safeStorageSet(PARTNER_REF_KEY, ref);
  } catch (_) {}
}
function decorateInternalLinksWithPartnerRef() {
  try {
    const ref = getStoredPartnerRef();
    if (!ref) return;
    document.querySelectorAll('a[href]').forEach((link) => {
      const rawHref = String(link.getAttribute('href') || '').trim();
      if (!rawHref || rawHref.startsWith('#') || rawHref.startsWith('javascript:') || rawHref.startsWith('mailto:') || rawHref.startsWith('tel:')) return;
      if (/^https?:\/\//i.test(rawHref) && !rawHref.startsWith(window.location.origin)) return;
      const url = new URL(rawHref, window.location.origin);
      if (url.origin !== window.location.origin) return;
      if (!url.searchParams.get('ref')) url.searchParams.set('ref', ref);
      link.setAttribute('href', `${url.pathname}${url.search}${url.hash}`);
    });
  } catch (_) {}
}
capturePartnerRefFromUrl();
decorateInternalLinksWithPartnerRef();

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
const MARKETPLACE_BLOCKED_WORDS = [
  'arrombado', 'arrombada', 'babaca', 'bosta', 'buceta', 'caralho', 'corno', 'corna',
  'cu', 'cuzao', 'desgracado', 'desgracada', 'fdp', 'filho da puta', 'filha da puta',
  'fodase', 'idiota', 'imbecil', 'lixo', 'otario', 'otaria', 'pau no cu', 'porra',
  'puta', 'puto', 'putaria', 'retardado', 'retardada', 'vagabundo', 'vagabunda',
  'vai se foder', 'vai tomar no cu', 'vsf', 'vtmnc', 'boiola', 'traveco', 'boquete',
  'punheta', 'porno', 'pornografia', 'xvideos', 'onlyfans', 'hitler', 'maconha', 'cocaina'
];
function normalizeMarketplaceSafetyText(value) {
  return String(value || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[@4]/g, 'a').replace(/3/g, 'e').replace(/[1|]/g, 'i').replace(/0/g, 'o')
    .replace(/[5$]/g, 's').replace(/7/g, 't').replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ').trim();
}
function marketplaceContainsBlockedContent(value) {
  const normalized = ` ${normalizeMarketplaceSafetyText(value)} `;
  return MARKETPLACE_BLOCKED_WORDS.some((word) => normalized.includes(` ${normalizeMarketplaceSafetyText(word)} `));
}
function marketplaceContainsLink(value) {
  return /(?:https?:\/\/|www\.)\S+|(?:[a-z0-9-]+\.)+(?:com\.br|com|net|org|io|gg|br|app|dev|site|online|link|xyz|store|me|co)(?:\/\S*)?/i.test(String(value || ''));
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
const MAX_MARKETPLACE_CUSTOM_FIELDS = 10;
const MARKETPLACE_CUSTOM_FIELD_TYPES = new Set(['text', 'select', 'multiselect', 'boolean']);
function normalizeMarketplaceOptions(value, maxItems = 8) {
  const source = Array.isArray(value) ? value : [];
  return [...new Set(source.map((item) => String(item || '').replace(/\s+/g, ' ').trim().slice(0, 50)).filter(Boolean))].slice(0, maxItems);
}
function getMarketplaceDisplaySections(item = {}) {
  const raw = Array.isArray(item.customSections) ? item.customSections : [];
  const custom = raw.map((section, index) => ({
    id: String(section?.id || `section_${index + 1}`).slice(0, 40),
    title: String(section?.title || '').replace(/\s+/g, ' ').trim().slice(0, 50),
    items: normalizeMarketplaceOptions(section?.items)
  })).filter((section) => section.title && section.items.length).slice(0, 8);
  if (custom.length || Number(item.formVersion || 0) >= 2) return custom;

  const legacy = [];
  const add = (title, values) => {
    const items = normalizeMarketplaceOptions(values);
    if (items.length) legacy.push({ id: title.toLowerCase().replace(/\s+/g, '_'), title, items });
  };
  add('Modo de jogo', item.roles);
  add('Tipo da guilda', item.guildType);
  add('Foco', item.focus);
  add('Contato', item.contacts);
  add('Requisitos', buildRecruitmentRequirements(item));
  return legacy;
}
function getMarketplaceApplicationFields(item = {}) {
  const raw = Array.isArray(item.applicationFields) ? item.applicationFields : [];
  const custom = raw.map((field, index) => {
    const type = MARKETPLACE_CUSTOM_FIELD_TYPES.has(String(field?.type || '')) ? String(field.type) : 'text';
    return {
      id: String(field?.id || `question_${index + 1}`).replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 40),
      label: String(field?.label || '').replace(/\s+/g, ' ').trim().slice(0, 70),
      type,
      required: field?.required === true,
      options: ['select', 'multiselect'].includes(type) ? normalizeMarketplaceOptions(field?.options) : []
    };
  }).filter((field) => field.id && field.label).slice(0, MAX_MARKETPLACE_CUSTOM_FIELDS);
  if (custom.length || Number(item.formVersion || 0) >= 2) return custom;

  const roles = normalizeMarketplaceOptions(item.roles);
  return [
    { id: 'legacy_roles', label: 'Qual modo você joga?', type: 'multiselect', required: true, options: roles.length ? roles : MARKETPLACE_ROLE_OPTIONS },
    { id: 'legacy_age', label: 'Idade', type: 'select', required: true, options: MARKETPLACE_AGE_OPTIONS },
    { id: 'legacy_availability', label: 'Horário disponível', type: 'select', required: true, options: MARKETPLACE_AVAILABILITY_OPTIONS },
    { id: 'legacy_weekend', label: 'Disponível sexta e sábado?', type: 'boolean', required: true, options: [] },
    { id: 'legacy_gg', label: 'Já jogou GG?', type: 'boolean', required: true, options: [] },
    { id: 'legacy_nick_change', label: 'Possui troca nick?', type: 'boolean', required: true, options: [] }
  ];
}
function renderMarketplaceDisplaySections(item = {}) {
  const sections = getMarketplaceDisplaySections(item);
  if (!sections.length) return '<span class="text-xs text-slate-400">Não informado</span>';
  return sections.map((section) => `<div><p class="mb-2 text-xs font-semibold text-slate-500">${escapeHtml(section.title)}</p><div class="flex flex-wrap gap-2">${section.items.map((value) => tagChip(value, 'default')).join('')}</div></div>`).join('');
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
const MARKETPLACE_CONTACT_TYPES = {
  whatsapp: { label: 'WhatsApp', placeholder: 'DDD + número' },
  instagram: { label: 'Instagram', placeholder: 'nome.de.usuario' },
  discord: { label: 'Discord', placeholder: 'nome_de_usuario' }
};
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
    valid: localNumber.length === country.maxDigits,
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
const normalizeMarketplaceContactType = (value) => {
  const type = String(value || '').trim().toLowerCase();
  return MARKETPLACE_CONTACT_TYPES[type] ? type : 'whatsapp';
};
const cleanMarketplaceUsername = (value, type) => {
  let clean = String(value || '').trim()
    .replace(/^https?:\/\/(www\.)?instagram\.com\//i, '')
    .replace(/^https?:\/\/(www\.)?discord(?:app)?\.com\/users\//i, '')
    .replace(/^@+/, '')
    .replace(/[/?#].*$/, '');
  if (type === 'instagram') return clean.replace(/[^a-zA-Z0-9._]/g, '').slice(0, 30);
  return clean.replace(/[^a-zA-Z0-9._]/g, '').slice(0, 32);
};
const buildMarketplaceContactPayload = (typeValue, rawValue, rawCountryCode) => {
  const type = normalizeMarketplaceContactType(typeValue);
  if (type === 'whatsapp') {
    const whatsapp = buildWhatsappPayload(rawValue, rawCountryCode);
    return {
      type,
      value: whatsapp.localNumber,
      countryCode: whatsapp.countryCode,
      valid: whatsapp.valid,
      label: whatsapp.label,
      maxDigits: whatsapp.maxDigits
    };
  }
  const value = cleanMarketplaceUsername(rawValue, type);
  return {
    type,
    value,
    countryCode: '',
    valid: value.length >= 2,
    label: MARKETPLACE_CONTACT_TYPES[type].label,
    maxDigits: 0
  };
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
    applicantId: qs('applicant-id'), applicantNick: qs('applicant-nick'), applicantContactType: qs('applicant-contact-type'), applicantWhatsapp: qs('applicant-whatsapp'), applicantWhatsappDdi: qs('applicant-whatsapp-ddi'),
    applicantAge: qs('applicant-age'), applicantAvailability: qs('applicant-availability'), applicantWeekend: qs('applicant-weekend'), applicantGg: qs('applicant-gg'), applicantNickChange: qs('applicant-nick-change')
  };
  if (!els.grid || !els.q || !els.filter) return;
  let allItems = [], activeRecruitment = null, lastMarketplaceDoc = null, marketplaceHasMore = true, marketplaceLoading = false, marketplaceSubmitting = false;
  let marketplaceRandomCursor = '', marketplaceWrapped = false, marketplaceReachedCursor = false, marketplaceSeenIds = new Set();
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
    const type = normalizeMarketplaceContactType(els.applicantContactType?.value);
    const contactWrap = document.getElementById(els.applicantWhatsapp.id.includes('dynamic') ? 'applicant-contact-value-wrap-dynamic' : 'applicant-contact-value-wrap');
    const help = document.getElementById(els.applicantWhatsapp.id.includes('dynamic') ? 'applicant-contact-help-dynamic' : 'applicant-contact-help');
    const countryControl = els.applicantWhatsappDdi?.closest('.rq-dd') || els.applicantWhatsappDdi;
    countryControl?.classList.toggle('hidden', type !== 'whatsapp');
    if (contactWrap) {
      contactWrap.className = type === 'whatsapp'
        ? 'mt-2 grid grid-cols-[132px_minmax(0,1fr)] gap-2'
        : 'mt-2 grid grid-cols-1 gap-2';
    }

    if (type !== 'whatsapp') {
      els.applicantWhatsapp.value = cleanMarketplaceUsername(els.applicantWhatsapp.value, type);
      els.applicantWhatsapp.inputMode = 'text';
      els.applicantWhatsapp.maxLength = type === 'instagram' ? 30 : 32;
      els.applicantWhatsapp.placeholder = MARKETPLACE_CONTACT_TYPES[type].placeholder;
      if (help) {
        help.textContent = type === 'instagram'
          ? 'Digite somente o nome de usuário do Instagram.'
          : 'Digite o usuário do Discord. O painel copiará o nome ao abrir o Discord.';
      }
      return;
    }

    const country = getWhatsappCountryMeta(els.applicantWhatsappDdi?.value || DEFAULT_WHATSAPP_COUNTRY_CODE);
    let digits = normalizeDigits(els.applicantWhatsapp.value || '');
    if (digits.startsWith(country.code) && digits.length > country.maxDigits) {
      digits = digits.slice(country.code.length);
    }
    digits = digits.slice(0, country.maxDigits);
    els.applicantWhatsapp.value = digits;
    els.applicantWhatsapp.inputMode = 'numeric';
    els.applicantWhatsapp.maxLength = country.maxDigits;
    els.applicantWhatsapp.placeholder = `${country.placeholder} (${country.maxDigits} dígitos)`;
    if (help) help.textContent = `Informe ${country.maxDigits} dígitos, incluindo DDD/área.`;
  }

  function bindMarketplaceWhatsappField() {
    if (els.applicantContactType && !els.applicantContactType.dataset.marketplaceContactBound) {
      els.applicantContactType.dataset.marketplaceContactBound = '1';
      els.applicantContactType.addEventListener('change', () => {
        if (els.applicantWhatsapp) els.applicantWhatsapp.value = '';
        syncMarketplaceWhatsappConstraints();
      });
    }
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

  function setMarketplaceButtonBusy(button, busy, label = 'Aguarde...') {
    if (!button) return;
    if (busy) {
      if (!button.dataset.originalHtml) button.dataset.originalHtml = button.innerHTML;
      button.disabled = true;
      button.classList.add('opacity-70', 'cursor-not-allowed');
      button.innerHTML = `<span class="inline-flex items-center justify-center gap-2"><i data-lucide="loader-2" class="h-4 w-4 animate-spin"></i>${escapeHtml(label)}</span>`;
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
          feedback.innerHTML = `<div class="text-emerald-600 font-bold">✓ ${escapeHtml(name)} (Nível ${Number.isFinite(levelNum) ? levelNum : '?'})</div><div class="text-slate-500">Confira o resultado. Se estiver incorreto, edite o nick manualmente.</div>`;
        }
      } else if (feedback) {
        feedback.innerHTML = '<span class="text-amber-600">Não foi possível confirmar o nick agora. Digite o nick manualmente e continue normalmente.</span>';
      }
    } catch (error) {
      const message = error?.name === 'AbortError'
        ? 'A API demorou demais para responder.'
        : 'Jogador não encontrado ou erro na API.';
      if (feedback) feedback.innerHTML = `<span class="text-amber-600">${escapeHtml(message)} Digite o nick manualmente e continue.</span>`;
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
    if (select && !select.id) {
      const owner = select.closest('[data-custom-field]')?.dataset.customField || `field-${Math.random().toString(36).slice(2, 9)}`;
      select.id = `marketplace-select-${String(owner).replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 40)}-${Math.random().toString(36).slice(2, 7)}`;
    }
    if (!select || select.dataset.rqDdInit === '1') {
      if (select) syncMarketplaceCustomSelect(select);
      return;
    }
    let wrap = select.closest('.rq-select-wrap');
    if (!wrap && select.parentElement) {
      wrap = document.createElement('div');
      wrap.className = 'rq-select-wrap relative';
      select.parentElement.insertBefore(wrap, select);
      wrap.appendChild(select);
    }
    wrap = wrap || select.parentElement;
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
    document.querySelectorAll('select[data-marketplace-custom-select="true"]').forEach((select) => enhanceMarketplaceCustomSelect(select));
  }

  function ensureMarketplaceRequestModal() {
    let dynamicModal = document.getElementById('request-modal-dynamic');

    const staticModal = document.getElementById('request-modal');
    const staticForm = document.getElementById('request-form');
    const staticModes = document.getElementById('request-modes');
    const staticId = document.getElementById('applicant-id');
    const staticNick = document.getElementById('applicant-nick');
    const staticContactType = document.getElementById('applicant-contact-type');
    const staticWhatsapp = document.getElementById('applicant-whatsapp');
    const staticWhatsappDdi = document.getElementById('applicant-whatsapp-ddi');

    const staticModalIsComplete = !!(staticModal && staticForm && staticModes && staticId && staticNick && staticContactType && staticWhatsapp && staticWhatsappDdi);

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
                <label for="applicant-contact-type-dynamic" class="mb-2 block text-sm font-bold text-slate-700">Contato</label>
                <div class="rq-select-wrap relative">
                  <select id="applicant-contact-type-dynamic" data-marketplace-custom-select="true" class="w-full appearance-none rounded-2xl border border-slate-200 bg-white px-4 py-3 pr-11 text-sm font-semibold outline-none focus:border-emerald-400 focus:ring-4 focus:ring-emerald-100">
                    <option value="whatsapp">WhatsApp</option>
                    <option value="instagram">Instagram</option>
                    <option value="discord">Discord</option>
                  </select>
                  <i data-lucide="chevron-down" class="pointer-events-none absolute right-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500"></i>
                </div>
                <div id="applicant-contact-value-wrap-dynamic" class="mt-2 grid grid-cols-[132px_minmax(0,1fr)] gap-2">
                  <select id="applicant-whatsapp-ddi-dynamic" class="rounded-2xl border border-slate-200 bg-white px-3 py-3 text-sm font-semibold outline-none focus:border-emerald-400 focus:ring-4 focus:ring-emerald-100">${getMarketplaceCountrySelectOptions()}</select>
                  <input id="applicant-whatsapp-dynamic" type="text" inputmode="tel" placeholder="DDD + número" class="w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm outline-none focus:border-emerald-400 focus:ring-4 focus:ring-emerald-100">
                </div>
                <p id="applicant-contact-help-dynamic" class="mt-1.5 text-xs text-slate-400">Informe DDD e número.</p>
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
    els.applicantContactType = staticModalIsComplete ? staticContactType : document.getElementById('applicant-contact-type-dynamic');
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

  function ensureMarketplaceCustomFieldsContainer() {
    if (!els.form) return null;
    const legacyModes = document.getElementById('request-modes') || document.getElementById('request-modes-dynamic');
    legacyModes?.parentElement?.classList.add('hidden');
    els.applicantAge?.closest('.grid.gap-4')?.classList.add('hidden');
    let wrap = els.form.querySelector('[data-marketplace-custom-fields]');
    if (wrap) return wrap;
    wrap = document.createElement('div');
    wrap.dataset.marketplaceCustomFields = 'true';
    wrap.className = 'space-y-4';
    const submit = els.form.querySelector('button[type="submit"]');
    const reference = submit?.parentElement === els.form ? submit : submit?.parentElement;
    if (reference?.parentElement === els.form) els.form.insertBefore(wrap, reference);
    else els.form.appendChild(wrap);
    return wrap;
  }
  function renderMarketplaceApplicationFields(item) {
    const wrap = ensureMarketplaceCustomFieldsContainer();
    if (!wrap) return;
    const fields = getMarketplaceApplicationFields(item);
    if (!fields.length) {
      wrap.innerHTML = '<div class="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-500">Essa guilda não adicionou perguntas extras.</div>';
      return;
    }
    wrap.innerHTML = fields.map((field) => {
      const requiredMark = field.required ? '<span class="text-red-500">*</span>' : '<span class="font-normal text-slate-400">(opcional)</span>';
      const common = `data-custom-field-input="${escapeHtml(field.id)}" class="mt-1 w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm outline-none focus:border-emerald-400 focus:ring-4 focus:ring-emerald-100"`;
      let control = '';
      if (field.type === 'select' || field.type === 'boolean') {
        const options = field.type === 'boolean' ? ['Sim', 'Não'] : field.options;
        control = `<div class="rq-select-wrap mt-1"><select data-custom-field-input="${escapeHtml(field.id)}" data-marketplace-custom-select="true" class="rq-select"><option value="">Selecione</option>${options.map((option) => `<option value="${escapeHtml(option)}">${escapeHtml(option)}</option>`).join('')}</select><i data-lucide="chevron-down"></i></div>`;
      } else if (field.type === 'multiselect') {
        control = `<div class="mt-2 grid grid-cols-2 gap-2">${field.options.map((option) => `
          <label class="flex min-w-0 cursor-pointer items-center gap-2 rounded-2xl border border-slate-200 px-3 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50">
            <input data-custom-field-input="${escapeHtml(field.id)}" type="checkbox" value="${escapeHtml(option)}" class="h-4 w-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500">
            <span class="break-words">${escapeHtml(option)}</span>
          </label>`).join('')}</div>`;
      } else {
        control = `<input ${common} type="text" maxlength="35" placeholder="Escreva sua resposta (até 35 caracteres)">`;
      }
      return `<div data-custom-field="${escapeHtml(field.id)}">
        <label class="text-xs font-semibold text-slate-500">${escapeHtml(field.label)} ${requiredMark}</label>
        ${control}
      </div>`;
    }).join('');
    initMarketplaceCustomSelects();
    initIcons();
  }
  function collectMarketplaceCustomAnswers() {
    const fields = getMarketplaceApplicationFields(activeRecruitment || {});
    const answers = [];
    for (const field of fields) {
      const inputs = [...els.form.querySelectorAll('[data-custom-field-input]')]
        .filter((input) => String(input.dataset.customFieldInput || '') === field.id);
      const value = field.type === 'multiselect'
        ? inputs.filter((input) => input.checked).map((input) => String(input.value || '').trim()).filter(Boolean).join(' | ')
        : String(inputs[0]?.value || '').trim();
      if (field.required && !value) {
        showToast('error', `Responda: ${field.label}`);
        return null;
      }
      if (!value) continue;
      if (marketplaceContainsLink(value)) {
        showToast('error', `Remova links da resposta: ${field.label}`);
        return null;
      }
      if (marketplaceContainsBlockedContent(value)) {
        showToast('error', `A resposta "${field.label}" contém conteúdo impróprio.`);
        return null;
      }
      answers.push({ id: field.id, label: field.label, type: field.type, value: value.slice(0, field.type === 'text' ? 35 : 240) });
    }
    const answerById = (id) => answers.find((answer) => answer.id === id)?.value || '';
    return {
      answers,
      roles: answerById('legacy_roles').split('|').map((value) => value.trim()).filter(Boolean).slice(0, 8),
      age: answerById('legacy_age'),
      availableTime: answerById('legacy_availability'),
      availableFridaySaturday: answerById('legacy_weekend'),
      playedGg: answerById('legacy_gg'),
      hasNickChange: answerById('legacy_nick_change')
    };
  }

  function openMarketplaceRequestModal(item) {
    ensureMarketplaceRequestModal();
    if (!els.modal || !els.form) return;
    els.form.reset();
    if (els.applicantContactType) els.applicantContactType.value = 'whatsapp';
    if (els.applicantWhatsappDdi) els.applicantWhatsappDdi.value = DEFAULT_WHATSAPP_COUNTRY_CODE;
    if (els.applicantAge) els.applicantAge.value = '';
    if (els.applicantAvailability) els.applicantAvailability.value = '';
    if (els.applicantWeekend) els.applicantWeekend.value = '';
    if (els.applicantGg) els.applicantGg.value = '';
    if (els.applicantNickChange) els.applicantNickChange.value = '';
    syncMarketplaceWhatsappConstraints();
    initMarketplaceCustomSelects();
    [els.applicantContactType, els.applicantWhatsappDdi, els.applicantAge, els.applicantAvailability, els.applicantWeekend, els.applicantGg, els.applicantNickChange].forEach((select) => { if (select) syncMarketplaceCustomSelect(select); });
    resetMarketplaceNickLookupState();
    if (els.modalGuild) els.modalGuild.textContent = item?.guildName || 'Guilda';
    if (els.helper) els.helper.textContent = 'Preencha seus dados para enviar a solicitação para essa guilda.';
    renderMarketplaceApplicationFields(item);
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

  function marketplaceFirestoreCode(error) {
    return String(error?.code || '').replace(/^firestore\//, '').trim().toLowerCase();
  }

  function marketplaceErrorDetails(error) {
    const code = marketplaceFirestoreCode(error) || 'erro-desconhecido';
    const rawMessage = String(error?.message || error || 'O Firebase não informou detalhes.')
      .replace(/^FirebaseError:\s*/i, '')
      .replace(/\s+/g, ' ')
      .trim();
    const message = rawMessage
      .replace(new RegExp(`^\\[?${code.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\]?\\s*:?\\s*`, 'i'), '')
      .slice(0, 220);
    return { code, message: message || 'O Firebase não informou detalhes.' };
  }

  function marketplaceWriteCanRetry(error) {
    return ['aborted', 'deadline-exceeded', 'internal', 'resource-exhausted', 'unavailable']
      .includes(marketplaceFirestoreCode(error));
  }

  async function saveMarketplaceRequest(reqRef, payload) {
    let lastError = null;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        await setDoc(reqRef, payload);
        return;
      } catch (error) {
        lastError = error;
        if (!marketplaceWriteCanRetry(error) || attempt > 0) throw error;
        await new Promise((resolve) => setTimeout(resolve, 700));
      }
    }
    throw lastError;
  }

  async function marketplaceRequestAlreadyExists(reqRef) {
    try {
      const snap = await getDoc(reqRef);
      return snap.exists();
    } catch (_) {
      return false;
    }
  }

  async function submitMarketplaceRequest(event) {
    event.preventDefault();
    if (marketplaceSubmitting) return;
    if (!activeRecruitment?.id) return;
    const applicantId = normalizeDigits(els.applicantId?.value || '');
    const applicantNick = String(els.applicantNick?.value || '').trim();
    const contactPayload = buildMarketplaceContactPayload(
      els.applicantContactType?.value || 'whatsapp',
      els.applicantWhatsapp?.value || '',
      els.applicantWhatsappDdi?.value || DEFAULT_WHATSAPP_COUNTRY_CODE
    );
    if (!applicantId) { showToast('error', 'Informe seu ID.'); return; }
    if (!applicantNick) { showToast('error', 'Informe seu nick.'); return; }
    if (marketplaceContainsLink(applicantNick)) { showToast('error', 'Remova links do nick.'); return; }
    if (marketplaceContainsBlockedContent(applicantNick)) { showToast('error', 'O nick contém conteúdo impróprio.'); return; }
    if (!contactPayload.value) { showToast('error', `Informe seu ${contactPayload.label}.`); return; }
    if (!contactPayload.valid) {
      const contactError = contactPayload.type === 'whatsapp'
        ? `Informe um WhatsApp válido para ${contactPayload.label}: ${contactPayload.maxDigits} dígitos incluindo DDD/área.`
        : `Informe um usuário válido do ${contactPayload.label}.`;
      showToast('error', contactError);
      return;
    }
    const customForm = collectMarketplaceCustomAnswers();
    if (!customForm) return;
    const submitBtn = els.form?.querySelector('button[type="submit"]');
    marketplaceSubmitting = true;
    setMarketplaceButtonBusy(submitBtn, true, 'Enviando...');
    const reqRef = activeRecruitmentRequestDocRef(activeRecruitment.id, applicantId);
    try {
      await saveMarketplaceRequest(reqRef, {
        id: applicantId,
        nick: applicantNick,
        contactType: contactPayload.type,
        contactValue: contactPayload.value,
        contactCountryCode: contactPayload.countryCode,
        whatsapp: contactPayload.type === 'whatsapp' ? contactPayload.value : '',
        whatsappCountryCode: contactPayload.type === 'whatsapp' ? contactPayload.countryCode : '',
        instagram: contactPayload.type === 'instagram' ? contactPayload.value : '',
        discord: contactPayload.type === 'discord' ? contactPayload.value : '',
        roles: customForm.roles,
        age: customForm.age,
        availableTime: customForm.availableTime,
        availableFridaySaturday: customForm.availableFridaySaturday,
        playedGg: customForm.playedGg,
        hasNickChange: customForm.hasNickChange,
        customAnswers: customForm.answers,
        formVersion: 2,
        status: 'pendente',
        guildId: activeRecruitment.id,
        guildName: activeRecruitment.guildName || '',
        createdAt: serverTimestamp()
      });
      closeMarketplaceRequestModal();
      showToast('success', 'Pedido enviado com sucesso!');
    } catch (err) {
      console.error(err);
      const code = marketplaceFirestoreCode(err);
      if (code === 'permission-denied' && await marketplaceRequestAlreadyExists(reqRef)) {
        showToast('error', 'Já existe uma solicitação enviada com esse ID.');
      } else {
        const details = marketplaceErrorDetails(err);
        showToast('error', `Erro ao enviar [${details.code}]: ${details.message}`);
      }
    } finally {
      marketplaceSubmitting = false;
      setMarketplaceButtonBusy(submitBtn, false);
    }
  }
  function setStatus(msg=''){ if (els.status) els.status.textContent = msg; }
  function itemMatchesFilter(item, value) {
    if (!value || value === 'all') return true;
    const test = String(value).toLowerCase();
    const customValues = getMarketplaceDisplaySections(item).flatMap((section) => section.items);
    const arrays = [item.guildType || [], item.focus || [], item.roles || [], item.contacts || [], customValues].flat().map(v => String(v).toLowerCase());
    return arrays.includes(test);
  }
  function itemMatchesQuery(item, value) {
    const q = String(value || '').trim().toLowerCase();
    if (!q) return true;
    const customText = getMarketplaceDisplaySections(item).flatMap((section) => [section.title, ...section.items]);
    const hay = [item.id, item.guildName, item.description, item.platform, item.minimumAge, item.nickChangeRequired, item.nickChangeDeadline, item.teamPlay, item.useCall, ...(item.roles || []), ...(item.contacts || []), ...(item.guildType || []), ...(item.focus || []), ...customText].join(' ').toLowerCase();
    return hay.includes(q);
  }
  function syncUrl(){
    const sp = new URLSearchParams(window.location.search);
    const storedRef = getStoredPartnerRef();
    if (storedRef && !sp.get('ref')) sp.set('ref', storedRef);
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
      const photoSrc = recruitmentPhotoSrc(item);
      const photo = photoSrc ? `<img src="${escapeHtml(photoSrc)}" alt="${escapeHtml(item.guildName || 'Guilda')}" class="h-16 w-16 rounded-2xl object-cover border border-slate-200 bg-slate-100">` : '<div class="h-16 w-16 rounded-2xl border border-slate-200 bg-slate-100"></div>';
      const customSections = renderMarketplaceDisplaySections(item);
      return `<article class="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm"><div class="flex items-start gap-3"><div class="shrink-0">${photo}</div><div class="min-w-0 flex-1"><div class="flex items-start justify-between gap-3"><div class="min-w-0"><h3 class="truncate text-base font-black text-slate-900">${escapeHtml(item.guildName || 'Sem nome')}</h3><p class="mt-1 text-xs text-slate-500">${escapeHtml(formatDateBR(item.createdAt || item.updatedAt || item.dateMs || Date.now()))}</p></div><span class="inline-flex rounded-full bg-emerald-50 px-2.5 py-1 text-[11px] font-extrabold text-emerald-700 ring-1 ring-emerald-200">ABERTO</span></div></div></div><div class="mt-4 space-y-3"><div><p class="mb-2 text-xs font-semibold text-slate-500">Descrição</p><div class="rounded-2xl border border-slate-200 bg-slate-50 px-3 py-3 text-sm text-slate-700 whitespace-pre-wrap">${escapeHtml(item.description || 'Sem descrição.')}</div></div>${customSections}<button type="button" data-open-request="${escapeHtml(item.id)}" class="inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-slate-900 px-4 py-3 text-sm font-extrabold text-white hover:bg-slate-800"><i data-lucide="send" class="h-4 w-4"></i>Enviar pedido</button></div></article>`;
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

  function buildMarketplaceRandomCursor() {
    const length = 20;
    const values = new Uint32Array(length);
    if (window.crypto?.getRandomValues) {
      window.crypto.getRandomValues(values);
    }
    return Array.from({ length }, (_, index) => {
      const fallback = Math.floor(Math.random() * MARKETPLACE_DOC_ID_RANDOM_ALPHABET.length);
      const value = values[index] || fallback;
      return MARKETPLACE_DOC_ID_RANDOM_ALPHABET[value % MARKETPLACE_DOC_ID_RANDOM_ALPHABET.length];
    }).join('');
  }

  function resetMarketplaceRandomPagination() {
    marketplaceRandomCursor = buildMarketplaceRandomCursor();
    marketplaceWrapped = false;
    marketplaceReachedCursor = false;
    marketplaceSeenIds = new Set();
  }

  async function getMarketplaceRandomDocsBatch(pageSize = MARKETPLACE_PAGE_SIZE) {
    const docs = [];
    let stop = false;
    let attempts = 0;

    while (docs.length < pageSize && !stop && attempts < 4) {
      attempts += 1;
      const pageLimit = pageSize - docs.length;
      const constraints = [orderBy(documentId())];

      if (lastMarketplaceDoc) {
        constraints.push(startAfter(lastMarketplaceDoc));
      } else if (!marketplaceWrapped && marketplaceRandomCursor) {
        constraints.push(startAt(marketplaceRandomCursor));
      }

      constraints.push(limit(pageLimit));
      const snap = await getDocs(query(activeRecruitmentsCollection(), ...constraints));

      if (!snap.docs.length) {
        if (!marketplaceWrapped) {
          marketplaceWrapped = true;
          lastMarketplaceDoc = null;
          continue;
        }
        stop = true;
        break;
      }

      lastMarketplaceDoc = snap.docs[snap.docs.length - 1] || lastMarketplaceDoc;

      for (const docSnap of snap.docs) {
        const id = String(docSnap.id || '');
        if (marketplaceWrapped && marketplaceRandomCursor && id >= marketplaceRandomCursor) {
          marketplaceReachedCursor = true;
          stop = true;
          break;
        }
        if (marketplaceSeenIds.has(id)) continue;
        marketplaceSeenIds.add(id);
        docs.push(docSnap);
        if (docs.length >= pageSize) break;
      }

      if (snap.docs.length < pageLimit) {
        if (!marketplaceWrapped) {
          marketplaceWrapped = true;
          lastMarketplaceDoc = null;
          continue;
        }
        stop = true;
      }
    }

    marketplaceHasMore = docs.length === pageSize && !marketplaceReachedCursor && !stop;
    return docs;
  }

  const MARKETPLACE_CACHE_KEY = 'hub_rec_marketplace_cache_v1';
  const MARKETPLACE_CACHE_TTL_MS = 15 * 60 * 1000;

  function readMarketplaceCache() {
    try {
      const raw = localStorage.getItem(MARKETPLACE_CACHE_KEY);
      if (!raw) return null;
      const cached = JSON.parse(raw);
      if (!cached || !Array.isArray(cached.items)) return null;
      const ts = Number(cached.ts || 0);
      return { items: cached.items, ts, fresh: !!ts && (Date.now() - ts) < MARKETPLACE_CACHE_TTL_MS };
    } catch (_) {
      return null;
    }
  }

  function writeMarketplaceCache(items = []) {
    try {
      localStorage.setItem(MARKETPLACE_CACHE_KEY, JSON.stringify({ items: Array.isArray(items) ? items : [], ts: Date.now() }));
    } catch (_) {}
  }

  function getInitialMarketplaceSearch() {
    const queryValue = String(params.get('q') || '').trim();
    const referralValue = sanitizePartnerRef(params.get('ref') || getStoredPartnerRef());
    return referralValue && queryValue === referralValue ? '' : queryValue;
  }

  function renderMarketplaceFromItems(items = []) {
    allItems = (Array.isArray(items) ? items : []).filter(item => item && item.guildName);
    els.q.value = getInitialMarketplaceSearch();
    els.filter.value = params.get('filter') || 'all';
    applyFilters();
  }

  function ensureMarketplaceLoadMoreButton() {
    if (!els.grid?.parentElement) return null;
    let btn = document.getElementById('marketplace-load-more');
    if (btn) return btn;
    btn = document.createElement('button');
    btn.id = 'marketplace-load-more';
    btn.type = 'button';
    btn.className = 'mx-auto mt-5 hidden items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-white px-5 py-3 text-sm font-extrabold text-slate-700 shadow-sm hover:bg-slate-50';
    btn.innerHTML = '<i data-lucide="chevrons-down" class="h-4 w-4"></i>Carregar mais';
    els.grid.parentElement.appendChild(btn);
    btn.addEventListener('click', () => loadMarketplace(false));
    return btn;
  }

  function syncMarketplaceLoadMoreButton() {
    const btn = ensureMarketplaceLoadMoreButton();
    if (!btn) return;
    const hasExactSearch = !!String(els.q?.value || '').trim();
    btn.classList.toggle('hidden', !marketplaceHasMore || hasExactSearch || marketplaceLoading);
    btn.classList.toggle('inline-flex', marketplaceHasMore && !hasExactSearch && !marketplaceLoading);
    btn.disabled = marketplaceLoading;
    initIcons();
  }

  function marketplaceSearchVariants(value = '') {
    const raw = String(value || '').trim();
    if (!raw) return [];
    const title = raw.charAt(0).toUpperCase() + raw.slice(1).toLowerCase();
    return [...new Set([raw, raw.toUpperCase(), raw.toLowerCase(), title])];
  }

  async function searchMarketplace(searchTerm) {
    const results = new Map();
    const term = String(searchTerm || '').trim();
    if (!term) return [];

    const localItems = [
      ...allItems,
      ...(readMarketplaceCache()?.items || [])
    ];
    localItems
      .filter((item) => itemMatchesQuery(item, term))
      .forEach((item) => results.set(String(item.id), item));

    const directDoc = !term.includes('/')
      ? await getDoc(activeRecruitmentDocRef(term)).catch(() => null)
      : null;
    if (directDoc?.exists()) {
      const item = { id: directDoc.id, ...directDoc.data() };
      if (item.guildName) results.set(String(item.id), item);
    }

    for (const variant of marketplaceSearchVariants(term)) {
      if (results.size >= MARKETPLACE_PAGE_SIZE) break;
      const snap = await getDocs(query(
        activeRecruitmentsCollection(),
        orderBy('guildName'),
        startAt(variant),
        endAt(`${variant}\uf8ff`),
        limit(MARKETPLACE_PAGE_SIZE)
      )).catch(() => null);
      snap?.docs?.forEach((docSnap) => {
        const item = { id: docSnap.id, ...docSnap.data() };
        if (item.guildName && itemMatchesQuery(item, term)) results.set(String(item.id), item);
      });
    }

    return Array.from(results.values()).slice(0, MARKETPLACE_PAGE_SIZE);
  }

  async function loadMarketplace() {
    const reset = arguments.length ? arguments[0] !== false : true;
    if (marketplaceLoading) return;
    if (!els.q?.dataset.initialized) {
      els.q.value = getInitialMarketplaceSearch();
      els.q.dataset.initialized = '1';
      els.filter.value = params.get('filter') || 'all';
    }
    const searchTerm = String(els.q?.value || '').trim();
    if (reset) {
      lastMarketplaceDoc = null;
      marketplaceHasMore = true;
      allItems = [];
      resetMarketplaceRandomPagination();
    }
    marketplaceLoading = true;
    syncMarketplaceLoadMoreButton();
    try {
      if (searchTerm) {
        setStatus('Buscando recrutamento...');
        allItems = await searchMarketplace(searchTerm);
        marketplaceHasMore = false;
        syncUrl();
        setStatus(`${allItems.length} recrutamento${allItems.length === 1 ? '' : 's'} encontrado${allItems.length === 1 ? '' : 's'}.`);
        renderGrid(allItems);
        return;
      }
      if (!marketplaceHasMore && !reset) return;
      if (reset) setStatus('Carregando recrutamentos...');
      const docs = await getMarketplaceRandomDocsBatch(MARKETPLACE_PAGE_SIZE);
      const freshItems = shuffleMarketplaceItems(docs.map(d => ({ id:d.id, ...d.data() })).filter(item => item && item.guildName));
      const merged = new Map((reset ? [] : allItems).map(item => [String(item.id), item]));
      freshItems.forEach((item) => merged.set(String(item.id), item));
      allItems = Array.from(merged.values());
      writeMarketplaceCache(allItems);
      applyFilters();
      return;
    } catch (err) {
      console.error(err);
      if (!allItems.length) setStatus('Erro ao carregar recrutamentos.');
    } finally {
      marketplaceLoading = false;
      syncMarketplaceLoadMoreButton();
    }
    return;

    const cached = readMarketplaceCache();
    if (cached?.items?.length) {
      renderMarketplaceFromItems(cached.items);
      if (cached.fresh) return;
    }

    try {
      if (!cached?.items?.length) setStatus('Carregando recrutamentos...');
      const snap = await getDocs(activeRecruitmentsCollection());
      const freshItems = snap.docs.map(d => ({ id:d.id, ...d.data() })).filter(item => item && item.guildName);
      writeMarketplaceCache(freshItems);
      renderMarketplaceFromItems(freshItems);
    } catch (err) {
      console.error(err);
      if (!cached?.items?.length) setStatus('Erro ao carregar recrutamentos.');
    }
  }
  let marketplaceSearchTimer = null;
  els.q?.addEventListener('input', () => {
    clearTimeout(marketplaceSearchTimer);
    marketplaceSearchTimer = setTimeout(() => loadMarketplace(true), 500);
  });
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

// Sidebar publico migrado de eventos-inline-2.js
(function(){
      const openBtn = document.getElementById('sidebar-open');
      const closeBtn = document.getElementById('sidebar-close');
      const overlay = document.getElementById('sidebar-overlay');
      const sidebar = document.getElementById('sidebar');
      function open(){ overlay.classList.remove('hidden'); sidebar.classList.remove('-translate-x-full'); document.body.style.overflow='hidden'; }
      function close(){ overlay.classList.add('hidden'); sidebar.classList.add('-translate-x-full'); document.body.style.overflow=''; }
      openBtn?.addEventListener('click', open);
      closeBtn?.addEventListener('click', close);
      overlay?.addEventListener('click', close);
      document.addEventListener('keydown', (e)=>{ if(e.key==='Escape') close(); });
    })();
    lucide.createIcons();

