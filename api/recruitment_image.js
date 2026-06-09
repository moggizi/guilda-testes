const crypto = require('crypto');
const admin = require('firebase-admin');

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
  if (admin.apps.length) return;
  admin.initializeApp({ credential: admin.credential.cert(getServiceAccount()) });
}

function env(name) {
  const value = String(process.env[name] || '').trim();
  if (!value) throw new Error(`${name} nao configurado.`);
  return value;
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function hmac(key, value, encoding) {
  return crypto.createHmac('sha256', key).update(value).digest(encoding);
}

function amzDateParts(date = new Date()) {
  const iso = date.toISOString().replace(/[:-]|\.\d{3}/g, '');
  return { amzDate: iso, dateStamp: iso.slice(0, 8) };
}

function encodeKey(key) {
  return String(key || '')
    .split('/')
    .map((part) => encodeURIComponent(part))
    .join('/');
}

function publicUrlForKey(key) {
  return `${env('R2_PUBLIC_BASE_URL').replace(/\/+$/, '')}/${encodeKey(key)}`;
}

function keyFromUrl(value = '') {
  const clean = String(value || '').trim();
  if (!clean) return '';
  if (!/^https?:\/\//i.test(clean)) return clean.replace(/^\/+/, '');
  try {
    return decodeURIComponent(new URL(clean).pathname.replace(/^\/+/, ''));
  } catch (_) {
    return '';
  }
}

function sanitizeId(value = '') {
  return String(value || '').trim().replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 120);
}

function extFromContentType(contentType = '') {
  const type = String(contentType || '').toLowerCase();
  if (type.includes('png')) return 'png';
  if (type.includes('webp')) return 'webp';
  return 'jpg';
}

function parseDataUrl(dataUrl = '') {
  const match = String(dataUrl || '').match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,([\s\S]+)$/);
  if (!match) throw new Error('Imagem invalida.');
  const contentType = match[1].toLowerCase();
  if (!['image/jpeg', 'image/jpg', 'image/png', 'image/webp'].includes(contentType)) {
    throw new Error('Formato de imagem nao permitido.');
  }
  const body = Buffer.from(match[2], 'base64');
  if (!body.length) throw new Error('Imagem vazia.');
  if (body.length > 4 * 1024 * 1024) throw new Error('Imagem muito grande.');
  return { body, contentType };
}

function r2Config() {
  return {
    endpoint: env('R2_ENDPOINT').replace(/\/+$/, ''),
    bucket: env('R2_BUCKET_NAME'),
    accessKeyId: env('R2_ACCESS_KEY_ID'),
    secretAccessKey: env('R2_SECRET_ACCESS_KEY'),
    region: 'auto'
  };
}

async function signedR2Request(method, key, body = Buffer.alloc(0), contentType = '') {
  const cfg = r2Config();
  const endpoint = new URL(cfg.endpoint);
  const encodedKey = encodeKey(key);
  const canonicalUri = `/${encodeURIComponent(cfg.bucket)}/${encodedKey}`;
  const url = `${cfg.endpoint}/${encodeURIComponent(cfg.bucket)}/${encodedKey}`;
  const { amzDate, dateStamp } = amzDateParts();
  const payloadHash = sha256(body);
  const headers = {
    host: endpoint.host,
    'x-amz-content-sha256': payloadHash,
    'x-amz-date': amzDate
  };
  if (contentType) headers['content-type'] = contentType;
  const signedHeaders = Object.keys(headers).sort().join(';');
  const canonicalHeaders = Object.keys(headers).sort().map((name) => `${name}:${headers[name]}\n`).join('');
  const canonicalRequest = [
    method,
    canonicalUri,
    '',
    canonicalHeaders,
    signedHeaders,
    payloadHash
  ].join('\n');
  const credentialScope = `${dateStamp}/${cfg.region}/s3/aws4_request`;
  const stringToSign = [
    'AWS4-HMAC-SHA256',
    amzDate,
    credentialScope,
    sha256(canonicalRequest)
  ].join('\n');
  const kDate = hmac(`AWS4${cfg.secretAccessKey}`, dateStamp);
  const kRegion = hmac(kDate, cfg.region);
  const kService = hmac(kRegion, 's3');
  const kSigning = hmac(kService, 'aws4_request');
  const signature = hmac(kSigning, stringToSign, 'hex');
  const authorization = `AWS4-HMAC-SHA256 Credential=${cfg.accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
  const resp = await fetch(url, {
    method,
    headers: {
      ...headers,
      authorization
    },
    body: method === 'PUT' ? body : undefined
  });
  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    throw new Error(text || `R2 retornou erro ${resp.status}.`);
  }
}

async function verifyToken(req) {
  const header = String(req.headers.authorization || req.headers.Authorization || '');
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  if (!token) throw new Error('Login ausente.');
  initAdmin();
  return admin.auth().verifyIdToken(token);
}

function emailInList(email, value) {
  const clean = String(email || '').toLowerCase().trim();
  if (!clean || !Array.isArray(value)) return false;
  return value.map((item) => String(item || '').toLowerCase().trim()).includes(clean);
}

async function canManageGuild(decoded, guildId) {
  if (!decoded || !guildId) return false;
  const email = String(decoded.email || '').toLowerCase().trim();
  if (String(decoded.uid || '') === guildId) return true;
  const db = admin.firestore();
  const securitySnap = await db.collection('chefe').doc('security').get().catch(() => null);
  const security = securitySnap?.exists ? (securitySnap.data() || {}) : {};
  if (emailInList(email, security.ceo)) return true;
  const [cfgSnap, guildSnap] = await Promise.all([
    db.collection('configGuilda').doc(guildId).get().catch(() => null),
    db.collection('guildas').doc(guildId).get().catch(() => null)
  ]);
  const cfg = cfgSnap?.exists ? (cfgSnap.data() || {}) : {};
  const guild = guildSnap?.exists ? (guildSnap.data() || {}) : {};
  if (String(cfg.ownerUid || guild.ownerUid || '') === String(decoded.uid || '')) return true;
  if (String(cfg.ownerEmail || guild.ownerEmail || '').toLowerCase().trim() === email) return true;
  return emailInList(email, cfg.admins) || emailInList(email, cfg.leaders);
}

async function canManageProfile(decoded, profileId) {
  if (!decoded || !profileId) return false;
  const uid = String(decoded.uid || '').trim();
  const email = String(decoded.email || '').toLowerCase().trim();
  if (!uid) return false;
  if (uid === profileId) return true;

  const db = admin.firestore();
  const [profileSnap, authProfileSnap] = await Promise.all([
    db.collection('users').doc(profileId).get().catch(() => null),
    db.collection('users').doc(uid).get().catch(() => null)
  ]);
  const profile = profileSnap?.exists ? (profileSnap.data() || {}) : {};
  const authProfile = authProfileSnap?.exists ? (authProfileSnap.data() || {}) : {};

  if (String(profile.uid || '').trim() === uid) return true;
  if (email && [
    profile.email,
    profile.playerEmail
  ].some((value) => String(value || '').toLowerCase().trim() === email)) return true;

  const linkedProfileId = sanitizeId(
    authProfile.gameIdMigrated ||
    authProfile.gameId ||
    authProfile.id ||
    ''
  );
  return linkedProfileId === profileId;
}

async function deleteKeyWithPrefix(key, prefix) {
  const cleanKey = String(key || '').replace(/^\/+/, '');
  if (!cleanKey) return;
  if (!cleanKey.startsWith(prefix)) return;
  await signedR2Request('DELETE', cleanKey);
}

async function handleProfileImage(req, res, decoded, body, action) {
  const profileId = sanitizeId(body.profileId || body.userId);
  if (!profileId) return res.status(400).json({ ok: false, error: 'profileId ausente.' });
  if (!(await canManageProfile(decoded, profileId))) {
    return res.status(403).json({ ok: false, error: 'Sem permissao para este perfil.' });
  }

  const prefix = `perfil/${profileId}/`;

  if (action === 'delete') {
    const key = keyFromUrl(body.key || body.url || body.oldUrl || '');
    await deleteKeyWithPrefix(key, prefix);
    return res.status(200).json({ ok: true });
  }

  if (action === 'upload') {
    const { body: imageBody, contentType } = parseDataUrl(body.dataUrl || '');
    const key = `${prefix}${Date.now()}-${crypto.randomBytes(6).toString('hex')}.${extFromContentType(contentType)}`;
    await signedR2Request('PUT', key, imageBody, contentType);
    return res.status(200).json({
      ok: true,
      key,
      url: publicUrlForKey(key),
      bytes: imageBody.length,
      contentType
    });
  }

  return res.status(400).json({ ok: false, error: 'Acao invalida.' });
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'Method not allowed' });

  try {
    const decoded = await verifyToken(req);
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const action = String(body.action || '').toLowerCase().trim();
    const scope = String(body.scope || 'recruitment').toLowerCase().trim();

    if (scope === 'profile') {
      return await handleProfileImage(req, res, decoded, body, action);
    }

    const guildId = sanitizeId(body.guildId);
    if (!guildId) return res.status(400).json({ ok: false, error: 'guildId ausente.' });
    if (!(await canManageGuild(decoded, guildId))) {
      return res.status(403).json({ ok: false, error: 'Sem permissao para esta guilda.' });
    }

    if (action === 'delete') {
      const key = body.key || keyFromUrl(body.url || body.oldUrl || '');
      await deleteKeyWithPrefix(key, `recrutamento/${guildId}/`);
      return res.status(200).json({ ok: true });
    }

    if (action === 'upload') {
      const { body: imageBody, contentType } = parseDataUrl(body.dataUrl || '');
      const key = `recrutamento/${guildId}/${Date.now()}-${crypto.randomBytes(6).toString('hex')}.${extFromContentType(contentType)}`;
      await signedR2Request('PUT', key, imageBody, contentType);
      const oldKey = keyFromUrl(body.oldKey || body.oldUrl || '');
      await deleteKeyWithPrefix(oldKey, `recrutamento/${guildId}/`);
      return res.status(200).json({
        ok: true,
        key,
        url: publicUrlForKey(key),
        bytes: imageBody.length,
        contentType
      });
    }

    return res.status(400).json({ ok: false, error: 'Acao invalida.' });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ ok: false, error: err?.message || 'Erro ao processar imagem.' });
  }
};
