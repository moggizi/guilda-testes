// api/loja_mp_create_pix.js
// Cria Pix seguro para produto da Loginha.
// O pedido só é criado depois do pagamento aprovado no status/webhook.

const {
  admin,
  json,
  cors,
  getLojaDb,
  verifyBuyerFromRequest,
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
    const buyer = await verifyBuyerFromRequest(req);
    const lojaDb = getLojaDb();
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
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

    const amount = Number(product.preco || 0);
    if (!Number.isFinite(amount) || amount <= 0) return json(res, 400, { ok: false, error: 'invalid-amount' });

    await ensureBuyerProfile(lojaDb, buyer);

    // Reutiliza Pix pendente do mesmo comprador/produto se ainda existir.
    const pendingSnap = await lojaDb.collection('pagamentosLoja')
      .where('buyerId', '==', String(buyer.gameId))
      .where('productId', '==', String(product.id))
      .where('orderCreated', '==', false)
      .limit(5)
      .get();

    const reusable = pendingSnap.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .find((p) => ['pending', 'in_process', 'creating'].includes(String(p.paymentStatus || p.status || '').toLowerCase()) && p.paymentId && p.qrCode);

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
        amount: Number(reusable.amount || amount),
        productId: product.id,
      });
    }

    const cd = await creationCooldown(lojaDb, buyer.uid || buyer.gameId, 2 * 60 * 1000);
    if (!cd.ok) {
      const waitSec = Math.max(1, Math.ceil((cd.retryAfterMs || 0) / 1000));
      return json(res, 429, { ok: false, error: `Aguarde ${waitSec}s para gerar outro Pix.` });
    }

    const checkoutRef = lojaDb.collection('pagamentosLoja').doc();
    const checkoutId = checkoutRef.id;
    const orderId = lojaDb.collection('pedidos').doc().id;
    const baseUrl = getBaseUrl(req);
    const notification_url = `${baseUrl}/api/loja_mp_webhook`;

    // O Mercado Pago pode recusar o pagamento quando o e-mail do pagador é
    // inválido ou quando é o mesmo e-mail da conta dona do Access Token.
    // Como o e-mail real do comprador já fica salvo no Firestore, usamos um
    // e-mail técnico válido e estável só para criar o Pix.
    const payerEmail = `comprador-${String(buyer.gameId || buyer.uid || 'anon').replace(/[^a-zA-Z0-9._-]/g, '')}@guildahub.online`;

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
      amount: Number(amount.toFixed(2)),
      moeda: product.moeda || 'BRL',
      status: 'creating',
      paymentStatus: 'creating',
      orderCreated: false,
      notification_url,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      createdAtMs: Date.now(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: false });

    const idempotencyKey = makeIdempotencyKey();
    let mpPayment;
    try {
      mpPayment = await mercadoPagoFetch('/v1/payments', {
        method: 'POST',
        headers: { 'X-Idempotency-Key': idempotencyKey },
        body: JSON.stringify({
          transaction_amount: Number(amount.toFixed(2)),
          description: `Guilda HUB - ${product.titulo}`.slice(0, 255),
          payment_method_id: 'pix',
          payer: { email: payerEmail },
          notification_url,
          external_reference: `loja:${checkoutId}|pedido:${orderId}|produto:${product.id}|buyer:${buyer.gameId}|seller:${product.sellerId || 'ghub'}`,
          metadata: {
            checkout_id: checkoutId,
            order_id: orderId,
            product_id: product.id,
            buyer_id: buyer.gameId,
            seller_id: product.sellerId || 'ghub',
          },
        }),
      });
    } catch (mpErr) {
      const details = mpErr?.details || {};
      const causeMessage = Array.isArray(details?.cause)
        ? details.cause.map((item) => item?.description || item?.message || item?.code || '').filter(Boolean).join(' | ')
        : '';
      const mpMessage = String(details?.message || causeMessage || details?.error || mpErr?.message || 'Erro ao criar Pix no Mercado Pago');
      await checkoutRef.set({
        status: 'failed',
        paymentStatus: 'failed',
        mpErrorMessage: mpMessage,
        mpErrorDetails: details,
        failedAtMs: Date.now(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      }, { merge: true });
      const err = new Error('mercado-pago-error');
      err.status = mpErr?.status || 502;
      err.publicMessage = mpMessage;
      err.details = details;
      throw err;
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
      amount: Number(amount.toFixed(2)),
      productId: product.id,
    });
  } catch (err) {
    console.error('[LOJA_MP_CREATE_PIX]', err?.message || err, err?.details || '');
    const status = err.message === 'buyer-auth-required' ? 401 : (err.status || 500);
    return json(res, status, {
      ok: false,
      error: err.message || 'internal-error',
      message: err.publicMessage || '',
    });
  }
};
