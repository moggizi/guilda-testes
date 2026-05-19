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
  const existingDefault = admin.apps.find((app) => app.name === '[DEFAULT]');
  if (existingDefault) return existingDefault;
  return admin.initializeApp({ credential: admin.credential.cert(getServiceAccount()) });
}

function toLabel(mpStatus){
  const s = String(mpStatus || '').toLowerCase();
  if (s === 'approved') return 'aprovado';
  if (s === 'pending' || s === 'in_process') return 'pendente';
  if (s === 'rejected') return 'recusado';
  if (s === 'cancelled' || s === 'expired' || s === 'refunded' || s === 'charged_back') return 'expirado';
  return 'pendente';
}

function parseExternalReference(refStr) {
  const out = { guildId: null, uid: null, plan: null };
  const s = String(refStr || '').trim();
  if (!s) return out;

  // formato esperado: guilda:<gid>|uid:<uid>|plano:<plano>
  const parts = s.split('|');
  for (const p of parts) {
    const [kRaw, ...rest] = p.split(':');
    const k = String(kRaw || '').trim().toLowerCase();
    const v = rest.join(':').trim();
    if (!v) continue;
    if (k === 'guilda' || k === 'guildid' || k === 'guild') out.guildId = v;
    if (k === 'uid' || k === 'user' || k === 'userid') out.uid = v;
    if (k === 'plano' || k === 'plan' || k === 'tier') out.plan = v;
  }
  return out;
}

function getExpiresAtMsForPlan(plan){
  const p = String(plan || '').toLowerCase();

  if (p === 'vitalicio' || p === 'vitalício' || p.includes('vital') || p.includes('life')) {
    return Date.UTC(9999, 11, 31, 23, 59, 59, 999);
  }

  if (p === 'business') return Date.now() + (365 * 24 * 60 * 60 * 1000);
  if (p === 'pro') return Date.now() + (30 * 24 * 60 * 60 * 1000);
  if (p === 'plus') return Date.now() + (30 * 24 * 60 * 60 * 1000);

  return Date.now() + (30 * 24 * 60 * 60 * 1000);
}

function roundMoney(value) {
  return Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100;
}

function normalizePlan(plan) {
  const p = String(plan || '').trim().toLowerCase();
  if (p.includes('vital') || p.includes('life')) return 'vitalicio';
  if (p.includes('business') || p.includes('empresa') || p.includes('anual')) return 'business';
  if (p.includes('pro')) return 'pro';
  if (p.includes('plus')) return 'plus';
  return p;
}

function commissionPercentForPlan(plan) {
  const p = normalizePlan(plan);
  if (p === 'plus' || p === 'pro') return 20;
  if (p === 'business') return 10;
  return null;
}

function commissionForPlan(plan, amount) {
  const p = normalizePlan(plan);
  if (p === 'vitalicio') return 40;

  const percent = commissionPercentForPlan(p);
  if (percent) return roundMoney(Number(amount || 0) * (percent / 100));

  return 0;
}

async function creditPartnerCommissionIfNeeded({ db, uid, guildId, paymentId, plan, amount }) {
  if (!guildId || !paymentId || !plan) return;

  const commission = commissionForPlan(plan, amount);
  if (!Number.isFinite(commission) || commission <= 0) return;

  const guildCfgRef = db.collection('configGuilda').doc(String(guildId));

  await db.runTransaction(async (tx) => {
    const guildSnap = await tx.get(guildCfgRef);
    if (!guildSnap.exists) return;

    const guildCfg = guildSnap.data() || {};
    const partnerId = String(guildCfg.indicadoPorParceiro || guildCfg.parceiroRef || '').trim();
    if (!partnerId) return;

    // Comissão de indicação é única por guilda, mesmo que ela pague de novo depois.
    if (guildCfg.comissaoParceiroUsada === true || guildCfg.comissaoParceiroCreditada === true) return;

    const partnerRef = db.collection('monetize').doc(partnerId);
    const commissionRef = partnerRef.collection('comissoes').doc(String(guildId));
    const indicatedRef = partnerRef.collection('indicados').doc(String(guildId));

    const [partnerSnap, commissionSnap] = await Promise.all([
      tx.get(partnerRef),
      tx.get(commissionRef),
    ]);

    if (!partnerSnap.exists || commissionSnap.exists) return;

    const partner = partnerSnap.data() || {};
    if (partner.parceiro !== true) return;

    const nowMs = Date.now();
    const normalizedPlan = normalizePlan(plan);
    const buyerUid = String(uid || guildCfg.ownerUid || '').trim();
    const buyerGameId = String(guildCfg.referralOwnerGameId || '').trim();

    tx.set(commissionRef, {
      paymentId: String(paymentId),
      guildId: String(guildId),
      compradorUid: buyerUid,
      compradorUserId: buyerGameId,
      plano: normalizedPlan,
      valorPago: roundMoney(amount),
      comissao: commission,
      percentual: commissionPercentForPlan(normalizedPlan),
      tipo: normalizedPlan === 'vitalicio' ? 'fixa' : 'percentual',
      status: 'aprovada',
      regra: 'primeiro_pagamento_da_guilda_indicada',
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      createdAtMs: nowMs,
    }, { merge: true });

    tx.set(indicatedRef, {
      uid: buyerUid,
      gameId: buyerGameId,
      guildId: String(guildId),
      status: 'pagante',
      comissaoCreditada: true,
      primeiroPlanoPago: normalizedPlan,
      primeiroPagamentoId: String(paymentId),
      primeiraComissao: commission,
      atualizadoEmMs: nowMs,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });

    tx.set(guildCfgRef, {
      comissaoParceiroUsada: true,
      comissaoParceiroCreditada: true,
      comissaoParceiroId: partnerId,
      comissaoParceiroPagamentoId: String(paymentId),
      comissaoParceiroPlano: normalizedPlan,
      comissaoParceiroValor: commission,
      comissaoParceiroEmMs: nowMs,
      comissaoParceiroEm: admin.firestore.FieldValue.serverTimestamp(),
      updatedAtMs: nowMs,
    }, { merge: true });

    tx.set(partnerRef, {
      saldoAtual: admin.firestore.FieldValue.increment(commission),
      totalPagantes: admin.firestore.FieldValue.increment(1),
      totalComissaoGerada: admin.firestore.FieldValue.increment(commission),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAtMs: nowMs,
    }, { merge: true });
  });
}

module.exports = async (req, res) => {
  // Mercado Pago pode re-tentar; responder 200 rápido sempre que possível
  try {
    if (req.method !== 'POST') return res.status(405).send('Method not allowed');

    const mpToken = process.env.MP_ACCESS_TOKEN;
    if (!mpToken) return res.status(500).send('MP_ACCESS_TOKEN missing');

    initAdmin();

    // Extrai paymentId de vários formatos comuns
    const body = req.body || {};
    const query = req.query || {};

    let paymentId =
      (body?.data?.id ?? body?.id ?? query?.id ?? query?.data_id ?? '').toString().trim();

    // Alguns webhooks chegam como topic=payment&id=123
    if (!paymentId && query?.topic && query?.id) paymentId = String(query.id);

    if (!paymentId) return res.status(200).send('ok');

    // Busca status real no MP
    const mpResp = await fetch(`https://api.mercadopago.com/v1/payments/${encodeURIComponent(paymentId)}`, {
      method: 'GET',
      headers: { 'Authorization': `Bearer ${mpToken}` }
    });
    const mpData = await mpResp.json().catch(() => ({}));
    if (!mpResp.ok) return res.status(200).send('ok');

    const mpStatus = mpData.status || 'pending';
    const label = toLabel(mpStatus);

    // Contexto vem do MP (fonte da verdade)
    const ref = parseExternalReference(mpData.external_reference);
    const uid = ref.uid ? String(ref.uid) : null;
    const guildId = ref.guildId ? String(ref.guildId) : null;
    const plan = ref.plan ? String(ref.plan) : null;

    // Atualiza solicita por UID (novo padrão). Se não tiver UID no external_reference, cai no padrão antigo.
    const sRef = uid
      ? admin.firestore().doc(`solicita/${uid}`)
      : admin.firestore().doc(`solicita/mp_${paymentId}`);

    await sRef.set({
      paymentId: String(paymentId),
      mpStatus,
      status: label,
      nomePagador: `pagamento > ${label}`,
      plano: plan || undefined,
      guildId: guildId || undefined,
      uid: uid || undefined,
      updatedAtMs: Date.now(),
    }, { merge: true });

    // Se aprovado, aplica VIP
    if (label === 'aprovado' && plan) {
      const expiresAtMs = getExpiresAtMsForPlan(plan);

      if (guildId) {
        await admin.firestore().doc(`configGuilda/${guildId}`).set({
          vipTier: plan,
          vipExpiresAt: expiresAtMs,
          updatedAtMs: Date.now(),
        }, { merge: true });

        // fallback: alguns lugares usam /guildas
        await admin.firestore().doc(`guildas/${guildId}`).set({
          vipTier: plan,
          vipExpiresAt: expiresAtMs,
          updatedAtMs: Date.now(),
        }, { merge: true });
      }

      if (uid) {
        await admin.firestore().doc(`users/${uid}`).set({
          vipTier: plan,
          vipExpiresAt: expiresAtMs,
          updatedAtMs: Date.now(),
        }, { merge: true });
      }

      await creditPartnerCommissionIfNeeded({
        db: admin.firestore(),
        uid,
        guildId,
        paymentId: String(paymentId),
        plan,
        amount: Number(mpData.transaction_amount || mpData.transaction_details?.total_paid_amount || 0),
      });
    }

    return res.status(200).send('ok');
  } catch (_) {
    return res.status(200).send('ok');
  }
};
