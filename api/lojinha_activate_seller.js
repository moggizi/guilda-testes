// api/lojinha_activate_seller.js
// Ativa/cria o documento vendedor depois que a verificação foi aprovada.
// Usa Admin SDK do Firebase da Lojinha via LOJA_FIREBASE_SERVICE_ACCOUNT_JSON.

const {
  admin,
  json,
  cors,
  getLojaDb,
  verifyLojaAuthFromRequest,
} = require('./_loja_mp_shared');

function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}

function cleanText(value, max = 200) {
  return String(value || '').trim().slice(0, max);
}

function isApprovedVerification(data = {}) {
  const status = String(
    data.status ||
    data.verificacaoStatus ||
    data.verificationStatus ||
    data.statusVerificacao ||
    ''
  ).toLowerCase();
  return data.aprovado === true
    || data.approved === true
    || status === 'aprovado'
    || status === 'approved';
}

function isRevokedOrBlocked(data = {}) {
  const status = String(data.status || '').toLowerCase();
  return data.revogado === true
    || data.revogada === true
    || data.bloqueado === true
    || data.bloqueada === true
    || data.excluido === true
    || data.excluida === true
    || !!data.revogadoEmMs
    || !!data.excluidoEmMs
    || status === 'revogado'
    || status === 'bloqueado'
    || status === 'excluido'
    || status === 'inativo';
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
    const gameId = String(body.gameId || body.id || '').replace(/\D+/g, '').trim();
    if (!gameId) return json(res, 400, { ok: false, error: 'game-id-required' });

    const lojaDb = getLojaDb();
    const FieldValue = admin.firestore.FieldValue;
    const sellerRef = lojaDb.collection('vendedor').doc(gameId);
    const verificationRef = lojaDb.collection('verificacao').doc(gameId);

    let responsePayload = null;

    await lojaDb.runTransaction(async (tx) => {
      const [verificationSnap, sellerSnap] = await Promise.all([
        tx.get(verificationRef),
        tx.get(sellerRef),
      ]);

      if (!verificationSnap.exists) throw new Error('verification-not-found');
      const verification = verificationSnap.data() || {};
      const existing = sellerSnap.exists ? (sellerSnap.data() || {}) : null;

      if (isRevokedOrBlocked(verification) || isRevokedOrBlocked(existing || {})) {
        throw new Error('seller-revoked');
      }
      if (!isApprovedVerification(verification)) throw new Error('verification-not-approved');

      const verificationAuthUid = String(verification.authUid || verification.lojinhaUid || verification.lojaAuthUid || '').trim();
      const existingAuthUid = String(existing?.authUid || existing?.lojinhaUid || existing?.lojaAuthUid || '').trim();
      const authEmail = normalizeEmail(lojaAuth.authEmail || '');
      const verificationEmail = normalizeEmail(verification.authEmail || verification.email || verification.playerEmail || '');
      const existingEmail = normalizeEmail(existing?.authEmail || existing?.email || existing?.playerEmail || '');

      const uidMatches = (!!verificationAuthUid && verificationAuthUid === lojaAuth.authUid)
        || (!!existingAuthUid && existingAuthUid === lojaAuth.authUid);
      const emailMatches = !!authEmail && (authEmail === verificationEmail || authEmail === existingEmail);

      if (!uidMatches && !emailMatches) throw new Error('verification-owner-mismatch');

      const nowMs = Date.now();
      const sellerPayload = {
        ...(existing || {}),
        id: gameId,
        gameId,
        uid: cleanText(body.ghubUid || verification.uid || verification.ghubUid || existing?.uid || '', 160),
        ghubUid: cleanText(body.ghubUid || verification.ghubUid || verification.uid || existing?.ghubUid || '', 160),
        authUid: lojaAuth.authUid,
        lojinhaUid: lojaAuth.authUid,
        authEmail: authEmail || verificationEmail || existingEmail,
        email: normalizeEmail(body.email || verification.email || existing?.email || authEmail),
        playerEmail: normalizeEmail(body.email || verification.email || existing?.playerEmail || authEmail),
        nome: cleanText(body.nick || verification.nick || existing?.nome || existing?.nick || '', 80),
        nick: cleanText(body.nick || verification.nick || existing?.nick || existing?.nome || '', 80),
        foto: cleanText(body.foto || verification.foto || existing?.foto || '', 1000),
        tipo: existing?.tipo || 'externo',
        status: 'ativo',
        ativo: true,
        verificado: true,
        aprovado: true,
        verificacaoStatus: 'aprovado',
        verificationStatus: 'approved',
        statusVerificacao: 'aprovado',
        verificationId: gameId,
        totalProdutos: Number(existing?.totalProdutos || 0),
        totalVendas: Number(existing?.totalVendas || 0),
        totalVendasEntregues: Number(existing?.totalVendasEntregues || existing?.totalVendas || 0),
        updatedAt: FieldValue.serverTimestamp(),
        updatedAtMs: nowMs,
        ...(existing?.createdAt ? {} : { createdAt: FieldValue.serverTimestamp(), createdAtMs: nowMs })
      };

      tx.set(sellerRef, sellerPayload, { merge: true });
      tx.set(verificationRef, {
        authUid: lojaAuth.authUid,
        lojinhaUid: lojaAuth.authUid,
        authEmail: authEmail || verificationEmail,
        vendedorAtivado: true,
        vendedorAtivadoEmMs: nowMs,
        updatedAt: FieldValue.serverTimestamp(),
        updatedAtMs: nowMs,
      }, { merge: true });

      responsePayload = { vendedor: sellerPayload, created: !sellerSnap.exists };
    });

    return json(res, 200, { ok: true, ...responsePayload });
  } catch (err) {
    console.error('[LOJINHA_ACTIVATE_SELLER]', err?.message || err);
    const code = String(err?.message || 'internal-error');
    const status = {
      'loja-auth-required': 401,
      'loja-auth-invalid': 401,
      'game-id-required': 400,
      'verification-not-found': 404,
      'verification-not-approved': 409,
      'verification-owner-mismatch': 403,
      'seller-revoked': 403,
      'seller-blocked': 403,
    }[code] || 500;
    return json(res, status, { ok: false, error: code });
  }
};
