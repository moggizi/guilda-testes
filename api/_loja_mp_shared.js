// api/_loja_mp_shared.js
// Helper seguro para Pix da Loginha via Mercado Pago + Firebase Admin.
// Compatível com Vercel Serverless.
// Recomendado para a loja separada:
// - LOJA_MP_ACCESS_TOKEN
// - LOJA_FIREBASE_SERVICE_ACCOUNT ou LOJA_FIREBASE_SERVICE_ACCOUNT_JSON
// - GHUB_FIREBASE_SERVICE_ACCOUNT ou GHUB_FIREBASE_SERVICE_ACCOUNT_JSON
// A loja NÃO deve cair no FIREBASE_SERVICE_ACCOUNT da API antiga; use LOJA_* para evitar ler o projeto errado.
// Opcional: MP_WEBHOOK_SECRET ou LOJA_MP_WEBHOOK_SECRET.

const admin = require('firebase-admin');
const crypto = require('crypto');

const SELLER_FEE_RATE = 0.06;
const SELLER_FEE_PERCENT = 6;
const SELLER_CHAT_HOURS = 24;

function getEnv(name) {
  const v = process.env[name];
  return (v && String(v).trim()) || '';
}

function hasAnyEnv(names) {
  return names.some((name) => !!getEnv(name));
}

function json(res, status, data) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(data));
}

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Signature, X-Request-Id');
}

function parseServiceAccount(raw, envName) {
  if (!raw) return null;
  try {
    const sa = JSON.parse(raw);
    if (sa.private_key && typeof sa.private_key === 'string') {
      sa.private_key = sa.private_key.replace(/\\n/g, '\n');
    }
    return sa;
  } catch (_) {
    throw new Error(`${envName} inválido: JSON.parse falhou.`);
  }
}

function readServiceAccount(prefix) {
  const candidates = [
    `${prefix}_FIREBASE_SERVICE_ACCOUNT_JSON`,
    `${prefix}_FIREBASE_SERVICE_ACCOUNT`,
  ];

  for (const name of candidates) {
    const raw = getEnv(name);
    if (raw) return parseServiceAccount(raw, name);
  }

  const projectId = getEnv(`${prefix}_FIREBASE_PROJECT_ID`);
  const clientEmail = getEnv(`${prefix}_FIREBASE_CLIENT_EMAIL`);
  const privateKey = getEnv(`${prefix}_FIREBASE_PRIVATE_KEY`);
  if (projectId && clientEmail && privateKey) {
    return {
      project_id: projectId,
      client_email: clientEmail,
      private_key: privateKey.replace(/\\n/g, '\n'),
    };
  }

  return null;
}

function readFallbackServiceAccount() {
  const raw = getEnv('FIREBASE_SERVICE_ACCOUNT') || getEnv('FIREBASE_SERVICE_ACCOUNT_JSON');
  return raw ? parseServiceAccount(raw, raw === getEnv('FIREBASE_SERVICE_ACCOUNT') ? 'FIREBASE_SERVICE_ACCOUNT' : 'FIREBASE_SERVICE_ACCOUNT_JSON') : null;
}

function getAdminApp(appName, prefix, allowFallback = true) {
  const existing = admin.apps.find((app) => app.name === appName);
  if (existing) return existing;

  const serviceAccount = readServiceAccount(prefix) || (allowFallback ? readFallbackServiceAccount() : null);
  if (!serviceAccount) throw new Error(`${prefix}_FIREBASE_SERVICE_ACCOUNT ausente.`);

  return admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    projectId: serviceAccount.project_id,
  }, appName);
}

function getLojaAdmin() {
  const existing = admin.apps.find((app) => app.name === 'loja-ghub-admin');
  if (existing) return existing;

  const serviceAccount = readServiceAccount('LOJA');
  if (!serviceAccount) {
    throw new Error('LOJA_FIREBASE_SERVICE_ACCOUNT ausente. Configure o JSON do Firebase da loja na Vercel.');
  }

  const expectedProjectId = getEnv('LOJA_FIREBASE_EXPECTED_PROJECT_ID') || 'loja-ghub';
  if (expectedProjectId && serviceAccount.project_id !== expectedProjectId) {
    throw new Error(`LOJA_FIREBASE_SERVICE_ACCOUNT aponta para ${serviceAccount.project_id || 'projeto-desconhecido'}, mas a loja esperava ${expectedProjectId}.`);
  }

  return admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    projectId: serviceAccount.project_id,
  }, 'loja-ghub-admin');
}

function getGhubAdmin() {
  // A autenticação vem do Firebase principal usado em logic.js.
  // Se GHUB_* não existir, usa FIREBASE_SERVICE_ACCOUNT como fallback.
  return getAdminApp('ghub-main-admin', 'GHUB', true);
}

function getLojaDb() {
  return getLojaAdmin().firestore();
}

function getGhubDb() {
  return getGhubAdmin().firestore();
}

function normalizeEmail(v) {
  return String(v || '').trim().toLowerCase();
}

function normalizeDigits(v) {
  return String(v || '').replace(/\D+/g, '');
}

function normalizeCategoryId(value) {
  return String(value || '').trim().toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function toLabel(mpStatus) {
  const s = String(mpStatus || '').toLowerCase();
  if (s === 'approved') return 'aprovado';
  if (s === 'pending' || s === 'in_process') return 'pendente';
  if (s === 'rejected') return 'recusado';
  if (s === 'cancelled' || s === 'canceled' || s === 'expired' || s === 'refunded' || s === 'charged_back') return 'expirado';
  return 'pendente';
}

function mapPaymentStatus(status) {
  const s = String(status || '').toLowerCase();
  if (s === 'approved') return 'approved';
  if (s === 'pending' || s === 'in_process') return s;
  if (s === 'rejected' || s === 'cancelled' || s === 'canceled' || s === 'refunded' || s === 'charged_back') return s;
  return s || 'pending';
}

function normalizeProductDoc(docSnap) {
  const data = docSnap.data() || {};
  const categoryId = normalizeCategoryId(data.categoriaId || data.categoryId || data.categoria || data.category || '');
  const estoqueAtivo = data.estoqueAtivo !== false;
  const estoqueQuantidade = Number(data.estoqueQuantidade ?? data.estoque ?? 999);
  const sellerId = String(data.sellerId || data.vendedorId || '').trim();
  const title = String(data.titulo || data.title || data.nome || data.name || 'Produto sem nome').trim();

  return {
    id: docSnap.id,
    ...data,
    titulo: title,
    descricao: String(data.descricao || data.description || '').trim(),
    preco: Number(data.preco ?? data.price ?? 0),
    moeda: data.moeda || data.currency || 'BRL',
    imagem: data.imagem || data.image || (Array.isArray(data.imagens) ? data.imagens[0] : '') || '',
    categoriaId,
    categoriaNome: data.categoriaNome || data.categoryName || categoryId || '',
    sellerId,
    sellerName: String(data.sellerName || data.vendedorNome || data.sellerNome || sellerId || 'Vendedor').trim(),
    sellerPhoto: data.sellerPhoto || data.vendedorFoto || '',
    destaque: data.destaque === true,
    ordem: Number(data.ordem || data.order || 999),
    estoqueAtivo,
    estoqueQuantidade,
    disponivel: estoqueAtivo ? estoqueQuantidade > 0 : true,
    ativo: data.ativo !== false,
  };
}

function sameEmail(a, b) {
  const ea = normalizeEmail(a);
  const eb = normalizeEmail(b);
  return !!ea && !!eb && ea === eb;
}

function profileBelongsToUser(data, uid, email) {
  if (!data) return false;
  return data.uid === uid || sameEmail(data.email, email) || sameEmail(data.playerEmail, email);
}

async function queryMainUsersByField(mainDb, field, value) {
  const clean = String(value || '').trim();
  if (!clean) return [];
  const snap = await mainDb.collection('users').where(field, '==', clean).limit(5).get();
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

async function verifyBuyerFromRequest(req) {
  const authz = String(req.headers?.authorization || req.headers?.Authorization || '').trim();
  const idToken = authz.toLowerCase().startsWith('bearer ') ? authz.slice(7).trim() : '';
  if (!idToken) throw new Error('buyer-auth-required');

  if (!hasAnyEnv([
    'GHUB_FIREBASE_SERVICE_ACCOUNT_JSON',
    'GHUB_FIREBASE_SERVICE_ACCOUNT',
    'GHUB_FIREBASE_PROJECT_ID',
    'FIREBASE_SERVICE_ACCOUNT',
    'FIREBASE_SERVICE_ACCOUNT_JSON',
  ])) {
    throw new Error('ghub-auth-env-missing');
  }

  let decoded;
  try {
    decoded = await getGhubAdmin().auth().verifyIdToken(idToken);
  } catch (err) {
    console.error('[LOJA_MP_AUTH] Token não validado no Firebase principal.', err?.code || err?.message || err);
    throw new Error('ghub-auth-invalid');
  }

  const uid = String(decoded?.uid || '');
  const email = normalizeEmail(decoded?.email || '');
  const mainDb = getGhubDb();
  const found = new Map();

  function add(profile) {
    if (!profile || !profile.id) return;
    found.set(profile.id, profile);
  }

  try {
    const authDoc = await mainDb.collection('users').doc(uid).get();
    if (authDoc.exists) add({ id: authDoc.id, ...authDoc.data() });
  } catch (_) {}

  for (const [field, value] of [
    ['uid', uid],
    ['email', email],
    ['playerEmail', email],
  ]) {
    try {
      const list = await queryMainUsersByField(mainDb, field, value);
      list.forEach(add);
    } catch (_) {}
  }

  const profiles = Array.from(found.values());
  const numericProfile = profiles.find((p) => /^\d+$/.test(String(p.id || '')) && profileBelongsToUser(p, uid, email));
  const fallback = profiles.find((p) => profileBelongsToUser(p, uid, email)) || profiles[0] || null;
  const selected = numericProfile || fallback;
  if (!selected) throw new Error('buyer-profile-not-found');

  const gameId = normalizeDigits(
    /^\d+$/.test(String(selected.id || ''))
      ? selected.id
      : selected.gameIdMigrated || selected.gameId || selected.id || ''
  );
  if (!gameId) throw new Error('buyer-profile-not-found');

  return {
    uid,
    email,
    gameId,
    nick: String(selected.nick || selected.nome || selected.name || '').trim(),
    foto: selected.foto || selected.photo || '',
  };
}


function getBuyerFromLocalProfile(body = {}) {
  const source = body.buyer || body.profile || body.ghubProfile || body.comprador || body;
  const gameId = normalizeDigits(
    source.gameId || source.id || source.playerId || source.idPerfil || body.buyerId || body.gameId || ''
  );

  if (!gameId) throw new Error('buyer-profile-local-required');

  return {
    uid: String(source.uid || source.userId || body.uid || '').trim(),
    email: normalizeEmail(source.email || source.playerEmail || body.email || ''),
    gameId,
    nick: String(source.nick || source.nome || source.name || source.apelido || '').trim(),
    foto: source.foto || source.photo || source.avatar || '',
  };
}

async function ensureBuyerProfile(lojaDb, buyer) {
  await lojaDb.collection('comprador').doc(String(buyer.gameId)).set({
    id: buyer.gameId,
    gameId: buyer.gameId,
    uid: buyer.uid || '',
    email: buyer.email || '',
    playerEmail: buyer.email || '',
    nick: buyer.nick || '',
    foto: buyer.foto || '',
    ativo: true,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    createdAtMs: Date.now(),
  }, { merge: true });
}

function getBaseUrl(req) {
  const explicit = getEnv('APP_BASE_URL') || getEnv('NEXT_PUBLIC_APP_URL');
  if (explicit) return explicit.replace(/\/+$/, '');
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  const proto = req.headers['x-forwarded-proto'] || 'https';
  if (host) return `${proto}://${host}`.replace(/\/+$/, '');
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`.replace(/\/+$/, '');
  return '';
}

function getMpAccessToken() {
  const token = getEnv('LOJA_MP_ACCESS_TOKEN');
  if (!token) throw new Error('LOJA_MP_ACCESS_TOKEN ausente (ENV).');
  return token;
}

function makeIdempotencyKey() {
  if (globalThis.crypto && typeof globalThis.crypto.randomUUID === 'function') return globalThis.crypto.randomUUID();
  return `idem_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

async function mercadoPagoFetch(path, options = {}) {
  const response = await fetch(`https://api.mercadopago.com${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${getMpAccessToken()}`,
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const err = new Error('mercado-pago-error');
    err.status = response.status;
    err.details = data;
    throw err;
  }
  return data;
}

async function getMercadoPagoPayment(paymentId) {
  if (!paymentId) throw new Error('payment-id-required');
  return mercadoPagoFetch(`/v1/payments/${encodeURIComponent(paymentId)}`, { method: 'GET' });
}

function parseExternalReference(refStr) {
  const out = { checkoutId: '', orderId: '', productId: '', buyerId: '', sellerId: '' };
  const s = String(refStr || '').trim();
  if (!s) return out;
  for (const part of s.split('|')) {
    const [kRaw, ...rest] = part.split(':');
    const key = String(kRaw || '').trim().toLowerCase();
    const value = rest.join(':').trim();
    if (!value) continue;
    if (key === 'loja' || key === 'checkout' || key === 'checkoutid') out.checkoutId = value;
    if (key === 'pedido' || key === 'order' || key === 'orderid') out.orderId = value;
    if (key === 'produto' || key === 'product' || key === 'productid') out.productId = value;
    if (key === 'buyer' || key === 'comprador' || key === 'buyerid') out.buyerId = value;
    if (key === 'seller' || key === 'vendedor' || key === 'sellerid') out.sellerId = value;
  }
  return out;
}

function getPaymentIdFromNotification(req) {
  const body = req.body || {};
  const query = req.query || {};
  return String(
    body?.data?.id ||
    body?.id ||
    query?.id ||
    query?.data_id ||
    query?.payment_id ||
    ''
  ).trim();
}

function parseSignatureHeader(header) {
  const out = {};
  String(header || '').split(',').forEach((part) => {
    const [key, value] = part.split('=');
    if (key && value) out[key.trim()] = value.trim();
  });
  return out;
}

function verifyWebhookSignature(req) {
  const secret = getEnv('LOJA_MP_WEBHOOK_SECRET') || getEnv('MP_WEBHOOK_SECRET');
  if (!secret) return true;

  const xSignature = req.headers['x-signature'] || req.headers['X-Signature'] || '';
  const xRequestId = req.headers['x-request-id'] || req.headers['X-Request-Id'] || '';
  const parts = parseSignatureHeader(xSignature);
  const ts = parts.ts || '';
  const v1 = parts.v1 || '';
  if (!ts || !v1 || !xRequestId) return false;

  const dataId = String((req.query && (req.query['data.id'] || req.query.id)) || (req.body && req.body?.data?.id) || '').toLowerCase();
  const manifest = `${dataId ? `id:${dataId};` : ''}request-id:${xRequestId};ts:${ts};`;
  const hmac = crypto.createHmac('sha256', secret).update(manifest).digest('hex');

  try {
    return crypto.timingSafeEqual(Buffer.from(hmac), Buffer.from(v1));
  } catch (_) {
    return false;
  }
}

function chatIdForOrder(orderId, type = 'vendedor') {
  return `${type}_${orderId}`;
}

async function uidRateLimit(db, uid, opts = {}) {
  const windowMs = Number(opts.windowMs || 60_000);
  const maxRequests = Number(opts.maxRequests || 8);
  const ref = db.collection('rate_http_pix_loja').doc(String(uid || 'anon'));
  const snap = await ref.get();
  const now = Date.now();

  let windowStart = now;
  let count = 1;
  if (snap.exists) {
    const d = snap.data() || {};
    windowStart = Number(d.windowStart || now);
    count = Number(d.count || 0);
    if (now - windowStart < windowMs) {
      if (count >= maxRequests) return { ok: false, retryAfterMs: windowMs - (now - windowStart) };
      count += 1;
    } else {
      windowStart = now;
      count = 1;
    }
  }
  await ref.set({ windowStart, count, updatedAtMs: now }, { merge: true });
  return { ok: true };
}

async function creationCooldown(db, uid, cooldownMs) {
  const now = Date.now();
  const ref = db.collection('rate_new_pix_loja').doc(String(uid || 'anon'));
  const snap = await ref.get();
  if (snap.exists) {
    const lastCreatedAt = Number((snap.data() || {}).lastCreatedAt || 0);
    if (lastCreatedAt && now - lastCreatedAt < cooldownMs) {
      return { ok: false, retryAfterMs: cooldownMs - (now - lastCreatedAt) };
    }
  }
  return { ok: true };
}

async function markCreated(db, uid) {
  const now = Date.now();
  await db.collection('rate_new_pix_loja').doc(String(uid || 'anon')).set({
    lastCreatedAt: now,
    updatedAtMs: now,
  }, { merge: true });
}

function roundMoney(value) {
  return Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100;
}

async function approveCheckoutPayment(checkoutId, mercadoPagoPayment = null) {
  const lojaDb = getLojaDb();
  const checkoutRef = lojaDb.collection('pagamentosLoja').doc(String(checkoutId));
  const FieldValue = admin.firestore.FieldValue;
  let result = { status: 'pending', orderId: '' };

  await lojaDb.runTransaction(async (tx) => {
    const checkoutSnap = await tx.get(checkoutRef);
    if (!checkoutSnap.exists) throw new Error('checkout-not-found');
    const checkout = checkoutSnap.data() || {};

    if (checkout.orderCreated === true && checkout.orderId) {
      result = { status: 'approved', orderId: checkout.orderId, alreadyProcessed: true };
      return;
    }

    const productRef = lojaDb.collection('produtos').doc(String(checkout.productId));
    const productSnap = await tx.get(productRef);
    if (!productSnap.exists) throw new Error('product-not-found');

    const product = normalizeProductDoc(productSnap);
    if (product.ativo === false) throw new Error('product-inactive');

    const estoqueAtual = Number(product.estoqueQuantidade ?? 0);
    if (product.estoqueAtivo !== false && estoqueAtual <= 0) {
      tx.set(checkoutRef, {
        status: 'approved_without_stock',
        paymentStatus: 'approved',
        paymentId: String(mercadoPagoPayment?.id || checkout.paymentId || ''),
        approvedAtMs: Date.now(),
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true });
      result = { status: 'approved_without_stock', orderId: checkout.orderId || '' };
      return;
    }

    const orderId = String(checkout.orderId || lojaDb.collection('pedidos').doc().id);
    const orderRef = lojaDb.collection('pedidos').doc(orderId);
    const sellerChatId = chatIdForOrder(orderId, 'vendedor');
    const nowMs = Date.now();
    const total = roundMoney(product.preco || checkout.amount || 0);
    const sellerNet = roundMoney(total * (1 - SELLER_FEE_RATE));

    const orderPayload = {
      id: orderId,
      buyerId: checkout.buyerId,
      buyerUid: checkout.buyerUid || '',
      buyerEmail: checkout.buyerEmail || '',
      buyerName: checkout.buyerName || '',
      buyerNick: checkout.buyerName || '',
      buyerPhoto: checkout.buyerPhoto || '',

      sellerId: product.sellerId || checkout.sellerId || 'ghub',
      sellerName: product.sellerName || checkout.sellerName || 'GuildaHub',
      sellerPhoto: product.sellerPhoto || checkout.sellerPhoto || '',

      produtoId: product.id,
      produtoTitulo: product.titulo,
      produtoImagem: product.imagem || '',
      categoriaId: product.categoriaId || '',
      categoriaNome: product.categoriaNome || '',

      quantidade: 1,
      precoUnitario: total,
      total,
      moeda: product.moeda || 'BRL',
      taxaPercentual: SELLER_FEE_PERCENT,
      taxaValor: roundMoney(total * SELLER_FEE_RATE),
      valorLiquidoVendedor: sellerNet,

      buyerInfoRequired: false,
      buyerInfo: '',
      deliveryInfoRequired: false,
      deliveryInfo: '',

      status: 'pendente',
      finalizado: false,
      chatVendedorAberto: false,
      chatVendedorId: sellerChatId,
      chatVendedorStatus: 'aguardando_primeira_mensagem',
      chatVendedorExpiraEmMs: nowMs + SELLER_CHAT_HOURS * 60 * 60 * 1000,
      pagamento: {
        metodo: 'pix',
        provider: 'mercado_pago',
        status: 'aprovado',
        paymentId: String(mercadoPagoPayment?.id || checkout.paymentId || ''),
        checkoutId: String(checkoutId),
        qrCode: checkout.qrCode || '',
        copiaCola: checkout.qrCode || '',
        aprovadoEm: FieldValue.serverTimestamp(),
        aprovadoEmMs: nowMs,
        reembolsadoEm: null,
      },
      entrega: {
        tipo: product.entregaTipo || 'manual',
        status: 'aguardando_entrega',
        observacao: '',
        informacoes: '',
        entregueEm: null,
        entregueEmMs: null,
        canceladoEm: null,
      },
      checkoutId: String(checkoutId),
      createdAt: FieldValue.serverTimestamp(),
      createdAtMs: nowMs,
      updatedAt: FieldValue.serverTimestamp(),
    };

    tx.set(orderRef, orderPayload, { merge: false });

    if (product.estoqueAtivo !== false) {
      tx.set(productRef, {
        estoqueQuantidade: Math.max(0, estoqueAtual - 1),
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true });
    }

    tx.set(checkoutRef, {
      status: 'approved',
      paymentStatus: 'approved',
      paymentId: String(mercadoPagoPayment?.id || checkout.paymentId || ''),
      orderCreated: true,
      orderId,
      approvedAtMs: nowMs,
      processedAtMs: nowMs,
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });

    result = { status: 'approved', orderId };
  });

  return result;
}

module.exports = {
  admin,
  json,
  cors,
  toLabel,
  mapPaymentStatus,
  getEnv,
  getLojaDb,
  verifyBuyerFromRequest,
  getBuyerFromLocalProfile,
  ensureBuyerProfile,
  normalizeProductDoc,
  getBaseUrl,
  getMpAccessToken,
  makeIdempotencyKey,
  mercadoPagoFetch,
  getMercadoPagoPayment,
  getPaymentIdFromNotification,
  parseExternalReference,
  verifyWebhookSignature,
  uidRateLimit,
  creationCooldown,
  markCreated,
  approveCheckoutPayment,
};
