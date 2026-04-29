// api/loja_mp_status.js
// Consulta Pix da Loginha. Se estiver aprovado, processa o pedido de forma idempotente.

const {
  admin,
  json,
  cors,
  getLojaDb,
  verifyBuyerFromRequest,
  getMercadoPagoPayment,
  approveCheckoutPayment,
  mapPaymentStatus,
  toLabel,
} = require('./_loja_mp_shared');

module.exports = async (req, res) => {
  cors(res);

  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    return res.end();
  }

  if (req.method !== 'GET' && req.method !== 'POST') {
    return json(res, 405, { ok: false, error: 'Método não permitido' });
  }

  try {
    const buyer = await verifyBuyerFromRequest(req);
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    const checkoutId = String(req.query?.checkoutId || body.checkoutId || '').trim();

    if (!checkoutId) return json(res, 400, { ok: false, error: 'checkout-id-required' });

    const lojaDb = getLojaDb();
    const checkoutRef = lojaDb.collection('pagamentosLoja').doc(checkoutId);
    const checkoutSnap = await checkoutRef.get();

    if (!checkoutSnap.exists) return json(res, 404, { ok: false, error: 'checkout-not-found' });

    const checkout = checkoutSnap.data() || {};
    if (String(checkout.buyerId || '') !== String(buyer.gameId)) {
      return json(res, 403, { ok: false, error: 'checkout-owner-mismatch' });
    }

    if (checkout.orderCreated === true && checkout.orderId) {
      return json(res, 200, {
        ok: true,
        checkoutId,
        paymentId: checkout.paymentId || '',
        status: 'approved',
        label: 'aprovado',
        orderId: checkout.orderId,
        alreadyProcessed: true,
      });
    }

    let status = String(checkout.paymentStatus || checkout.status || 'pending').toLowerCase();
    let label = toLabel(status);
    let result = { status, label, orderId: checkout.orderId || '' };

    if (checkout.paymentId) {
      const payment = await getMercadoPagoPayment(checkout.paymentId);
      status = mapPaymentStatus(payment.status || 'pending');
      label = toLabel(payment.status || status);

      await checkoutRef.set({
        paymentStatus: status,
        status,
        mpRawStatus: payment.status || '',
        label,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAtMs: Date.now(),
      }, { merge: true });

      if (status === 'approved') {
        result = await approveCheckoutPayment(checkoutId, payment);
        result.label = 'aprovado';
      } else {
        result = { status, label, orderId: checkout.orderId || '' };
      }
    }

    return json(res, 200, {
      ok: true,
      checkoutId,
      paymentId: checkout.paymentId || '',
      ...result,
    });
  } catch (err) {
    console.error('[LOJA_MP_STATUS]', err?.message || err);
    const status = err.message === 'buyer-auth-required' ? 401 : 500;
    return json(res, status, { ok: false, error: err.message || 'internal-error' });
  }
};
