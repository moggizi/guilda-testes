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
  if (admin.apps.length) return;
  admin.initializeApp({ credential: admin.credential.cert(getServiceAccount()) });
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

function normalizePlan(plan) {
  return planUtils.normalizePlan(plan);
}

function getExpiresAtMsForPlan(plan, planConfig = null){
  const p = normalizePlan(plan);
  if (p === 'parceiro') return null;
  const customDays = Number(planConfig?.durationDays || 0);
  if (Number.isFinite(customDays) && customDays > 0) return Date.now() + (Math.floor(customDays) * 24 * 60 * 60 * 1000);
  if (p === 'business') return Date.now() + (365 * 24 * 60 * 60 * 1000);
  if (p === 'ultra') return Date.now() + (30 * 24 * 60 * 60 * 1000);
  return Date.now() + (30 * 24 * 60 * 60 * 1000);
}

module.exports = async (req, res) => {
  try {
    if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

    const mpToken = process.env.MP_ACCESS_TOKEN;
    if (!mpToken) return res.status(500).json({ error: 'MP_ACCESS_TOKEN não configurado.' });

    const paymentId = (req.query?.paymentId || '').toString().trim();
    if (!paymentId) return res.status(400).json({ error: 'paymentId ausente.' });

    initAdmin();

    const mpResp = await fetch(`https://api.mercadopago.com/v1/payments/${encodeURIComponent(paymentId)}`, {
      method: 'GET',
      headers: { 'Authorization': `Bearer ${mpToken}` }
    });
    const mpData = await mpResp.json().catch(() => ({}));
    if (!mpResp.ok) return res.status(400).json({ error: mpData?.message || 'Erro ao consultar pagamento.' });

    const status = mpData.status || 'pending';
    const label = toLabel(status);

    // Atualiza solicita (redundância útil em teste mesmo sem webhook)
    const ref = parseExternalReference(mpData.external_reference);
    const metadata = mpData.metadata || {};
    const normalizedPlanForRecord = normalizePlan(ref.plan || metadata.plano || '');
    const amount = planUtils.roundMoney(Number(mpData.transaction_amount || mpData.transaction_details?.total_paid_amount || 0));
    const transactionFee = planUtils.roundMoney(Number(metadata.transaction_fee || metadata.taxa_transacao || 0.99));
    const docPath = ref.uid ? `solicita/${ref.uid}` : `solicita/mp_${paymentId}`;
    await admin.firestore().doc(docPath).set({
      paymentId,
      mpStatus: status,
      status: label,
      nomePagador: `pagamento > ${label}`,
      plano: normalizedPlanForRecord || undefined,
      amount,
      transactionFee,
      pagamentoAtual: {
        paymentId,
        mpStatus: status,
        status: label,
        plano: normalizedPlanForRecord || undefined,
        amount,
        transactionFee,
        updatedAtMs: Date.now(),
      },
      pagamentos: {
        [paymentId]: {
          paymentId,
          mpStatus: status,
          status: label,
          plano: normalizedPlanForRecord || undefined,
          amount,
          transactionFee,
          updatedAtMs: Date.now(),
        },
      },
      updatedAtMs: Date.now(),
    }, { merge: true });

    if (label === 'aprovado' && ref.guildId && ref.plan) {
      const plan = normalizePlan(ref.plan);
      let planConfig = null;
      try { planConfig = await planUtils.loadPlan(admin.firestore(), plan); } catch (_) {}
      const expiresAtMs = getExpiresAtMsForPlan(plan, planConfig);
      const permissoesAtivas = plan !== 'free';

      await admin.firestore().doc(`configGuilda/${ref.guildId}`).set({
        vipTier: plan,
        vipExpiresAt: expiresAtMs,
        permissoesAtivas,
        updatedAtMs: Date.now(),
      }, { merge: true });

      await admin.firestore().doc(`guildas/${ref.guildId}`).set({
        vipTier: plan,
        vipExpiresAt: expiresAtMs,
        permissoesAtivas,
        updatedAtMs: Date.now(),
      }, { merge: true });

      if (ref.uid) {
        await admin.firestore().doc(`users/${ref.uid}`).set({
          vipTier: plan,
          vipExpiresAt: expiresAtMs,
          updatedAtMs: Date.now(),
        }, { merge: true });
      }
    }

    return res.status(200).json({ paymentId, status, label });

  } catch (e) {
    return res.status(500).json({ error: e?.message || 'Erro interno.' });
  }
};
