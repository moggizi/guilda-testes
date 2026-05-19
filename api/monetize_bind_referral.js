// api/monetize_bind_referral.js
// Vincula um novo usuário ao parceiro do link ?ref=ID.
// Deve ser chamada depois do cadastro/login inicial, com token do Firebase Auth.

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

function sanitizeId(value) {
  return String(value || '').trim().replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 80);
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

    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    const requestedRef = sanitizeId(body.ref || body.partnerId || body.parceiro || '');
    const requestedGameId = sanitizeId(body.gameId || body.userId || body.playerId || '');
    const uid = String(decoded?.uid || '').trim();
    const email = String(decoded?.email || '').trim().toLowerCase();
    const guildId = sanitizeId(body.guildId || body.guild || uid || '');

    if (!uid) return json(res, 401, { ok: false, error: 'auth-invalid' });
    if (!guildId) return json(res, 400, { ok: false, error: 'guild-id-required' });
    if (guildId !== uid) return json(res, 403, { ok: false, error: 'only-owner-guild-signup' });

    const guildCfgRef = db.collection('configGuilda').doc(guildId);

    let linked = false;
    let alreadyLinked = false;
    let finalRef = '';

    await db.runTransaction(async (tx) => {
      const guildCfgSnap = await tx.get(guildCfgRef);
      if (!guildCfgSnap.exists) throw new Error('guild-not-found');

      const guildCfg = guildCfgSnap.data() || {};
      if (String(guildCfg.ownerUid || '').trim() !== uid) throw new Error('only-owner-guild-signup');

      const refFromConfig = sanitizeId(guildCfg.indicadoPorParceiro || guildCfg.parceiroRef || '');
      finalRef = requestedRef || refFromConfig;
      const gameId = requestedGameId || sanitizeId(guildCfg.referralOwnerGameId || guildCfg.ownerGameId || guildCfg.gameId || '');

      if (!finalRef) throw new Error('ref-required');
      if (finalRef === gameId || finalRef === uid || finalRef === guildId) throw new Error('self-referral-blocked');
      if (refFromConfig && requestedRef && refFromConfig !== requestedRef) throw new Error('guild-already-linked');

      const partnerRef = db.collection('monetize').doc(finalRef);
      const indicatedRef = partnerRef.collection('indicados').doc(guildId);

      const [partnerSnap, indicatedSnap] = await Promise.all([
        tx.get(partnerRef),
        tx.get(indicatedRef),
      ]);

      if (!partnerSnap.exists) throw new Error('partner-not-found');
      const partner = partnerSnap.data() || {};
      if (partner.parceiro !== true) throw new Error('partner-not-active');

      const nowMs = Date.now();

      if (indicatedSnap.exists) {
        const indicatedData = indicatedSnap.data() || {};
        alreadyLinked = true;

        // Se o documento foi criado por outro fluxo antigo/webhook sem contar como convidado,
        // contabiliza uma única vez para corrigir a estatística do parceiro.
        if (indicatedData.convidadoContabilizado !== true) {
          tx.set(indicatedRef, {
            convidadoContabilizado: true,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            updatedAtMs: nowMs,
          }, { merge: true });

          tx.set(partnerRef, {
            totalConvidados: admin.firestore.FieldValue.increment(1),
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            updatedAtMs: nowMs,
          }, { merge: true });
        }
        return;
      }

      if (!refFromConfig) {
        tx.set(guildCfgRef, {
          indicadoPorParceiro: finalRef,
          parceiroRef: finalRef,
          indicadoPorEmMs: nowMs,
          indicadoPorEm: admin.firestore.FieldValue.serverTimestamp(),
          referralGuildUid: guildId,
          referralOwnerUid: uid,
          referralOwnerGameId: gameId,
          comissaoParceiroUsada: false,
          comissaoParceiroCreditada: false,
        }, { merge: true });
      }

      tx.set(indicatedRef, {
        uid,
        email,
        gameId,
        guildId,
        guildName: String(guildCfg.name || guildCfg.guilda || '').trim(),
        ownerEmail: String(guildCfg.ownerEmail || email || '').trim().toLowerCase(),
        status: 'convidado',
        comissaoCreditada: false,
        convidadoContabilizado: true,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        createdAtMs: nowMs,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAtMs: nowMs,
      }, { merge: true });

      tx.set(partnerRef, {
        totalConvidados: admin.firestore.FieldValue.increment(1),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAtMs: nowMs,
      }, { merge: true });
      linked = true;
    });

    return json(res, 200, { ok: true, linked, alreadyLinked, ref: finalRef });
  } catch (error) {
    const msg = String(error?.message || error || 'internal-error');
    const map = {
      'ref-required': 'Parceiro de indicação não informado.',
      'partner-not-found': 'Parceiro não encontrado.',
      'partner-not-active': 'Parceiro não está ativo.',
      'self-referral-blocked': 'Autoindicação bloqueada.',
      'guild-id-required': 'Guilda não informada.',
      'guild-not-found': 'Guilda não encontrada.',
      'only-owner-guild-signup': 'Indicação válida apenas para cadastro de dono de guilda.',
      'guild-already-linked': 'Guilda já foi vinculada a outro parceiro.',
    };
    return json(res, 400, { ok: false, error: map[msg] || msg });
  }
};
