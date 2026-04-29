// loginha.js — JS exclusivo da tela loginha.html

import { initializeApp, getApps } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  getFirestore,
  collection,
  query,
  where,
  getDocs,
  doc,
  getDoc,
  setDoc,
  addDoc,
  runTransaction,
  serverTimestamp,
  deleteDoc,
  limit
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { setupSidebar, initIcons, logout, showToast, auth, db } from './logic.js';

const lojaFirebaseConfig = {
  apiKey: "AIzaSyBhh2XfGhXVWUb4CLqFFoPlsm5HoPWRmfI",
  authDomain: "loja-ghub.firebaseapp.com",
  projectId: "loja-ghub",
  storageBucket: "loja-ghub.firebasestorage.app",
  messagingSenderId: "962251157944",
  appId: "1:962251157944:web:5425e77385dd9239af5f4d",
  measurementId: "G-GFP5SEEP2E"
};

const lojaApp = getApps().find((app) => app.name === 'loja-ghub') || initializeApp(lojaFirebaseConfig, 'loja-ghub');
const lojaDb = getFirestore(lojaApp);

const qs = (id) => document.getElementById(id);
const normalizeDigits = (v) => String(v ?? '').replace(/\D+/g, '');
const normalizeEmail = (v) => String(v ?? '').trim().toLowerCase();
const escapeHtml = (str) => String(str ?? '')
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')
  .replaceAll("'", '&#039;');
const moneyBRL = (value) => Number(value || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

const DEFAULT_CATEGORIES = [
  { id: 'conta', nome: 'Conta', ordem: 1 },
  { id: 'codiguin', nome: 'Codiguin', ordem: 2 },
  { id: 'passe', nome: 'Passe', ordem: 3 },
  { id: 'diamante', nome: 'Diamante', ordem: 4 },
  { id: 'likes', nome: 'Likes', ordem: 5 },
  { id: 'skin', nome: 'Skin', ordem: 6 }
];

const SELLER_FEE_RATE = 0.06;
const SELLER_FEE_PERCENT = 6;
const SELLER_WITHDRAW_MIN = 20;
const SELLER_RELEASE_DAYS = 3;
const BUYER_INFO_CATEGORIES = new Set(['passe', 'diamante', 'likes', 'skin']);
const SELLER_DELIVERY_INFO_CATEGORIES = new Set(['conta', 'codiguin']);
const VERIFICATION_COLLECTION = 'verificacao';
const CHAT_COLLECTION = 'chatsTemporarios';
const CHAT_TYPE_SELLER = 'vendedor';
const CHAT_TYPE_SUPPORT = 'suporte';
const SELLER_CHAT_HOURS = 24;
const SUPPORT_CHAT_HOURS = 48;
const ADMIN_COLLECTION = 'admin';
const ADMIN_DOC_ID = 'security';
const PRODUCT_REPORT_COLLECTION = 'denunciasProdutos';
const SELLER_RATING_COLLECTION = 'avaliacoesVendedores';

const els = {
  topSellerBtn: qs('btn-top-seller'),
  topSellerAvatarWrap: qs('seller-top-avatar-wrap'),
  topSellerAvatar: qs('seller-top-avatar'),
  topSellerAvatarIcon: qs('seller-top-avatar-icon'),
  sellerProfileBtn: qs('btn-seller-profile'),
  buyerProfileBtn: qs('btn-buyer-profile'),
  supportPanelBtn: qs('btn-support-panel'),
  toggleSellerFormBtn: qs('btn-toggle-seller-form'),
  toggleSellerProductsBtn: qs('btn-toggle-seller-products'),
  sellerProductsCard: qs('seller-products-card'),

  search: qs('store-search'),
  category: qs('store-category'),
  sellerCategory: qs('seller-product-category'),
  clearFiltersBtn: qs('btn-clear-filters'),
  chips: qs('category-chips'),
  counter: qs('products-counter'),
  loading: qs('products-loading'),
  empty: qs('products-empty'),
  grid: qs('products-grid'),

  productModal: qs('product-modal'),
  productModalTitle: qs('modal-product-title'),
  productModalBody: qs('modal-product-body'),

  buyerModal: qs('buyer-modal'),
  buyerOrdersCounter: qs('buyer-orders-counter'),
  buyerOrdersList: qs('buyer-orders-list'),

  sellerModal: qs('seller-modal'),
  sellerModalSubtitle: qs('seller-modal-subtitle'),
  sellerProfileCard: qs('seller-profile-card'),
  sellerForm: qs('seller-product-form'),
  sellerFormTitle: qs('seller-product-form-title'),
  sellerFormSubtitle: qs('seller-product-form-subtitle'),
  sellerTitle: qs('seller-product-title'),
  sellerPrice: qs('seller-product-price'),
  sellerStock: qs('seller-product-stock'),
  sellerImage: qs('seller-product-image'),
  sellerProductFile: qs('seller-product-file'),
  sellerProductPhotoStatus: qs('seller-product-photo-status'),
  sellerDescription: qs('seller-product-description'),
  sellerActive: qs('seller-product-active'),
  sellerFeatured: qs('seller-product-featured'),
  saveSellerProductBtn: qs('btn-save-seller-product'),
  cancelProductEditBtn: qs('btn-cancel-product-edit'),
  reloadSellerDataBtn: qs('btn-reload-seller-data'),
  sellerProductsCounter: qs('seller-products-counter'),
  sellerProductsList: qs('seller-products-list'),
  sellerOrdersCounter: qs('seller-orders-counter'),
  sellerOrdersList: qs('seller-orders-list'),

  verificationModal: qs('seller-verification-modal'),
  verificationForm: qs('seller-verification-form'),
  verificationSubtitle: qs('seller-verification-subtitle'),
  verificationStatus: qs('seller-verification-status'),
  verificationPaperText: qs('verification-paper-text'),
  verificationFullName: qs('verification-full-name'),
  verificationBirthDate: qs('verification-birth-date'),
  verificationRgFront: qs('verification-rg-front'),
  verificationRgBack: qs('verification-rg-back'),
  verificationFrontStatus: qs('verification-front-status'),
  verificationBackStatus: qs('verification-back-status'),
  submitVerificationBtn: qs('btn-submit-verification'),

  problemModal: qs('problem-modal'),
  problemForm: qs('problem-form'),
  problemModalTitle: qs('problem-modal-title'),
  problemOrderSubtitle: qs('problem-order-subtitle'),
  problemOrderSummary: qs('problem-order-summary'),
  problemChatStatus: qs('problem-chat-status'),
  problemChatMessages: qs('problem-chat-messages'),
  problemDescription: qs('problem-description'),
  submitProblemBtn: qs('btn-submit-problem'),
  resolveChatBtn: qs('btn-resolve-chat'),
  escalateChatBtn: qs('btn-escalate-chat'),

  supportModal: qs('support-modal'),
  supportVerificationsCounter: qs('support-verifications-counter'),
  supportVerificationsList: qs('support-verifications-list'),
  supportChatsCounter: qs('support-chats-counter'),
  supportChatsList: qs('support-chats-list'),
  reloadSupportPanelBtn: qs('btn-reload-support-panel'),
  supportReportsCounter: qs('support-reports-counter'),
  supportReportsList: qs('support-reports-list'),
  imageViewerModal: qs('image-viewer-modal'),
  imageViewerImg: qs('image-viewer-img'),

  userRole: qs('user-role'),
  userEmail: qs('user-email'),
  sidebarAvatar: qs('sidebar-avatar'),
  sidebarAvatarIcon: qs('sidebar-avatar-icon')
};

let currentUser = null;
let ghubProfile = null;
let lojaStatus = { comprador: null, vendedor: null };
let categories = [...DEFAULT_CATEGORIES];
let products = [];
let filteredProducts = [];
let sellerProducts = [];
let sellerOrders = [];
let buyerOrders = [];
let buyerProblems = [];
let sellerChats = [];
let supportChats = [];
let supportVerifications = [];
let supportReports = [];
let isSupportAdmin = false;
let sellerVerification = null;
let activeProblemOrderId = '';
let activeProblemChatId = '';
let activeProblemChatType = '';
let verificationRgFrontBase64 = '';
let verificationRgBackBase64 = '';
let loadingProducts = false;
let loadingStatus = false;
let loadingSellerPanel = false;
let editingProductId = '';
let selectedProductImageBase64 = '';

function localToast(type, message) {
  if (typeof showToast === 'function') {
    showToast(type, message);
    return;
  }

  const box = qs('toast-container');
  if (!box) return;
  const color = type === 'success'
    ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
    : type === 'error'
      ? 'border-red-200 bg-red-50 text-red-800'
      : 'border-slate-200 bg-white text-slate-800';
  const icon = type === 'success' ? 'check-circle' : type === 'error' ? 'alert-circle' : 'info';
  const el = document.createElement('div');
  el.className = `pointer-events-auto flex items-start gap-2 rounded-2xl border px-4 py-3 text-sm font-semibold shadow-lg ${color}`;
  el.innerHTML = `<i data-lucide="${icon}" class="mt-0.5 h-4 w-4 shrink-0"></i><span>${escapeHtml(message)}</span>`;
  box.appendChild(el);
  initIcons();

  setTimeout(() => {
    el.style.opacity = '0';
    el.style.transform = 'translateY(-6px)';
    el.style.transition = 'all .2s ease';
    setTimeout(() => el.remove(), 220);
  }, 3800);
}

function setButtonLoading(btn, loading, htmlWhenReady) {
  if (!btn) return;
  btn.disabled = !!loading;
  btn.innerHTML = loading
    ? '<i data-lucide="loader-2" class="w-4 h-4 animate-spin"></i> Processando...'
    : htmlWhenReady;
  initIcons();
}

function setProductsLoading(visible) {
  loadingProducts = visible;
  els.loading?.classList.toggle('hidden', !visible);
  if (visible) {
    els.empty?.classList.add('hidden');
    if (els.grid) els.grid.innerHTML = '';
  }
}

function getTodayBRDate() {
  return new Date().toLocaleDateString('pt-BR');
}

function getVerificationPaperText() {
  return `guildahub + ${getTodayBRDate()}`;
}

function getVerificationStatusLabel(status) {
  const s = String(status || '').toLowerCase();
  if (s === 'aprovado' || s === 'approved') return 'aprovado';
  if (s === 'recusado' || s === 'rejected') return 'recusado';
  if (s === 'pendente' || s === 'pending') return 'pendente';
  return '';
}

function setMobileCollapsibleState(target, btn, open, openLabel = 'Fechar', closedLabel = 'Abrir/editar') {
  if (!target) return;
  target.classList.toggle('hidden', !open);
  if (btn) btn.textContent = open ? openLabel : closedLabel;
}

function setVerificationImageStatus(type, message) {
  const el = type === 'front' ? els.verificationFrontStatus : els.verificationBackStatus;
  if (el) el.textContent = message;
}


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

async function compressImageToBase64(file, maxBytes = 950 * 1024) {
  if (!file || !String(file.type || '').startsWith('image/')) {
    throw new Error('Selecione uma imagem válida.');
  }

  const img = await loadImageFromFile(file);
  let width = img.width || 0;
  let height = img.height || 0;
  const maxDim = 1400;

  if (width > maxDim || height > maxDim) {
    const scale = Math.min(maxDim / width, maxDim / height);
    width = Math.max(1, Math.round(width * scale));
    height = Math.max(1, Math.round(height * scale));
  }

  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d', { alpha: false });
  if (!ctx) throw new Error('Canvas indisponível.');

  let quality = 0.82;
  let output = '';
  let attempts = 0;

  while (attempts < 14) {
    canvas.width = width;
    canvas.height = height;
    ctx.clearRect(0, 0, width, height);
    ctx.drawImage(img, 0, 0, width, height);
    output = canvas.toDataURL('image/jpeg', quality);

    if (dataUrlSizeBytes(output) <= maxBytes) return output;

    if (quality > 0.48) {
      quality -= 0.08;
    } else {
      width = Math.max(480, Math.round(width * 0.88));
      height = Math.max(480, Math.round(height * 0.88));
    }
    attempts += 1;
  }

  throw new Error('Não foi possível comprimir a imagem abaixo de 1 MB.');
}

function setProductPhotoStatus(message = 'Se enviar arquivo, ele será comprimido abaixo de 1 MB e terá prioridade sobre o link.') {
  if (els.sellerProductPhotoStatus) els.sellerProductPhotoStatus.textContent = message;
}

function timestampToMs(value) {
  if (!value) return 0;
  if (typeof value === 'number') return value;
  if (value instanceof Date) return value.getTime();
  if (typeof value?.toDate === 'function') return value.toDate().getTime();
  if (typeof value?.seconds === 'number') return value.seconds * 1000;
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatDateTimeBR(value) {
  const ms = timestampToMs(value);
  if (!ms) return '-';
  return new Date(ms).toLocaleDateString('pt-BR') + ' ' + new Date(ms).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

function getDeliveredAtMs(order = {}) {
  return Number(order.entregueEmMs || order.entrega?.entregueEmMs || 0)
    || timestampToMs(order.entrega?.entregueEm)
    || timestampToMs(order.entregueEm)
    || timestampToMs(order.updatedAt);
}

function isFinalOrderStatus(status) {
  const s = String(status || '').toLowerCase();
  return s === 'entregue' || s === 'reembolsado';
}

function categoryRequiresBuyerInfo(categoryId) {
  return BUYER_INFO_CATEGORIES.has(normalizeCategoryId(categoryId));
}

function categoryRequiresSellerDeliveryInfo(categoryId) {
  return SELLER_DELIVERY_INFO_CATEGORIES.has(normalizeCategoryId(categoryId));
}

function getBuyerInfoLabel(categoryId) {
  const id = normalizeCategoryId(categoryId);
  if (id === 'passe') return 'Informe o ID da conta/personagem que vai receber o passe.';
  if (id === 'diamante') return 'Informe o ID da conta/personagem que vai receber os diamantes.';
  if (id === 'likes') return 'Informe o ID ou perfil que vai receber os likes.';
  if (id === 'skin') return 'Informe o ID da conta/personagem e detalhes da skin.';
  return 'Informe os dados necessários para o vendedor entregar o pedido.';
}

function getSellerDeliveryInfoLabel(categoryId) {
  const id = normalizeCategoryId(categoryId);
  if (id === 'conta') return 'Dados da conta entregue, login, senha, observações ou instruções.';
  if (id === 'codiguin') return 'Código entregue e instruções para resgate.';
  return 'Informações de entrega para o comprador.';
}

function calculateSellerFinancials(orders = [], sellerData = {}) {
  const now = Date.now();
  const releaseMs = SELLER_RELEASE_DAYS * 24 * 60 * 60 * 1000;
  let saldoBrutoLiberado = 0;
  let saldoBrutoPendente = 0;
  let totalLiquidoEntregue = 0;
  let totalBrutoEntregue = 0;
  let totalVendasEntregues = 0;

  orders.forEach((order) => {
    if (String(order.status || '').toLowerCase() !== 'entregue') return;
    const gross = Number(order.total || order.precoUnitario || 0);
    if (!Number.isFinite(gross) || gross <= 0) return;
    const net = gross * (1 - SELLER_FEE_RATE);
    const deliveredAt = getDeliveredAtMs(order);
    totalVendasEntregues += 1;
    totalBrutoEntregue += gross;
    totalLiquidoEntregue += net;
    if (deliveredAt && now - deliveredAt >= releaseMs) saldoBrutoLiberado += net;
    else saldoBrutoPendente += net;
  });

  const saquePendente = Number(sellerData?.saquePendente ?? sellerData?.financeiro?.saldoEmSaque ?? 0);
  const totalSacado = Number(sellerData?.totalSacado ?? sellerData?.financeiro?.totalSacado ?? 0);
  const saldo = Math.max(0, saldoBrutoLiberado - saquePendente - totalSacado);

  return {
    saldo,
    saldoAtual: saldo,
    saldoPendente: saldoBrutoPendente,
    saldoEmSaque: Math.max(0, saquePendente),
    totalSacado: Math.max(0, totalSacado),
    totalLiquidoEntregue,
    totalBrutoEntregue,
    totalVendasEntregues,
    taxaPercentual: SELLER_FEE_PERCENT,
    saqueMinimo: SELLER_WITHDRAW_MIN,
    liberacaoDias: SELLER_RELEASE_DAYS
  };
}

async function syncSellerFinancialsToFirebase() {
  if (!lojaStatus?.vendedor || !ghubProfile?.gameId) return calculateSellerFinancials(sellerOrders, lojaStatus?.vendedor || {});
  const finances = calculateSellerFinancials(sellerOrders, lojaStatus.vendedor);
  const payload = {
    saldoAtual: finances.saldoAtual,
    saldoPendente: finances.saldoPendente,
    saldoEmSaque: finances.saldoEmSaque,
    totalSacado: finances.totalSacado,
    totalVendas: finances.totalVendasEntregues,
    totalVendasEntregues: finances.totalVendasEntregues,
    financeiro: {
      saldoAtual: finances.saldoAtual,
      saldoPendente: finances.saldoPendente,
      saldoEmSaque: finances.saldoEmSaque,
      totalSacado: finances.totalSacado,
      totalBrutoEntregue: finances.totalBrutoEntregue,
      totalLiquidoEntregue: finances.totalLiquidoEntregue,
      totalVendasEntregues: finances.totalVendasEntregues,
      taxaPercentual: SELLER_FEE_PERCENT,
      saqueMinimo: SELLER_WITHDRAW_MIN,
      liberacaoDias: SELLER_RELEASE_DAYS,
      atualizadoEmMs: Date.now()
    },
    updatedAt: serverTimestamp()
  };
  try {
    await setDoc(doc(lojaDb, 'vendedor', ghubProfile.gameId), payload, { merge: true });
    lojaStatus.vendedor = { ...lojaStatus.vendedor, ...payload };
  } catch (err) {
    console.warn('Não foi possível salvar saldos do vendedor:', err);
  }
  return finances;
}


function sameEmail(a, b) {
  const ea = normalizeEmail(a);
  const eb = normalizeEmail(b);
  return !!ea && !!eb && ea === eb;
}

function profileBelongsToCurrentUser(data, uid, email) {
  if (!data) return false;
  return data.uid === uid || sameEmail(data.email, email) || sameEmail(data.playerEmail, email);
}

async function queryMainUsersByField(field, value) {
  const clean = String(value || '').trim();
  if (!clean) return [];
  const snap = await getDocs(query(collection(db, 'users'), where(field, '==', clean), limit(5)));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

async function findGuildaHubProfile(user) {
  if (!user) return null;

  const uid = user.uid || '';
  const email = user.email || '';
  const found = new Map();

  function add(profile) {
    if (!profile || !profile.id) return;
    found.set(profile.id, profile);
  }

  try {
    const authSnap = await getDoc(doc(db, 'users', uid));
    if (authSnap.exists()) add({ id: authSnap.id, ...authSnap.data() });
  } catch (_) {}

  for (const [field, value] of [
    ['uid', uid],
    ['email', email],
    ['email', normalizeEmail(email)],
    ['playerEmail', email],
    ['playerEmail', normalizeEmail(email)]
  ]) {
    try {
      const list = await queryMainUsersByField(field, value);
      list.forEach(add);
    } catch (_) {}
  }

  const profiles = Array.from(found.values());
  const numericProfile = profiles.find((p) => /^\d+$/.test(String(p.id || '')) && profileBelongsToCurrentUser(p, uid, email));
  const fallback = profiles.find((p) => profileBelongsToCurrentUser(p, uid, email)) || profiles[0] || null;
  const selected = numericProfile || fallback;
  if (!selected) return null;

  const gameId = normalizeDigits(
    /^\d+$/.test(String(selected.id || ''))
      ? selected.id
      : selected.gameIdMigrated || selected.gameId || selected.id || ''
  );

  return {
    ...selected,
    gameId,
    uid,
    email: normalizeEmail(email || selected.email || selected.playerEmail || ''),
    nick: String(selected.nick || selected.nome || selected.name || '').trim(),
    foto: selected.foto || selected.photo || ''
  };
}

function applySidebarUser(profile) {
  if (!currentUser) {
    if (els.userRole) els.userRole.textContent = 'Visitante';
    if (els.userEmail) els.userEmail.textContent = 'Entre para comprar';
    return;
  }

  if (els.userRole) els.userRole.textContent = profile?.nick || 'Meu Perfil';
  if (els.userEmail) els.userEmail.textContent = currentUser.email || 'Logado';

  if (profile?.foto && els.sidebarAvatar && els.sidebarAvatarIcon) {
    els.sidebarAvatar.src = profile.foto;
    els.sidebarAvatar.classList.remove('hidden');
    els.sidebarAvatarIcon.classList.add('hidden');
  }
}

function getProfilePayload() {
  if (!ghubProfile?.gameId) throw new Error('missing-game-id');

  return {
    gameId: ghubProfile.gameId,
    uid: currentUser?.uid || '',
    email: normalizeEmail(currentUser?.email || ghubProfile.email || ''),
    nick: ghubProfile.nick || '',
    foto: ghubProfile.foto || ''
  };
}

function normalizeCategoryId(value) {
  return String(value || '').trim().toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function getCategoryName(categoryId) {
  if (!categoryId) return 'Sem categoria';
  return categories.find((cat) => cat.id === categoryId)?.nome || categoryId;
}

function getProductCategoryId(product) {
  return normalizeCategoryId(product.categoriaId || product.categoryId || product.categoria || product.category || '');
}

function normalizeProduct(docSnap) {
  const data = docSnap.data() || {};
  const categoryId = getProductCategoryId(data);
  const image = data.imagem || data.image || (Array.isArray(data.imagens) ? data.imagens[0] : '') || '';
  const title = String(data.titulo || data.title || data.nome || data.name || 'Produto sem nome').trim();
  const sellerName = String(data.sellerName || data.vendedorNome || data.sellerNome || data.sellerId || 'Vendedor').trim();
  const estoqueAtivo = data.estoqueAtivo !== false;
  const estoqueQuantidade = Number(data.estoqueQuantidade ?? data.estoque ?? 999);

  return {
    id: docSnap.id,
    ...data,
    titulo: title,
    descricao: String(data.descricao || data.description || '').trim(),
    preco: Number(data.preco ?? data.price ?? 0),
    moeda: data.moeda || data.currency || 'BRL',
    imagem: image,
    categoriaId: categoryId,
    categoriaNome: data.categoriaNome || getCategoryName(categoryId),
    sellerId: String(data.sellerId || data.vendedorId || '').trim(),
    sellerName,
    sellerPhoto: data.sellerPhoto || data.vendedorFoto || '',
    destaque: data.destaque === true,
    ordem: Number(data.ordem || data.order || 999),
    estoqueAtivo,
    estoqueQuantidade,
    disponivel: estoqueAtivo ? estoqueQuantidade > 0 : true,
    ativo: data.ativo !== false,
    totalVendas: Number(data.totalVendas || data.totalVendasEntregues || 0)
  };
}

function getSellerReadyHtml() {
  const seller = lojaStatus?.vendedor;
  const readySeller = !!seller;
  if (!currentUser) return '<i data-lucide="store" class="w-4 h-4"></i> Quero vender';
  if (loadingStatus) return '<i data-lucide="loader-2" class="w-4 h-4 animate-spin"></i> Verificando';
  return readySeller
    ? '<i data-lucide="badge-check" class="w-4 h-4"></i> Vendedor'
    : '<i data-lucide="store" class="w-4 h-4"></i> Quero vender';
}

function renderSellerTop() {
  const seller = lojaStatus?.vendedor;
  const readySeller = !!seller;

  if (els.topSellerBtn) {
    els.topSellerBtn.disabled = loadingStatus;
    els.topSellerBtn.className = readySeller
      ? 'inline-flex items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-bold text-white shadow-sm hover:bg-emerald-700 disabled:opacity-60 disabled:cursor-not-allowed transition'
      : 'inline-flex items-center justify-center gap-2 rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-bold text-white shadow-sm hover:bg-slate-800 disabled:opacity-60 disabled:cursor-not-allowed transition';
    els.topSellerBtn.innerHTML = getSellerReadyHtml();
  }

  if (els.topSellerAvatarWrap) {
    els.topSellerAvatarWrap.classList.toggle('hidden', !readySeller);
  }

  const photo = seller?.foto || seller?.sellerPhoto || ghubProfile?.foto || '';
  if (readySeller && photo && els.topSellerAvatar && els.topSellerAvatarIcon) {
    els.topSellerAvatar.src = photo;
    els.topSellerAvatar.classList.remove('hidden');
    els.topSellerAvatarIcon.classList.add('hidden');
  } else if (els.topSellerAvatar && els.topSellerAvatarIcon) {
    els.topSellerAvatar.src = '';
    els.topSellerAvatar.classList.add('hidden');
    els.topSellerAvatarIcon.classList.remove('hidden');
  }

  if (els.sellerProfileBtn) {
    els.sellerProfileBtn.classList.toggle('hidden', !readySeller);
  }

  initIcons();
}

async function loadStoreStatus() {
  if (!currentUser || !ghubProfile?.gameId) {
    lojaStatus = { comprador: null, vendedor: null };
    renderSellerTop();
    renderSupportTop();
    return;
  }

  loadingStatus = true;
  renderSellerTop();

  try {
    const [buyerSnap, sellerSnap] = await Promise.all([
      getDoc(doc(lojaDb, 'comprador', ghubProfile.gameId)),
      getDoc(doc(lojaDb, 'vendedor', ghubProfile.gameId))
    ]);

    lojaStatus = {
      comprador: buyerSnap.exists() ? { id: buyerSnap.id, ...buyerSnap.data() } : null,
      vendedor: sellerSnap.exists() ? { id: sellerSnap.id, ...sellerSnap.data() } : null
    };
  } catch (err) {
    console.warn('Status da loja indisponível:', err);
    lojaStatus = { comprador: null, vendedor: null };
    localToast('error', 'Não foi possível verificar seu cadastro na loja. Confira as regras do Firebase da loja.');
  } finally {
    loadingStatus = false;
    renderSellerTop();
  }
}

async function loadCategories() {
  const map = new Map(DEFAULT_CATEGORIES.map((cat) => [cat.id, cat]));

  try {
    const snap = await getDocs(collection(lojaDb, 'categorias'));
    snap.docs.forEach((d) => {
      const data = d.data() || {};

      if (Array.isArray(data.lista)) {
        data.lista.forEach((item, index) => {
          const id = normalizeCategoryId(item);
          if (!id) return;
          map.set(id, { id, nome: String(item), ordem: Number(data.ordem || index + 1) });
        });
        return;
      }

      if (data.ativo === false) return;
      const id = normalizeCategoryId(data.id || d.id);
      const nome = String(data.nome || data.name || d.id || '').trim();
      if (!id || !nome) return;
      map.set(id, { id, nome, ordem: Number(data.ordem || data.order || 999) });
    });
  } catch (err) {
    console.warn('Categorias indisponíveis, usando fallback:', err);
  }

  categories = Array.from(map.values()).sort((a, b) => (a.ordem || 999) - (b.ordem || 999) || a.nome.localeCompare(b.nome));
  renderCategories();
}

function renderCategories() {
  if (els.category) {
    const current = els.category.value;
    els.category.innerHTML = '<option value="">Todas</option>' + categories
      .map((cat) => `<option value="${escapeHtml(cat.id)}">${escapeHtml(cat.nome)}</option>`)
      .join('');
    els.category.value = current;
  }

  if (els.sellerCategory) {
    const current = els.sellerCategory.value;
    els.sellerCategory.innerHTML = '<option value="">Selecione</option>' + categories
      .map((cat) => `<option value="${escapeHtml(cat.id)}">${escapeHtml(cat.nome)}</option>`)
      .join('');
    els.sellerCategory.value = current;
  }

  if (els.chips) {
    els.chips.innerHTML = '<button type="button" class="rounded-full bg-emerald-50 px-3 py-1.5 text-xs font-bold text-emerald-700 ring-1 ring-emerald-200" data-category-chip="">Todas</button>' + categories
      .map((cat) => `<button type="button" class="rounded-full bg-white px-3 py-1.5 text-xs font-bold text-gray-600 ring-1 ring-gray-200 hover:bg-gray-50" data-category-chip="${escapeHtml(cat.id)}">${escapeHtml(cat.nome)}</button>`)
      .join('');

    els.chips.querySelectorAll('[data-category-chip]').forEach((btn) => {
      btn.addEventListener('click', () => {
        if (els.category) els.category.value = btn.getAttribute('data-category-chip') || '';
        applyFilters();
      });
    });
  }
}

async function loadProducts() {
  setProductsLoading(true);

  try {
    // Carrega a coleção inteira e filtra no front.
    // Isso evita erro quando o produto foi criado manualmente sem índice/campo esperado
    // e também facilita teste com regras abertas.
    const snap = await getDocs(collection(lojaDb, 'produtos'));
    products = snap.docs
      .map(normalizeProduct)
      .filter((product) => product.ativo !== false)
      .sort((a, b) => Number(b.destaque) - Number(a.destaque) || (a.ordem || 999) - (b.ordem || 999) || a.titulo.localeCompare(b.titulo));
  } catch (err) {
    console.error('Erro ao carregar produtos da loja:', err?.code || err?.message || err, err);
    products = [];
    localToast('error', `Não foi possível carregar os produtos da loja. Erro: ${err?.code || err?.message || 'verifique as regras de leitura'}`);
  } finally {
    setProductsLoading(false);
    applyFilters();
  }
}

function applyFilters() {
  const search = String(els.search?.value || '').trim().toLowerCase();
  const category = String(els.category?.value || '').trim();

  filteredProducts = products.filter((product) => {
    const matchesCategory = !category || product.categoriaId === category;
    const blob = `${product.titulo} ${product.descricao} ${product.categoriaNome} ${product.sellerName}`.toLowerCase();
    const matchesSearch = !search || blob.includes(search);
    return matchesCategory && matchesSearch;
  });

  renderProducts();
}

function renderProducts() {
  if (els.counter) {
    const total = filteredProducts.length;
    els.counter.textContent = total === 1 ? '1 produto encontrado' : `${total} produtos encontrados`;
  }

  if (loadingProducts) return;

  els.empty?.classList.toggle('hidden', filteredProducts.length > 0);

  if (!els.grid) return;
  if (!filteredProducts.length) {
    els.grid.innerHTML = '';
    return;
  }

  els.grid.innerHTML = filteredProducts.map((product) => {
    const image = product.imagem
      ? `<img src="${escapeHtml(product.imagem)}" alt="${escapeHtml(product.titulo)}" class="h-full w-full object-cover">`
      : '<i data-lucide="package" class="h-8 w-8 sm:h-10 sm:w-10 text-gray-300"></i>';

    return `
      <article class="group overflow-hidden rounded-2xl sm:rounded-3xl border border-gray-100 bg-white shadow-sm transition hover:-translate-y-0.5 hover:shadow-lg">
        <button type="button" data-open-product="${escapeHtml(product.id)}" class="block w-full text-left">
          <div class="relative h-28 sm:h-44 bg-gray-50 flex items-center justify-center overflow-hidden">
            ${image}
          </div>
          <div class="p-2.5 sm:p-4">
            <h4 class="line-clamp-2 min-h-[34px] sm:min-h-0 text-xs sm:text-base font-black text-gray-900">${escapeHtml(product.titulo)}</h4>
            <div class="mt-2 flex items-center justify-between gap-2">
              <span class="min-w-0 truncate rounded-full bg-gray-50 px-2 py-0.5 text-[10px] sm:text-[11px] font-black text-gray-500 ring-1 ring-gray-200">${escapeHtml(product.categoriaNome)}</span>
            </div>
          </div>
        </button>
      </article>
    `;
  }).join('');

  els.grid.querySelectorAll('[data-open-product]').forEach((btn) => {
    btn.addEventListener('click', () => openProductModal(btn.getAttribute('data-open-product') || ''));
  });

  initIcons();
}

async function getSellerPublicStats(sellerId) {
  const cleanSellerId = String(sellerId || '').trim();
  if (!cleanSellerId) return { totalVendasEntregues: 0 };
  try {
    const snap = await getDocs(query(collection(lojaDb, 'pedidos'), where('sellerId', '==', cleanSellerId)));
    const orders = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    return calculateSellerFinancials(orders, {});
  } catch (err) {
    console.warn('Não foi possível carregar vendas públicas do vendedor:', err);
    return { totalVendasEntregues: 0 };
  }
}

async function openProductModal(productId) {
  const product = products.find((item) => String(item.id) === String(productId));
  if (!product || !els.productModal || !els.productModalBody || !els.productModalTitle) return;

  const isOwnProduct = !!ghubProfile?.gameId && String(product.sellerId || '') === String(ghubProfile.gameId);
  els.productModalTitle.textContent = product.titulo;

  const image = product.imagem
    ? `<img src="${escapeHtml(product.imagem)}" alt="${escapeHtml(product.titulo)}" class="h-56 w-full rounded-3xl object-cover border border-gray-100 bg-gray-50">`
    : '<div class="h-56 w-full rounded-3xl border border-gray-100 bg-gray-50 flex items-center justify-center"><i data-lucide="package" class="h-12 w-12 text-gray-300"></i></div>';
  const statusHtml = product.disponivel
    ? '<span class="inline-flex items-center rounded-full bg-emerald-50 px-2.5 py-1 text-[11px] font-black text-emerald-700 ring-1 ring-emerald-200">DISPONÍVEL</span>'
    : '<span class="inline-flex items-center rounded-full bg-red-50 px-2.5 py-1 text-[11px] font-black text-red-700 ring-1 ring-red-200">ESGOTADO</span>';

  const buyButtonHtml = isOwnProduct
    ? '<button type="button" disabled class="w-full rounded-2xl bg-gray-200 px-5 py-4 text-sm font-black text-gray-500 disabled:cursor-not-allowed">Você não pode comprar seu próprio produto</button>'
    : `<button type="button" data-buy-product="${escapeHtml(product.id)}" class="w-full rounded-2xl bg-slate-900 px-5 py-4 text-sm font-black text-white shadow-lg shadow-slate-900/10 hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50">Comprar agora</button>`;

  els.productModalBody.innerHTML = `
    ${image}
    <div>
      <div class="flex flex-wrap items-center gap-2">
        ${statusHtml}
        <span class="inline-flex items-center rounded-full bg-gray-50 px-2.5 py-1 text-[11px] font-black text-gray-500 ring-1 ring-gray-200">${escapeHtml(product.categoriaNome)}</span>
        <span class="inline-flex items-center rounded-full bg-gray-50 px-2.5 py-1 text-[11px] font-black text-gray-500 ring-1 ring-gray-200">Estoque: ${Number(product.estoqueQuantidade || 0)}</span>
      </div>
      <h4 class="mt-3 text-2xl font-black text-gray-900">${escapeHtml(product.titulo)}</h4>
      <p class="mt-1 text-sm font-bold text-gray-400">Vendedor: ${escapeHtml(product.sellerName)}</p>
      <div class="mt-2 flex flex-wrap items-center gap-2">
        <p id="modal-seller-sales" class="text-xs font-black text-emerald-700">Carregando vendas do vendedor...</p>
        <p id="modal-seller-rating" class="rounded-full bg-amber-50 px-2.5 py-1 text-[11px] font-black text-amber-700 ring-1 ring-amber-200">Nota: carregando...</p>
      </div>
      <div class="mt-3 flex flex-wrap gap-2">
        <button type="button" data-rate-seller="10" class="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-black text-emerald-700 hover:bg-emerald-100">Curtir vendedor</button>
        <button type="button" data-rate-seller="0" class="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs font-black text-red-700 hover:bg-red-100">Descurtir</button>
        <button type="button" data-report-product="${escapeHtml(product.id)}" class="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-black text-amber-700 hover:bg-amber-100">Denunciar produto</button>
      </div>
      <p class="mt-4 text-sm leading-relaxed text-gray-600">${escapeHtml(product.descricao || 'Produto disponível na loja.')}</p>
      <p class="mt-5 text-3xl font-black text-emerald-700">${moneyBRL(product.preco)}</p>
    </div>
    ${buyButtonHtml}`;

  els.productModal.classList.remove('hidden');
  els.productModal.classList.add('flex');
  els.productModalBody.querySelector('[data-buy-product]')?.addEventListener('click', () => createOrder(product.id));
  els.productModalBody.querySelectorAll('[data-rate-seller]').forEach((btn) => btn.addEventListener('click', () => rateSeller(product.sellerId, Number(btn.getAttribute('data-rate-seller') || 0))));
  els.productModalBody.querySelector('[data-report-product]')?.addEventListener('click', () => reportProduct(product.id));
  initIcons();

  const stats = await getSellerPublicStats(product.sellerId);
  const salesEl = qs('modal-seller-sales');
  if (salesEl) {
    const total = Number(stats.totalVendasEntregues || 0);
    salesEl.textContent = total === 1 ? 'Vendedor com 1 venda entregue' : `Vendedor com ${total} vendas entregues`;
  }

  const rating = await getSellerRatingStats(product.sellerId);
  renderSellerRatingBlock(rating);
}

async function getSellerRatingStats(sellerId) {
  const cleanSellerId = String(sellerId || '').trim();
  if (!cleanSellerId) return { count: 0, avg: null, likes: 0, dislikes: 0 };
  try {
    const snap = await getDocs(query(collection(lojaDb, SELLER_RATING_COLLECTION), where('sellerId', '==', cleanSellerId)));
    const ratings = snap.docs.map((d) => Number(d.data()?.nota ?? d.data()?.rating ?? 0)).filter((n) => Number.isFinite(n));
    const count = ratings.length;
    const avg = count ? ratings.reduce((a, b) => a + b, 0) / count : null;
    return { count, avg, likes: ratings.filter((n) => n >= 5).length, dislikes: ratings.filter((n) => n < 5).length };
  } catch (err) {
    console.warn('Não foi possível carregar avaliação do vendedor:', err);
    return { count: 0, avg: null, likes: 0, dislikes: 0 };
  }
}

function renderSellerRatingBlock(rating) {
  const el = qs('modal-seller-rating');
  if (!el) return;
  if (!rating || !rating.count) {
    el.textContent = 'Nota: sem avaliações';
    return;
  }
  el.textContent = `Nota: ${Number(rating.avg || 0).toFixed(1)}/10 • ${rating.count} avaliação${rating.count === 1 ? '' : 'ões'}`;
}

async function rateSeller(sellerId, nota) {
  if (!currentUser || !ghubProfile?.gameId) { localToast('error', 'Entre na GuildaHub para avaliar o vendedor.'); return; }
  const cleanSellerId = String(sellerId || '').trim();
  if (!cleanSellerId) return;
  if (cleanSellerId === String(ghubProfile.gameId)) { localToast('error', 'Você não pode avaliar a si mesmo.'); return; }
  const normalized = Number(nota) >= 5 ? 10 : 0;
  const id = `${cleanSellerId}_${ghubProfile.gameId}`;
  try {
    await setDoc(doc(lojaDb, SELLER_RATING_COLLECTION, id), {
      id,
      sellerId: cleanSellerId,
      buyerId: ghubProfile.gameId,
      buyerUid: currentUser.uid || '',
      buyerName: ghubProfile.nick || '',
      nota: normalized,
      tipo: normalized >= 5 ? 'like' : 'dislike',
      updatedAt: serverTimestamp(),
      updatedAtMs: Date.now()
    }, { merge: true });
    const stats = await getSellerRatingStats(cleanSellerId);
    await setDoc(doc(lojaDb, 'vendedor', cleanSellerId), {
      notaMedia: stats.avg ?? 0,
      notaTotal: stats.count,
      totalLikes: stats.likes,
      totalDislikes: stats.dislikes,
      updatedAt: serverTimestamp()
    }, { merge: true });
    renderSellerRatingBlock(stats);
    localToast('success', 'Avaliação registrada.');
  } catch (err) {
    console.error(err);
    localToast('error', 'Não foi possível registrar a avaliação.');
  }
}

async function reportProduct(productId) {
  if (!currentUser || !ghubProfile?.gameId) { localToast('error', 'Entre na GuildaHub para denunciar um produto.'); return; }
  const product = products.find((item) => String(item.id) === String(productId));
  if (!product) return;
  const motivo = window.prompt('Descreva o motivo da denúncia:', '');
  if (!String(motivo || '').trim()) return;
  try {
    await addDoc(collection(lojaDb, PRODUCT_REPORT_COLLECTION), {
      productId: product.id,
      produtoId: product.id,
      produtoTitulo: product.titulo || '',
      produtoImagem: product.imagem || '',
      sellerId: product.sellerId || '',
      sellerName: product.sellerName || '',
      categoriaId: product.categoriaId || '',
      categoriaNome: product.categoriaNome || '',
      preco: Number(product.preco || 0),
      motivo: String(motivo || '').trim(),
      status: 'aberta',
      reporterId: ghubProfile.gameId,
      reporterUid: currentUser.uid || '',
      reporterName: ghubProfile.nick || '',
      reporterEmail: normalizeEmail(currentUser.email || ghubProfile.email || ''),
      createdAt: serverTimestamp(),
      createdAtMs: Date.now(),
      productSnapshot: product
    });
    localToast('success', 'Denúncia enviada para o suporte.');
  } catch (err) {
    console.error(err);
    localToast('error', 'Não foi possível enviar a denúncia.');
  }
}

function closeProductModal() {
  els.productModal?.classList.add('hidden');
  els.productModal?.classList.remove('flex');
}

async function ensureBuyerProfile({ silent = false } = {}) {
  if (!currentUser) {
    if (!silent) localToast('error', 'Entre na GuildaHub para criar seu perfil de comprador.');
    return null;
  }

  let payload;
  try {
    payload = getProfilePayload();
  } catch (_) {
    if (!silent) localToast('error', 'Conclua seu perfil da GuildaHub antes de usar a loja.');
    return null;
  }

  const buyerRef = doc(lojaDb, 'comprador', payload.gameId);
  const buyerSnap = await getDoc(buyerRef);
  const existing = buyerSnap.exists() ? buyerSnap.data() : null;

  const buyerPayload = {
    ...existing,
    id: payload.gameId,
    gameId: payload.gameId,
    uid: payload.uid,
    email: payload.email,
    playerEmail: payload.email,
    nick: payload.nick,
    foto: payload.foto,
    ativo: true,
    updatedAt: serverTimestamp(),
    ...(existing?.createdAt ? {} : { createdAt: serverTimestamp() })
  };

  await setDoc(buyerRef, buyerPayload, { merge: true });
  lojaStatus.comprador = { id: payload.gameId, ...buyerPayload };

  if (!silent) localToast('success', buyerSnap.exists() ? 'Perfil de comprador atualizado.' : 'Perfil de comprador criado.');
  return lojaStatus.comprador;
}


async function loadSellerVerification() {
  if (!currentUser || !ghubProfile?.gameId) return null;
  try {
    const snap = await getDoc(doc(lojaDb, VERIFICATION_COLLECTION, String(ghubProfile.gameId)));
    sellerVerification = snap.exists() ? { id: snap.id, ...snap.data() } : null;
    return sellerVerification;
  } catch (err) {
    console.warn('Não foi possível carregar verificação de vendedor:', err);
    return null;
  }
}

function openVerificationModal(data = null) {
  if (!currentUser) {
    localToast('error', 'Entre na GuildaHub para solicitar verificação.');
    return;
  }

  const verification = data || sellerVerification || null;
  const status = getVerificationStatusLabel(verification?.status);
  const paper = getVerificationPaperText();

  if (els.verificationPaperText) els.verificationPaperText.textContent = paper;
  if (els.verificationFullName) els.verificationFullName.value = verification?.nomeCompleto || '';
  if (els.verificationBirthDate) els.verificationBirthDate.value = verification?.dataNascimento || '';

  const isLocked = status === 'pendente' || status === 'aprovado' || status === 'recusado';
  [els.verificationFullName, els.verificationBirthDate, els.verificationRgFront, els.verificationRgBack, els.submitVerificationBtn].forEach((el) => {
    if (!el) return;
    el.disabled = isLocked;
    el.classList.toggle('opacity-60', isLocked);
  });

  const statusClasses = {
    aprovado: 'rounded-2xl border border-emerald-200 bg-emerald-50 p-3 text-xs font-semibold leading-relaxed text-emerald-800',
    recusado: 'rounded-2xl border border-red-200 bg-red-50 p-3 text-xs font-semibold leading-relaxed text-red-800',
    pendente: 'rounded-2xl border border-amber-200 bg-amber-50 p-3 text-xs font-semibold leading-relaxed text-amber-800',
    default: 'rounded-2xl border border-amber-200 bg-amber-50 p-3 text-xs font-semibold leading-relaxed text-amber-800'
  };

  if (els.verificationStatus) {
    els.verificationStatus.className = statusClasses[status] || statusClasses.default;
    if (status === 'aprovado') els.verificationStatus.textContent = 'Sua verificação foi aprovada. Toque em “Quero vender” novamente para criar o perfil de vendedor.';
    else if (status === 'recusado') els.verificationStatus.textContent = verification?.motivoRecusa || 'Sua verificação foi recusada. Você ainda pode comprar normalmente.';
    else if (status === 'pendente') els.verificationStatus.textContent = 'Sua verificação está em análise. Aguarde a aprovação para vender.';
    else els.verificationStatus.textContent = 'Antes de vender, envie seus dados para análise. Se aprovado, você poderá criar o perfil de vendedor.';
  }

  setVerificationImageStatus('front', verification?.rgFrenteBase64 ? 'Imagem enviada.' : 'Imagem será comprimida para caber no Firestore.');
  setVerificationImageStatus('back', verification?.rgVersoBase64 ? 'Imagem enviada.' : 'Imagem será comprimida para caber no Firestore.');

  els.verificationModal?.classList.remove('hidden');
  els.verificationModal?.classList.add('flex');
  initIcons();
}

function closeVerificationModal() {
  els.verificationModal?.classList.add('hidden');
  els.verificationModal?.classList.remove('flex');
}

async function handleVerificationFileChange(type, file) {
  if (!file) {
    if (type === 'front') verificationRgFrontBase64 = '';
    else verificationRgBackBase64 = '';
    setVerificationImageStatus(type, 'Imagem será comprimida para caber no Firestore.');
    return;
  }

  try {
    setVerificationImageStatus(type, 'Comprimindo imagem...');
    const base64 = await compressImageToBase64(file, 360 * 1024);
    const kb = Math.max(1, Math.round(dataUrlSizeBytes(base64) / 1024));
    if (type === 'front') verificationRgFrontBase64 = base64;
    else verificationRgBackBase64 = base64;
    setVerificationImageStatus(type, `Imagem pronta (${kb} KB).`);
  } catch (err) {
    console.error(err);
    if (type === 'front') {
      verificationRgFrontBase64 = '';
      if (els.verificationRgFront) els.verificationRgFront.value = '';
    } else {
      verificationRgBackBase64 = '';
      if (els.verificationRgBack) els.verificationRgBack.value = '';
    }
    setVerificationImageStatus(type, 'Falha ao processar imagem.');
    localToast('error', err?.message || 'Não foi possível processar a imagem.');
  }
}

async function submitSellerVerification(event) {
  event.preventDefault();
  if (!currentUser || !ghubProfile?.gameId) {
    localToast('error', 'Conclua seu perfil da GuildaHub antes de solicitar verificação.');
    return;
  }

  const nomeCompleto = String(els.verificationFullName?.value || '').trim();
  const dataNascimento = String(els.verificationBirthDate?.value || '').trim();
  if (!nomeCompleto) { localToast('error', 'Informe seu nome completo.'); els.verificationFullName?.focus(); return; }
  if (!dataNascimento) { localToast('error', 'Informe sua data de nascimento.'); els.verificationBirthDate?.focus(); return; }
  if (!verificationRgFrontBase64) { localToast('error', 'Envie a foto da frente do RG com o papel solicitado.'); return; }
  if (!verificationRgBackBase64) { localToast('error', 'Envie a foto do verso do RG com o papel solicitado.'); return; }

  setButtonLoading(els.submitVerificationBtn, true, 'Enviar verificação');
  try {
    const payload = {
      id: ghubProfile.gameId,
      gameId: ghubProfile.gameId,
      uid: currentUser.uid || '',
      email: normalizeEmail(currentUser.email || ghubProfile.email || ''),
      nick: ghubProfile.nick || '',
      foto: ghubProfile.foto || '',
      nomeCompleto,
      dataNascimento,
      papelSolicitado: getVerificationPaperText(),
      rgFrenteBase64: verificationRgFrontBase64,
      rgVersoBase64: verificationRgBackBase64,
      status: 'pendente',
      createdAt: serverTimestamp(),
      createdAtMs: Date.now(),
      updatedAt: serverTimestamp()
    };
    await setDoc(doc(lojaDb, VERIFICATION_COLLECTION, String(ghubProfile.gameId)), payload, { merge: true });
    sellerVerification = payload;
    localToast('success', 'Verificação enviada. Aguarde aprovação para vender.');
    closeVerificationModal();
  } catch (err) {
    console.error(err);
    localToast('error', 'Não foi possível enviar a verificação. Confira as regras do Firebase.');
  } finally {
    setButtonLoading(els.submitVerificationBtn, false, 'Enviar verificação');
  }
}

async function createOrUpdateSellerProfile() {
  if (!currentUser) {
    localToast('error', 'Entre na GuildaHub para criar seu perfil de vendedor.');
    return null;
  }

  let payload;
  try {
    payload = getProfilePayload();
  } catch (_) {
    localToast('error', 'Conclua seu perfil da GuildaHub antes de criar vendedor.');
    return null;
  }

  setButtonLoading(els.topSellerBtn, true, getSellerReadyHtml());

  try {
    const sellerRef = doc(lojaDb, 'vendedor', payload.gameId);
    const sellerSnap = await getDoc(sellerRef);
    const existing = sellerSnap.exists() ? sellerSnap.data() : null;

    const sellerPayload = {
      ...existing,
      id: payload.gameId,
      gameId: payload.gameId,
      uid: payload.uid,
      email: payload.email,
      playerEmail: payload.email,
      nome: payload.nick || existing?.nome || '',
      nick: payload.nick || existing?.nick || '',
      foto: payload.foto || existing?.foto || '',
      tipo: existing?.tipo || 'externo',
      status: existing?.status || 'ativo',
      ativo: existing?.ativo !== false,
      verificado: existing?.verificado === true,
      totalProdutos: Number(existing?.totalProdutos || 0),
      totalVendas: Number(existing?.totalVendas || 0),
      updatedAt: serverTimestamp(),
      ...(existing?.createdAt ? {} : { createdAt: serverTimestamp() })
    };

    await setDoc(sellerRef, sellerPayload, { merge: true });
    lojaStatus.vendedor = { id: payload.gameId, ...sellerPayload };
    renderSellerTop();
    localToast('success', sellerSnap.exists() ? 'Perfil de vendedor atualizado.' : 'Perfil de vendedor criado.');
    return lojaStatus.vendedor;
  } catch (err) {
    console.error(err);
    localToast('error', 'Não foi possível criar o vendedor. Confira se as regras do Firebase da loja permitem escrita.');
    return null;
  } finally {
    renderSellerTop();
  }
}

async function handleTopSellerClick() {
  if (lojaStatus?.vendedor) {
    await openSellerPanel();
    return;
  }

  if (!currentUser) {
    localToast('error', 'Entre na GuildaHub para criar seu perfil de vendedor.');
    return;
  }

  if (!ghubProfile?.gameId) {
    localToast('error', 'Conclua seu perfil da GuildaHub antes de criar vendedor.');
    return;
  }

  const verification = await loadSellerVerification();
  const status = getVerificationStatusLabel(verification?.status);

  if (status === 'aprovado') {
    const seller = await createOrUpdateSellerProfile();
    if (seller) await openSellerPanel();
    return;
  }

  if (status === 'recusado') {
    localToast('error', 'Sua verificação de vendedor foi recusada. Você ainda pode comprar normalmente.');
    openVerificationModal(verification);
    return;
  }

  if (status === 'pendente') {
    localToast('info', 'Sua verificação de vendedor ainda está em análise.');
    openVerificationModal(verification);
    return;
  }

  openVerificationModal(null);
}

async function createOrder(productId) {
  const product = products.find((item) => String(item.id) === String(productId));
  if (!product) return;
  if (!currentUser) { localToast('error', 'Entre na GuildaHub para comprar.'); return; }
  if (!ghubProfile?.gameId) { localToast('error', 'Conclua seu perfil da GuildaHub antes de comprar.'); return; }
  if (!product.disponivel) { localToast('error', 'Esse produto está esgotado.'); return; }
  if (String(product.sellerId || '') && String(product.sellerId) === String(ghubProfile.gameId)) { localToast('error', 'Você não pode comprar seu próprio produto.'); return; }

  const btn = els.productModalBody?.querySelector('[data-buy-product]');
  if (btn) { btn.disabled = true; btn.innerHTML = '<i data-lucide="loader-2" class="inline w-4 h-4 animate-spin mr-2"></i> Criando pedido...'; initIcons(); }

  try {
    const buyer = lojaStatus?.comprador || await ensureBuyerProfile({ silent: true });
    if (!buyer) throw new Error('buyer-required');

    const productRef = doc(lojaDb, 'produtos', product.id);
    const orderRef = doc(collection(lojaDb, 'pedidos'));
    const sellerChatId = getChatId(orderRef.id, CHAT_TYPE_SELLER);
    const sellerChatRef = doc(lojaDb, CHAT_COLLECTION, sellerChatId);
    const nowMs = Date.now();
    const expiresAtMs = nowMs + (SELLER_CHAT_HOURS * 60 * 60 * 1000);

    await runTransaction(lojaDb, async (transaction) => {
      const productSnap = await transaction.get(productRef);
      if (!productSnap.exists()) throw new Error('product-not-found');
      const currentProduct = normalizeProduct(productSnap);
      if (currentProduct.ativo === false) throw new Error('product-inactive');
      if (String(currentProduct.sellerId || '') && String(currentProduct.sellerId) === String(ghubProfile.gameId)) throw new Error('self-purchase');
      const estoqueAtual = Number(currentProduct.estoqueQuantidade ?? 0);
      if (currentProduct.estoqueAtivo !== false && estoqueAtual <= 0) throw new Error('out-of-stock');

      const orderPayload = {
        buyerId: ghubProfile.gameId,
        buyerUid: currentUser.uid || '',
        buyerEmail: normalizeEmail(currentUser.email || ghubProfile.email || ''),
        buyerName: ghubProfile.nick || '',
        buyerNick: ghubProfile.nick || '',
        buyerPhoto: ghubProfile.foto || '',

        sellerId: currentProduct.sellerId || 'ghub',
        sellerName: currentProduct.sellerName || 'GuildaHub',
        sellerPhoto: currentProduct.sellerPhoto || '',

        produtoId: currentProduct.id,
        produtoTitulo: currentProduct.titulo,
        produtoImagem: currentProduct.imagem || '',
        categoriaId: currentProduct.categoriaId || '',
        categoriaNome: currentProduct.categoriaNome || '',

        quantidade: 1,
        precoUnitario: Number(currentProduct.preco || 0),
        total: Number(currentProduct.preco || 0),
        moeda: currentProduct.moeda || 'BRL',

        buyerInfoRequired: false,
        buyerInfo: '',
        deliveryInfoRequired: false,
        deliveryInfo: '',

        status: 'pendente',
        finalizado: false,
        chatVendedorAberto: true,
        chatVendedorId: sellerChatId,
        chatVendedorStatus: 'ativo',
        pagamento: { metodo: 'pix', provider: '', status: 'pendente', paymentId: '', qrCode: '', copiaCola: '', aprovadoEm: null, reembolsadoEm: null },
        entrega: { tipo: currentProduct.entregaTipo || 'manual', status: 'aguardando_pagamento', observacao: '', informacoes: '', entregueEm: null, entregueEmMs: null, canceladoEm: null },
        createdAt: serverTimestamp(),
        createdAtMs: nowMs,
        updatedAt: serverTimestamp()
      };

      const chatPayload = {
        id: sellerChatId,
        tipo: CHAT_TYPE_SELLER,
        status: 'ativo',
        orderId: orderRef.id,
        pedidoId: orderRef.id,
        buyerId: ghubProfile.gameId,
        buyerUid: currentUser.uid || '',
        buyerEmail: normalizeEmail(currentUser.email || ghubProfile.email || ''),
        buyerName: ghubProfile.nick || '',
        sellerId: currentProduct.sellerId || 'ghub',
        sellerName: currentProduct.sellerName || 'GuildaHub',
        produtoId: currentProduct.id,
        produtoTitulo: currentProduct.titulo,
        categoriaId: currentProduct.categoriaId || '',
        categoriaNome: currentProduct.categoriaNome || '',
        total: Number(currentProduct.preco || 0),
        mensagens: [{
          autorId: 'sistema',
          autorTipo: 'sistema',
          autorNome: 'GuildaHub',
          texto: 'Chat temporário aberto automaticamente após a compra. Envie aqui as informações necessárias para combinar a entrega.',
          createdAtMs: nowMs
        }],
        createdAt: serverTimestamp(),
        createdAtMs: nowMs,
        expiresAt: new Date(expiresAtMs),
        expiresAtMs,
        updatedAt: serverTimestamp(),
        orderSnapshot: {
          id: orderRef.id,
          buyerId: ghubProfile.gameId,
          sellerId: currentProduct.sellerId || 'ghub',
          produtoId: currentProduct.id,
          produtoTitulo: currentProduct.titulo,
          total: Number(currentProduct.preco || 0),
          status: 'pendente',
          createdAtMs: nowMs
        }
      };

      transaction.set(orderRef, orderPayload);
      transaction.set(sellerChatRef, chatPayload);
      if (currentProduct.estoqueAtivo !== false) transaction.set(productRef, { estoqueQuantidade: Math.max(0, estoqueAtual - 1), updatedAt: serverTimestamp() }, { merge: true });
    });

    closeProductModal();
    localToast('success', 'Pedido criado. Chat com o vendedor aberto por 24h.');
    await Promise.all([loadProducts(), loadBuyerOrders()]);
  } catch (err) {
    console.error(err);
    localToast('error', err?.message === 'out-of-stock' ? 'Esse produto ficou sem estoque.' : err?.message === 'self-purchase' ? 'Você não pode comprar seu próprio produto.' : 'Não foi possível criar o pedido. Confira se as regras do Firebase da loja permitem escrita.');
  } finally {
    if (btn) { btn.disabled = false; btn.innerHTML = 'Comprar agora'; }
  }
}

function openSellerModal()
 {
  els.sellerModal?.classList.remove('hidden');
  els.sellerModal?.classList.add('flex');
  initIcons();
}

function closeSellerModal() {
  els.sellerModal?.classList.add('hidden');
  els.sellerModal?.classList.remove('flex');
}

function renderSellerProfileCard() {
  const seller = lojaStatus?.vendedor;
  if (!els.sellerProfileCard) return;
  if (!seller) { els.sellerProfileCard.innerHTML = '<p class="text-sm font-bold text-red-700">Perfil de vendedor não encontrado.</p>'; return; }
  const photo = seller.foto || ghubProfile?.foto || '';
  const finances = calculateSellerFinancials(sellerOrders, seller);
  const canWithdraw = finances.saldoAtual >= SELLER_WITHDRAW_MIN;
  els.sellerProfileCard.innerHTML = `
    <div class="flex items-start gap-3"><div class="h-14 w-14 shrink-0 overflow-hidden rounded-2xl bg-emerald-50 ring-1 ring-emerald-100 flex items-center justify-center text-emerald-700">${photo ? `<img src="${escapeHtml(photo)}" alt="" class="h-full w-full object-cover">` : '<i data-lucide="user" class="w-6 h-6"></i>'}</div><div class="min-w-0 flex-1"><div class="flex items-center gap-2 flex-wrap"><p class="font-black text-gray-900 truncate">${escapeHtml(seller.nome || seller.nick || 'Vendedor')}</p><span class="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-1 text-[11px] font-black text-emerald-700 ring-1 ring-emerald-200"><i data-lucide="badge-check" class="w-3.5 h-3.5"></i> VENDEDOR</span></div><p class="mt-1 text-xs font-semibold text-gray-400">ID: ${escapeHtml(seller.id || seller.gameId || ghubProfile?.gameId || '-')}</p><p class="mt-1 text-xs font-semibold text-gray-400 truncate">${escapeHtml(seller.email || currentUser?.email || '')}</p></div></div>
    <div class="mt-4 grid grid-cols-2 gap-2"><div class="rounded-2xl bg-white p-3 ring-1 ring-gray-100"><p class="text-[10px] font-black uppercase tracking-wider text-gray-400">Saldo atual</p><p class="mt-1 text-lg font-black text-emerald-700">${moneyBRL(finances.saldoAtual)}</p></div><div class="rounded-2xl bg-white p-3 ring-1 ring-gray-100"><p class="text-[10px] font-black uppercase tracking-wider text-gray-400">Saldo pendente</p><p class="mt-1 text-lg font-black text-amber-600">${moneyBRL(finances.saldoPendente)}</p></div><div class="rounded-2xl bg-white p-3 ring-1 ring-gray-100"><p class="text-[10px] font-black uppercase tracking-wider text-gray-400">Em saque</p><p class="mt-1 text-lg font-black text-sky-700">${moneyBRL(finances.saldoEmSaque)}</p></div><div class="rounded-2xl bg-white p-3 ring-1 ring-gray-100"><p class="text-[10px] font-black uppercase tracking-wider text-gray-400">Vendas entregues</p><p class="mt-1 text-lg font-black text-gray-900">${Number(finances.totalVendasEntregues || 0)}</p></div></div>
    <div class="mt-3 rounded-2xl border border-amber-200 bg-amber-50 p-3 text-xs font-semibold leading-relaxed text-amber-800">Será cobrada taxa de ${SELLER_FEE_PERCENT}% por venda. O saldo só é liberado ${SELLER_RELEASE_DAYS} dias após o pedido ser marcado como entregue. Saque mínimo: R$ 20,00.</div>
    <div class="mt-3 rounded-2xl border border-gray-200 bg-white p-3"><label for="seller-withdraw-pix" class="block text-xs font-black uppercase tracking-wider text-gray-400 mb-1.5">Pix para saque</label><input id="seller-withdraw-pix" type="text" value="${escapeHtml(seller.ultimoPixSaque || '')}" placeholder="Chave Pix" class="w-full rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-sm font-semibold outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100"><button id="btn-seller-withdraw" type="button" class="mt-2 w-full rounded-xl px-3 py-2 text-xs font-black ${canWithdraw ? 'bg-emerald-600 text-white hover:bg-emerald-700' : 'bg-gray-100 text-gray-400 cursor-not-allowed'}" ${canWithdraw ? '' : 'disabled'}>Solicitar saque ${moneyBRL(finances.saldoAtual)}</button></div>`;
  qs('btn-seller-withdraw')?.addEventListener('click', requestSellerWithdraw);
  initIcons();
}

async function loadSellerProducts() {
  const sellerId = ghubProfile?.gameId;
  if (!sellerId) return;
  try {
    const snap = await getDocs(query(collection(lojaDb, 'produtos'), where('sellerId', '==', String(sellerId))));
    sellerProducts = snap.docs.map(normalizeProduct).sort((a, b) => a.titulo.localeCompare(b.titulo));
  } catch (err) {
    console.error('Erro ao carregar produtos do vendedor:', err?.code || err?.message || err, err);
    sellerProducts = [];
    localToast('error', `Não foi possível carregar seus produtos. Erro: ${err?.code || err?.message || 'verifique as regras/índices'}`);
  }
  renderSellerProducts();
}

async function loadSellerOrders() {
  const sellerId = ghubProfile?.gameId;
  if (!sellerId) return;
  try {
    const snap = await getDocs(query(collection(lojaDb, 'pedidos'), where('sellerId', '==', String(sellerId))));
    sellerOrders = snap.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => Number(b?.createdAtMs || b?.createdAt?.seconds || 0) - Number(a?.createdAtMs || a?.createdAt?.seconds || 0));
    await syncSellerFinancialsToFirebase();
  } catch (err) {
    console.error('Erro ao carregar pedidos do vendedor:', err?.code || err?.message || err, err);
    sellerOrders = [];
    localToast('error', `Não foi possível carregar seus pedidos. Erro: ${err?.code || err?.message || 'verifique as regras/índices'}`);
  }
  renderSellerOrders();
  renderSellerProfileCard();
}

function renderSellerProducts() {
  if (els.sellerProductsCounter) {
    const total = sellerProducts.length;
    els.sellerProductsCounter.textContent = total === 1 ? '1 produto cadastrado' : `${total} produtos cadastrados`;
  }

  if (!els.sellerProductsList) return;
  if (!sellerProducts.length) {
    els.sellerProductsList.innerHTML = '<div class="rounded-2xl border border-dashed border-gray-200 bg-gray-50 p-4 text-sm font-semibold text-gray-500 text-center">Nenhum produto cadastrado ainda.</div>';
    return;
  }

  els.sellerProductsList.innerHTML = sellerProducts.map((product) => {
    const image = product.imagem
      ? `<img src="${escapeHtml(product.imagem)}" alt="" class="h-12 w-12 rounded-xl object-cover bg-gray-50 border border-gray-100">`
      : '<div class="h-12 w-12 rounded-xl bg-gray-50 border border-gray-100 flex items-center justify-center"><i data-lucide="package" class="w-5 h-5 text-gray-300"></i></div>';
    const status = product.ativo
      ? '<span class="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-black text-emerald-700 ring-1 ring-emerald-200">ATIVO</span>'
      : '<span class="rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-black text-gray-500 ring-1 ring-gray-200">PAUSADO</span>';

    return `
      <div class="rounded-2xl border border-gray-100 bg-gray-50 p-3">
        <div class="flex items-start gap-3">
          ${image}
          <div class="min-w-0 flex-1">
            <div class="flex items-center gap-2 flex-wrap">
              <p class="font-black text-sm text-gray-900 truncate">${escapeHtml(product.titulo)}</p>
              ${status}
            </div>
            <p class="mt-1 text-xs font-bold text-gray-400">${moneyBRL(product.preco)} • ${escapeHtml(product.categoriaNome)} • estoque ${Number(product.estoqueQuantidade || 0)}</p>
          </div>
        </div>
        <div class="mt-3 grid grid-cols-2 gap-2">
          <button type="button" data-edit-product="${escapeHtml(product.id)}" class="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-black text-emerald-700 hover:bg-emerald-100">
            Editar
          </button>
          <button type="button" data-toggle-product="${escapeHtml(product.id)}" data-next-active="${product.ativo ? 'false' : 'true'}" class="rounded-xl border border-gray-200 bg-white px-3 py-2 text-xs font-black text-gray-600 hover:bg-gray-50">
            ${product.ativo ? 'Pausar' : 'Ativar'}
          </button>
        </div>
      </div>
    `;
  }).join('');

  els.sellerProductsList.querySelectorAll('[data-toggle-product]').forEach((btn) => {
    btn.addEventListener('click', () => toggleSellerProduct(btn.getAttribute('data-toggle-product') || '', btn.getAttribute('data-next-active') === 'true'));
  });

  els.sellerProductsList.querySelectorAll('[data-edit-product]').forEach((btn) => {
    btn.addEventListener('click', () => startEditProduct(btn.getAttribute('data-edit-product') || ''));
  });

  initIcons();
}

function resetSellerProductForm() {
  editingProductId = '';
  selectedProductImageBase64 = '';
  els.sellerForm?.reset();
  if (els.sellerStock) els.sellerStock.value = '1';
  if (els.sellerActive) els.sellerActive.checked = true;
  if (els.sellerFeatured) els.sellerFeatured.checked = false;
  if (els.sellerProductFile) els.sellerProductFile.value = '';
  if (els.sellerFormTitle) els.sellerFormTitle.textContent = 'Cadastrar produto';
  if (els.sellerFormSubtitle) els.sellerFormSubtitle.textContent = 'O produto já entra na vitrine se estiver ativo.';
  if (els.saveSellerProductBtn) els.saveSellerProductBtn.textContent = 'Cadastrar produto';
  els.cancelProductEditBtn?.classList.add('hidden');
  setProductPhotoStatus();
}

function startEditProduct(productId) {
  const product = sellerProducts.find((item) => String(item.id) === String(productId));
  if (!product) return;

  editingProductId = product.id;
  selectedProductImageBase64 = String(product.imagem || '').startsWith('data:image/') ? String(product.imagem || '') : '';

  if (els.sellerTitle) els.sellerTitle.value = product.titulo || '';
  if (els.sellerPrice) els.sellerPrice.value = Number(product.preco || 0);
  if (els.sellerStock) els.sellerStock.value = Number(product.estoqueQuantidade || 0);
  if (els.sellerCategory) els.sellerCategory.value = product.categoriaId || '';
  if (els.sellerImage) els.sellerImage.value = String(product.imagem || '').startsWith('http') ? product.imagem : '';
  if (els.sellerDescription) els.sellerDescription.value = product.descricao || '';
  if (els.sellerActive) els.sellerActive.checked = product.ativo !== false;
  if (els.sellerFeatured) els.sellerFeatured.checked = product.destaque === true;
  if (els.sellerProductFile) els.sellerProductFile.value = '';

  if (els.sellerFormTitle) els.sellerFormTitle.textContent = 'Editar produto';
  if (els.sellerFormSubtitle) els.sellerFormSubtitle.textContent = `Editando: ${product.titulo}`;
  if (els.saveSellerProductBtn) els.saveSellerProductBtn.textContent = 'Salvar alterações';
  els.cancelProductEditBtn?.classList.remove('hidden');
  setProductPhotoStatus(selectedProductImageBase64 ? 'Imagem atual em base64 será mantida se você não enviar outra.' : 'Você pode trocar a imagem por link ou enviar novo arquivo.');

  els.sellerForm?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function getOrderStatusClass(status) {
  const s = String(status || '').toLowerCase();
  if (s === 'entregue') return 'bg-emerald-50 text-emerald-700 ring-emerald-200';
  if (s === 'reembolsado') return 'bg-red-50 text-red-700 ring-red-200';
  if (s === 'pago' || s === 'em_entrega') return 'bg-sky-50 text-sky-700 ring-sky-200';
  return 'bg-amber-50 text-amber-700 ring-amber-200';
}

function renderSellerOrders() {
  if (els.sellerOrdersCounter) els.sellerOrdersCounter.textContent = sellerOrders.length === 1 ? '1 pedido recebido' : `${sellerOrders.length} pedidos recebidos`;
  if (!els.sellerOrdersList) return;

  const supportSellerChats = sellerChats.filter((chat) => String(chat.tipo || '') === CHAT_TYPE_SUPPORT && !isChatExpired(chat) && !isChatClosed(chat));
  if (!sellerOrders.length && !supportSellerChats.length) {
    els.sellerOrdersList.innerHTML = '<div class="rounded-2xl border border-dashed border-gray-200 bg-gray-50 p-4 text-sm font-semibold text-gray-500 text-center">Nenhum pedido ou chat de suporte recebido ainda.</div>';
    return;
  }

  const supportChatsHtml = supportSellerChats.map((chat) => `<div class="rounded-2xl border border-sky-100 bg-sky-50 p-3">
    <div class="flex items-start justify-between gap-3">
      <div class="min-w-0"><p class="font-black text-sm text-gray-900 truncate">Chat aberto pelo suporte</p><p class="mt-1 text-xs font-bold text-sky-700">${escapeHtml(chat.assunto || chat.produtoTitulo || 'Suporte GuildaHub')}</p><p class="mt-1 text-xs font-semibold text-gray-600">${escapeHtml(getChatRemainingLabel(chat))}</p></div>
      <span class="rounded-full bg-white px-2.5 py-1 text-[10px] font-black text-sky-700 ring-1 ring-sky-200">SUPORTE</span>
    </div>
    <button type="button" data-open-seller-support-chat="${escapeHtml(chat.id)}" class="mt-3 rounded-xl bg-sky-600 px-3 py-2 text-xs font-black text-white hover:bg-sky-700">Abrir chat com suporte</button>
  </div>`).join('');

  const ordersHtml = sellerOrders.map((order) => {
    const status = String(order.status || 'pendente').toLowerCase();
    const locked = isFinalOrderStatus(status) || order.finalizado === true;
    const created = formatDateTimeBR(order.createdAtMs || order.createdAt);
    const sellerChat = getSellerChatForOrder(order.id);
    const chatExpired = sellerChat && isChatExpired(sellerChat);
    const canOpenChat = sellerChat && !chatExpired && !isChatClosed(sellerChat);
    const chatHtml = sellerChat
      ? `<div class="mt-3 rounded-xl border ${canOpenChat ? 'border-emerald-200 bg-emerald-50' : 'border-gray-200 bg-gray-50'} p-3"><p class="text-[10px] font-black uppercase tracking-wider ${canOpenChat ? 'text-emerald-800' : 'text-gray-600'}">Chat temporário do pedido</p><p class="mt-1 text-xs font-semibold ${canOpenChat ? 'text-emerald-900' : 'text-gray-700'}">Status: ${escapeHtml(chatExpired ? 'expirado' : (sellerChat.status || 'ativo'))} • ${escapeHtml(getChatRemainingLabel(sellerChat))}</p>${canOpenChat ? `<button type="button" data-open-seller-chat="${escapeHtml(order.id)}" class="mt-2 rounded-xl bg-emerald-600 px-3 py-2 text-xs font-black text-white hover:bg-emerald-700">Abrir chat com comprador</button>` : ''}</div>`
      : '';
    return `<div class="rounded-2xl border border-gray-100 bg-gray-50 p-3"><div class="flex items-start justify-between gap-3"><div class="min-w-0"><p class="font-black text-sm text-gray-900 truncate">${escapeHtml(order.produtoTitulo || 'Produto')}</p><p class="mt-1 text-xs font-bold text-gray-400">Pedido: ${escapeHtml(order.id)}</p><p class="mt-1 text-xs font-semibold text-gray-500">Comprador: ${escapeHtml(order.buyerName || order.buyerNick || '-')}</p><p class="mt-1 text-xs font-semibold text-gray-500">ID comprador: ${escapeHtml(order.buyerId || '-')}</p><p class="mt-1 text-xs font-semibold text-gray-500">Data: ${escapeHtml(created)}</p></div><span class="shrink-0 rounded-full px-2.5 py-1 text-[10px] font-black ring-1 ${getOrderStatusClass(status)}">${escapeHtml(status.toUpperCase())}</span></div>${chatHtml}<div class="mt-3 flex items-center justify-between gap-3"><p class="text-base font-black text-emerald-700">${moneyBRL(order.total || order.precoUnitario || 0)}</p><div class="flex flex-wrap justify-end gap-2">${locked ? '<span class="rounded-xl bg-gray-100 px-3 py-2 text-xs font-black text-gray-500">Finalizado</span>' : `<button type="button" data-order-action="entregue" data-order-id="${escapeHtml(order.id)}" class="rounded-xl bg-emerald-600 px-3 py-2 text-xs font-black text-white hover:bg-emerald-700">Entregue</button><button type="button" data-order-action="reembolsado" data-order-id="${escapeHtml(order.id)}" class="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs font-black text-red-700 hover:bg-red-100">Reembolso</button>`}</div></div></div>`;
  }).join('');

  els.sellerOrdersList.innerHTML = supportChatsHtml + ordersHtml;
  els.sellerOrdersList.querySelectorAll('[data-order-action]').forEach((btn) => btn.addEventListener('click', () => updateOrderStatus(btn.getAttribute('data-order-id') || '', btn.getAttribute('data-order-action') || '')));
  els.sellerOrdersList.querySelectorAll('[data-open-seller-chat]').forEach((btn) => btn.addEventListener('click', () => openProblemModal(btn.getAttribute('data-open-seller-chat') || '', CHAT_TYPE_SELLER)));
  els.sellerOrdersList.querySelectorAll('[data-open-seller-support-chat]').forEach((btn) => btn.addEventListener('click', () => openChatById(btn.getAttribute('data-open-seller-support-chat') || '')));
}

async function openSellerPanel() {
  setMobileCollapsibleState(els.sellerForm, els.toggleSellerFormBtn, false, 'Fechar cadastro de produto', 'Abrir/editar cadastro de produto');
  setMobileCollapsibleState(els.sellerProductsCard, els.toggleSellerProductsBtn, false, 'Fechar meus produtos', 'Abrir/editar meus produtos');
  if (!lojaStatus?.vendedor) {
    const seller = await createOrUpdateSellerProfile();
    if (!seller) return;
  }

  openSellerModal();
  renderSellerProfileCard();
  await reloadSellerPanelData();
}

async function reloadSellerPanelData() {
  if (!lojaStatus?.vendedor || loadingSellerPanel) return;
  loadingSellerPanel = true;

  if (els.sellerProductsList) els.sellerProductsList.innerHTML = '<div class="rounded-2xl border border-gray-100 bg-gray-50 p-4 text-sm font-semibold text-gray-500 text-center">Carregando produtos...</div>';
  if (els.sellerOrdersList) els.sellerOrdersList.innerHTML = '<div class="rounded-2xl border border-gray-100 bg-gray-50 p-4 text-sm font-semibold text-gray-500 text-center">Carregando pedidos...</div>';

  try {
    await Promise.all([loadSellerProducts(), loadSellerOrders(), loadSellerChats()]);
    renderSellerOrders();
  } finally {
    loadingSellerPanel = false;
  }
}

async function handleSellerProductSubmit(event) {
  event.preventDefault();

  if (!lojaStatus?.vendedor || !ghubProfile?.gameId) {
    localToast('error', 'Crie seu perfil de vendedor antes de cadastrar produtos.');
    return;
  }

  if (lojaStatus.vendedor.ativo === false || String(lojaStatus.vendedor.status || '').toLowerCase() === 'inativo') {
    localToast('error', 'Sua conta de vendedor está inativa e não pode criar novos anúncios.');
    return;
  }

  const title = String(els.sellerTitle?.value || '').trim();
  const price = Number(els.sellerPrice?.value || 0);
  const stock = Math.max(0, Math.floor(Number(els.sellerStock?.value || 0)));
  const categoryId = String(els.sellerCategory?.value || '').trim();
  const categoryName = getCategoryName(categoryId);
  const imageFromUrl = String(els.sellerImage?.value || '').trim();
  const image = selectedProductImageBase64 || imageFromUrl;
  const description = String(els.sellerDescription?.value || '').trim().slice(0, 300);
  const ativo = !!els.sellerActive?.checked;
  const destaque = !!els.sellerFeatured?.checked;

  if (!title) {
    localToast('error', 'Digite o nome do produto.');
    return;
  }

  if (!Number.isFinite(price) || price < 0) {
    localToast('error', 'Digite um preço válido.');
    return;
  }

  if (!categoryId) {
    localToast('error', 'Selecione uma categoria.');
    return;
  }

  setButtonLoading(els.saveSellerProductBtn, true, editingProductId ? 'Salvar alterações' : 'Cadastrar produto');

  try {
    const seller = lojaStatus.vendedor;
    const basePayload = {
      sellerId: ghubProfile.gameId,
      sellerName: seller.nome || seller.nick || ghubProfile.nick || 'Vendedor',
      sellerPhoto: seller.foto || ghubProfile.foto || '',
      vendedorId: ghubProfile.gameId,
      vendedorNome: seller.nome || seller.nick || ghubProfile.nick || 'Vendedor',
      vendedorFoto: seller.foto || ghubProfile.foto || '',

      titulo: title,
      descricao: description,
      preco: price,
      moeda: 'BRL',
      imagem: image,
      imagens: image ? [image] : [],
      categoriaId: categoryId,
      categoriaNome: categoryName,
      tipoProduto: 'digital',
      entregaTipo: 'manual',
      estoqueAtivo: true,
      estoqueQuantidade: stock,
      ativo,
      destaque,
      updatedAt: serverTimestamp()
    };

    if (editingProductId) {
      const existing = sellerProducts.find((item) => String(item.id) === String(editingProductId));
      if (existing && String(existing.sellerId) !== String(ghubProfile.gameId)) {
        throw new Error('Produto não pertence ao vendedor.');
      }

      await setDoc(doc(lojaDb, 'produtos', editingProductId), basePayload, { merge: true });
      localToast('success', 'Produto atualizado.');
    } else {
      const payload = {
        ...basePayload,
        visualizacoes: 0,
        totalVendas: 0,
        createdAt: serverTimestamp()
      };
      const productRef = await addDoc(collection(lojaDb, 'produtos'), payload);
      await setDoc(productRef, { id: productRef.id }, { merge: true });

      await setDoc(doc(lojaDb, 'vendedor', ghubProfile.gameId), {
        totalProdutos: sellerProducts.length + 1,
        updatedAt: serverTimestamp()
      }, { merge: true });

      localToast('success', 'Produto cadastrado na loja.');
    }

    resetSellerProductForm();
    await Promise.all([loadProducts(), loadSellerProducts()]);
  } catch (err) {
    console.error(err);
    localToast('error', editingProductId ? 'Não foi possível atualizar o produto.' : 'Não foi possível cadastrar o produto. Confira se as regras do Firebase permitem escrita.');
  } finally {
    setButtonLoading(els.saveSellerProductBtn, false, editingProductId ? 'Salvar alterações' : 'Cadastrar produto');
  }
}

async function toggleSellerProduct(productId, nextActive) {
  if (!productId || !ghubProfile?.gameId) return;

  try {
    const product = sellerProducts.find((item) => String(item.id) === String(productId));
    if (product && String(product.sellerId) !== String(ghubProfile.gameId)) {
      localToast('error', 'Esse produto não pertence ao seu vendedor.');
      return;
    }

    await setDoc(doc(lojaDb, 'produtos', productId), {
      ativo: !!nextActive,
      updatedAt: serverTimestamp()
    }, { merge: true });

    localToast('success', nextActive ? 'Produto ativado.' : 'Produto pausado.');
    await Promise.all([loadProducts(), loadSellerProducts()]);
  } catch (err) {
    console.error(err);
    localToast('error', 'Não foi possível atualizar o produto.');
  }
}

async function updateOrderStatus(orderId, action) {
  if (!orderId || !action) return;
  const order = sellerOrders.find((item) => String(item.id) === String(orderId));
  if (!order) return;
  if (String(order.sellerId) !== String(ghubProfile?.gameId || '')) { localToast('error', 'Esse pedido não pertence ao seu vendedor.'); return; }
  if (isFinalOrderStatus(order.status) || order.finalizado === true) { localToast('error', 'Esse pedido já foi finalizado e não pode ser alterado.'); return; }
  const nowMs = Date.now();
  const deliveryInfoText = String(document.querySelector(`[data-delivery-info-for="${CSS.escape(String(orderId))}"]`)?.value || '').trim();
  if (action === 'entregue' && categoryRequiresSellerDeliveryInfo(order.categoriaId) && !deliveryInfoText) { localToast('error', 'Preencha as informações de entrega antes de marcar como entregue.'); document.querySelector(`[data-delivery-info-for="${CSS.escape(String(orderId))}"]`)?.focus(); return; }
  const updates = { status: action, finalizado: true, updatedAt: serverTimestamp() };
  if (action === 'entregue') {
    updates.entregueEmMs = nowMs;
    updates.deliveryInfo = deliveryInfoText || order.deliveryInfo || '';
    updates.deliveryInfoUpdatedAtMs = deliveryInfoText ? nowMs : (order.deliveryInfoUpdatedAtMs || null);
    updates.entrega = { ...(order?.entrega || {}), status: 'entregue', informacoes: deliveryInfoText || order.entrega?.informacoes || '', entregueEm: serverTimestamp(), entregueEmMs: nowMs };
  }
  if (action === 'reembolsado') {
    updates.reembolsadoEmMs = nowMs;
    updates.pagamento = { ...(order?.pagamento || {}), status: 'reembolsado', reembolsadoEm: serverTimestamp(), reembolsadoEmMs: nowMs };
    updates.entrega = { ...(order?.entrega || {}), status: 'reembolso_emitido' };
  }
  try {
    await setDoc(doc(lojaDb, 'pedidos', orderId), updates, { merge: true });
    if (action === 'entregue' && order.produtoId) {
      const productRef = doc(lojaDb, 'produtos', String(order.produtoId));
      const currentProduct = sellerProducts.find((p) => String(p.id) === String(order.produtoId)) || products.find((p) => String(p.id) === String(order.produtoId));
      await setDoc(productRef, { totalVendas: Number(currentProduct?.totalVendas || 0) + 1, updatedAt: serverTimestamp() }, { merge: true });
    }
    localToast('success', action === 'reembolsado' ? 'Pedido marcado como reembolsado.' : 'Pedido marcado como entregue.');
    await Promise.all([loadSellerOrders(), loadProducts(), loadSellerProducts(), loadBuyerOrders()]);
  } catch (err) { console.error(err); localToast('error', 'Não foi possível atualizar o pedido.'); }
}

async function requestSellerWithdraw() {
  if (!lojaStatus?.vendedor || !ghubProfile?.gameId) return;
  const finances = calculateSellerFinancials(sellerOrders, lojaStatus.vendedor);
  if (finances.saldoAtual < SELLER_WITHDRAW_MIN) { localToast('error', 'Saque disponível apenas com saldo atual mínimo de R$ 20,00.'); return; }
  const pix = String(qs('seller-withdraw-pix')?.value || '').trim();
  if (!pix) { localToast('error', 'Informe sua chave Pix para solicitar o saque.'); qs('seller-withdraw-pix')?.focus(); return; }
  const amount = Number(finances.saldoAtual || 0);
  const previousPending = Number(lojaStatus.vendedor?.saquePendente || lojaStatus.vendedor?.financeiro?.saldoEmSaque || 0);
  const nextPending = previousPending + amount;
  try {
    await addDoc(collection(lojaDb, 'saques'), { sellerId: ghubProfile.gameId, sellerName: lojaStatus.vendedor.nome || lojaStatus.vendedor.nick || ghubProfile.nick || '', sellerEmail: normalizeEmail(currentUser?.email || ghubProfile.email || ''), pix, valor: amount, status: 'pendente', createdAt: serverTimestamp(), createdAtMs: Date.now(), updatedAt: serverTimestamp() });
    await setDoc(doc(lojaDb, 'vendedor', ghubProfile.gameId), { saquePendente: nextPending, saldoEmSaque: nextPending, saldoAtual: 0, ultimoPixSaque: pix, updatedAt: serverTimestamp() }, { merge: true });
    lojaStatus.vendedor = { ...lojaStatus.vendedor, saquePendente: nextPending, saldoEmSaque: nextPending, saldoAtual: 0, ultimoPixSaque: pix };
    localToast('success', 'Solicitação de saque enviada.');
    await loadSellerOrders();
  } catch (err) { console.error(err); localToast('error', 'Não foi possível solicitar o saque. Confira as regras do Firebase.'); }
}

function openBuyerModal() { if (!currentUser) { localToast('error', 'Entre na GuildaHub para ver suas compras.'); return; } els.buyerModal?.classList.remove('hidden'); els.buyerModal?.classList.add('flex'); initIcons(); loadBuyerOrders(); }

function closeBuyerModal() { els.buyerModal?.classList.add('hidden'); els.buyerModal?.classList.remove('flex'); }



function getChatId(orderId, type = CHAT_TYPE_SELLER) {
  return `${type}_${String(orderId || '').replace(/[^a-zA-Z0-9_-]/g, '_')}`;
}

function getChatTypeLabel(type) {
  return type === CHAT_TYPE_SUPPORT ? 'suporte da plataforma' : 'vendedor';
}

function getChatDurationHours(type) {
  return type === CHAT_TYPE_SUPPORT ? SUPPORT_CHAT_HOURS : SELLER_CHAT_HOURS;
}

function getChatForOrder(orderId, type = CHAT_TYPE_SELLER) {
  return buyerProblems.find((chat) => String(chat.orderId || chat.pedidoId || '') === String(orderId) && String(chat.tipo || '') === String(type));
}

function getSellerChatForOrder(orderId) {
  return sellerChats.find((chat) => String(chat.orderId || chat.pedidoId || '') === String(orderId) && String(chat.tipo || '') === CHAT_TYPE_SELLER);
}

function isChatExpired(chat) {
  if (!chat) return false;
  const expires = Number(chat.expiresAtMs || 0) || timestampToMs(chat.expiresAt);
  return !!expires && Date.now() > expires;
}

function isChatClosed(chat) {
  const status = String(chat?.status || '').toLowerCase();
  return status === 'encerrado' || status === 'expirado' || status === 'escalado' || status === 'fechado';
}

function getChatRemainingLabel(chat) {
  const expires = Number(chat?.expiresAtMs || 0) || timestampToMs(chat?.expiresAt);
  if (!expires) return '';
  const diff = expires - Date.now();
  if (diff <= 0) return 'expirado';
  const hours = Math.floor(diff / 3600000);
  const minutes = Math.ceil((diff % 3600000) / 60000);
  if (hours >= 1) return `${hours}h ${minutes}min restantes`;
  return `${Math.max(1, minutes)}min restantes`;
}

function normalizeChatDoc(docSnap) {
  return { id: docSnap.id, ...(docSnap.data() || {}) };
}

async function loadBuyerProblems() {
  if (!currentUser || !ghubProfile?.gameId) {
    buyerProblems = [];
    return;
  }
  try {
    const snap = await getDocs(query(collection(lojaDb, CHAT_COLLECTION), where('buyerId', '==', String(ghubProfile.gameId))));
    buyerProblems = snap.docs.map(normalizeChatDoc);
    await markExpiredChatsIfNeeded(buyerProblems);
  } catch (err) {
    console.warn('Não foi possível carregar chats do comprador:', err);
    buyerProblems = [];
  }
}

async function loadSellerChats() {
  if (!currentUser || !ghubProfile?.gameId) {
    sellerChats = [];
    return;
  }
  try {
    const snap = await getDocs(query(collection(lojaDb, CHAT_COLLECTION), where('sellerId', '==', String(ghubProfile.gameId))));
    sellerChats = snap.docs.map(normalizeChatDoc);
    await markExpiredChatsIfNeeded(sellerChats);
  } catch (err) {
    console.warn('Não foi possível carregar chats do vendedor:', err);
    sellerChats = [];
  }
}

async function closeAndDeleteChat(chat, reason = 'encerrado') {
  if (!chat?.id) return;
  const now = Date.now();
  const type = String(chat.tipo || CHAT_TYPE_SELLER);
  const orderId = String(chat.orderId || chat.pedidoId || '');
  const orderPatch = { updatedAt: serverTimestamp() };

  if (type === CHAT_TYPE_SUPPORT) {
    orderPatch.suporteAberto = false;
    orderPatch.suporteStatus = reason;
    orderPatch.suporteEncerradoEmMs = now;
  } else {
    orderPatch.chatVendedorAberto = false;
    orderPatch.chatVendedorStatus = reason;
    orderPatch.chatVendedorEncerradoEmMs = now;
  }

  if (orderId) await setDoc(doc(lojaDb, 'pedidos', orderId), orderPatch, { merge: true });
  await deleteDoc(doc(lojaDb, CHAT_COLLECTION, String(chat.id)));
}

async function markExpiredChatsIfNeeded(chats = []) {
  const now = Date.now();
  const updates = [];
  for (const chat of chats) {
    const status = String(chat.status || '').toLowerCase();
    const expires = Number(chat.expiresAtMs || 0) || timestampToMs(chat.expiresAt);
    if (expires && now > expires && status === 'ativo') {
      chat.status = 'expirado';
      updates.push(closeAndDeleteChat(chat, 'expirado'));
    }
  }
  if (updates.length) {
    try { await Promise.all(updates); } catch (err) { console.warn('Não foi possível encerrar chats expirados:', err); }
  }
}

async function createOrGetChatForOrder
(order, type = CHAT_TYPE_SELLER) {
  if (!order?.id) throw new Error('order-not-found');
  const id = getChatId(order.id, type);
  const ref = doc(lojaDb, CHAT_COLLECTION, id);
  const snap = await getDoc(ref);
  const now = Date.now();
  const hours = getChatDurationHours(type);
  const expiresAtMs = now + (hours * 60 * 60 * 1000);

  if (snap.exists()) {
    const existing = { id: snap.id, ...snap.data() };
    if (isChatExpired(existing) && String(existing.status || '') === 'ativo') {
      await closeAndDeleteChat(existing, 'expirado');
      existing.status = 'expirado';
    }
    return existing;
  }

  const payload = {
    id,
    tipo: type,
    status: 'ativo',
    orderId: order.id,
    pedidoId: order.id,
    buyerId: order.buyerId || ghubProfile?.gameId || '',
    buyerUid: order.buyerUid || currentUser?.uid || '',
    buyerEmail: order.buyerEmail || normalizeEmail(currentUser?.email || ghubProfile?.email || ''),
    buyerName: order.buyerName || order.buyerNick || ghubProfile?.nick || '',
    sellerId: order.sellerId || '',
    sellerName: order.sellerName || '',
    produtoId: order.produtoId || '',
    produtoTitulo: order.produtoTitulo || '',
    categoriaId: order.categoriaId || '',
    categoriaNome: order.categoriaNome || '',
    total: Number(order.total || order.precoUnitario || 0),
    mensagens: [{
      autorId: 'sistema',
      autorTipo: 'sistema',
      autorNome: 'GuildaHub',
      texto: type === CHAT_TYPE_SUPPORT ? 'Chat com o suporte aberto. Explique com o máximo de clareza possível qual é o problema, o que aconteceu, o ID do pedido e qualquer detalhe importante para análise.' : `Chat temporário com ${getChatTypeLabel(type)} aberto.`,
      createdAtMs: now
    }],
    createdAt: serverTimestamp(),
    createdAtMs: now,
    expiresAt: new Date(expiresAtMs),
    expiresAtMs,
    updatedAt: serverTimestamp(),
    orderSnapshot: {
      id: order.id,
      buyerId: order.buyerId || '',
      sellerId: order.sellerId || '',
      produtoId: order.produtoId || '',
      produtoTitulo: order.produtoTitulo || '',
      total: Number(order.total || order.precoUnitario || 0),
      status: order.status || '',
      buyerInfo: order.buyerInfo || '',
      deliveryInfo: order.deliveryInfo || order.entrega?.informacoes || '',
      createdAtMs: order.createdAtMs || null,
      entregueEmMs: order.entregueEmMs || order.entrega?.entregueEmMs || null
    }
  };

  await setDoc(ref, payload, { merge: true });
  if (type === CHAT_TYPE_SUPPORT) {
    await setDoc(doc(lojaDb, 'pedidos', String(order.id)), {
      suporteAberto: true,
      suporteChatId: id,
      updatedAt: serverTimestamp()
    }, { merge: true });
  } else {
    await setDoc(doc(lojaDb, 'pedidos', String(order.id)), {
      chatVendedorAberto: true,
      chatVendedorId: id,
      updatedAt: serverTimestamp()
    }, { merge: true });
  }
  return { ...payload, id };
}

function openProblemModal(orderId, type = CHAT_TYPE_SELLER) {
  const order = buyerOrders.find((item) => String(item.id) === String(orderId)) || sellerOrders.find((item) => String(item.id) === String(orderId));
  if (!order) return;
  activeProblemOrderId = String(orderId);
  activeProblemChatType = type;
  createOrGetChatForOrder(order, type)
    .then((chat) => openChatModalWithChat(order, chat))
    .catch((err) => {
      console.error(err);
      localToast('error', 'Não foi possível abrir o chat. Confira as regras do Firebase.');
    });
}

function openChatModalWithChat(order, chat) {
  activeProblemOrderId = String(order?.id || chat?.orderId || chat?.pedidoId || '');
  activeProblemChatId = String(chat.id || getChatId(activeProblemOrderId || chat.id, chat.tipo || CHAT_TYPE_SELLER));
  activeProblemChatType = String(chat.tipo || CHAT_TYPE_SELLER);

  const typeLabel = getChatTypeLabel(activeProblemChatType);
  const expired = isChatExpired(chat);
  const closed = isChatClosed(chat) || expired;
  const currentIsSeller = String(ghubProfile?.gameId || '') === String(chat.sellerId || '');
  const currentIsBuyer = String(ghubProfile?.gameId || '') === String(chat.buyerId || '');
  const currentIsSupport = isSupportAdmin && activeProblemChatType === CHAT_TYPE_SUPPORT;

  if (els.problemModalTitle) els.problemModalTitle.textContent = activeProblemChatType === CHAT_TYPE_SUPPORT ? 'Chat com suporte' : 'Chat com vendedor';
  if (els.problemOrderSubtitle) els.problemOrderSubtitle.textContent = order.id && String(order.id) !== String(chat.id || '') ? `Pedido ${order.id}` : 'Atendimento sem pedido vinculado';
  if (els.problemOrderSummary) {
    els.problemOrderSummary.innerHTML = `<p class="font-black text-gray-900">${escapeHtml(order.produtoTitulo || chat.produtoTitulo || 'Produto')}</p><p class="mt-1 text-xs text-gray-500">Pedido: ${escapeHtml(order.id)}</p><p class="mt-1 text-xs text-gray-500">Comprador: ${escapeHtml(chat.buyerName || order.buyerName || order.buyerId || '-')}</p><p class="mt-1 text-xs text-gray-500">Vendedor: ${escapeHtml(chat.sellerName || order.sellerName || order.sellerId || '-')}</p><p class="mt-1 text-xs text-gray-500">Valor: ${moneyBRL(order.total || order.precoUnitario || chat.total || 0)}</p>`;
  }

  if (els.problemChatStatus) {
    const remaining = getChatRemainingLabel(chat);
    const baseClass = closed
      ? 'rounded-2xl border border-gray-200 bg-gray-50 p-3 text-xs font-semibold leading-relaxed text-gray-700'
      : 'rounded-2xl border border-amber-200 bg-amber-50 p-3 text-xs font-semibold leading-relaxed text-amber-800';
    els.problemChatStatus.className = baseClass;
    els.problemChatStatus.textContent = closed
      ? `Este chat com ${typeLabel} está ${expired ? 'expirado' : String(chat.status || 'fechado')}.`
      : `Chat com ${typeLabel} ativo. ${remaining ? remaining + '.' : ''}`;
  }

  renderChatMessages(chat);

  if (els.problemDescription) {
    els.problemDescription.value = '';
    els.problemDescription.disabled = closed;
    els.problemDescription.placeholder = closed ? 'Este chat foi encerrado.' : 'Escreva sua mensagem...';
  }
  if (els.submitProblemBtn) {
    els.submitProblemBtn.disabled = closed;
    els.submitProblemBtn.textContent = closed ? 'Chat encerrado' : 'Enviar mensagem';
  }

  if (els.resolveChatBtn) {
    const canEnd = !closed && (currentIsBuyer || currentIsSeller || currentIsSupport);
    els.resolveChatBtn.classList.toggle('hidden', !canEnd);
    els.resolveChatBtn.textContent = 'Terminar chat';
  }

  if (els.escalateChatBtn) {
    const sellerChatEndedOnOrder = String(order.chatVendedorStatus || '').toLowerCase() === 'encerrado' || String(order.chatVendedorStatus || '').toLowerCase() === 'expirado';
    const canEscalate = activeProblemChatType === CHAT_TYPE_SELLER && currentIsBuyer && (expired || sellerChatEndedOnOrder || String(chat.status || '') === 'expirado' || String(chat.status || '') === 'escalado');
    els.escalateChatBtn.classList.toggle('hidden', !canEscalate);
    els.escalateChatBtn.textContent = expired ? 'Chamar suporte' : 'Chamar suporte';
    els.escalateChatBtn.disabled = !currentIsBuyer;
  }

  els.problemModal?.classList.remove('hidden');
  els.problemModal?.classList.add('flex');
  initIcons();
}

function renderChatMessages(chat) {
  if (!els.problemChatMessages) return;
  const messages = Array.isArray(chat?.mensagens) ? chat.mensagens : [];
  if (!messages.length) {
    els.problemChatMessages.innerHTML = '<div class="text-center text-xs font-semibold text-gray-400">Nenhuma mensagem ainda.</div>';
    return;
  }
  els.problemChatMessages.innerHTML = messages.map((msg) => {
    const mine = String(msg.autorId || '') === String(ghubProfile?.gameId || '');
    const role = msg.autorTipo === 'sistema' ? 'Sistema' : msg.autorTipo === 'suporte' ? 'Suporte' : msg.autorTipo === 'vendedor' ? 'Vendedor' : 'Comprador';
    return `<div class="flex ${mine ? 'justify-end' : 'justify-start'}"><div class="max-w-[85%] rounded-2xl ${mine ? 'bg-emerald-600 text-white' : 'bg-white text-gray-800 border border-gray-100'} px-3 py-2 shadow-sm"><div class="flex items-center justify-between gap-3"><p class="text-[10px] font-black uppercase tracking-wider ${mine ? 'text-emerald-50' : 'text-gray-400'}">${escapeHtml(role)} • ${escapeHtml(msg.autorNome || '')}</p><p class="text-[10px] ${mine ? 'text-emerald-50' : 'text-gray-400'}">${escapeHtml(formatDateTimeBR(msg.createdAtMs))}</p></div><p class="mt-1 whitespace-pre-wrap text-sm font-semibold leading-relaxed">${escapeHtml(msg.texto || '')}</p></div></div>`;
  }).join('');
  els.problemChatMessages.scrollTop = els.problemChatMessages.scrollHeight;
}

function closeProblemModal() {
  activeProblemOrderId = '';
  activeProblemChatId = '';
  activeProblemChatType = '';
  els.problemModal?.classList.add('hidden');
  els.problemModal?.classList.remove('flex');
}

function getCurrentChatSenderRole(chat) {
  const gid = String(ghubProfile?.gameId || '');
  if (isSupportAdmin && String(chat?.tipo || '') === CHAT_TYPE_SUPPORT) return 'suporte';
  if (gid && gid === String(chat?.sellerId || '')) return 'vendedor';
  if (gid && gid === String(chat?.buyerId || '')) return 'comprador';
  return 'comprador';
}

async function submitProblem(event) {
  event.preventDefault();
  if (!activeProblemChatId) return;
  const description = String(els.problemDescription?.value || '').trim();
  if (!description) { localToast('error', 'Escreva uma mensagem.'); els.problemDescription?.focus(); return; }

  const ref = doc(lojaDb, CHAT_COLLECTION, activeProblemChatId);
  setButtonLoading(els.submitProblemBtn, true, 'Enviar mensagem');
  try {
    const snap = await getDoc(ref);
    if (!snap.exists()) throw new Error('chat-not-found');
    const chat = { id: snap.id, ...snap.data() };
    if (isChatExpired(chat) || isChatClosed(chat)) {
      await setDoc(ref, { status: isChatExpired(chat) ? 'expirado' : (chat.status || 'fechado'), updatedAt: serverTimestamp() }, { merge: true });
      localToast('error', 'Esse chat já foi encerrado.');
      closeProblemModal();
      await Promise.all([loadBuyerOrders(), loadSellerChats().then(renderSellerOrders)]);
      return;
    }
    const msg = {
      autorId: ghubProfile?.gameId || '',
      autorUid: currentUser?.uid || '',
      autorNome: ghubProfile?.nick || currentUser?.email || 'Usuário',
      autorTipo: getCurrentChatSenderRole(chat),
      texto: description,
      createdAtMs: Date.now()
    };
    const messages = Array.isArray(chat.mensagens) ? chat.mensagens : [];
    const nextChat = { ...chat, mensagens: [...messages, msg], lastMessageAtMs: msg.createdAtMs, updatedAt: serverTimestamp() };
    await setDoc(ref, nextChat, { merge: true });
    if (els.problemDescription) els.problemDescription.value = '';
    renderChatMessages(nextChat);
    localToast('success', 'Mensagem enviada.');
    await Promise.all([loadBuyerOrders(), loadSellerChats().then(renderSellerOrders)]);
  } catch (err) {
    console.error(err);
    localToast('error', 'Não foi possível enviar a mensagem. Confira as regras do Firebase.');
  } finally {
    setButtonLoading(els.submitProblemBtn, false, 'Enviar mensagem');
  }
}

async function resolveActiveChat() {
  if (!activeProblemChatId) return;
  try {
    const snap = await getDoc(doc(lojaDb, CHAT_COLLECTION, activeProblemChatId));
    const chat = snap.exists() ? { id: snap.id, ...snap.data() } : { id: activeProblemChatId, tipo: activeProblemChatType, orderId: activeProblemOrderId };
    await closeAndDeleteChat(chat, 'encerrado');
    localToast('success', 'Chat encerrado.');
    closeProblemModal();
    await Promise.all([loadBuyerOrders(), loadSellerChats().then(renderSellerOrders), isSupportAdmin ? loadSupportPanelData() : Promise.resolve()]);
  } catch (err) {
    console.error(err);
    localToast('error', 'Não foi possível terminar o chat.');
  }
}

async function escalateActiveChatToSupport
() {
  if (!activeProblemOrderId) return;
  const order = buyerOrders.find((item) => String(item.id) === String(activeProblemOrderId));
  if (!order) return;
  try {
    if (activeProblemChatId) {
      const snap = await getDoc(doc(lojaDb, CHAT_COLLECTION, activeProblemChatId));
      if (snap.exists()) await closeAndDeleteChat({ id: snap.id, ...snap.data() }, 'escalado');
    }
    const supportChat = await createOrGetChatForOrder(order, CHAT_TYPE_SUPPORT);
    localToast('success', 'Chat com suporte aberto por 48 horas.');
    openChatModalWithChat(order, supportChat);
    await loadBuyerOrders();
  } catch (err) {
    console.error(err);
    localToast('error', 'Não foi possível abrir o chat com suporte.');
  }
}

async function loadBuyerOrders() {
  if (!currentUser || !ghubProfile?.gameId) { buyerOrders = []; renderBuyerOrders(); return; }
  if (els.buyerOrdersList) els.buyerOrdersList.innerHTML = '<div class="rounded-2xl border border-gray-100 bg-gray-50 p-4 text-sm font-semibold text-gray-500 text-center">Carregando compras...</div>';
  try {
    const [ordersSnap] = await Promise.all([
      getDocs(query(collection(lojaDb, 'pedidos'), where('buyerId', '==', String(ghubProfile.gameId)))),
      loadBuyerProblems()
    ]);
    buyerOrders = ordersSnap.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => Number(b?.createdAtMs || b?.createdAt?.seconds || 0) - Number(a?.createdAtMs || a?.createdAt?.seconds || 0));
  } catch (err) { console.error('Erro ao carregar compras:', err?.code || err?.message || err, err); buyerOrders = []; buyerProblems = []; localToast('error', `Não foi possível carregar suas compras. Erro: ${err?.code || err?.message || 'verifique as regras/índices'}`); }
  renderBuyerOrders();
}

function renderBuyerOrders() {
  if (els.buyerOrdersCounter) els.buyerOrdersCounter.textContent = buyerOrders.length === 1 ? '1 compra encontrada' : `${buyerOrders.length} compras encontradas`;
  if (!els.buyerOrdersList) return;
  if (!currentUser) { els.buyerOrdersList.innerHTML = '<div class="rounded-2xl border border-dashed border-gray-200 bg-gray-50 p-5 text-center text-sm font-semibold text-gray-500">Entre na GuildaHub para ver suas compras.</div>'; return; }
  if (!buyerOrders.length) { els.buyerOrdersList.innerHTML = '<div class="rounded-2xl border border-dashed border-gray-200 bg-gray-50 p-5 text-center text-sm font-semibold text-gray-500">Nenhuma compra encontrada ainda.</div>'; return; }

  els.buyerOrdersList.innerHTML = buyerOrders.map((order) => {
    const status = String(order.status || 'pendente').toLowerCase();
    const locked = isFinalOrderStatus(status) || order.finalizado === true;
    const created = formatDateTimeBR(order.createdAtMs || order.createdAt);
    const needsBuyerInfo = categoryRequiresBuyerInfo(order.categoriaId);
    const needsSellerInfo = categoryRequiresSellerDeliveryInfo(order.categoriaId);
    const buyerInfo = order.buyerInfo || '';
    const deliveryInfo = order.deliveryInfo || order.entrega?.informacoes || '';
    const sellerChat = getChatForOrder(order.id, CHAT_TYPE_SELLER);
    const supportChat = getChatForOrder(order.id, CHAT_TYPE_SUPPORT);
    const sellerExpired = sellerChat && isChatExpired(sellerChat);
    const supportExpired = supportChat && isChatExpired(supportChat);
    let chatHtml = '';

    if (supportChat) {
      chatHtml = `<div class="mt-3 rounded-xl border ${supportExpired ? 'border-gray-200 bg-gray-50' : 'border-sky-200 bg-sky-50'} p-3"><p class="text-[10px] font-black uppercase tracking-wider ${supportExpired ? 'text-gray-600' : 'text-sky-800'}">Chat com suporte</p><p class="mt-1 text-xs font-semibold ${supportExpired ? 'text-gray-700' : 'text-sky-900'}">Status: ${escapeHtml(supportExpired ? 'expirado' : (supportChat.status || 'ativo'))} • ${escapeHtml(getChatRemainingLabel(supportChat))}</p><button type="button" data-open-support-chat="${escapeHtml(order.id)}" class="mt-2 rounded-xl ${supportExpired ? 'bg-gray-200 text-gray-500' : 'bg-sky-600 text-white hover:bg-sky-700'} px-3 py-2 text-xs font-black" ${supportExpired ? 'disabled' : ''}>Abrir chat com suporte</button></div>`;
    } else if (sellerChat) {
      const statusChat = sellerExpired ? 'expirado' : (sellerChat.status || 'ativo');
      const canOpenSeller = !sellerExpired && !isChatClosed(sellerChat);
      const canSupport = sellerExpired || String(sellerChat.status || '') === 'expirado' || String(order.chatVendedorStatus || '') === 'encerrado' || String(order.chatVendedorStatus || '') === 'expirado' || String(order.chatVendedorStatus || '') === 'escalado';
      chatHtml = `<div class="mt-3 rounded-xl border ${canOpenSeller ? 'border-emerald-200 bg-emerald-50' : 'border-amber-200 bg-amber-50'} p-3"><p class="text-[10px] font-black uppercase tracking-wider ${canOpenSeller ? 'text-emerald-800' : 'text-amber-800'}">Chat com vendedor</p><p class="mt-1 text-xs font-semibold ${canOpenSeller ? 'text-emerald-900' : 'text-amber-900'}">Status: ${escapeHtml(statusChat)} • ${escapeHtml(getChatRemainingLabel(sellerChat))}</p><div class="mt-2 flex flex-wrap gap-2">${canOpenSeller ? `<button type="button" data-open-problem="${escapeHtml(order.id)}" class="rounded-xl bg-emerald-600 px-3 py-2 text-xs font-black text-white hover:bg-emerald-700">Abrir chat</button>` : ''}${canSupport ? `<button type="button" data-open-support-chat="${escapeHtml(order.id)}" class="rounded-xl border border-sky-200 bg-sky-50 px-3 py-2 text-xs font-black text-sky-700 hover:bg-sky-100">Chamar suporte</button>` : ''}</div></div>`;
    } else if (String(order.chatVendedorStatus || '') === 'encerrado' || String(order.chatVendedorStatus || '') === 'expirado' || String(order.chatVendedorStatus || '') === 'escalado') {
      chatHtml = `<div class="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3"><p class="text-[10px] font-black uppercase tracking-wider text-amber-800">Chat com vendedor encerrado</p><p class="mt-1 text-xs font-semibold text-amber-900">Você pode abrir um chat com o suporte.</p><button type="button" data-open-support-chat="${escapeHtml(order.id)}" class="mt-2 rounded-xl border border-sky-200 bg-sky-50 px-3 py-2 text-xs font-black text-sky-700 hover:bg-sky-100">Chamar suporte</button></div>`;
    } else if (order.chatVendedorId) {
      chatHtml = `<div class="mt-3 rounded-xl border border-gray-200 bg-gray-50 p-3"><p class="text-[10px] font-black uppercase tracking-wider text-gray-600">Chat com vendedor</p><p class="mt-1 text-xs font-semibold text-gray-700">Chat encerrado ou indisponível.</p></div>`;
    }

    return `<div class="rounded-2xl border border-gray-100 bg-gray-50 p-4">
      <div class="flex items-start justify-between gap-3">
        <div class="min-w-0">
          <p class="font-black text-sm text-gray-900 truncate">${escapeHtml(order.produtoTitulo || 'Produto')}</p>
          <p class="mt-1 text-xs font-bold text-gray-400">Pedido: ${escapeHtml(order.id)}</p>
          <p class="mt-1 text-xs font-semibold text-gray-500">Vendedor: ${escapeHtml(order.sellerName || order.sellerId || '-')}</p>
          <p class="mt-1 text-xs font-semibold text-gray-500">Data: ${escapeHtml(created)}</p>
        </div>
        <span class="shrink-0 rounded-full px-2.5 py-1 text-[10px] font-black ring-1 ${getOrderStatusClass(status)}">${escapeHtml(status.toUpperCase())}</span>
      </div>
      <div class="mt-3 flex items-center justify-between gap-3">
        <p class="text-base font-black text-emerald-700">${moneyBRL(order.total || order.precoUnitario || 0)}</p>
        <span class="rounded-full bg-gray-100 px-2.5 py-1 text-[10px] font-black text-gray-500">${escapeHtml(order.categoriaNome || order.categoriaId || 'Categoria')}</span>
      </div>
      ${chatHtml}
    </div>`;
  }).join('');

  els.buyerOrdersList.querySelectorAll('[data-save-buyer-info]').forEach((btn) => btn.addEventListener('click', () => updateBuyerOrderInfo(btn.getAttribute('data-save-buyer-info') || '')));
  els.buyerOrdersList.querySelectorAll('[data-open-problem]').forEach((btn) => btn.addEventListener('click', () => openProblemModal(btn.getAttribute('data-open-problem') || '', CHAT_TYPE_SELLER)));
  els.buyerOrdersList.querySelectorAll('[data-open-support-chat]').forEach((btn) => btn.addEventListener('click', () => openProblemModal(btn.getAttribute('data-open-support-chat') || '', CHAT_TYPE_SUPPORT)));
}

async function updateBuyerOrderInfo(orderId) {
  const order = buyerOrders.find((item) => String(item.id) === String(orderId));
  if (!order) return;
  if (String(order.buyerId || '') !== String(ghubProfile?.gameId || '')) { localToast('error', 'Esse pedido não pertence ao seu perfil.'); return; }
  if (isFinalOrderStatus(order.status) || order.finalizado === true) { localToast('error', 'Esse pedido já foi finalizado e não pode ser alterado.'); return; }
  const textValue = String(document.querySelector(`[data-buyer-info-for="${CSS.escape(String(orderId))}"]`)?.value || '').trim();
  if (!textValue) { localToast('error', 'Preencha as informações do pedido.'); document.querySelector(`[data-buyer-info-for="${CSS.escape(String(orderId))}"]`)?.focus(); return; }
  try { await setDoc(doc(lojaDb, 'pedidos', orderId), { buyerInfo: textValue, buyerInfoUpdatedAtMs: Date.now(), updatedAt: serverTimestamp() }, { merge: true }); localToast('success', 'Informações do pedido atualizadas.'); await loadBuyerOrders(); }
  catch (err) { console.error(err); localToast('error', 'Não foi possível atualizar as informações do pedido.'); }
}

async function loadSupportAdminStatus() {
  isSupportAdmin = false;
  if (!currentUser || !ghubProfile?.gameId) {
    renderSupportTop();
    return false;
  }
  try {
    const snap = await getDoc(doc(lojaDb, ADMIN_COLLECTION, ADMIN_DOC_ID));
    const data = snap.exists() ? snap.data() : {};
    const allowed = Array.isArray(data.id) ? data.id : (Array.isArray(data.ids) ? data.ids : []);
    const allowedEmails = Array.isArray(data.email) ? data.email : (Array.isArray(data.emails) ? data.emails : []);
    const gameId = String(ghubProfile.gameId || '');
    const uid = String(currentUser.uid || '');
    const email = normalizeEmail(currentUser.email || ghubProfile.email || '');
    isSupportAdmin = allowed.map(String).includes(gameId) || allowed.map(String).includes(uid) || allowedEmails.map(normalizeEmail).includes(email);
  } catch (err) {
    console.warn('Não foi possível verificar suporte/admin:', err);
    isSupportAdmin = false;
  }
  renderSupportTop();
  return isSupportAdmin;
}

function renderSupportTop() {
  els.supportPanelBtn?.classList.toggle('hidden', !isSupportAdmin);
  initIcons();
}

function openSupportModal() {
  if (!isSupportAdmin) {
    localToast('error', 'Acesso restrito ao suporte.');
    return;
  }
  els.supportModal?.classList.remove('hidden');
  els.supportModal?.classList.add('flex');
  initIcons();
  loadSupportPanelData();
}

function closeSupportModal() {
  els.supportModal?.classList.add('hidden');
  els.supportModal?.classList.remove('flex');
}

async function loadSupportPanelData() {
  if (!isSupportAdmin) return;
  if (els.supportVerificationsList) els.supportVerificationsList.innerHTML = '<div class="rounded-2xl border border-gray-100 bg-gray-50 p-4 text-sm font-semibold text-gray-500 text-center">Carregando verificações...</div>';
  if (els.supportChatsList) els.supportChatsList.innerHTML = '<div class="rounded-2xl border border-gray-100 bg-gray-50 p-4 text-sm font-semibold text-gray-500 text-center">Carregando chats...</div>';
  if (els.supportReportsList) els.supportReportsList.innerHTML = '<div class="rounded-2xl border border-gray-100 bg-gray-50 p-4 text-sm font-semibold text-gray-500 text-center">Carregando denúncias...</div>';
  await Promise.all([loadSupportVerifications(), loadSupportChats(), loadSupportReports()]);
}

async function loadSupportVerifications() {
  try {
    const snap = await getDocs(collection(lojaDb, VERIFICATION_COLLECTION));
    supportVerifications = snap.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a,b) => Number(b.createdAtMs || 0) - Number(a.createdAtMs || 0));
  } catch (err) {
    console.error(err);
    supportVerifications = [];
    localToast('error', 'Não foi possível carregar verificações.');
  }
  renderSupportVerifications();
}

function renderSupportVerifications() {
  if (els.supportVerificationsCounter) els.supportVerificationsCounter.textContent = supportVerifications.length === 1 ? '1 solicitação' : `${supportVerifications.length} solicitações`;
  if (!els.supportVerificationsList) return;
  if (!supportVerifications.length) {
    els.supportVerificationsList.innerHTML = '<div class="rounded-2xl border border-dashed border-gray-200 bg-gray-50 p-4 text-sm font-semibold text-gray-500 text-center">Nenhuma solicitação encontrada.</div>';
    return;
  }
  els.supportVerificationsList.innerHTML = supportVerifications.map((item) => {
    const status = getVerificationStatusLabel(item.status) || 'pendente';
    const canAct = status === 'pendente';
    const front = item.rgFrenteBase64 ? `<button type="button" data-view-image="${escapeHtml(item.rgFrenteBase64)}" class="overflow-hidden rounded-xl border border-gray-200 bg-white text-left"><img src="${escapeHtml(item.rgFrenteBase64)}" alt="RG frente" class="h-28 w-full object-cover"><p class="px-2 py-1 text-center text-[10px] font-black text-gray-600">RG frente</p></button>` : '<div class="rounded-xl border border-dashed border-gray-200 bg-white p-3 text-center text-xs font-bold text-gray-400">Sem RG frente</div>';
    const back = item.rgVersoBase64 ? `<button type="button" data-view-image="${escapeHtml(item.rgVersoBase64)}" class="overflow-hidden rounded-xl border border-gray-200 bg-white text-left"><img src="${escapeHtml(item.rgVersoBase64)}" alt="RG verso" class="h-28 w-full object-cover"><p class="px-2 py-1 text-center text-[10px] font-black text-gray-600">RG verso</p></button>` : '<div class="rounded-xl border border-dashed border-gray-200 bg-white p-3 text-center text-xs font-bold text-gray-400">Sem RG verso</div>';
    return `<div class="rounded-2xl border border-gray-100 bg-gray-50 p-3">
      <div class="flex items-start justify-between gap-3"><div class="min-w-0"><p class="font-black text-sm text-gray-900 truncate">${escapeHtml(item.nomeCompleto || item.nick || 'Solicitação')}</p><p class="mt-1 text-xs font-bold text-gray-400">ID: ${escapeHtml(item.id || item.gameId || '-')}</p><p class="mt-1 text-xs font-semibold text-gray-500 truncate">${escapeHtml(item.email || '')}</p><p class="mt-1 text-xs font-semibold text-gray-500">Nascimento: ${escapeHtml(item.dataNascimento || '-')}</p></div><span class="rounded-full bg-white px-2.5 py-1 text-[10px] font-black text-gray-600 ring-1 ring-gray-200">${escapeHtml(status.toUpperCase())}</span></div>
      <div class="mt-3 grid grid-cols-2 gap-2">${front}${back}</div>
      <div class="mt-3 grid grid-cols-2 gap-2">${canAct ? `<button type="button" data-approve-verification="${escapeHtml(item.id)}" class="rounded-xl bg-emerald-600 px-3 py-2 text-xs font-black text-white hover:bg-emerald-700">Aprovar</button><button type="button" data-reject-verification="${escapeHtml(item.id)}" class="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs font-black text-red-700 hover:bg-red-100">Recusar</button>` : ''}<button type="button" data-delete-verification="${escapeHtml(item.id)}" class="rounded-xl border border-gray-200 bg-white px-3 py-2 text-xs font-black text-gray-600 hover:bg-gray-50">Excluir solicitação</button><button type="button" data-support-chat-seller="${escapeHtml(item.gameId || item.id || '')}" data-support-chat-seller-name="${escapeHtml(item.nick || item.nomeCompleto || '')}" class="rounded-xl border border-sky-200 bg-sky-50 px-3 py-2 text-xs font-black text-sky-700 hover:bg-sky-100">Chat com vendedor</button></div>
    </div>`;
  }).join('');
  els.supportVerificationsList.querySelectorAll('[data-approve-verification]').forEach((btn) => btn.addEventListener('click', () => updateVerificationStatus(btn.getAttribute('data-approve-verification') || '', 'aprovado')));
  els.supportVerificationsList.querySelectorAll('[data-reject-verification]').forEach((btn) => btn.addEventListener('click', () => updateVerificationStatus(btn.getAttribute('data-reject-verification') || '', 'recusado')));
  els.supportVerificationsList.querySelectorAll('[data-delete-verification]').forEach((btn) => btn.addEventListener('click', () => deleteSellerVerification(btn.getAttribute('data-delete-verification') || '')));
  els.supportVerificationsList.querySelectorAll('[data-view-image]').forEach((btn) => btn.addEventListener('click', () => openImageViewer(btn.getAttribute('data-view-image') || '')));
  els.supportVerificationsList.querySelectorAll('[data-support-chat-seller]').forEach((btn) => btn.addEventListener('click', () => createSupportChatWithSeller(btn.getAttribute('data-support-chat-seller') || '', btn.getAttribute('data-support-chat-seller-name') || '', 'verificacao')));
  initIcons();
}

async function deleteSellerVerification(id) {
  if (!id || !isSupportAdmin) return;
  if (!window.confirm("Excluir essa solicitação de vendedor?")) return;
  try {
    await deleteDoc(doc(lojaDb, VERIFICATION_COLLECTION, id));
    localToast("success", "Solicitação excluída.");
    await loadSupportVerifications();
  } catch (err) {
    console.error(err);
    localToast("error", "Não foi possível excluir a solicitação.");
  }
}

async function updateVerificationStatus(id, status) {
  if (!id || !isSupportAdmin) return;
  const patch = { status, updatedAt: serverTimestamp(), analisadoEmMs: Date.now(), analisadoPor: ghubProfile?.gameId || currentUser?.uid || '' };
  if (status === 'recusado') {
    const reason = window.prompt('Motivo da recusa:', 'Dados insuficientes ou imagem inválida.');
    patch.motivoRecusa = reason || 'Verificação recusada.';
  }
  try {
    await setDoc(doc(lojaDb, VERIFICATION_COLLECTION, id), patch, { merge: true });
    localToast('success', status === 'aprovado' ? 'Verificação aprovada.' : 'Verificação recusada.');
    await loadSupportVerifications();
  } catch (err) {
    console.error(err);
    localToast('error', 'Não foi possível atualizar a verificação.');
  }
}

async function loadSupportReports() {
  try {
    const snap = await getDocs(collection(lojaDb, PRODUCT_REPORT_COLLECTION));
    supportReports = snap.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a,b) => Number(b.createdAtMs || 0) - Number(a.createdAtMs || 0));
  } catch (err) {
    console.warn('Não foi possível carregar denúncias:', err);
    supportReports = [];
  }
  renderSupportReports();
}

function renderSupportReports() {
  if (els.supportReportsCounter) els.supportReportsCounter.textContent = supportReports.length === 1 ? '1 denúncia' : `${supportReports.length} denúncias`;
  if (!els.supportReportsList) return;
  if (!supportReports.length) {
    els.supportReportsList.innerHTML = '<div class="rounded-2xl border border-dashed border-gray-200 bg-gray-50 p-4 text-sm font-semibold text-gray-500 text-center">Nenhuma denúncia encontrada.</div>';
    return;
  }
  els.supportReportsList.innerHTML = supportReports.map((report) => `<div class="rounded-2xl border border-amber-100 bg-amber-50 p-3">
    <div class="flex items-start gap-3"><div class="h-14 w-14 shrink-0 overflow-hidden rounded-xl bg-white ring-1 ring-amber-200 flex items-center justify-center">${report.produtoImagem ? `<img src="${escapeHtml(report.produtoImagem)}" class="h-full w-full object-cover" alt="">` : '<i data-lucide="package" class="w-5 h-5 text-amber-400"></i>'}</div><div class="min-w-0 flex-1"><p class="font-black text-sm text-gray-900 truncate">${escapeHtml(report.produtoTitulo || report.productId || 'Produto denunciado')}</p><p class="mt-1 text-xs font-bold text-amber-800">Motivo: ${escapeHtml(report.motivo || '-')}</p><p class="mt-1 text-xs font-semibold text-gray-600">Vendedor: ${escapeHtml(report.sellerName || report.sellerId || '-')}</p><p class="mt-1 text-xs font-semibold text-gray-500">Denunciante: ${escapeHtml(report.reporterName || report.reporterId || '-')}</p></div></div>
    <div class="mt-3 grid grid-cols-2 sm:grid-cols-4 gap-2"><button type="button" data-delete-report="${escapeHtml(report.id)}" class="rounded-xl border border-gray-200 bg-white px-3 py-2 text-xs font-black text-gray-600 hover:bg-gray-50">Excluir denúncia</button><button type="button" data-delete-reported-product="${escapeHtml(report.productId || report.produtoId || '')}" data-report-id="${escapeHtml(report.id)}" class="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs font-black text-red-700 hover:bg-red-100">Excluir produto</button><button type="button" data-inactivate-seller="${escapeHtml(report.sellerId || '')}" class="rounded-xl border border-orange-200 bg-orange-50 px-3 py-2 text-xs font-black text-orange-700 hover:bg-orange-100">Inativar vendedor</button><button type="button" data-support-chat-seller="${escapeHtml(report.sellerId || '')}" data-support-chat-seller-name="${escapeHtml(report.sellerName || '')}" class="rounded-xl border border-sky-200 bg-sky-50 px-3 py-2 text-xs font-black text-sky-700 hover:bg-sky-100">Chat com vendedor</button></div>
  </div>`).join('');
  els.supportReportsList.querySelectorAll('[data-delete-report]').forEach((btn) => btn.addEventListener('click', () => deleteProductReport(btn.getAttribute('data-delete-report') || '')));
  els.supportReportsList.querySelectorAll('[data-delete-reported-product]').forEach((btn) => btn.addEventListener('click', () => deleteReportedProduct(btn.getAttribute('data-delete-reported-product') || '', btn.getAttribute('data-report-id') || '')));
  els.supportReportsList.querySelectorAll('[data-inactivate-seller]').forEach((btn) => btn.addEventListener('click', () => inactivateSellerAndDeleteProducts(btn.getAttribute('data-inactivate-seller') || '')));
  els.supportReportsList.querySelectorAll('[data-support-chat-seller]').forEach((btn) => btn.addEventListener('click', () => createSupportChatWithSeller(btn.getAttribute('data-support-chat-seller') || '', btn.getAttribute('data-support-chat-seller-name') || '', 'denuncia')));
  initIcons();
}

async function deleteProductReport(reportId) {
  if (!reportId || !isSupportAdmin) return;
  if (!window.confirm('Excluir essa denúncia?')) return;
  try {
    await deleteDoc(doc(lojaDb, PRODUCT_REPORT_COLLECTION, reportId));
    localToast('success', 'Denúncia excluída.');
    await loadSupportReports();
  } catch (err) { console.error(err); localToast('error', 'Não foi possível excluir a denúncia.'); }
}

async function deleteReportedProduct(productId, reportId = '') {
  if (!productId || !isSupportAdmin) return;
  if (!window.confirm('Excluir esse produto denunciado?')) return;
  try {
    await deleteDoc(doc(lojaDb, 'produtos', productId));
    if (reportId) await deleteDoc(doc(lojaDb, PRODUCT_REPORT_COLLECTION, reportId));
    localToast('success', 'Produto excluído.');
    await Promise.all([loadProducts(), loadSupportReports()]);
  } catch (err) { console.error(err); localToast('error', 'Não foi possível excluir o produto.'); }
}

async function inactivateSellerAndDeleteProducts(sellerId) {
  const cleanSellerId = String(sellerId || '').trim();
  if (!cleanSellerId || !isSupportAdmin) return;
  if (!window.confirm('Inativar esse vendedor e excluir todos os anúncios dele?')) return;
  try {
    await setDoc(doc(lojaDb, 'vendedor', cleanSellerId), { ativo: false, status: 'inativo', inativadoEmMs: Date.now(), inativadoPor: ghubProfile?.gameId || currentUser?.uid || '', updatedAt: serverTimestamp() }, { merge: true });
    const snap = await getDocs(query(collection(lojaDb, 'produtos'), where('sellerId', '==', cleanSellerId)));
    await Promise.all(snap.docs.map((d) => deleteDoc(doc(lojaDb, 'produtos', d.id))));
    localToast('success', 'Vendedor inativado e anúncios excluídos.');
    await Promise.all([loadProducts(), loadSupportReports(), loadSupportPanelData()]);
  } catch (err) { console.error(err); localToast('error', 'Não foi possível inativar o vendedor.'); }
}

async function createSupportChatWithSeller(sellerId, sellerName = '', source = 'suporte') {
  const cleanSellerId = String(sellerId || '').trim();
  if (!cleanSellerId || !isSupportAdmin) return;
  try {
    const id = `suporte_vendedor_${cleanSellerId}`;
    const ref = doc(lojaDb, CHAT_COLLECTION, id);
    const snap = await getDoc(ref);
    const now = Date.now();
    const expiresAtMs = now + (SUPPORT_CHAT_HOURS * 60 * 60 * 1000);
    if (!snap.exists() || isChatExpired({ id: snap.id, ...snap.data() }) || isChatClosed({ id: snap.id, ...snap.data() })) {
      await setDoc(ref, {
        id,
        tipo: CHAT_TYPE_SUPPORT,
        status: 'ativo',
        sellerId: cleanSellerId,
        sellerName: sellerName || cleanSellerId,
        buyerId: '',
        buyerName: '',
        assunto: source === 'denuncia' ? 'Contato sobre denúncia de produto' : 'Contato do suporte',
        mensagens: [{ autorId: 'sistema', autorTipo: 'sistema', autorNome: 'GuildaHub', texto: 'O suporte abriu este chat. Responda com clareza e envie todas as informações solicitadas.', createdAtMs: now }],
        createdAt: serverTimestamp(),
        createdAtMs: now,
        expiresAt: new Date(expiresAtMs),
        expiresAtMs,
        updatedAt: serverTimestamp()
      }, { merge: true });
    }
    const latest = await getDoc(ref);
    const chat = latest.exists() ? { id: latest.id, ...latest.data() } : { id, tipo: CHAT_TYPE_SUPPORT, sellerId: cleanSellerId, sellerName };
    localToast('success', 'Chat com vendedor aberto.');
    openChatById(chat.id, chat);
    await loadSupportChats();
  } catch (err) { console.error(err); localToast('error', 'Não foi possível abrir chat com vendedor.'); }
}

async function loadSupportChats() {
  try {
    const snap = await getDocs(query(collection(lojaDb, CHAT_COLLECTION), where('tipo', '==', CHAT_TYPE_SUPPORT)));
    supportChats = snap.docs.map(normalizeChatDoc).sort((a,b) => Number(b.lastMessageAtMs || b.createdAtMs || 0) - Number(a.lastMessageAtMs || a.createdAtMs || 0));
    await markExpiredChatsIfNeeded(supportChats);
  } catch (err) {
    console.error(err);
    supportChats = [];
    localToast('error', 'Não foi possível carregar chats de suporte.');
  }
  renderSupportChats();
}

function renderSupportChats() {
  if (els.supportChatsCounter) els.supportChatsCounter.textContent = supportChats.length === 1 ? '1 chat' : `${supportChats.length} chats`;
  if (!els.supportChatsList) return;
  const activeChats = supportChats.filter((chat) => !isChatExpired(chat) && !isChatClosed(chat));
  if (!activeChats.length) {
    els.supportChatsList.innerHTML = '<div class="rounded-2xl border border-dashed border-gray-200 bg-gray-50 p-4 text-sm font-semibold text-gray-500 text-center">Nenhum chat de suporte ativo.</div>';
    return;
  }
  els.supportChatsList.innerHTML = activeChats.map((chat) => `<div class="rounded-2xl border border-sky-100 bg-sky-50 p-3"><div class="flex items-start justify-between gap-3"><div class="min-w-0"><p class="font-black text-sm text-gray-900 truncate">${escapeHtml(chat.produtoTitulo || 'Pedido')}</p><p class="mt-1 text-xs font-bold text-sky-700">Pedido: ${escapeHtml(chat.orderId || chat.pedidoId || '-')}</p><p class="mt-1 text-xs font-semibold text-gray-600">Comprador: ${escapeHtml(chat.buyerName || chat.buyerId || '-')}</p><p class="mt-1 text-xs font-semibold text-gray-600">Vendedor: ${escapeHtml(chat.sellerName || chat.sellerId || '-')}</p><p class="mt-1 text-xs font-semibold text-gray-600">${escapeHtml(getChatRemainingLabel(chat))}</p></div><span class="rounded-full bg-white px-2.5 py-1 text-[10px] font-black text-sky-700 ring-1 ring-sky-200">SUPORTE</span></div><button type="button" data-open-support-panel-chat="${escapeHtml(chat.id)}" class="mt-3 w-full rounded-xl bg-sky-600 px-3 py-2 text-xs font-black text-white hover:bg-sky-700">Abrir chat</button></div>`).join('');
  els.supportChatsList.querySelectorAll('[data-open-support-panel-chat]').forEach((btn) => btn.addEventListener('click', () => openSupportChatFromPanel(btn.getAttribute('data-open-support-panel-chat') || '')));
  initIcons();
}

async function openChatById(chatId, cachedChat = null) {
  if (!chatId) return;
  try {
    let chat = cachedChat;
    if (!chat) {
      const snap = await getDoc(doc(lojaDb, CHAT_COLLECTION, chatId));
      if (!snap.exists()) { localToast('error', 'Chat não encontrado.'); return; }
      chat = { id: snap.id, ...snap.data() };
    }
    const order = {
      id: chat.orderId || chat.pedidoId || chat.id || '',
      ...(chat.orderSnapshot || {}),
      buyerId: chat.buyerId || '',
      buyerName: chat.buyerName || '',
      sellerId: chat.sellerId || '',
      sellerName: chat.sellerName || '',
      produtoId: chat.produtoId || '',
      produtoTitulo: chat.produtoTitulo || chat.assunto || 'Chat com suporte',
      categoriaId: chat.categoriaId || '',
      categoriaNome: chat.categoriaNome || '',
      total: Number(chat.total || 0),
      suporteStatus: chat.status || 'ativo'
    };
    openChatModalWithChat(order, chat);
  } catch (err) { console.error(err); localToast('error', 'Não foi possível abrir o chat.'); }
}

function openSupportChatFromPanel(chatId) {
  const chat = supportChats.find((item) => String(item.id) === String(chatId));
  if (!chat) return;
  openChatById(chatId, chat);
}

function openImageViewer(src) {
  if (!src || !els.imageViewerModal || !els.imageViewerImg) return;
  els.imageViewerImg.src = src;
  els.imageViewerModal.classList.remove("hidden");
  els.imageViewerModal.classList.add("flex");
}

function closeImageViewer() {
  if (els.imageViewerImg) els.imageViewerImg.src = "";
  els.imageViewerModal?.classList.add("hidden");
  els.imageViewerModal?.classList.remove("flex");
}

function bindEvents() {
  qs('btn-logout')?.addEventListener('click', logout);
  setupSidebar();

  els.search?.addEventListener('input', applyFilters);
  els.category?.addEventListener('change', applyFilters);

  els.clearFiltersBtn?.addEventListener('click', () => {
    if (els.search) els.search.value = '';
    if (els.category) els.category.value = '';
    applyFilters();
  });

  els.buyerProfileBtn?.addEventListener('click', openBuyerModal);
  els.supportPanelBtn?.addEventListener('click', openSupportModal);
  els.reloadSupportPanelBtn?.addEventListener('click', loadSupportPanelData);
  els.toggleSellerFormBtn?.addEventListener('click', () => {
    const willOpen = els.sellerForm?.classList.contains('hidden');
    setMobileCollapsibleState(els.sellerForm, els.toggleSellerFormBtn, willOpen, 'Fechar cadastro de produto', 'Abrir/editar cadastro de produto');
  });
  els.toggleSellerProductsBtn?.addEventListener('click', () => {
    const willOpen = els.sellerProductsCard?.classList.contains('hidden');
    setMobileCollapsibleState(els.sellerProductsCard, els.toggleSellerProductsBtn, willOpen, 'Fechar meus produtos', 'Abrir/editar meus produtos');
  });
  els.topSellerBtn?.addEventListener('click', handleTopSellerClick);
  els.sellerProfileBtn?.addEventListener('click', openSellerPanel);
  els.sellerForm?.addEventListener('submit', handleSellerProductSubmit);
  els.cancelProductEditBtn?.addEventListener('click', resetSellerProductForm);
  els.sellerProductFile?.addEventListener('change', async (event) => {
    const file = event.target.files?.[0];
    if (!file) {
      selectedProductImageBase64 = '';
      setProductPhotoStatus();
      return;
    }

    try {
      setProductPhotoStatus('Comprimindo imagem...');
      selectedProductImageBase64 = await compressImageToBase64(file, 950 * 1024);
      const kb = Math.max(1, Math.round(dataUrlSizeBytes(selectedProductImageBase64) / 1024));
      setProductPhotoStatus(`Imagem pronta em base64 (${kb} KB).`);
    } catch (err) {
      console.error(err);
      selectedProductImageBase64 = '';
      if (els.sellerProductFile) els.sellerProductFile.value = '';
      setProductPhotoStatus();
      localToast('error', err?.message || 'Não foi possível processar a imagem.');
    }
  });
  els.reloadSellerDataBtn?.addEventListener('click', reloadSellerPanelData);
  els.verificationForm?.addEventListener('submit', submitSellerVerification);
  els.verificationRgFront?.addEventListener('change', (event) => handleVerificationFileChange('front', event.target.files?.[0] || null));
  els.verificationRgBack?.addEventListener('change', (event) => handleVerificationFileChange('back', event.target.files?.[0] || null));
  els.problemForm?.addEventListener('submit', submitProblem);
  els.resolveChatBtn?.addEventListener('click', resolveActiveChat);
  els.escalateChatBtn?.addEventListener('click', escalateActiveChatToSupport);

  document.querySelectorAll('[data-close-product-modal]').forEach((btn) => {
    btn.addEventListener('click', closeProductModal);
  });

  document.querySelectorAll('[data-close-seller-modal]').forEach((btn) => {
    btn.addEventListener('click', closeSellerModal);
  });

  document.querySelectorAll('[data-close-buyer-modal]').forEach((btn) => {
    btn.addEventListener('click', closeBuyerModal);
  });

  document.querySelectorAll('[data-close-verification-modal]').forEach((btn) => {
    btn.addEventListener('click', closeVerificationModal);
  });

  document.querySelectorAll('[data-close-problem-modal]').forEach((btn) => {
    btn.addEventListener('click', closeProblemModal);
  });

  document.querySelectorAll('[data-close-support-modal]').forEach((btn) => {
    btn.addEventListener('click', closeSupportModal);
  });

  document.querySelectorAll('[data-close-image-viewer]').forEach((btn) => {
    btn.addEventListener('click', closeImageViewer);
  });

  els.imageViewerModal?.addEventListener('click', (event) => {
    if (event.target === els.imageViewerModal) closeImageViewer();
  });

  window.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    closeProductModal();
    closeSellerModal();
    closeBuyerModal();
    closeVerificationModal();
    closeProblemModal();
    closeSupportModal();
    closeImageViewer();
  });
}

async function handleAuthState(user) {
  currentUser = user || null;
  ghubProfile = null;
  lojaStatus = { comprador: null, vendedor: null };
  sellerProducts = [];
  sellerOrders = [];
  buyerOrders = [];
  supportChats = [];
  supportVerifications = [];
  isSupportAdmin = false;

  if (!currentUser) {
    applySidebarUser(null);
    renderSellerTop();
    renderSupportTop();
    return;
  }

  try {
    ghubProfile = await findGuildaHubProfile(currentUser);
    applySidebarUser(ghubProfile);
    renderSellerTop();
    await loadStoreStatus();
    await loadSupportAdminStatus();
    await loadBuyerOrders();
  } catch (err) {
    console.error(err);
    applySidebarUser(null);
    renderSellerTop();
    renderSupportTop();
    localToast('error', 'Não foi possível carregar seu perfil da GuildaHub.');
  }
}

(async function boot() {
  bindEvents();
  initIcons();
  renderSellerTop();
  renderSupportTop();

  await loadCategories();
  await loadProducts();

  onAuthStateChanged(auth, handleAuthState);
})();
