// api/monetize_request_withdraw.js
// Solicitação segura de saque dos parceiros.
// Usa Admin SDK com FIREBASE_SERVICE_ACCOUNT. O front-end nunca altera saldo.

const admin = require('firebase-admin');

function getEnv(name) {
  const v = process.env[name];
  return (v && String(v).trim()) || '';
}

function parseServiceAccount() {
  const raw = getEnv('FIREBASE_SERVICE_ACCOUNT') || getEnv('FIREBASE_SERVICE_ACCOUNT_JSON');
  if (!raw) throw new Error('FIREBASE_SERVICE_ACCOUNT ausente.');
  const sa = JSON.parse(raw);
  if (sa.private_key && typeof sa.private_key === 'string') {
    sa.private_key = sa.private_key.replace(/\\n/g, '\n');
  }
  return sa;
}

function initAdmin() {
  const existing = admin.apps.find((app) => app.name === 'ghub-monetize-admin');
  if (existing) return existing;
  const sa = parseServiceAccount();
  return admin.initializeApp({
    credential: admin.credential.cert(sa),
    projectId: sa.project_id,
  }, 'ghub-monetize-admin');
}

function json(res, status, data) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(data));
}

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}

function getBearerToken(req) {
  const authz = String(req.headers?.authorization || req.headers?.Authorization || '').trim();
  return authz.toLowerCase().startsWith('bearer ') ? authz.slice(7).trim() : '';
}

function toMoneyNumber(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const clean = String(value ?? '')
    .replace(/[^0-9,.-]/g, '')
    .replace(/\.(?=\d{3}(\D|$))/g, '')
    .replace(',', '.');
  const parsed = Number(clean);
  return Number.isFinite(parsed) ? parsed : 0;
}

function roundMoney(value) {
  return Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100;
}

function sanitizeText(value, max = 120) {
  return String(value || '').trim().slice(0, max);
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
    const app = initAdmin();
    const db = app.firestore();
    const idToken = getBearerToken(req);
    if (!idToken) return json(res, 401, { ok: false, error: 'auth-required' });

    let decoded;
    try {
      decoded = await app.auth().verifyIdToken(idToken);
    } catch (_) {
      return json(res, 401, { ok: false, error: 'auth-invalid' });
    }

    const authUid = String(decoded?.uid || '').trim();
    const authEmail = String(decoded?.email || '').trim().toLowerCase();
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    const userId = sanitizeText(body.userId || body.gameId || '', 80);
    const pix = sanitizeText(body.pix || '', 120);
    const amount = roundMoney(toMoneyNumber(body.amount));

    if (!authUid) return json(res, 401, { ok: false, error: 'auth-invalid' });
    if (!userId) return json(res, 400, { ok: false, error: 'user-id-required' });
    if (!pix || pix.length < 4) return json(res, 400, { ok: false, error: 'pix-required' });
    if (!Number.isFinite(amount) || amount < 10) {
      return json(res, 400, { ok: false, error: 'withdraw-min-10' });
    }

    const mRef = db.collection('monetize').doc(userId);
    let responsePayload = null;

    await db.runTransaction(async (tx) => {
      const snap = await tx.get(mRef);
      if (!snap.exists) throw new Error('partner-not-found');

      const data = snap.data() || {};
      const ownerUid = String(data.uid || '').trim();
      const ownerEmail = String(data.email || '').trim().toLowerCase();
      const belongsToUser = (!!ownerUid && ownerUid === authUid) || (!!ownerEmail && !!authEmail && ownerEmail === authEmail);
      if (!belongsToUser) throw new Error('not-owner');

      if (data.parceiro !== true) throw new Error('partner-not-active');
      if (data.saque?.status === 'pendente' || data.saquePendente === true) throw new Error('withdraw-already-pending');

      const saldoAtual = roundMoney(toMoneyNumber(data.saldoAtual ?? data.saldoDisponivel ?? 0));
      if (saldoAtual < 10) throw new Error('insufficient-balance-min');
      if (amount > saldoAtual) throw new Error('withdraw-greater-than-balance');

      const saque = {
        status: 'pendente',
        valor: amount,
        pix,
        solicitadoEm: admin.firestore.FieldValue.serverTimestamp(),
        solicitadoEmMs: Date.now(),
        solicitadoPorUid: authUid,
        solicitadoPorEmail: authEmail,
      };

      tx.set(mRef, {
        pix,
        saque,
        saquePendente: true,
        valorSaqueSolicitado: amount,
        saldoEmSaque: amount,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAtMs: Date.now(),
      }, { merge: true });

      responsePayload = {
        saldoAtual,
        saldoSacado: roundMoney(toMoneyNumber(data.saldoSacado ?? data.totalSacado ?? 0)),
        totalConvidados: Number(data.totalConvidados || 0) || 0,
        totalPagantes: Number(data.totalPagantes || 0) || 0,
        pix,
        saque: { ...saque, solicitadoEm: new Date().toISOString() },
        saquePendente: true,
        valorSaqueSolicitado: amount,
      };
    });

    return json(res, 200, {
      ok: true,
      saque: responsePayload.saque,
      monetize: responsePayload,
    });
  } catch (error) {
    const msg = String(error?.message || error || 'internal-error');
    const map = {
      'partner-not-found': 'Parceiro não encontrado.',
      'not-owner': 'Você não tem permissão para solicitar saque desta conta.',
      'partner-not-active': 'Programa de parceiros não está ativo.',
      'withdraw-already-pending': 'Você já tem um saque pendente.',
      'insufficient-balance-min': 'Saldo insuficiente. O mínimo para saque é R$ 10,00.',
      'withdraw-greater-than-balance': 'O valor solicitado não pode ser maior que o saldo disponível.',
    };
    const status = ['not-owner'].includes(msg) ? 403 : 400;
    return json(res, status, { ok: false, error: map[msg] || msg });
  }
};
