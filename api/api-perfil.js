import admin from "firebase-admin";

const APP_NAME = "hub-perfis-admin";

function getHubPerfisDb() {
  const serviceAccountRaw = process.env.FIREBASE_SERVICE_ACCOUNT_PERFIS;
  if (!serviceAccountRaw) {
    throw new Error("FIREBASE_SERVICE_ACCOUNT_PERFIS não configurado.");
  }

  const existing = admin.apps.find((app) => app?.name === APP_NAME);
  const app = existing || admin.initializeApp({
    credential: admin.credential.cert(JSON.parse(serviceAccountRaw)),
    projectId: "hub-perfis"
  }, APP_NAME);

  return app.firestore();
}

function normalizeString(...values) {
  for (const value of values) {
    const s = (value ?? "").toString().trim();
    if (s) return s;
  }
  return "";
}

function toNumber(...values) {
  for (const value of values) {
    if (value == null || value === "") continue;
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return 0;
}

function normalizeMember(raw) {
  const playerId = normalizeString(
    raw?.playerId,
    raw?.visibleId,
    raw?.idJogador,
    raw?.playerID,
    raw?.uid,
    raw?.id,
    raw?.userId,
    raw?.gameId,
    raw?.jogadorId
  );
  if (!playerId) return null;

  const nick = normalizeString(raw?.nick, raw?.nickname, raw?.nome, raw?.name, `Jogador ${playerId}`);
  const weeklyHonor = toNumber(
    raw?.weeklyHonor,
    raw?.weeklyMetaValue,
    raw?.pontosSemanais,
    raw?.pontosHonra,
    raw?.pontosDeHonra,
    raw?.honra,
    raw?.honor,
    raw?.weeklyHonorPoints,
    raw?.honorPoints,
    raw?.points
  );
  const guildWar = toNumber(
    raw?.guildWar,
    raw?.guildWarMeta,
    raw?.pontosGuerra,
    raw?.guerraGuilda,
    raw?.pontosGuerraGuilda,
    raw?.guildWarPoints,
    raw?.warPoints,
    raw?.guerra,
    raw?.gg
  );

  return { playerId, nick, weeklyHonor, guildWar };
}

function normalizeMembersArray(list) {
  const map = new Map();
  for (const raw of Array.isArray(list) ? list : []) {
    const item = normalizeMember(raw);
    if (!item) continue;
    map.set(item.playerId, item);
  }
  return Array.from(map.values());
}

function getTop3(list, field) {
  return [...(list || [])]
    .sort((a, b) => Number(b?.[field] || 0) - Number(a?.[field] || 0))
    .slice(0, 3)
    .map((item) => ({
      playerId: item.playerId,
      nick: item.nick,
      pontos: Number(item?.[field] || 0)
    }));
}

const WEEK_UPDATE_COOLDOWN_MS = 4 * 24 * 60 * 60 * 1000;
const PROFILE_EXPIRES_MS = 4 * 24 * 60 * 60 * 1000;

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Método não permitido." });
  }

  try {
    const db = getHubPerfisDb();
    const { action } = req.body || {};

    if (action === "resolveKey") {
      const key = normalizeString(req.body?.key);
      if (!key) return res.status(400).json({ error: "Chave inválida." });

      const snap = await db.collection("chave").doc(key).get();
      if (!snap.exists) return res.status(404).json({ error: "Chave da guilda não encontrada." });

      const uid = normalizeString(snap.data()?.uid);
      if (!uid) return res.status(404).json({ error: "UID da guilda não encontrado para essa chave." });

      return res.status(200).json({ uid });
    }

    if (action === "loadProfile") {
      const uid = normalizeString(req.body?.uid);
      if (!uid) return res.status(400).json({ error: "UID inválido." });

      const profileSnap = await db.collection("perfil").doc(uid).get();
      if (!profileSnap.exists) return res.status(404).json({ error: "Perfil da guilda não encontrado." });

      let members = [];
      try {
        const membersSnap = await db.collection("perfil").doc(uid).collection("membros").get();
        members = membersSnap.docs.map((d) => ({ id: d.id, ...(d.data() || {}) }));
      } catch (_) {}

      let previousWeek = {};
      try {
        const prevSnap = await db.collection("perfil").doc(uid).collection("semanaPassada").doc("resumo").get();
        previousWeek = prevSnap.exists ? (prevSnap.data() || {}) : {};
      } catch (_) {}

      return res.status(200).json({
        profile: profileSnap.data() || {},
        members,
        previousWeek
      });
    }

    if (action === "updateWeek") {
      const uid = normalizeString(req.body?.uid);
      if (!uid) return res.status(400).json({ error: "UID inválido." });

      const guildInfo = req.body?.guildInfo || {};
      const members = normalizeMembersArray(req.body?.members || []);

      const profileRef = db.collection("perfil").doc(uid);
      const profileSnap = await profileRef.get();
      if (!profileSnap.exists) {
        return res.status(404).json({ error: "Perfil da guilda não encontrado para atualizar." });
      }

      const profileData = profileSnap.data() || {};
      const now = Date.now();

      const oldTopHonra = Array.isArray(profileData.topHonraSemanaAtual) ? profileData.topHonraSemanaAtual : [];
      const oldTopGuerra = Array.isArray(profileData.topGuerraSemanaAtual) ? profileData.topGuerraSemanaAtual : [];

      const currentTopHonra = getTop3(members, "weeklyHonor");
      const currentTopGuerra = getTop3(members, "guildWar");

      const membersSnap = await profileRef.collection("membros").get();
      const existingMap = new Map(membersSnap.docs.map((d) => [d.id, d.data() || {}]));
      const currentIds = new Set();

      const batch = db.batch();

      for (const member of members) {
        currentIds.add(member.playerId);

        const prev = existingMap.get(member.playerId) || {};
        const totalHonra = Number(prev.totalHonra || 0) + Number(member.weeklyHonor || 0);
        const totalGuerra = Number(prev.totalGuerra || 0) + Number(member.guildWar || 0);

        batch.set(profileRef.collection("membros").doc(member.playerId), {
          playerId: member.playerId,
          nick: member.nick,
          honraSemanaAtual: Number(member.weeklyHonor || 0),
          guerraSemanaAtual: Number(member.guildWar || 0),
          totalHonra,
          totalGuerra,
          updatedAtMs: now
        }, { merge: true });
      }

      for (const [docId] of existingMap) {
        if (!currentIds.has(docId)) {
          batch.delete(profileRef.collection("membros").doc(docId));
        }
      }

      batch.set(profileRef.collection("semanaPassada").doc("resumo"), {
        topHonra: oldTopHonra,
        topGuerra: oldTopGuerra,
        updatedAtMs: now
      }, { merge: true });

      batch.set(profileRef, {
        nomeGuilda: normalizeString(guildInfo?.name, profileData?.nomeGuilda),
        dataCriacao: guildInfo?.createdAtMs ?? profileData?.dataCriacao ?? null,
        tag: normalizeString(guildInfo?.tag, profileData?.tag),
        topHonraSemanaAtual: currentTopHonra,
        topGuerraSemanaAtual: currentTopGuerra,
        updatedAtMs: now,
        lastWeekUpdateAtMs: now,
        nextWeekUpdateAtMs: now + WEEK_UPDATE_COOLDOWN_MS,
        expiresAtMs: now + PROFILE_EXPIRES_MS
      }, { merge: true });

      await batch.commit();
      return res.status(200).json({ success: true, updatedCount: members.length });
    }

    return res.status(400).json({ error: "Ação inválida." });
  } catch (error) {
    console.error("[api-perfil]", error);
    return res.status(500).json({ error: error?.message || "Erro interno ao processar o perfil." });
  }
}
