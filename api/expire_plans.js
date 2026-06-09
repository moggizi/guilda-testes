const admin = require('firebase-admin');
const planUtils = require('./_plan_utils');

function getServiceAccount() {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!raw) throw new Error('Missing FIREBASE_SERVICE_ACCOUNT');
  const sa = JSON.parse(raw);
  if (sa.private_key && typeof sa.private_key === 'string') {
    sa.private_key = sa.private_key.replace(/\\n/g, '\n');
  }
  return sa;
}

function initAdmin() {
  const existingDefault = admin.apps.find((app) => app.name === '[DEFAULT]');
  if (existingDefault) return existingDefault;
  return admin.initializeApp({ credential: admin.credential.cert(getServiceAccount()) });
}

function normalizeTier(value) {
  const s = planUtils.normalizePlan(value);
  return s || 'free';
}

function toMs(value) {
  try {
    if (value == null || value === '') return null;
    if (typeof value === 'number') return Number.isFinite(value) ? value : null;
    if (typeof value === 'string') {
      const n = Number(value);
      if (Number.isFinite(n)) return n;
      const t = Date.parse(value);
      return Number.isFinite(t) ? t : null;
    }
    if (typeof value === 'object') {
      if (typeof value.toMillis === 'function') return value.toMillis();
      if (typeof value.seconds === 'number') return value.seconds * 1000;
    }
  } catch (_) {}
  return null;
}

function planFromData(data = {}) {
  const rawTier = data.vipTier ?? data.vip ?? data.planoVip ?? data.planoVIP ?? data.vipLevel ?? data.vipPlano ?? data.vipName ?? data.plano ?? data.plan ?? data.tier;
  const rawExp = data.vipExpiresAt ?? data.vipExpiresAtMs ?? data.vipExpiraEm ?? data.vipExpireAt ?? data.expiresAt ?? data.expireAt ?? data.expiraEm ?? data.expire ?? data.expiration ?? data.vipExpires;
  return {
    tier: normalizeTier(rawTier),
    expiresAtMs: toMs(rawExp),
  };
}

function shouldExpirePlan(data = {}, nowMs = Date.now()) {
  const { tier, expiresAtMs } = planFromData(data);
  if (!tier || tier === 'free' || tier === 'parceiro') return null;
  if (expiresAtMs == null || !Number.isFinite(expiresAtMs)) return null;
  if (nowMs < expiresAtMs) return null;
  return { tier, expiresAtMs };
}

function requestToken(req) {
  const auth = String(req.headers?.authorization || '').trim();
  if (auth.toLowerCase().startsWith('bearer ')) return auth.slice(7).trim();
  return String(req.query?.secret || req.headers?.['x-cron-secret'] || '').trim();
}

function isAuthorized(req) {
  const secret = String(process.env.EXPIRE_PLANS_SECRET || process.env.CRON_SECRET || '').trim();
  const token = requestToken(req);
  if (secret && token && token === secret) return true;

  const ua = String(req.headers?.['user-agent'] || '').toLowerCase();
  const vercelCronHeader = String(req.headers?.['x-vercel-cron'] || '').trim() === '1';
  return vercelCronHeader || ua.includes('vercel-cron');
}

async function collectExpiredFromCollection(db, collectionName, nowMs, outMap) {
  const snap = await db.collection(collectionName).get();
  let checked = 0;

  snap.forEach((docSnap) => {
    checked += 1;
    const expired = shouldExpirePlan(docSnap.data() || {}, nowMs);
    if (!expired) return;

    const current = outMap.get(docSnap.id);
    if (!current || expired.expiresAtMs < current.expiresAtMs) {
      outMap.set(docSnap.id, {
        guildId: docSnap.id,
        source: collectionName,
        tier: expired.tier,
        expiresAtMs: expired.expiresAtMs,
      });
    }
  });

  return checked;
}

async function commitBatchIfNeeded(db, state, force = false) {
  if (!state.ops) return;
  if (!force && state.ops < 450) return;
  await state.batch.commit();
  state.batch = db.batch();
  state.ops = 0;
}

module.exports = async (req, res) => {
  try {
    if (req.method !== 'GET' && req.method !== 'POST') {
      return res.status(405).json({ ok: false, error: 'Method not allowed' });
    }

    if (!isAuthorized(req)) {
      return res.status(401).json({ ok: false, error: 'Não autorizado.' });
    }

    initAdmin();
    const db = admin.firestore();
    const nowMs = Date.now();
    const dryRun = String(req.query?.dryRun || req.query?.dry || '').trim() === '1';
    const expired = new Map();

    const checkedConfigGuilda = await collectExpiredFromCollection(db, 'configGuilda', nowMs, expired);
    const checkedGuildas = await collectExpiredFromCollection(db, 'guildas', nowMs, expired);

    const expiredList = Array.from(expired.values()).sort((a, b) => String(a.guildId).localeCompare(String(b.guildId)));

    if (!dryRun && expiredList.length) {
      const state = { batch: db.batch(), ops: 0 };

      for (const item of expiredList) {
        const patch = {
          vipTier: 'free',
          vipExpiresAt: null,
          permissoesAtivas: false,
          expiredFromTier: item.tier,
          expiredAtMs: nowMs,
          expiredBy: 'api/expire_plans',
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          updatedAtMs: nowMs,
        };

        state.batch.set(db.collection('configGuilda').doc(item.guildId), patch, { merge: true });
        state.ops += 1;
        state.batch.set(db.collection('guildas').doc(item.guildId), patch, { merge: true });
        state.ops += 1;

        await commitBatchIfNeeded(db, state);
      }

      await commitBatchIfNeeded(db, state, true);
    }

    return res.status(200).json({
      ok: true,
      dryRun,
      nowMs,
      checked: {
        configGuilda: checkedConfigGuilda,
        guildas: checkedGuildas,
      },
      expired: expiredList.length,
      guilds: expiredList.slice(0, 50),
      truncated: expiredList.length > 50,
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      error: error?.message || 'Erro interno ao expirar planos.',
    });
  }
};
