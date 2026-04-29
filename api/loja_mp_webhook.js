// api/loja_mp_webhook.js
// Webhook Pix da Loginha. Busca o status real no Mercado Pago e só processa pedido aprovado.

const {
  admin,
  json,
  cors,
  getLojaDb,
  getMercadoPagoPayment,
  getPaymentIdFromNotification,
  parseExternalReference,
  verifyWebhookSignature,
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

  if (req.method !== 'POST') {
    return json(res, 405, { ok: false, error: 'Método não permitido' });
  }

  try {
    if (!verifyWebhookSignature(req)) {
      console.warn('[LOJA_MP_WEBHOOK] Assinatura inválida.');
      return json(res, 401, { ok: false, error: 'invalid-signature' });
    }

    const paymentId = getPaymentIdFromNotification(req);
    const queryCheckoutId = String(req.query?.checkoutId || '').trim();

    if (!paymentId && !queryCheckoutId) {
      return json(res, 200, { ok: true, ignored: true, reason: 'missing-payment-id' });
    }

    let payment = null;
    let checkoutId = queryCheckoutId;

    if (paymentId) {
      payment = await getMercadoPagoPayment(paymentId);
      const ref = parseExternalReference(payment.external_reference || '');
      checkoutId = String(ref.checkoutId || payment.metadata?.checkout_id || queryCheckoutId || '').trim();
    }

    if (!checkoutId) {
      return json(res, 200, { ok: true, ignored: true, reason: 'missing-checkout-id' });
    }

    const lojaDb = getLojaDb();
    const checkoutRef = lojaDb.collection('pagamentosLoja').doc(checkoutId);
    const paymentStatus = mapPaymentStatus(payment?.status || 'pending');
    const label = toLabel(payment?.status || paymentStatus);

    await checkoutRef.set({
      paymentId: payment ? String(payment.id || '') : admin.firestore.FieldValue.delete(),
      paymentStatus,
      status: paymentStatus,
      label,
      mpRawStatus: payment?.status || '',
      lastWebhookAtMs: Date.now(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });

    let result = { status: paymentStatus, label };
    if (paymentStatus === 'approved') {
      result = await approveCheckoutPayment(checkoutId, payment);
      result.label = 'aprovado';
    }

    return json(res, 200, { ok: true, checkoutId, paymentId: paymentId || '', ...result });
  } catch (err) {
    console.error('[LOJA_MP_WEBHOOK]', err?.message || err);
    // Webhook pode ser reenviado; erro técnico retorna 500 para tentar novamente.
    return json(res, 500, { ok: false, error: err.message || 'internal-error' });
  }
};
