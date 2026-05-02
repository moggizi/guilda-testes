// api/lojinha_seller_order_action.js
// Vendedor altera somente pedido pendente para entregue ou reembolso_solicitado.
// Saldo é recalculado via Admin SDK usando LOJA_FIREBASE_SERVICE_ACCOUNT_JSON.

const {
  admin,
  json,
  cors,
  getLojaDb,
  verifyLojaAuth,
  isSellerActive,
  isPendingOrderStatus,
  isLockedOrder,
  recalcSellerFinancials,
  recalcProductDeliveredSales,
} = require('./_lojinha_admin_shared');

module.exports = async (req, res) => {
  cors(res);
  if (req.method === 'OPTIONS') { res.statusCode = 204; return res.end(); }
  if (req.method !== 'POST') return json(res, 405, { ok: false, error: 'method-not-allowed' });

  try {
    const authUser = await verifyLojaAuth(req);
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    const orderId = String(body.orderId || '').trim();
    const action = String(body.action || '').trim().toLowerCase();
    const deliveryInfo = String(body.deliveryInfo || '').trim();
    const motivo = String(body.motivo || '').trim();

    if (!orderId) return json(res, 400, { ok: false, error: 'order-required' });
    if (!['entregue', 'reembolso_solicitado'].includes(action)) return json(res, 400, { ok: false, error: 'invalid-action' });

    const db = getLojaDb();
    const orderRef = db.collection('pedidos').doc(orderId);
    let sellerId = '';
    let productId = '';
    let orderPatch = null;

    await db.runTransaction(async (tx) => {
      const orderSnap = await tx.get(orderRef);
      if (!orderSnap.exists) throw new Error('order-not-found');
      const order = orderSnap.data() || {};
      sellerId = String(order.sellerId || '').trim();
      productId = String(order.produtoId || '').trim();
      if (!sellerId) throw new Error('seller-not-found');

      const sellerRef = db.collection('vendedor').doc(sellerId);
      const sellerSnap = await tx.get(sellerRef);
      if (!sellerSnap.exists) throw new Error('seller-not-found');
      const seller = sellerSnap.data() || {};
      if (String(seller.authUid || seller.lojinhaUid || '') !== String(authUser.uid)) throw new Error('seller-not-authorized');
      if (!isSellerActive(seller)) throw new Error('seller-inactive');

      if (isLockedOrder(order) || !isPendingOrderStatus(order.status)) throw new Error('order-not-pending');

      const nowMs = Date.now();
      if (action === 'entregue') {
        orderPatch = {
          status: 'entregue',
          finalizado: true,
          entregueEmMs: nowMs,
          deliveryInfo: deliveryInfo || order.deliveryInfo || '',
          deliveryInfoUpdatedAtMs: deliveryInfo ? nowMs : (order.deliveryInfoUpdatedAtMs || null),
          entrega: {
            ...(order.entrega || {}),
            status: 'entregue',
            informacoes: deliveryInfo || order?.entrega?.informacoes || '',
            entregueEm: admin.firestore.FieldValue.serverTimestamp(),
            entregueEmMs: nowMs,
          },
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          updatedAtMs: nowMs,
        };
      } else {
        orderPatch = {
          status: 'reembolso_solicitado',
          finalizado: false,
          reembolsoSolicitado: true,
          reembolsoStatus: 'pendente',
          statusAntesReembolso: String(order.status || 'pendente'),
          finalizadoAntesReembolso: order.finalizado === true,
          pagamentoStatusAntesReembolso: String(order?.pagamento?.status || '').trim(),
          entregaStatusAntesReembolso: String(order?.entrega?.status || '').trim(),
          reembolsoMotivo: motivo || 'Solicitado pelo vendedor.',
          reembolsoSolicitadoPor: sellerId,
          reembolsoSolicitadoPorNome: seller.nome || seller.nick || seller.sellerName || 'Vendedor',
          reembolsoSolicitadoEm: admin.firestore.FieldValue.serverTimestamp(),
          reembolsoSolicitadoEmMs: nowMs,
          pagamento: { ...(order.pagamento || {}), status: 'reembolso_solicitado' },
          entrega: { ...(order.entrega || {}), status: 'reembolso_solicitado' },
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          updatedAtMs: nowMs,
        };
      }

      tx.set(orderRef, orderPatch, { merge: true });
    });

    if (action === 'entregue' && productId) await recalcProductDeliveredSales(db, productId).catch(() => null);
    const finances = await recalcSellerFinancials(db, sellerId);

    return json(res, 200, { ok: true, orderId, action, order: { id: orderId, ...orderPatch }, finances });
  } catch (err) {
    const code = String(err?.message || 'internal-error');
    const status = code === 'auth-required' || code === 'auth-invalid' ? 401
      : ['order-required', 'invalid-action'].includes(code) ? 400
      : ['seller-not-authorized'].includes(code) ? 403
      : ['order-not-found', 'seller-not-found'].includes(code) ? 404
      : ['seller-inactive', 'order-not-pending'].includes(code) ? 409
      : 500;
    console.error('[LOJINHA_SELLER_ORDER_ACTION]', code, err?.stack || '');
    return json(res, status, { ok: false, error: code });
  }
};
