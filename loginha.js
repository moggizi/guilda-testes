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

const els = {
  topSellerBtn: qs('btn-top-seller'),
  topSellerAvatarWrap: qs('seller-top-avatar-wrap'),
  topSellerAvatar: qs('seller-top-avatar'),
  topSellerAvatarIcon: qs('seller-top-avatar-icon'),
  sellerProfileBtn: qs('btn-seller-profile'),
  buyerProfileBtn: qs('btn-buyer-profile'),

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
  els.productModalTitle.textContent = product.titulo;
  const image = product.imagem
    ? `<img src="${escapeHtml(product.imagem)}" alt="${escapeHtml(product.titulo)}" class="h-56 w-full rounded-3xl object-cover border border-gray-100 bg-gray-50">`
    : '<div class="h-56 w-full rounded-3xl border border-gray-100 bg-gray-50 flex items-center justify-center"><i data-lucide="package" class="h-12 w-12 text-gray-300"></i></div>';
  const statusHtml = product.disponivel
    ? '<span class="inline-flex items-center rounded-full bg-emerald-50 px-2.5 py-1 text-[11px] font-black text-emerald-700 ring-1 ring-emerald-200">DISPONÍVEL</span>'
    : '<span class="inline-flex items-center rounded-full bg-red-50 px-2.5 py-1 text-[11px] font-black text-red-700 ring-1 ring-red-200">ESGOTADO</span>';
  const buyerInfoHtml = categoryRequiresBuyerInfo(product.categoriaId) ? `
    <div class="rounded-2xl border border-amber-200 bg-amber-50 p-3">
      <label for="buyer-order-info" class="block text-xs font-black uppercase tracking-wider text-amber-800 mb-1.5">Informações para o pedido</label>
      <textarea id="buyer-order-info" rows="3" maxlength="300" class="w-full resize-none rounded-xl border border-amber-200 bg-white px-3 py-2 text-sm font-semibold outline-none focus:ring-2 focus:ring-amber-200" placeholder="${escapeHtml(getBuyerInfoLabel(product.categoriaId))}"></textarea>
      <p class="mt-1 text-xs font-semibold text-amber-800">Obrigatório para essa categoria.</p>
    </div>` : '';
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
      <p id="modal-seller-sales" class="mt-1 text-xs font-black text-emerald-700">Carregando vendas do vendedor...</p>
      <p class="mt-4 text-sm leading-relaxed text-gray-600">${escapeHtml(product.descricao || 'Produto disponível na loja.')}</p>
      <p class="mt-5 text-3xl font-black text-emerald-700">${moneyBRL(product.preco)}</p>
    </div>
    ${buyerInfoHtml}
    <button type="button" data-buy-product="${escapeHtml(product.id)}" class="w-full rounded-2xl bg-slate-900 px-5 py-4 text-sm font-black text-white shadow-lg shadow-slate-900/10 hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50">Comprar agora</button>`;
  els.productModal.classList.remove('hidden');
  els.productModal.classList.add('flex');
  els.productModalBody.querySelector('[data-buy-product]')?.addEventListener('click', () => createOrder(product.id));
  initIcons();
  const stats = await getSellerPublicStats(product.sellerId);
  const salesEl = qs('modal-seller-sales');
  if (salesEl) {
    const total = Number(stats.totalVendasEntregues || 0);
    salesEl.textContent = total === 1 ? 'Vendedor com 1 venda entregue' : `Vendedor com ${total} vendas entregues`;
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

  const seller = await createOrUpdateSellerProfile();
  if (seller) await openSellerPanel();
}

async function createOrder(productId) {
  const product = products.find((item) => String(item.id) === String(productId));
  if (!product) return;
  if (!currentUser) { localToast('error', 'Entre na GuildaHub para comprar.'); return; }
  if (!ghubProfile?.gameId) { localToast('error', 'Conclua seu perfil da GuildaHub antes de comprar.'); return; }
  if (!product.disponivel) { localToast('error', 'Esse produto está esgotado.'); return; }
  const buyerInfoText = String(qs('buyer-order-info')?.value || '').trim();
  if (categoryRequiresBuyerInfo(product.categoriaId) && !buyerInfoText) {
    localToast('error', 'Envie as informações necessárias para esse pedido.');
    qs('buyer-order-info')?.focus();
    return;
  }
  const btn = els.productModalBody?.querySelector('[data-buy-product]');
  if (btn) { btn.disabled = true; btn.innerHTML = '<i data-lucide="loader-2" class="inline w-4 h-4 animate-spin mr-2"></i> Criando pedido...'; initIcons(); }
  try {
    const buyer = lojaStatus?.comprador || await ensureBuyerProfile({ silent: true });
    if (!buyer) throw new Error('buyer-required');
    const productRef = doc(lojaDb, 'produtos', product.id);
    const orderRef = doc(collection(lojaDb, 'pedidos'));
    await runTransaction(lojaDb, async (transaction) => {
      const productSnap = await transaction.get(productRef);
      if (!productSnap.exists()) throw new Error('product-not-found');
      const currentProduct = normalizeProduct(productSnap);
      if (currentProduct.ativo === false) throw new Error('product-inactive');
      const estoqueAtual = Number(currentProduct.estoqueQuantidade ?? 0);
      if (currentProduct.estoqueAtivo !== false && estoqueAtual <= 0) throw new Error('out-of-stock');
      transaction.set(orderRef, {
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
        buyerInfoRequired: categoryRequiresBuyerInfo(currentProduct.categoriaId),
        buyerInfo: buyerInfoText,
        buyerInfoUpdatedAtMs: buyerInfoText ? Date.now() : null,
        deliveryInfoRequired: categoryRequiresSellerDeliveryInfo(currentProduct.categoriaId),
        deliveryInfo: '',
        deliveryInfoUpdatedAtMs: null,
        status: 'pendente',
        finalizado: false,
        pagamento: { metodo: 'pix', provider: '', status: 'pendente', paymentId: '', qrCode: '', copiaCola: '', aprovadoEm: null, reembolsadoEm: null },
        entrega: { tipo: currentProduct.entregaTipo || 'manual', status: 'aguardando_pagamento', observacao: '', informacoes: '', entregueEm: null, entregueEmMs: null, canceladoEm: null },
        createdAt: serverTimestamp(),
        createdAtMs: Date.now(),
        updatedAt: serverTimestamp()
      });
      if (currentProduct.estoqueAtivo !== false) transaction.set(productRef, { estoqueQuantidade: Math.max(0, estoqueAtual - 1), updatedAt: serverTimestamp() }, { merge: true });
    });
    closeProductModal();
    localToast('success', 'Pedido criado: ' + orderRef.id);
    await Promise.all([loadProducts(), loadBuyerOrders()]);
  } catch (err) {
    console.error(err);
    localToast('error', err?.message === 'out-of-stock' ? 'Esse produto ficou sem estoque.' : 'Não foi possível criar o pedido. Confira se as regras do Firebase da loja permitem escrita.');
  } finally {
    if (btn) { btn.disabled = false; btn.innerHTML = 'Comprar agora'; }
  }
}

function openSellerModal() {
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
  if (!sellerOrders.length) { els.sellerOrdersList.innerHTML = '<div class="rounded-2xl border border-dashed border-gray-200 bg-gray-50 p-4 text-sm font-semibold text-gray-500 text-center">Nenhum pedido recebido ainda.</div>'; return; }
  els.sellerOrdersList.innerHTML = sellerOrders.map((order) => {
    const status = String(order.status || 'pendente').toLowerCase();
    const locked = isFinalOrderStatus(status) || order.finalizado === true;
    const created = formatDateTimeBR(order.createdAtMs || order.createdAt);
    const needsSellerInfo = categoryRequiresSellerDeliveryInfo(order.categoriaId);
    const needsBuyerInfo = categoryRequiresBuyerInfo(order.categoriaId);
    const currentDeliveryInfo = order.deliveryInfo || order.entrega?.informacoes || '';
    const buyerInfo = order.buyerInfo || '';
    return `<div class="rounded-2xl border border-gray-100 bg-gray-50 p-3"><div class="flex items-start justify-between gap-3"><div class="min-w-0"><p class="font-black text-sm text-gray-900 truncate">${escapeHtml(order.produtoTitulo || 'Produto')}</p><p class="mt-1 text-xs font-bold text-gray-400">Pedido: ${escapeHtml(order.id)}</p><p class="mt-1 text-xs font-semibold text-gray-500">Comprador: ${escapeHtml(order.buyerName || order.buyerNick || '-')}</p><p class="mt-1 text-xs font-semibold text-gray-500">ID comprador: ${escapeHtml(order.buyerId || '-')}</p><p class="mt-1 text-xs font-semibold text-gray-500">Data: ${escapeHtml(created)}</p></div><span class="shrink-0 rounded-full px-2.5 py-1 text-[10px] font-black ring-1 ${getOrderStatusClass(status)}">${escapeHtml(status.toUpperCase())}</span></div>${needsBuyerInfo ? `<div class="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3"><p class="text-[10px] font-black uppercase tracking-wider text-amber-800">Informações do comprador</p><p class="mt-1 whitespace-pre-wrap text-xs font-semibold text-amber-900">${escapeHtml(buyerInfo || 'Ainda não informado.')}</p></div>` : ''}${needsSellerInfo ? `<div class="mt-3"><label class="block text-[10px] font-black uppercase tracking-wider text-gray-400 mb-1">Informações para entregar ao comprador</label><textarea data-delivery-info-for="${escapeHtml(order.id)}" rows="3" maxlength="500" ${locked ? 'readonly' : ''} class="w-full resize-none rounded-xl border border-gray-200 bg-white px-3 py-2 text-xs font-semibold outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100" placeholder="${escapeHtml(getSellerDeliveryInfoLabel(order.categoriaId))}">${escapeHtml(currentDeliveryInfo)}</textarea></div>` : ''}<div class="mt-3 flex items-center justify-between gap-3"><p class="text-base font-black text-emerald-700">${moneyBRL(order.total || order.precoUnitario || 0)}</p><div class="flex flex-wrap justify-end gap-2">${locked ? '<span class="rounded-xl bg-gray-100 px-3 py-2 text-xs font-black text-gray-500">Finalizado</span>' : `<button type="button" data-order-action="entregue" data-order-id="${escapeHtml(order.id)}" class="rounded-xl bg-emerald-600 px-3 py-2 text-xs font-black text-white hover:bg-emerald-700">Entregue</button><button type="button" data-order-action="reembolsado" data-order-id="${escapeHtml(order.id)}" class="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs font-black text-red-700 hover:bg-red-100">Reembolso</button>`}</div></div></div>`;
  }).join('');
  els.sellerOrdersList.querySelectorAll('[data-order-action]').forEach((btn) => btn.addEventListener('click', () => updateOrderStatus(btn.getAttribute('data-order-id') || '', btn.getAttribute('data-order-action') || '')));
}

async function openSellerPanel() {
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
    await Promise.all([loadSellerProducts(), loadSellerOrders()]);
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

async function loadBuyerOrders() {
  if (!currentUser || !ghubProfile?.gameId) { buyerOrders = []; renderBuyerOrders(); return; }
  if (els.buyerOrdersList) els.buyerOrdersList.innerHTML = '<div class="rounded-2xl border border-gray-100 bg-gray-50 p-4 text-sm font-semibold text-gray-500 text-center">Carregando compras...</div>';
  try {
    const snap = await getDocs(query(collection(lojaDb, 'pedidos'), where('buyerId', '==', String(ghubProfile.gameId))));
    buyerOrders = snap.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => Number(b?.createdAtMs || b?.createdAt?.seconds || 0) - Number(a?.createdAtMs || a?.createdAt?.seconds || 0));
  } catch (err) { console.error('Erro ao carregar compras:', err?.code || err?.message || err, err); buyerOrders = []; localToast('error', `Não foi possível carregar suas compras. Erro: ${err?.code || err?.message || 'verifique as regras/índices'}`); }
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
    return `<div class="rounded-2xl border border-gray-100 bg-gray-50 p-4"><div class="flex items-start justify-between gap-3"><div class="min-w-0"><p class="font-black text-sm text-gray-900 truncate">${escapeHtml(order.produtoTitulo || 'Produto')}</p><p class="mt-1 text-xs font-bold text-gray-400">Pedido: ${escapeHtml(order.id)}</p><p class="mt-1 text-xs font-semibold text-gray-500">Vendedor: ${escapeHtml(order.sellerName || order.sellerId || '-')}</p><p class="mt-1 text-xs font-semibold text-gray-500">Data: ${escapeHtml(created)}</p></div><span class="shrink-0 rounded-full px-2.5 py-1 text-[10px] font-black ring-1 ${getOrderStatusClass(status)}">${escapeHtml(status.toUpperCase())}</span></div><div class="mt-3 flex items-center justify-between gap-3"><p class="text-base font-black text-emerald-700">${moneyBRL(order.total || order.precoUnitario || 0)}</p><span class="rounded-full bg-gray-100 px-2.5 py-1 text-[10px] font-black text-gray-500">${escapeHtml(order.categoriaNome || order.categoriaId || 'Categoria')}</span></div>${needsBuyerInfo ? `<div class="mt-3"><label class="block text-[10px] font-black uppercase tracking-wider text-gray-400 mb-1">Suas informações para entrega</label><textarea data-buyer-info-for="${escapeHtml(order.id)}" rows="3" maxlength="300" ${locked ? 'readonly' : ''} class="w-full resize-none rounded-xl border border-gray-200 bg-white px-3 py-2 text-xs font-semibold outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100" placeholder="${escapeHtml(getBuyerInfoLabel(order.categoriaId))}">${escapeHtml(buyerInfo)}</textarea>${locked ? '' : `<button type="button" data-save-buyer-info="${escapeHtml(order.id)}" class="mt-2 rounded-xl bg-slate-900 px-3 py-2 text-xs font-black text-white hover:bg-slate-800">Salvar informações</button>`}</div>` : ''}${needsSellerInfo ? `<div class="mt-3 rounded-xl border ${deliveryInfo ? 'border-emerald-200 bg-emerald-50' : 'border-amber-200 bg-amber-50'} p-3"><p class="text-[10px] font-black uppercase tracking-wider ${deliveryInfo ? 'text-emerald-800' : 'text-amber-800'}">Informações recebidas do vendedor</p><p class="mt-1 whitespace-pre-wrap text-xs font-semibold ${deliveryInfo ? 'text-emerald-900' : 'text-amber-900'}">${escapeHtml(deliveryInfo || 'Aguardando o vendedor enviar as informações.')}</p></div>` : ''}</div>`;
  }).join('');
  els.buyerOrdersList.querySelectorAll('[data-save-buyer-info]').forEach((btn) => btn.addEventListener('click', () => updateBuyerOrderInfo(btn.getAttribute('data-save-buyer-info') || '')));
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

  document.querySelectorAll('[data-close-product-modal]').forEach((btn) => {
    btn.addEventListener('click', closeProductModal);
  });

  document.querySelectorAll('[data-close-seller-modal]').forEach((btn) => {
    btn.addEventListener('click', closeSellerModal);
  });

  document.querySelectorAll('[data-close-buyer-modal]').forEach((btn) => {
    btn.addEventListener('click', closeBuyerModal);
  });

  window.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    closeProductModal();
    closeSellerModal();
    closeBuyerModal();
  });
}

async function handleAuthState(user) {
  currentUser = user || null;
  ghubProfile = null;
  lojaStatus = { comprador: null, vendedor: null };
  sellerProducts = [];
  sellerOrders = [];
  buyerOrders = [];

  if (!currentUser) {
    applySidebarUser(null);
    renderSellerTop();
    return;
  }

  try {
    ghubProfile = await findGuildaHubProfile(currentUser);
    applySidebarUser(ghubProfile);
    renderSellerTop();
    await loadStoreStatus();
    await loadBuyerOrders();
  } catch (err) {
    console.error(err);
    applySidebarUser(null);
    renderSellerTop();
    localToast('error', 'Não foi possível carregar seu perfil da GuildaHub.');
  }
}

(async function boot() {
  bindEvents();
  initIcons();
  renderSellerTop();

  await loadCategories();
  await loadProducts();

  onAuthStateChanged(auth, handleAuthState);
})();
