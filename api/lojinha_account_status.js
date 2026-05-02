// api/lojinha_account_status.js
// Verifica, com Auth principal da GuildaHub, se o usuário já tem conta/perfis na Lojinha.
// Não cria nem altera dados. Serve para o front decidir entre login e criação sem depender de fetchSignInMethodsForEmail.

const {
  admin,
  json,
  cors,
  getLojaDb,
  verifyBuyerFromRequest,
} = require('./_loja_mp_shared');

function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}

function publicSellerStatus(data = null) {
  if (!data) return 'inexistente';
  if (data.ativo === true && (data.verificado === true || data.aprovado === true || String(data.verificacaoStatus || '').toLowerCase() === 'aprovado' || String(data.verificationStatus || '').toLowerCase() === 'approved')) return 'ativo';
  return String(data.status || data.verificacaoStatus || data.verificationStatus || 'inativo').toLowerCase();
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
    const ghubProfile = await verifyBuyerFromRequest(req);
    const email = normalizeEmail(ghubProfile.email || '');
    const gameId = String(ghubProfile.gameId || '').trim();
    if (!gameId) return json(res, 400, { ok: false, error: 'profile-not-found' });

    const lojaDb = getLojaDb();
    let authExists = false;
    let authUid = '';

    if (email) {
      try {
        const authUser = await admin.app('loja-ghub-admin').auth().getUserByEmail(email);
        authExists = !!authUser?.uid;
        authUid = String(authUser?.uid || '');
      } catch (err) {
        if (String(err?.code || '') !== 'auth/user-not-found') {
          console.warn('[LOJINHA_ACCOUNT_STATUS][AUTH_LOOKUP]', err?.code || err?.message || err);
        }
      }
    }

    const [buyerSnap, sellerSnap, verificationSnap] = await Promise.all([
      lojaDb.collection('comprador').doc(gameId).get().catch(() => null),
      lojaDb.collection('vendedor').doc(gameId).get().catch(() => null),
      lojaDb.collection('verificacao').doc(gameId).get().catch(() => null),
    ]);

    const buyer = buyerSnap?.exists ? (buyerSnap.data() || {}) : null;
    const seller = sellerSnap?.exists ? (sellerSnap.data() || {}) : null;
    const verification = verificationSnap?.exists ? (verificationSnap.data() || {}) : null;

    return json(res, 200, {
      ok: true,
      gameId,
      email,
      authExists,
      authUid,
      buyerExists: !!buyer,
      sellerExists: !!seller,
      verificationExists: !!verification,
      sellerStatus: publicSellerStatus(seller),
      verificationStatus: String(verification?.status || verification?.verificacaoStatus || verification?.verificationStatus || '').toLowerCase(),
    });
  } catch (err) {
    console.error('[LOJINHA_ACCOUNT_STATUS]', err?.message || err);
    const code = String(err?.message || 'internal-error');
    const status = {
      'buyer-auth-required': 401,
      'ghub-auth-invalid': 401,
      'buyer-profile-not-found': 404,
      'profile-not-found': 404,
      'ghub-auth-env-missing': 500,
    }[code] || 500;
    return json(res, status, { ok: false, error: code });
  }
};
