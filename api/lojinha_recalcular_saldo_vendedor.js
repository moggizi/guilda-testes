// api/lojinha_recalcular_saldo_vendedor.js
// Recalcula saldo atual/pendente pela Vercel/Admin SDK.

const {
  json,
  cors,
  getLojaDb,
  verifyLojaAuth,
  isSellerActive,
  recalcSellerFinancials,
} = require('./_lojinha_admin_shared');

module.exports = async (req, res) => {
  cors(res);
  if (req.method === 'OPTIONS') { res.statusCode = 204; return res.end(); }
  if (req.method !== 'POST') return json(res, 405, { ok: false, error: 'method-not-allowed' });

  try {
    const authUser = await verifyLojaAuth(req);
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    const sellerId = String(body.sellerId || '').trim();
    if (!sellerId) return json(res, 400, { ok: false, error: 'seller-required' });

    const db = getLojaDb();
    const [sellerSnap, adminSnap] = await Promise.all([
      db.collection('vendedor').doc(sellerId).get(),
      db.collection('admin').doc(authUser.uid).get().catch(() => null),
    ]);
    if (!sellerSnap.exists) return json(res, 404, { ok: false, error: 'seller-not-found' });
    const seller = sellerSnap.data() || {};
    const isAdmin = !!adminSnap?.exists;
    const isOwner = String(seller.authUid || seller.lojinhaUid || '') === String(authUser.uid);
    if (!isAdmin && !isOwner) return json(res, 403, { ok: false, error: 'seller-not-authorized' });
    if (!isAdmin && !isSellerActive(seller)) return json(res, 409, { ok: false, error: 'seller-inactive' });

    const finances = await recalcSellerFinancials(db, sellerId);
    return json(res, 200, { ok: true, sellerId, finances });
  } catch (err) {
    const code = String(err?.message || 'internal-error');
    const status = code === 'auth-required' || code === 'auth-invalid' ? 401 : 500;
    console.error('[LOJINHA_RECALCULAR_SALDO]', code, err?.stack || '');
    return json(res, status, { ok: false, error: code });
  }
};
