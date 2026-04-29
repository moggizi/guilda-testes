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
  refreshBtn: qs('btn-refresh-store'),
  profileTitle: qs('store-profile-title'),
  profileBox: qs('store-profile-box'),
  syncBuyerBtn: qs('btn-sync-buyer'),
  requestSellerBtn: qs('btn-request-seller'),
  search: qs('store-search'),
  category: qs('store-category'),
  clearFiltersBtn: qs('btn-clear-filters'),
  chips: qs('category-chips'),
  counter: qs('products-counter'),
  loading: qs('products-loading'),
  empty: qs('products-empty'),
  grid: qs('products-grid'),
  modal: qs('product-modal'),
  modalTitle: qs('modal-product-title'),
  modalBody: qs('modal-product-body'),
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
let loadingProducts = false;
let loadingStatus = false;

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

async function loadStoreStatus() {
  if (!currentUser || !ghubProfile?.gameId) {
    lojaStatus = { comprador: null, vendedor: null };
    renderStoreProfile();
    return;
  }

  loadingStatus = true;
  renderStoreProfile();

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
    renderStoreProfile();
  }
}

function renderStoreProfile() {
  const readyBuyer = !!lojaStatus?.comprador;
  const readySeller = !!lojaStatus?.vendedor;

  if (!currentUser) {
    if (els.profileTitle) els.profileTitle.textContent = 'Entre para comprar';
    if (els.profileBox) {
      els.profileBox.innerHTML = '<p class="font-semibold text-gray-700">A vitrine é pública, mas a compra exige login na GuildaHub.</p><p class="mt-1 text-xs text-gray-400">Entre na sua conta e volte para criar o perfil de comprador.</p>';
    }
    if (els.syncBuyerBtn) els.syncBuyerBtn.disabled = true;
    if (els.requestSellerBtn) els.requestSellerBtn.disabled = true;
    return;
  }

  if (!ghubProfile?.gameId) {
    if (els.profileTitle) els.profileTitle.textContent = 'Perfil sem ID de jogo';
    if (els.profileBox) {
      els.profileBox.innerHTML = '<p class="font-semibold text-red-700">Não encontrei o ID do seu perfil da GuildaHub.</p><p class="mt-1 text-xs text-gray-400">Conclua seu perfil antes de usar a loja.</p><a href="perfil.html" class="mt-3 inline-flex rounded-xl bg-slate-900 px-4 py-2 text-xs font-bold text-white">Abrir perfil</a>';
    }
    if (els.syncBuyerBtn) els.syncBuyerBtn.disabled = true;
    if (els.requestSellerBtn) els.requestSellerBtn.disabled = true;
    return;
  }

  if (els.profileTitle) {
    els.profileTitle.textContent = loadingStatus
      ? 'Verificando cadastro...'
      : readyBuyer || readySeller
        ? `ID ${ghubProfile.gameId}`
        : 'Cadastre-se na loja';
  }

  const buyerBadge = readyBuyer
    ? '<span class="inline-flex items-center rounded-full bg-emerald-50 px-2.5 py-1 text-[11px] font-black text-emerald-700 ring-1 ring-emerald-200">COMPRADOR ATIVO</span>'
    : '<span class="inline-flex items-center rounded-full bg-gray-50 px-2.5 py-1 text-[11px] font-black text-gray-500 ring-1 ring-gray-200">SEM COMPRADOR</span>';

  const sellerStatus = String(lojaStatus?.vendedor?.status || '').toLowerCase();
  const sellerBadge = readySeller
    ? `<span class="inline-flex items-center rounded-full ${sellerStatus === 'pendente' ? 'bg-amber-50 text-amber-700 ring-amber-200' : 'bg-slate-900 text-white ring-slate-900'} px-2.5 py-1 text-[11px] font-black ring-1">${sellerStatus === 'pendente' ? 'VENDEDOR PENDENTE' : 'VENDEDOR'}</span>`
    : '<span class="inline-flex items-center rounded-full bg-gray-50 px-2.5 py-1 text-[11px] font-black text-gray-500 ring-1 ring-gray-200">SEM VENDEDOR</span>';

  if (els.profileBox) {
    els.profileBox.innerHTML = `
      <div class="flex items-start gap-3">
        <div class="h-11 w-11 shrink-0 overflow-hidden rounded-2xl bg-emerald-50 ring-1 ring-emerald-100 flex items-center justify-center text-emerald-700">
          ${ghubProfile.foto ? `<img src="${escapeHtml(ghubProfile.foto)}" alt="" class="h-full w-full object-cover">` : '<i data-lucide="user" class="w-5 h-5"></i>'}
        </div>
        <div class="min-w-0 flex-1">
          <p class="font-black text-gray-900 truncate">${escapeHtml(ghubProfile.nick || 'Sem nick')}</p>
          <p class="mt-0.5 text-xs font-semibold text-gray-400">ID: ${escapeHtml(ghubProfile.gameId)}</p>
          <div class="mt-3 flex flex-wrap gap-2">${buyerBadge}${sellerBadge}</div>
        </div>
      </div>
    `;
  }

  if (els.syncBuyerBtn) {
    els.syncBuyerBtn.disabled = loadingStatus || readyBuyer;
    els.syncBuyerBtn.innerHTML = readyBuyer
      ? '<i data-lucide="check-circle" class="w-4 h-4"></i> Comprador ativo'
      : '<i data-lucide="user-plus" class="w-4 h-4"></i> Criar comprador';
  }

  if (els.requestSellerBtn) {
    els.requestSellerBtn.disabled = loadingStatus || readySeller;
    els.requestSellerBtn.innerHTML = readySeller
      ? '<i data-lucide="check-circle" class="w-4 h-4"></i> Vendedor cadastrado'
      : '<i data-lucide="store" class="w-4 h-4"></i> Quero vender';
  }

  initIcons();
}

function normalizeCategoryId(value) {
  return String(value || '').trim().toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
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

function getProductCategoryId(product) {
  return normalizeCategoryId(product.categoriaId || product.categoryId || product.categoria || product.category || '');
}

function getCategoryName(categoryId) {
  if (!categoryId) return 'Sem categoria';
  return categories.find((cat) => cat.id === categoryId)?.nome || categoryId;
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
    destaque: data.destaque === true,
    ordem: Number(data.ordem || data.order || 999),
    estoqueAtivo,
    estoqueQuantidade,
    disponivel: estoqueAtivo ? estoqueQuantidade > 0 : true
  };
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
  if (!product || !els.modal || !els.modalBody || !els.modalTitle) return;

  els.modalTitle.textContent = product.titulo;
  const image = product.imagem
    ? `<img src="${escapeHtml(product.imagem)}" alt="${escapeHtml(product.titulo)}" class="h-56 w-full rounded-3xl object-cover border border-gray-100 bg-gray-50">`
    : '<div class="h-56 w-full rounded-3xl border border-gray-100 bg-gray-50 flex items-center justify-center"><i data-lucide="package" class="h-12 w-12 text-gray-300"></i></div>';

  const statusHtml = product.disponivel
    ? '<span class="inline-flex items-center rounded-full bg-emerald-50 px-2.5 py-1 text-[11px] font-black text-emerald-700 ring-1 ring-emerald-200">DISPONÍVEL</span>'
    : '<span class="inline-flex items-center rounded-full bg-red-50 px-2.5 py-1 text-[11px] font-black text-red-700 ring-1 ring-red-200">ESGOTADO</span>';

  els.modalBody.innerHTML = `
    ${image}
    <div>
      <div class="flex flex-wrap items-center gap-2">${statusHtml}<span class="inline-flex items-center rounded-full bg-gray-50 px-2.5 py-1 text-[11px] font-black text-gray-500 ring-1 ring-gray-200">${escapeHtml(product.categoriaNome)}</span></div>
      <h4 class="mt-3 text-2xl font-black text-gray-900">${escapeHtml(product.titulo)}</h4>
      <p class="mt-1 text-sm font-bold text-gray-400">Vendedor: ${escapeHtml(product.sellerName)}</p>
      <p class="mt-4 text-sm leading-relaxed text-gray-600">${escapeHtml(product.descricao || 'Produto disponível na loja.')}</p>
      <p class="mt-5 text-3xl font-black text-emerald-700">${moneyBRL(product.preco)}</p>
    </div>
    <div class="rounded-2xl border border-emerald-100 bg-emerald-50 p-4 text-xs font-semibold leading-relaxed text-emerald-800">
      A compra exige login na GuildaHub. Se você ainda não tiver perfil de comprador na loja, ele será criado automaticamente com seu ID do jogo.
    </div>
    <button type="button" data-buy-product="${escapeHtml(product.id)}" class="w-full rounded-2xl bg-slate-900 px-5 py-4 text-sm font-black text-white shadow-lg shadow-slate-900/10 hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50">
      Comprar agora
    </button>
  `;

  els.modal.classList.remove('hidden');
  els.modal.classList.add('flex');
  els.modalBody.querySelector('[data-buy-product]')?.addEventListener('click', () => createOrder(product.id));
  initIcons();
}

function closeProductModal() {
  els.modal?.classList.add('hidden');
  els.modal?.classList.remove('flex');
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
  renderStoreProfile();

  if (!silent) localToast('success', buyerSnap.exists() ? 'Perfil de comprador atualizado.' : 'Perfil de comprador criado.');
  return lojaStatus.comprador;
}

async function syncBuyer() {
  setButtonLoading(els.syncBuyerBtn, true, '<i data-lucide="user-plus" class="w-4 h-4"></i> Criar comprador');

  try {
    await ensureBuyerProfile({ silent: false });
  } catch (err) {
    console.error(err);
    localToast('error', 'Não foi possível criar o comprador. Confira se as regras do Firebase da loja permitem escrita.');
  } finally {
    renderStoreProfile();
  }
}

async function requestSeller() {
  if (!currentUser) {
    localToast('error', 'Entre na GuildaHub para solicitar cadastro como vendedor.');
    return;
  }

  let payload;
  try {
    payload = getProfilePayload();
  } catch (_) {
    localToast('error', 'Conclua seu perfil da GuildaHub antes de solicitar vendedor.');
    return;
  }

  setButtonLoading(els.requestSellerBtn, true, '<i data-lucide="store" class="w-4 h-4"></i> Quero vender');

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
      status: existing?.status || 'pendente',
      ativo: existing?.ativo === true,
      verificado: existing?.verificado === true,
      totalProdutos: Number(existing?.totalProdutos || 0),
      totalVendas: Number(existing?.totalVendas || 0),
      updatedAt: serverTimestamp(),
      ...(existing?.createdAt ? {} : { createdAt: serverTimestamp() })
    };

    await setDoc(sellerRef, sellerPayload, { merge: true });
    lojaStatus.vendedor = { id: payload.gameId, ...sellerPayload };
    renderStoreProfile();
    localToast('success', sellerSnap.exists() ? 'Cadastro de vendedor atualizado.' : 'Solicitação de vendedor criada.');
  } catch (err) {
    console.error(err);
    localToast('error', 'Não foi possível solicitar cadastro como vendedor. Confira se as regras do Firebase da loja permitem escrita.');
  } finally {
    renderStoreProfile();
  }
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

  const btn = els.modalBody?.querySelector('[data-buy-product]');
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
        aprovadoEm: null
      },
      entrega: {
        tipo: product.entregaTipo || 'manual',
        status: 'aguardando_pagamento',
        observacao: '',
        entregueEm: null
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

function bindEvents() {
  qs('btn-logout')?.addEventListener('click', logout);
  setupSidebar();

  els.refreshBtn?.addEventListener('click', async () => {
    await Promise.all([loadCategories(), loadProducts(), loadStoreStatus()]);
    localToast('success', 'Loginha atualizada.');
  });

  els.search?.addEventListener('input', applyFilters);
  els.category?.addEventListener('change', applyFilters);

  els.clearFiltersBtn?.addEventListener('click', () => {
    if (els.search) els.search.value = '';
    if (els.category) els.category.value = '';
    applyFilters();
  });

  els.syncBuyerBtn?.addEventListener('click', syncBuyer);
  els.requestSellerBtn?.addEventListener('click', requestSeller);

  document.querySelectorAll('[data-close-product-modal]').forEach((btn) => {
    btn.addEventListener('click', closeProductModal);
  });

  window.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') closeProductModal();
  });
}

async function handleAuthState(user) {
  currentUser = user || null;
  ghubProfile = null;
  lojaStatus = { comprador: null, vendedor: null };

  if (!currentUser) {
    applySidebarUser(null);
    renderStoreProfile();
    return;
  }

  try {
    ghubProfile = await findGuildaHubProfile(currentUser);
    applySidebarUser(ghubProfile);
    renderStoreProfile();
    await loadStoreStatus();
  } catch (err) {
    console.error(err);
    applySidebarUser(null);
    renderStoreProfile();
    localToast('error', 'Não foi possível carregar seu perfil da GuildaHub.');
  }
}

(async function boot() {
  bindEvents();
  initIcons();
  renderStoreProfile();

  await loadCategories();
  await loadProducts();

  onAuthStateChanged(auth, handleAuthState);
})();
