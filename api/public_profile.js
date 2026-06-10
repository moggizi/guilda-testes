const admin = require('firebase-admin');

function getEnv(name) {
  const value = process.env[name];
  return value && String(value).trim();
}

function parseServiceAccount() {
  const raw = getEnv('FIREBASE_SERVICE_ACCOUNT') || getEnv('FIREBASE_SERVICE_ACCOUNT_JSON');
  if (!raw) throw new Error('FIREBASE_SERVICE_ACCOUNT ausente.');

  const serviceAccount = JSON.parse(raw);
  if (serviceAccount.private_key && typeof serviceAccount.private_key === 'string') {
    serviceAccount.private_key = serviceAccount.private_key.replace(/\\n/g, '\n');
  }
  return serviceAccount;
}

function initAdmin() {
  const existing = admin.apps.find((app) => app.name === 'ghub-public-profile-admin');
  if (existing) return existing;

  const serviceAccount = parseServiceAccount();
  return admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    projectId: serviceAccount.project_id,
  }, 'ghub-public-profile-admin');
}

function json(res, status, payload) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'private, no-store, max-age=0');
  res.end(JSON.stringify(payload));
}

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}

function bearerToken(req) {
  const authorization = String(req.headers?.authorization || req.headers?.Authorization || '').trim();
  return authorization.toLowerCase().startsWith('bearer ') ? authorization.slice(7).trim() : '';
}

function cleanEmail(value) {
  return String(value || '').trim().toLowerCase();
}

function cleanText(value, maxLength = 120) {
  return String(value || '').trim().slice(0, maxLength);
}

function cleanGameId(value) {
  const id = String(value || '').replace(/\D+/g, '').slice(0, 24);
  return id.length >= 4 ? id : '';
}

function normalizeRoleKey(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();
}

function normalizeRoleLabel(value) {
  const role = normalizeRoleKey(value);
  if (['lider', 'leader', 'chefe', 'dono', 'owner'].includes(role)) return 'Líder';
  if (role === 'admin' || role === 'administrador' || role.includes('admin')) return 'Admin';
  if (role === 'jogador' || role === 'player') return 'Jogador';
  return cleanText(value, 40) || 'Membro';
}

function listHasEmail(list, email) {
  const target = cleanEmail(email);
  if (!target || !Array.isArray(list)) return false;
  return list.some((item) => {
    if (typeof item === 'string') return cleanEmail(item) === target;
    return cleanEmail(item?.email || item?.playerEmail || item?.value) === target;
  });
}

function isOwner(uid, email, guildId, config = {}, guild = {}) {
  const ownerUid = cleanText(config.ownerUid || guild.ownerUid, 128);
  const ownerEmail = cleanEmail(config.ownerEmail || guild.ownerEmail);
  return (
    (!!uid && uid === guildId) ||
    (!!uid && !!ownerUid && uid === ownerUid) ||
    (!!email && !!ownerEmail && email === ownerEmail)
  );
}

function roleFromGuild(uid, email, guildId, config = {}, guild = {}, fallback = 'Membro') {
  if (isOwner(uid, email, guildId, config, guild)) return 'Líder';
  if (listHasEmail(config.leaders, email)) return 'Líder';
  if (listHasEmail(config.admins, email)) return 'Admin';
  if (email && cleanEmail(config.playerEmail) === cleanEmail(email)) return 'Jogador';
  return normalizeRoleLabel(fallback);
}

function safePhoto(value) {
  const photo = String(value || '').trim();
  if (!photo) return '';
  if (/^https:\/\//i.test(photo)) return photo.slice(0, 3000);
  if (/^data:image\/(?:png|jpe?g|webp|gif);base64,/i.test(photo) && photo.length <= 1000000) return photo;
  return '';
}

function dateValue(value) {
  if (!value) return null;
  if (typeof value === 'string') return cleanText(value, 40) || null;
  if (typeof value === 'number' && Number.isFinite(value)) return new Date(value).toISOString();
  if (typeof value.toDate === 'function') return value.toDate().toISOString();
  if (typeof value.seconds === 'number') return new Date(value.seconds * 1000).toISOString();
  return null;
}

async function resolveRequesterAccess(db, decoded) {
  const uid = cleanText(decoded?.uid, 128);
  const email = cleanEmail(decoded?.email);
  if (!uid) return null;

  const userSnap = await db.collection('users').doc(uid).get();
  const userData = userSnap.exists ? (userSnap.data() || {}) : {};
  let guildId = cleanText(userData.guildId, 128);

  let selfConfigSnap = null;
  if (!guildId) {
    selfConfigSnap = await db.collection('configGuilda').doc(uid).get();
    if (selfConfigSnap.exists) guildId = uid;
  }
  if (!guildId) return null;

  const [configSnap, guildSnap] = await Promise.all([
    selfConfigSnap && guildId === uid
      ? Promise.resolve(selfConfigSnap)
      : db.collection('configGuilda').doc(guildId).get(),
    db.collection('guildas').doc(guildId).get(),
  ]);

  const config = configSnap.exists ? (configSnap.data() || {}) : {};
  const guild = guildSnap.exists ? (guildSnap.data() || {}) : {};
  const role = roleFromGuild(uid, email, guildId, config, guild, userData.role);
  const allowed = isOwner(uid, email, guildId, config, guild) || role === 'Líder' || role === 'Admin';

  return allowed ? { uid, email, guildId, role } : null;
}

async function findMembership(db, guildId, gameId) {
  if (!guildId || !gameId) return null;

  for (let slot = 1; slot <= 4; slot += 1) {
    const collectionName = slot === 1 ? 'membros' : `membros${slot}`;
    const collectionRef = db.collection('guildas').doc(guildId).collection(collectionName);

    const directSnap = await collectionRef.doc(gameId).get();
    if (directSnap.exists && directSnap.id !== '__meta__') {
      return { slot, data: directSnap.data() || {} };
    }

    const querySnap = await collectionRef.where('visibleId', '==', gameId).limit(1).get();
    const found = querySnap.docs.find((docSnap) => docSnap.id !== '__meta__');
    if (found) return { slot, data: found.data() || {} };
  }

  return null;
}

function guildNameForSlot(slot, config = {}, guild = {}, profile = {}) {
  const field = slot > 1 ? `name${slot}` : 'name';
  return cleanText(
    config[field] ||
    (slot === 1 ? (config.guildName || config.guilda || guild.name || guild.nome) : '') ||
    profile.guilda ||
    profile.guildName,
    120
  );
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
    const token = bearerToken(req);
    if (!token) return json(res, 401, { ok: false, error: 'auth-required' });

    let decoded;
    try {
      decoded = await app.auth().verifyIdToken(token);
    } catch (_) {
      return json(res, 401, { ok: false, error: 'auth-invalid' });
    }

    const requester = await resolveRequesterAccess(db, decoded);
    if (!requester) return json(res, 403, { ok: false, error: 'forbidden' });

    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    const gameId = cleanGameId(body.id || body.gameId);
    if (!gameId) return json(res, 400, { ok: false, error: 'invalid-id' });

    const profileSnap = await db.collection('users').doc(gameId).get();
    if (!profileSnap.exists) return json(res, 404, { ok: false, error: 'profile-not-found' });

    const profile = profileSnap.data() || {};
    const targetGuildId = cleanText(profile.guildId, 128);
    let config = {};
    let guild = {};
    let membership = null;

    if (targetGuildId) {
      const [configSnap, guildSnap, memberData] = await Promise.all([
        db.collection('configGuilda').doc(targetGuildId).get(),
        db.collection('guildas').doc(targetGuildId).get(),
        findMembership(db, targetGuildId, gameId),
      ]);
      config = configSnap.exists ? (configSnap.data() || {}) : {};
      guild = guildSnap.exists ? (guildSnap.data() || {}) : {};
      membership = memberData;
    }

    const targetUid = cleanText(profile.uid, 128);
    const targetEmail = cleanEmail(profile.email || profile.playerEmail);
    const role = targetGuildId
      ? roleFromGuild(targetUid, targetEmail, targetGuildId, config, guild, profile.role)
      : normalizeRoleLabel(profile.role);
    const guildName = guildNameForSlot(membership?.slot || 1, config, guild, profile);

    return json(res, 200, {
      ok: true,
      profile: {
        id: cleanGameId(profile.id || profile.gameIdMigrated || gameId) || gameId,
        nick: cleanText(profile.nick || profile.nome || profile.name, 40) || 'Jogador',
        bio: cleanText(profile.cat || profile.bio, 100),
        photo: safePhoto(profile.foto || profile.photo || profile.avatar),
        guildName: guildName || 'Sem guilda',
        role: role || 'Membro',
        joinDate: dateValue(
          membership?.data?.joinDate ||
          membership?.data?.dataEntrada ||
          membership?.data?.entryDate ||
          profile.joinDate ||
          profile.dataEntrada
        ),
      },
    });
  } catch (error) {
    console.error('public_profile error:', error);
    return json(res, 500, { ok: false, error: 'internal-error' });
  }
};
