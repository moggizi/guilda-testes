// api/lojinha_seller_order_action.js
// Ação segura do vendedor em pedido: marcar como entregue ou solicitar reembolso.
// Usa Admin SDK do Firebase da Lojinha via LOJA_FIREBASE_SERVICE_ACCOUNT_JSON.

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

function isSellerActive(data = {}, verification = null) {
  const status = String(data.status || '').toLowerCase();
  const verificationStatus = String(
    data.verificacaoStatus ||
    data.verificationStatus ||
    data.statusVerificacao ||
    verification?.status ||
    ''
  ).toLowerCase();

  const approved = data.verificado === true
    || data.aprovado === true
    || data.approved === true
    || verification?.aprovado === true
    || verification?.approved === true
    || verificationStatus === 'aprovado'
    || verificationStatus === 'approved';

  return data.ativo !== false
    && approved
    && data.revogado !== true
    && data.bloqueado !== true
    && data.excluido !== true
    && data.excluida !== true
    && status !== 'inativo'
    && status !== 'revogado'
    && status !== 'bloqueado'
    && status !== 'excluido';
}

function isOrderPending(order = {}) {
  const status = String(order.status || '').toLowerCase();
  const paymentStatus = String(order.pagamento?.status || order.paymentStatus || '').toLowerCase();
  return order.finalizado !== true
    && order.reembolsoSolicitado !== true
    && !['entregue', 'reembolso_solicitado', 'reembolsado', 'cancelado', 'cancelled', 'canceled'].includes(status)
    && (
      !status ||
      ['pendente', 'pending', 'pago', 'aprovado', 'approved', 'aguardando_entrega'].includes(status) ||
      ['aprovado', 'approved', 'paid'].includes(paymentStatus)
    );
}

function sanitizeText(value, max = 1000) {
  return String(value || '').trim().slice(0, max);
}

async function calculateAndSaveSellerFinancials(lojaDb, sellerId) {
  const sellerRef = lojaDb.collection('vendedor').doc(String(sellerId));
  const sellerSnap = await sellerRef.get();
  const sellerData = sellerSnap.exists ? sellerSnap.data() || {} : {};

  const now = Date.now();
  const releaseMs = SELLER_RELEASE_DAYS * 24 * 60 * 60 * 1000;
  let saldoBrutoLiberado = 0;
  let saldoBrutoPendente = 0;
  let totalLiquidoEntregue = 0;
  let totalBrutoEntregue = 0;
  let totalVendasEntregues = 0;

  // Usa somente sellerId para evitar índice composto obrigatório no Firestore.
  // O filtro por status fica na API, que roda com Admin SDK.
  const ordersSnap = await lojaDb.collection('pedidos')
    .where('sellerId', '==', String(sellerId))
    .limit(1000)
    .get();

  ordersSnap.docs.forEach((doc) => {
    const order = doc.data() || {};
    if (String(order.status || '').toLowerCase() !== 'entregue') return;
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
    const orderId = String(body.orderId || '').trim();
    const action = String(body.action || '').trim().toLowerCase();
    const deliveryInfo = sanitizeText(body.deliveryInfo || '', 1500);
    const motivo = sanitizeText(body.motivo || '', 1000);

    if (!orderId) return json(res, 400, { ok: false, error: 'order-id-required' });
    if (!['entregue', 'reembolso_solicitado'].includes(action)) {
      return json(res, 400, { ok: false, error: 'invalid-action' });
    }

    const lojaDb = getLojaDb();
    const FieldValue = admin.firestore.FieldValue;
    const orderRef = lojaDb.collection('pedidos').doc(orderId);
    let sellerId = '';
    let orderPatch = null;
    let productId = '';

    await lojaDb.runTransaction(async (tx) => {
      const orderSnap = await tx.get(orderRef);
      if (!orderSnap.exists) throw new Error('order-not-found');
      const order = orderSnap.data() || {};
      sellerId = String(order.sellerId || '').trim();
      productId = String(order.produtoId || order.productId || '').trim();
      if (!sellerId) throw new Error('seller-not-authorized');

      const sellerRef = lojaDb.collection('vendedor').doc(sellerId);
      const verificationRef = lojaDb.collection('verificacao').doc(sellerId);
      const productRef = productId ? lojaDb.collection('produtos').doc(productId) : null;
      const sellerSnap = await tx.get(sellerRef);
      const verificationSnap = await tx.get(verificationRef);
      const productSnap = productRef ? await tx.get(productRef) : null;
      if (!sellerSnap.exists) throw new Error('seller-inactive');
      const seller = sellerSnap.data() || {};
      const verification = verificationSnap.exists ? (verificationSnap.data() || {}) : null;
      const product = productSnap?.exists ? (productSnap.data() || {}) : null;
      const productBelongsToSeller = !!product && String(product.sellerId || product.vendedorId || '').trim() === sellerId;
      const sellerAuthUid = String(seller.authUid || seller.lojinhaUid || seller.lojaAuthUid || '').trim();
      const orderSellerAuthUid = String(order.sellerAuthUid || order.sellerLojinhaUid || '').trim();
      const verificationAuthUid = String(verification?.authUid || verification?.lojinhaUid || verification?.lojaAuthUid || '').trim();
      const productSellerAuthUid = productBelongsToSeller ? String(product.sellerAuthUid || product.sellerLojinhaUid || product.lojinhaUid || '').trim() : '';
      const sellerEmail = String(seller.authEmail || seller.email || seller.playerEmail || '').trim().toLowerCase();
      const verificationEmail = String(verification?.authEmail || verification?.email || verification?.playerEmail || '').trim().toLowerCase();
      const orderSellerEmail = String(order.sellerAuthEmail || order.sellerEmail || '').trim().toLowerCase();
      const productSellerEmail = productBelongsToSeller ? String(product.sellerAuthEmail || product.sellerEmail || '').trim().toLowerCase() : '';
      const authEmail = String(lojaAuth.authEmail || '').trim().toLowerCase();
      const authMatchesSeller = !!sellerAuthUid && sellerAuthUid === lojaAuth.authUid;
      const authMatchesOrder = !!orderSellerAuthUid && orderSellerAuthUid === lojaAuth.authUid;
      const authMatchesVerification = !!verificationAuthUid && verificationAuthUid === lojaAuth.authUid;
      const authMatchesProduct = !!productSellerAuthUid && productSellerAuthUid === lojaAuth.authUid;
      const emailMatchesSeller = !!authEmail && !!sellerEmail && authEmail === sellerEmail;
      const emailMatchesVerification = !!authEmail && !!verificationEmail && authEmail === verificationEmail;
      const emailMatchesOrder = !!authEmail && !!orderSellerEmail && authEmail === orderSellerEmail;
      const emailMatchesProduct = !!authEmail && !!productSellerEmail && authEmail === productSellerEmail;

      if (!authMatchesSeller && !authMatchesOrder && !authMatchesVerification && !authMatchesProduct && !emailMatchesSeller && !emailMatchesVerification && !emailMatchesOrder && !emailMatchesProduct) {
        throw new Error('seller-not-authorized');
      }
      if (!isSellerActive(seller, verification)) throw new Error('seller-inactive');
      if (!isOrderPending(order)) throw new Error('order-not-pending');

      const nowMs = Date.now();
      const canRepairSellerAuth = authMatchesOrder || authMatchesVerification || authMatchesProduct || emailMatchesSeller || emailMatchesVerification || emailMatchesOrder || emailMatchesProduct;
      if (lojaAuth.authUid && sellerAuthUid !== lojaAuth.authUid && canRepairSellerAuth) {
        tx.set(sellerRef, {
          authUid: lojaAuth.authUid,
          lojinhaUid: lojaAuth.authUid,
          authEmail: lojaAuth.authEmail || seller.authEmail || seller.email || verification?.authEmail || verification?.email || product?.sellerAuthEmail || '',
          updatedAt: FieldValue.serverTimestamp(),
          updatedAtMs: nowMs,
        }, { merge: true });
      }
      if (action === 'entregue') {
        orderPatch = {
          status: 'entregue',
          finalizado: true,
          sellerAuthUid: lojaAuth.authUid,
          sellerLojinhaUid: lojaAuth.authUid,
          sellerAuthEmail: lojaAuth.authEmail || order.sellerAuthEmail || order.sellerEmail || '',
          sellerEmail: lojaAuth.authEmail || order.sellerEmail || order.sellerAuthEmail || '',
          deliveryInfo: deliveryInfo || order.deliveryInfo || '',
          deliveryInfoUpdatedAtMs: nowMs,
          entregueEmMs: nowMs,
          entrega: {
            ...(order.entrega || {}),
            status: 'entregue',
            informacoes: deliveryInfo || order.entrega?.informacoes || '',
            entregueEm: FieldValue.serverTimestamp(),
            entregueEmMs: nowMs,
          },
          updatedAt: FieldValue.serverTimestamp(),
          updatedAtMs: nowMs,
        };
      } else {
        orderPatch = {
          status: 'reembolso_solicitado',
          finalizado: false,
          sellerAuthUid: lojaAuth.authUid,
          sellerLojinhaUid: lojaAuth.authUid,
          sellerAuthEmail: lojaAuth.authEmail || order.sellerAuthEmail || order.sellerEmail || '',
          sellerEmail: lojaAuth.authEmail || order.sellerEmail || order.sellerAuthEmail || '',
          reembolsoSolicitado: true,
          reembolsoStatus: 'pendente',
          reembolsoMotivo: motivo || 'Solicitado pelo vendedor.',
          reembolsoSolicitadoPor: sellerId,
          reembolsoSolicitadoPorNome: seller.nome || seller.nick || order.sellerName || 'Vendedor',
          reembolsoSolicitadoEm: FieldValue.serverTimestamp(),
          reembolsoSolicitadoEmMs: nowMs,
          statusAntesReembolso: order.status || 'pendente',
          finalizadoAntesReembolso: order.finalizado === true,
          pagamentoStatusAntesReembolso: order.pagamento?.status || '',
          entregaStatusAntesReembolso: order.entrega?.status || '',
          pagamento: { ...(order.pagamento || {}), status: 'reembolso_solicitado' },
          entrega: { ...(order.entrega || {}), status: 'reembolso_solicitado' },
          updatedAt: FieldValue.serverTimestamp(),
          updatedAtMs: nowMs,
        };
      }

      tx.set(orderRef, orderPatch, { merge: true });

      if (action === 'entregue' && productId) {
        const productRef = lojaDb.collection('produtos').doc(productId);
        tx.set(productRef, {
          totalVendas: FieldValue.increment(1),
          totalVendasEntregues: FieldValue.increment(1),
          updatedAt: FieldValue.serverTimestamp(),
          updatedAtMs: nowMs,
        }, { merge: true });
      }
    });

    let finances = null;
    let financeWarning = '';
    try {
      finances = await calculateAndSaveSellerFinancials(lojaDb, sellerId);
    } catch (financeErr) {
      // Não desfaz a entrega/reembolso por falha posterior no cálculo.
      // A API /api/lojinha_recalcular_saldo_vendedor pode recalcular depois.
      financeWarning = financeErr?.message || 'finance-recalc-failed';
      console.error('[LOJINHA_SELLER_ORDER_ACTION][FINANCE]', financeWarning, financeErr);
    }

    return json(res, 200, {
      ok: true,
      orderId,
      sellerId,
      action,
      order: orderPatch,
      finances,
      financeWarning,
    });
  } catch (err) {
    console.error('[LOJINHA_SELLER_ORDER_ACTION]', err?.message || err);
    const code = String(err?.message || 'internal-error');
    const status = {
      'loja-auth-required': 401,
      'loja-auth-invalid': 401,
      'order-id-required': 400,
      'invalid-action': 400,
      'order-not-found': 404,
      'seller-not-authorized': 403,
      'seller-inactive': 403,
      'order-not-pending': 409,
    }[code] || 500;
    return json(res, status, { ok: false, error: code });
  }
};

module.exports.calculateAndSaveSellerFinancials = calculateAndSaveSellerFinancials;
