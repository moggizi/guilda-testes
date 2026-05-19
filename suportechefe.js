// suportechefe.js — painel de chamados de suporte dentro da tela Chefe
// Módulo separado para não misturar com a lógica de guildas/parceiros/solicitações.

import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

import {
  collection,
  doc,
  addDoc,
  setDoc,
  getDoc,
  getDocs,
  onSnapshot,
  query,
  orderBy,
  serverTimestamp,
  writeBatch
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

import {
  db,
  auth,
  ensureCeoStatus,
  showToast,
  initIcons
} from "./logic.js";

const SUPPORT_CACHE_KEY = "ghub_ceo_support_view_v1";

const state = {
  ready: false,
  isCeo: false,
  active: false,
  tickets: [],
  selectedTicketId: "",
  messages: [],
  unsubTickets: null,
  unsubMessages: null,
  mounted: false
};

const qs = (id) => document.getElementById(id);

function safeJsonParse(raw, fallback = null) {
  try { return raw ? JSON.parse(raw) : fallback; } catch (_) { return fallback; }
}

function safeStorageGet(key) {
  try { return localStorage.getItem(key); } catch (_) { return null; }
}

function safeStorageSet(key, value) {
  try { localStorage.setItem(key, value); } catch (_) {}
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function normalizeText(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
}

function formatDate(value, withTime = true) {
  try {
    let date = null;

    if (value && typeof value.toDate === "function") date = value.toDate();
    else if (value && typeof value.seconds === "number") date = new Date(value.seconds * 1000);
    else if (typeof value === "number") date = new Date(value);
    else if (typeof value === "string") {
      const parsed = Date.parse(value);
      if (Number.isFinite(parsed)) date = new Date(parsed);
    }

    if (!date || Number.isNaN(date.getTime())) return "—";

    return date.toLocaleString("pt-BR", withTime ? {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit"
    } : {
      day: "2-digit",
      month: "2-digit",
      year: "numeric"
    });
  } catch (_) {
    return "—";
  }
}

function toMillis(value) {
  try {
    if (!value) return 0;
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (value && typeof value.toMillis === "function") return value.toMillis();
    if (value && typeof value.seconds === "number") return value.seconds * 1000;
    const parsed = Date.parse(String(value));
    return Number.isFinite(parsed) ? parsed : 0;
  } catch (_) {
    return 0;
  }
}

function statusInfo(status = "") {
  const s = String(status || "aberto").toLowerCase().trim();

  if (s === "fechado" || s === "closed") {
    return {
      key: "fechado",
      label: "Fechado",
      cls: "bg-gray-100 text-gray-600 border-gray-200"
    };
  }

  if (s === "respondido" || s === "resolvido" || s === "answered") {
    return {
      key: "respondido",
      label: "Respondido",
      cls: "bg-sky-50 text-sky-700 border-sky-200"
    };
  }

  return {
    key: "aberto",
    label: "Aberto",
    cls: "bg-emerald-50 text-emerald-700 border-emerald-200"
  };
}

function getTicketName(ticket = {}) {
  return String(
    ticket?.profile?.nick ||
    ticket?.supportContext?.nome ||
    ticket?.nick ||
    ticket?.nome ||
    "Usuário"
  ).trim();
}

function getTicketGameId(ticket = {}) {
  return String(
    ticket?.gameId ||
    ticket?.profileId ||
    ticket?.supportContext?.idDoJogo ||
    ticket?.profile?.gameId ||
    ticket?.id ||
    ""
  ).trim();
}

function getTicketGuildName(ticket = {}) {
  return String(
    ticket?.guildName ||
    ticket?.supportContext?.nomeGuilda ||
    ticket?.profile?.guildName ||
    "Sem guilda"
  ).trim();
}

function getTicketUid(ticket = {}) {
  return String(ticket?.uid || ticket?.supportContext?.uid || ticket?.profile?.uid || "").trim();
}

function getTicketEmail(ticket = {}) {
  return String(ticket?.email || ticket?.supportContext?.email || ticket?.profile?.email || "").trim();
}

function hasUserWaiting(ticket = {}) {
  return String(ticket?.lastMessageFrom || "").toLowerCase() === "user"
    && statusInfo(ticket?.status).key !== "fechado";
}

function refreshIcons() {
  try { initIcons(); }
  catch (_) {
    try { window.lucide?.createIcons?.(); } catch (_) {}
  }
}

function loadCachedSelectedTicket() {
  const cached = safeJsonParse(safeStorageGet(SUPPORT_CACHE_KEY), {});
  return String(cached?.selectedTicketId || "");
}

function saveCachedSelectedTicket(ticketId = "") {
  safeStorageSet(SUPPORT_CACHE_KEY, JSON.stringify({
    selectedTicketId: String(ticketId || ""),
    ts: Date.now()
  }));
}

function setButtonClass(button, active, color = "emerald") {
  if (!button) return;

  const activeColor = color === "amber"
    ? "bg-amber-500 text-white"
    : color === "sky"
      ? "bg-sky-600 text-white"
      : "bg-emerald-600 text-white";

  const inactiveColor = "bg-gray-50 text-gray-600 hover:bg-gray-100";

  button.className = [
    "flex-1 inline-flex items-center justify-center gap-2 px-4 py-3 rounded-xl text-sm font-black transition",
    active ? activeColor : inactiveColor
  ].join(" ");
}

function ensureShell() {
  if (state.mounted || qs("ceo-support-panel")) return;

  const tabBar = qs("view-guildas")?.parentElement;
  if (tabBar && !qs("view-support")) {
    const btn = document.createElement("button");
    btn.id = "view-support";
    btn.type = "button";
    btn.className = "flex-1 inline-flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-gray-50 text-gray-600 text-sm font-black hover:bg-gray-100 transition";
    btn.innerHTML = '<i data-lucide="headphones" class="w-4 h-4"></i> Suporte';
    tabBar.appendChild(btn);
  }

  const statsGrid = qs("stat-partners")?.closest(".grid");
  if (statsGrid && !qs("stat-support-card")) {
    const card = document.createElement("button");
    card.id = "stat-support-card";
    card.type = "button";
    card.className = "bg-white p-5 rounded-2xl border border-gray-200 shadow-sm text-left hover:border-sky-200 hover:bg-sky-50/40 transition";
    card.innerHTML = `
      <p class="text-xs font-bold text-gray-400 uppercase tracking-widest">Chamados de Suporte</p>
      <div class="mt-1 flex items-end justify-between gap-3">
        <h3 id="stat-support" class="text-3xl font-black text-sky-600">0</h3>
        <span id="stat-support-waiting" class="hidden rounded-full bg-rose-100 text-rose-700 px-2.5 py-1 text-[10px] font-black">0 novo(s)</span>
      </div>
    `;
    statsGrid.appendChild(card);
  }

  const partnersGrid = qs("partners-grid");
  if (partnersGrid && !qs("ceo-support-panel")) {
    const panel = document.createElement("div");
    panel.id = "ceo-support-panel";
    panel.className = "hidden space-y-4";
    panel.innerHTML = `
      <div class="bg-white border border-gray-200 rounded-2xl p-4 shadow-sm">
        <div class="flex flex-col lg:flex-row gap-3 lg:items-center">
          <div class="relative flex-1">
            <i data-lucide="search" class="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400"></i>
            <input id="ceo-support-search" type="text" placeholder="Procurar chamado por nome, ID, UID, e-mail ou guilda..."
              class="w-full pl-12 pr-4 py-3.5 rounded-xl border border-gray-100 bg-gray-50 focus:outline-none focus:ring-2 focus:ring-sky-500/20 text-sm" />
          </div>

          <select id="ceo-support-status-filter" class="px-3 py-3.5 rounded-xl border border-gray-200 bg-white text-xs font-black">
            <option value="all">Todos</option>
            <option value="waiting">Aguardando resposta</option>
            <option value="aberto">Abertos</option>
            <option value="respondido">Respondidos</option>
            <option value="fechado">Fechados</option>
          </select>

          <button id="ceo-support-reload" type="button"
            class="inline-flex items-center justify-center gap-2 px-4 py-3.5 rounded-xl bg-sky-50 text-sky-700 text-xs font-black hover:bg-sky-100 border border-sky-100">
            <i data-lucide="refresh-cw" class="w-4 h-4"></i>
            Atualizar
          </button>
        </div>
      </div>

      <div class="bg-white border border-sky-100 rounded-2xl p-4 shadow-sm">
        <div class="flex flex-col lg:flex-row gap-3 lg:items-center">
          <div class="min-w-0 lg:w-64">
            <p class="text-xs font-black text-sky-700 uppercase tracking-wider">Abrir chamado para usuário</p>
            <p class="text-[11px] text-gray-400 mt-0.5">Busca em <b>users/{ID do documento}</b>.</p>
          </div>
          <div class="relative flex-1">
            <i data-lucide="user-search" class="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400"></i>
            <input id="ceo-support-user-id" type="text" placeholder="Digite o ID do documento do usuário / ID do jogo"
              class="w-full pl-12 pr-4 py-3.5 rounded-xl border border-gray-100 bg-gray-50 focus:outline-none focus:ring-2 focus:ring-sky-500/20 text-sm" />
          </div>
          <button id="ceo-support-open-user" type="button"
            class="inline-flex items-center justify-center gap-2 px-4 py-3.5 rounded-xl bg-sky-600 text-white text-xs font-black hover:bg-sky-700 active:scale-95 transition whitespace-nowrap">
            <i data-lucide="message-square-plus" class="w-4 h-4"></i>
            Buscar e abrir
          </button>
        </div>
      </div>

      <div class="grid grid-cols-1 xl:grid-cols-[390px,1fr] gap-4 min-h-[620px]">
        <section class="bg-white border border-gray-200 rounded-2xl shadow-sm overflow-hidden flex flex-col min-h-[360px] xl:min-h-[620px]">
          <div class="shrink-0 p-4 border-b border-gray-100 flex items-center justify-between gap-3">
            <div>
              <h3 class="font-black text-gray-900">Chamados</h3>
              <p id="ceo-support-list-sub" class="text-xs text-gray-400 mt-0.5">Carregando...</p>
            </div>
            <span id="ceo-support-open-count" class="rounded-xl bg-sky-50 text-sky-700 px-2.5 py-1 text-[10px] font-black">0 abertos</span>
          </div>
          <div id="ceo-support-list" class="flex-1 overflow-y-auto p-3 space-y-2 max-h-[440px] xl:max-h-none"></div>
        </section>

        <section class="bg-white border border-gray-200 rounded-2xl shadow-sm overflow-hidden flex flex-col min-h-[620px]">
          <div id="ceo-support-detail-empty" class="flex-1 flex flex-col items-center justify-center text-center p-8 text-gray-400">
            <div class="w-16 h-16 rounded-3xl bg-gray-50 flex items-center justify-center mb-4">
              <i data-lucide="message-circle" class="w-8 h-8"></i>
            </div>
            <h3 class="font-black text-gray-700">Selecione um chamado</h3>
            <p class="text-sm mt-1 max-w-sm">Escolha um chamado na lista para ler, responder ou fechar.</p>
          </div>

          <div id="ceo-support-detail" class="hidden flex-1 min-h-0 flex flex-col">
            <div class="shrink-0 p-4 sm:p-5 border-b border-gray-100 bg-gradient-to-br from-sky-50 via-white to-white">
              <div class="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
                <div class="min-w-0">
                  <div class="flex flex-wrap items-center gap-2 mb-2">
                    <span id="ceo-support-detail-status" class="inline-flex rounded-full border px-2.5 py-1 text-[10px] font-black uppercase tracking-wide"></span>
                    <span id="ceo-support-detail-id" class="inline-flex rounded-full bg-gray-100 text-gray-600 px-2.5 py-1 text-[10px] font-black"></span>
                  </div>
                  <h3 id="ceo-support-detail-title" class="text-lg font-black text-gray-900 truncate">Chamado</h3>
                  <p id="ceo-support-detail-sub" class="text-xs text-gray-500 mt-1 break-all"></p>
                </div>

                <button id="ceo-support-close-ticket" type="button"
                  class="shrink-0 inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-gray-900 text-white text-xs font-black hover:bg-gray-800">
                  <i data-lucide="trash-2" class="w-4 h-4"></i>
                  Fechar e apagar
                </button>
              </div>

              <div id="ceo-support-context" class="mt-4 grid grid-cols-2 lg:grid-cols-4 gap-2"></div>
            </div>

            <div id="ceo-support-messages" class="flex-1 min-h-[260px] max-h-[50vh] overflow-y-auto p-4 sm:p-5 bg-gray-50/80 space-y-3"></div>

            <form id="ceo-support-form" class="shrink-0 p-4 sm:p-5 border-t border-gray-100 bg-white">
              <label class="block text-xs font-black text-gray-500 mb-2 uppercase tracking-wide">Responder como Guilda HUB Suporte</label>
              <textarea id="ceo-support-text" rows="3" maxlength="1200" placeholder="Digite a resposta para o usuário..."
                class="w-full px-4 py-3 rounded-2xl border border-gray-200 bg-gray-50 text-sm outline-none focus:bg-white focus:border-sky-400 focus:ring-4 focus:ring-sky-50 resize-none"></textarea>

              <div class="flex flex-col-reverse sm:flex-row sm:items-center sm:justify-between gap-3 mt-3">
                <p class="text-[11px] text-gray-400">A resposta aparecerá no chat do usuário e contará como nova mensagem para ele.</p>
                <button id="ceo-support-send" type="submit"
                  class="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-5 py-3 rounded-xl bg-sky-600 text-white text-sm font-black hover:bg-sky-700 active:scale-95 transition-all whitespace-nowrap">
                  <i data-lucide="send" class="w-4 h-4"></i>
                  Enviar resposta
                </button>
              </div>
            </form>
          </div>
        </section>
      </div>
    `;

    partnersGrid.insertAdjacentElement("afterend", panel);
  }

  qs("view-support")?.addEventListener("click", activateSupportView);
  qs("stat-support-card")?.addEventListener("click", activateSupportView);
  qs("ceo-support-search")?.addEventListener("input", renderTicketList);
  qs("ceo-support-status-filter")?.addEventListener("change", renderTicketList);
  qs("ceo-support-reload")?.addEventListener("click", () => {
    showToast("info", "Os chamados já atualizam em tempo real.");
    renderTicketList();
  });
  qs("ceo-support-open-user")?.addEventListener("click", openTicketByUserSearch);
  qs("ceo-support-user-id")?.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      openTicketByUserSearch();
    }
  });
  qs("ceo-support-form")?.addEventListener("submit", sendSupportReply);
  qs("ceo-support-close-ticket")?.addEventListener("click", closeSelectedTicket);

  qs("view-guildas")?.addEventListener("click", () => setTimeout(deactivateSupportView, 0));
  qs("view-partners")?.addEventListener("click", () => setTimeout(deactivateSupportView, 0));

  state.mounted = true;
  refreshIcons();
}

function activateSupportView() {
  state.active = true;

  qs("guilds-grid")?.classList.add("hidden");
  qs("partners-grid")?.classList.add("hidden");
  qs("ceo-support-panel")?.classList.remove("hidden");

  setButtonClass(qs("view-guildas"), false);
  setButtonClass(qs("view-partners"), false);
  setButtonClass(qs("view-support"), true, "sky");

  const topSearch = qs("guild-search");
  if (topSearch) topSearch.placeholder = "Use a busca da aba Suporte para filtrar chamados...";

  renderTicketList();
  renderSelectedTicket();
  refreshIcons();
}

function deactivateSupportView() {
  if (!state.active) return;
  state.active = false;
  qs("ceo-support-panel")?.classList.add("hidden");
  setButtonClass(qs("view-support"), false);
  refreshIcons();
}

function startTicketListener() {
  if (state.unsubTickets) return;

  const q = query(collection(db, "mensagem"));
  state.unsubTickets = onSnapshot(q, (snap) => {
    state.tickets = snap.docs.map((d) => ({
      id: d.id,
      ref: d.ref,
      ...(d.data() || {})
    })).sort((a, b) => {
      const tB = Number(b.lastMessageAtMs || b.updatedAtMs || b.createdAtMs || toMillis(b.lastMessageAt) || toMillis(b.updatedAt) || 0);
      const tA = Number(a.lastMessageAtMs || a.updatedAtMs || a.createdAtMs || toMillis(a.lastMessageAt) || toMillis(a.updatedAt) || 0);
      return tB - tA;
    });

    updateStats();
    renderTicketList();

    if (!state.selectedTicketId) {
      const cachedId = loadCachedSelectedTicket();
      const cachedExists = cachedId && state.tickets.some((t) => t.id === cachedId);
      const firstOpen = state.tickets.find((t) => statusInfo(t.status).key !== "fechado");
      const firstAny = state.tickets[0];

      if (cachedExists) openTicket(cachedId);
      else if (firstOpen || firstAny) openTicket((firstOpen || firstAny).id);
      else renderSelectedTicket();
    } else {
      const stillExists = state.tickets.some((t) => t.id === state.selectedTicketId);
      if (!stillExists) {
        state.selectedTicketId = "";
        state.messages = [];
        saveCachedSelectedTicket("");
        stopMessageListener();
        renderSelectedTicket();
      } else {
        renderSelectedTicket();
      }
    }
  }, (error) => {
    console.error(error);
    const list = qs("ceo-support-list");
    if (list) {
      list.innerHTML = `
        <div class="p-4 rounded-2xl bg-rose-50 border border-rose-100 text-rose-700 text-sm">
          Não foi possível carregar os chamados. Confira as regras do Firestore para a coleção <b>mensagem</b>.
        </div>
      `;
    }
  });
}

function updateStats() {
  const total = state.tickets.length;
  const waiting = state.tickets.filter(hasUserWaiting).length;
  const open = state.tickets.filter((t) => statusInfo(t.status).key !== "fechado").length;

  const stat = qs("stat-support");
  if (stat) stat.textContent = String(total);

  const waitingEl = qs("stat-support-waiting");
  if (waitingEl) {
    waitingEl.textContent = `${waiting} novo(s)`;
    waitingEl.classList.toggle("hidden", waiting <= 0);
  }

  const openEl = qs("ceo-support-open-count");
  if (openEl) openEl.textContent = `${open} aberto(s)`;

  const sub = qs("ceo-support-list-sub");
  if (sub) sub.textContent = total ? `${total} chamado(s) encontrados` : "Nenhum chamado ainda";
}

function filterTickets() {
  const search = normalizeText(qs("ceo-support-search")?.value || "");
  const filter = String(qs("ceo-support-status-filter")?.value || "all");

  return state.tickets.filter((ticket) => {
    const status = statusInfo(ticket.status).key;
    const waiting = hasUserWaiting(ticket);

    if (filter === "waiting" && !waiting) return false;
    if (filter !== "all" && filter !== "waiting" && status !== filter) return false;

    if (!search) return true;

    const haystack = normalizeText([
      getTicketName(ticket),
      getTicketGameId(ticket),
      getTicketUid(ticket),
      getTicketEmail(ticket),
      getTicketGuildName(ticket),
      ticket.guildId,
      ticket.lastMessage,
      ticket.supportContextText
    ].join(" "));

    return haystack.includes(search);
  });
}

function renderTicketList() {
  const list = qs("ceo-support-list");
  if (!list) return;

  const tickets = filterTickets();
  updateStats();

  if (!tickets.length) {
    list.innerHTML = `
      <div class="p-6 text-center text-gray-400">
        <i data-lucide="inbox" class="w-8 h-8 mx-auto mb-2"></i>
        <p class="text-sm font-bold text-gray-500">Nenhum chamado encontrado</p>
        <p class="text-xs mt-1">Quando um usuário abrir chamado, ele aparecerá aqui.</p>
      </div>
    `;
    refreshIcons();
    return;
  }

  list.innerHTML = tickets.map((ticket) => {
    const s = statusInfo(ticket.status);
    const selected = ticket.id === state.selectedTicketId;
    const waiting = hasUserWaiting(ticket);
    const title = getTicketName(ticket);
    const gameId = getTicketGameId(ticket);
    const guild = getTicketGuildName(ticket);
    const last = String(ticket.lastMessage || "Sem mensagem").trim();
    const date = formatDate(ticket.lastMessageAtMs || ticket.updatedAtMs || ticket.createdAtMs || ticket.lastMessageAt || ticket.updatedAt);

    return `
      <button type="button" data-ticket-id="${escapeHtml(ticket.id)}"
        class="ceo-support-ticket w-full text-left rounded-2xl border p-3 transition ${selected ? "border-sky-300 bg-sky-50" : "border-gray-100 bg-gray-50/70 hover:bg-white hover:border-sky-100"}">
        <div class="flex items-start justify-between gap-3">
          <div class="min-w-0">
            <div class="flex items-center gap-2 min-w-0">
              <p class="font-black text-gray-900 text-sm truncate">${escapeHtml(title)}</p>
              ${waiting ? '<span class="shrink-0 w-2 h-2 rounded-full bg-rose-500"></span>' : ""}
            </div>
            <p class="text-[11px] text-gray-500 mt-0.5 truncate">ID: ${escapeHtml(gameId || "—")} • ${escapeHtml(guild || "Sem guilda")}</p>
          </div>
          <span class="shrink-0 rounded-full border px-2 py-0.5 text-[9px] font-black uppercase ${s.cls}">${escapeHtml(s.label)}</span>
        </div>
        <p class="mt-2 text-xs text-gray-600 line-clamp-2">${escapeHtml(last)}</p>
        <p class="mt-2 text-[10px] text-gray-400 font-semibold">${escapeHtml(date)}</p>
      </button>
    `;
  }).join("");

  list.querySelectorAll(".ceo-support-ticket").forEach((btn) => {
    btn.addEventListener("click", () => openTicket(btn.dataset.ticketId || ""));
  });

  refreshIcons();
}

function getSelectedTicket() {
  return state.tickets.find((t) => t.id === state.selectedTicketId) || null;
}

function renderContextCard(label, value) {
  return `
    <div class="rounded-2xl bg-white/80 border border-gray-100 px-3 py-2 min-w-0">
      <p class="text-[9px] font-black uppercase tracking-wider text-gray-400">${escapeHtml(label)}</p>
      <p class="mt-1 text-xs font-bold text-gray-800 truncate" title="${escapeHtml(value || "—")}">${escapeHtml(value || "—")}</p>
    </div>
  `;
}

function renderSelectedTicket() {
  const ticket = getSelectedTicket();
  const empty = qs("ceo-support-detail-empty");
  const detail = qs("ceo-support-detail");

  if (!ticket) {
    if (empty) empty.classList.remove("hidden");
    if (detail) detail.classList.add("hidden");
    refreshIcons();
    return;
  }

  if (empty) empty.classList.add("hidden");
  if (detail) detail.classList.remove("hidden");

  const s = statusInfo(ticket.status);
  const name = getTicketName(ticket);
  const gameId = getTicketGameId(ticket);
  const uid = getTicketUid(ticket);
  const email = getTicketEmail(ticket);
  const guildName = getTicketGuildName(ticket);
  const guildId = String(ticket.guildId || ticket.supportContext?.uidGuilda || ticket.profile?.guildId || "").trim();
  const role = String(ticket.role || ticket.supportContext?.cargo || ticket.profile?.role || "—").trim();
  const openedAt = formatDate(ticket.openedAtMs || ticket.createdAtMs || ticket.openedAt || ticket.createdAt);

  const statusEl = qs("ceo-support-detail-status");
  if (statusEl) {
    statusEl.className = `inline-flex rounded-full border px-2.5 py-1 text-[10px] font-black uppercase tracking-wide ${s.cls}`;
    statusEl.textContent = s.label;
  }

  const idEl = qs("ceo-support-detail-id");
  if (idEl) idEl.textContent = `Chamado: ${ticket.id}`;

  const title = qs("ceo-support-detail-title");
  if (title) title.textContent = name;

  const sub = qs("ceo-support-detail-sub");
  if (sub) sub.textContent = `ID ${gameId || "—"} • ${email || "sem e-mail"}`;

  const context = qs("ceo-support-context");
  if (context) {
    context.innerHTML = [
      renderContextCard("ID do jogo", gameId),
      renderContextCard("UID", uid),
      renderContextCard("Guilda", guildName),
      renderContextCard("UID guilda", guildId),
      renderContextCard("Cargo", role),
      renderContextCard("E-mail", email),
      renderContextCard("Aberto em", openedAt),
      renderContextCard("Página", ticket.supportContext?.urlPagina || "—")
    ].join("");
  }

  const closeBtn = qs("ceo-support-close-ticket");
  if (closeBtn) {
    closeBtn.disabled = false;
    closeBtn.classList.remove("opacity-50", "cursor-not-allowed");
    closeBtn.innerHTML = '<i data-lucide="trash-2" class="w-4 h-4"></i> Fechar e apagar';
  }

  renderMessages();
  refreshIcons();
}

function stopMessageListener() {
  if (state.unsubMessages) {
    try { state.unsubMessages(); } catch (_) {}
  }
  state.unsubMessages = null;
}

function openTicket(ticketId) {
  const cleanId = String(ticketId || "").trim();
  if (!cleanId) return;

  state.selectedTicketId = cleanId;
  state.messages = [];
  saveCachedSelectedTicket(cleanId);

  renderTicketList();
  renderSelectedTicket();

  stopMessageListener();

  const messagesRef = collection(db, "mensagem", cleanId, "mensagens");
  const q = query(messagesRef, orderBy("createdAtMs", "asc"));

  state.unsubMessages = onSnapshot(q, (snap) => {
    state.messages = snap.docs.map((d) => ({
      id: d.id,
      ref: d.ref,
      ...(d.data() || {})
    }));

    renderMessages();
    markSelectedMessagesAsReadBySupport();
  }, (error) => {
    console.error(error);
    const box = qs("ceo-support-messages");
    if (box) {
      box.innerHTML = `
        <div class="rounded-2xl bg-rose-50 border border-rose-100 text-rose-700 p-4 text-sm">
          Não foi possível ler as mensagens deste chamado.
        </div>
      `;
    }
  });
}

function renderMessages() {
  const box = qs("ceo-support-messages");
  if (!box) return;

  if (!state.selectedTicketId) {
    box.innerHTML = "";
    return;
  }

  if (!state.messages.length) {
    box.innerHTML = `
      <div class="h-full min-h-[260px] flex flex-col items-center justify-center text-center text-gray-400">
        <i data-lucide="message-circle" class="w-8 h-8 mb-2"></i>
        <p class="text-sm font-bold text-gray-500">Nenhuma mensagem no chamado</p>
      </div>
    `;
    refreshIcons();
    return;
  }

  box.innerHTML = state.messages.map((msg) => {
    const from = String(msg.from || "").toLowerCase();
    const support = from === "support";
    const system = msg.system === true;
    const who = support ? (msg.authorName || "GUILDAHUB SUPORTE") : "Usuário";
    const text = String(msg.text || "");
    const date = formatDate(msg.createdAtMs || msg.createdAt);

    if (system) {
      return `
        <div class="flex justify-center">
          <div class="max-w-[90%] rounded-2xl bg-gray-100 text-gray-600 px-4 py-2 text-xs font-semibold text-center">
            ${escapeHtml(text)}
            <div class="mt-1 text-[10px] text-gray-400">${escapeHtml(date)}</div>
          </div>
        </div>
      `;
    }

    return `
      <div class="flex ${support ? "justify-end" : "justify-start"}">
        <div class="max-w-[88%] rounded-2xl px-4 py-3 shadow-sm border ${
          support
            ? "bg-sky-600 text-white border-sky-600 rounded-br-md"
            : "bg-white text-gray-800 border-gray-100 rounded-bl-md"
        }">
          <p class="${support ? "text-sky-50" : "text-emerald-600"} text-[10px] font-black mb-1 uppercase tracking-wide">${escapeHtml(who)}</p>
          <p class="text-sm whitespace-pre-wrap break-words leading-relaxed">${escapeHtml(text)}</p>
          <p class="${support ? "text-sky-100" : "text-gray-400"} text-[10px] mt-1">${escapeHtml(date)}</p>
        </div>
      </div>
    `;
  }).join("");

  box.scrollTop = box.scrollHeight;
  refreshIcons();
}

async function markSelectedMessagesAsReadBySupport() {
  const ticket = getSelectedTicket();
  if (!ticket) return;

  const unread = state.messages.filter((msg) => {
    return msg.from === "user" && msg.readBySupport !== true && msg.ref;
  });

  if (!unread.length) return;

  try {
    const batch = writeBatch(db);
    unread.slice(0, 450).forEach((msg) => {
      batch.set(msg.ref, {
        readBySupport: true,
        readBySupportAt: serverTimestamp()
      }, { merge: true });
    });
    batch.set(doc(db, "mensagem", ticket.id), {
      unreadSupport: 0,
      lastReadBySupportAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    }, { merge: true });
    await batch.commit();
  } catch (_) {}
}

async function sendSupportReply(event) {
  event.preventDefault();

  const ticket = getSelectedTicket();
  const input = qs("ceo-support-text");
  const btn = qs("ceo-support-send");
  const text = String(input?.value || "").trim();

  if (!ticket) {
    showToast("error", "Selecione um chamado para responder.");
    return;
  }

  if (!text) {
    showToast("error", "Digite uma resposta antes de enviar.");
    return;
  }

  if (text.length > 1200) {
    showToast("error", "Resposta muito grande. Use até 1200 caracteres.");
    return;
  }

  const originalHtml = btn?.innerHTML || "";
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<i data-lucide="loader-2" class="w-4 h-4 animate-spin"></i> Enviando...';
    refreshIcons();
  }

  try {
    const ticketRef = doc(db, "mensagem", ticket.id);
    const messagesRef = collection(db, "mensagem", ticket.id, "mensagens");
    const now = Date.now();

    await addDoc(messagesRef, {
      from: "support",
      authorName: "GUILDAHUB SUPORTE",
      supportUid: auth.currentUser?.uid || null,
      supportEmail: auth.currentUser?.email || null,
      profileId: ticket.profileId || ticket.id,
      uid: ticket.uid || ticket.supportContext?.uid || null,
      guildId: ticket.guildId || ticket.supportContext?.uidGuilda || null,
      text,
      readBySupport: true,
      readByUser: false,
      createdAt: serverTimestamp(),
      createdAtMs: now
    });

    await setDoc(ticketRef, {
      status: "respondido",
      lastMessage: text.slice(0, 180),
      lastMessageFrom: "support",
      lastSupportReplyAt: serverTimestamp(),
      lastSupportReplyAtMs: now,
      supportUid: auth.currentUser?.uid || null,
      supportEmail: auth.currentUser?.email || null,
      updatedAt: serverTimestamp(),
      updatedAtMs: now,
      lastMessageAt: serverTimestamp(),
      lastMessageAtMs: now
    }, { merge: true });

    if (input) input.value = "";
    showToast("success", "Resposta enviada ao usuário.");
  } catch (error) {
    console.error(error);
    showToast("error", "Não foi possível enviar a resposta.");
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = originalHtml || '<i data-lucide="send" class="w-4 h-4"></i> Enviar resposta';
      refreshIcons();
    }
  }
}

function sanitizeUserDocId(value) {
  const clean = String(value || "").trim();
  if (!clean || clean.includes("/") || clean.length > 120) return "";
  return clean;
}

function userDocProfileId(docId, data = {}) {
  const direct = String(
    data.gameIdMigrated ||
    data.gameId ||
    data.id ||
    data.userId ||
    ""
  ).replace(/\D+/g, "");

  if (direct) return direct;
  if (/^\d+$/.test(String(docId || ""))) return String(docId);
  return String(docId || "").trim();
}

function profileFromUserDoc(docId, data = {}) {
  const profileId = userDocProfileId(docId, data);
  const uid = String(data.uid || data.authUid || (String(docId || "").includes("-") ? docId : "")).trim();
  const email = String(data.email || data.playerEmail || "").trim().toLowerCase();
  const guildId = String(data.guildId || data.guild || data.guildUid || "").trim();
  const guildName = String(data.guilda || data.guildName || data.nomeGuilda || "Sem guilda").trim() || "Sem guilda";

  return {
    profileId,
    gameId: String(data.gameId || data.gameIdMigrated || profileId || "").trim(),
    nick: String(data.nick || data.nome || data.name || "Usuário").trim() || "Usuário",
    uid,
    email,
    guildId,
    guildName,
    role: String(data.role || data.cargo || "Membro").trim() || "Membro",
    createdAt: data.createdAt || data.criadoEm || data.created_at || data.created || null
  };
}

function buildSupportContextForProfile(profile = {}) {
  return {
    nome: profile.nick || "",
    idDoJogo: profile.gameId || profile.profileId || "",
    profileId: profile.profileId || "",
    uid: profile.uid || "",
    email: profile.email || "",
    cargo: profile.role || "",
    uidGuilda: profile.guildId || "",
    nomeGuilda: profile.guildName || "",
    dataEntrada: formatDate(profile.createdAt),
    urlPagina: String(window.location.href || ""),
    abertoPeloSuporte: true,
    abertoEmMs: Date.now()
  };
}

function supportContextTextFromProfile(profile = {}) {
  const c = buildSupportContextForProfile(profile);
  return [
    `Nome: ${c.nome || "—"}`,
    `ID do jogo: ${c.idDoJogo || "—"}`,
    `UID: ${c.uid || "—"}`,
    `E-mail: ${c.email || "—"}`,
    `Cargo: ${c.cargo || "—"}`,
    `UID da guilda: ${c.uidGuilda || "—"}`,
    `Nome da guilda: ${c.nomeGuilda || "—"}`,
    `Data de entrada: ${c.dataEntrada || "—"}`,
    `Aberto pelo suporte: sim`
  ].join("\n");
}

async function openTicketByUserSearch() {
  const input = qs("ceo-support-user-id");
  const btn = qs("ceo-support-open-user");
  const userDocId = sanitizeUserDocId(input?.value || "");

  if (!userDocId) {
    showToast("error", "Digite um ID de documento válido do usuário.");
    return;
  }

  const originalHtml = btn?.innerHTML || "";
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<i data-lucide="loader-2" class="w-4 h-4 animate-spin"></i> Buscando...';
    refreshIcons();
  }

  try {
    const userSnap = await getDoc(doc(db, "users", userDocId));
    if (!userSnap.exists()) {
      showToast("error", "Usuário não encontrado em users/" + userDocId + ".");
      return;
    }

    const userData = userSnap.data() || {};
    const profile = profileFromUserDoc(userSnap.id, userData);
    if (!profile.profileId) {
      showToast("error", "Esse usuário não tem ID suficiente para abrir chamado.");
      return;
    }

    const ticketRef = doc(db, "mensagem", profile.profileId);
    const ticketSnap = await getDoc(ticketRef);
    const now = Date.now();
    const supportContext = buildSupportContextForProfile(profile);

    const ticketPayload = {
      id: profile.profileId,
      profileId: profile.profileId,
      gameId: profile.gameId || profile.profileId,
      uid: profile.uid,
      email: profile.email,
      guildId: profile.guildId,
      guildName: profile.guildName,
      role: profile.role,
      profile: {
        nick: profile.nick || "",
        gameId: profile.gameId || profile.profileId,
        uid: profile.uid || "",
        email: profile.email || "",
        guildId: profile.guildId || "",
        guildName: profile.guildName || "",
        role: profile.role || "Membro",
        createdAtText: formatDate(profile.createdAt)
      },
      supportContext,
      supportContextText: supportContextTextFromProfile(profile),
      status: "respondido",
      tipo: "chamado-suporte",
      abertoPeloSuporte: true,
      lastMessage: "Chamado aberto pelo suporte.",
      lastMessageFrom: "support",
      unreadUser: 1,
      supportUid: auth.currentUser?.uid || null,
      supportEmail: auth.currentUser?.email || null,
      updatedAt: serverTimestamp(),
      updatedAtMs: now,
      lastMessageAt: serverTimestamp(),
      lastMessageAtMs: now
    };

    if (!ticketSnap.exists()) {
      ticketPayload.createdAt = serverTimestamp();
      ticketPayload.createdAtMs = now;
      ticketPayload.openedAt = serverTimestamp();
      ticketPayload.openedAtMs = now;
    }

    await setDoc(ticketRef, ticketPayload, { merge: true });

    if (!ticketSnap.exists()) {
      await addDoc(collection(db, "mensagem", profile.profileId, "mensagens"), {
        from: "support",
        authorName: "GUILDAHUB SUPORTE",
        supportUid: auth.currentUser?.uid || null,
        supportEmail: auth.currentUser?.email || null,
        profileId: profile.profileId,
        uid: profile.uid || null,
        guildId: profile.guildId || null,
        text: "Olá! O suporte da Guilda HUB abriu este chamado para falar com você. Responda por aqui quando puder.",
        readBySupport: true,
        readByUser: false,
        createdAt: serverTimestamp(),
        createdAtMs: now
      });
    }

    const draftTicket = {
      id: profile.profileId,
      ref: ticketRef,
      ...((ticketSnap.exists() ? ticketSnap.data() : {}) || {}),
      ...ticketPayload
    };

    state.tickets = [draftTicket, ...state.tickets.filter((t) => t.id !== profile.profileId)];
    if (input) input.value = "";
    openTicket(profile.profileId);
    renderTicketList();
    showToast("success", ticketSnap.exists() ? "Chamado existente aberto." : "Chamado criado para o usuário.");
  } catch (error) {
    console.error(error);
    showToast("error", "Não foi possível buscar/abrir chamado para esse usuário.");
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = originalHtml || '<i data-lucide="message-square-plus" class="w-4 h-4"></i> Buscar e abrir';
      refreshIcons();
    }
  }
}

async function closeSelectedTicket() {
  const ticket = getSelectedTicket();
  if (!ticket) {
    showToast("error", "Selecione um chamado para fechar.");
    return;
  }

  const ok = window.confirm("Fechar este chamado vai apagar o histórico e remover o chamado da lista. Deseja continuar?");
  if (!ok) return;

  const btn = qs("ceo-support-close-ticket");
  const originalHtml = btn?.innerHTML || "";

  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<i data-lucide="loader-2" class="w-4 h-4 animate-spin"></i> Apagando...';
    refreshIcons();
  }

  try {
    const ticketRef = doc(db, "mensagem", ticket.id);
    const messagesRef = collection(db, "mensagem", ticket.id, "mensagens");
    const snap = await getDocs(messagesRef);
    const docs = snap.docs || [];

    for (let i = 0; i < docs.length; i += 450) {
      const batch = writeBatch(db);
      docs.slice(i, i + 450).forEach((docSnap) => batch.delete(docSnap.ref));
      await batch.commit();
    }

    const batch = writeBatch(db);
    batch.delete(ticketRef);
    await batch.commit();

    state.tickets = state.tickets.filter((item) => item.id !== ticket.id);
    state.selectedTicketId = "";
    state.messages = [];
    saveCachedSelectedTicket("");
    stopMessageListener();

    updateStats();
    renderTicketList();
    renderSelectedTicket();
    showToast("success", "Chamado fechado e apagado.");
  } catch (error) {
    console.error(error);
    showToast("error", "Não foi possível fechar/apagar o chamado.");
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = originalHtml || '<i data-lucide="trash-2" class="w-4 h-4"></i> Fechar e apagar';
      refreshIcons();
    }
  }
}


function waitForAuthUser() {
  return new Promise((resolve) => {
    try {
      if (auth.currentUser) {
        resolve(auth.currentUser);
        return;
      }

      let unsub = () => {};
      unsub = onAuthStateChanged(auth, (user) => {
        try { unsub(); } catch (_) {}
        resolve(user || null);
      });
    } catch (_) {
      resolve(auth.currentUser || null);
    }
  });
}

async function bootSupportCeo() {
  ensureShell();

  const user = await waitForAuthUser();
  if (!user) return;

  try {
    state.isCeo = await ensureCeoStatus();
  } catch (_) {
    state.isCeo = false;
  }

  if (!state.isCeo) {
    // A própria tela chefe já bloqueia o acesso. Aqui só evita abrir listener extra.
    return;
  }

  state.ready = true;
  startTicketListener();
  refreshIcons();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", bootSupportCeo, { once: true });
} else {
  bootSupportCeo();
}
