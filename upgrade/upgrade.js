import { checkAuth, setupSidebar, initIcons, logout, getVipTier, showToast, getGuildContext, auth, db } from '../logic.js?v=upgrade-admin-20260517';
import { collection, getDocs } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';

setupSidebar();
initIcons();

const PLANS_CACHE_KEY = 'plans_upgrade_cache_v3';
const PLANS_CACHE_TTL_MS = 5 * 60 * 1000;
const DEFAULT_PLANS = [
  {
    id: 'free',
    name: 'FREE',
    price: 0,
    period: 'monthly',
    order: 0,
    visible: true,
    active: true,
    purchasable: false,
    access: ['Dashboard', 'Membros', 'Configuração de tag'],
    noAccess: ['Administradores + Líderes', 'Lines', 'Estatísticas', 'Recrutamento (BETA)', 'Multi-guilda (BETA)', 'Atualizar pontos por print', 'Eventos/Camp']
  },
  {
    id: 'plus',
    name: 'PLUS',
    price: 6.99,
    period: 'monthly',
    order: 10,
    visible: true,
    active: true,
    purchasable: true,
    access: ['Dashboard', 'Membros', 'Configuração de tag', 'Administradores + Líderes', 'Lines', 'Estatísticas'],
    noAccess: ['Recrutamento (BETA)', 'Multi-guilda (BETA)', 'Atualizar pontos por print', 'Eventos/Camp']
  },
  {
    id: 'pro',
    name: 'PRO',
    price: 9.99,
    period: 'monthly',
    order: 20,
    visible: true,
    active: true,
    purchasable: true,
    popular: true,
    badge: 'Popular',
    access: ['Dashboard', 'Membros', 'Configuração de tag', 'Administradores + Líderes', 'Lines', 'Estatísticas', 'Recrutamento (BETA)', 'Multi-guilda (BETA)', 'Atualizar pontos por print', 'Eventos/Camp'],
    noAccess: []
  },
  {
    id: 'business',
    name: 'BUSINESS',
    price: 99.9,
    period: 'yearly',
    order: 30,
    visible: true,
    active: true,
    purchasable: true,
    access: ['Tudo do PRO'],
    noAccess: [],
    note: 'Mesmo acesso do PRO em cobrança anual.'
  },
  {
    id: 'ultra',
    name: 'ULTRA',
    price: 14.99,
    period: 'monthly',
    order: 40,
    visible: true,
    active: true,
    purchasable: true,
    badge: 'Mais completo',
    access: ['Tudo do PRO', 'Prioridade em novos recursos', 'Limites ampliados'],
    noAccess: []
  },
  {
    id: 'parceiro',
    name: 'PARCEIRO',
    price: 0,
    period: 'partner',
    order: 50,
    visible: true,
    active: true,
    purchasable: false,
    badge: 'Manual',
    access: ['Quase todas as funções VIP enquanto a parceria estiver ativa'],
    noAccess: ['Comissão por esse benefício'],
    note: 'Benefício para quem divulga a Guilda HUB. Pode ser removido se a parceria parar ou não trouxer resultado.'
  }
];

let plansState = computeDiscounts(sortPlansForDisplay(DEFAULT_PLANS));
let plansLoaded = false;

function normalizeTier(raw) {
  const s = (raw || 'free').toString().toLowerCase().trim();
  if (s.includes('vital') || s.includes('life') || s.includes('parceiro') || s.includes('partner')) return 'parceiro';
  if (s.includes('ultra')) return 'ultra';
  if (s.includes('buss') || s.includes('business')) return 'business';
  if (s.includes('pro')) return 'pro';
  if (s.includes('plus')) return 'plus';
  return s || 'free';
}

function prettyTierName(tier) {
  return normalizeTier(tier).toUpperCase();
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function toMoney(value, fallback = 0) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const clean = String(value ?? '').replace(/[^0-9,.-]/g, '').replace(/\.(?=\d{3}(\D|$))/g, '').replace(',', '.');
  const parsed = Number(clean);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function formatMoney(value) {
  return toMoney(value).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function field(data, names, fallback = undefined) {
  for (const name of names) {
    if (Object.prototype.hasOwnProperty.call(data || {}, name) && data[name] !== undefined) return data[name];
  }
  return fallback;
}

function boolField(data, names, fallback) {
  const value = field(data, names, undefined);
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value === 'boolean') return value;
  const s = String(value).toLowerCase().trim();
  if (['1', 'true', 'sim', 'yes', 'ativo', 'enabled'].includes(s)) return true;
  if (['0', 'false', 'nao', 'não', 'no', 'inativo', 'disabled'].includes(s)) return false;
  return fallback;
}

function listField(data, names, fallback = []) {
  const value = field(data, names, undefined);
  if (Array.isArray(value)) return value.map((x) => String(x || '').trim()).filter(Boolean);
  if (typeof value === 'string') return value.split(/\r?\n|;/g).map((x) => x.trim()).filter(Boolean);
  return fallback;
}

function canonicalPlanId(id) {
  const s = String(id || '').toLowerCase().trim();
  if (s.includes('vital') || s.includes('life') || s.includes('parceiro') || s.includes('partner')) return 'parceiro';
  if (s.includes('ultra')) return 'ultra';
  if (s.includes('buss') || s.includes('business') || s.includes('anual')) return 'business';
  if (s.includes('pro')) return 'pro';
  if (s.includes('plus')) return 'plus';
  if (s.includes('free')) return 'free';
  return s;
}

function isAddonDoc(id, data = {}) {
  const type = String(field(data, ['type', 'tipo', 'kind'], '') || '').toLowerCase();
  const s = String(id || '').toLowerCase();
  return type.includes('adicional') || type.includes('addon') || type.includes('extra') || s.includes('adicional') || s.includes('addon') || s.includes('extra');
}

function priceLabel(plan) {
  if (plan.price <= 0 && plan.period === 'partner') return 'Benefício manual';
  if (plan.price <= 0) return 'R$0 / mês';
  if (plan.period === 'yearly') return `${formatMoney(plan.price)} / ano`;
  if (plan.period === 'once') return `${formatMoney(plan.price)} pagamento único`;
  return `${formatMoney(plan.price)} / mês`;
}

function hydratePlan(id, data = {}) {
  const planId = canonicalPlanId(id);
  const base = DEFAULT_PLANS.find((p) => p.id === planId) || { id: planId, name: planId.toUpperCase(), access: [], noAccess: [], order: 999, active: true, visible: true, purchasable: true };
  const period = String(field(data, ['period', 'periodo', 'ciclo'], base.period || 'monthly')).toLowerCase();
  const price = toMoney(field(data, ['price', 'preco', 'valor', 'amount'], base.price), base.price);
  const forcedNotPurchasable = planId === 'free' || planId === 'parceiro';
  const plan = {
    ...base,
    id: planId,
    sourceId: id,
    name: String(field(data, ['name', 'nome', 'titulo', 'title'], base.name || planId.toUpperCase())),
    description: String(field(data, ['description', 'descricao', 'subtitulo'], base.description || '')),
    price,
    period,
    order: Number(field(data, ['order', 'ordem', 'posicao'], base.order || 999)) || 999,
    active: boolField(data, ['active', 'ativo', 'enabled'], base.active !== false),
    visible: boolField(data, ['visible', 'visivel', 'show', 'mostrar'], base.visible !== false),
    purchasable: forcedNotPurchasable ? false : boolField(data, ['purchasable', 'vendavel', 'compravel', 'checkout', 'allowCheckout'], base.purchasable !== false),
    popular: boolField(data, ['popular', 'destaque'], base.popular === true),
    badge: String(field(data, ['badge', 'tag', 'selo'], base.badge || '')),
    access: listField(data, ['access', 'libera', 'beneficios', 'features', 'inclui'], base.access || []),
    noAccess: listField(data, ['noAccess', 'naoLibera', 'bloqueia', 'semAcesso'], base.noAccess || []),
    fullAccessText: String(field(data, ['fullAccessText', 'textoAcesso', 'accessText'], base.fullAccessText || '')),
    note: String(field(data, ['note', 'nota', 'observacao', 'obs'], base.note || '')),
    warning: String(field(data, ['warning', 'aviso', 'alerta', 'checkoutWarning', 'avisoCheckout'], base.warning || ''))
  };
  plan.priceLabel = String(field(data, ['priceLabel', 'valorLabel', 'precoLabel'], '')) || priceLabel(plan);
  return plan;
}

function computeDiscounts(plans) {
  const pro = plans.find((p) => p.id === 'pro');
  const fullMonthly = Number(pro?.price || 9.99);
  const fullAnnual = fullMonthly * 12;

  return plans.map((p) => {
    let discount = 0;
    if (p.id === 'free') discount = 100;
    else if (p.id === 'plus' && fullMonthly > 0) discount = Math.round((1 - (p.price / fullMonthly)) * 100);
    else if (p.id === 'business' && fullAnnual > 0) discount = Math.round((1 - (p.price / fullAnnual)) * 100);
    return { ...p, discount: discount > 0 ? discount : 0 };
  });
}

function sortPlansForDisplay(plans) {
  return [...plans].sort((a, b) => {
    if (a.id === 'free' && b.id !== 'free') return -1;
    if (b.id === 'free' && a.id !== 'free') return 1;
    if (a.id === 'parceiro' && b.id !== 'parceiro') return 1;
    if (b.id === 'parceiro' && a.id !== 'parceiro') return -1;
    const priceDiff = Number(a.price || 0) - Number(b.price || 0);
    if (priceDiff !== 0) return priceDiff;
    return (Number(a.order || 0) - Number(b.order || 0)) || String(a.name || a.id).localeCompare(String(b.name || b.id));
  });
}

function readPlansCache() {
  try {
    const raw = localStorage.getItem(PLANS_CACHE_KEY);
    const cached = raw ? JSON.parse(raw) : null;
    if (!cached?.plans || !Array.isArray(cached.plans)) return null;
    if (Date.now() - Number(cached.ts || 0) > PLANS_CACHE_TTL_MS) return null;
    return cached.plans;
  } catch (_) {
    return null;
  }
}

function writePlansCache(plans) {
  try {
    localStorage.setItem(PLANS_CACHE_KEY, JSON.stringify({ ts: Date.now(), plans }));
  } catch (_) {}
}

function addonsForPlan() {
  return [];
}

async function loadPlansFromFirebase() {
  const cached = readPlansCache();
  if (cached?.length) {
    plansState = computeDiscounts(sortPlansForDisplay(cached));
    plansLoaded = true;
    render();
  }

  try {
    const snap = await getDocs(collection(db, 'planos'));
    const map = new Map(DEFAULT_PLANS.map((p) => [p.id, { ...p }]));

    snap.forEach((docSnap) => {
      const raw = docSnap.data() || {};
      if (isAddonDoc(docSnap.id, raw)) return;
      const plan = hydratePlan(docSnap.id, raw);
      map.set(plan.id, { ...(map.get(plan.id) || {}), ...plan });
    });

    plansState = computeDiscounts(sortPlansForDisplay(Array.from(map.values()).filter((p) => p.visible !== false && p.active !== false)));
    writePlansCache(plansState);
    plansLoaded = true;
    render();
  } catch (error) {
    plansLoaded = !!cached?.length;
    console.warn('Falha ao carregar planos do Firebase:', error);
    if (!cached?.length) showToast('info', 'Usando dados padrÃ£o dos planos. O valor final do PIX continua sendo conferido no servidor.');
    render();
  }
}

function statusLabelFromMp(status) {
  const s = (status || '').toString().toLowerCase();
  if (s === 'approved') return 'aprovado';
  if (s === 'pending' || s === 'in_process') return 'pendente';
  if (s === 'rejected') return 'recusado';
  if (s === 'cancelled' || s === 'expired' || s === 'refunded' || s === 'charged_back') return 'expirado';
  return s || 'pendente';
}

function badgeClass(status) {
  const s = statusLabelFromMp(status);
  if (s === 'aprovado') return 'bg-emerald-50 text-emerald-700 ring-emerald-200';
  if (s === 'pendente') return 'bg-amber-50 text-amber-700 ring-amber-200';
  if (s === 'recusado') return 'bg-rose-50 text-rose-700 ring-rose-200';
  return 'bg-gray-100 text-gray-700 ring-gray-200';
}

async function createPixPayment(planId, cpf) {
  const user = auth.currentUser;
  if (!user) throw new Error('Você precisa estar logado.');

  const ctx = await getGuildContext();
  const guildId = String(ctx?.guildId || '');
  const email = String(user.email || '');
  const uid = String(user.uid || '');

  if (!guildId || !email || !uid) throw new Error('Dados ausentes (uid/email/guildId).');

  const idToken = await user.getIdToken(true);

  const res = await fetch('/api/mp_create_pix', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${idToken}`
    },
    body: JSON.stringify({ plano: planId, guildId, cpf })
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error || 'Falha ao criar pagamento.');
  return data;
}

async function fetchPaymentStatus(paymentId) {
  const res = await fetch(`/api/mp_status?paymentId=${encodeURIComponent(paymentId)}`, { method: 'GET' });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error || 'Falha ao consultar status.');
  return data;
}

function ensureModalRoot() {
  let root = document.getElementById('upgrade-modal-root');
  if (root) return root;
  root = document.createElement('div');
  root.id = 'upgrade-modal-root';
  document.body.appendChild(root);
  return root;
}

function closeModals() {
  const root = document.getElementById('upgrade-modal-root');
  if (root) root.innerHTML = '';
}

function modalShell(innerHtml) {
  return `
    <div class="fixed inset-0 z-[9999]">
      <div class="absolute inset-0 bg-black/40 backdrop-blur-sm transition-all" data-close="1"></div>
      <div class="absolute inset-0 flex items-end sm:items-center justify-center p-4">
        <div class="w-full max-w-lg bg-white rounded-3xl shadow-2xl border border-gray-100 overflow-hidden animate-in fade-in zoom-in duration-200">
          ${innerHtml}
        </div>
      </div>
    </div>
  `;
}

function openInfoModal(type) {
  const root = ensureModalRoot();
  const isTerms = type === 'terms';
  const title = isTerms ? 'Termos dos planos' : 'Privacidade e dados do pagamento';
  const body = isTerms ? `
    <div class="space-y-4 text-sm text-gray-700 leading-6">
      <div class="rounded-xl border border-emerald-100 bg-emerald-50 p-3">
        <p><b>Planos pagos:</b> os planos ativos no Firebase são liberados pelo prazo configurado. O valor final do PIX é sempre calculado no servidor com base na coleção <b>planos</b>.</p>
      </div>
      <div>
        <div class="font-extrabold text-gray-900 mb-1">1. Plano Parceiro</div>
        <p>O plano Parceiro é um benefício manual para quem divulga a Guilda HUB. Ele não é uma assinatura paga, não gera comissão de afiliado e pode ser removido caso a parceria pare ou não traga bom resultado.</p>
      </div>
      <div>
        <div class="font-extrabold text-gray-900 mb-1">2. Avisos por plano</div>
        <p>Alguns recursos podem estar em beta ou ter condições específicas. Quando existir aviso no plano, ele aparecerá antes da assinatura e deve ser lido antes de gerar o PIX.</p>
      </div>
      <div>
        <div class="font-extrabold text-gray-900 mb-1">3. Liberação do acesso</div>
        <p>Depois da confirmação do pagamento, a liberação normalmente ocorre em poucos segundos para a conta/guilda vinculada à compra.</p>
      </div>
      <div>
        <div class="font-extrabold text-gray-900 mb-1">4. Reembolso</div>
        <p>Pedidos de análise devem ser feitos pelo suporte. Cada caso será avaliado individualmente.</p>
      </div>
    </div>
  ` : `
    <div class="space-y-4 text-sm text-gray-700 leading-6">
      <div class="rounded-xl border border-slate-200 bg-slate-50 p-3">
        <p>Usamos somente os dados necessários para identificar a compra, gerar o PIX e liberar o plano corretamente.</p>
      </div>
      <div><div class="font-extrabold text-gray-900 mb-1">Dados usados</div><p>E-mail, UID, guilda, plano, status e identificador do pagamento.</p></div>
      <div><div class="font-extrabold text-gray-900 mb-1">Pagamentos</div><p>O processamento é feito pelo Mercado Pago. O CPF é enviado apenas para gerar a cobrança PIX.</p></div>
      <div><div class="font-extrabold text-gray-900 mb-1">Suporte</div><p>Os registros em solicita são usados para conferir pagamento, taxas, afiliado e liberação do acesso.</p></div>
    </div>
  `;

  root.innerHTML = modalShell(`
    <div class="p-4 border-b border-gray-100 flex items-center justify-between gap-3">
      <div>
        <div class="text-sm font-extrabold text-gray-900">${title}</div>
        <div class="text-xs text-gray-500 mt-0.5">Leia com atenção as informações abaixo.</div>
      </div>
      <button class="p-2 rounded-lg hover:bg-gray-50 text-gray-500" data-close="1"><i data-lucide="x" class="w-5 h-5"></i></button>
    </div>
    <div class="p-4 max-h-[80vh] overflow-y-auto">${body}</div>
  `);

  root.querySelectorAll('[data-close="1"]').forEach((el) => el.addEventListener('click', closeModals));
  initIcons();
}

function planById(planId) {
  const normalized = canonicalPlanId(planId);
  return plansState.find((p) => p.id === normalized) || DEFAULT_PLANS.find((p) => p.id === normalized);
}

window.requestUpgrade = (planId) => {
  const plan = planById(planId);
  if (!plan) return showToast('error', 'Plano inválido.');
  if (!plan.purchasable) {
    showToast('info', plan.id === 'parceiro' ? 'O plano Parceiro é liberado manualmente pelo chefe.' : 'Este plano não gera pagamento.');
    return;
  }

  const root = ensureModalRoot();
  const addons = addonsForPlan(plan.id);
  const selected = new Set();
  const warningText = String(plan.warning || '').trim();

  function selectedAddons() {
    return addons.filter((a) => selected.has(a.id));
  }

  function totalValue() {
    return plan.price + selectedAddons().reduce((sum, a) => sum + a.price, 0);
  }

  function updateSummary() {
    const total = root.querySelector('#checkout-total');
    const addonsTotal = root.querySelector('#checkout-addons-total');
    if (total) total.textContent = formatMoney(totalValue());
    if (addonsTotal) addonsTotal.textContent = 'Valor confirmado no servidor';
    root.querySelectorAll('[data-addon-card]').forEach((card) => {
      const id = card.getAttribute('data-addon-card');
      card.classList.toggle('ring-2', selected.has(id));
      card.classList.toggle('ring-emerald-200', selected.has(id));
      card.classList.toggle('border-emerald-200', selected.has(id));
    });
  }

  root.innerHTML = modalShell(`
    <div class="p-6">
      <div class="flex items-center gap-3 mb-4">
        <img src="/assets/logo.png" alt="Logo" class="app-logo app-logo--nav">
        <div>
          <h3 class="text-lg font-extrabold text-gray-900">Finalizar ${escapeHtml(plan.name)}</h3>
          <p class="text-xs text-gray-500">Valor conferido no servidor antes do PIX</p>
        </div>
        <button class="ml-auto p-2 rounded-lg hover:bg-gray-100 text-gray-400" data-close="1"><i data-lucide="x" class="w-5 h-5"></i></button>
      </div>

      <div class="rounded-2xl border border-gray-100 bg-gray-50 p-4 mb-4">
        <div class="flex items-start justify-between gap-3">
          <div>
            <p class="text-[10px] font-black text-gray-400 uppercase tracking-wider">Plano</p>
            <p class="font-black text-gray-900">${escapeHtml(plan.name)}</p>
            <p id="checkout-addons-total" class="text-xs text-gray-500 mt-1">Valor confirmado no servidor</p>
          </div>
          <div class="text-right">
            <p class="text-[10px] font-black text-gray-400 uppercase tracking-wider">Total</p>
            <p id="checkout-total" class="text-xl font-black text-emerald-600">${formatMoney(plan.price)}</p>
          </div>
        </div>
      </div>

      ${warningText ? `
        <details class="mb-5 rounded-2xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900 leading-relaxed">
          <summary class="cursor-pointer list-none flex items-center justify-between gap-2 text-xs font-black text-amber-950">
            <span class="inline-flex items-center gap-2"><i data-lucide="triangle-alert" class="w-4 h-4"></i> Aviso deste plano</span>
            <span class="text-[10px] text-amber-700">abrir</span>
          </summary>
          <p class="mt-3 text-xs leading-5">${escapeHtml(warningText)}</p>
          <label class="mt-3 flex items-center gap-2 text-xs font-black text-amber-950">
            <input id="plan-warning-read" type="checkbox" class="rounded border-amber-300">
            Li e entendi o aviso deste plano
          </label>
        </details>
      ` : ''}

      ${addons.length ? `
        <div class="mb-5">
          <div class="flex items-center justify-between gap-2 mb-2">
            <label class="block text-xs font-bold text-gray-400 uppercase tracking-wider">Adicionais</label>
            <span class="text-[10px] text-gray-400 font-bold">Opcional</span>
          </div>
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-2">
            ${addons.map((a) => `
              <button type="button" data-addon-card="${escapeHtml(a.id)}" class="text-left rounded-2xl border border-gray-200 bg-white p-3 hover:bg-gray-50 transition">
                <div class="flex items-start gap-2">
                  <span class="mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-gray-300 text-emerald-600"><i data-lucide="plus" class="w-3 h-3"></i></span>
                  <span class="min-w-0">
                    <span class="block text-xs font-black text-gray-900">${escapeHtml(a.name)}</span>
                    <span class="block text-[11px] text-gray-500">${escapeHtml(a.description || a.priceLabel)}</span>
                    <span class="block mt-1 text-xs font-black text-emerald-700">${formatMoney(a.price)}</span>
                  </span>
                </div>
              </button>
            `).join('')}
          </div>
        </div>
      ` : ''}

      <p class="text-sm text-gray-600 mb-4 leading-relaxed">
        Para sua segurança e conformidade com o sistema de pagamentos, precisamos do seu <b>CPF</b> para gerar o código PIX.
      </p>

      <div class="space-y-4">
        <div>
          <label class="block text-xs font-bold text-gray-400 uppercase tracking-wider mb-2">CPF</label>
          <input type="text" id="input-cpf-field" placeholder="000.000.000-00" class="w-full px-4 py-3 rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 transition-all text-sm font-medium">
        </div>
        <button id="btn-confirm-cpf" class="w-full py-4 rounded-xl bg-emerald-600 text-white font-extrabold text-sm hover:bg-emerald-700 shadow-lg shadow-emerald-200 transition-all flex items-center justify-center gap-2">
          Gerar Código PIX <i data-lucide="arrow-right" class="w-4 h-4"></i>
        </button>
      </div>
    </div>
  `);

  root.querySelectorAll('[data-addon-card]').forEach((card) => {
    card.addEventListener('click', () => {
      const id = card.getAttribute('data-addon-card');
      if (selected.has(id)) selected.delete(id);
      else selected.add(id);
      updateSummary();
    });
  });

  const input = document.getElementById('input-cpf-field');
  const btn = document.getElementById('btn-confirm-cpf');

  input?.addEventListener('input', (e) => {
    let v = e.target.value.replace(/\D/g, '').slice(0, 11);
    if (v.length > 9) v = v.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');
    else if (v.length > 6) v = v.replace(/(\d{3})(\d{3})(\d{3})/, '$1.$2.$3');
    else if (v.length > 3) v = v.replace(/(\d{3})(\d{3})/, '$1.$2');
    e.target.value = v;
  });

  btn.onclick = () => {
    const cpf = input.value.replace(/\D/g, '');
    if (cpf.length !== 11) return showToast('error', 'CPF inválido. Digite os 11 números.');
    if (warningText && !document.getElementById('plan-warning-read')?.checked) {
      return showToast('error', 'Leia e confirme o aviso do plano antes de gerar o PIX.');
    }
    openPaymentModal(plan.id, cpf);
  };

  root.querySelectorAll('[data-close="1"]').forEach((el) => el.addEventListener('click', closeModals));
  updateSummary();
  initIcons();
};

function openPaymentModal(planId, cpf) {
  const plan = canonicalPlanId(planId);
  const planConfig = planById(plan);
  if (!planConfig?.purchasable || Number(planConfig.price || 0) <= 0) {
    showToast('error', 'Plano inválido.');
    return;
  }

  const root = ensureModalRoot();
  root.innerHTML = modalShell(`
    <div class="p-4 border-b border-gray-100 flex items-center justify-between gap-3">
      <div>
        <div class="text-sm font-extrabold text-gray-900">Pagamento via PIX — ${prettyTierName(plan)}</div>
        <div id="pay-subtitle" class="text-xs text-gray-500 mt-0.5">Gerando cobrança...</div>
      </div>
      <button class="p-2 rounded-lg hover:bg-gray-50 text-gray-500" data-close="1"><i data-lucide="x" class="w-5 h-5"></i></button>
    </div>

    <div class="p-4 space-y-4">
      <div class="flex items-center justify-between gap-3">
        <div class="text-xs text-gray-600">Status do pagamento</div>
        <div id="pay-status" class="inline-flex items-center gap-2 px-3 py-1.5 rounded-full ring-1 bg-gray-100 text-gray-700 ring-gray-200 text-xs font-extrabold">
          <span class="w-2 h-2 rounded-full bg-current opacity-70"></span>
          <span id="pay-status-text">pendente</span>
        </div>
      </div>

      <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div class="rounded-2xl border border-gray-200 bg-gray-50 p-4 flex items-center justify-center">
          <div class="text-center">
            <div id="qr-wrap" class="hidden">
              <img id="qr-img" class="mx-auto w-48 h-48 rounded-xl bg-white p-2 border border-gray-200" alt="QR Code PIX">
              <div class="mt-2 text-xs text-gray-600">Aponte a câmera do banco no QR Code</div>
            </div>
            <div id="qr-loading" class="text-sm text-gray-600">Carregando QR Code...</div>
          </div>
        </div>

        <div>
          <label class="text-xs font-bold text-gray-600">PIX Copia e Cola</label>
          <textarea id="pix-code" class="mt-2 w-full h-36 rounded-xl border border-gray-200 bg-gray-50 p-3 text-xs text-gray-800 focus:outline-none focus:ring-2 focus:ring-emerald-200" readonly></textarea>
          <div class="mt-3 flex flex-col sm:flex-row gap-2">
            <button id="btn-copy-pix" class="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-4 py-2 rounded-xl bg-gray-900 text-white text-sm font-bold hover:bg-black transition" disabled>
              <i data-lucide="copy" class="w-4 h-4"></i> Copiar código
            </button>
            <button id="btn-refresh-status" class="w-full sm:flex-1 inline-flex items-center justify-center gap-2 px-4 py-2 rounded-xl bg-emerald-600 text-white text-sm font-extrabold hover:bg-emerald-700 transition" disabled>
              <i data-lucide="refresh-ccw" class="w-4 h-4"></i> Atualizar status
            </button>
          </div>
          <div class="mt-2 text-[11px] text-gray-500">O status muda automaticamente quando o pagamento for aprovado.</div>
        </div>
      </div>
    </div>
  `);

  let pollTimer = null;
  let currentPaymentId = null;

  function setStatus(mpStatus) {
    const label = statusLabelFromMp(mpStatus);
    const pill = root.querySelector('#pay-status');
    const text = root.querySelector('#pay-status-text');
    if (text) text.textContent = label;
    if (pill) pill.className = `inline-flex items-center gap-2 px-3 py-1.5 rounded-full ring-1 text-xs font-extrabold ${badgeClass(mpStatus)}`;
  }

  function stopPoll() {
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = null;
  }

  async function tick() {
    if (!currentPaymentId) return;
    try {
      const data = await fetchPaymentStatus(currentPaymentId);
      setStatus(data.status);
      if (statusLabelFromMp(data.status) === 'aprovado') {
        stopPoll();
        showToast('success', 'Pagamento aprovado! Liberando plano...');
        try {
          const ctx = getGuildContext?.() || {};
          localStorage.removeItem('guildCtx_cache_v1');
          localStorage.removeItem(PLANS_CACHE_KEY);
          if (ctx?.guildId) {
            localStorage.removeItem(`securityConfig_${ctx.guildId}`);
            localStorage.removeItem(`guildGoals_${ctx.guildId}`);
          }
        } catch (_) {}
        setTimeout(() => window.location.href = '/dashboard?login=1&vipRefresh=1', 1200);
      }
    } catch (_) {}
  }

  root.querySelectorAll('[data-close="1"]').forEach((el) => el.addEventListener('click', () => { closeModals(); stopPoll(); }));

  const btnCopy = root.querySelector('#btn-copy-pix');
  const btnRefresh = root.querySelector('#btn-refresh-status');
  btnRefresh.onclick = () => tick();

  (async () => {
    try {
      const data = await createPixPayment(plan, cpf);
      currentPaymentId = data.paymentId;

      const subtitle = root.querySelector('#pay-subtitle');
      if (subtitle && data.amount) subtitle.textContent = `Total seguro: ${formatMoney(data.amount)}`;

      const ta = root.querySelector('#pix-code');
      if (ta) ta.value = data.qrCode || data.copiaECola || '';

      const qrLoading = root.querySelector('#qr-loading');
      const qrWrap = root.querySelector('#qr-wrap');
      const qrImg = root.querySelector('#qr-img');

      if ((data.qrBase64 || data.qrCodeBase64) && qrImg) {
        qrImg.src = `data:image/png;base64,${data.qrBase64 || data.qrCodeBase64}`;
        qrLoading?.classList.add('hidden');
        qrWrap?.classList.remove('hidden');
      } else if (qrLoading) {
        qrLoading.textContent = 'QR Code indisponível. Use o código Copia e Cola.';
      }

      setStatus(data.status || 'pending');
      if (btnCopy) btnCopy.disabled = false;
      if (btnRefresh) btnRefresh.disabled = false;
      if (btnCopy) {
        btnCopy.onclick = () => {
          const txt = (root.querySelector('#pix-code')?.value || '').trim();
          if (!txt) return;
          navigator.clipboard.writeText(txt);
          showToast('success', 'Código PIX copiado.');
        };
      }

      pollTimer = setInterval(tick, 3500);
      await tick();
    } catch (e) {
      showToast('error', e?.message || 'Erro ao gerar pagamento.');
      closeModals();
    } finally {
      initIcons();
    }
  })();

  initIcons();
}

function render() {
  const currentTier = normalizeTier(getVipTier());
  const pillName = document.getElementById('current-plan-name');
  if (pillName) pillName.textContent = prettyTierName(currentTier || 'free');

  const box = document.getElementById('plans');
  if (!box) return;

  box.innerHTML = plansState.map((p) => {
    const isCurrent = p.id === currentTier;
    const border = isCurrent ? 'border-emerald-200 ring-2 ring-emerald-100' : (p.popular ? 'border-emerald-200' : 'border-gray-200');
    const tag = isCurrent
      ? '<span class="px-2 py-1 rounded-lg bg-emerald-50 text-emerald-700 text-[10px] font-bold border border-emerald-200">Atual</span>'
      : (p.badge ? `<span class="px-2 py-1 rounded-lg bg-amber-50 text-amber-700 text-[10px] font-bold border border-amber-100">${escapeHtml(p.badge)}</span>` : '');

    const accessList = (p.access || []).map((x) => `<li class="flex items-start gap-1.5"><i data-lucide="check" class="w-3 h-3 mt-0.5 text-emerald-500"></i><span>${escapeHtml(x)}</span></li>`).join('');
    const noAccessList = (p.noAccess || []).map((x) => `<li class="flex items-start gap-1.5 text-gray-400"><i data-lucide="x" class="w-3 h-3 mt-0.5"></i><span>${escapeHtml(x)}</span></li>`).join('');
    const accessContent = p.fullAccessText
      ? `<div class="text-[10px] text-gray-700 leading-4 bg-emerald-50 border border-emerald-100 rounded-lg p-2">${escapeHtml(p.fullAccessText)}</div>`
      : `<ul class="space-y-1 text-[10px] text-gray-700">${accessList}</ul>`;
    const addons = addonsForPlan(p.id);

    return `
      <div class="bg-white rounded-lg border ${border} p-2 shadow-sm flex flex-col h-full min-w-0">
        <div class="flex items-start justify-between gap-1.5 mb-1 min-h-[28px]">
          <h3 class="text-xs font-extrabold text-gray-900 break-words leading-tight">${escapeHtml(p.name)}</h3>
          ${tag}
        </div>
        <div class="text-sm sm:text-base font-black text-gray-900 leading-tight break-words">${escapeHtml(p.priceLabel || priceLabel(p))}</div>
        ${p.discount > 0 && p.id !== 'free' ? `<div class="text-[10px] text-emerald-600 font-bold mt-1">Economize ${p.discount}%</div>` : ''}
        ${addons.length && p.purchasable ? `<div class="mt-2 text-[10px] text-slate-500 font-bold">${addons.length} adicional${addons.length > 1 ? 'ais' : ''} disponível${addons.length > 1 ? 'eis' : ''}</div>` : ''}
        ${p.warning ? `<details class="mt-2 rounded-lg border border-amber-100 bg-amber-50 px-2 py-1.5 text-[10px] text-amber-900">
          <summary class="cursor-pointer list-none flex items-center justify-between gap-1 font-black">
            <span>Aviso</span><span class="text-amber-700">abrir</span>
          </summary>
          <p class="mt-2 leading-4">${escapeHtml(p.warning)}</p>
        </details>` : ''}

        <div class="mt-3 flex-1">
          <div class="text-[9px] font-bold text-gray-400 uppercase tracking-wider mb-1.5">Acesso</div>
          ${accessContent}
          ${!p.fullAccessText && noAccessList ? `<div class="mt-3 text-[9px] font-bold text-gray-400 uppercase tracking-wider mb-1.5">Sem acesso</div><ul class="space-y-1 text-[10px]">${noAccessList}</ul>` : ''}
        </div>

        ${p.note ? `<div class="mt-3 text-[10px] text-gray-500 italic">${escapeHtml(p.note)}</div>` : ''}
        ${!isCurrent && p.purchasable ? `<button onclick="requestUpgrade('${p.id}')" class="mt-2 w-full py-2 rounded-lg bg-emerald-600 text-white font-bold text-xs hover:bg-emerald-700 transition">Solicitar</button>` : ''}
        ${!p.purchasable && p.id === 'parceiro' ? '<div class="mt-2 w-full py-2 rounded-lg bg-gray-100 text-gray-500 text-center font-bold text-xs">Liberação manual</div>' : ''}
      </div>
    `;
  }).join('');

  const loadNote = document.getElementById('plans-load-note');
  if (loadNote) loadNote.classList.toggle('hidden', plansLoaded);
  initIcons();
}

document.getElementById('open-terms-modal')?.addEventListener('click', () => openInfoModal('terms'));
document.getElementById('open-privacy-modal')?.addEventListener('click', () => openInfoModal('privacy'));

render();

checkAuth().then((user) => {
  if (!user) return;
  document.getElementById('btn-logout').onclick = logout;
  try {
    const tier = normalizeTier(getVipTier());
    const pillName = document.getElementById('current-plan-name');
    if (pillName) pillName.textContent = prettyTierName(tier);
    const vipLabel = document.querySelector('#vip-label span');
    if (vipLabel) vipLabel.textContent = prettyTierName(tier);
  } catch (_) {}
  render();
  loadPlansFromFirebase();
});
