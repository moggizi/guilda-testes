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

const els = {
  topSellerBtn: qs('btn-top-seller'),
  topSellerAvatarWrap: qs('seller-top-avatar-wrap'),
  topSellerAvatar: qs('seller-top-avatar'),
  topSellerAvatarIcon: qs('seller-top-avatar-icon'),
  sellerProfileBtn: qs('btn-seller-profile'),

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

  sellerModal: qs('seller-modal'),
  sellerModalSubtitle: qs('seller-modal-subtitle'),
  sellerProfileCard: qs('seller-profile-card'),
  sellerForm: qs('seller-product-form'),
  sellerTitle: qs('seller-product-title'),
  sellerPrice: qs('seller-product-price'),
  sellerStock: qs('seller-product-stock'),
  sellerImage: qs('seller-product-image'),
  sellerDescription: qs('seller-product-description'),
  sellerActive: qs('seller-product-active'),
  sellerFeatured: qs('seller-product-featured'),
  saveSellerProductBtn: qs('btn-save-seller-product'),
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
let loadingProducts = false;
let loadingStatus = false;
let loadingSellerPanel = false;

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
    categoriaId,
    categoriaNome: data.categoriaNome || getCategoryName(categoryId),
    sellerId: String(data.sellerId || data.vendedorId || '').trim(),
    sellerName,
    sellerPhoto: data.sellerPhoto || data.vendedorFoto || '',
    destaque: data.destaque === true,
    ordem: Number(data.ordem || data.order || 999),
    estoqueAtivo,
    estoqueQuantidade,
    disponivel: estoqueAtivo ? estoqueQuantidade > 0 : true,
    ativo: data.ativo !== false
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
    const snap = await getDocs(query(collection(lojaDb, 'produtos'), where('ativo', '==', true)));
    products = snap.docs
      .map(normalizeProduct)
      .sort((a, b) => Number(b.destaque) - Number(a.destaque) || (a.ordem || 999) - (b.ordem || 999) || a.titulo.localeCompare(b.titulo));
  } catch (err) {
    console.error(err);
    products = [];
    localToast('error', 'Não foi possível carregar os produtos da loja. Verifique as regras de leitura do Firebase.');
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
    const stockLabel = product.disponivel
      ? '<span class="inline-flex items-center rounded-full bg-emerald-50 px-2.5 py-1 text-[11px] font-black text-emerald-700 ring-1 ring-emerald-200">DISPONÍVEL</span>'
      : '<span class="inline-flex items-center rounded-full bg-red-50 px-2.5 py-1 text-[11px] font-black text-red-700 ring-1 ring-red-200">ESGOTADO</span>';
    const image = product.imagem
      ? `<img src="${escapeHtml(product.imagem)}" alt="${escapeHtml(product.titulo)}" class="h-full w-full object-cover">`
      : '<i data-lucide="package" class="h-10 w-10 text-gray-300"></i>';

    return `
      <article class="group overflow-hidden rounded-3xl border border-gray-100 bg-white shadow-sm transition hover:-translate-y-0.5 hover:shadow-lg">
        <button type="button" data-open-product="${escapeHtml(product.id)}" class="block w-full text-left">
          <div class="relative h-44 bg-gray-50 flex items-center justify-center overflow-hidden">
            ${image}
            <div class="absolute left-3 top-3 flex flex-wrap gap-2">
              ${stockLabel}
              ${product.destaque ? '<span class="inline-flex items-center rounded-full bg-slate-900 px-2.5 py-1 text-[11px] font-black text-white">DESTAQUE</span>' : ''}
            </div>
          </div>
          <div class="p-4">
            <div class="flex items-start justify-between gap-3">
              <div class="min-w-0">
                <h4 class="line-clamp-2 text-base font-black text-gray-900">${escapeHtml(product.titulo)}</h4>
                <p class="mt-1 text-xs font-bold text-gray-400">${escapeHtml(product.sellerName)}</p>
              </div>
              <span class="shrink-0 rounded-full bg-gray-50 px-2.5 py-1 text-[11px] font-black text-gray-500 ring-1 ring-gray-200">${escapeHtml(product.categoriaNome)}</span>
            </div>
            <p class="mt-3 line-clamp-2 min-h-[40px] text-sm text-gray-500">${escapeHtml(product.descricao || 'Produto disponível na loja.')}</p>
            <div class="mt-4 flex items-center justify-between gap-3">
              <p class="text-xl font-black text-emerald-700">${moneyBRL(product.preco)}</p>
              <span class="inline-flex items-center gap-1 rounded-xl bg-emerald-600 px-3 py-2 text-xs font-black text-white group-hover:bg-emerald-700">
                Ver <i data-lucide="chevron-right" class="w-3.5 h-3.5"></i>
              </span>
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

function openProductModal(productId) {
  const product = products.find((item) => String(item.id) === String(productId));
  if (!product || !els.productModal || !els.productModalBody || !els.productModalTitle) return;

  els.productModalTitle.textContent = product.titulo;
  const image = product.imagem
    ? `<img src="${escapeHtml(product.imagem)}" alt="${escapeHtml(product.titulo)}" class="h-56 w-full rounded-3xl object-cover border border-gray-100 bg-gray-50">`
    : '<div class="h-56 w-full rounded-3xl border border-gray-100 bg-gray-50 flex items-center justify-center"><i data-lucide="package" class="h-12 w-12 text-gray-300"></i></div>';

  const statusHtml = product.disponivel
    ? '<span class="inline-flex items-center rounded-full bg-emerald-50 px-2.5 py-1 text-[11px] font-black text-emerald-700 ring-1 ring-emerald-200">DISPONÍVEL</span>'
    : '<span class="inline-flex items-center rounded-full bg-red-50 px-2.5 py-1 text-[11px] font-black text-red-700 ring-1 ring-red-200">ESGOTADO</span>';

  els.productModalBody.innerHTML = `
    ${image}
    <div>
      <div class="flex flex-wrap items-center gap-2">${statusHtml}<span class="inline-flex items-center rounded-full bg-gray-50 px-2.5 py-1 text-[11px] font-black text-gray-500 ring-1 ring-gray-200">${escapeHtml(product.categoriaNome)}</span></div>
      <h4 class="mt-3 text-2xl font-black text-gray-900">${escapeHtml(product.titulo)}</h4>
      <p class="mt-1 text-sm font-bold text-gray-400">Vendedor: ${escapeHtml(product.sellerName)}</p>
      <p class="mt-4 text-sm leading-relaxed text-gray-600">${escapeHtml(product.descricao || 'Produto disponível na loja.')}</p>
      <p class="mt-5 text-3xl font-black text-emerald-700">${moneyBRL(product.preco)}</p>
    </div>
    <button type="button" data-buy-product="${escapeHtml(product.id)}" class="w-full rounded-2xl bg-slate-900 px-5 py-4 text-sm font-black text-white shadow-lg shadow-slate-900/10 hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50">
      Comprar agora
    </button>
  `;

  els.productModal.classList.remove('hidden');
  els.productModal.classList.add('flex');
  els.productModalBody.querySelector('[data-buy-product]')?.addEventListener('click', () => createOrder(product.id));
  initIcons();
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

  if (!currentUser) {
    localToast('error', 'Entre na GuildaHub para comprar.');
    return;
  }

  if (!ghubProfile?.gameId) {
    localToast('error', 'Conclua seu perfil da GuildaHub antes de comprar.');
    return;
  }

  if (!product.disponivel) {
    localToast('error', 'Esse produto está esgotado.');
    return;
  }

  const btn = els.productModalBody?.querySelector('[data-buy-product]');
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<i data-lucide="loader-2" class="inline w-4 h-4 animate-spin mr-2"></i> Criando pedido...';
    initIcons();
  }

  try {
    const buyer = lojaStatus?.comprador || await ensureBuyerProfile({ silent: true });
    if (!buyer) throw new Error('buyer-required');

    const orderPayload = {
      buyerId: ghubProfile.gameId,
      buyerUid: currentUser.uid || '',
      buyerEmail: normalizeEmail(currentUser.email || ghubProfile.email || ''),
      buyerName: ghubProfile.nick || '',
      buyerNick: ghubProfile.nick || '',
      buyerPhoto: ghubProfile.foto || '',

      sellerId: product.sellerId || 'ghub',
      sellerName: product.sellerName || 'GuildaHub',
      sellerPhoto: product.sellerPhoto || '',

      produtoId: product.id,
      produtoTitulo: product.titulo,
      produtoImagem: product.imagem || '',
      categoriaId: product.categoriaId || '',
      categoriaNome: product.categoriaNome || '',

      quantidade: 1,
      precoUnitario: Number(product.preco || 0),
      total: Number(product.preco || 0),
      moeda: product.moeda || 'BRL',

      status: 'pendente',
      pagamento: {
        metodo: 'pix',
        provider: '',
        status: 'pendente',
        paymentId: '',
        qrCode: '',
        copiaCola: '',
        aprovadoEm: null,
        reembolsadoEm: null
      },
      entrega: {
        tipo: product.entregaTipo || 'manual',
        status: 'aguardando_pagamento',
        observacao: '',
        entregueEm: null,
        canceladoEm: null
      },

      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    };

    const orderRef = await addDoc(collection(lojaDb, 'pedidos'), orderPayload);
    closeProductModal();
    localToast('success', 'Pedido criado: ' + orderRef.id);
  } catch (err) {
    console.error(err);
    localToast('error', 'Não foi possível criar o pedido. Confira se as regras do Firebase da loja permitem escrita.');
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = 'Comprar agora';
    }
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

  if (!seller) {
    els.sellerProfileCard.innerHTML = '<p class="text-sm font-bold text-red-700">Perfil de vendedor não encontrado.</p>';
    return;
  }

  const photo = seller.foto || ghubProfile?.foto || '';
  els.sellerProfileCard.innerHTML = `
    <div class="flex items-start gap-3">
      <div class="h-14 w-14 shrink-0 overflow-hidden rounded-2xl bg-emerald-50 ring-1 ring-emerald-100 flex items-center justify-center text-emerald-700">
        ${photo ? `<img src="${escapeHtml(photo)}" alt="" class="h-full w-full object-cover">` : '<i data-lucide="user" class="w-6 h-6"></i>'}
      </div>
      <div class="min-w-0 flex-1">
        <div class="flex items-center gap-2 flex-wrap">
          <p class="font-black text-gray-900 truncate">${escapeHtml(seller.nome || seller.nick || 'Vendedor')}</p>
          <span class="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-1 text-[11px] font-black text-emerald-700 ring-1 ring-emerald-200"><i data-lucide="badge-check" class="w-3.5 h-3.5"></i> VENDEDOR</span>
        </div>
        <p class="mt-1 text-xs font-semibold text-gray-400">ID: ${escapeHtml(seller.id || seller.gameId || ghubProfile?.gameId || '-')}</p>
        <p class="mt-1 text-xs font-semibold text-gray-400 truncate">${escapeHtml(seller.email || currentUser?.email || '')}</p>
      </div>
    </div>
  `;
  initIcons();
}

async function loadSellerProducts() {
  const sellerId = ghubProfile?.gameId;
  if (!sellerId) return;

  try {
    const snap = await getDocs(query(collection(lojaDb, 'produtos'), where('sellerId', '==', sellerId)));
    sellerProducts = snap.docs.map(normalizeProduct).sort((a, b) => a.titulo.localeCompare(b.titulo));
  } catch (err) {
    console.error(err);
    sellerProducts = [];
    localToast('error', 'Não foi possível carregar seus produtos.');
  }

  renderSellerProducts();
}

async function loadSellerOrders() {
  const sellerId = ghubProfile?.gameId;
  if (!sellerId) return;

  try {
    const snap = await getDocs(query(collection(lojaDb, 'pedidos'), where('sellerId', '==', sellerId)));
    sellerOrders = snap.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => {
      const ad = Number(a?.createdAt?.seconds || 0);
      const bd = Number(b?.createdAt?.seconds || 0);
      return bd - ad;
    });
  } catch (err) {
    console.error(err);
    sellerOrders = [];
    localToast('error', 'Não foi possível carregar seus pedidos.');
  }

  renderSellerOrders();
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
        <div class="mt-3 flex gap-2">
          <button type="button" data-toggle-product="${escapeHtml(product.id)}" data-next-active="${product.ativo ? 'false' : 'true'}" class="flex-1 rounded-xl border border-gray-200 bg-white px-3 py-2 text-xs font-black text-gray-600 hover:bg-gray-50">
            ${product.ativo ? 'Pausar' : 'Ativar'}
          </button>
        </div>
      </div>
    `;
  }).join('');

  els.sellerProductsList.querySelectorAll('[data-toggle-product]').forEach((btn) => {
    btn.addEventListener('click', () => toggleSellerProduct(btn.getAttribute('data-toggle-product') || '', btn.getAttribute('data-next-active') === 'true'));
  });

  initIcons();
}

function getOrderStatusClass(status) {
  const s = String(status || '').toLowerCase();
  if (s === 'entregue') return 'bg-emerald-50 text-emerald-700 ring-emerald-200';
  if (s === 'cancelado' || s === 'reembolsado') return 'bg-red-50 text-red-700 ring-red-200';
  if (s === 'pago' || s === 'em_entrega') return 'bg-sky-50 text-sky-700 ring-sky-200';
  return 'bg-amber-50 text-amber-700 ring-amber-200';
}

function renderSellerOrders() {
  if (els.sellerOrdersCounter) {
    const total = sellerOrders.length;
    els.sellerOrdersCounter.textContent = total === 1 ? '1 pedido recebido' : `${total} pedidos recebidos`;
  }

  if (!els.sellerOrdersList) return;
  if (!sellerOrders.length) {
    els.sellerOrdersList.innerHTML = '<div class="rounded-2xl border border-dashed border-gray-200 bg-gray-50 p-4 text-sm font-semibold text-gray-500 text-center">Nenhum pedido recebido ainda.</div>';
    return;
  }

  els.sellerOrdersList.innerHTML = sellerOrders.map((order) => {
    const status = String(order.status || 'pendente').toLowerCase();
    return `
      <div class="rounded-2xl border border-gray-100 bg-gray-50 p-3">
        <div class="flex items-start justify-between gap-3">
          <div class="min-w-0">
            <p class="font-black text-sm text-gray-900 truncate">${escapeHtml(order.produtoTitulo || 'Produto')}</p>
            <p class="mt-1 text-xs font-bold text-gray-400">Pedido: ${escapeHtml(order.id)}</p>
            <p class="mt-1 text-xs font-semibold text-gray-500">Comprador: ${escapeHtml(order.buyerName || order.buyerNick || order.buyerId || '-')}</p>
          </div>
          <span class="shrink-0 rounded-full px-2.5 py-1 text-[10px] font-black ring-1 ${getOrderStatusClass(status)}">${escapeHtml(status.toUpperCase())}</span>
        </div>
        <div class="mt-3 flex items-center justify-between gap-3">
          <p class="text-base font-black text-emerald-700">${moneyBRL(order.total || order.precoUnitario || 0)}</p>
          <div class="flex flex-wrap justify-end gap-2">
            <button type="button" data-order-action="entregue" data-order-id="${escapeHtml(order.id)}" class="rounded-xl bg-emerald-600 px-3 py-2 text-xs font-black text-white hover:bg-emerald-700">Entregue</button>
            <button type="button" data-order-action="cancelado" data-order-id="${escapeHtml(order.id)}" class="rounded-xl border border-gray-200 bg-white px-3 py-2 text-xs font-black text-gray-600 hover:bg-gray-50">Cancelar</button>
            <button type="button" data-order-action="reembolsado" data-order-id="${escapeHtml(order.id)}" class="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs font-black text-red-700 hover:bg-red-100">Reembolso</button>
          </div>
        </div>
      </div>
    `;
  }).join('');

  els.sellerOrdersList.querySelectorAll('[data-order-action]').forEach((btn) => {
    btn.addEventListener('click', () => updateOrderStatus(btn.getAttribute('data-order-id') || '', btn.getAttribute('data-order-action') || ''));
  });
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
  const image = String(els.sellerImage?.value || '').trim();
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

  setButtonLoading(els.saveSellerProductBtn, true, 'Cadastrar produto');

  try {
    const seller = lojaStatus.vendedor;
    const payload = {
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
      categoriaId,
      categoriaNome: categoryName,
      tipoProduto: 'digital',
      entregaTipo: 'manual',
      estoqueAtivo: true,
      estoqueQuantidade: stock,
      ativo,
      destaque,
      visualizacoes: 0,
      totalVendas: 0,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    };

    const productRef = await addDoc(collection(lojaDb, 'produtos'), payload);
    await setDoc(productRef, { id: productRef.id }, { merge: true });

    await setDoc(doc(lojaDb, 'vendedor', ghubProfile.gameId), {
      totalProdutos: sellerProducts.length + 1,
      updatedAt: serverTimestamp()
    }, { merge: true });

    els.sellerForm?.reset();
    if (els.sellerStock) els.sellerStock.value = '1';
    if (els.sellerActive) els.sellerActive.checked = true;

    localToast('success', 'Produto cadastrado na loja.');
    await Promise.all([loadProducts(), loadSellerProducts()]);
  } catch (err) {
    console.error(err);
    localToast('error', 'Não foi possível cadastrar o produto. Confira se as regras do Firebase permitem escrita.');
  } finally {
    setButtonLoading(els.saveSellerProductBtn, false, 'Cadastrar produto');
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
  if (order && String(order.sellerId) !== String(ghubProfile?.gameId || '')) {
    localToast('error', 'Esse pedido não pertence ao seu vendedor.');
    return;
  }

  const updates = {
    status: action,
    updatedAt: serverTimestamp()
  };

  if (action === 'entregue') {
    updates.entrega = {
      ...(order?.entrega || {}),
      status: 'entregue',
      entregueEm: serverTimestamp()
    };
  }

  if (action === 'cancelado') {
    updates.entrega = {
      ...(order?.entrega || {}),
      status: 'cancelado',
      canceladoEm: serverTimestamp()
    };
  }

  if (action === 'reembolsado') {
    updates.pagamento = {
      ...(order?.pagamento || {}),
      status: 'reembolsado',
      reembolsadoEm: serverTimestamp()
    };
    updates.entrega = {
      ...(order?.entrega || {}),
      status: 'reembolso_emitido'
    };
  }

  try {
    await setDoc(doc(lojaDb, 'pedidos', orderId), updates, { merge: true });
    localToast('success', action === 'reembolsado' ? 'Pedido marcado como reembolsado.' : `Pedido marcado como ${action}.`);
    await loadSellerOrders();
  } catch (err) {
    console.error(err);
    localToast('error', 'Não foi possível atualizar o pedido.');
  }
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

  els.topSellerBtn?.addEventListener('click', handleTopSellerClick);
  els.sellerProfileBtn?.addEventListener('click', openSellerPanel);
  els.sellerForm?.addEventListener('submit', handleSellerProductSubmit);
  els.reloadSellerDataBtn?.addEventListener('click', reloadSellerPanelData);

  document.querySelectorAll('[data-close-product-modal]').forEach((btn) => {
    btn.addEventListener('click', closeProductModal);
  });

  document.querySelectorAll('[data-close-seller-modal]').forEach((btn) => {
    btn.addEventListener('click', closeSellerModal);
  });

  window.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    closeProductModal();
    closeSellerModal();
  });
}

async function handleAuthState(user) {
  currentUser = user || null;
  ghubProfile = null;
  lojaStatus = { comprador: null, vendedor: null };
  sellerProducts = [];
  sellerOrders = [];

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
