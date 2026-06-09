import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  where
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

export const PLAYER_ALERT_LIMIT = 10;
export const PLAYER_ALERT_CUSTOM_REASON = 'Outro motivo';
export const PLAYER_ALERT_REASONS = [
  'Não vale a pena recrutar',
  'Trapaceiro',
  'Precisa de xit para viver',
  'Só faz ponto na guilda se ganhar premiação',
  'Não tem respeito nenhum',
  'Xinga muito',
  PLAYER_ALERT_CUSTOM_REASON
];

const BLOCKED_REASON_WORDS = [
  'arrombado',
  'buceta',
  'caralho',
  'filho da puta',
  'filha da puta',
  'foda-se',
  'fodase',
  'pau no cu',
  'pornografia',
  'retardado',
  'retardada',
  'vai se foder',
  'vai tomar no cu'
];

export class PlayerAlertError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'PlayerAlertError';
    this.code = code;
  }
}

export function normalizePlayerId(value = '') {
  return String(value || '').replace(/\D+/g, '').slice(0, 20);
}

export function cleanAlertText(value = '', maxLength = 80) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, maxLength);
}

function normalizeComparableText(value = '') {
  return String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[@4]/g, 'a')
    .replace(/[3]/g, 'e')
    .replace(/[1!|]/g, 'i')
    .replace(/[0]/g, 'o')
    .replace(/[5$]/g, 's')
    .replace(/[7]/g, 't')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function containsBlockedReasonWord(value = '') {
  const text = ` ${normalizeComparableText(value)} `;
  return BLOCKED_REASON_WORDS.some((word) => {
    const normalized = normalizeComparableText(word);
    return normalized && text.includes(` ${normalized} `);
  });
}

function containsLink(value = '') {
  const text = String(value || '');
  return /(?:https?:\/\/|www\.|[a-z0-9-]+\.(?:com|net|org|io|gg|dev|app|br)\b)/i.test(text);
}

export function validatePlayerAlertInput({ playerId, targetNick, reason }) {
  const cleanId = normalizePlayerId(playerId);
  const cleanNick = cleanAlertText(targetNick, 30);
  const cleanReason = cleanAlertText(reason, 50);

  if (cleanId.length < 6) {
    throw new PlayerAlertError('invalid-player-id', 'Informe um ID de jogador válido.');
  }
  if (cleanNick.length < 2) {
    throw new PlayerAlertError('invalid-nick', 'Informe o nick usado pelo jogador.');
  }
  if (cleanReason.length < 3 || cleanReason.length > 50) {
    throw new PlayerAlertError('invalid-reason', 'O motivo deve ter entre 3 e 50 caracteres.');
  }
  if (containsLink(cleanReason)) {
    throw new PlayerAlertError('reason-link', 'Não é permitido colocar links no motivo.');
  }
  if (containsBlockedReasonWord(cleanReason)) {
    throw new PlayerAlertError('reason-offensive', 'O motivo contém conteúdo ofensivo não permitido.');
  }

  return {
    playerId: cleanId,
    targetNick: cleanNick,
    reason: cleanReason
  };
}

function cleanEmail(value = '') {
  return String(value || '').trim().toLowerCase();
}

function isNumericId(value = '') {
  return /^\d+$/.test(String(value || ''));
}

async function queryOwnProfiles(db, uid) {
  if (!uid) return [];
  try {
    const snap = await getDocs(query(collection(db, 'users'), where('uid', '==', uid), limit(5)));
    return snap.docs.map((item) => ({ id: item.id, ...(item.data() || {}) }));
  } catch (_) {
    return [];
  }
}

export async function resolveAlertReporter(db, user, fallbackContext = {}) {
  const uid = String(user?.uid || '').trim();
  const email = cleanEmail(user?.email || '');
  if (!uid) throw new PlayerAlertError('login-required', 'Entre na sua conta para registrar um alerta.');

  const candidates = [];
  const authSnap = await getDoc(doc(db, 'users', uid)).catch(() => null);
  if (authSnap?.exists()) candidates.push({ id: authSnap.id, ...(authSnap.data() || {}) });

  const linkedId = normalizePlayerId(
    authSnap?.data()?.gameIdMigrated ||
    authSnap?.data()?.gameId ||
    authSnap?.data()?.id ||
    ''
  );
  if (linkedId) {
    const linkedSnap = await getDoc(doc(db, 'users', linkedId)).catch(() => null);
    if (linkedSnap?.exists()) candidates.push({ id: linkedSnap.id, ...(linkedSnap.data() || {}) });
  }

  (await queryOwnProfiles(db, uid)).forEach((profile) => candidates.push(profile));
  const profile = candidates.find((item) => isNumericId(item.id)) || candidates[0] || {};
  const reporterPlayerId = normalizePlayerId(
    profile.id ||
    profile.gameIdMigrated ||
    profile.gameId ||
    fallbackContext.playerId ||
    ''
  );
  const guildId = String(profile.guildId || fallbackContext.guildId || '').trim();
  let guildName = cleanAlertText(
    fallbackContext.guildName ||
    profile.guilda ||
    profile.guildName ||
    '',
    80
  );

  if (guildId) {
    const guildSnap = await getDoc(doc(db, 'guildas', guildId)).catch(() => null);
    if (guildSnap?.exists()) {
      const guildData = guildSnap.data() || {};
      guildName = cleanAlertText(guildData.name || guildData.nome || guildName, 80);
    }
  }

  return {
    uid,
    email,
    playerId: reporterPlayerId || uid,
    nick: cleanAlertText(profile.nick || profile.nome || profile.name || email.split('@')[0] || 'Usuário', 30),
    guildId,
    guildName: guildName || 'Sem guilda',
    role: cleanAlertText(profile.role || fallbackContext.role || (guildId ? 'Membro' : 'Jogador'), 30)
  };
}

export async function registerPlayerAlert(db, input, reporter, options = {}) {
  const validated = validatePlayerAlertInput(input);
  const reporterUid = String(reporter?.uid || '').trim();
  if (!reporterUid) throw new PlayerAlertError('login-required', 'Entre na sua conta para registrar um alerta.');

  const parentRef = doc(db, 'alertas', validated.playerId);
  const recordRef = doc(db, 'alertas', validated.playerId, 'registros', reporterUid);
  const nowMs = Date.now();

  return runTransaction(db, async (transaction) => {
    const parentSnap = await transaction.get(parentRef);
    const ownRecordSnap = await transaction.get(recordRef);

    if (ownRecordSnap.exists()) {
      throw new PlayerAlertError('already-reported', 'Sua conta já registrou um alerta para este jogador.');
    }

    const currentTotal = parentSnap.exists()
      ? Math.max(0, Number(parentSnap.data()?.total || 0))
      : 0;
    if (currentTotal >= PLAYER_ALERT_LIMIT) {
      throw new PlayerAlertError(
        'limit-reached',
        `Este ID já atingiu o limite máximo de ${PLAYER_ALERT_LIMIT} alertas.`
      );
    }

    const nextTotal = currentTotal + 1;
    const record = {
      playerId: validated.playerId,
      targetNick: validated.targetNick,
      reason: validated.reason,
      reporterUid,
      reporterPlayerId: cleanAlertText(reporter.playerId || reporterUid, 80),
      reporterNick: cleanAlertText(reporter.nick || 'Usuário', 30),
      reporterGuildId: cleanAlertText(reporter.guildId || '', 120),
      reporterGuildName: cleanAlertText(reporter.guildName || 'Sem guilda', 80),
      reporterRole: cleanAlertText(reporter.role || '', 30),
      createdAt: serverTimestamp(),
      createdAtMs: nowMs
    };

    transaction.set(recordRef, record);
    transaction.set(parentRef, {
      playerId: validated.playerId,
      lastNick: validated.targetNick,
      total: nextTotal,
      createdAt: parentSnap.exists() ? (parentSnap.data()?.createdAt || serverTimestamp()) : serverTimestamp(),
      createdAtMs: parentSnap.exists() ? (Number(parentSnap.data()?.createdAtMs || nowMs) || nowMs) : nowMs,
      updatedAt: serverTimestamp(),
      updatedAtMs: nowMs
    }, { merge: true });

    if (typeof options.applyAdditionalWrites === 'function') {
      await options.applyAdditionalWrites(transaction, {
        validated,
        record,
        total: nextTotal,
        nowMs
      });
    }

    return {
      ...validated,
      total: nextTotal,
      record
    };
  });
}

export async function loadPlayerAlerts(db, playerId) {
  const cleanId = normalizePlayerId(playerId);
  if (cleanId.length < 6) {
    throw new PlayerAlertError('invalid-player-id', 'Informe um ID de jogador válido.');
  }

  const parentRef = doc(db, 'alertas', cleanId);
  const parentSnap = await getDoc(parentRef);
  if (!parentSnap.exists()) {
    return {
      playerId: cleanId,
      exists: false,
      total: 0,
      records: []
    };
  }

  const recordsSnap = await getDocs(query(
    collection(parentRef, 'registros'),
    orderBy('createdAtMs', 'desc'),
    limit(PLAYER_ALERT_LIMIT)
  ));
  const records = recordsSnap.docs.map((item) => ({
    id: item.id,
    ...(item.data() || {})
  }));
  const parent = parentSnap.data() || {};

  return {
    playerId: cleanId,
    exists: true,
    lastNick: cleanAlertText(parent.lastNick || records[0]?.targetNick || '', 30),
    total: Math.max(records.length, Number(parent.total || 0)),
    records
  };
}
