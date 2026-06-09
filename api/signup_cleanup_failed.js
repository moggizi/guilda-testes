// api/signup_cleanup_failed.js
// Rollback seguro de cadastro incompleto.
// Remove Auth + documentos básicos criados parcialmente quando a criação de conta falha.

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
  const existing = admin.apps.find((app) => app.name === 'ghub-signup-cleanup-admin');
  if (existing) return existing;
  const sa = parseServiceAccount();
  return admin.initializeApp({
    credential: admin.credential.cert(sa),
    projectId: sa.project_id,
  }, 'ghub-signup-cleanup-admin');
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

function maxCleanupAgeMs() {
  const raw = Number(getEnv('SIGNUP_CLEANUP_MAX_AGE_MS'));
  return Number.isFinite(raw) && raw > 0 ? raw : 60 * 60 * 1000;
}

function authUserCreatedAtMs(userRecord) {
  try {
    const raw = userRecord?.metadata?.creationTime || '';
    const parsed = Date.parse(raw);
    return Number.isFinite(parsed) ? parsed : null;
  } catch (_) {
    return null;
  }
}

async function deleteCollection(db, path, batchSize = 100) {
  const colRef = db.collection(path);
  while (true) {
    const snap = await colRef.limit(batchSize).get();
    if (snap.empty) return;
    const batch = db.batch();
    snap.docs.forEach((docSnap) => batch.delete(docSnap.ref));
    await batch.commit();
    if (snap.size < batchSize) return;
  }
}

async function cleanupPartnerInviteIfNeeded(db, ref, guildId) {
  const partnerId = sanitizeId(ref);
  const gid = sanitizeId(guildId);
  if (!partnerId || !gid) return false;

  const partnerRef = db.collection('monetize').doc(partnerId);
  const indicatedRef = partnerRef.collection('indicados').doc(gid);

  let removed = false;
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(indicatedRef);
    if (!snap.exists) return;

    tx.delete(indicatedRef);
    tx.set(partnerRef, {
      totalConvidados: admin.firestore.FieldValue.increment(-1),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAtMs: Date.now(),
    }, { merge: true });
    removed = true;
  });

  return removed;
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
    const uid = String(decoded?.uid || '').trim();
    const gameId = sanitizeId(body.gameId || body.userId || body.playerId || '');
    const guildId = sanitizeId(body.guildId || body.guild || uid);
    let ref = sanitizeId(body.ref || body.partnerId || body.parceiro || '');
    const reason = String(body.reason || 'signup-failed').slice(0, 160);

    if (!uid) return json(res, 401, { ok: false, error: 'auth-invalid' });
    if (guildId && guildId !== uid) return json(res, 403, { ok: false, error: 'only-self-cleanup' });
    if (reason === 'incomplete-existing-session') {
      return json(res, 409, { ok: false, skipped: true, error: 'existing-session-cleanup-blocked' });
    }

    let userRecord = null;
    try {
      userRecord = await app.auth().getUser(uid);
    } catch (error) {
      if (String(error?.code || '').includes('user-not-found')) {
        return json(res, 200, { ok: true, skipped: true, error: 'auth-user-not-found' });
      }
      throw error;
    }

    const createdAtMs = authUserCreatedAtMs(userRecord);
    const nowMs = Date.now();
    const ageMs = createdAtMs == null ? null : nowMs - createdAtMs;
    if (ageMs == null || ageMs < 0 || ageMs > maxCleanupAgeMs()) {
      return json(res, 409, {
        ok: false,
        skipped: true,
        error: 'cleanup-window-expired',
        ageMs
      });
    }

    const cfgRef = db.collection('configGuilda').doc(uid);
    try {
      const cfgSnap = await cfgRef.get();
      if (cfgSnap.exists) {
        const cfg = cfgSnap.data() || {};
        const ownerUid = String(cfg.ownerUid || '').trim();
        if (ownerUid && ownerUid !== uid) return json(res, 403, { ok: false, error: 'owner-mismatch' });
        if (!ref) ref = sanitizeId(cfg.indicadoPorParceiro || cfg.parceiroRef || '');
      }
    } catch (_) {}

    const deleted = {
      auth: false,
      docs: [],
      partnerInvite: false,
    };

    if (ref) {
      try {
        deleted.partnerInvite = await cleanupPartnerInviteIfNeeded(db, ref, uid);
      } catch (_) {}
    }

    const knownGuildSubcollections = [
      'membros', 'membros2', 'membros3', 'membros4',
      'lines', 'campeonatos'
    ];

    for (const sub of knownGuildSubcollections) {
      try { await deleteCollection(db, `guildas/${uid}/${sub}`); } catch (_) {}
    }

    const batch = db.batch();
    const docPaths = [
      gameId ? `users/${gameId}` : '',
      `users/${uid}`,
      `guildas/${uid}`,
      `configGuilda/${uid}`,
      `solicita/${uid}`,
    ].filter(Boolean);

    Array.from(new Set(docPaths)).forEach((path) => {
      batch.delete(db.doc(path));
      deleted.docs.push(path);
    });

    // Registro técnico fora dos docs principais. Não bloqueia a limpeza se falhar.
    try {
      batch.set(db.collection('signupCleanupLogs').doc(uid), {
        uid,
        gameId: gameId || null,
        guildId: uid,
        ref: ref || null,
        reason,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        createdAtMs: Date.now(),
      }, { merge: true });
    } catch (_) {}

    await batch.commit();

    try {
      await app.auth().deleteUser(uid);
      deleted.auth = true;
    } catch (error) {
      if (String(error?.code || '').includes('user-not-found')) deleted.auth = true;
      else throw error;
    }

    return json(res, 200, { ok: true, deleted });
  } catch (error) {
    return json(res, 500, { ok: false, error: String(error?.message || error || 'internal-error') });
  }
};
