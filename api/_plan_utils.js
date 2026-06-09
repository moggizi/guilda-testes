const PLAN_ALIASES = {
  "+": "plus",
  basic: "plus",
  mensal: "plus",
  plus: "plus",
  pro: "pro",
  premium: "pro",
  ultra: "ultra",
  business: "business",
  bussines: "business",
  bussiness: "business",
  empresa: "business",
  anual: "business",
  yearly: "business",
  year: "business",
  ano: "business",
  parceiro: "parceiro",
  partner: "parceiro",
  afiliado: "parceiro",
  vitalicio: "parceiro",
  "vitalício": "parceiro",
  lifetime: "parceiro",
  life: "parceiro",
  permanente: "parceiro",
};

const BASE_PLAN_IDS = ["free", "plus", "pro", "business", "ultra", "parceiro"];

const DEFAULT_PLANS = {
  free: {
    id: "free",
    name: "FREE",
    price: 0,
    period: "monthly",
    durationDays: null,
    order: 0,
    active: true,
    visible: true,
    purchasable: false,
    access: ["Dashboard", "Membros", "Configuracao de tag"],
    noAccess: ["Administradores + Lideres", "Lines", "Estatisticas", "Recrutamento (BETA)", "Multi-guilda (BETA)", "Atualizar pontos por print", "Eventos/Camp"],
  },
  plus: {
    id: "plus",
    name: "PLUS",
    price: 6.99,
    period: "monthly",
    durationDays: 30,
    order: 10,
    active: true,
    visible: true,
    purchasable: true,
    access: ["Dashboard", "Membros", "Configuracao de tag", "Administradores + Lideres", "Lines", "Estatisticas"],
    noAccess: ["Recrutamento (BETA)", "Multi-guilda (BETA)", "Atualizar pontos por print", "Eventos/Camp"],
  },
  pro: {
    id: "pro",
    name: "PRO",
    price: 9.99,
    period: "monthly",
    durationDays: 30,
    order: 20,
    active: true,
    visible: true,
    purchasable: true,
    popular: true,
    badge: "Popular",
    access: ["Dashboard", "Membros", "Configuracao de tag", "Administradores + Lideres", "Lines", "Estatisticas", "Recrutamento (BETA)", "Multi-guilda (BETA)", "Atualizar pontos por print", "Eventos/Camp"],
    noAccess: [],
  },
  business: {
    id: "business",
    aliases: ["bussines"],
    name: "BUSINESS",
    price: 99.9,
    period: "yearly",
    durationDays: 365,
    order: 30,
    active: true,
    visible: true,
    purchasable: true,
    access: ["Dashboard", "Membros", "Configuracao de tag", "Administradores + Lideres", "Lines", "Estatisticas", "Recrutamento (BETA)", "Multi-guilda (BETA)", "Atualizar pontos por print", "Eventos/Camp"],
    noAccess: [],
    note: "Mesmo acesso do PRO em cobranca anual.",
  },
  ultra: {
    id: "ultra",
    name: "ULTRA",
    price: 14.99,
    period: "monthly",
    durationDays: 30,
    order: 40,
    active: true,
    visible: true,
    purchasable: true,
    access: ["Tudo do PRO", "Prioridade em novos recursos", "Limites ampliados"],
    noAccess: [],
    badge: "Mais completo",
  },
  parceiro: {
    id: "parceiro",
    aliases: ["vitalicio"],
    name: "PARCEIRO",
    price: 0,
    period: "partner",
    durationDays: null,
    order: 50,
    active: true,
    visible: true,
    purchasable: false,
    access: ["Quase todas as funcoes VIP enquanto a parceria estiver ativa"],
    noAccess: ["Comissao por esse beneficio"],
    note: "Beneficio manual para quem divulga o site. Pode ser removido se a parceria parar ou nao trouxer resultado.",
  },
};

function compactId(value) {
  return String(value || "")
    .toLowerCase()
    .trim()
    .replace(/^plano[_-]?/g, "")
    .replace(/^vip[_-]?/g, "")
    .replace(/^plan[_-]?/g, "")
    .replace(/\s+/g, "")
    .replace(/[_-]?mensal$/g, "")
    .replace(/[_-]?monthly$/g, "")
    .replace(/[_-]?anual$/g, "")
    .replace(/[_-]?yearly$/g, "")
    .replace(/[_-]?ano$/g, "");
}

function normalizePlan(input) {
  const raw = compactId(input);
  return PLAN_ALIASES[raw] || raw || "free";
}

function isBasePlanId(id) {
  return BASE_PLAN_IDS.includes(normalizePlan(id));
}

function candidateDocIds(planId) {
  const normalized = normalizePlan(planId);
  const out = new Set([normalized]);
  const def = DEFAULT_PLANS[normalized];
  (def?.aliases || []).forEach((id) => out.add(id));
  const raw = compactId(planId);
  if (raw) out.add(raw);
  return Array.from(out).filter(Boolean);
}

function toMoney(value, fallback = 0) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const clean = String(value ?? "")
    .replace(/[^0-9,.-]/g, "")
    .replace(/\.(?=\d{3}(\D|$))/g, "")
    .replace(",", ".");
  const parsed = Number(clean);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function roundMoney(value) {
  return Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100;
}

function firstDefined(data, fields, fallback) {
  for (const field of fields) {
    if (Object.prototype.hasOwnProperty.call(data || {}, field) && data[field] !== undefined) return data[field];
  }
  return fallback;
}

function boolFrom(data, fields, fallback) {
  const value = firstDefined(data, fields, undefined);
  if (value === undefined || value === null || value === "") return fallback;
  if (typeof value === "boolean") return value;
  const s = String(value).toLowerCase().trim();
  if (["1", "true", "sim", "yes", "ativo", "enabled"].includes(s)) return true;
  if (["0", "false", "nao", "não", "no", "inativo", "disabled"].includes(s)) return false;
  return fallback;
}

function listFrom(data, fields, fallback = []) {
  const value = firstDefined(data, fields, undefined);
  if (Array.isArray(value)) return value.map((x) => String(x || "").trim()).filter(Boolean);
  if (typeof value === "string") {
    return value
      .split(/\r?\n|;/g)
      .map((x) => x.trim())
      .filter(Boolean);
  }
  return Array.isArray(fallback) ? fallback : [];
}

function numberFrom(data, fields, fallback = 0) {
  const value = firstDefined(data, fields, undefined);
  if (value === undefined || value === null || value === "") return fallback;
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function stringFrom(data, fields, fallback = "") {
  const value = firstDefined(data, fields, undefined);
  if (value === undefined || value === null) return fallback;
  return String(value);
}

function formatPriceLabel(price, period) {
  if (!price) return "R$0";
  const value = Number(price).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  if (period === "yearly") return `${value} / ano`;
  if (period === "once") return `${value} pagamento unico`;
  if (period === "partner") return "Beneficio por parceria";
  return `${value} / mes`;
}

function normalizePlanDoc(id, data = {}) {
  const canonicalId = normalizePlan(id);
  const def = DEFAULT_PLANS[canonicalId] || {
    id: canonicalId,
    name: canonicalId.toUpperCase(),
    price: 0,
    period: "monthly",
    durationDays: 30,
    order: 999,
    active: true,
    visible: true,
    purchasable: true,
    access: [],
    noAccess: [],
  };

  const period = stringFrom(data, ["period", "periodo", "ciclo", "billingPeriod"], def.period).toLowerCase().trim() || def.period;
  const price = roundMoney(toMoney(firstDefined(data, ["price", "preco", "valor", "amount"], def.price), def.price));
  const forcedNotPurchasable = canonicalId === "free" || canonicalId === "parceiro";
  const active = boolFrom(data, ["active", "ativo", "enabled"], def.active !== false);
  const visible = boolFrom(data, ["visible", "visivel", "show", "mostrar"], def.visible !== false);
  const purchasable = forcedNotPurchasable
    ? false
    : boolFrom(data, ["purchasable", "vendavel", "compravel", "checkout", "allowCheckout"], def.purchasable !== false);

  return {
    id: canonicalId,
    sourceId: String(id || canonicalId),
    name: stringFrom(data, ["name", "nome", "titulo", "title"], def.name),
    description: stringFrom(data, ["description", "descricao", "subtitulo"], def.description || ""),
    price,
    priceLabel: stringFrom(data, ["priceLabel", "valorLabel", "precoLabel"], "") || formatPriceLabel(price, period),
    period,
    durationDays: numberFrom(data, ["durationDays", "duracaoDias", "dias", "validadeDias"], def.durationDays),
    order: numberFrom(data, ["order", "ordem", "posicao"], def.order),
    active,
    visible,
    purchasable,
    popular: boolFrom(data, ["popular", "destaque"], def.popular === true),
    badge: stringFrom(data, ["badge", "tag", "selo"], def.badge || ""),
    access: listFrom(data, ["access", "libera", "beneficios", "features", "inclui"], def.access),
    noAccess: listFrom(data, ["noAccess", "naoLibera", "bloqueia", "semAcesso"], def.noAccess),
    fullAccessText: stringFrom(data, ["fullAccessText", "textoAcesso", "accessText"], def.fullAccessText || ""),
    note: stringFrom(data, ["note", "nota", "observacao", "obs"], def.note || ""),
    warning: stringFrom(data, ["warning", "aviso", "alerta", "checkoutWarning", "avisoCheckout"], def.warning || ""),
    affiliatePercent: numberFrom(data, ["affiliatePercent", "afiliadoPercent", "commissionPercent", "comissaoPercentual"], def.affiliatePercent || 0),
    raw: data || {},
  };
}

function normalizeAddonDoc(id, data = {}) {
  const price = roundMoney(toMoney(firstDefined(data, ["price", "preco", "valor", "amount"], 0), 0));
  const active = boolFrom(data, ["active", "ativo", "enabled"], true);
  const visible = boolFrom(data, ["visible", "visivel", "show", "mostrar"], true);
  const plans = listFrom(data, ["plans", "planos", "aplicaEm", "aplicarEm"], []);
  return {
    id: String(id || "").trim(),
    name: stringFrom(data, ["name", "nome", "titulo", "title"], String(id || "Adicional")),
    description: stringFrom(data, ["description", "descricao", "subtitulo"], ""),
    price,
    priceLabel: stringFrom(data, ["priceLabel", "valorLabel", "precoLabel"], "") || formatPriceLabel(price, "once"),
    active,
    visible,
    order: numberFrom(data, ["order", "ordem", "posicao"], 900),
    plans: plans.map(normalizePlan),
    raw: data || {},
  };
}

async function fetchFirstExistingPlanDoc(db, planId) {
  for (const docId of candidateDocIds(planId)) {
    const snap = await db.collection("planos").doc(docId).get();
    if (snap.exists) return { id: docId, data: snap.data() || {} };
  }
  const normalized = normalizePlan(planId);
  return { id: normalized, data: {} };
}

async function loadPlan(db, planId) {
  const snap = await fetchFirstExistingPlanDoc(db, planId);
  return normalizePlanDoc(snap.id, snap.data);
}

function isAddonId(id) {
  const s = String(id || "").toLowerCase().trim();
  if (!s) return false;
  return !isBasePlanId(s) && (s.includes("adicional") || s.includes("addon") || s.includes("extra"));
}

async function loadAddons(db, addonIds = [], planId = "") {
  const normalizedPlan = normalizePlan(planId);
  const cleanIds = Array.from(new Set((addonIds || []).map((x) => String(x || "").trim()).filter(Boolean))).slice(0, 8);
  const addons = [];

  for (const addonId of cleanIds) {
    if (!isAddonId(addonId)) throw new Error(`Adicional invalido: ${addonId}`);
    const snap = await db.collection("planos").doc(addonId).get();
    if (!snap.exists) throw new Error(`Adicional nao encontrado: ${addonId}`);
    const addon = normalizeAddonDoc(addonId, snap.data() || {});
    if (!addon.active || addon.price <= 0) throw new Error(`Adicional indisponivel: ${addon.name}`);
    if (addon.plans.length && !addon.plans.includes(normalizedPlan)) {
      throw new Error(`Adicional nao disponivel para o plano ${normalizedPlan}.`);
    }
    addons.push(addon);
  }

  return addons;
}

module.exports = {
  BASE_PLAN_IDS,
  DEFAULT_PLANS,
  normalizePlan,
  normalizePlanDoc,
  normalizeAddonDoc,
  loadPlan,
  loadAddons,
  roundMoney,
};
