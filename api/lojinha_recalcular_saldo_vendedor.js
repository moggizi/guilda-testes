// api/lojinha_recalcular_saldo_vendedor.js
// Recalcula saldo do vendedor com Admin SDK da Lojinha.

const {
  admin,
  json,
  cors,
  getLojaDb,
  verifyLojaAuthFromRequest,
} = require('./_loja_mp_shared');

const SELLER_FEE_RATE = 0.06;
const SELLER_FEE_PERCENT = 6;
const SELLER_RELEASE_DAYS = 3;

function roundMoney(value) {
  return Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100;
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

function getDeliveredAtMs(order = {}) {
  return Number(order.entregueEmMs || order.entrega?.entregueEmMs || 0)
    || timestampToMs(order.entrega?.entregueEm)
    || timestampToMs(order.entregueEm)
    || timestampToMs(order.updatedAt);
}

function isSellerActive(data = {}) {
  const status = String(data.status || '').toLowerCase();
  return data.ativo === true
    && data.verificado === true
    && data.revogado !== true
    && data.bloqueado !== true
    && status !== 'inativo'
    && status !== 'revogado'
    && status !== 'bloqueado';
}

async function calculateAndSaveSellerFinancials(lojaDb, sellerId) {
  const sellerRef = lojaDb.collection('vendedor').doc(String(sellerId));
  const sellerSnap = await sellerRef.get();
  if (!sellerSnap.exists) throw new Error('seller-not-found');
  const sellerData = sellerSnap.data() || {};

  const now = Date.now();
  const releaseMs = SELLER_RELEASE_DAYS * 24 * 60 * 60 * 1000;
  let saldoBrutoLiberado = 0;
  let saldoBrutoPendente = 0;
  let totalLiquidoEntregue = 0;
  let totalBrutoEntregue = 0;
  let totalVendasEntregues = 0;

  const ordersSnap = await lojaDb.collection('pedidos')
    .where('sellerId', '==', String(sellerId))
    .where('status', '==', 'entregue')
    .limit(1000)
    .get();

  ordersSnap.docs.forEach((doc) => {
    const order = doc.data() || {};
    const gross = Number(order.total || order.precoUnitario || 0);
    if (!Number.isFinite(gross) || gross <= 0) return;
    const net = roundMoney(gross * (1 - SELLER_FEE_RATE));
    const deliveredAt = getDeliveredAtMs(order);
    totalVendasEntregues += 1;
    totalBrutoEntregue = roundMoney(totalBrutoEntregue + gross);
    totalLiquidoEntregue = roundMoney(totalLiquidoEntregue + net);
    if (deliveredAt && now - deliveredAt >= releaseMs) saldoBrutoLiberado = roundMoney(saldoBrutoLiberado + net);
    else saldoBrutoPendente = roundMoney(saldoBrutoPendente + net);
  });

  const financeiro = sellerData.financeiro || {};
  const saldoEmSaque = Number(sellerData.saldoEmSaque ?? sellerData.saquePendente ?? financeiro.saldoEmSaque ?? 0) || 0;
  const totalSacado = Number(sellerData.totalSacado ?? financeiro.totalSacado ?? 0) || 0;
  const reservadoOuSacado = Math.max(0, saldoEmSaque) + Math.max(0, totalSacado);
  const saldoAtual = Math.max(0, roundMoney(saldoBrutoLiberado - reservadoOuSacado));
  const reservaQuePassouDoLiberado = Math.max(0, roundMoney(reservadoOuSacado - saldoBrutoLiberado));
  const saldoPendente = Math.max(0, roundMoney(saldoBrutoPendente - reservaQuePassouDoLiberado));

  const finances = {
    saldo: saldoAtual,
    saldoAtual,
    saldoPendente,
    saldoEmSaque: Math.max(0, saldoEmSaque),
    totalSacado: Math.max(0, totalSacado),
    saldoTotalDisponivelAdmin: roundMoney(saldoAtual + saldoPendente),
    totalLiquidoEntregue,
    totalBrutoEntregue,
    totalVendasEntregues,
    taxaPercentual: SELLER_FEE_PERCENT,
    saqueMinimo: 20,
    liberacaoDias: SELLER_RELEASE_DAYS,
    atualizadoEmMs: now,
  };

  await sellerRef.set({
    saldoAtual: finances.saldoAtual,
    saldoPendente: finances.saldoPendente,
    saldoEmSaque: finances.saldoEmSaque,
    saquePendente: finances.saldoEmSaque,
    totalSacado: finances.totalSacado,
    totalVendas: finances.totalVendasEntregues,
    totalVendasEntregues: finances.totalVendasEntregues,
    financeiro: finances,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAtMs: now,
  }, { merge: true });

  return finances;
}

module.exports = async (req, res) => {
  cors(res);

  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    return res.end();
  }

  if (req.method !== 'POST') {
    return json(res, 405, { ok: false, error: 'method-not-allowed' });
  }

  try {
    const lojaAuth = await verifyLojaAuthFromRequest(req);
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    const lojaDb = getLojaDb();
    let sellerId = String(body.sellerId || '').trim();

    if (!sellerId) {
      const sellers = await lojaDb.collection('vendedor').where('authUid', '==', lojaAuth.authUid).limit(1).get();
      sellerId = sellers.docs[0]?.id || '';
    }
    if (!sellerId) throw new Error('seller-not-found');

    const sellerSnap = await lojaDb.collection('vendedor').doc(sellerId).get();
    if (!sellerSnap.exists) throw new Error('seller-not-found');
    const seller = sellerSnap.data() || {};
    const sellerAuthUid = String(seller.authUid || seller.lojinhaUid || '');
    if (sellerAuthUid !== lojaAuth.authUid) throw new Error('seller-not-authorized');
    if (!isSellerActive(seller)) throw new Error('seller-inactive');

    const finances = await calculateAndSaveSellerFinancials(lojaDb, sellerId);
    return json(res, 200, { ok: true, sellerId, finances });
  } catch (err) {
    console.error('[LOJINHA_RECALCULAR_SALDO]', err?.message || err);
    const code = String(err?.message || 'internal-error');
    const status = {
      'loja-auth-required': 401,
      'loja-auth-invalid': 401,
      'seller-not-found': 404,
      'seller-not-authorized': 403,
      'seller-inactive': 403,
    }[code] || 500;
    return json(res, status, { ok: false, error: code });
  }
};
