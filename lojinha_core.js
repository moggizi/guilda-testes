// lojinha_core.js — núcleo compartilhado da Lojinha

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
  deleteField,
  limit,
  orderBy,
  startAfter,
  documentId
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { setupSidebar, initIcons, logout, showToast, auth, db } from './logic.js';
import { lojaCacheGet, lojaCacheSet, lojaCacheRemove, LOJA_CACHE_TTL } from './caches_lojinha.js';

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
const WITHDRAW_COLLECTION = 'saques';

const els = {
  topSellerBtn: qs('btn-top-seller'),
  topSellerAvatarWrap: qs('seller-top-avatar-wrap'),
  topSellerAvatar: qs('seller-top-avatar'),
  topSellerAvatarIcon: qs('seller-top-avatar-icon'),
  sellerProfileBtn: qs('btn-seller-profile'),
  buyerProfileBtn: qs('btn-buyer-profile'),
  supportPanelBtn: qs('btn-support-panel'),
  lojaMenuBtn: qs('btn-loja-menu'),
  lojaMenuDrawer: qs('loja-menu-drawer'),
  lojaMenuOverlay: qs('loja-menu-overlay'),
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
  productPagination: qs('products-pagination'),

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
  sellerSupportChatsCounter: qs('seller-support-chats-counter'),
  sellerSupportChatsList: qs('seller-support-chats-list'),

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
  supportWithdrawalsCounter: qs('support-withdrawals-counter'),
  supportWithdrawalsList: qs('support-withdrawals-list'),
  supportRefundsCounter: qs('support-refunds-counter'),
  supportRefundsList: qs('support-refunds-list'),
  supportSellersTotal: qs('support-sellers-total'),
  supportSellerSearch: qs('support-seller-search'),
  supportSellerSearchBtn: qs('btn-support-search-seller'),
  supportSellerResults: qs('support-seller-results'),
  supportProductSearch: qs('support-product-search'),
  supportProductSearchBtn: qs('btn-support-search-product'),
  supportProductResults: qs('support-product-results'),
  supportOrderSearch: qs('support-order-search'),
  supportOrderSearchBtn: qs('btn-support-search-order'),
  supportOrderResults: qs('support-order-results'),
  floatingSupportBtn: qs('btn-floating-support-chat'),
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
let sellerStatsById = new Map();
let sellerProducts = [];
let sellerOrders = [];
let buyerOrders = [];
let buyerProblems = [];
let sellerChats = [];
let supportChats = [];
let supportVerifications = [];
let supportReports = [];
let supportWithdrawals = [];
let supportRefundRequests = [];
let supportSellerTotal = 0;
let supportSellerResults = [];
let supportProductResults = [];
let supportOrderResults = [];
let buyerRatings = [];
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
let activeDraftChat = null;
let activePaymentPoll = null;
let lojaPageMode = 'store';

const PRODUCTS_FETCH_LIMIT = 120;
const PRODUCTS_PAGE_SIZE = 20;
let productsPage = 1;

const ORDERS_PAGE_SIZE = 10;
let buyerOrdersPage = 1;
let buyerOrdersHasNextPage = false;
let buyerOrderPageCursors = [null];
let buyerOrdersLoading = false;
let sellerOrdersPage = 1;
let sellerOrdersHasNextPage = false;
let sellerOrderPageCursors = [null];
let sellerOrdersLoading = false;

const NOTIFICATION_BADGE_CLASS = 'ghub-notification-badge';

function getSeenStorageKey() {
  const gid = String(ghubProfile?.gameId || currentUser?.uid || 'visitante').trim() || 'visitante';
  return `ghub_loja_seen_${gid}`;
}

function getSeenState() {
  try {
    const raw = localStorage.getItem(getSeenStorageKey());
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch (_) {
    return {};
  }
}

function saveSeenState(state) {
  try {
    localStorage.setItem(getSeenStorageKey(), JSON.stringify(state || {}));
  } catch (_) {}
}

function getCurrentUserCacheKey() {
  return String(currentUser?.uid || currentUser?.email || ghubProfile?.gameId || 'global').trim() || 'global';
}


function getProductFavoriteStorageKey() {
  return `ghub_loja_favoritos_${getCurrentUserCacheKey()}`;
}

function getFavoriteProductIds() {
  try {
    const parsed = JSON.parse(localStorage.getItem(getProductFavoriteStorageKey()) || '[]');
    return new Set(Array.isArray(parsed) ? parsed.map((id) => String(id)) : []);
  } catch (_) {
    return new Set();
  }
}

function saveFavoriteProductIds(ids) {
  try {
    localStorage.setItem(getProductFavoriteStorageKey(), JSON.stringify(Array.from(ids).map((id) => String(id))));
  } catch (_) {}
}

function isFavoriteProduct(productId) {
  return getFavoriteProductIds().has(String(productId || ''));
}

function toggleFavoriteProduct(productId) {
  const cleanId = String(productId || '').trim();
  if (!cleanId) return;
  const ids = getFavoriteProductIds();
  if (ids.has(cleanId)) ids.delete(cleanId);
  else ids.add(cleanId);
  saveFavoriteProductIds(ids);
  applyFilters();
}

function getProductActivityMs(product = {}) {
  return Math.max(Number(product.updatedAtMs || 0), Number(product.createdAtMs || 0), timestampToMs(product.updatedAt), timestampToMs(product.createdAt));
}

function getProductSellerSales(product = {}) {
  const sellerId = String(product.sellerId || '').trim();
  const sellerStats = sellerId ? sellerStatsById.get(sellerId) : null;
  return Math.max(
    Number(product.sellerTotalVendas || 0),
    Number(product.sellerVendas || 0),
    Number(sellerStats?.totalVendasEntregues || sellerStats?.totalVendas || 0),
    Number(product.totalVendasEntregues || product.totalVendas || 0)
  );
}

function getProductRankScore(product = {}) {
  const savedRank = Number(product.rankScore);
  if (Number.isFinite(savedRank) && savedRank > 0) return savedRank;

  const activityMs = getProductActivityMs(product);
  const ageDays = activityMs ? Math.max(0, (Date.now() - activityMs) / 86400000) : 999;
  const recentScore = Math.max(0, 90 - ageDays);
  const sellerSalesScore = Math.log10(getProductSellerSales(product) + 1) * 35;
  const productSalesScore = Math.log10(Number(product.totalVendas || product.totalVendasEntregues || 0) + 1) * 12;
  const highlightScore = product.destaque ? 25 : 0;
  return recentScore + sellerSalesScore + productSalesScore + highlightScore;
}

function getSellerSalesFromData(sellerData = {}) {
  const f = sellerData?.financeiro || {};
  return Number(
    sellerData?.totalVendasEntregues ??
    sellerData?.totalVendas ??
    f?.totalVendasEntregues ??
    0
  ) || 0;
}

function buildProductRankFields(product = {}, { sellerSalesOverride = null, productSalesOverride = null, nowMs = Date.now() } = {}) {
  const productSales = Number(productSalesOverride ?? product.totalVendasEntregues ?? product.totalVendas ?? 0) || 0;
  const sellerSales = Number(
    sellerSalesOverride ??
    product.sellerTotalVendas ??
    product.vendedorTotalVendas ??
    getProductSellerSales(product) ??
    0
  ) || 0;

  const activityMs = Number(product.updatedAtMs || product.createdAtMs || 0)
    || timestampToMs(product.updatedAt)
    || timestampToMs(product.createdAt)
    || nowMs;

  // Score salvo no Firestore para permitir orderBy('rankScore', 'desc').
  // Peso: destaque > vendedor confiável > vendas do produto > recência.
  const activePenalty = product.ativo === false ? -100000 : 0;
  const stockPenalty = product.estoqueAtivo !== false && Number(product.estoqueQuantidade ?? 1) <= 0 ? -25000 : 0;
  const highlightScore = product.destaque ? 50000 : 0;
  const sellerSalesScore = Math.log10(sellerSales + 1) * 9000;
  const productSalesScore = Math.log10(productSales + 1) * 4500;
  const recencyScore = activityMs / 10000000; // ~8,64 pontos por dia.
  const rankScore = Math.round((highlightScore + sellerSalesScore + productSalesScore + recencyScore + activePenalty + stockPenalty) * 100) / 100;

  return {
    rankScore,
    rankScoreUpdatedAtMs: nowMs,
    sellerTotalVendas: sellerSales,
    totalVendas: productSales,
    totalVendasEntregues: productSales,
  };
}

async function refreshSellerProductsRankScores(sellerId, sellerSales) {
  const cleanSellerId = String(sellerId || '').trim();
  if (!cleanSellerId) return;

  try {
    const snap = await getDocs(query(collection(lojaDb, 'produtos'), where('sellerId', '==', cleanSellerId), limit(100)));
    const nowMs = Date.now();

    await Promise.all(snap.docs.map((d) => {
      const data = { id: d.id, ...d.data() };
      const rankFields = buildProductRankFields(data, { sellerSalesOverride: sellerSales, nowMs });
      return setDoc(doc(lojaDb, 'produtos', d.id), {
        ...rankFields,
        updatedAtMs: Number(data.updatedAtMs || 0) || timestampToMs(data.updatedAt) || nowMs,
      }, { merge: true });
    }));

    lojaCacheRemove('products', 'global');
    lojaCacheRemove('sellerProducts', cleanSellerId);
  } catch (err) {
    console.warn('Não foi possível atualizar rankScore dos produtos do vendedor:', err?.code || err?.message || err);
  }
}

function sortProductsForVitrine(list = []) {
  const favorites = getFavoriteProductIds();
  return [...list].sort((a, b) => {
    const favDiff = Number(favorites.has(String(b.id))) - Number(favorites.has(String(a.id)));
    if (favDiff) return favDiff;
    const scoreDiff = getProductRankScore(b) - getProductRankScore(a);
    if (Math.abs(scoreDiff) > 0.0001) return scoreDiff;
    return String(a.titulo || '').localeCompare(String(b.titulo || ''));
  });
}

function replaceProductInState(product) {
  if (!product?.id) return;
  const index = products.findIndex((item) => String(item.id) === String(product.id));
  if (product.ativo === false) {
    if (index >= 0) products.splice(index, 1);
  } else if (index >= 0) products[index] = product;
  else products.push(product);
  products = sortProductsForVitrine(products.filter((item) => item.ativo !== false));
  lojaCacheRemove('products', 'global');
}

async function refreshProductFromFirestore(productId) {
  const cleanId = String(productId || '').trim();
  if (!cleanId) throw new Error('product-not-found');
  const snap = await getDoc(doc(lojaDb, 'produtos', cleanId));
  if (!snap.exists()) throw new Error('product-not-found');
  const product = normalizeProduct(snap);
  replaceProductInState(product);
  return product;
}

function resetBuyerOrdersPagination() {
  buyerOrdersPage = 1;
  buyerOrdersHasNextPage = false;
  buyerOrderPageCursors = [null];
}

function resetSellerOrdersPagination() {
  sellerOrdersPage = 1;
  sellerOrdersHasNextPage = false;
  sellerOrderPageCursors = [null];
}

function getItemActivityMs(item = {}) {
  return Math.max(
    Number(item.updatedAtMs || 0),
    Number(item.createdAtMs || 0),
    Number(item.reembolsoSolicitadoEmMs || 0),
    Number(item.reembolsoFinalizadoEmMs || 0),
    Number(item.reembolsadoEmMs || 0),
    Number(item.entregueEmMs || 0),
    Number(item.entrega?.entregueEmMs || 0),
    Number(item.buyerInfoUpdatedAtMs || 0),
    Number(item.deliveryInfoUpdatedAtMs || 0),
    timestampToMs(item.updatedAt),
    timestampToMs(item.createdAt),
    timestampToMs(item.reembolsoSolicitadoEm),
    timestampToMs(item.reembolsadoEm),
    timestampToMs(item.entrega?.entregueEm)
  );
}

function getChatActivityMs(chat = {}) {
  const messages = Array.isArray(chat.mensagens) ? chat.mensagens : [];
  const lastMessageMs = messages.reduce((max, msg) => Math.max(max, Number(msg?.createdAtMs || 0) || timestampToMs(msg?.createdAt)), 0);
  return Math.max(
    Number(chat.lastMessageAtMs || 0),
    Number(chat.updatedAtMs || 0),
    Number(chat.createdAtMs || 0),
    lastMessageMs,
    timestampToMs(chat.updatedAt),
    timestampToMs(chat.createdAt)
  );
}

function getLastChatMessage(chat = {}) {
  const messages = Array.isArray(chat.mensagens) ? chat.mensagens : [];
  if (!messages.length) return null;
  return [...messages].sort((a, b) => (Number(a?.createdAtMs || 0) || timestampToMs(a?.createdAt)) - (Number(b?.createdAtMs || 0) || timestampToMs(b?.createdAt))).at(-1) || null;
}

function isMessageFromCurrentUser(message = {}) {
  const gid = String(ghubProfile?.gameId || '').trim();
  const uid = String(currentUser?.uid || '').trim();
  const email = normalizeEmail(currentUser?.email || ghubProfile?.email || '');
  const authorId = String(message.autorId || message.authorId || '').trim();
  const authorUid = String(message.autorUid || message.authorUid || '').trim();
  const authorEmail = normalizeEmail(message.autorEmail || message.authorEmail || '');
  return (!!gid && authorId === gid) || (!!uid && authorUid === uid) || (!!email && authorEmail === email);
}

function isChatUnreadForCurrentUser(chat = {}) {
  if (!chat || chat.__draft || isChatExpired(chat) || isChatClosed(chat)) return false;
  const chatId = String(chat.id || getChatId(chat.orderId || chat.pedidoId || '', chat.tipo || CHAT_TYPE_SELLER));
  if (!chatId) return false;
  const activityMs = getChatActivityMs(chat);
  if (!activityMs) return false;
  const lastMessage = getLastChatMessage(chat);
  if (lastMessage && isMessageFromCurrentUser(lastMessage)) return false;
  const seen = getSeenState();
  const lastSeen = Number(seen.chats?.[chatId] || 0);
  return activityMs > lastSeen;
}

function hasUnseenItem(namespace, item = {}, activityGetter = getItemActivityMs) {
  const id = String(item.id || item.orderId || item.pedidoId || '').trim();
  if (!id) return false;
  const activityMs = activityGetter(item);
  if (!activityMs) return false;
  const seen = getSeenState();
  return activityMs > Number(seen?.[namespace]?.[id] || 0);
}

function markSeenItems(namespace, items = [], activityGetter = getItemActivityMs) {
  if (!currentUser || !ghubProfile?.gameId) return;
  const state = getSeenState();
  state[namespace] = state[namespace] && typeof state[namespace] === 'object' ? state[namespace] : {};
  items.forEach((item) => {
    const id = String(item?.id || item?.orderId || item?.pedidoId || '').trim();
    if (!id) return;
    state[namespace][id] = Math.max(Number(state[namespace][id] || 0), activityGetter(item), Date.now());
  });
  saveSeenState(state);
}

function markChatSeen(chat = {}) {
  if (!chat || chat.__draft) return;
  markSeenItems('chats', [chat], getChatActivityMs);
  updateNotificationBadges();
}

function isModalOpen(modal) {
  return !!modal && !modal.classList.contains('hidden');
}

function isInlineLojaPage(type = '') {
  const page = String(lojaPageMode || document.body?.dataset?.lojaPage || 'store');
  if (type) return page === String(type);
  return page === 'compras' || page === 'painel_vendedor' || page === 'suporte';
}

function mountLojaPanelInline(modal, type = '') {
  if (!modal || !isInlineLojaPage(type)) return false;
  const target = qs('loja-page-placeholder');
  if (!target) return false;

  if (modal.parentElement !== target) target.appendChild(modal);

  modal.className = 'mt-5 block w-full';
  modal.classList.remove('hidden', 'flex');

  modal.querySelectorAll(':scope > .absolute, :scope > [class*="backdrop-blur"]').forEach((el) => {
    el.classList.add('hidden');
  });

  const panel = modal.querySelector(':scope > .relative') || modal.firstElementChild;
  if (panel) {
    panel.className = 'w-full overflow-visible bg-transparent shadow-none border-0 rounded-none';
  }

  modal.querySelectorAll('[data-close-buyer-modal], [data-close-seller-modal], [data-close-support-modal], [data-close-verification-modal]').forEach((btn) => {
    btn.classList.add('hidden');
  });

  return true;
}

function isBuyerModalOpen() { return isInlineLojaPage('compras') || isModalOpen(els.buyerModal); }
function isSellerModalOpen() { return isInlineLojaPage('painel_vendedor') || isModalOpen(els.sellerModal); }
function isSupportModalOpen() { return isInlineLojaPage('suporte') || isModalOpen(els.supportModal); }

function ensureNotificationBadge(target) {
  if (!target) return null;
  if (!target.classList.contains('fixed') && !target.classList.contains('absolute') && !target.classList.contains('sticky')) target.classList.add('relative');
  let badge = target.querySelector(`.${NOTIFICATION_BADGE_CLASS}`);
  if (!badge) {
    badge = document.createElement('span');
    badge.className = `${NOTIFICATION_BADGE_CLASS} absolute -right-1 -top-1 hidden min-w-[18px] rounded-full bg-red-600 px-1.5 py-0.5 text-center text-[10px] font-black leading-none text-white ring-2 ring-white`;
    target.appendChild(badge);
  }
  return badge;
}

function setNotificationBadge(target, count) {
  const badge = ensureNotificationBadge(target);
  if (!badge) return;
  const value = Math.max(0, Number(count || 0));
  badge.textContent = value > 9 ? '9+' : String(value);
  badge.classList.toggle('hidden', value <= 0);
}

function markBuyerOrdersSeenIfOpen() {
  if (!isBuyerModalOpen()) return;
  markSeenItems('buyerOrders', buyerOrders, getItemActivityMs);
}

function markSellerOrdersSeenIfOpen() {
  if (!isSellerModalOpen()) return;
  markSeenItems('sellerOrders', sellerOrders, getItemActivityMs);
}

function markSupportQueuesSeenIfOpen() {
  if (!isSupportModalOpen()) return;
  markSeenItems('supportRefundRequests', supportRefundRequests, getItemActivityMs);
  markSeenItems('supportReports', supportReports, getItemActivityMs);
  markSeenItems('supportWithdrawals', supportWithdrawals, getItemActivityMs);
  markSeenItems('supportVerifications', supportVerifications, getItemActivityMs);
}

function getRelevantSupportChatsForCurrentUser() {
  const gid = String(ghubProfile?.gameId || '').trim();
  if (!gid) return [];
  const map = new Map();
  [...buyerProblems, ...sellerChats].forEach((chat) => {
    if (String(chat?.tipo || '') !== CHAT_TYPE_SUPPORT) return;
    if (String(chat.buyerId || '') !== gid && String(chat.sellerId || '') !== gid) return;
    map.set(String(chat.id || getChatId(chat.orderId || chat.pedidoId || '', CHAT_TYPE_SUPPORT)), chat);
  });
  return Array.from(map.values());
}

function updateNotificationBadges() {
  if (!currentUser || !ghubProfile?.gameId) {
    setNotificationBadge(els.buyerProfileBtn, 0);
    setNotificationBadge(els.topSellerBtn, 0);
    setNotificationBadge(els.sellerProfileBtn, 0);
    setNotificationBadge(els.supportPanelBtn, 0);
    setNotificationBadge(els.floatingSupportBtn, 0);
    return;
  }

  const buyerOrderNewCount = buyerOrders.filter((order) => hasUnseenItem('buyerOrders', order, getItemActivityMs)).length;
  const buyerChatUnreadCount = buyerProblems.filter(isChatUnreadForCurrentUser).length;
  setNotificationBadge(els.buyerProfileBtn, buyerOrderNewCount + buyerChatUnreadCount);

  const sellerOrderNewCount = lojaStatus?.vendedor ? sellerOrders.filter((order) => hasUnseenItem('sellerOrders', order, getItemActivityMs)).length : 0;
  const sellerChatUnreadCount = lojaStatus?.vendedor ? sellerChats.filter(isChatUnreadForCurrentUser).length : 0;
  const sellerTotal = sellerOrderNewCount + sellerChatUnreadCount;
  setNotificationBadge(els.topSellerBtn, sellerTotal);
  setNotificationBadge(els.sellerProfileBtn, sellerTotal);

  const supportQueueCount = isSupportAdmin
    ? supportRefundRequests.filter((item) => hasUnseenItem('supportRefundRequests', item, getItemActivityMs)).length
      + supportReports.filter((item) => hasUnseenItem('supportReports', item, getItemActivityMs)).length
      + supportWithdrawals.filter((item) => hasUnseenItem('supportWithdrawals', item, getItemActivityMs)).length
      + supportVerifications.filter((item) => hasUnseenItem('supportVerifications', item, getItemActivityMs)).length
      + supportChats.filter(isChatUnreadForCurrentUser).length
    : 0;
  setNotificationBadge(els.supportPanelBtn, supportQueueCount);

  const floatingSupportCount = getRelevantSupportChatsForCurrentUser().filter(isChatUnreadForCurrentUser).length;
  setNotificationBadge(els.floatingSupportBtn, floatingSupportCount);
}


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



function openCustomTextModal({ title = 'Confirmar ação', message = '', placeholder = '', confirmLabel = 'Confirmar', cancelLabel = 'Cancelar', requiredText = '', textarea = false, danger = false, initialValue = '' } = {}) {
  return new Promise((resolve) => {
    const existing = document.getElementById('custom-action-modal');
    if (existing) existing.remove();

    const wrap = document.createElement('div');
    wrap.id = 'custom-action-modal';
    wrap.className = 'fixed inset-0 z-[140] flex items-end sm:items-center justify-center p-0 sm:p-4';
    const inputHtml = textarea
      ? `<textarea id="custom-action-input" rows="5" maxlength="700" placeholder="${escapeHtml(placeholder)}" class="mt-4 w-full resize-none rounded-2xl border border-gray-200 bg-gray-50 px-4 py-3 text-sm font-semibold outline-none focus:border-${danger ? 'red' : 'emerald'}-400 focus:bg-white focus:ring-4 focus:ring-${danger ? 'red' : 'emerald'}-50">${escapeHtml(initialValue)}</textarea>`
      : `<input id="custom-action-input" type="text" value="${escapeHtml(initialValue)}" placeholder="${escapeHtml(placeholder)}" class="mt-4 w-full rounded-2xl border border-gray-200 bg-gray-50 px-4 py-3 text-sm font-semibold outline-none focus:border-${danger ? 'red' : 'emerald'}-400 focus:bg-white focus:ring-4 focus:ring-${danger ? 'red' : 'emerald'}-50">`;

    wrap.innerHTML = `
      <div class="absolute inset-0 bg-slate-900/60 backdrop-blur-sm" data-custom-cancel></div>
      <div class="relative z-10 w-full sm:max-w-md rounded-t-3xl sm:rounded-3xl bg-white p-5 shadow-2xl">
        <div class="flex items-start justify-between gap-3">
          <div class="min-w-0">
            <h3 class="text-lg font-black text-gray-900">${escapeHtml(title)}</h3>
            ${message ? `<p class="mt-2 text-sm font-semibold leading-relaxed text-gray-600">${escapeHtml(message)}</p>` : ''}
          </div>
          <button type="button" data-custom-cancel class="shrink-0 rounded-xl p-2 text-gray-400 hover:bg-gray-100 hover:text-gray-700"><i data-lucide="x" class="w-5 h-5"></i></button>
        </div>
        ${requiredText ? `<div class="mt-4 rounded-2xl border border-red-200 bg-red-50 p-3 text-xs font-bold text-red-800">Digite exatamente <b>${escapeHtml(requiredText)}</b> para confirmar.</div>` : ''}
        ${inputHtml}
        <p id="custom-action-error" class="mt-2 hidden text-xs font-bold text-red-600"></p>
        <div class="mt-5 grid grid-cols-2 gap-2">
          <button type="button" data-custom-cancel class="rounded-2xl border border-gray-200 bg-white px-4 py-3 text-sm font-black text-gray-700 hover:bg-gray-50">${escapeHtml(cancelLabel)}</button>
          <button type="button" data-custom-confirm class="rounded-2xl px-4 py-3 text-sm font-black text-white ${danger ? 'bg-red-600 hover:bg-red-700' : 'bg-emerald-600 hover:bg-emerald-700'}">${escapeHtml(confirmLabel)}</button>
        </div>
      </div>`;

    document.body.appendChild(wrap);
    initIcons();

    const input = wrap.querySelector('#custom-action-input');
    const error = wrap.querySelector('#custom-action-error');
    const cleanup = (value) => { wrap.remove(); resolve(value); };

    wrap.querySelectorAll('[data-custom-cancel]').forEach((el) => el.addEventListener('click', () => cleanup(null)));
    wrap.querySelector('[data-custom-confirm]')?.addEventListener('click', () => {
      const value = String(input?.value || '').trim();
      if (requiredText && value.toUpperCase() !== String(requiredText).toUpperCase()) {
        if (error) { error.textContent = `Digite ${requiredText} para confirmar.`; error.classList.remove('hidden'); }
        input?.focus();
        return;
      }
      if (!requiredText && textarea && !value) {
        if (error) { error.textContent = 'Escreva uma descrição antes de enviar.'; error.classList.remove('hidden'); }
        input?.focus();
        return;
      }
      cleanup(value);
    });

    setTimeout(() => input?.focus(), 50);
  });
}

function confirmTypedDelete({ title = 'Excluir definitivamente', message = '' } = {}) {
  return openCustomTextModal({
    title,
    message,
    requiredText: 'EXCLUIR',
    placeholder: 'Digite EXCLUIR',
    confirmLabel: 'Excluir definitivamente',
    danger: true
  }).then((value) => String(value || '').toUpperCase() === 'EXCLUIR');
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
  if (s === 'revogado' || s === 'revoked') return 'revogado';
  if (s === 'excluido' || s === 'excluído' || s === 'deleted' || s === 'removido') return 'excluido';
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

  const saquePendente = Number(sellerData?.saquePendente ?? sellerData?.saldoEmSaque ?? sellerData?.financeiro?.saldoEmSaque ?? 0);
  const totalSacado = Number(sellerData?.totalSacado ?? sellerData?.financeiro?.totalSacado ?? 0);
  const reservadoOuSacado = Math.max(0, saquePendente) + Math.max(0, totalSacado);

  const saldoAtual = Math.max(0, saldoBrutoLiberado - reservadoOuSacado);
  const reservaQuePassouDoLiberado = Math.max(0, reservadoOuSacado - saldoBrutoLiberado);
  const saldoPendente = Math.max(0, saldoBrutoPendente - reservaQuePassouDoLiberado);
  const saldoTotalDisponivelAdmin = Math.max(0, saldoAtual + saldoPendente);

  return {
    saldo: saldoAtual,
    saldoAtual,
    saldoPendente,
    saldoEmSaque: Math.max(0, saquePendente),
    totalSacado: Math.max(0, totalSacado),
    saldoTotalDisponivelAdmin,
    totalLiquidoEntregue,
    totalBrutoEntregue,
    totalVendasEntregues,
    taxaPercentual: SELLER_FEE_PERCENT,
    saqueMinimo: SELLER_WITHDRAW_MIN,
    liberacaoDias: SELLER_RELEASE_DAYS
  };
}


function getSellerFinancialsForDisplay(sellerData = {}, fallbackOrders = []) {
  const f = sellerData?.financeiro || {};
  const hasStored = [
    sellerData?.saldoAtual,
    sellerData?.saldoPendente,
    sellerData?.saldoEmSaque,
    sellerData?.saquePendente,
    sellerData?.totalSacado,
    sellerData?.totalVendasEntregues,
    f?.saldoAtual,
    f?.saldoPendente,
    f?.saldoEmSaque,
    f?.totalSacado,
    f?.totalVendasEntregues
  ].some((value) => value !== undefined && value !== null && value !== '');

  if (!hasStored) return calculateSellerFinancials(fallbackOrders, sellerData);

  const saldoAtual = Number(sellerData?.saldoAtual ?? f?.saldoAtual ?? 0);
  const saldoPendente = Number(sellerData?.saldoPendente ?? f?.saldoPendente ?? 0);
  const saldoEmSaque = Number(sellerData?.saldoEmSaque ?? sellerData?.saquePendente ?? f?.saldoEmSaque ?? 0);
  const totalSacado = Number(sellerData?.totalSacado ?? f?.totalSacado ?? 0);
  const saldoTotalDisponivelAdmin = Math.max(0, saldoAtual + saldoPendente);

  return {
    saldo: Math.max(0, saldoAtual),
    saldoAtual: Math.max(0, saldoAtual),
    saldoPendente: Math.max(0, saldoPendente),
    saldoEmSaque: Math.max(0, saldoEmSaque),
    totalSacado: Math.max(0, totalSacado),
    saldoTotalDisponivelAdmin,
    totalLiquidoEntregue: Number(f?.totalLiquidoEntregue || 0),
    totalBrutoEntregue: Number(f?.totalBrutoEntregue || 0),
    totalVendasEntregues: Number(sellerData?.totalVendasEntregues ?? sellerData?.totalVendas ?? f?.totalVendasEntregues ?? 0),
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
    lojaCacheRemove('sellerStats', 'global');
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
    totalVendas: Number(data.totalVendas || data.totalVendasEntregues || 0),
    totalVendasEntregues: Number(data.totalVendasEntregues || data.totalVendas || 0),
    sellerTotalVendas: Number(data.sellerTotalVendas || data.vendedorTotalVendas || 0),
    createdAtMs: Number(data.createdAtMs || 0) || timestampToMs(data.createdAt),
    updatedAtMs: Number(data.updatedAtMs || 0) || timestampToMs(data.updatedAt),
    rankScore: Number(data.rankScore || 0),
    rankScoreUpdatedAtMs: Number(data.rankScoreUpdatedAtMs || 0)
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
  updateNotificationBadges();
}

async function loadStoreStatus(force = false) {
  if (!currentUser || !ghubProfile?.gameId) {
    lojaStatus = { comprador: null, vendedor: null };
    renderSellerTop();
    renderSupportTop();
    return;
  }

  const cacheKey = getCurrentUserCacheKey();
  const cached = !force ? lojaCacheGet('storeStatus', LOJA_CACHE_TTL.STORE_STATUS, cacheKey) : null;
  if (cached) {
    lojaStatus = {
      comprador: cached.comprador || null,
      vendedor: isSellerApprovedForPanel(cached.vendedor || null, null) ? cached.vendedor : null
    };
    if (cached.vendedor && !lojaStatus.vendedor) lojaCacheRemove('storeStatus', cacheKey);
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

    const rawSeller = sellerSnap.exists() ? { id: sellerSnap.id, ...sellerSnap.data() } : null;
    let approvedSeller = null;

    if (rawSeller) {
      if (isSellerApprovedForPanel(rawSeller, null)) {
        approvedSeller = rawSeller;
      } else {
        const verificationSnap = await getDoc(doc(lojaDb, VERIFICATION_COLLECTION, String(ghubProfile.gameId)));
        const verificationData = verificationSnap.exists() ? { id: verificationSnap.id, ...verificationSnap.data() } : null;
        sellerVerification = verificationData;
        approvedSeller = isSellerApprovedForPanel(rawSeller, verificationData) ? rawSeller : null;
      }
    }

    lojaStatus = {
      comprador: buyerSnap.exists() ? { id: buyerSnap.id, ...buyerSnap.data() } : null,
      vendedor: approvedSeller
    };
    lojaCacheSet('storeStatus', lojaStatus, cacheKey);
  } catch (err) {
    console.warn('Status da loja indisponível:', err);
    lojaStatus = { comprador: null, vendedor: null };
    localToast('error', 'Não foi possível verificar seu cadastro na loja. Confira as regras do Firebase da loja.');
  } finally {
    loadingStatus = false;
    renderSellerTop();
  }
}

async function loadCategories(force = false) {
  const cached = !force ? lojaCacheGet('categories', LOJA_CACHE_TTL.CATEGORIES, 'global') : null;
  if (Array.isArray(cached) && cached.length) {
    categories = cached;
    renderCategories();
    return;
  }

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
  lojaCacheSet('categories', categories, 'global');
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

async function loadProducts(force = false) {
  const cached = !force ? lojaCacheGet('products', LOJA_CACHE_TTL.PRODUCTS, 'global') : null;
  if (Array.isArray(cached)) {
    products = sortProductsForVitrine(cached.map((item) => ({ ...item })));
    setProductsLoading(false);
    applyFilters();
    return;
  }

  setProductsLoading(true);

  try {
    let snap = await getDocs(query(collection(lojaDb, 'produtos'), orderBy('rankScore', 'desc'), limit(PRODUCTS_FETCH_LIMIT)));

    // Compatibilidade com produtos antigos que ainda não têm rankScore.
    if (!snap.docs.length) {
      snap = await getDocs(collection(lojaDb, 'produtos'));
    }

    products = snap.docs
      .map(normalizeProduct)
      .filter((product) => product.ativo !== false);

    const productsNeedingRank = products.filter((product) => !Number.isFinite(Number(product.rankScore)) || Number(product.rankScore) <= 0);
    if (productsNeedingRank.length) {
      const nowMs = Date.now();
      await Promise.all(productsNeedingRank.slice(0, 40).map((product) => {
        const rankFields = buildProductRankFields(product, { nowMs });
        return setDoc(doc(lojaDb, 'produtos', product.id), rankFields, { merge: true }).catch(() => null);
      }));
      products = products.map((product) => ({ ...product, ...buildProductRankFields(product) }));
    }

    products = sortProductsForVitrine(products);
    lojaCacheSet('products', products, 'global');
  } catch (err) {
    console.error('Erro ao carregar produtos da loja:', err?.code || err?.message || err, err);
    products = [];
    localToast('error', `Não foi possível carregar os produtos da loja. Erro: ${err?.code || err?.message || 'verifique as regras de leitura'}`);
  } finally {
    setProductsLoading(false);
    applyFilters();
  }
}

async function refreshProductsSilently() {
  try {
    const snap = await getDocs(query(collection(lojaDb, 'produtos'), orderBy('rankScore', 'desc'), limit(PRODUCTS_FETCH_LIMIT)));
    products = snap.docs
      .map(normalizeProduct)
      .filter((product) => product.ativo !== false);
    await loadSellerStatsForProducts(products);
    products = sortProductsForVitrine(products);
    lojaCacheSet('products', products, 'global');
    applyFilters();
  } catch (err) {
    console.warn('Atualização silenciosa da vitrine falhou:', err?.code || err?.message || err);
  }
}

async function loadSellerStatsForProducts(productList = [], force = false) {
  const sellerIds = Array.from(new Set(
    productList.map((product) => String(product.sellerId || '').trim()).filter(Boolean)
  ));

  sellerStatsById = new Map();
  if (!sellerIds.length) return;

  const cached = !force ? lojaCacheGet('sellerStats', LOJA_CACHE_TTL.SELLER_STATS, 'global') : null;
  if (Array.isArray(cached)) {
    cached.forEach((item) => {
      const id = String(item?.id || '').trim();
      if (!id || !sellerIds.includes(id)) return;
      sellerStatsById.set(id, {
        totalVendas: Number(item.totalVendas || item.totalVendasEntregues || 0),
        totalVendasEntregues: Number(item.totalVendasEntregues || item.totalVendas || 0),
        notaMedia: Number(item.notaMedia || 0),
        notaTotal: Number(item.notaTotal || 0)
      });
    });
  }

  const missingIds = sellerIds.filter((id) => !sellerStatsById.has(id));
  if (!missingIds.length) return;

  try {
    const chunks = [];
    for (let i = 0; i < missingIds.length; i += 30) chunks.push(missingIds.slice(i, i + 30));

    for (const chunk of chunks) {
      const snap = await getDocs(query(collection(lojaDb, 'vendedor'), where(documentId(), 'in', chunk)));
      snap.docs.forEach((d) => {
        const data = d.data() || {};
        sellerStatsById.set(String(d.id), {
          totalVendas: Number(data.totalVendas || data.totalVendasEntregues || data.financeiro?.totalVendasEntregues || 0),
          totalVendasEntregues: Number(data.totalVendasEntregues || data.totalVendas || data.financeiro?.totalVendasEntregues || 0),
          notaMedia: Number(data.notaMedia || 0),
          notaTotal: Number(data.notaTotal || 0)
        });
      });
    }

    lojaCacheSet('sellerStats', Array.from(sellerStatsById.entries()).map(([id, data]) => ({ id, ...data })), 'global');
  } catch (err) {
    console.warn('Não foi possível carregar ranking dos vendedores. Usando vendas salvas nos produtos:', err?.code || err?.message || err);
  }
}

function applyFilters() {
  const search = String(els.search?.value || '').trim().toLowerCase();
  const category = String(els.category?.value || '').trim();
  productsPage = 1;

  filteredProducts = sortProductsForVitrine(products.filter((product) => {
    const matchesCategory = !category || product.categoriaId === category;
    const blob = `${product.titulo} ${product.descricao} ${product.categoriaNome} ${product.sellerName}`.toLowerCase();
    const matchesSearch = !search || blob.includes(search);
    return matchesCategory && matchesSearch;
  }));

  renderProducts();
}

function renderProductsPagination() {
  if (!els.productPagination) return;
  const total = filteredProducts.length;
  const totalPages = Math.max(1, Math.ceil(total / PRODUCTS_PAGE_SIZE));
  productsPage = Math.min(Math.max(1, productsPage), totalPages);

  if (total <= PRODUCTS_PAGE_SIZE) {
    els.productPagination.innerHTML = '';
    return;
  }

  els.productPagination.innerHTML = `
    <div class="rounded-2xl border border-gray-100 bg-white p-3 shadow-sm">
      <div class="flex items-center justify-between gap-3">
        <button type="button" data-products-page="prev" class="rounded-xl border border-gray-200 bg-white px-3 py-2 text-xs font-black text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-40" ${productsPage <= 1 ? 'disabled' : ''}>Voltar</button>
        <span class="text-xs font-black text-gray-500">Página ${productsPage} de ${totalPages}</span>
        <button type="button" data-products-page="next" class="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-black text-emerald-700 hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-40" ${productsPage >= totalPages ? 'disabled' : ''}>Próxima</button>
      </div>
    </div>`;

  els.productPagination.querySelectorAll('[data-products-page]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const dir = btn.getAttribute('data-products-page') || '';
      if (dir === 'prev' && productsPage > 1) productsPage -= 1;
      if (dir === 'next' && productsPage < totalPages) productsPage += 1;
      renderProducts();
    });
  });
}

function renderProducts() {
  const total = filteredProducts.length;
  const totalPages = Math.max(1, Math.ceil(total / PRODUCTS_PAGE_SIZE));
  productsPage = Math.min(Math.max(1, productsPage), totalPages);
  const start = (productsPage - 1) * PRODUCTS_PAGE_SIZE;
  const pageProducts = filteredProducts.slice(start, start + PRODUCTS_PAGE_SIZE);

  if (els.counter) {
    const base = total === 1 ? '1 produto encontrado' : `${total} produtos encontrados`;
    els.counter.textContent = total > PRODUCTS_PAGE_SIZE ? `${base} • ${PRODUCTS_PAGE_SIZE} por página` : base;
  }

  if (loadingProducts) return;

  els.empty?.classList.toggle('hidden', total > 0);

  if (!els.grid) return;
  if (!total) {
    els.grid.innerHTML = '';
    renderProductsPagination();
    return;
  }

  els.grid.innerHTML = pageProducts.map((product) => {
    const favorite = isFavoriteProduct(product.id);
    const image = product.imagem
      ? `<img src="${escapeHtml(product.imagem)}" alt="${escapeHtml(product.titulo)}" class="h-full w-full object-cover">`
      : '<i data-lucide="package" class="h-8 w-8 sm:h-10 sm:w-10 text-gray-300"></i>';
    const sales = getProductSellerSales(product);
    const salesText = sales > 0 ? `${sales} venda${sales === 1 ? '' : 's'} do vendedor` : 'Vendedor novo';

    return `
      <article class="group overflow-hidden rounded-2xl sm:rounded-3xl border ${favorite ? 'border-amber-200 ring-2 ring-amber-100' : 'border-gray-100'} bg-white shadow-sm transition hover:-translate-y-0.5 hover:shadow-lg">
        <div class="relative">
          <button type="button" data-open-product="${escapeHtml(product.id)}" class="block w-full text-left">
            <div class="relative h-28 sm:h-44 bg-gray-50 flex items-center justify-center overflow-hidden">
              ${image}
              <span class="absolute left-2 top-2 rounded-full bg-white/95 px-2 py-1 text-[10px] font-black text-emerald-700 shadow-sm ring-1 ring-emerald-100">${moneyBRL(product.preco)}</span>
            </div>
            <div class="p-2.5 sm:p-4">
              <h4 class="line-clamp-2 min-h-[34px] sm:min-h-0 text-xs sm:text-base font-black text-gray-900">${escapeHtml(product.titulo)}</h4>
              <div class="mt-2 flex items-center justify-between gap-2">
                <span class="min-w-0 truncate rounded-full bg-gray-50 px-2 py-0.5 text-[10px] sm:text-[11px] font-black text-gray-500 ring-1 ring-gray-200">${escapeHtml(product.categoriaNome)}</span>
              </div>
              <p class="mt-2 text-[10px] sm:text-xs font-black text-emerald-700">${moneyBRL(product.preco)}</p>
              <p class="mt-1 truncate text-[10px] font-semibold text-gray-400">${escapeHtml(salesText)}</p>
            </div>
          </button>
          <button type="button" data-favorite-product="${escapeHtml(product.id)}" aria-label="Favoritar produto" class="absolute right-2 top-2 rounded-full ${favorite ? 'bg-amber-400 text-white' : 'bg-white/95 text-gray-500'} p-2 shadow-sm ring-1 ring-gray-100 hover:bg-amber-100 hover:text-amber-700">
            <i data-lucide="star" class="h-4 w-4 ${favorite ? 'fill-current' : ''}"></i>
          </button>
        </div>
      </article>
    `;
  }).join('');

  els.grid.querySelectorAll('[data-open-product]').forEach((btn) => {
    btn.addEventListener('click', () => openProductModal(btn.getAttribute('data-open-product') || ''));
  });

  els.grid.querySelectorAll('[data-favorite-product]').forEach((btn) => {
    btn.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      toggleFavoriteProduct(btn.getAttribute('data-favorite-product') || '');
    });
  });

  renderProductsPagination();
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
  let product = products.find((item) => String(item.id) === String(productId));
  if (!els.productModal || !els.productModalBody || !els.productModalTitle) return;

  els.productModalTitle.textContent = 'Carregando produto...';
  els.productModalBody.innerHTML = '<div class="rounded-3xl border border-gray-100 bg-gray-50 p-8 text-center text-sm font-bold text-gray-500"><i data-lucide="loader-2" class="mx-auto mb-3 h-7 w-7 animate-spin text-emerald-500"></i>Atualizando valor e estoque...</div>';
  els.productModal.classList.remove('hidden');
  els.productModal.classList.add('flex');
  initIcons();

  try {
    product = await refreshProductFromFirestore(productId);
  } catch (err) {
    console.warn('Não foi possível atualizar produto antes de abrir:', err);
    if (!product) {
      localToast('error', 'Produto não encontrado ou indisponível.');
      closeProductModal();
      return;
    }
    localToast('info', 'Não foi possível atualizar agora. Mostrando os dados salvos localmente.');
  }

  if (!product || product.ativo === false) {
    localToast('error', 'Esse produto está indisponível.');
    closeProductModal();
    return;
  }

  const isOwnProduct = !!ghubProfile?.gameId && String(product.sellerId || '') === String(ghubProfile.gameId);
  els.productModalTitle.textContent = product.titulo;

  const image = product.imagem
    ? `<img src="${escapeHtml(product.imagem)}" alt="${escapeHtml(product.titulo)}" class="h-56 w-full rounded-3xl object-cover border border-gray-100 bg-gray-50">`
    : '<div class="h-56 w-full rounded-3xl border border-gray-100 bg-gray-50 flex items-center justify-center"><i data-lucide="package" class="h-12 w-12 text-gray-300"></i></div>';
  const statusHtml = product.disponivel
    ? '<span class="inline-flex items-center rounded-full bg-emerald-50 px-2.5 py-1 text-[11px] font-black text-emerald-700 ring-1 ring-emerald-200">DISPONÍVEL</span>'
    : '<span class="inline-flex items-center rounded-full bg-red-50 px-2.5 py-1 text-[11px] font-black text-red-700 ring-1 ring-red-200">ESGOTADO</span>';

  const favorite = isFavoriteProduct(product.id);
  const buyButtonHtml = isOwnProduct
    ? '<button type="button" disabled class="w-full rounded-2xl bg-gray-200 px-5 py-4 text-sm font-black text-gray-500 disabled:cursor-not-allowed">Você não pode comprar seu próprio produto</button>'
    : !product.disponivel
      ? '<button type="button" disabled class="w-full rounded-2xl bg-gray-200 px-5 py-4 text-sm font-black text-gray-500 disabled:cursor-not-allowed">Produto esgotado</button>'
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
        <button type="button" data-favorite-modal-product="${escapeHtml(product.id)}" class="rounded-xl border ${favorite ? 'border-amber-300 bg-amber-50 text-amber-700' : 'border-gray-200 bg-white text-gray-600'} px-3 py-2 text-xs font-black hover:bg-amber-50 hover:text-amber-700">${favorite ? 'Remover dos favoritos' : 'Favoritar produto'}</button>
        <button type="button" data-report-product="${escapeHtml(product.id)}" class="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-black text-amber-700 hover:bg-amber-100">Denunciar produto</button>
      </div>
      <p class="mt-4 text-sm leading-relaxed text-gray-600">${escapeHtml(product.descricao || 'Produto disponível na loja.')}</p>
      <p class="mt-5 text-3xl font-black text-emerald-700">${moneyBRL(product.preco)}</p>
      <p class="mt-1 text-xs font-bold text-gray-400">Valor atualizado ao abrir o produto.</p>
    </div>
    ${buyButtonHtml}`;

  els.productModalBody.querySelector('[data-buy-product]')?.addEventListener('click', () => createOrder(product.id));
  els.productModalBody.querySelector('[data-report-product]')?.addEventListener('click', () => reportProduct(product.id));
  els.productModalBody.querySelector('[data-favorite-modal-product]')?.addEventListener('click', () => {
    toggleFavoriteProduct(product.id);
    openProductModal(product.id);
  });
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

async function getBuyerRatingForOrder(orderId) {
  const oid = String(orderId || '').trim();
  if (!oid || !ghubProfile?.gameId) return null;
  return buyerRatings.find((rating) => String(rating.orderId || rating.pedidoId || '') === oid) || null;
}

async function loadBuyerRatings() {
  if (!currentUser || !ghubProfile?.gameId) {
    buyerRatings = [];
    return;
  }
  try {
    const snap = await getDocs(query(collection(lojaDb, SELLER_RATING_COLLECTION), where('buyerId', '==', String(ghubProfile.gameId))));
    buyerRatings = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  } catch (err) {
    console.warn('Não foi possível carregar avaliações do comprador:', err);
    buyerRatings = [];
  }
}

async function rateSeller(sellerId, nota, orderId = '') {
  if (!currentUser || !ghubProfile?.gameId) { localToast('error', 'Entre na GuildaHub para avaliar o vendedor.'); return; }
  const cleanSellerId = String(sellerId || '').trim();
  const cleanOrderId = String(orderId || '').trim();
  if (!cleanSellerId || !cleanOrderId) { localToast('error', 'Avaliação só pode ser feita por uma compra existente.'); return; }
  if (cleanSellerId === String(ghubProfile.gameId)) { localToast('error', 'Você não pode avaliar a si mesmo.'); return; }

  const order = buyerOrders.find((item) => String(item.id) === cleanOrderId);
  if (!order || String(order.buyerId || '') !== String(ghubProfile.gameId) || String(order.sellerId || '') !== cleanSellerId) {
    localToast('error', 'Essa avaliação não pertence às suas compras.');
    return;
  }

  const status = String(order.status || '').toLowerCase();
  if (status !== 'entregue') {
    localToast('error', 'Você só pode avaliar o vendedor após a compra ser marcada como entregue.');
    return;
  }

  const normalized = Number(nota) >= 5 ? 10 : 0;
  const id = `${cleanOrderId}_${ghubProfile.gameId}_${cleanSellerId}`;
  const ratingRef = doc(lojaDb, SELLER_RATING_COLLECTION, id);

  try {
    const existing = await getDoc(ratingRef);
    if (existing.exists()) {
      const data = existing.data() || {};
      localToast('error', `Você já avaliou esse pedido como ${Number(data.nota || 0) >= 5 ? 'like' : 'dislike'}. Não é possível alterar.`);
      return;
    }

    await setDoc(ratingRef, {
      id,
      orderId: cleanOrderId,
      pedidoId: cleanOrderId,
      sellerId: cleanSellerId,
      sellerName: order.sellerName || '',
      buyerId: ghubProfile.gameId,
      buyerUid: currentUser.uid || '',
      buyerName: ghubProfile.nick || '',
      nota: normalized,
      tipo: normalized >= 5 ? 'like' : 'dislike',
      createdAt: serverTimestamp(),
      createdAtMs: Date.now()
    });

    await loadBuyerRatings();
    const stats = await getSellerRatingStats(cleanSellerId);
    await setDoc(doc(lojaDb, 'vendedor', cleanSellerId), {
      notaMedia: stats.avg ?? 0,
      notaTotal: stats.count,
      totalLikes: stats.likes,
      totalDislikes: stats.dislikes,
      updatedAt: serverTimestamp()
    }, { merge: true });
    renderBuyerOrders();
    localToast('success', 'Avaliação registrada. Ela não poderá ser alterada.');
  } catch (err) {
    console.error(err);
    localToast('error', 'Não foi possível registrar a avaliação.');
  }
}

async function reportProduct(productId) {
  if (!currentUser || !ghubProfile?.gameId) { localToast('error', 'Entre na GuildaHub para denunciar um produto.'); return; }
  const product = products.find((item) => String(item.id) === String(productId));
  if (!product) return;
  const motivo = await openCustomTextModal({
    title: 'Denunciar produto',
    message: `Explique o problema com o produto "${product.titulo || 'produto'}". A denúncia será enviada ao suporte da plataforma.`,
    placeholder: 'Descreva o motivo da denúncia...',
    confirmLabel: 'Enviar denúncia',
    textarea: true,
    danger: false
  });
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

function isSellerRecordBlocked(data = null) {
  if (!data) return false;
  const status = getVerificationStatusLabel(data.status || data.verificacaoStatus || data.verificationStatus || data.statusVerificacao || '');
  return data.excluido === true
    || data.excluida === true
    || data.revogado === true
    || data.revogada === true
    || !!data.excluidoEmMs
    || !!data.excluidaEmMs
    || !!data.revogadoEmMs
    || status === 'excluido'
    || status === 'revogado';
}

function isSellerVerificationBlocked(data = null) {
  if (!data) return false;
  const status = getVerificationStatusLabel(data.status || data.verificacaoStatus || data.verificationStatus || data.statusVerificacao || '');
  return data.excluido === true
    || data.excluida === true
    || data.revogado === true
    || data.revogada === true
    || !!data.vendedorExcluidoEmMs
    || !!data.excluidoEmMs
    || !!data.revogadoEmMs
    || status === 'excluido'
    || status === 'revogado';
}

function isSellerApprovedForPanel(sellerData = null, verificationData = null) {
  if (!sellerData) return false;
  if (isSellerRecordBlocked(sellerData) || isSellerVerificationBlocked(verificationData)) return false;
  if (sellerData.ativo === false || String(sellerData.status || '').toLowerCase() === 'inativo') return false;
  const status = getVerificationStatusLabel(
    verificationData?.status ||
    sellerData?.verificacaoStatus ||
    sellerData?.verificationStatus ||
    sellerData?.statusVerificacao ||
    ''
  );
  return sellerData?.verificado === true || status === 'aprovado';
}

function clearSellerLocalState(sellerId = ghubProfile?.gameId || '') {
  const cleanSellerId = String(sellerId || '').trim();
  if (cleanSellerId && String(ghubProfile?.gameId || '') === cleanSellerId) {
    lojaStatus.vendedor = null;
    sellerProducts = [];
    sellerOrders = [];
    sellerChats = [];
    resetSellerOrdersPagination();
    renderSellerTop();
    renderSellerProducts();
    renderSellerOrders();
    renderSellerSupportChats();
    renderSellerProfileCard();
  }
  const cacheKey = getCurrentUserCacheKey();
  lojaCacheRemove('storeStatus', cacheKey);
  if (cleanSellerId) {
    lojaCacheRemove('sellerProducts', cleanSellerId);
    lojaCacheRemove('sellerOrders', cleanSellerId + ':page:1');
    lojaCacheRemove('sellerChats', cleanSellerId);
    lojaCacheRemove('sellerStats', 'global');
  }
  lojaCacheRemove('products', 'global');
}

async function assertCurrentSellerFreshApproved({ showToastMessage = true } = {}) {
  if (!currentUser || !ghubProfile?.gameId) {
    if (showToastMessage) localToast('error', 'Entre na GuildaHub para vender.');
    return null;
  }

  const sellerId = String(ghubProfile.gameId || '').trim();
  const [sellerSnap, verificationSnap] = await Promise.all([
    getDoc(doc(lojaDb, 'vendedor', sellerId)),
    getDoc(doc(lojaDb, VERIFICATION_COLLECTION, sellerId)).catch(() => null)
  ]);

  const sellerData = sellerSnap.exists() ? { id: sellerSnap.id, ...sellerSnap.data() } : null;
  const verificationData = verificationSnap?.exists?.() ? { id: verificationSnap.id, ...verificationSnap.data() } : null;
  sellerVerification = verificationData;

  if (!sellerData || !isSellerApprovedForPanel(sellerData, verificationData)) {
    clearSellerLocalState(sellerId);
    if (showToastMessage) {
      if (isSellerVerificationBlocked(verificationData) || isSellerRecordBlocked(sellerData)) {
        localToast('error', 'Sua conta de vendedor foi removida ou revogada pelo suporte. Envie uma nova solicitação se quiser vender novamente.');
      } else {
        localToast('error', 'Sua conta de vendedor não está aprovada ou não existe mais.');
      }
    }
    return null;
  }

  lojaStatus.vendedor = sellerData;
  lojaCacheSet('storeStatus', { ...lojaStatus, vendedor: sellerData }, getCurrentUserCacheKey());
  renderSellerTop();
  return sellerData;
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
    if (status === 'aprovado') {
      els.verificationStatus.innerHTML = 'Sua verificação foi aprovada. Você já pode ativar o painel do vendedor.';
      if (!lojaStatus?.vendedor) {
        els.verificationStatus.innerHTML += '<button id="btn-activate-approved-seller" type="button" class="mt-3 w-full rounded-xl bg-emerald-600 px-3 py-2 text-xs font-black text-white hover:bg-emerald-700">Ativar painel do vendedor</button>';
      }
    } else if (status === 'recusado') els.verificationStatus.textContent = verification?.motivoRecusa || 'Sua verificação foi recusada. Você ainda pode comprar normalmente.';
    else if (status === 'pendente') els.verificationStatus.textContent = 'Sua verificação está em análise. Aguarde a aprovação para vender.';
    else els.verificationStatus.textContent = 'Antes de vender, envie seus dados para análise. Se aprovado, você poderá criar o perfil de vendedor.';
  }

  setVerificationImageStatus('front', verification?.rgFrenteBase64 ? 'Imagem enviada.' : 'Imagem será comprimida para caber no Firestore.');
  setVerificationImageStatus('back', verification?.rgVersoBase64 ? 'Imagem enviada.' : 'Imagem será comprimida para caber no Firestore.');

  if (!mountLojaPanelInline(els.verificationModal, 'painel_vendedor')) {
    els.verificationModal?.classList.remove('hidden');
    els.verificationModal?.classList.add('flex');
  }

  qs('btn-activate-approved-seller')?.addEventListener('click', async () => {
    const seller = await createOrUpdateSellerProfile();
    if (seller) await openSellerPanel();
  });

  initIcons();
}

function closeVerificationModal() {
  if (isInlineLojaPage('painel_vendedor')) return;
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
    const verification = sellerVerification || await loadSellerVerification();
    const verificationStatus = getVerificationStatusLabel(verification?.status);

    if (isSellerVerificationBlocked(verification) || isSellerRecordBlocked(existing)) {
      clearSellerLocalState(payload.gameId);
      localToast('error', 'Sua conta de vendedor foi removida ou revogada pelo suporte. Envie uma nova solicitação se quiser vender novamente.');
      openVerificationModal(verification);
      return null;
    }

    if (!isSellerApprovedForPanel(existing || { id: payload.gameId }, verification)) {
      if (verificationStatus === 'pendente') localToast('info', 'Sua solicitação de vendedor ainda está em análise.');
      else if (verificationStatus === 'recusado') localToast('error', 'Sua solicitação de vendedor foi recusada.');
      else localToast('info', 'Envie a solicitação e aguarde aprovação para vender.');
      openVerificationModal(verification);
      return null;
    }

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
      verificado: true,
      verificacaoStatus: 'aprovado',
      verificationId: verification?.id || payload.gameId,
      totalProdutos: Number(existing?.totalProdutos || 0),
      totalVendas: Number(existing?.totalVendas || 0),
      updatedAt: serverTimestamp(),
      ...(existing?.createdAt ? {} : { createdAt: serverTimestamp() })
    };

    await setDoc(sellerRef, sellerPayload, { merge: true });
    lojaStatus.vendedor = { id: payload.gameId, ...sellerPayload };
    lojaCacheRemove('storeStatus', getCurrentUserCacheKey());
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


function getLocalBuyerPayloadForPix() {
  if (!ghubProfile?.gameId) return null;
  return {
    gameId: String(ghubProfile.gameId || ''),
    id: String(ghubProfile.gameId || ''),
    uid: String(currentUser?.uid || ghubProfile.uid || ''),
    email: normalizeEmail(currentUser?.email || ghubProfile.email || ghubProfile.playerEmail || ''),
    nick: String(ghubProfile.nick || ghubProfile.nome || ghubProfile.name || '').trim(),
    foto: ghubProfile.foto || ghubProfile.photo || ''
  };
}

async function createOrder(productId) {
  let product = products.find((item) => String(item.id) === String(productId));
  if (!currentUser) { localToast('error', 'Entre na GuildaHub para comprar.'); return; }
  if (!ghubProfile?.gameId) { localToast('error', 'Conclua seu perfil da GuildaHub antes de comprar.'); return; }

  try {
    product = await refreshProductFromFirestore(productId);
  } catch (err) {
    console.warn('Falha ao atualizar produto antes do Pix:', err);
    if (!product) { localToast('error', 'Produto não encontrado ou indisponível.'); return; }
  }

  if (product.ativo === false) { localToast('error', 'Esse produto está indisponível.'); return; }
  if (!product.disponivel) { localToast('error', 'Esse produto está esgotado.'); return; }
  if (String(product.sellerId || '') && String(product.sellerId) === String(ghubProfile.gameId)) { localToast('error', 'Você não pode comprar seu próprio produto.'); return; }

  const btn = els.productModalBody?.querySelector('[data-buy-product]');
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<i data-lucide="loader-2" class="inline w-4 h-4 animate-spin mr-2"></i> Gerando Pix...';
    initIcons();
  }

  try {
    const buyer = getLocalBuyerPayloadForPix();
    if (!buyer?.gameId) throw new Error('buyer-profile-local-required');

    const response = await fetch('/api/loja_mp_create_pix', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ productId: product.id, buyer })
    });

    const rawResponse = await response.text().catch(() => '');
    let data = {};
    try { data = rawResponse ? JSON.parse(rawResponse) : {}; } catch (_) { data = {}; }

    if (!response.ok || data.ok === false) {
      const backendError = data.message || data.error || '';
      if (!backendError && response.status === 404) throw new Error('api-not-found');
      if (!backendError && response.status === 401) throw new Error('buyer-auth-required');
      if (!backendError && response.status >= 500) throw new Error('api-server-error');
      throw new Error(backendError || `http-${response.status}` || 'payment-create-failed');
    }

    renderPixPaymentInfo(product, data);
    startPaymentPolling(data.checkoutId);
  } catch (err) {
    console.error(err);
    const messageMap = {
      'buyer-profile-local-required': 'Não foi possível identificar seu perfil local da GuildaHub.',
      'buyer-auth-required': 'Entre novamente na GuildaHub para comprar.',
      'buyer-profile-not-found': 'Não foi possível localizar seu perfil da GuildaHub.',
      'product-not-found': 'Produto não encontrado.',
      'product-inactive': 'Esse produto está indisponível.',
      'out-of-stock': 'Esse produto ficou sem estoque.',
      'self-purchase': 'Você não pode comprar seu próprio produto.',
      'invalid-amount': 'Valor do produto inválido.',
      'mercado-pago-error': 'Não foi possível gerar o Pix no Mercado Pago.',
      'api-not-found': 'A API de pagamento não foi encontrada nessa URL de teste. Use uma URL que tenha a pasta /api publicada.',
      'api-server-error': 'A API de pagamento respondeu erro interno. Veja os Runtime Logs da Vercel.',
      'ghub-auth-env-missing': 'A API não encontrou o Firebase principal da GuildaHub. Confira GHUB_FIREBASE_SERVICE_ACCOUNT na Vercel.',
      'ghub-auth-invalid': 'Sua sessão não foi validada pela API. Entre novamente na GuildaHub.'
    };
    const rawMessage = String(err?.message || '').trim();
    const backendMessage = rawMessage.startsWith('Mercado Pago recusou:') || rawMessage === 'invalid-app-base-url'
      ? rawMessage
      : '';
    localToast('error', messageMap[rawMessage] || backendMessage || rawMessage || 'Não foi possível gerar o pagamento Pix.');
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = 'Comprar agora';
    }
  }
}

function renderPixPaymentInfo(product, payment) {
  if (!els.productModal || !els.productModalBody || !els.productModalTitle) return;

  const qrBase64 = payment.qrCodeBase64 || payment.qr_code_base64 || '';
  const qrCode = payment.qrCode || payment.copiaCola || payment.qr_code || '';
  const checkoutId = payment.checkoutId || '';
  const paymentAmount = Number(payment.amount ?? product.preco ?? 0);
  const productTitle = payment.productTitle || product.titulo || 'Produto';
  const expiresAtMs = Number(payment.expiresAtMs || 0);
  const expirationText = expiresAtMs ? `Válido até ${formatDateTimeBR(expiresAtMs)}.` : 'Válido por 30 minutos após gerar.';
  const cachedPrice = Number(product.preco || 0);
  const priceChanged = Number.isFinite(paymentAmount) && Number.isFinite(cachedPrice) && Math.abs(paymentAmount - cachedPrice) >= 0.01;

  els.productModalTitle.textContent = 'Pagamento Pix';

  els.productModalBody.innerHTML = `
    <div class="rounded-3xl border border-emerald-100 bg-emerald-50 p-4">
      <p class="text-xs font-black uppercase tracking-wider text-emerald-700">Pedido aguardando pagamento</p>
      <h4 class="mt-1 text-lg font-black text-gray-900">${escapeHtml(productTitle)}</h4>
      <p class="mt-1 text-sm font-bold text-gray-600">Valor: ${moneyBRL(paymentAmount || 0)}</p>
      ${priceChanged ? '<p class="mt-1 rounded-xl bg-amber-100 px-3 py-2 text-xs font-black text-amber-800">O valor foi atualizado pelo vendedor. Gere/pague somente este Pix novo.</p>' : ''}
      <p class="mt-1 text-xs font-semibold text-emerald-800">O pedido só será criado/liberado após o Mercado Pago confirmar pagamento aprovado.</p>
      <p class="mt-2 rounded-xl bg-white/80 px-3 py-2 text-xs font-black text-emerald-900 ring-1 ring-emerald-200">Esse Pix é válido por 30 minutos. ${escapeHtml(expirationText)}</p>
    </div>

    ${qrBase64 ? `<div class="flex justify-center rounded-3xl border border-gray-100 bg-white p-4"><img src="data:image/png;base64,${escapeHtml(qrBase64)}" alt="QR Code Pix" class="h-56 w-56 rounded-2xl object-contain"></div>` : ''}

    <div>
      <label class="block text-xs font-black uppercase tracking-wider text-gray-400 mb-1.5">Pix copia e cola</label>
      <textarea id="pix-copy-code" rows="5" readonly class="w-full resize-none rounded-2xl border border-gray-200 bg-gray-50 px-4 py-3 text-xs font-semibold text-gray-700 outline-none">${escapeHtml(qrCode)}</textarea>
    </div>

    <div class="grid grid-cols-1 sm:grid-cols-2 gap-2">
      <button type="button" id="btn-copy-pix-code" class="rounded-2xl bg-slate-900 px-4 py-3 text-sm font-black text-white hover:bg-slate-800">Copiar código Pix</button>
      <button type="button" id="btn-check-pix-payment" data-checkout-id="${escapeHtml(checkoutId)}" class="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-black text-emerald-700 hover:bg-emerald-100">Já paguei / verificar</button>
    </div>

    <p id="pix-payment-status" class="rounded-2xl border border-gray-100 bg-gray-50 p-3 text-xs font-bold text-gray-500">Aguardando confirmação automática do Mercado Pago...</p>
  `;

  qs('btn-copy-pix-code')?.addEventListener('click', copyPixCode);
  qs('btn-check-pix-payment')?.addEventListener('click', () => checkPixPaymentStatus(checkoutId, true));
  initIcons();
}

async function copyPixCode() {
  const code = String(qs('pix-copy-code')?.value || '').trim();
  if (!code) {
    localToast('error', 'Código Pix indisponível.');
    return;
  }

  try {
    await navigator.clipboard.writeText(code);
    localToast('success', 'Código Pix copiado.');
  } catch (_) {
    qs('pix-copy-code')?.select();
    localToast('info', 'Copie o código manualmente.');
  }
}

function startPaymentPolling(checkoutId) {
  if (activePaymentPoll) {
    clearInterval(activePaymentPoll);
    activePaymentPoll = null;
  }

  if (!checkoutId) return;

  let attempts = 0;
  activePaymentPoll = setInterval(() => {
    attempts += 1;
    checkPixPaymentStatus(checkoutId, false);
    if (attempts >= 45) {
      clearInterval(activePaymentPoll);
      activePaymentPoll = null;
    }
  }, 4000);
}

async function checkPixPaymentStatus(checkoutId, manual = false) {
  const cleanCheckoutId = String(checkoutId || '').trim();
  if (!cleanCheckoutId) return;

  const statusEl = qs('pix-payment-status');
  if (manual && statusEl) statusEl.textContent = 'Verificando pagamento...';

  try {
    const buyer = getLocalBuyerPayloadForPix();
    if (!buyer?.gameId) throw new Error('buyer-profile-local-required');

    const response = await fetch('/api/loja_mp_status', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ checkoutId: cleanCheckoutId, buyer })
    });
    const rawResponse = await response.text().catch(() => '');
    let data = {};
    try { data = rawResponse ? JSON.parse(rawResponse) : {}; } catch (_) { data = {}; }

    if (!response.ok || data.ok === false) {
      if (!data.error && response.status === 404) throw new Error('api-not-found');
      throw new Error(data.message || data.error || 'payment-status-failed');
    }

    const status = String(data.status || data.paymentStatus || '').toLowerCase();

    if (status === 'approved' || status === 'aprovado') {
      if (activePaymentPoll) {
        clearInterval(activePaymentPoll);
        activePaymentPoll = null;
      }
      if (statusEl) statusEl.textContent = `Pagamento aprovado. Pedido criado: ${data.orderId || '-'}`;
      localToast('success', 'Pagamento aprovado. Pedido criado.');
      await Promise.all([loadProducts(true), loadBuyerOrders({ reset: true })]);
      setTimeout(() => closeProductModal(), 1000);
      return;
    }

    if (status === 'approved_without_stock') {
      if (activePaymentPoll) {
        clearInterval(activePaymentPoll);
        activePaymentPoll = null;
      }
      if (statusEl) statusEl.textContent = 'Pagamento aprovado, mas o produto ficou sem estoque. Acione o suporte para resolver/reembolsar.';
      localToast('error', 'Pagamento aprovado, mas sem estoque. Acione o suporte.');
      return;
    }

    if (status === 'approved_price_changed') {
      if (activePaymentPoll) {
        clearInterval(activePaymentPoll);
        activePaymentPoll = null;
      }
      if (statusEl) statusEl.textContent = 'Pagamento aprovado, mas o valor do produto mudou antes da criação do pedido. Acione o suporte para analisar/reembolsar.';
      localToast('error', 'Pagamento aprovado com valor antigo. Acione o suporte.');
      await loadProducts(true);
      return;
    }

    if (statusEl) {
      statusEl.textContent = manual
        ? `Pagamento ainda não aprovado. Status: ${status || 'pendente'}`
        : `Aguardando confirmação automática. Status: ${status || 'pendente'}`;
    }
  } catch (err) {
    console.error(err);
    if (manual) localToast('error', 'Não foi possível verificar o pagamento agora.');
    if (statusEl && manual) statusEl.textContent = 'Não foi possível verificar agora. Tente novamente em alguns segundos.';
  }
}

function openSellerModal()
 {
  if (!mountLojaPanelInline(els.sellerModal, 'painel_vendedor')) {
    els.sellerModal?.classList.remove('hidden');
    els.sellerModal?.classList.add('flex');
  }
  initIcons();
}

function closeSellerModal() {
  if (isInlineLojaPage('painel_vendedor')) return;
  els.sellerModal?.classList.add('hidden');
  els.sellerModal?.classList.remove('flex');
}

function renderSellerProfileCard() {
  const seller = lojaStatus?.vendedor;
  if (!els.sellerProfileCard) return;
  if (!seller) { els.sellerProfileCard.innerHTML = '<p class="text-sm font-bold text-red-700">Perfil de vendedor não encontrado.</p>'; return; }
  const photo = seller.foto || ghubProfile?.foto || '';
  const finances = getSellerFinancialsForDisplay(seller, sellerOrders);
  const withdrawAvailable = isSupportAdmin ? finances.saldoTotalDisponivelAdmin : finances.saldoAtual;
  const canWithdraw = isSupportAdmin ? withdrawAvailable > 0 : withdrawAvailable >= SELLER_WITHDRAW_MIN;
  const defaultWithdrawValue = canWithdraw ? Number(withdrawAvailable || 0).toFixed(2) : '';

  els.sellerProfileCard.innerHTML = `
    <div class="flex items-start gap-3"><div class="h-14 w-14 shrink-0 overflow-hidden rounded-2xl bg-emerald-50 ring-1 ring-emerald-100 flex items-center justify-center text-emerald-700">${photo ? `<img src="${escapeHtml(photo)}" alt="" class="h-full w-full object-cover">` : '<i data-lucide="user" class="w-6 h-6"></i>'}</div><div class="min-w-0 flex-1"><div class="flex items-center gap-2 flex-wrap"><p class="font-black text-gray-900 truncate">${escapeHtml(seller.nome || seller.nick || 'Vendedor')}</p><span class="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-1 text-[11px] font-black text-emerald-700 ring-1 ring-emerald-200"><i data-lucide="badge-check" class="w-3.5 h-3.5"></i> VENDEDOR</span></div><p class="mt-1 text-xs font-semibold text-gray-400">ID: ${escapeHtml(seller.id || seller.gameId || ghubProfile?.gameId || '-')}</p><p class="mt-1 text-xs font-semibold text-gray-400 truncate">${escapeHtml(seller.email || currentUser?.email || '')}</p></div></div>
    <div class="mt-4 grid grid-cols-2 gap-2">
      <div class="rounded-2xl bg-white p-3 ring-1 ring-gray-100"><p class="text-[10px] font-black uppercase tracking-wider text-gray-400">Saldo disponível</p><p class="mt-1 text-lg font-black text-emerald-700">${moneyBRL(finances.saldoAtual)}</p><p class="mt-1 text-[10px] font-semibold text-gray-400">Liberado para saque</p></div>
      <div class="rounded-2xl bg-white p-3 ring-1 ring-gray-100"><p class="text-[10px] font-black uppercase tracking-wider text-gray-400">Saldo pendente</p><p class="mt-1 text-lg font-black text-amber-600">${moneyBRL(finances.saldoPendente)}</p><p class="mt-1 text-[10px] font-semibold text-gray-400">Aguardando liberação</p></div>
      <div class="rounded-2xl bg-white p-3 ring-1 ring-gray-100"><p class="text-[10px] font-black uppercase tracking-wider text-gray-400">Em saque</p><p class="mt-1 text-lg font-black text-sky-700">${moneyBRL(finances.saldoEmSaque)}</p><p class="mt-1 text-[10px] font-semibold text-gray-400">Solicitado e não pago</p></div>
      <div class="rounded-2xl bg-white p-3 ring-1 ring-gray-100"><p class="text-[10px] font-black uppercase tracking-wider text-gray-400">Total já sacado</p><p class="mt-1 text-lg font-black text-gray-900">${moneyBRL(finances.totalSacado)}</p><p class="mt-1 text-[10px] font-semibold text-gray-400">Pagamentos concluídos</p></div>
      <div class="col-span-2 rounded-2xl bg-gray-50 p-3 ring-1 ring-gray-100"><p class="text-[10px] font-black uppercase tracking-wider text-gray-400">Vendas entregues</p><p class="mt-1 text-lg font-black text-gray-900">${Number(finances.totalVendasEntregues || 0)}</p></div>
    </div>
    <div class="mt-3 rounded-2xl border border-amber-200 bg-amber-50 p-3 text-xs font-semibold leading-relaxed text-amber-800">Será cobrada taxa de ${SELLER_FEE_PERCENT}% por venda. O saldo só é liberado ${SELLER_RELEASE_DAYS} dias após o pedido ser marcado como entregue. Saque mínimo: R$ 20,00.</div>
    <div class="mt-3 rounded-2xl border border-gray-200 bg-white p-3 space-y-2">
      <label for="seller-withdraw-pix" class="block text-xs font-black uppercase tracking-wider text-gray-400">Pix para saque</label>
      <input id="seller-withdraw-pix" type="text" value="${escapeHtml(seller.ultimoPixSaque || '')}" placeholder="Chave Pix" class="w-full rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-sm font-semibold outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100">
      <label for="seller-withdraw-amount" class="block text-xs font-black uppercase tracking-wider text-gray-400">Valor do saque</label>
      <input id="seller-withdraw-amount" type="number" min="0" step="0.01" max="${Number(withdrawAvailable || 0).toFixed(2)}" value="${escapeHtml(defaultWithdrawValue)}" placeholder="0,00" class="w-full rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-sm font-semibold outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100">
      <p class="text-[11px] font-semibold text-gray-500">Disponível para saque agora: <b>${moneyBRL(withdrawAvailable)}</b></p>
      <button id="btn-seller-withdraw" type="button" class="w-full rounded-xl px-3 py-2 text-xs font-black ${canWithdraw ? 'bg-emerald-600 text-white hover:bg-emerald-700' : 'bg-gray-100 text-gray-400 cursor-not-allowed'}" ${canWithdraw ? '' : 'disabled'}>Solicitar saque</button>
    </div>
    <div class="mt-3 rounded-2xl border border-red-200 bg-red-50 p-3 text-xs font-semibold leading-relaxed text-red-800"><p class="font-black">Excluir conta de vendedor</p><p class="mt-1">A exclusão é irreversível. Todos os produtos, pedidos vinculados, chats abertos e qualquer saldo atual, pendente ou em saque serão excluídos.</p><button id="btn-delete-own-seller" type="button" class="mt-3 w-full rounded-xl bg-red-600 px-3 py-2 text-xs font-black text-white hover:bg-red-700">Excluir minha conta de vendedor</button></div>`;
  qs('btn-seller-withdraw')?.addEventListener('click', requestSellerWithdraw);
  qs('btn-delete-own-seller')?.addEventListener('click', deleteOwnSellerAccount);
  initIcons();
}

async function loadSellerProducts(force = false) {
  const sellerId = ghubProfile?.gameId;
  if (!sellerId) return;
  const cacheKey = String(sellerId);
  const cached = !force ? lojaCacheGet('sellerProducts', LOJA_CACHE_TTL.SELLER_PRODUCTS, cacheKey) : null;
  if (Array.isArray(cached)) {
    sellerProducts = cached;
    renderSellerProducts();
    return;
  }
  try {
    const snap = await getDocs(query(collection(lojaDb, 'produtos'), where('sellerId', '==', String(sellerId))));
    sellerProducts = snap.docs.map(normalizeProduct).sort((a, b) => a.titulo.localeCompare(b.titulo));
    lojaCacheSet('sellerProducts', sellerProducts, cacheKey);
  } catch (err) {
    console.error('Erro ao carregar produtos do vendedor:', err?.code || err?.message || err, err);
    sellerProducts = [];
    localToast('error', `Não foi possível carregar seus produtos. Erro: ${err?.code || err?.message || 'verifique as regras/índices'}`);
  }
  renderSellerProducts();
}

async function loadSellerOrders(options = {}) {
  const { reset = false, page = null, force = false, silent = false } = options || {};
  const sellerId = ghubProfile?.gameId;
  if (!sellerId) { sellerOrders = []; resetSellerOrdersPagination(); renderSellerOrders(); return; }
  if (sellerOrdersLoading) return;
  sellerOrdersLoading = true;
  if (reset) resetSellerOrdersPagination();
  const targetPage = Math.max(1, Number(page || sellerOrdersPage || 1));
  const ordersCacheKey = `${sellerId}:page:${targetPage}`;
  const cachedOrders = !force ? lojaCacheGet('sellerOrders', LOJA_CACHE_TTL.SELLER_ORDERS, ordersCacheKey) : null;
  if (cachedOrders && Array.isArray(cachedOrders.orders)) {
    sellerOrders = cachedOrders.orders;
    sellerOrdersHasNextPage = !!cachedOrders.hasNextPage;
    sellerOrdersPage = Number(cachedOrders.page || targetPage) || targetPage;
    renderSellerOrders();
    renderSellerSupportChats();
    renderSellerProfileCard();
    markSellerOrdersSeenIfOpen();
    updateNotificationBadges();
    sellerOrdersLoading = false;
    return;
  }

  if (!silent && els.sellerOrdersList) els.sellerOrdersList.innerHTML = '<div class="rounded-2xl border border-gray-100 bg-gray-50 p-4 text-sm font-semibold text-gray-500 text-center">Carregando pedidos...</div>';

  try {
    const cursor = sellerOrderPageCursors[targetPage - 1] || null;
    const base = [where('sellerId', '==', String(sellerId))];
    const sellerQuery = cursor
      ? query(collection(lojaDb, 'pedidos'), ...base, startAfter(cursor), limit(ORDERS_PAGE_SIZE + 1))
      : query(collection(lojaDb, 'pedidos'), ...base, limit(ORDERS_PAGE_SIZE + 1));
    const snap = await getDocs(sellerQuery);
    const docs = snap.docs;
    const pageDocs = docs.slice(0, ORDERS_PAGE_SIZE);
    sellerOrdersHasNextPage = docs.length > ORDERS_PAGE_SIZE;
    sellerOrdersPage = targetPage;
    if (pageDocs.length) sellerOrderPageCursors[targetPage] = pageDocs[pageDocs.length - 1];
    sellerOrders = pageDocs
      .map((d) => ({ id: d.id, ...d.data() }))
      .sort((a, b) => Number(b?.createdAtMs || b?.createdAt?.seconds || 0) - Number(a?.createdAtMs || a?.createdAt?.seconds || 0));
    lojaCacheSet('sellerOrders', { orders: sellerOrders, hasNextPage: sellerOrdersHasNextPage, page: sellerOrdersPage }, ordersCacheKey);
  } catch (err) {
    console.error('Erro ao carregar pedidos do vendedor:', err?.code || err?.message || err, err);
    sellerOrders = [];
    localToast('error', `Não foi possível carregar seus pedidos. Erro: ${err?.code || err?.message || 'verifique as regras'}`);
  } finally {
    sellerOrdersLoading = false;
  }
  renderSellerOrders();
  renderSellerSupportChats();
  renderSellerProfileCard();
  markSellerOrdersSeenIfOpen();
  updateNotificationBadges();
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
        <div class="mt-3 grid grid-cols-2 sm:grid-cols-3 gap-2">
          <button type="button" data-edit-product="${escapeHtml(product.id)}" class="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-black text-emerald-700 hover:bg-emerald-100">
            Editar
          </button>
          <button type="button" data-toggle-product="${escapeHtml(product.id)}" data-next-active="${product.ativo ? 'false' : 'true'}" class="rounded-xl border border-gray-200 bg-white px-3 py-2 text-xs font-black text-gray-600 hover:bg-gray-50">
            ${product.ativo ? 'Pausar' : 'Ativar'}
          </button>
          <button type="button" data-delete-seller-product="${escapeHtml(product.id)}" class="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs font-black text-red-700 hover:bg-red-100">
            Excluir
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

  els.sellerProductsList.querySelectorAll('[data-delete-seller-product]').forEach((btn) => {
    btn.addEventListener('click', () => deleteSellerProduct(btn.getAttribute('data-delete-seller-product') || ''));
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
  if (s === 'reembolso_solicitado') return 'bg-amber-50 text-amber-800 ring-amber-200';
  if (s === 'pago' || s === 'em_entrega') return 'bg-sky-50 text-sky-700 ring-sky-200';
  return 'bg-amber-50 text-amber-700 ring-amber-200';
}

function renderSellerSupportChats() {
  const supportSellerChats = sellerChats.filter((chat) => String(chat.tipo || '') === CHAT_TYPE_SUPPORT && !isChatExpired(chat) && !isChatClosed(chat));
  if (els.sellerSupportChatsCounter) els.sellerSupportChatsCounter.textContent = supportSellerChats.length === 1 ? '1 chat de suporte' : `${supportSellerChats.length} chats de suporte`;
  if (!els.sellerSupportChatsList) return;
  if (!supportSellerChats.length) { els.sellerSupportChatsList.innerHTML = '<div class="rounded-2xl border border-dashed border-sky-200 bg-white/70 p-4 text-sm font-semibold text-sky-700 text-center">Nenhum chat aberto pelo suporte.</div>'; return; }
  els.sellerSupportChatsList.innerHTML = supportSellerChats.map((chat) => `<div class="rounded-2xl border border-sky-100 bg-white p-3"><div class="flex items-start justify-between gap-3"><div class="min-w-0"><p class="font-black text-sm text-gray-900 truncate">Chat aberto pelo suporte</p><p class="mt-1 text-xs font-bold text-sky-700">${escapeHtml(chat.assunto || chat.produtoTitulo || 'Suporte GuildaHub')}</p><p class="mt-1 text-xs font-semibold text-gray-600">${escapeHtml(getChatRemainingLabel(chat))}</p></div><span class="rounded-full bg-sky-50 px-2.5 py-1 text-[10px] font-black text-sky-700 ring-1 ring-sky-200">SUPORTE</span></div><button type="button" data-open-seller-support-chat="${escapeHtml(chat.id)}" class="mt-3 rounded-xl bg-sky-600 px-3 py-2 text-xs font-black text-white hover:bg-sky-700">Abrir chat com suporte</button></div>`).join('');
  els.sellerSupportChatsList.querySelectorAll('[data-open-seller-support-chat]').forEach((btn) => btn.addEventListener('click', () => openChatById(btn.getAttribute('data-open-seller-support-chat') || '')));
  initIcons();
  updateNotificationBadges();
}

function renderSellerOrders() {
  if (els.sellerOrdersCounter) els.sellerOrdersCounter.textContent = `${sellerOrders.length} pedido${sellerOrders.length === 1 ? '' : 's'} nesta página • Página ${sellerOrdersPage}`;
  if (!els.sellerOrdersList) return;
  if (!sellerOrders.length) { els.sellerOrdersList.innerHTML = '<div class="rounded-2xl border border-dashed border-gray-200 bg-gray-50 p-4 text-sm font-semibold text-gray-500 text-center">Nenhum pedido recebido ainda.</div>'; return; }
  els.sellerOrdersList.innerHTML = sellerOrders.map((order) => {
    const status = String(order.status || 'pendente').toLowerCase();
    const refundRequested = status === 'reembolso_solicitado' || order.reembolsoSolicitado === true;
    const locked = isFinalOrderStatus(status) || order.finalizado === true || refundRequested;
    const created = formatDateTimeBR(order.createdAtMs || order.createdAt);
    const sellerChat = getSellerChatForOrder(order.id);
    const chatExpired = sellerChat && isChatExpired(sellerChat);
    const canOpenChat = sellerChat && !chatExpired && !isChatClosed(sellerChat);
    const chatHtml = sellerChat ? `<div class="mt-3 rounded-xl border ${canOpenChat ? 'border-emerald-200 bg-emerald-50' : 'border-gray-200 bg-gray-50'} p-3"><p class="text-[10px] font-black uppercase tracking-wider ${canOpenChat ? 'text-emerald-800' : 'text-gray-600'}">Chat temporário do pedido</p><p class="mt-1 text-xs font-semibold ${canOpenChat ? 'text-emerald-900' : 'text-gray-700'}">Status: ${escapeHtml(chatExpired ? 'expirado' : (sellerChat.status || 'ativo'))} • ${escapeHtml(getChatRemainingLabel(sellerChat))}</p>${canOpenChat ? `<button type="button" data-open-seller-chat="${escapeHtml(order.id)}" class="mt-2 rounded-xl bg-emerald-600 px-3 py-2 text-xs font-black text-white hover:bg-emerald-700">Abrir chat com comprador</button>` : ''}</div>` : `<div class="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3"><p class="text-[10px] font-black uppercase tracking-wider text-amber-800">Chat ainda não iniciado</p><p class="mt-1 text-xs font-semibold text-amber-900">O chat será criado quando comprador ou vendedor enviar a primeira mensagem.</p><button type="button" data-open-seller-chat="${escapeHtml(order.id)}" class="mt-2 rounded-xl bg-emerald-600 px-3 py-2 text-xs font-black text-white hover:bg-emerald-700">Enviar mensagem</button></div>`;
    return `<div class="rounded-2xl border border-gray-100 bg-gray-50 p-3"><div class="flex items-start justify-between gap-3"><div class="min-w-0"><p class="font-black text-sm text-gray-900 truncate">${escapeHtml(order.produtoTitulo || 'Produto')}</p><p class="mt-1 text-xs font-bold text-gray-400">Pedido: ${escapeHtml(order.id)}</p><p class="mt-1 text-xs font-semibold text-gray-500">Comprador: ${escapeHtml(order.buyerName || order.buyerNick || '-')}</p><p class="mt-1 text-xs font-semibold text-gray-500">ID comprador: ${escapeHtml(order.buyerId || '-')}</p><p class="mt-1 text-xs font-semibold text-gray-500">Data: ${escapeHtml(created)}</p></div><span class="shrink-0 rounded-full px-2.5 py-1 text-[10px] font-black ring-1 ${getOrderStatusClass(status)}">${escapeHtml(status.toUpperCase())}</span></div>${chatHtml}<div class="mt-3 flex items-center justify-between gap-3"><p class="text-base font-black text-emerald-700">${moneyBRL(order.total || order.precoUnitario || 0)}</p><div class="flex flex-wrap justify-end gap-2">${locked ? `<span class="rounded-xl bg-gray-100 px-3 py-2 text-xs font-black text-gray-500">${refundRequested ? 'Reembolso solicitado' : 'Finalizado'}</span>` : `<button type="button" data-order-action="entregue" data-order-id="${escapeHtml(order.id)}" class="rounded-xl bg-emerald-600 px-3 py-2 text-xs font-black text-white hover:bg-emerald-700">Entregue</button><button type="button" data-order-action="reembolso_solicitado" data-order-id="${escapeHtml(order.id)}" class="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs font-black text-red-700 hover:bg-red-100">Solicitar reembolso</button>`}</div></div></div>`;
  }).join('') + `
    <div class="mt-3 rounded-2xl border border-gray-100 bg-white p-3">
      <div class="flex items-center justify-between gap-3">
        <button type="button" data-seller-orders-page="prev" class="rounded-xl border border-gray-200 bg-white px-3 py-2 text-xs font-black text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-40" ${sellerOrdersPage <= 1 ? 'disabled' : ''}>Voltar</button>
        <span class="text-xs font-black text-gray-500">Página atual: ${sellerOrdersPage}</span>
        <button type="button" data-seller-orders-page="next" class="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-black text-emerald-700 hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-40" ${sellerOrdersHasNextPage ? '' : 'disabled'}>Próxima</button>
      </div>
    </div>`;
  els.sellerOrdersList.querySelectorAll('[data-seller-orders-page]').forEach((btn) => btn.addEventListener('click', () => {
    const dir = btn.getAttribute('data-seller-orders-page') || '';
    if (dir === 'prev' && sellerOrdersPage > 1) loadSellerOrders({ page: sellerOrdersPage - 1, force: true });
    if (dir === 'next' && sellerOrdersHasNextPage) loadSellerOrders({ page: sellerOrdersPage + 1, force: true });
  }));
  els.sellerOrdersList.querySelectorAll('[data-order-action]').forEach((btn) => btn.addEventListener('click', () => updateOrderStatus(btn.getAttribute('data-order-id') || '', btn.getAttribute('data-order-action') || '')));
  els.sellerOrdersList.querySelectorAll('[data-open-seller-chat]').forEach((btn) => btn.addEventListener('click', () => openProblemModal(btn.getAttribute('data-open-seller-chat') || '', CHAT_TYPE_SELLER)));
  initIcons();
  updateNotificationBadges();
}

async function openSellerPanel() {
  setMobileCollapsibleState(els.sellerForm, els.toggleSellerFormBtn, false, 'Fechar cadastro de produto', 'Abrir/editar cadastro de produto');
  setMobileCollapsibleState(els.sellerProductsCard, els.toggleSellerProductsBtn, false, 'Fechar meus produtos', 'Abrir/editar meus produtos');
  if (!lojaStatus?.vendedor) {
    const seller = await createOrUpdateSellerProfile();
    if (!seller) return;
  }

  await loadStoreStatus(true);
  if (!lojaStatus?.vendedor) {
    openVerificationModal(sellerVerification);
    return;
  }
  const freshSeller = await assertCurrentSellerFreshApproved();
  if (!freshSeller) {
    openVerificationModal(sellerVerification);
    return;
  }
  openSellerModal();
  renderSellerProfileCard();
  await reloadSellerPanelData();
  markSellerOrdersSeenIfOpen();
  updateNotificationBadges();
}

async function reloadSellerPanelData(force = false) {
  if (!lojaStatus?.vendedor || loadingSellerPanel) return;
  loadingSellerPanel = true;

  if (force && els.sellerProductsList) els.sellerProductsList.innerHTML = '<div class="rounded-2xl border border-gray-100 bg-gray-50 p-4 text-sm font-semibold text-gray-500 text-center">Carregando produtos...</div>';
  if (force && els.sellerOrdersList) els.sellerOrdersList.innerHTML = '<div class="rounded-2xl border border-gray-100 bg-gray-50 p-4 text-sm font-semibold text-gray-500 text-center">Carregando pedidos...</div>';
  if (force && els.sellerSupportChatsList) els.sellerSupportChatsList.innerHTML = '<div class="rounded-2xl border border-sky-100 bg-white p-4 text-sm font-semibold text-sky-700 text-center">Carregando chats de suporte...</div>';

  try {
    await Promise.all([loadSellerProducts(force), loadSellerOrders({ reset: true, force }), loadSellerChats(force)]);
    renderSellerOrders();
    renderSellerSupportChats();
    markSellerOrdersSeenIfOpen();
    updateNotificationBadges();
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

  const freshSeller = await assertCurrentSellerFreshApproved();
  if (!freshSeller) return;

  const title = String(els.sellerTitle?.value || '').trim();
  const price = Number(els.sellerPrice?.value || 0);
  const stock = Math.max(0, Math.floor(Number(els.sellerStock?.value || 0)));
  const categoryId = String(els.sellerCategory?.value || '').trim();
  const categoryName = getCategoryName(categoryId);
  const imageFromUrl = String(els.sellerImage?.value || '').trim();
  const image = selectedProductImageBase64 || imageFromUrl;
  const rawDescription = String(els.sellerDescription?.value || '').trim();
  if (rawDescription.length > 150) { localToast('error', 'A descrição do produto pode ter no máximo 150 caracteres.'); els.sellerDescription?.focus(); return; }
  const description = rawDescription;
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
    const seller = freshSeller || lojaStatus.vendedor;
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
      updatedAt: serverTimestamp(),
      updatedAtMs: Date.now()
    };

    if (editingProductId) {
      const existing = sellerProducts.find((item) => String(item.id) === String(editingProductId));
      if (existing && String(existing.sellerId) !== String(ghubProfile.gameId)) {
        throw new Error('Produto não pertence ao vendedor.');
      }

      const rankFields = buildProductRankFields({ ...existing, ...basePayload }, {
        sellerSalesOverride: getSellerSalesFromData(seller),
        productSalesOverride: Number(existing?.totalVendasEntregues ?? existing?.totalVendas ?? 0)
      });
      await setDoc(doc(lojaDb, 'produtos', editingProductId), { ...basePayload, ...rankFields }, { merge: true });
      lojaCacheRemove('sellerProducts', String(ghubProfile.gameId));
      lojaCacheRemove('products', 'global');
      localToast('success', 'Produto atualizado.');
    } else {
      const nowMs = Date.now();
      const payload = {
        ...basePayload,
        visualizacoes: 0,
        totalVendas: 0,
        totalVendasEntregues: 0,
        createdAt: serverTimestamp(),
        createdAtMs: nowMs,
        updatedAtMs: nowMs,
        ...buildProductRankFields({ ...basePayload, totalVendas: 0, totalVendasEntregues: 0, createdAtMs: nowMs, updatedAtMs: nowMs }, {
          sellerSalesOverride: getSellerSalesFromData(seller),
          productSalesOverride: 0,
          nowMs
        })
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
    await Promise.all([loadProducts(true), loadSellerProducts(false)]);
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

    const nowMs = Date.now();
    const nextProduct = { ...(product || {}), ativo: !!nextActive, updatedAtMs: nowMs };
    await setDoc(doc(lojaDb, 'produtos', productId), {
      ativo: !!nextActive,
      updatedAt: serverTimestamp(),
      updatedAtMs: nowMs,
      ...buildProductRankFields(nextProduct, {
        sellerSalesOverride: getSellerSalesFromData(lojaStatus?.vendedor || {}),
        nowMs
      })
    }, { merge: true });
    lojaCacheRemove('sellerProducts', String(ghubProfile.gameId));
    lojaCacheRemove('products', 'global');

    localToast('success', nextActive ? 'Produto ativado.' : 'Produto pausado.');
    await Promise.all([loadProducts(true), loadSellerProducts(false)]);
  } catch (err) {
    console.error(err);
    localToast('error', 'Não foi possível atualizar o produto.');
  }
}

async function deleteSellerProduct(productId) {
  if (!productId || !ghubProfile?.gameId) return;

  const product = sellerProducts.find((item) => String(item.id) === String(productId));
  if (!product) {
    localToast('error', 'Produto não encontrado no seu painel.');
    return;
  }

  if (String(product.sellerId || '') !== String(ghubProfile.gameId)) {
    localToast('error', 'Esse produto não pertence ao seu vendedor.');
    return;
  }

  const confirmed = await confirmTypedDelete({
    title: 'Excluir produto',
    message: `Essa ação vai remover definitivamente o produto "${product.titulo || product.id}" da loja. Isso não apaga pedidos já existentes.`
  });
  if (!confirmed) return;

  try {
    await deleteDoc(doc(lojaDb, 'produtos', productId));

    if (editingProductId && String(editingProductId) === String(productId)) {
      resetSellerProductForm();
    }

    await setDoc(doc(lojaDb, 'vendedor', ghubProfile.gameId), {
      totalProdutos: Math.max(0, sellerProducts.length - 1),
      updatedAt: serverTimestamp()
    }, { merge: true });

    lojaCacheRemove('sellerProducts', String(ghubProfile.gameId));
    lojaCacheRemove('products', 'global');
    localToast('success', 'Produto excluído.');
    await Promise.all([loadProducts(true), loadSellerProducts(false)]);
  } catch (err) {
    console.error(err);
    localToast('error', 'Não foi possível excluir o produto.');
  }
}

async function updateOrderStatus(orderId, action) {
  if (!orderId || !action) return;
  const order = sellerOrders.find((item) => String(item.id) === String(orderId));
  if (!order) return;
  if (String(order.sellerId) !== String(ghubProfile?.gameId || '')) { localToast('error', 'Esse pedido não pertence ao seu vendedor.'); return; }
  const currentStatus = String(order.status || '').toLowerCase();
  if (currentStatus === 'reembolso_solicitado' || order.reembolsoSolicitado === true) { localToast('error', 'Esse pedido já tem reembolso solicitado e aguarda o suporte.'); return; }
  if (isFinalOrderStatus(order.status) || order.finalizado === true) { localToast('error', 'Esse pedido já foi finalizado e não pode ser alterado.'); return; }

  if (action === 'reembolso_solicitado') {
    const motivo = await openCustomTextModal({
      title: 'Solicitar reembolso',
      message: `Essa ação não finaliza o pedido. Ela envia uma solicitação para o painel do suporte analisar e marcar como reembolsado. Pedido: ${orderId}`,
      placeholder: 'Explique o motivo do reembolso para o suporte.',
      confirmLabel: 'Solicitar reembolso',
      cancelLabel: 'Cancelar',
      textarea: true,
      danger: true
    });
    if (motivo === null) return;

    const nowMs = Date.now();
    try {
      await setDoc(doc(lojaDb, 'pedidos', orderId), {
        status: 'reembolso_solicitado',
        finalizado: false,
        reembolsoSolicitado: true,
        reembolsoStatus: 'pendente',
        statusAntesReembolso: currentStatus || 'pago',
        finalizadoAntesReembolso: order.finalizado === true,
        pagamentoStatusAntesReembolso: String(order?.pagamento?.status || '').trim(),
        entregaStatusAntesReembolso: String(order?.entrega?.status || '').trim(),
        reembolsoMotivo: String(motivo || '').trim() || 'Solicitado pelo vendedor.',
        reembolsoSolicitadoPor: ghubProfile?.gameId || currentUser?.uid || '',
        reembolsoSolicitadoPorNome: lojaStatus?.vendedor?.nome || lojaStatus?.vendedor?.nick || ghubProfile?.nick || '',
        reembolsoSolicitadoEm: serverTimestamp(),
        reembolsoSolicitadoEmMs: nowMs,
        pagamento: { ...(order?.pagamento || {}), status: 'reembolso_solicitado' },
        entrega: { ...(order?.entrega || {}), status: 'reembolso_solicitado' },
        updatedAt: serverTimestamp()
      }, { merge: true });

      localToast('success', 'Solicitação de reembolso enviada para o suporte.');
      await Promise.all([loadSellerOrders({ reset: true }), loadBuyerOrders({ reset: true }), isSupportAdmin ? loadSupportRefundRequests() : Promise.resolve()]);
    } catch (err) {
      console.error(err);
      localToast('error', 'Não foi possível solicitar o reembolso.');
    }
    return;
  }

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
    updates.reembolsoSolicitado = false;
    updates.reembolsoStatus = 'reembolsado';
    updates.pagamento = { ...(order?.pagamento || {}), status: 'reembolsado', reembolsadoEm: serverTimestamp(), reembolsadoEmMs: nowMs };
    updates.entrega = { ...(order?.entrega || {}), status: 'reembolso_emitido' };
  }
  try {
    await setDoc(doc(lojaDb, 'pedidos', orderId), updates, { merge: true });
    if (action === 'entregue' && order.produtoId) {
      await recalcProductDeliveredSales(order.produtoId);
    }
    if (order.sellerId) {
      await recalcSellerFinancialsById(order.sellerId);
      if (String(order.sellerId) === String(ghubProfile?.gameId || '')) await loadStoreStatus(true);
    }
    localToast('success', action === 'reembolsado' ? 'Pedido marcado como reembolsado.' : 'Pedido marcado como entregue.');
    await Promise.all([loadSellerOrders({ reset: true }), loadProducts(true), loadSellerProducts(false), loadBuyerOrders({ reset: true })]);
  } catch (err) { console.error(err); localToast('error', 'Não foi possível atualizar o pedido.'); }
}

async function requestSellerWithdraw() {
  if (!lojaStatus?.vendedor || !ghubProfile?.gameId) return;
  const finances = getSellerFinancialsForDisplay(lojaStatus.vendedor, sellerOrders);
  const withdrawAvailable = isSupportAdmin ? finances.saldoTotalDisponivelAdmin : finances.saldoAtual;
  const pix = String(qs('seller-withdraw-pix')?.value || '').trim();
  const amountRaw = String(qs('seller-withdraw-amount')?.value || '').replace(',', '.');
  const amount = Number(amountRaw);

  if (!pix) { localToast('error', 'Informe sua chave Pix para solicitar o saque.'); qs('seller-withdraw-pix')?.focus(); return; }
  if (!Number.isFinite(amount) || amount <= 0) { localToast('error', 'Informe um valor de saque válido.'); qs('seller-withdraw-amount')?.focus(); return; }
  if (!isSupportAdmin && amount < SELLER_WITHDRAW_MIN) { localToast('error', 'O valor mínimo para saque é R$ 20,00.'); qs('seller-withdraw-amount')?.focus(); return; }
  if (amount > withdrawAvailable + 0.0001) { localToast('error', `O valor solicitado não pode passar do saldo disponível: ${moneyBRL(withdrawAvailable)}.`); qs('seller-withdraw-amount')?.focus(); return; }

  const previousPending = Number(lojaStatus.vendedor?.saquePendente ?? lojaStatus.vendedor?.saldoEmSaque ?? lojaStatus.vendedor?.financeiro?.saldoEmSaque ?? 0);
  const nextPending = previousPending + amount;
  try {
    await addDoc(collection(lojaDb, WITHDRAW_COLLECTION), {
      sellerId: ghubProfile.gameId,
      sellerName: lojaStatus.vendedor.nome || lojaStatus.vendedor.nick || ghubProfile.nick || '',
      sellerEmail: normalizeEmail(currentUser?.email || ghubProfile.email || ''),
      pix,
      valor: amount,
      status: 'pendente',
      adminSolicitante: isSupportAdmin === true,
      createdAt: serverTimestamp(),
      createdAtMs: Date.now(),
      updatedAt: serverTimestamp()
    });
    const updatedFinance = {
      ...(lojaStatus.vendedor?.financeiro || {}),
      saldoEmSaque: nextPending
    };
    await setDoc(doc(lojaDb, 'vendedor', ghubProfile.gameId), {
      saquePendente: nextPending,
      saldoEmSaque: nextPending,
      ultimoPixSaque: pix,
      financeiro: updatedFinance,
      updatedAt: serverTimestamp()
    }, { merge: true });
    lojaStatus.vendedor = { ...lojaStatus.vendedor, saquePendente: nextPending, saldoEmSaque: nextPending, ultimoPixSaque: pix, financeiro: updatedFinance };
    localToast('success', 'Solicitação de saque enviada.');
    await loadStoreStatus(true);
    await loadSellerOrders({ reset: true });
  } catch (err) { console.error(err); localToast('error', 'Não foi possível solicitar o saque. Confira as regras do Firebase.'); }
}

async function deleteDocsByField(collectionName, fieldName, value) {
  const cleanValue = String(value || '').trim();
  if (!cleanValue) return 0;
  const snap = await getDocs(query(collection(lojaDb, collectionName), where(fieldName, '==', cleanValue)));
  await Promise.all(snap.docs.map((d) => deleteDoc(doc(lojaDb, collectionName, d.id))));
  return snap.size;
}

async function deleteProductsBySellerId(sellerId) {
  return deleteDocsByField('produtos', 'sellerId', sellerId);
}

async function deleteOrdersBySellerId(sellerId) {
  return deleteDocsByField('pedidos', 'sellerId', sellerId);
}

async function deleteChatsBySellerId(sellerId) {
  return deleteDocsByField(CHAT_COLLECTION, 'sellerId', sellerId);
}

async function deleteWithdrawalsBySellerId(sellerId) {
  return deleteDocsByField(WITHDRAW_COLLECTION, 'sellerId', sellerId);
}

async function deleteSellerAccountAndProducts(sellerId, { bySupport = false } = {}) {
  const cleanSellerId = String(sellerId || '').trim();
  if (!cleanSellerId) return;
  if (bySupport && !isSupportAdmin) return;

  const actor = ghubProfile?.gameId || currentUser?.uid || '';
  const nowMs = Date.now();

  await setDoc(doc(lojaDb, VERIFICATION_COLLECTION, cleanSellerId), {
    status: 'revogado',
    revogado: true,
    vendedorExcluido: true,
    vendedorExcluidoEmMs: nowMs,
    vendedorExcluidoPor: actor,
    updatedAt: serverTimestamp()
  }, { merge: true });

  await setDoc(doc(lojaDb, 'vendedor', cleanSellerId), {
    status: 'excluido',
    ativo: false,
    verificado: false,
    excluido: true,
    excluidoEmMs: nowMs,
    excluidoPor: actor,
    updatedAt: serverTimestamp()
  }, { merge: true }).catch(() => null);

  await Promise.all([
    deleteProductsBySellerId(cleanSellerId),
    deleteOrdersBySellerId(cleanSellerId),
    deleteChatsBySellerId(cleanSellerId),
    deleteWithdrawalsBySellerId(cleanSellerId)
  ]);
  await deleteDoc(doc(lojaDb, 'vendedor', cleanSellerId));
  clearSellerLocalState(cleanSellerId);
  lojaCacheRemove('supportPanel', 'global');
}

async function deleteOwnSellerAccount() {
  if (!lojaStatus?.vendedor || !ghubProfile?.gameId) return;
  const finances = getSellerFinancialsForDisplay(lojaStatus.vendedor, sellerOrders);
  const confirmed = await confirmTypedDelete({
    title: 'Excluir conta de vendedor',
    message: `Essa ação é irreversível. Todos os produtos, pedidos vinculados, chats abertos e qualquer saldo atual, pendente ou em saque serão perdidos. Saldo atual: ${moneyBRL(finances.saldoAtual)}. Saldo pendente: ${moneyBRL(finances.saldoPendente)}. Em saque: ${moneyBRL(finances.saldoEmSaque)}.`
  });
  if (!confirmed) return;
  try {
    await deleteSellerAccountAndProducts(ghubProfile.gameId);
    lojaStatus.vendedor = null;
    lojaCacheRemove('sellerProducts', String(ghubProfile.gameId));
    sellerProducts = [];
    sellerOrders = [];
    sellerChats = [];
    supportWithdrawals = [];
    closeSellerModal();
    renderSellerTop();
    await loadProducts();
    localToast('success', 'Conta de vendedor, produtos, pedidos, chats e saques excluídos.');
  } catch (err) {
    console.error(err);
    localToast('error', 'Não foi possível excluir sua conta de vendedor.');
  }
}

function openBuyerModal() {
  if (!currentUser) { localToast('error', 'Entre na GuildaHub para ver suas compras.'); return; }
  if (!mountLojaPanelInline(els.buyerModal, 'compras')) {
    els.buyerModal?.classList.remove('hidden');
    els.buyerModal?.classList.add('flex');
  }
  initIcons();
  loadBuyerOrders({ reset: true }).then(() => {
    markBuyerOrdersSeenIfOpen();
    updateNotificationBadges();
  });
}

function closeBuyerModal() { if (isInlineLojaPage('compras')) return; els.buyerModal?.classList.add('hidden'); els.buyerModal?.classList.remove('flex'); updateNotificationBadges(); }



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
    updateNotificationBadges();
  } catch (err) {
    console.warn('Não foi possível carregar chats do comprador:', err);
    buyerProblems = [];
  }
}

async function loadSellerChats(force = false) {
  if (!currentUser || !ghubProfile?.gameId) {
    sellerChats = [];
    return;
  }
  const cacheKey = String(ghubProfile.gameId);
  const cached = !force ? lojaCacheGet('sellerChats', LOJA_CACHE_TTL.SELLER_CHATS, cacheKey) : null;
  if (Array.isArray(cached)) {
    sellerChats = cached;
    updateNotificationBadges();
    return;
  }
  try {
    const snap = await getDocs(query(collection(lojaDb, CHAT_COLLECTION), where('sellerId', '==', String(ghubProfile.gameId))));
    sellerChats = snap.docs.map(normalizeChatDoc);
    await markExpiredChatsIfNeeded(sellerChats);
    lojaCacheSet('sellerChats', sellerChats, cacheKey);
    updateNotificationBadges();
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

async function createOrGetChatForOrder(order, type = CHAT_TYPE_SELLER) {
  if (!order?.id) throw new Error('order-not-found');
  const id = getChatId(order.id, type);
  const ref = doc(lojaDb, CHAT_COLLECTION, id);
  const snap = await getDoc(ref);
  const now = Date.now();
  const expiresAtMs = now + (getChatDurationHours(type) * 60 * 60 * 1000);
  if (snap.exists()) {
    const existing = { id: snap.id, ...snap.data() };
    if (isChatExpired(existing) && String(existing.status || '') === 'ativo') { await closeAndDeleteChat(existing, 'expirado'); existing.status = 'expirado'; }
    return existing;
  }
  return buildDraftChat({ id, type, order, buyerId: order.buyerId || ghubProfile?.gameId || '', buyerUid: order.buyerUid || currentUser?.uid || '', buyerEmail: order.buyerEmail || normalizeEmail(currentUser?.email || ghubProfile?.email || ''), buyerName: order.buyerName || order.buyerNick || ghubProfile?.nick || '', sellerId: order.sellerId || '', sellerName: order.sellerName || '', subject: type === CHAT_TYPE_SUPPORT ? 'Chat com suporte' : 'Chat com vendedor', createdAtMs: now, expiresAtMs });
}


function getSystemChatText(type) {
  return type === CHAT_TYPE_SUPPORT
    ? 'Chat com o suporte preparado. Envie a primeira mensagem explicando com clareza o problema, o que aconteceu, IDs envolvidos, produto/pedido se tiver e qualquer detalhe importante para análise.'
    : 'Chat temporário preparado. Envie a primeira mensagem para abrir oficialmente o atendimento e combinar a entrega.';
}

function buildDraftChat({ id, type, order = {}, buyerId = '', buyerUid = '', buyerEmail = '', buyerName = '', sellerId = '', sellerName = '', subject = '', source = '', createdAtMs = Date.now(), expiresAtMs = Date.now() + (SUPPORT_CHAT_HOURS * 60 * 60 * 1000) }) {
  return {
    __draft: true,
    id,
    tipo: type,
    status: 'rascunho',
    orderId: order.id || '',
    pedidoId: order.id || '',
    buyerId,
    buyerUid,
    buyerEmail,
    buyerName,
    sellerId,
    sellerName,
    assunto: subject,
    source,
    produtoId: order.produtoId || '',
    produtoTitulo: order.produtoTitulo || subject || (type === CHAT_TYPE_SUPPORT ? 'Chat com suporte' : 'Chat com vendedor'),
    categoriaId: order.categoriaId || '',
    categoriaNome: order.categoriaNome || '',
    total: Number(order.total || order.precoUnitario || 0),
    mensagens: [],
    createdAtMs,
    expiresAtMs,
    orderSnapshot: {
      id: order.id || '', buyerId: order.buyerId || buyerId || '', sellerId: order.sellerId || sellerId || '', produtoId: order.produtoId || '', produtoTitulo: order.produtoTitulo || '', total: Number(order.total || order.precoUnitario || 0), status: order.status || '', buyerInfo: order.buyerInfo || '', deliveryInfo: order.deliveryInfo || order.entrega?.informacoes || '', createdAtMs: order.createdAtMs || null, entregueEmMs: order.entregueEmMs || order.entrega?.entregueEmMs || null
    }
  };
}

async function createChatFromDraft(draft, firstMessageText) {
  const now = Date.now();
  const type = String(draft.tipo || CHAT_TYPE_SUPPORT);
  const expiresAtMs = now + (getChatDurationHours(type) * 60 * 60 * 1000);
  const firstMsg = { autorId: ghubProfile?.gameId || '', autorUid: currentUser?.uid || '', autorNome: ghubProfile?.nick || currentUser?.email || 'Usuário', autorTipo: getCurrentChatSenderRole(draft), texto: firstMessageText, createdAtMs: now + 1 };
  const payload = { ...draft, status: 'ativo', mensagens: [{ autorId: 'sistema', autorTipo: 'sistema', autorNome: 'GuildaHub', texto: getSystemChatText(type), createdAtMs: now }, firstMsg], createdAt: serverTimestamp(), createdAtMs: now, expiresAt: new Date(expiresAtMs), expiresAtMs, lastMessageAtMs: firstMsg.createdAtMs, updatedAt: serverTimestamp() };
  delete payload.__draft;
  await setDoc(doc(lojaDb, CHAT_COLLECTION, String(payload.id)), payload, { merge: true });
  if (payload.orderId || payload.pedidoId) {
    const orderId = String(payload.orderId || payload.pedidoId);
    const orderPatch = type === CHAT_TYPE_SUPPORT ? { suporteAberto: true, suporteChatId: payload.id, suporteStatus: 'ativo', updatedAt: serverTimestamp() } : { chatVendedorAberto: true, chatVendedorId: payload.id, chatVendedorStatus: 'ativo', updatedAt: serverTimestamp() };
    await setDoc(doc(lojaDb, 'pedidos', orderId), orderPatch, { merge: true });
  }
  return payload;
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
  activeDraftChat = chat?.__draft ? chat : null;

  const typeLabel = getChatTypeLabel(activeProblemChatType);
  const draft = !!chat?.__draft;
  const expired = !draft && isChatExpired(chat);
  const closed = !draft && (isChatClosed(chat) || expired);
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
      : draft ? `O chat com ${typeLabel} ainda não foi aberto. Ele será criado somente após você enviar a primeira mensagem.` : `Chat com ${typeLabel} ativo. ${remaining ? remaining + '.' : ''}`;
  }

  renderChatMessages(chat);
  if (!draft) markChatSeen(chat);

  if (els.problemDescription) {
    els.problemDescription.value = '';
    els.problemDescription.disabled = closed;
    els.problemDescription.placeholder = closed ? 'Este chat foi encerrado.' : (draft ? 'Escreva a primeira mensagem para abrir o chat...' : 'Escreva sua mensagem...');
  }
  if (els.submitProblemBtn) {
    els.submitProblemBtn.disabled = closed;
    els.submitProblemBtn.textContent = closed ? 'Chat encerrado' : (draft ? 'Enviar e abrir chat' : 'Enviar mensagem');
  }

  if (els.resolveChatBtn) {
    const canEnd = !draft && !closed && (currentIsBuyer || currentIsSeller || currentIsSupport);
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
  activeDraftChat = null;
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
  setButtonLoading(els.submitProblemBtn, true, activeDraftChat ? 'Enviar e abrir chat' : 'Enviar mensagem');
  try {
    const snap = await getDoc(ref);
    if (!snap.exists() && activeDraftChat) {
      const createdChat = await createChatFromDraft(activeDraftChat, description);
      activeDraftChat = null;
      if (els.problemDescription) els.problemDescription.value = '';
      openChatModalWithChat({ id: createdChat.orderId || createdChat.pedidoId || createdChat.id, ...(createdChat.orderSnapshot || {}), produtoTitulo: createdChat.produtoTitulo, buyerId: createdChat.buyerId, buyerName: createdChat.buyerName, sellerId: createdChat.sellerId, sellerName: createdChat.sellerName, total: createdChat.total }, createdChat);
      localToast('success', 'Chat aberto e mensagem enviada.');
      await Promise.all([loadBuyerOrders(), loadSellerChats().then(() => { renderSellerOrders(); renderSellerSupportChats(); }), isSupportAdmin ? loadSupportPanelData({ force: true }) : Promise.resolve()]);
      return;
    }
    if (!snap.exists()) throw new Error('chat-not-found');
    const chat = { id: snap.id, ...snap.data() };
    if (isChatExpired(chat) || isChatClosed(chat)) {
      await setDoc(ref, { status: isChatExpired(chat) ? 'expirado' : (chat.status || 'fechado'), updatedAt: serverTimestamp() }, { merge: true });
      localToast('error', 'Esse chat já foi encerrado.');
      closeProblemModal();
      await Promise.all([loadBuyerOrders(), loadSellerChats().then(() => { renderSellerOrders(); renderSellerSupportChats(); })]);
      return;
    }
    const msg = { autorId: ghubProfile?.gameId || '', autorUid: currentUser?.uid || '', autorNome: ghubProfile?.nick || currentUser?.email || 'Usuário', autorTipo: getCurrentChatSenderRole(chat), texto: description, createdAtMs: Date.now() };
    const messages = Array.isArray(chat.mensagens) ? chat.mensagens : [];
    const nextChat = { ...chat, mensagens: [...messages, msg], lastMessageAtMs: msg.createdAtMs, updatedAt: serverTimestamp() };
    await setDoc(ref, nextChat, { merge: true });
    if (els.problemDescription) els.problemDescription.value = '';
    renderChatMessages(nextChat);
    markChatSeen(nextChat);
    localToast('success', 'Mensagem enviada.');
    await Promise.all([loadBuyerOrders(), loadSellerChats().then(() => { renderSellerOrders(); renderSellerSupportChats(); }), isSupportAdmin ? loadSupportPanelData({ force: true }) : Promise.resolve()]);
  } catch (err) {
    console.error(err);
    localToast('error', 'Não foi possível enviar a mensagem. Confira as regras do Firebase.');
  } finally {
    setButtonLoading(els.submitProblemBtn, false, activeDraftChat ? 'Enviar e abrir chat' : 'Enviar mensagem');
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
    await Promise.all([loadBuyerOrders(), loadSellerChats().then(() => { renderSellerOrders(); renderSellerSupportChats(); }), isSupportAdmin ? loadSupportPanelData({ force: true }) : Promise.resolve()]);
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

async function loadBuyerOrders(options = {}) {
  const { reset = false, page = null, force = false, silent = false } = options || {};
  if (!currentUser || !ghubProfile?.gameId) { buyerOrders = []; resetBuyerOrdersPagination(); renderBuyerOrders(); return; }
  if (buyerOrdersLoading) return;
  buyerOrdersLoading = true;
  if (reset) resetBuyerOrdersPagination();
  const targetPage = Math.max(1, Number(page || buyerOrdersPage || 1));
  const ordersCacheKey = `${ghubProfile.gameId}:page:${targetPage}`;
  const cachedOrders = !force ? lojaCacheGet('buyerOrders', LOJA_CACHE_TTL.BUYER_ORDERS, ordersCacheKey) : null;
  if (cachedOrders && Array.isArray(cachedOrders.orders)) {
    buyerOrders = cachedOrders.orders;
    buyerProblems = Array.isArray(cachedOrders.problems) ? cachedOrders.problems : buyerProblems;
    buyerRatings = Array.isArray(cachedOrders.ratings) ? cachedOrders.ratings : buyerRatings;
    buyerOrdersHasNextPage = !!cachedOrders.hasNextPage;
    buyerOrdersPage = Number(cachedOrders.page || targetPage) || targetPage;
    renderBuyerOrders();
    markBuyerOrdersSeenIfOpen();
    updateNotificationBadges();
    buyerOrdersLoading = false;
    return;
  }
  if (!silent && els.buyerOrdersList) els.buyerOrdersList.innerHTML = '<div class="rounded-2xl border border-gray-100 bg-gray-50 p-4 text-sm font-semibold text-gray-500 text-center">Carregando compras...</div>';
  try {
    const cursor = buyerOrderPageCursors[targetPage - 1] || null;
    const base = [where('buyerId', '==', String(ghubProfile.gameId))];
    const orderQuery = cursor
      ? query(collection(lojaDb, 'pedidos'), ...base, startAfter(cursor), limit(ORDERS_PAGE_SIZE + 1))
      : query(collection(lojaDb, 'pedidos'), ...base, limit(ORDERS_PAGE_SIZE + 1));
    const [ordersSnap] = await Promise.all([
      getDocs(orderQuery),
      loadBuyerProblems(),
      loadBuyerRatings()
    ]);
    const docs = ordersSnap.docs;
    const pageDocs = docs.slice(0, ORDERS_PAGE_SIZE);
    buyerOrdersHasNextPage = docs.length > ORDERS_PAGE_SIZE;
    buyerOrdersPage = targetPage;
    if (pageDocs.length) buyerOrderPageCursors[targetPage] = pageDocs[pageDocs.length - 1];
    buyerOrders = pageDocs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => Number(b?.createdAtMs || b?.createdAt?.seconds || 0) - Number(a?.createdAtMs || a?.createdAt?.seconds || 0));
    lojaCacheSet('buyerOrders', { orders: buyerOrders, problems: buyerProblems, ratings: buyerRatings, hasNextPage: buyerOrdersHasNextPage, page: buyerOrdersPage }, ordersCacheKey);
  } catch (err) {
    console.error('Erro ao carregar compras:', err?.code || err?.message || err, err);
    buyerOrders = [];
    buyerProblems = [];
    localToast('error', `Não foi possível carregar suas compras. Erro: ${err?.code || err?.message || 'verifique as regras/índices'}`);
  } finally {
    buyerOrdersLoading = false;
  }
  renderBuyerOrders();
  markBuyerOrdersSeenIfOpen();
  updateNotificationBadges();
}

function renderBuyerOrders() {
  if (els.buyerOrdersCounter) els.buyerOrdersCounter.textContent = `${buyerOrders.length} compra${buyerOrders.length === 1 ? '' : 's'} nesta página • Página ${buyerOrdersPage}`;
  if (!els.buyerOrdersList) return;
  if (!currentUser) { els.buyerOrdersList.innerHTML = '<div class="rounded-2xl border border-dashed border-gray-200 bg-gray-50 p-5 text-center text-sm font-semibold text-gray-500">Entre na GuildaHub para ver suas compras.</div>'; return; }
  if (!buyerOrders.length) { els.buyerOrdersList.innerHTML = '<div class="rounded-2xl border border-dashed border-gray-200 bg-gray-50 p-5 text-center text-sm font-semibold text-gray-500">Nenhuma compra encontrada ainda.</div>'; return; }

  const ordersHtml = buyerOrders.map((order) => {
    const status = String(order.status || 'pendente').toLowerCase();
    const isRefundRequested = status === 'reembolso_solicitado' || order.reembolsoSolicitado === true;
    const locked = isFinalOrderStatus(status) || order.finalizado === true || isRefundRequested;
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
    } else if (order.chatVendedorId || String(order.sellerId || '')) {
      const canPrepareSellerChat = String(order.sellerId || '') && String(order.sellerId || '') !== String(ghubProfile?.gameId || '') && !String(order.chatVendedorStatus || '').match(/encerrado|expirado|escalado/i);
      chatHtml = canPrepareSellerChat
        ? `<div class="mt-3 rounded-xl border border-emerald-200 bg-emerald-50 p-3"><p class="text-[10px] font-black uppercase tracking-wider text-emerald-800">Chat com vendedor</p><p class="mt-1 text-xs font-semibold text-emerald-900">Envie a primeira mensagem para abrir o chat temporário com o vendedor.</p><button type="button" data-open-problem="${escapeHtml(order.id)}" class="mt-2 rounded-xl bg-emerald-600 px-3 py-2 text-xs font-black text-white hover:bg-emerald-700">Abrir chat com vendedor</button></div>`
        : `<div class="mt-3 rounded-xl border border-gray-200 bg-gray-50 p-3"><p class="text-[10px] font-black uppercase tracking-wider text-gray-600">Chat com vendedor</p><p class="mt-1 text-xs font-semibold text-gray-700">Chat encerrado ou indisponível.</p></div>`;
    }

    const existingRating = buyerRatings.find((rating) => String(rating.orderId || rating.pedidoId || '') === String(order.id));
    const canRateSeller = status === 'entregue' && !existingRating && String(order.sellerId || '') && String(order.sellerId || '') !== String(ghubProfile?.gameId || '');
    const ratingHtml = existingRating
      ? `<div class="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3"><p class="text-[10px] font-black uppercase tracking-wider text-amber-800">Avaliação enviada</p><p class="mt-1 text-xs font-semibold text-amber-900">Você avaliou esse vendedor com ${Number(existingRating.nota || 0) >= 5 ? 'like' : 'dislike'}. Essa avaliação não pode ser alterada.</p></div>`
      : canRateSeller
        ? `<div class="mt-3 rounded-xl border border-gray-200 bg-white p-3"><p class="text-[10px] font-black uppercase tracking-wider text-gray-500">Avaliar vendedor</p><p class="mt-1 text-xs font-semibold text-gray-600">Avalie somente após confirmar a compra. Depois de avaliar, não será possível trocar.</p><div class="mt-2 flex flex-wrap gap-2"><button type="button" data-rate-order-seller="10" data-rate-order-id="${escapeHtml(order.id)}" data-rate-seller-id="${escapeHtml(order.sellerId || '')}" class="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-black text-emerald-700 hover:bg-emerald-100">Curtir</button><button type="button" data-rate-order-seller="0" data-rate-order-id="${escapeHtml(order.id)}" data-rate-seller-id="${escapeHtml(order.sellerId || '')}" class="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs font-black text-red-700 hover:bg-red-100">Descurtir</button></div></div>`
        : '';

    return `<div class="rounded-2xl border border-gray-100 bg-gray-50 p-4">
      <div class="flex items-start justify-between gap-3">
        <div class="min-w-0">
          <p class="font-black text-sm text-gray-900 truncate">${escapeHtml(order.produtoTitulo || 'Produto')}</p>
          <p class="mt-1 text-xs font-bold text-gray-400">Pedido: ${escapeHtml(order.id)}</p>
          <p class="mt-1 text-xs font-semibold text-gray-500">Vendedor: ${escapeHtml(order.sellerName || order.sellerId || '-')}</p>
          <p class="mt-1 text-xs font-semibold text-gray-500">Data: ${escapeHtml(created)}</p>
          ${isRefundRequested && order.reembolsoMotivo ? `<p class="mt-2 rounded-xl bg-amber-50 p-2 text-xs font-semibold leading-relaxed text-amber-800 ring-1 ring-amber-200">Motivo do reembolso: ${escapeHtml(order.reembolsoMotivo)}</p>` : ''}
        </div>
        <span class="shrink-0 rounded-full px-2.5 py-1 text-[10px] font-black ring-1 ${getOrderStatusClass(status)}">${escapeHtml(status.toUpperCase())}</span>
      </div>
      <div class="mt-3 flex items-center justify-between gap-3">
        <p class="text-base font-black text-emerald-700">${moneyBRL(order.total || order.precoUnitario || 0)}</p>
        <span class="rounded-full bg-gray-100 px-2.5 py-1 text-[10px] font-black text-gray-500">${escapeHtml(order.categoriaNome || order.categoriaId || 'Categoria')}</span>
      </div>
      ${chatHtml}
      ${ratingHtml}
    </div>`;
  }).join('');

  const paginationHtml = `
    <div class="mt-3 rounded-2xl border border-gray-100 bg-white p-3">
      <div class="flex items-center justify-between gap-3">
        <button type="button" data-buyer-orders-page="prev" class="rounded-xl border border-gray-200 bg-white px-3 py-2 text-xs font-black text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-40" ${buyerOrdersPage <= 1 ? 'disabled' : ''}>Voltar</button>
        <span class="text-xs font-black text-gray-500">Página atual: ${buyerOrdersPage}</span>
        <button type="button" data-buyer-orders-page="next" class="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-black text-emerald-700 hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-40" ${buyerOrdersHasNextPage ? '' : 'disabled'}>Próxima</button>
      </div>
    </div>`;

  els.buyerOrdersList.innerHTML = ordersHtml + paginationHtml;

  els.buyerOrdersList.querySelectorAll('[data-buyer-orders-page]').forEach((btn) => btn.addEventListener('click', () => {
    const dir = btn.getAttribute('data-buyer-orders-page') || '';
    if (dir === 'prev' && buyerOrdersPage > 1) loadBuyerOrders({ page: buyerOrdersPage - 1, force: true });
    if (dir === 'next' && buyerOrdersHasNextPage) loadBuyerOrders({ page: buyerOrdersPage + 1, force: true });
  }));

  els.buyerOrdersList.querySelectorAll('[data-save-buyer-info]').forEach((btn) => btn.addEventListener('click', () => updateBuyerOrderInfo(btn.getAttribute('data-save-buyer-info') || '')));
  els.buyerOrdersList.querySelectorAll('[data-open-problem]').forEach((btn) => btn.addEventListener('click', () => openProblemModal(btn.getAttribute('data-open-problem') || '', CHAT_TYPE_SELLER)));
  els.buyerOrdersList.querySelectorAll('[data-open-support-chat]').forEach((btn) => btn.addEventListener('click', () => openProblemModal(btn.getAttribute('data-open-support-chat') || '', CHAT_TYPE_SUPPORT)));
  els.buyerOrdersList.querySelectorAll('[data-rate-order-seller]').forEach((btn) => btn.addEventListener('click', () => rateSeller(btn.getAttribute('data-rate-seller-id') || '', Number(btn.getAttribute('data-rate-order-seller') || 0), btn.getAttribute('data-rate-order-id') || '')));
  updateNotificationBadges();
}

async function updateBuyerOrderInfo(orderId) {
  const order = buyerOrders.find((item) => String(item.id) === String(orderId));
  if (!order) return;
  if (String(order.buyerId || '') !== String(ghubProfile?.gameId || '')) { localToast('error', 'Esse pedido não pertence ao seu perfil.'); return; }
  if (isFinalOrderStatus(order.status) || order.finalizado === true) { localToast('error', 'Esse pedido já foi finalizado e não pode ser alterado.'); return; }
  const textValue = String(document.querySelector(`[data-buyer-info-for="${CSS.escape(String(orderId))}"]`)?.value || '').trim();
  if (!textValue) { localToast('error', 'Preencha as informações do pedido.'); document.querySelector(`[data-buyer-info-for="${CSS.escape(String(orderId))}"]`)?.focus(); return; }
  try { await setDoc(doc(lojaDb, 'pedidos', orderId), { buyerInfo: textValue, buyerInfoUpdatedAtMs: Date.now(), updatedAt: serverTimestamp() }, { merge: true }); localToast('success', 'Informações do pedido atualizadas.'); await loadBuyerOrders({ force: true }); }
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
  document.querySelectorAll('[data-support-admin-only]').forEach((el) => {
    el.classList.toggle('hidden', !isSupportAdmin);
  });
  initIcons();
  updateNotificationBadges();
}

function openSupportModal() {
  if (!isSupportAdmin) {
    localToast('error', 'Acesso restrito ao suporte.');
    return;
  }
  if (!mountLojaPanelInline(els.supportModal, 'suporte')) {
    els.supportModal?.classList.remove('hidden');
    els.supportModal?.classList.add('flex');
  }
  initIcons();
  loadSupportPanelData().then(() => {
    markSupportQueuesSeenIfOpen();
    updateNotificationBadges();
  });
}

function closeSupportModal() {
  if (isInlineLojaPage('suporte')) return;
  els.supportModal?.classList.add('hidden');
  els.supportModal?.classList.remove('flex');
  updateNotificationBadges();
}

async function loadSupportSellerCount() {
  if (!isSupportAdmin) return;
  try {
    const snap = await getDocs(collection(lojaDb, 'vendedor'));
    supportSellerTotal = snap.size;
    if (els.supportSellersTotal) els.supportSellersTotal.textContent = supportSellerTotal === 1 ? 'Vendedores: 1 conta' : `Vendedores: ${supportSellerTotal} contas`;
  } catch (err) {
    console.warn('Não foi possível contar vendedores:', err);
    supportSellerTotal = 0;
    if (els.supportSellersTotal) els.supportSellersTotal.textContent = 'Vendedores: indisponível';
  }
}

async function loadSupportPanelData(options = {}) {
  if (!isSupportAdmin) return;
  const { force = false, silent = false } = options || {};
  const cached = !force ? lojaCacheGet('supportPanel', LOJA_CACHE_TTL.SUPPORT_PANEL, 'global') : null;
  if (cached && typeof cached === 'object') {
    supportSellerTotal = Number(cached.supportSellerTotal || 0);
    supportVerifications = Array.isArray(cached.supportVerifications) ? cached.supportVerifications : [];
    supportChats = Array.isArray(cached.supportChats) ? cached.supportChats : [];
    supportReports = Array.isArray(cached.supportReports) ? cached.supportReports : [];
    supportWithdrawals = Array.isArray(cached.supportWithdrawals) ? cached.supportWithdrawals : [];
    supportRefundRequests = Array.isArray(cached.supportRefundRequests) ? cached.supportRefundRequests : [];
    if (els.supportSellersTotal) els.supportSellersTotal.textContent = supportSellerTotal === 1 ? 'Vendedores: 1 conta' : `Vendedores: ${supportSellerTotal} contas`;
    renderSupportVerifications();
    renderSupportChats();
    renderSupportReports();
    renderSupportWithdrawals();
    renderSupportRefundRequests();
    markSupportQueuesSeenIfOpen();
    updateNotificationBadges();
    return;
  }
  if (!silent) {
    if (els.supportVerificationsList) els.supportVerificationsList.innerHTML = '<div class="rounded-2xl border border-gray-100 bg-gray-50 p-4 text-sm font-semibold text-gray-500 text-center">Carregando verificações...</div>';
    if (els.supportChatsList) els.supportChatsList.innerHTML = '<div class="rounded-2xl border border-gray-100 bg-gray-50 p-4 text-sm font-semibold text-gray-500 text-center">Carregando chats...</div>';
    if (els.supportReportsList) els.supportReportsList.innerHTML = '<div class="rounded-2xl border border-gray-100 bg-gray-50 p-4 text-sm font-semibold text-gray-500 text-center">Carregando denúncias...</div>';
    if (els.supportWithdrawalsList) els.supportWithdrawalsList.innerHTML = '<div class="rounded-2xl border border-gray-100 bg-gray-50 p-4 text-sm font-semibold text-gray-500 text-center">Carregando saques...</div>';
    if (els.supportRefundsList) els.supportRefundsList.innerHTML = '<div class="rounded-2xl border border-gray-100 bg-gray-50 p-4 text-sm font-semibold text-gray-500 text-center">Carregando reembolsos...</div>';
  }
  await Promise.all([loadSupportSellerCount(), loadSupportVerifications(), loadSupportChats(), loadSupportReports(), loadSupportWithdrawals(), loadSupportRefundRequests()]);
  lojaCacheSet('supportPanel', { supportSellerTotal, supportVerifications, supportChats, supportReports, supportWithdrawals, supportRefundRequests }, 'global');
  markSupportQueuesSeenIfOpen();
  updateNotificationBadges();
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


async function loadSupportWithdrawals() {
  try { const snap = await getDocs(collection(lojaDb, WITHDRAW_COLLECTION)); supportWithdrawals = snap.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => Number(b.createdAtMs || 0) - Number(a.createdAtMs || 0)); }
  catch (err) { console.warn('Não foi possível carregar solicitações de saque:', err); supportWithdrawals = []; }
  renderSupportWithdrawals();
}

function renderSupportWithdrawals() {
  if (els.supportWithdrawalsCounter) els.supportWithdrawalsCounter.textContent = supportWithdrawals.length === 1 ? '1 solicitação' : `${supportWithdrawals.length} solicitações`;
  if (!els.supportWithdrawalsList) return;
  if (!supportWithdrawals.length) { els.supportWithdrawalsList.innerHTML = '<div class="rounded-2xl border border-dashed border-gray-200 bg-gray-50 p-4 text-sm font-semibold text-gray-500 text-center">Nenhuma solicitação de saque.</div>'; return; }
  els.supportWithdrawalsList.innerHTML = supportWithdrawals.map((withdraw) => { const status = String(withdraw.status || 'pendente').toLowerCase(); const pending = status === 'pendente'; return `<div class="rounded-2xl border border-sky-100 bg-sky-50 p-3"><div class="flex items-start justify-between gap-3"><div class="min-w-0"><p class="font-black text-sm text-gray-900 truncate">${escapeHtml(withdraw.sellerName || withdraw.sellerId || 'Vendedor')}</p><p class="mt-1 text-xs font-bold text-sky-700">ID vendedor: ${escapeHtml(withdraw.sellerId || '-')}</p><p class="mt-1 text-xs font-semibold text-gray-600">Valor: ${moneyBRL(withdraw.valor || withdraw.amount || 0)}</p><p class="mt-1 text-xs font-semibold text-gray-600">Pix: ${escapeHtml(withdraw.pix || '-')}</p><p class="mt-1 text-xs font-semibold text-gray-500">Data: ${escapeHtml(formatDateTimeBR(withdraw.createdAtMs || withdraw.createdAt))}</p></div><span class="rounded-full bg-white px-2.5 py-1 text-[10px] font-black text-sky-700 ring-1 ring-sky-200">${escapeHtml(status.toUpperCase())}</span></div><div class="mt-3 grid grid-cols-2 gap-2">${pending ? `<button type="button" data-withdraw-paid="${escapeHtml(withdraw.id)}" class="rounded-xl bg-emerald-600 px-3 py-2 text-xs font-black text-white hover:bg-emerald-700">Marcar pago</button>` : '<span class="rounded-xl bg-white px-3 py-2 text-xs font-black text-gray-500 text-center ring-1 ring-gray-100">Finalizado</span>'}<button type="button" data-withdraw-delete="${escapeHtml(withdraw.id)}" class="rounded-xl border border-gray-200 bg-white px-3 py-2 text-xs font-black text-gray-700 hover:bg-gray-50">Excluir</button></div></div>`; }).join('');
  els.supportWithdrawalsList.querySelectorAll('[data-withdraw-paid]').forEach((btn) => btn.addEventListener('click', () => markWithdrawalPaid(btn.getAttribute('data-withdraw-paid') || '')));
  els.supportWithdrawalsList.querySelectorAll('[data-withdraw-delete]').forEach((btn) => btn.addEventListener('click', () => deleteWithdrawalRequest(btn.getAttribute('data-withdraw-delete') || '')));
  initIcons();
}

async function markWithdrawalPaid(withdrawId) {
  if (!withdrawId || !isSupportAdmin) return;
  const withdraw = supportWithdrawals.find((item) => String(item.id) === String(withdrawId));
  if (!withdraw) return;
  const confirmed = await openCustomTextModal({
    title: 'Marcar saque como pago',
    message: `Confirme que o saque de ${moneyBRL(withdraw.valor || withdraw.amount || 0)} para ${withdraw.sellerName || withdraw.sellerId || 'vendedor'} já foi pago.`,
    placeholder: 'Digite PAGO',
    requiredText: 'PAGO',
    confirmLabel: 'Marcar como pago'
  });
  if (String(confirmed || '').toUpperCase() !== 'PAGO') return;

  try {
    const sellerId = String(withdraw.sellerId || '').trim();
    const amount = Number(withdraw.valor || withdraw.amount || 0);
    if (!sellerId || !Number.isFinite(amount) || amount <= 0) {
      localToast('error', 'Solicitação de saque inválida.');
      return;
    }

    const sellerRef = doc(lojaDb, 'vendedor', sellerId);
    const withdrawRef = doc(lojaDb, WITHDRAW_COLLECTION, withdrawId);
    let sellerAfterPayment = null;

    await runTransaction(lojaDb, async (transaction) => {
      const sellerSnap = await transaction.get(sellerRef);
      const withdrawSnap = await transaction.get(withdrawRef);
      if (!withdrawSnap.exists()) throw new Error('withdraw-not-found');
      const currentWithdraw = withdrawSnap.data() || {};
      if (String(currentWithdraw.status || 'pendente').toLowerCase() === 'pago') throw new Error('withdraw-already-paid');

      const seller = sellerSnap.exists() ? sellerSnap.data() : {};
      const previousPending = Number(seller.saquePendente ?? seller.saldoEmSaque ?? seller.financeiro?.saldoEmSaque ?? 0);
      const previousSacado = Number(seller.totalSacado ?? seller.financeiro?.totalSacado ?? 0);
      const nextPending = Math.max(0, previousPending - amount);
      const nextSacado = previousSacado + amount;
      sellerAfterPayment = {
        ...seller,
        saquePendente: nextPending,
        saldoEmSaque: nextPending,
        totalSacado: nextSacado,
        financeiro: { ...(seller.financeiro || {}), saldoEmSaque: nextPending, totalSacado: nextSacado }
      };

      transaction.set(withdrawRef, {
        status: 'pago',
        valorPago: amount,
        pagoEmMs: Date.now(),
        pagoPor: ghubProfile?.gameId || currentUser?.uid || '',
        updatedAt: serverTimestamp()
      }, { merge: true });

      transaction.set(sellerRef, {
        saquePendente: nextPending,
        saldoEmSaque: nextPending,
        totalSacado: nextSacado,
        financeiro: { ...(seller.financeiro || {}), saldoEmSaque: nextPending, totalSacado: nextSacado },
        updatedAt: serverTimestamp()
      }, { merge: true });
    });

    try {
      const ordersSnap = await getDocs(query(collection(lojaDb, 'pedidos'), where('sellerId', '==', sellerId)));
      const sellerOrderList = ordersSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
      const exact = calculateSellerFinancials(sellerOrderList, sellerAfterPayment || {});
      const exactPayload = {
        saldoAtual: exact.saldoAtual,
        saldoPendente: exact.saldoPendente,
        saquePendente: exact.saldoEmSaque,
        saldoEmSaque: exact.saldoEmSaque,
        totalSacado: exact.totalSacado,
        financeiro: {
          ...((sellerAfterPayment && sellerAfterPayment.financeiro) || {}),
          saldoAtual: exact.saldoAtual,
          saldoPendente: exact.saldoPendente,
          saldoEmSaque: exact.saldoEmSaque,
          totalSacado: exact.totalSacado,
          totalBrutoEntregue: exact.totalBrutoEntregue,
          totalLiquidoEntregue: exact.totalLiquidoEntregue,
          totalVendasEntregues: exact.totalVendasEntregues,
          taxaPercentual: SELLER_FEE_PERCENT,
          saqueMinimo: SELLER_WITHDRAW_MIN,
          liberacaoDias: SELLER_RELEASE_DAYS,
          atualizadoEmMs: Date.now()
        },
        updatedAt: serverTimestamp()
      };
      await setDoc(sellerRef, exactPayload, { merge: true });
      if (String(ghubProfile?.gameId || '') === sellerId && lojaStatus?.vendedor) {
        lojaStatus.vendedor = { ...lojaStatus.vendedor, ...exactPayload };
      }
    } catch (calcErr) {
      console.warn('Saque pago, mas não foi possível recalcular saldo exato agora:', calcErr);
      if (String(ghubProfile?.gameId || '') === sellerId && lojaStatus?.vendedor && sellerAfterPayment) {
        lojaStatus.vendedor = { ...lojaStatus.vendedor, ...sellerAfterPayment };
      }
    }

    localToast('success', 'Saque marcado como pago e saldo recalculado.');
    await loadSupportWithdrawals();
    if (lojaStatus?.vendedor && String(ghubProfile?.gameId || '') === sellerId) {
      await loadStoreStatus();
      renderSellerProfileCard();
    }
  } catch (err) {
    console.error(err);
    localToast('error', err?.message === 'withdraw-already-paid' ? 'Esse saque já estava marcado como pago.' : 'Não foi possível marcar o saque como pago.');
  }
}

async function deleteWithdrawalRequest(withdrawId) {
  if (!withdrawId || !isSupportAdmin) return; if (!window.confirm('Excluir essa solicitação de saque?')) return;
  try { await deleteDoc(doc(lojaDb, WITHDRAW_COLLECTION, withdrawId)); localToast('success', 'Solicitação de saque excluída.'); await loadSupportWithdrawals(); }
  catch (err) { console.error(err); localToast('error', 'Não foi possível excluir a solicitação de saque.'); }
}

async function loadSupportRefundRequests() {
  if (!isSupportAdmin) return;
  try {
    const snap = await getDocs(collection(lojaDb, 'pedidos'));
    supportRefundRequests = snap.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .filter((order) => {
        const status = String(order.status || '').toLowerCase();
        const refundStatus = String(order.reembolsoStatus || '').toLowerCase();
        return (status === 'reembolso_solicitado' || order.reembolsoSolicitado === true) && refundStatus !== 'reembolsado';
      })
      .sort((a, b) => Number(b.reembolsoSolicitadoEmMs || b.createdAtMs || b.createdAt?.seconds || 0) - Number(a.reembolsoSolicitadoEmMs || a.createdAtMs || a.createdAt?.seconds || 0));
  } catch (err) {
    console.warn('Não foi possível carregar solicitações de reembolso:', err);
    supportRefundRequests = [];
  }
  renderSupportRefundRequests();
}

function renderSupportRefundRequests() {
  if (els.supportRefundsCounter) els.supportRefundsCounter.textContent = supportRefundRequests.length === 1 ? '1 solicitação' : `${supportRefundRequests.length} solicitações`;
  if (!els.supportRefundsList) return;
  if (!supportRefundRequests.length) {
    els.supportRefundsList.innerHTML = '<div class="rounded-2xl border border-dashed border-gray-200 bg-gray-50 p-4 text-sm font-semibold text-gray-500 text-center">Nenhuma solicitação de reembolso.</div>';
    return;
  }

  els.supportRefundsList.innerHTML = supportRefundRequests.map((order) => {
    const created = formatDateTimeBR(order.reembolsoSolicitadoEmMs || order.reembolsoSolicitadoEm || order.createdAtMs || order.createdAt);
    const reason = String(order.reembolsoMotivo || '').trim();
    return `<div class="rounded-2xl border border-amber-100 bg-amber-50 p-3">
      <div class="flex items-start justify-between gap-3">
        <div class="min-w-0">
          <p class="font-black text-sm text-gray-900 truncate">${escapeHtml(order.produtoTitulo || order.produtoNome || 'Pedido')}</p>
          <p class="mt-1 text-xs font-bold text-amber-800">Pedido: ${escapeHtml(order.id)} • ${moneyBRL(order.total || order.precoUnitario || 0)}</p>
          <p class="mt-1 text-xs font-semibold text-gray-600">Comprador: ${escapeHtml(order.buyerName || order.buyerNick || order.buyerId || '-')}</p>
          <p class="mt-1 text-xs font-semibold text-gray-600">Vendedor: ${escapeHtml(order.sellerName || order.sellerId || '-')}</p>
          <p class="mt-1 text-xs font-semibold text-gray-500">Solicitado em: ${escapeHtml(created)}</p>
          ${reason ? `<p class="mt-2 rounded-xl bg-white/80 p-2 text-xs font-semibold leading-relaxed text-gray-700 ring-1 ring-amber-100">Motivo: ${escapeHtml(reason)}</p>` : ''}
        </div>
        <span class="shrink-0 rounded-full bg-white px-2.5 py-1 text-[10px] font-black text-amber-800 ring-1 ring-amber-200">PENDENTE</span>
      </div>
      <div class="mt-3 grid grid-cols-1 sm:grid-cols-3 gap-2">
        <button type="button" data-support-refund-order="${escapeHtml(order.id)}" class="rounded-xl bg-red-600 px-3 py-2 text-xs font-black text-white hover:bg-red-700">Aprovar reembolso</button>
        <button type="button" data-support-delete-refund-request="${escapeHtml(order.id)}" class="rounded-xl border border-amber-200 bg-white px-3 py-2 text-xs font-black text-amber-800 hover:bg-amber-50">Apagar solicitação</button>
        <button type="button" data-support-refund-chat="${escapeHtml(order.id)}" class="rounded-xl border border-sky-200 bg-sky-50 px-3 py-2 text-xs font-black text-sky-700 hover:bg-sky-100">Abrir chat</button>
      </div>
    </div>`;
  }).join('');

  els.supportRefundsList.querySelectorAll('[data-support-refund-order]').forEach((btn) => btn.addEventListener('click', () => refundOrderFromSupport(btn.getAttribute('data-support-refund-order') || '')));
  els.supportRefundsList.querySelectorAll('[data-support-delete-refund-request]').forEach((btn) => btn.addEventListener('click', () => deleteRefundRequestFromSupport(btn.getAttribute('data-support-delete-refund-request') || '')));
  els.supportRefundsList.querySelectorAll('[data-support-refund-chat]').forEach((btn) => btn.addEventListener('click', () => openOrderChatFromSupport(btn.getAttribute('data-support-refund-chat') || '')));
  initIcons();
  markSupportQueuesSeenIfOpen();
  updateNotificationBadges();
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

function normalizeSearchText(value) {
  return String(value || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
}

async function searchSupportSellers() {
  if (!isSupportAdmin) return;
  const term = normalizeSearchText(els.supportSellerSearch?.value || '');
  if (!term) { localToast('error', 'Digite um ID ou nome de vendedor.'); return; }
  if (els.supportSellerResults) els.supportSellerResults.innerHTML = '<div class="rounded-xl bg-white p-3 text-xs font-bold text-gray-500 ring-1 ring-gray-100">Pesquisando vendedores...</div>';
  try {
    const snap = await getDocs(collection(lojaDb, 'vendedor'));
    supportSellerResults = snap.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .filter((seller) => {
        const blob = normalizeSearchText(`${seller.id || ''} ${seller.gameId || ''} ${seller.nick || ''} ${seller.nome || ''} ${seller.email || ''}`);
        return blob.includes(term);
      })
      .slice(0, 20);
    renderSupportSellerResults();
  } catch (err) {
    console.error(err);
    localToast('error', 'Não foi possível pesquisar vendedores.');
  }
}

function renderSupportSellerResults() {
  if (!els.supportSellerResults) return;
  if (!supportSellerResults.length) {
    els.supportSellerResults.innerHTML = '<div class="rounded-xl bg-white p-3 text-xs font-bold text-gray-500 ring-1 ring-gray-100">Nenhum vendedor encontrado.</div>';
    return;
  }
  els.supportSellerResults.innerHTML = supportSellerResults.map((seller) => {
    const sid = String(seller.id || seller.gameId || '');
    const active = seller.ativo !== false && String(seller.status || '').toLowerCase() !== 'inativo';
    return `<div class="rounded-2xl border border-gray-100 bg-white p-3">
      <div class="flex items-start justify-between gap-3"><div class="min-w-0"><p class="font-black text-sm text-gray-900 truncate">${escapeHtml(seller.nome || seller.nick || sid || 'Vendedor')}</p><p class="mt-1 text-xs font-bold text-gray-400">ID: ${escapeHtml(sid)}</p><p class="mt-1 text-xs font-semibold text-gray-500 truncate">${escapeHtml(seller.email || '')}</p><p class="mt-1 text-xs font-semibold text-gray-500">Nota: ${seller.notaTotal ? Number(seller.notaMedia || 0).toFixed(1) + '/10 • ' + seller.notaTotal + ' avaliações' : 'sem avaliações'}</p><div class="mt-2 grid grid-cols-2 sm:grid-cols-4 gap-1"><span class="rounded-lg bg-emerald-50 px-2 py-1 text-[10px] font-black text-emerald-700 ring-1 ring-emerald-100">Atual: ${moneyBRL(seller.saldoAtual ?? seller.financeiro?.saldoAtual ?? 0)}</span><span class="rounded-lg bg-amber-50 px-2 py-1 text-[10px] font-black text-amber-700 ring-1 ring-amber-100">Pendente: ${moneyBRL(seller.saldoPendente ?? seller.financeiro?.saldoPendente ?? 0)}</span><span class="rounded-lg bg-sky-50 px-2 py-1 text-[10px] font-black text-sky-700 ring-1 ring-sky-100">Em saque: ${moneyBRL(seller.saquePendente ?? seller.saldoEmSaque ?? seller.financeiro?.saldoEmSaque ?? 0)}</span><span class="rounded-lg bg-gray-50 px-2 py-1 text-[10px] font-black text-gray-700 ring-1 ring-gray-100">Já sacado: ${moneyBRL(seller.totalSacado ?? seller.financeiro?.totalSacado ?? 0)}</span></div></div><span class="rounded-full bg-${active ? 'emerald' : 'red'}-50 px-2.5 py-1 text-[10px] font-black text-${active ? 'emerald' : 'red'}-700 ring-1 ring-${active ? 'emerald' : 'red'}-200">${active ? 'ATIVO' : 'INATIVO'}</span></div>
      <div class="mt-3 grid grid-cols-2 sm:grid-cols-4 gap-2"><button type="button" data-admin-chat-seller="${escapeHtml(sid)}" data-admin-chat-seller-name="${escapeHtml(seller.nome || seller.nick || '')}" class="rounded-xl border border-sky-200 bg-sky-50 px-3 py-2 text-xs font-black text-sky-700 hover:bg-sky-100">Chat</button><button type="button" data-admin-toggle-seller="${escapeHtml(sid)}" data-admin-next-active="${active ? 'false' : 'true'}" class="rounded-xl border border-gray-200 bg-white px-3 py-2 text-xs font-black text-gray-700 hover:bg-gray-50">${active ? 'Inativar' : 'Ativar'}</button><button type="button" data-admin-delete-seller="${escapeHtml(sid)}" class="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs font-black text-red-700 hover:bg-red-100">Excluir conta</button><button type="button" data-admin-search-products-seller="${escapeHtml(sid)}" class="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-black text-amber-700 hover:bg-amber-100">Produtos</button></div>
    </div>`;
  }).join('');
  els.supportSellerResults.querySelectorAll('[data-admin-chat-seller]').forEach((btn) => btn.addEventListener('click', () => createSupportChatWithSeller(btn.getAttribute('data-admin-chat-seller') || '', btn.getAttribute('data-admin-chat-seller-name') || '', 'busca')));
  els.supportSellerResults.querySelectorAll('[data-admin-toggle-seller]').forEach((btn) => btn.addEventListener('click', () => setSellerActiveFromSupport(btn.getAttribute('data-admin-toggle-seller') || '', btn.getAttribute('data-admin-next-active') === 'true')));
  els.supportSellerResults.querySelectorAll('[data-admin-delete-seller]').forEach((btn) => btn.addEventListener('click', () => deleteSellerFromSupport(btn.getAttribute('data-admin-delete-seller') || '')));
  els.supportSellerResults.querySelectorAll('[data-admin-search-products-seller]').forEach((btn) => { btn.addEventListener('click', () => { if (els.supportProductSearch) els.supportProductSearch.value = btn.getAttribute('data-admin-search-products-seller') || ''; searchSupportProducts(); }); });
  initIcons();
}

async function setSellerActiveFromSupport(sellerId, active) {
  const cleanSellerId = String(sellerId || '').trim();
  if (!cleanSellerId || !isSupportAdmin) return;
  if (!window.confirm(active ? 'Ativar essa conta de vendedor?' : 'Inativar essa conta de vendedor?')) return;
  try {
    await setDoc(doc(lojaDb, 'vendedor', cleanSellerId), { ativo: !!active, status: active ? 'ativo' : 'inativo', updatedAt: serverTimestamp(), alteradoPor: ghubProfile?.gameId || currentUser?.uid || '' }, { merge: true });
    if (!active) await deleteProductsBySellerId(cleanSellerId);
    localToast('success', active ? 'Vendedor ativado.' : 'Vendedor inativado e anúncios excluídos.');
    await Promise.all([searchSupportSellers(), loadProducts(true), loadSupportReports(), loadSupportSellerCount(), loadSupportWithdrawals(), loadSupportChats()]);
  } catch (err) { console.error(err); localToast('error', 'Não foi possível atualizar o vendedor.'); }
}

async function deleteSellerFromSupport(sellerId) {
  const cleanSellerId = String(sellerId || '').trim();
  if (!cleanSellerId || !isSupportAdmin) return;
  const confirmed = await confirmTypedDelete({
    title: 'Excluir vendedor',
    message: 'Isso excluirá a conta de vendedor, todos os produtos, pedidos, chats e solicitações de saque vinculadas. Essa ação é irreversível.'
  });
  if (!confirmed) return;
  try {
    await deleteSellerAccountAndProducts(cleanSellerId, { bySupport: true });
    localToast('success', 'Conta de vendedor, produtos, pedidos, chats e saques excluídos.');
    await Promise.all([searchSupportSellers(), loadProducts(true), loadSupportReports(), loadSupportSellerCount(), loadSupportWithdrawals(), loadSupportChats()]);
  } catch (err) { console.error(err); localToast('error', 'Não foi possível excluir o vendedor.'); }
}

async function searchSupportProducts() {
  if (!isSupportAdmin) return;
  const term = normalizeSearchText(els.supportProductSearch?.value || '');
  if (!term) { localToast('error', 'Digite um ID, nome de produto ou vendedor.'); return; }
  if (els.supportProductResults) els.supportProductResults.innerHTML = '<div class="rounded-xl bg-white p-3 text-xs font-bold text-gray-500 ring-1 ring-gray-100">Pesquisando produtos...</div>';
  try {
    const snap = await getDocs(collection(lojaDb, 'produtos'));
    supportProductResults = snap.docs
      .map(normalizeProduct)
      .filter((product) => normalizeSearchText(`${product.id || ''} ${product.titulo || ''} ${product.sellerId || ''} ${product.sellerName || ''} ${product.categoriaNome || ''}`).includes(term))
      .slice(0, 30);
    renderSupportProductResults();
  } catch (err) { console.error(err); localToast('error', 'Não foi possível pesquisar produtos.'); }
}

function renderSupportProductResults() {
  if (!els.supportProductResults) return;
  if (!supportProductResults.length) {
    els.supportProductResults.innerHTML = '<div class="rounded-xl bg-white p-3 text-xs font-bold text-gray-500 ring-1 ring-gray-100">Nenhum produto encontrado.</div>';
    return;
  }
  els.supportProductResults.innerHTML = supportProductResults.map((product) => `<div class="rounded-2xl border border-gray-100 bg-white p-3"><div class="flex items-start gap-3"><div class="h-12 w-12 shrink-0 overflow-hidden rounded-xl bg-gray-50 ring-1 ring-gray-100 flex items-center justify-center">${product.imagem ? '<img src="' + escapeHtml(product.imagem) + '" class="h-full w-full object-cover" alt="">' : '<i data-lucide="package" class="w-5 h-5 text-gray-300"></i>'}</div><div class="min-w-0 flex-1"><p class="font-black text-sm text-gray-900 truncate">${escapeHtml(product.titulo || product.id)}</p><p class="mt-1 text-xs font-bold text-gray-400">ID: ${escapeHtml(product.id)} • ${moneyBRL(product.preco || 0)}</p><p class="mt-1 text-xs font-semibold text-gray-500">Vendedor: ${escapeHtml(product.sellerName || product.sellerId || '-')}</p></div></div><div class="mt-3 grid grid-cols-2 gap-2"><button type="button" data-admin-delete-product="${escapeHtml(product.id)}" class="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs font-black text-red-700 hover:bg-red-100">Excluir produto</button><button type="button" data-admin-chat-product-seller="${escapeHtml(product.sellerId || '')}" data-admin-chat-product-seller-name="${escapeHtml(product.sellerName || '')}" class="rounded-xl border border-sky-200 bg-sky-50 px-3 py-2 text-xs font-black text-sky-700 hover:bg-sky-100">Chat vendedor</button></div></div>`).join('');
  els.supportProductResults.querySelectorAll('[data-admin-delete-product]').forEach((btn) => btn.addEventListener('click', () => deleteProductFromSupport(btn.getAttribute('data-admin-delete-product') || '')));
  els.supportProductResults.querySelectorAll('[data-admin-chat-product-seller]').forEach((btn) => btn.addEventListener('click', () => createSupportChatWithSeller(btn.getAttribute('data-admin-chat-product-seller') || '', btn.getAttribute('data-admin-chat-product-seller-name') || '', 'produto')));
  initIcons();
}

async function deleteProductFromSupport(productId) {
  const cleanProductId = String(productId || '').trim();
  if (!cleanProductId || !isSupportAdmin) return;
  if (!window.confirm('Excluir esse produto?')) return;
  try {
    await deleteDoc(doc(lojaDb, 'produtos', cleanProductId));
    localToast('success', 'Produto excluído.');
    await Promise.all([searchSupportProducts(), loadProducts(true), loadSupportReports()]);
  } catch (err) { console.error(err); localToast('error', 'Não foi possível excluir o produto.'); }
}

async function searchSupportOrders() {
  if (!isSupportAdmin) return;
  const term = normalizeSearchText(els.supportOrderSearch?.value || '');
  if (!term) { localToast('error', 'Digite um ID de pedido, comprador, vendedor ou produto.'); return; }
  if (els.supportOrderResults) els.supportOrderResults.innerHTML = '<div class="rounded-xl bg-white p-3 text-xs font-bold text-gray-500 ring-1 ring-gray-100">Pesquisando pedidos...</div>';
  try {
    const snap = await getDocs(collection(lojaDb, 'pedidos'));
    supportOrderResults = snap.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .filter((order) => {
        const blob = normalizeSearchText(`${order.id || ''} ${order.produtoId || ''} ${order.produtoTitulo || ''} ${order.buyerId || ''} ${order.buyerName || order.buyerNick || ''} ${order.sellerId || ''} ${order.sellerName || ''} ${order.status || ''} ${order.reembolsoMotivo || ''}`);
        return blob.includes(term);
      })
      .sort((a, b) => Number(b.createdAtMs || b.createdAt?.seconds || 0) - Number(a.createdAtMs || a.createdAt?.seconds || 0))
      .slice(0, 40);
    renderSupportOrderResults();
  } catch (err) { console.error(err); localToast('error', 'Não foi possível pesquisar pedidos.'); }
}

function renderSupportOrderResults() {
  if (!els.supportOrderResults) return;
  if (!supportOrderResults.length) {
    els.supportOrderResults.innerHTML = '<div class="rounded-xl bg-white p-3 text-xs font-bold text-gray-500 ring-1 ring-gray-100">Nenhum pedido encontrado.</div>';
    return;
  }
  els.supportOrderResults.innerHTML = supportOrderResults.map((order) => {
    const status = String(order.status || 'pendente').toLowerCase();
    const isRefunded = status === 'reembolsado';
    const isRefundRequested = status === 'reembolso_solicitado' || order.reembolsoSolicitado === true;
    const created = formatDateTimeBR(order.createdAtMs || order.createdAt);
    return `<div class="rounded-2xl border border-gray-100 bg-white p-3">
      <div class="flex items-start justify-between gap-3">
        <div class="min-w-0">
          <p class="font-black text-sm text-gray-900 truncate">${escapeHtml(order.produtoTitulo || order.produtoNome || 'Pedido')}</p>
          <p class="mt-1 text-xs font-bold text-gray-400">Pedido: ${escapeHtml(order.id)} • ${moneyBRL(order.total || order.precoUnitario || 0)}</p>
          <p class="mt-1 text-xs font-semibold text-gray-500">Comprador: ${escapeHtml(order.buyerName || order.buyerNick || order.buyerId || '-')}</p>
          <p class="mt-1 text-xs font-semibold text-gray-500">Vendedor: ${escapeHtml(order.sellerName || order.sellerId || '-')}</p>
          <p class="mt-1 text-xs font-semibold text-gray-500">Data: ${escapeHtml(created)}</p>
          ${isRefundRequested && order.reembolsoMotivo ? `<p class="mt-2 rounded-xl bg-amber-50 p-2 text-xs font-semibold leading-relaxed text-amber-800 ring-1 ring-amber-200">Motivo do reembolso: ${escapeHtml(order.reembolsoMotivo)}</p>` : ''}
        </div>
        <span class="shrink-0 rounded-full px-2.5 py-1 text-[10px] font-black ring-1 ${getOrderStatusClass(status)}">${escapeHtml(status.toUpperCase())}</span>
      </div>
      <div class="mt-3 grid grid-cols-1 sm:grid-cols-3 gap-2">
        ${isRefunded ? '<span class="rounded-xl bg-red-50 px-3 py-2 text-center text-xs font-black text-red-700 ring-1 ring-red-200">Já reembolsado</span>' : `<button type="button" data-admin-refund-order="${escapeHtml(order.id)}" class="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs font-black text-red-700 hover:bg-red-100">${isRefundRequested ? 'Aprovar reembolso' : 'Marcar reembolso'}</button>`}
        ${isRefundRequested && !isRefunded ? `<button type="button" data-admin-delete-refund-request="${escapeHtml(order.id)}" class="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-black text-amber-800 hover:bg-amber-100">Apagar solicitação</button>` : ''}
        <button type="button" data-admin-open-order-chat="${escapeHtml(order.id)}" class="rounded-xl border border-sky-200 bg-sky-50 px-3 py-2 text-xs font-black text-sky-700 hover:bg-sky-100">Abrir chat</button>
      </div>
    </div>`;
  }).join('');
  els.supportOrderResults.querySelectorAll('[data-admin-refund-order]').forEach((btn) => btn.addEventListener('click', () => refundOrderFromSupport(btn.getAttribute('data-admin-refund-order') || '')));
  els.supportOrderResults.querySelectorAll('[data-admin-delete-refund-request]').forEach((btn) => btn.addEventListener('click', () => deleteRefundRequestFromSupport(btn.getAttribute('data-admin-delete-refund-request') || '')));
  els.supportOrderResults.querySelectorAll('[data-admin-open-order-chat]').forEach((btn) => btn.addEventListener('click', () => openOrderChatFromSupport(btn.getAttribute('data-admin-open-order-chat') || '')));
  initIcons();
}

async function recalcProductDeliveredSales(productId) {
  const cleanProductId = String(productId || '').trim();
  if (!cleanProductId) return;
  try {
    const snap = await getDocs(query(collection(lojaDb, 'pedidos'), where('produtoId', '==', cleanProductId)));
    const delivered = snap.docs.filter((d) => String(d.data()?.status || '').toLowerCase() === 'entregue').length;
    const productRef = doc(lojaDb, 'produtos', cleanProductId);
    const productSnap = await getDoc(productRef);
    const productData = productSnap.exists() ? { id: productSnap.id, ...productSnap.data() } : { id: cleanProductId };
    const nowMs = Date.now();
    await setDoc(productRef, {
      totalVendas: delivered,
      totalVendasEntregues: delivered,
      updatedAt: serverTimestamp(),
      updatedAtMs: nowMs,
      ...buildProductRankFields({ ...productData, totalVendas: delivered, totalVendasEntregues: delivered, updatedAtMs: nowMs }, {
        productSalesOverride: delivered,
        nowMs
      })
    }, { merge: true });
    lojaCacheRemove('products', 'global');
  } catch (err) { console.warn('Não foi possível recalcular vendas do produto:', err); }
}

async function recalcSellerFinancialsById(sellerId) {
  const cleanSellerId = String(sellerId || '').trim();
  if (!cleanSellerId) return null;
  try {
    const [sellerSnap, ordersSnap] = await Promise.all([
      getDoc(doc(lojaDb, 'vendedor', cleanSellerId)),
      getDocs(query(collection(lojaDb, 'pedidos'), where('sellerId', '==', cleanSellerId)))
    ]);
    const sellerData = sellerSnap.exists() ? { id: sellerSnap.id, ...sellerSnap.data() } : {};
    const orders = ordersSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
    const finances = calculateSellerFinancials(orders, sellerData);
    const payload = {
      saldoAtual: finances.saldoAtual,
      saldoPendente: finances.saldoPendente,
      saldoEmSaque: finances.saldoEmSaque,
      saquePendente: finances.saldoEmSaque,
      totalSacado: finances.totalSacado,
      totalVendas: finances.totalVendasEntregues,
      totalVendasEntregues: finances.totalVendasEntregues,
      financeiro: {
        ...(sellerData.financeiro || {}),
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
    await setDoc(doc(lojaDb, 'vendedor', cleanSellerId), payload, { merge: true });
    lojaCacheRemove('sellerStats', 'global');
    await refreshSellerProductsRankScores(cleanSellerId, finances.totalVendasEntregues);
    return finances;
  } catch (err) { console.warn('Não foi possível recalcular saldo do vendedor:', err); return null; }
}

async function refundOrderFromSupport(orderId) {
  const cleanOrderId = String(orderId || '').trim();
  if (!cleanOrderId || !isSupportAdmin) return;
  const order = supportOrderResults.find((item) => String(item.id) === cleanOrderId) || null;
  const confirmed = await openCustomTextModal({
    title: 'Aprovar solicitação de reembolso',
    message: `Essa ação altera o pedido para REEMBOLSADO e remove a venda dos cálculos de saldo do vendedor. Pedido: ${cleanOrderId}`,
    requiredText: 'REEMBOLSO',
    placeholder: 'Digite REEMBOLSO',
    confirmLabel: 'Aprovar e marcar reembolsado',
    danger: true
  }).then((value) => String(value || '').toUpperCase() === 'REEMBOLSO');
  if (!confirmed) return;
  try {
    const ref = doc(lojaDb, 'pedidos', cleanOrderId);
    const snap = await getDoc(ref);
    if (!snap.exists()) { localToast('error', 'Pedido não encontrado.'); return; }
    const data = { id: snap.id, ...snap.data() };
    if (String(data.status || '').toLowerCase() === 'reembolsado') { localToast('error', 'Esse pedido já está marcado como reembolsado.'); return; }
    const nowMs = Date.now();
    await setDoc(ref, {
      status: 'reembolsado',
      finalizado: true,
      reembolsadoEmMs: nowMs,
      reembolsadoPor: ghubProfile?.gameId || currentUser?.uid || '',
      reembolsoSolicitado: false,
      reembolsoStatus: 'reembolsado',
      reembolsoFinalizadoEmMs: nowMs,
      reembolsoFinalizadoPor: ghubProfile?.gameId || currentUser?.uid || '',
      pagamento: { ...(data.pagamento || {}), status: 'reembolsado', reembolsadoEm: serverTimestamp(), reembolsadoEmMs: nowMs },
      entrega: { ...(data.entrega || {}), status: 'reembolso_emitido' },
      updatedAt: serverTimestamp()
    }, { merge: true });
    if (data.produtoId) await recalcProductDeliveredSales(data.produtoId);
    if (data.sellerId) await recalcSellerFinancialsById(data.sellerId);
    localToast('success', 'Solicitação aprovada. Pedido marcado como reembolsado e saldo recalculado.');
    if (normalizeSearchText(els.supportOrderSearch?.value || '')) await searchSupportOrders();
    else {
      supportOrderResults = supportOrderResults.map((item) => String(item.id) === cleanOrderId ? { ...item, status: 'reembolsado', finalizado: true, reembolsoSolicitado: false, reembolsoStatus: 'reembolsado', reembolsadoEmMs: nowMs } : item);
      renderSupportOrderResults();
    }
    await Promise.all([loadSupportRefundRequests(), loadProducts(true), loadSupportWithdrawals(), loadSupportSellerCount()]);
    if (ghubProfile?.gameId && String(data.sellerId || '') === String(ghubProfile.gameId)) await loadSellerOrders({ reset: true });
    await loadBuyerOrders({ reset: true });
  } catch (err) { console.error(err); localToast('error', 'Não foi possível marcar o pedido como reembolso.'); }
}

async function deleteRefundRequestFromSupport(orderId) {
  const cleanOrderId = String(orderId || '').trim();
  if (!cleanOrderId || !isSupportAdmin) return;

  const confirmed = await openCustomTextModal({
    title: 'Apagar solicitação de reembolso',
    message: `Isso remove apenas a solicitação de reembolso do painel do suporte. O pedido não será marcado como reembolsado. Pedido: ${cleanOrderId}`,
    requiredText: 'APAGAR',
    placeholder: 'Digite APAGAR',
    confirmLabel: 'Apagar solicitação',
    danger: true
  }).then((value) => String(value || '').toUpperCase() === 'APAGAR');
  if (!confirmed) return;

  try {
    const ref = doc(lojaDb, 'pedidos', cleanOrderId);
    const snap = await getDoc(ref);
    if (!snap.exists()) { localToast('error', 'Pedido não encontrado.'); return; }
    const data = { id: snap.id, ...snap.data() };
    const currentStatus = String(data.status || '').toLowerCase();
    if (currentStatus === 'reembolsado') { localToast('error', 'Esse pedido já foi reembolsado.'); return; }

    const previousStatus = String(data.statusAntesReembolso || '').trim().toLowerCase();
    const restoredStatus = previousStatus && previousStatus !== 'reembolso_solicitado' && previousStatus !== 'reembolsado'
      ? previousStatus
      : 'pago';
    const previousPaymentStatus = String(data.pagamentoStatusAntesReembolso || '').trim();
    const previousDeliveryStatus = String(data.entregaStatusAntesReembolso || '').trim();

    await setDoc(ref, {
      status: restoredStatus,
      finalizado: data.finalizadoAntesReembolso === true,
      reembolsoSolicitado: deleteField(),
      reembolsoStatus: deleteField(),
      reembolsoMotivo: deleteField(),
      reembolsoSolicitadoPor: deleteField(),
      reembolsoSolicitadoPorNome: deleteField(),
      reembolsoSolicitadoEm: deleteField(),
      reembolsoSolicitadoEmMs: deleteField(),
      statusAntesReembolso: deleteField(),
      finalizadoAntesReembolso: deleteField(),
      pagamentoStatusAntesReembolso: deleteField(),
      entregaStatusAntesReembolso: deleteField(),
      pagamento: { ...(data.pagamento || {}), status: previousPaymentStatus || restoredStatus },
      entrega: { ...(data.entrega || {}), status: previousDeliveryStatus || restoredStatus },
      updatedAt: serverTimestamp()
    }, { merge: true });

    localToast('success', 'Solicitação de reembolso apagada. O pedido voltou para análise normal.');
    await loadSupportRefundRequests();
    if (normalizeSearchText(els.supportOrderSearch?.value || '')) await searchSupportOrders();
    if (ghubProfile?.gameId && String(data.sellerId || '') === String(ghubProfile.gameId)) await loadSellerOrders({ reset: true });
    await loadBuyerOrders({ reset: true });
  } catch (err) {
    console.error(err);
    localToast('error', 'Não foi possível apagar a solicitação de reembolso.');
  }
}

async function openOrderChatFromSupport(orderId) {
  const cleanOrderId = String(orderId || '').trim();
  if (!cleanOrderId || !isSupportAdmin) return;
  try {
    const snap = await getDoc(doc(lojaDb, 'pedidos', cleanOrderId));
    if (!snap.exists()) { localToast('error', 'Pedido não encontrado.'); return; }
    const order = { id: snap.id, ...snap.data() };
    const chatId = order.chatId || `pedido_${cleanOrderId}_${order.buyerId || ''}_${order.sellerId || ''}`;
    const chatSnap = await getDoc(doc(lojaDb, CHAT_COLLECTION, chatId));
    if (chatSnap.exists()) {
      openChatById(chatSnap.id, { id: chatSnap.id, ...chatSnap.data() });
      return;
    }
    const now = Date.now();
    const draft = buildDraftChat({
      id: chatId,
      type: CHAT_TYPE_SUPPORT,
      order,
      buyerId: order.buyerId || '',
      buyerName: order.buyerName || order.buyerNick || '',
      sellerId: order.sellerId || '',
      sellerName: order.sellerName || '',
      subject: `Suporte sobre pedido ${cleanOrderId}`,
      source: 'pedido-suporte',
      createdAtMs: now,
      expiresAtMs: now + (SUPPORT_CHAT_HOURS * 60 * 60 * 1000)
    });
    localToast('info', 'Escreva a primeira mensagem para abrir o chat do pedido.');
    openChatModalWithChat(order, draft);
  } catch (err) { console.error(err); localToast('error', 'Não foi possível abrir o chat do pedido.'); }
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
    await Promise.all([loadProducts(true), loadSupportReports()]);
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
    await Promise.all([loadProducts(true), loadSupportReports(), loadSupportPanelData()]);
  } catch (err) { console.error(err); localToast('error', 'Não foi possível inativar o vendedor.'); }
}

async function createSupportChatWithSeller(sellerId, sellerName = '', source = 'suporte') {
  const cleanSellerId = String(sellerId || '').trim();
  if (!cleanSellerId || !isSupportAdmin) return;
  try {
    const id = `suporte_vendedor_${cleanSellerId}`;
    const ref = doc(lojaDb, CHAT_COLLECTION, id);
    const snap = await getDoc(ref);
    if (snap.exists() && !isChatExpired({ id: snap.id, ...snap.data() }) && !isChatClosed({ id: snap.id, ...snap.data() })) { openChatById(snap.id, { id: snap.id, ...snap.data() }); return; }
    const now = Date.now();
    const draft = buildDraftChat({ id, type: CHAT_TYPE_SUPPORT, order: { id: '', produtoTitulo: source === 'denuncia' ? 'Contato sobre denúncia de produto' : 'Contato do suporte' }, sellerId: cleanSellerId, sellerName: sellerName || cleanSellerId, subject: source === 'denuncia' ? 'Contato sobre denúncia de produto' : 'Contato do suporte', source, createdAtMs: now, expiresAtMs: now + (SUPPORT_CHAT_HOURS * 60 * 60 * 1000) });
    localToast('info', 'Escreva a primeira mensagem para abrir o chat com o vendedor.');
    openChatModalWithChat({ id, produtoTitulo: draft.assunto, sellerId: cleanSellerId, sellerName: draft.sellerName, total: 0 }, draft);
  } catch (err) { console.error(err); localToast('error', 'Não foi possível preparar chat com vendedor.'); }
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
  updateNotificationBadges();
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

async function openDirectSupportChat() {
  if (!currentUser || !ghubProfile?.gameId) { localToast('error', 'Entre na GuildaHub para abrir chat com o suporte.'); return; }
  const gid = String(ghubProfile.gameId || '').trim();
  const id = `suporte_usuario_${gid}`;
  const ref = doc(lojaDb, CHAT_COLLECTION, id);
  try {
    const snap = await getDoc(ref);
    if (snap.exists() && !isChatExpired({ id: snap.id, ...snap.data() }) && !isChatClosed({ id: snap.id, ...snap.data() })) { openChatById(snap.id, { id: snap.id, ...snap.data() }); return; }
    const now = Date.now();
    const draft = buildDraftChat({ id, type: CHAT_TYPE_SUPPORT, order: { id: '', produtoTitulo: 'Chat direto com suporte' }, buyerId: gid, buyerUid: currentUser.uid || '', buyerEmail: normalizeEmail(currentUser.email || ghubProfile.email || ''), buyerName: ghubProfile.nick || '', sellerId: lojaStatus?.vendedor ? gid : '', sellerName: lojaStatus?.vendedor ? (lojaStatus.vendedor.nome || lojaStatus.vendedor.nick || ghubProfile.nick || '') : '', subject: 'Chat direto com suporte', source: 'direto', createdAtMs: now, expiresAtMs: now + (SUPPORT_CHAT_HOURS * 60 * 60 * 1000) });
    localToast('info', 'Escreva a primeira mensagem para abrir o chat com o suporte.');
    openChatModalWithChat({ id, produtoTitulo: 'Chat direto com suporte', buyerId: gid, buyerName: ghubProfile.nick || '', sellerId: draft.sellerId, sellerName: draft.sellerName, total: 0 }, draft);
  } catch (err) { console.error(err); localToast('error', 'Não foi possível preparar chat com o suporte.'); }
}


function openLojaMenu() {
  els.lojaMenuOverlay?.classList.remove('hidden');
  els.lojaMenuDrawer?.classList.remove('translate-x-full');
  els.lojaMenuDrawer?.classList.add('translate-x-0');
}

function closeLojaMenu() {
  els.lojaMenuOverlay?.classList.add('hidden');
  els.lojaMenuDrawer?.classList.add('translate-x-full');
  els.lojaMenuDrawer?.classList.remove('translate-x-0');
}

async function openAutoPagePanel() {
  if (lojaPageMode === 'compras') {
    openBuyerModal();
    return;
  }

  if (lojaPageMode === 'painel_vendedor') {
    await openSellerPanel();
    return;
  }

  if (lojaPageMode === 'suporte') {
    openSupportModal();
  }
}

function bindEvents() {
  qs('btn-logout')?.addEventListener('click', logout);
  setupSidebar();

  els.lojaMenuBtn?.addEventListener('click', openLojaMenu);
  els.lojaMenuOverlay?.addEventListener('click', closeLojaMenu);
  document.querySelectorAll('[data-close-loja-menu]').forEach((btn) => btn.addEventListener('click', closeLojaMenu));

  els.search?.addEventListener('input', applyFilters);
  els.category?.addEventListener('change', applyFilters);

  els.clearFiltersBtn?.addEventListener('click', () => {
    if (els.search) els.search.value = '';
    if (els.category) els.category.value = '';
    applyFilters();
  });

  els.buyerProfileBtn?.addEventListener('click', openBuyerModal);
  els.supportPanelBtn?.addEventListener('click', openSupportModal);
  els.reloadSupportPanelBtn?.addEventListener('click', () => loadSupportPanelData({ force: true }));
  els.supportSellerSearchBtn?.addEventListener('click', searchSupportSellers);
  els.supportProductSearchBtn?.addEventListener('click', searchSupportProducts);
  els.supportOrderSearchBtn?.addEventListener('click', searchSupportOrders);
  els.supportSellerSearch?.addEventListener('keydown', (event) => { if (event.key === 'Enter') searchSupportSellers(); });
  els.supportProductSearch?.addEventListener('keydown', (event) => { if (event.key === 'Enter') searchSupportProducts(); });
  els.supportOrderSearch?.addEventListener('keydown', (event) => { if (event.key === 'Enter') searchSupportOrders(); });
  els.floatingSupportBtn?.addEventListener('click', openDirectSupportChat);
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
  els.reloadSellerDataBtn?.addEventListener('click', () => reloadSellerPanelData(true));
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
  resetSellerOrdersPagination();
  resetBuyerOrdersPagination();
  supportChats = [];
  supportVerifications = [];
  supportReports = [];
  supportWithdrawals = [];
  supportRefundRequests = [];
  supportSellerResults = [];
  supportProductResults = [];
  supportOrderResults = [];
  buyerRatings = [];
  isSupportAdmin = false;

  if (!currentUser) {
    applySidebarUser(null);
    renderSellerTop();
    renderSupportTop();
    return;
  }

  try {
    const profileCacheKey = getCurrentUserCacheKey();
    const cachedProfile = lojaCacheGet('ghubProfile', LOJA_CACHE_TTL.PROFILE, profileCacheKey);
    ghubProfile = cachedProfile || await findGuildaHubProfile(currentUser);
    if (ghubProfile) lojaCacheSet('ghubProfile', ghubProfile, profileCacheKey);
    applySidebarUser(ghubProfile);
    renderSellerTop();
    await loadStoreStatus();
    await loadSupportAdminStatus();
    if (lojaPageMode === 'suporte' && !isSupportAdmin) {
      const target = qs('loja-page-placeholder');
      if (target) {
        target.innerHTML = '<div class="rounded-3xl border border-red-100 bg-red-50 p-5 text-sm font-bold text-red-800">Acesso restrito. O painel de suporte da lojinha só fica disponível para administradores.</div>';
      }
      updateNotificationBadges();
      return;
    }
    if (lojaPageMode === 'compras') {
      await loadBuyerOrders({ reset: true });
    } else {
      loadBuyerOrders({ reset: true, silent: true }).catch(() => null);
    }
    if (lojaStatus?.vendedor) {
      if (lojaPageMode === 'painel_vendedor') {
        await Promise.all([loadSellerOrders({ reset: true }), loadSellerChats()]);
        renderSellerOrders();
        renderSellerSupportChats();
      } else {
        loadSellerOrders({ reset: true, silent: true }).catch(() => null);
        loadSellerChats().then(() => { renderSellerOrders(); renderSellerSupportChats(); }).catch(() => null);
      }
    }
    if (isSupportAdmin && lojaPageMode === 'suporte') await loadSupportPanelData();
    updateNotificationBadges();
    if (lojaPageMode !== 'store') {
      setTimeout(() => openAutoPagePanel(), 50);
    }
  } catch (err) {
    console.error(err);
    applySidebarUser(null);
    renderSellerTop();
    renderSupportTop();
    localToast('error', 'Não foi possível carregar seu perfil da GuildaHub.');
  }
}

export async function initLojaPage(pageMode = 'store') {
  lojaPageMode = String(pageMode || document.body?.dataset?.lojaPage || 'store');

  bindEvents();
  initIcons();
  renderSellerTop();
  renderSupportTop();

  await loadCategories();

  if (lojaPageMode === 'store') {
    await loadProducts();
  } else {
    setProductsLoading(false);
  }

  onAuthStateChanged(auth, handleAuthState);
}

