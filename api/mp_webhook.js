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

function getExpiresAtMsForPlan(plan, planConfig = null){
  const p = String(plan || '').toLowerCase();

  if (p === 'parceiro' || p === 'vitalicio' || p === 'vitalício' || p.includes('vital') || p.includes('life')) return null;

  const customDays = Number(planConfig?.durationDays || 0);
  if (Number.isFinite(customDays) && customDays > 0) {
    return Date.now() + (Math.floor(customDays) * 24 * 60 * 60 * 1000);
  }

  if (p === 'business') return Date.now() + (365 * 24 * 60 * 60 * 1000);
  if (p === 'ultra') return Date.now() + (30 * 24 * 60 * 60 * 1000);
  if (p === 'pro') return Date.now() + (30 * 24 * 60 * 60 * 1000);
  if (p === 'plus') return Date.now() + (30 * 24 * 60 * 60 * 1000);

  return Date.now() + (30 * 24 * 60 * 60 * 1000);
}

function roundMoney(value) {
  return Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100;
}

function normalizePlan(plan) {
  return planUtils.normalizePlan(plan);
}

function commissionPercentForPlan(plan, planConfig = null) {
  const p = normalizePlan(plan);
  const raw = planConfig?.raw || {};
  const hasConfigured = Object.prototype.hasOwnProperty.call(raw, 'affiliatePercent')
    || Object.prototype.hasOwnProperty.call(raw, 'afiliadoPercent')
    || Object.prototype.hasOwnProperty.call(raw, 'commissionPercent')
    || Object.prototype.hasOwnProperty.call(raw, 'comissaoPercentual');
  if (hasConfigured) {
    const configured = Number(raw.affiliatePercent ?? raw.afiliadoPercent ?? raw.commissionPercent ?? raw.comissaoPercentual ?? 0);
    return Number.isFinite(configured) ? Math.max(0, configured) : 0;
  }
  if (p === 'plus' || p === 'pro' || p === 'ultra') return 20;
  if (p === 'business') return 10;
  return null;
}

function commissionForPlan(plan, amount, planConfig = null) {
  const p = normalizePlan(plan);
  if (p === 'parceiro') return 0;

  const percent = commissionPercentForPlan(p, planConfig);
  if (percent) return planUtils.roundMoney(Number(amount || 0) * (percent / 100));

  return 0;
}

async function creditPartnerCommissionIfNeeded({ db, uid, guildId, paymentId, plan, amount, planConfig = null }) {
  if (!guildId || !paymentId || !plan) return null;

  const commission = commissionForPlan(plan, amount, planConfig);
  if (!Number.isFinite(commission) || commission <= 0) return null;

  const guildCfgRef = db.collection('configGuilda').doc(String(guildId));
  let credited = null;

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
    const percent = commissionPercentForPlan(normalizedPlan, planConfig);

    tx.set(commissionRef, {
      paymentId: String(paymentId),
      guildId: String(guildId),
      compradorUid: buyerUid,
      compradorUserId: buyerGameId,
      plano: normalizedPlan,
      valorPago: roundMoney(amount),
      comissao: commission,
      percentual: percent,
      tipo: 'percentual',
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

    credited = {
      partnerId,
      commission,
      percentual: percent,
      tipo: 'percentual',
    };
  });

  return credited;
}

async function updateSolicitaPayment({ db, sRef, paymentId, mpStatus, label, plan, guildId, uid, amount, transactionFee, affiliateCredit = null, countApproved = true }) {
  const nowMs = Date.now();
  const paymentKey = String(paymentId || '');
  const affiliateFee = roundMoney(affiliateCredit?.commission || 0);
  const netAmount = roundMoney(Number(amount || 0) - Number(transactionFee || 0) - affiliateFee);

  await db.runTransaction(async (tx) => {
    const snap = await tx.get(sRef);
    const current = snap.exists ? (snap.data() || {}) : {};
    const currentPayment = (current.pagamentos && current.pagamentos[paymentKey]) || {};
    const alreadyCounted = currentPayment.approvedCounted === true;
    const shouldCountApproved = countApproved && label === 'aprovado' && !alreadyCounted;

    const paymentLine = {
      ...currentPayment,
      paymentId: paymentKey,
      mpStatus,
      status: label,
      plano: plan || currentPayment.plano || undefined,
      amount: roundMoney(amount),
      transactionFee,
      affiliateFee,
      affiliatePartnerId: affiliateCredit?.partnerId || currentPayment.affiliatePartnerId || null,
      affiliateCommissionApplied: affiliateFee > 0,
      affiliatePercent: affiliateCredit?.percentual || currentPayment.affiliatePercent || null,
      netAmount,
      approvedCounted: alreadyCounted || shouldCountApproved,
      updatedAtMs: nowMs,
      ...(shouldCountApproved ? { approvedAtMs: nowMs } : {}),
    };

    const patch = {
      paymentId: paymentKey,
      mpStatus,
      status: label,
      nomePagador: `pagamento > ${label}`,
      plano: plan || undefined,
      guildId: guildId || undefined,
      uid: uid || undefined,
      amount: roundMoney(amount),
      transactionFee,
      affiliateFee,
      affiliatePartnerId: affiliateCredit?.partnerId || null,
      affiliateCommissionApplied: affiliateFee > 0,
      affiliatePercent: affiliateCredit?.percentual || null,
      netAmount,
      pagamentoAtual: paymentLine,
      pagamentos: { [paymentKey]: paymentLine },
      updatedAtMs: nowMs,
    };

    if (shouldCountApproved) {
      patch.totalPagamentosAprovados = admin.firestore.FieldValue.increment(1);
      patch.totalPagoAprovado = admin.firestore.FieldValue.increment(roundMoney(amount));
      patch.totalTaxaTransacao = admin.firestore.FieldValue.increment(roundMoney(transactionFee));
      patch.totalTaxaAfiliado = admin.firestore.FieldValue.increment(affiliateFee);
      patch.totalLucroEstimado = admin.firestore.FieldValue.increment(netAmount);
      patch.lastApprovedAt = admin.firestore.FieldValue.serverTimestamp();
      patch.lastApprovedAtMs = nowMs;
    }

    tx.set(sRef, patch, { merge: true });
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
    const metadata = mpData.metadata || {};
    const plan = ref.plan ? String(ref.plan) : (metadata.plano ? String(metadata.plano) : null);
    const normalizedPlanForRecord = plan ? normalizePlan(plan) : null;
    let planConfig = null;
    try {
      if (normalizedPlanForRecord) planConfig = await planUtils.loadPlan(admin.firestore(), normalizedPlanForRecord);
    } catch (_) {}
    const amount = roundMoney(Number(mpData.transaction_amount || mpData.transaction_details?.total_paid_amount || 0));
    const transactionFee = roundMoney(Number(metadata.transaction_fee || metadata.taxa_transacao || 0.99));

    // Atualiza solicita por UID (novo padrão). Se não tiver UID no external_reference, cai no padrão antigo.
    const sRef = uid
      ? admin.firestore().doc(`solicita/${uid}`)
      : admin.firestore().doc(`solicita/mp_${paymentId}`);

    await updateSolicitaPayment({
      db: admin.firestore(),
      sRef,
      paymentId: String(paymentId),
      mpStatus,
      label,
      plan: normalizedPlanForRecord,
      guildId,
      uid,
      amount,
      transactionFee,
      countApproved: false,
    });

    // Se aprovado, aplica VIP
    if (label === 'aprovado' && plan) {
      const normalizedPlan = normalizePlan(plan);
      const expiresAtMs = getExpiresAtMsForPlan(normalizedPlan, planConfig);
      const permissoesAtivas = normalizedPlan !== 'free';

      if (guildId) {
        await admin.firestore().doc(`configGuilda/${guildId}`).set({
          vipTier: normalizedPlan,
          vipExpiresAt: expiresAtMs,
          permissoesAtivas,
          updatedAtMs: Date.now(),
        }, { merge: true });

        // fallback: alguns lugares usam /guildas
        await admin.firestore().doc(`guildas/${guildId}`).set({
          vipTier: normalizedPlan,
          vipExpiresAt: expiresAtMs,
          permissoesAtivas,
          updatedAtMs: Date.now(),
        }, { merge: true });
      }

      if (uid) {
        await admin.firestore().doc(`users/${uid}`).set({
          vipTier: normalizedPlan,
          vipExpiresAt: expiresAtMs,
          updatedAtMs: Date.now(),
        }, { merge: true });
      }

      const affiliateCredit = await creditPartnerCommissionIfNeeded({
        db: admin.firestore(),
        uid,
        guildId,
        paymentId: String(paymentId),
        plan,
        amount,
        planConfig,
      });

      await updateSolicitaPayment({
        db: admin.firestore(),
        sRef,
        paymentId: String(paymentId),
        mpStatus,
        label,
        plan: normalizedPlan,
        guildId,
        uid,
        amount,
        transactionFee,
        affiliateCredit,
      });
    }

    return res.status(200).send('ok');
  } catch (_) {
    return res.status(200).send('ok');
  }
};
