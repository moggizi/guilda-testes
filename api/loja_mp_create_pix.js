// api/loja_mp_create_pix.js
// Cria Pix seguro para produto da Loginha.
// O pedido só é criado depois do pagamento aprovado no status/webhook.

const {
  admin,
  json,
  cors,
  getLojaDb,
  getBuyerFromLocalProfile,
  ensureBuyerProfile,
  normalizeProductDoc,
  getBaseUrl,
  makeIdempotencyKey,
  mercadoPagoFetch,
  uidRateLimit,
  creationCooldown,
  markCreated,
  mapPaymentStatus,
} = require('./_loja_mp_shared');

const PIX_EXPIRATION_MINUTES = 30;
const PIX_EXPIRATION_MS = PIX_EXPIRATION_MINUTES * 60 * 1000;

function roundMoney(value) {
  return Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100;
}

function isReusablePix(payment, currentAmount, nowMs) {
  const status = String(payment.paymentStatus || payment.status || '').toLowerCase();
  const expiresAtMs = Number(payment.expiresAtMs || 0);
  const sameAmount = roundMoney(payment.amount) === roundMoney(currentAmount);
  return ['pending', 'in_process', 'creating'].includes(status)
    && !!payment.paymentId
    && !!payment.qrCode
    && sameAmount
    && expiresAtMs > nowMs + 5000;
}

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
    const lojaDb = getLojaDb();
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
    const buyer = getBuyerFromLocalProfile(body);
    const productId = String(body.productId || '').trim();

    if (!productId) return json(res, 400, { ok: false, error: 'product-id-required' });

    const rl = await uidRateLimit(lojaDb, buyer.uid || buyer.gameId, { windowMs: 60_000, maxRequests: 8 });
    if (!rl.ok) {
      const waitSec = Math.max(1, Math.ceil((rl.retryAfterMs || 0) / 1000));
      res.setHeader('Retry-After', String(waitSec));
      return json(res, 429, { ok: false, error: 'Muitas tentativas. Aguarde um pouco e tente novamente.' });
    }

    const productSnap = await lojaDb.collection('produtos').doc(productId).get();
    if (!productSnap.exists) return json(res, 404, { ok: false, error: 'product-not-found' });

    const product = normalizeProductDoc(productSnap);
    if (product.ativo === false) return json(res, 409, { ok: false, error: 'product-inactive' });
    if (String(product.sellerId || '') && String(product.sellerId) === String(buyer.gameId)) {
      return json(res, 409, { ok: false, error: 'self-purchase' });
    }

    if (product.sellerId) {
      const sellerSnap = await lojaDb.collection('vendedor').doc(String(product.sellerId)).get();
      if (sellerSnap.exists) {
        const seller = sellerSnap.data() || {};
        if (seller.ativo === false || String(seller.status || '').toLowerCase() === 'inativo') {
          return json(res, 409, { ok: false, error: 'seller-inactive' });
        }
      }
    }

    const estoqueAtual = Number(product.estoqueQuantidade ?? 0);
    if (product.estoqueAtivo !== false && estoqueAtual <= 0) {
      return json(res, 409, { ok: false, error: 'out-of-stock' });
    }

    const amount = roundMoney(product.preco || 0);
    if (!Number.isFinite(amount) || amount <= 0) return json(res, 400, { ok: false, error: 'invalid-amount' });

    const nowMs = Date.now();
    const expiresAtMs = nowMs + PIX_EXPIRATION_MS;

    await ensureBuyerProfile(lojaDb, buyer);

    // Reutiliza Pix pendente somente se o valor atual for igual e o Pix ainda estiver dentro da validade.
    const pendingSnap = await lojaDb.collection('pagamentosLoja')
      .where('buyerId', '==', String(buyer.gameId))
      .where('productId', '==', String(product.id))
      .where('orderCreated', '==', false)
      .limit(10)
      .get();

    const pendingPayments = pendingSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
    const reusable = pendingPayments.find((p) => isReusablePix(p, amount, nowMs));

    const stalePayments = pendingPayments.filter((p) => {
      const status = String(p.paymentStatus || p.status || '').toLowerCase();
      if (!['pending', 'in_process', 'creating'].includes(status)) return false;
      if (p.orderCreated === true) return false;
      const sameAmount = roundMoney(p.amount) === amount;
      const notExpired = Number(p.expiresAtMs || 0) > nowMs + 5000;
      return !sameAmount || !notExpired;
    });

    if (stalePayments.length) {
      await Promise.all(stalePayments.map((p) => lojaDb.collection('pagamentosLoja').doc(String(p.id)).set({
        status: roundMoney(p.amount) !== amount ? 'discarded_price_changed' : 'expired_local',
        paymentStatus: roundMoney(p.amount) !== amount ? 'discarded_price_changed' : 'expired_local',
        stale: true,
        staleReason: roundMoney(p.amount) !== amount ? 'product-price-changed' : 'pix-expired-local',
        currentAmountAtDiscard: amount,
        previousAmountAtDiscard: roundMoney(p.amount),
        discardedAtMs: nowMs,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAtMs: nowMs,
      }, { merge: true })));
    }

    if (reusable) {
      return json(res, 200, {
        ok: true,
        reused: true,
        checkoutId: reusable.id,
        paymentId: reusable.paymentId,
        status: reusable.paymentStatus || reusable.status || 'pending',
        qrCode: reusable.qrCode || '',
        copiaCola: reusable.qrCode || '',
        qrCodeBase64: reusable.qrBase64 || reusable.qrCodeBase64 || '',
        qrBase64: reusable.qrBase64 || reusable.qrCodeBase64 || '',
        amount: roundMoney(reusable.amount || amount),
        productId: product.id,
        productTitle: product.titulo || '',
        expiresAtMs: Number(reusable.expiresAtMs || 0),
        expiresInMinutes: PIX_EXPIRATION_MINUTES,
      });
    }

    const hadPriceChangedPix = stalePayments.some((p) => roundMoney(p.amount) !== amount);
    if (!hadPriceChangedPix) {
      const cd = await creationCooldown(lojaDb, buyer.uid || buyer.gameId, 2 * 60 * 1000);
      if (!cd.ok) {
        const waitSec = Math.max(1, Math.ceil((cd.retryAfterMs || 0) / 1000));
        return json(res, 429, { ok: false, error: `Aguarde ${waitSec}s para gerar outro Pix.` });
      }
    }

    const checkoutRef = lojaDb.collection('pagamentosLoja').doc();
    const checkoutId = checkoutRef.id;
    const orderId = lojaDb.collection('pedidos').doc().id;
    const baseUrl = getBaseUrl(req);
    const notification_url = baseUrl && /^https:\/\//i.test(baseUrl)
      ? `${baseUrl}/api/loja_mp_webhook?checkoutId=${encodeURIComponent(checkoutId)}`
      : '';

    // Mercado Pago pode recusar e-mail inválido, domínio .local ou e-mail igual ao dono da conta.
    // O e-mail real do comprador continua salvo no Firestore; aqui usamos um pagador técnico válido.
   // Tenta usar o e-mail real. Se o cara não tiver e-mail, gera um com o ID dele para a API não quebrar.
    const emailOriginal = String(buyer.email || '').trim();
    const emailValido = emailOriginal.includes('@') && emailOriginal.includes('.');
    const payerEmail = emailValido ? emailOriginal : `id-${buyer.gameId || 'anon'}@guildahub.online`;
    await checkoutRef.set({
      id: checkoutId,
      orderId,
      productId: product.id,
      productSnapshot: product,
      buyerId: buyer.gameId,
      buyerUid: buyer.uid || '',
      buyerEmail: buyer.email || '',
      buyerName: buyer.nick || '',
      buyerPhoto: buyer.foto || '',
      sellerId: product.sellerId || 'ghub',
      sellerName: product.sellerName || 'GuildaHub',
      sellerPhoto: product.sellerPhoto || '',
      amount,
      moeda: product.moeda || 'BRL',
      status: 'creating',
      paymentStatus: 'creating',
      orderCreated: false,
      notification_url,
      expiresAtMs,
      expiresInMinutes: PIX_EXPIRATION_MINUTES,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      createdAtMs: nowMs,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: false });

    const idempotencyKey = makeIdempotencyKey();
    let mpPayment;
    try {
     const paymentPayload = {
        transaction_amount: amount,
        description: `LOJINHA - HUB - ${product.titulo}`.slice(0, 255),
        date_of_expiration: new Date(expiresAtMs).toISOString(),
        payment_method_id: 'pix',
        payer: { 
          email: payerEmail,
          first_name: `ID GUILDA•HUB: ${buyer.gameId}`,
          last_name: `- ${buyer.nick || 'Comprador'}`
        },
        external_reference: `loja:${checkoutId}|pedido:${orderId}|produto:${product.id}|buyer:${buyer.gameId}|seller:${product.sellerId || 'ghub'}`,
        metadata: {
          checkout_id: checkoutId,
          order_id: orderId,
          product_id: product.id,
          buyer_id: buyer.gameId,
          seller_id: product.sellerId || 'ghub',
          buyer_email: buyer.email || '',
        },
      };
      if (notification_url) paymentPayload.notification_url = notification_url;

      mpPayment = await mercadoPagoFetch('/v1/payments', {
        method: 'POST',
        headers: { 'X-Idempotency-Key': idempotencyKey },
        body: JSON.stringify(paymentPayload),
      });
    } catch (mpErr) {
      const details = mpErr?.details || {};
      const cause = Array.isArray(details.cause) && details.cause.length
        ? details.cause.map((c) => c.description || c.message || c.code).filter(Boolean).join(' | ')
        : '';
      const mpMessage = details.message || details.error || cause || 'erro desconhecido';

      console.error('[LOJA_MP_CREATE_PIX] Mercado Pago recusou', {
        mp_status: mpErr?.status || 0,
        mp_response: details,
        checkoutId,
        productId: product.id,
        payerEmail,
        idempotencyKey,
      });

      await checkoutRef.set({
        status: 'mp_error',
        paymentStatus: 'mp_error',
        mpErrorStatus: mpErr?.status || 0,
        mpErrorMessage: mpMessage,
        mpErrorRaw: details,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAtMs: Date.now(),
      }, { merge: true });

      return json(res, 400, {
        ok: false,
        error: 'mercado-pago-error',
        message: `Mercado Pago recusou: ${mpMessage}`,
        mp_status: mpErr?.status || 0,
        mp_response: details,
      });
    }

    const tx = mpPayment.point_of_interaction?.transaction_data || {};
    const qrCode = tx.qr_code || '';
    const qrBase64 = tx.qr_code_base64 || '';
    const paymentStatus = mapPaymentStatus(mpPayment.status || 'pending');

    await checkoutRef.set({
      paymentId: String(mpPayment.id || ''),
      paymentStatus,
      status: paymentStatus,
      mpRawStatus: mpPayment.status || '',
      idempotencyKey,
      qrCode,
      qrBase64,
      qrCodeBase64: qrBase64,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAtMs: Date.now(),
    }, { merge: true });

    await markCreated(lojaDb, buyer.uid || buyer.gameId);

    return json(res, 200, {
      ok: true,
      checkoutId,
      orderId,
      paymentId: String(mpPayment.id || ''),
      status: paymentStatus,
      qrCode,
      copiaCola: qrCode,
      qrCodeBase64: qrBase64,
      qrBase64,
      amount,
      productId: product.id,
      productTitle: product.titulo || '',
      expiresAtMs,
      expiresInMinutes: PIX_EXPIRATION_MINUTES,
    });
  } catch (err) {
    console.error('[LOJA_MP_CREATE_PIX]', err?.message || err, err?.details || '');
    const status = err.message === 'buyer-profile-local-required' ? 400 : 500;
    return json(res, status, { ok: false, error: err.message || 'internal-error' });
  }
};
