// mensagemsuporte.js — botão flutuante + chat de suporte do usuário
// Funciona separado da tela principal para não misturar com dashboard/perfil.

import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  doc,
  getDoc,
  setDoc,
  collection,
  addDoc,
  onSnapshot,
  query,
  orderBy,
  serverTimestamp,
  writeBatch,
  getDocs
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

import { auth, db, getGuildContext, showToast, initIcons } from "./logic.js";

const PROFILE_CACHE_TTL_MS = 10 * 60 * 1000;
const CHAT_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

const state = {
  user: null,
  profile: null,
  profileLoaded: false,
  modalOpen: false,
  messages: [],
  unreadCount: 0,
  unsubMessages: null,
  mounted: false
};

const qs = (id) => document.getElementById(id);

function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase();
}

function normalizeDigits(value) {
  return String(value ?? "").replace(/\D+/g, "");
}

function safeJsonParse(raw, fallback = null) {
  try {
    return raw ? JSON.parse(raw) : fallback;
  } catch (_) {
    return fallback;
  }
}

function safeStorageGet(key) {
  try {
    return localStorage.getItem(key);
  } catch (_) {
    return null;
  }
}

function safeStorageSet(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch (_) {}
}

function safeStorageRemove(key) {
  try {
    localStorage.removeItem(key);
  } catch (_) {}
}

function profileCacheKey(uid) {
  return `ghub_support_profile_${uid || "unknown"}`;
}

function chatCacheKey(uid) {
  return `ghub_support_chat_${uid || "unknown"}`;
}

function readProfileCache(uid) {
  const cached = safeJsonParse(safeStorageGet(profileCacheKey(uid)), null);
  if (!cached || !cached.profileId || !cached.ts) return null;
  if ((Date.now() - Number(cached.ts || 0)) > PROFILE_CACHE_TTL_MS) return null;
  return cached;
}

function writeProfileCache(uid, profile) {
  if (!uid || !profile?.profileId) return;
  safeStorageSet(profileCacheKey(uid), JSON.stringify({
    ...profile,
    ts: Date.now()
  }));
}

function readChatCache(uid) {
  const cached = safeJsonParse(safeStorageGet(chatCacheKey(uid)), null);
  if (!cached || !cached.ts) return { chatOpen: false, unreadCount: 0 };
  if ((Date.now() - Number(cached.ts || 0)) > CHAT_CACHE_TTL_MS) {
    safeStorageRemove(chatCacheKey(uid));
    return { chatOpen: false, unreadCount: 0 };
  }
  return {
    chatOpen: cached.chatOpen === true,
    unreadCount: Math.max(0, Number(cached.unreadCount || 0) || 0)
  };
}

function writeChatCache(partial = {}) {
  const uid = state.user?.uid || "unknown";
  const current = readChatCache(uid);
  safeStorageSet(chatCacheKey(uid), JSON.stringify({
    ...current,
    ...partial,
    ts: Date.now()
  }));
}

function formatDate(value) {
  try {
    let date = null;

    if (value && typeof value.toDate === "function") {
      date = value.toDate();
    } else if (value && typeof value.seconds === "number") {
      date = new Date(value.seconds * 1000);
    } else if (typeof value === "number") {
      date = new Date(value);
    } else if (typeof value === "string") {
      const parsed = Date.parse(value);
      if (Number.isFinite(parsed)) date = new Date(parsed);
    }

    if (!date || Number.isNaN(date.getTime())) return "--";

    return date.toLocaleString("pt-BR", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit"
    });
  } catch (_) {
    return "--";
  }
}

function textOrDash(value) {
  const clean = String(value ?? "").trim();
  return clean || "--";
}

function isNumericProfileId(value) {
  return /^\d+$/.test(String(value || ""));
}

function getLikelyProfileId(data = {}, fallbackDocId = "") {
  const fromData = normalizeDigits(
    data.gameIdMigrated ||
    data.gameId ||
    data.id ||
    data.userId ||
    ""
  );

  if (fromData) return fromData;
  if (isNumericProfileId(fallbackDocId)) return String(fallbackDocId);
  return "";
}

function profileFromData({
  user,
  authData = {},
  profileData = {},
  profileId = "",
  ctx = {}
}) {
  const source = { ...(authData || {}), ...(profileData || {}) };
  const guildId = String(source.guildId || ctx.guildId || "").trim();
  const guildName = String(
    source.guilda ||
    source.guildName ||
    ctx.guildName ||
    ""
  ).trim();

  return {
    profileId,
    gameId: profileId,
    nick: String(source.nick || source.nome || source.name || "").trim(),
    uid: String(source.uid || user?.uid || "").trim(),
    email: normalizeEmail(source.email || user?.email || ""),
    guildId,
    guildName: guildName || "Sem guilda",
    role: String(source.role || ctx.role || "Membro").trim() || "Membro",
    createdAt: source.createdAt || source.criadoEm || source.created_at || source.created || null,
    photo: source.foto || "",
    configured: !!profileId
  };
}

async function resolveProfile(forceRefresh = false) {
  const user = state.user || auth.currentUser;
  if (!user?.uid) return null;

  if (!forceRefresh) {
    const cached = readProfileCache(user.uid);
    if (cached?.profileId) {
      state.profile = cached;
      state.profileLoaded = true;
      return cached;
    }
  }

  const ctx = getGuildContext() || {};
  const uid = String(user.uid || "").trim();
  const email = normalizeEmail(user.email || "");

  let authData = {};
  let profileData = {};
  let profileId = "";

  try {
    const authSnap = await getDoc(doc(db, "users", uid));
    authData = authSnap.exists() ? (authSnap.data() || {}) : {};
    profileId = getLikelyProfileId(authData, authSnap.id);

    // Se existir ID oficial de jogo, tenta pegar o doc numérico para dados mais completos.
    // Essa é a única leitura extra e só acontece quando necessário.
    if (profileId && profileId !== uid) {
      try {
        const profileSnap = await getDoc(doc(db, "users", profileId));
        if (profileSnap.exists()) {
          const data = profileSnap.data() || {};
          const belongsToUser =
            String(data.uid || "").trim() === uid ||
            normalizeEmail(data.email || data.playerEmail || "") === email;

          if (belongsToUser || !data.uid) {
            profileData = { id: profileSnap.id, ...data };
          }
        }
      } catch (_) {}
    }
  } catch (_) {
    // Se regras bloquearem ou falhar internet, tenta pelo contexto/cache mínimo.
    authData = {};
  }

  const profile = profileFromData({
    user,
    authData,
    profileData,
    profileId,
    ctx
  });

  if (profile.profileId) writeProfileCache(uid, profile);

  state.profile = profile;
  state.profileLoaded = true;
  return profile;
}

function ensureShell() {
  if (state.mounted || qs("ghub-support-floating")) return;

  const wrapper = document.createElement("div");
  wrapper.id = "ghub-support-root";
  wrapper.innerHTML = `
    <button id="ghub-support-floating" type="button"
      class="fixed right-4 bottom-4 sm:right-6 sm:bottom-6 z-[70] inline-flex items-center gap-2 px-4 py-3 rounded-2xl bg-emerald-600 text-white text-sm font-black shadow-2xl shadow-emerald-200 hover:bg-emerald-700 active:scale-95 transition-all">
      <span class="relative flex">
        <i data-lucide="messages-square" class="w-5 h-5"></i>
        <span id="ghub-support-badge" class="hidden absolute -top-3 -right-3 min-w-[18px] h-[18px] px-1 rounded-full bg-rose-600 text-white text-[10px] leading-[18px] text-center font-black ring-2 ring-white">0</span>
      </span>
      <span>Suporte</span>
    </button>

    <div id="ghub-support-modal" class="hidden fixed inset-0 z-[80] bg-slate-950/50 backdrop-blur-sm px-3 py-4 sm:p-6">
      <div class="min-h-full flex items-end sm:items-center justify-center">
        <div class="w-full max-w-2xl bg-white rounded-t-3xl sm:rounded-3xl shadow-2xl border border-gray-100 overflow-hidden">
          <div class="flex items-start justify-between gap-4 px-5 py-4 border-b border-gray-100 bg-gradient-to-br from-emerald-50 to-white">
            <div class="min-w-0">
              <div class="inline-flex items-center gap-2 rounded-full bg-emerald-100 text-emerald-700 px-3 py-1 text-[11px] font-black mb-2">
                <i data-lucide="headphones" class="w-3.5 h-3.5"></i>
                Atendimento Guilda HUB
              </div>
              <h2 class="text-lg font-black text-gray-900 leading-tight">Mensagem com o suporte</h2>
              <p class="text-xs text-gray-500 mt-1">Envie sua dúvida usando seu perfil configurado.</p>
            </div>
            <button id="ghub-support-close-modal" type="button"
              class="shrink-0 w-10 h-10 rounded-2xl bg-white border border-gray-200 text-gray-500 hover:bg-gray-50 flex items-center justify-center">
              <i data-lucide="x" class="w-5 h-5"></i>
            </button>
          </div>

          <div id="ghub-support-profile-warning" class="hidden p-5">
            <div class="rounded-2xl border border-amber-200 bg-amber-50 p-4">
              <div class="flex gap-3">
                <div class="shrink-0 w-10 h-10 rounded-2xl bg-amber-100 text-amber-700 flex items-center justify-center">
                  <i data-lucide="triangle-alert" class="w-5 h-5"></i>
                </div>
                <div>
                  <h3 class="font-black text-amber-900">Configure seu perfil primeiro</h3>
                  <p class="text-sm text-amber-800 mt-1">Para falar com o suporte, seu perfil precisa ter o ID do jogo ativo.</p>
                  <a href="perfil.html" class="inline-flex items-center gap-2 mt-3 px-4 py-2 rounded-xl bg-amber-600 text-white text-sm font-bold hover:bg-amber-700">
                    Abrir perfil
                    <i data-lucide="arrow-right" class="w-4 h-4"></i>
                  </a>
                </div>
              </div>
            </div>
          </div>

          <div id="ghub-support-chat-area" class="hidden">
            <div class="p-5 border-b border-gray-100">
              <div class="grid grid-cols-1 sm:grid-cols-2 gap-3" id="ghub-support-profile-info"></div>
            </div>

            <div id="ghub-support-messages" class="h-[280px] sm:h-[320px] overflow-y-auto p-5 bg-gray-50/80 space-y-3"></div>

            <form id="ghub-support-form" class="p-4 border-t border-gray-100 bg-white">
              <label class="block text-xs font-bold text-gray-500 mb-2">Sua mensagem</label>
              <textarea id="ghub-support-text" rows="3" maxlength="700" placeholder="Digite sua dúvida para o suporte..."
                class="w-full px-4 py-3 rounded-2xl border border-gray-200 bg-gray-50 text-sm outline-none focus:bg-white focus:border-emerald-400 focus:ring-4 focus:ring-emerald-50 resize-none"></textarea>

              <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mt-3">
                <button id="ghub-support-delete-chat" type="button"
                  class="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-rose-50 text-rose-600 text-sm font-bold hover:bg-rose-100">
                  <i data-lucide="trash-2" class="w-4 h-4"></i>
                  Fechar chat
                </button>

                <button id="ghub-support-send" type="submit"
                  class="inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl bg-emerald-600 text-white text-sm font-black hover:bg-emerald-700 active:scale-95 transition-all">
                  <i data-lucide="send" class="w-4 h-4"></i>
                  Enviar
                </button>
              </div>

              <p class="text-[11px] text-gray-400 mt-2">Ao fechar o chat, todo o histórico deste atendimento será apagado.</p>
            </form>
          </div>
        </div>
      </div>
    </div>
  `;

  document.body.appendChild(wrapper);
  state.mounted = true;

  qs("ghub-support-floating")?.addEventListener("click", openModal);
  qs("ghub-support-close-modal")?.addEventListener("click", closeModal);
  qs("ghub-support-modal")?.addEventListener("click", (event) => {
    if (event.target === qs("ghub-support-modal")) closeModal();
  });
  qs("ghub-support-form")?.addEventListener("submit", sendSupportMessage);
  qs("ghub-support-delete-chat")?.addEventListener("click", deleteSupportChat);

  refreshIcons();
}

function refreshIcons() {
  try {
    initIcons();
  } catch (_) {
    try { window.lucide?.createIcons?.(); } catch (_) {}
  }
}

function renderBadge() {
  const badge = qs("ghub-support-badge");
  if (!badge) return;

  const count = Math.max(0, Number(state.unreadCount || 0) || 0);
  if (count <= 0) {
    badge.classList.add("hidden");
    badge.textContent = "0";
    return;
  }

  badge.textContent = count > 99 ? "99+" : String(count);
  badge.classList.remove("hidden");
}

function renderProfileInfo() {
  const container = qs("ghub-support-profile-info");
  if (!container || !state.profile) return;

  const p = state.profile;
  const items = [
    ["Nome", textOrDash(p.nick)],
    ["ID do jogo", textOrDash(p.gameId || p.profileId)],
    ["UID", textOrDash(p.uid)],
    ["UID da guilda", textOrDash(p.guildId)],
    ["Nome da guilda", textOrDash(p.guildName)],
    ["Cargo", textOrDash(p.role)],
    ["E-mail", textOrDash(p.email)],
    ["Data de entrada", formatDate(p.createdAt)]
  ];

  container.innerHTML = "";
  items.forEach(([label, value]) => {
    const item = document.createElement("div");
    item.className = "rounded-2xl bg-gray-50 border border-gray-100 p-3 min-w-0";
    const labelEl = document.createElement("p");
    labelEl.className = "text-[10px] font-black uppercase tracking-wider text-gray-400";
    labelEl.textContent = label;

    const valueEl = document.createElement("p");
    valueEl.className = "mt-1 text-sm font-bold text-gray-800 break-all";
    valueEl.textContent = value;

    item.appendChild(labelEl);
    item.appendChild(valueEl);
    container.appendChild(item);
  });
}

function renderMessages() {
  const box = qs("ghub-support-messages");
  if (!box) return;

  box.innerHTML = "";

  if (!state.messages.length) {
    const empty = document.createElement("div");
    empty.className = "h-full flex flex-col items-center justify-center text-center text-gray-400";
    empty.innerHTML = `
      <i data-lucide="message-circle" class="w-9 h-9 mb-2"></i>
      <p class="text-sm font-bold text-gray-500">Nenhuma mensagem ainda</p>
      <p class="text-xs mt-1">Envie a primeira mensagem para abrir o atendimento.</p>
    `;
    box.appendChild(empty);
    refreshIcons();
    return;
  }

  state.messages.forEach((msg) => {
    const mine = msg.from === "user";
    const row = document.createElement("div");
    row.className = `flex ${mine ? "justify-end" : "justify-start"}`;

    const bubble = document.createElement("div");
    bubble.className = [
      "max-w-[85%] rounded-2xl px-4 py-3 shadow-sm border",
      mine
        ? "bg-emerald-600 text-white border-emerald-600 rounded-br-md"
        : "bg-white text-gray-800 border-gray-100 rounded-bl-md"
    ].join(" ");

    const who = document.createElement("p");
    who.className = mine ? "text-[10px] font-black text-emerald-50 mb-1" : "text-[10px] font-black text-emerald-600 mb-1";
    who.textContent = mine ? "Você" : "Suporte";

    const text = document.createElement("p");
    text.className = "text-sm whitespace-pre-wrap break-words";
    text.textContent = String(msg.text || "");

    const time = document.createElement("p");
    time.className = mine ? "text-[10px] text-emerald-100 mt-1" : "text-[10px] text-gray-400 mt-1";
    time.textContent = formatDate(msg.createdAtMs || msg.createdAt);

    bubble.appendChild(who);
    bubble.appendChild(text);
    bubble.appendChild(time);
    row.appendChild(bubble);
    box.appendChild(row);
  });

  box.scrollTop = box.scrollHeight;
}

function renderModalState() {
  const warning = qs("ghub-support-profile-warning");
  const chat = qs("ghub-support-chat-area");

  const hasProfile = !!state.profile?.profileId;

  if (warning) warning.classList.toggle("hidden", hasProfile);
  if (chat) chat.classList.toggle("hidden", !hasProfile);

  if (hasProfile) {
    renderProfileInfo();
    renderMessages();
  }

  renderBadge();
  refreshIcons();
}

async function openModal() {
  ensureShell();
  state.modalOpen = true;

  const modal = qs("ghub-support-modal");
  if (modal) modal.classList.remove("hidden");

  if (!state.profileLoaded) {
    await resolveProfile(false);
    if (state.profile?.profileId) startMessageListener();
  }

  renderModalState();

  if (state.profile?.profileId && state.unreadCount > 0) {
    await markSupportMessagesAsRead();
  }
}

function closeModal() {
  state.modalOpen = false;
  qs("ghub-support-modal")?.classList.add("hidden");
}

async function ensureProfileReady() {
  if (state.profile?.profileId) return state.profile;

  const profile = await resolveProfile(true);
  if (!profile?.profileId) {
    renderModalState();
    showToast("error", "Configure seu perfil com o ID do jogo antes de falar com o suporte.");
    return null;
  }

  startMessageListener();
  renderModalState();
  return profile;
}

function getChatDocRef() {
  const profileId = state.profile?.profileId;
  if (!profileId) return null;
  return doc(db, "mensagem", profileId);
}

function getMessagesCollectionRef() {
  const profileId = state.profile?.profileId;
  if (!profileId) return null;
  return collection(db, "mensagem", profileId, "mensagens");
}

function startMessageListener() {
  if (state.unsubMessages || !state.profile?.profileId) return;

  const colRef = getMessagesCollectionRef();
  if (!colRef) return;

  const q = query(colRef, orderBy("createdAtMs", "asc"));
  state.unsubMessages = onSnapshot(q, (snap) => {
    state.messages = snap.docs.map((d) => ({
      id: d.id,
      ref: d.ref,
      ...(d.data() || {})
    }));

    const unread = state.messages.filter((msg) => msg.from !== "user" && msg.readByUser !== true).length;
    state.unreadCount = unread;
    writeChatCache({
      chatOpen: state.messages.length > 0,
      unreadCount: unread
    });

    renderBadge();

    if (state.modalOpen) {
      renderMessages();
      if (unread > 0) markSupportMessagesAsRead();
    }
  }, () => {
    // Não bloqueia a tela se a regra do Firestore ainda não estiver liberada.
  });
}

async function createChatDocIfNeeded(firstText) {
  const profile = state.profile;
  const ref = getChatDocRef();
  if (!profile || !ref) throw new Error("Perfil não encontrado.");

  await setDoc(ref, {
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
      uid: profile.uid,
      email: profile.email,
      guildId: profile.guildId,
      guildName: profile.guildName,
      role: profile.role,
      createdAtText: formatDate(profile.createdAt)
    },
    status: "aberto",
    lastMessage: String(firstText || "").slice(0, 180),
    lastMessageFrom: "user",
    unreadUser: 0,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    lastMessageAt: serverTimestamp(),
    lastMessageAtMs: Date.now()
  }, { merge: true });

  writeChatCache({ chatOpen: true });
}

async function sendSupportMessage(event) {
  event.preventDefault();

  const profile = await ensureProfileReady();
  if (!profile) return;

  const input = qs("ghub-support-text");
  const btn = qs("ghub-support-send");
  const text = String(input?.value || "").trim();

  if (!text) {
    showToast("error", "Digite uma mensagem antes de enviar.");
    return;
  }

  if (text.length > 700) {
    showToast("error", "Mensagem muito grande. Use até 700 caracteres.");
    return;
  }

  const originalHtml = btn?.innerHTML || "";
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<i data-lucide="loader-2" class="w-4 h-4 animate-spin"></i> Enviando...';
    refreshIcons();
  }

  try {
    await createChatDocIfNeeded(text);

    const colRef = getMessagesCollectionRef();
    await addDoc(colRef, {
      from: "user",
      uid: profile.uid,
      profileId: profile.profileId,
      guildId: profile.guildId,
      text,
      readByUser: true,
      createdAt: serverTimestamp(),
      createdAtMs: Date.now()
    });

    await setDoc(getChatDocRef(), {
      status: "aberto",
      lastMessage: text.slice(0, 180),
      lastMessageFrom: "user",
      updatedAt: serverTimestamp(),
      lastMessageAt: serverTimestamp(),
      lastMessageAtMs: Date.now()
    }, { merge: true });

    if (input) input.value = "";
    showToast("success", "Mensagem enviada ao suporte.");
  } catch (error) {
    console.error(error);
    showToast("error", "Não foi possível enviar a mensagem.");
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = originalHtml || '<i data-lucide="send" class="w-4 h-4"></i> Enviar';
      refreshIcons();
    }
  }
}

async function markSupportMessagesAsRead() {
  const unread = state.messages.filter((msg) => msg.from !== "user" && msg.readByUser !== true && msg.ref);
  if (!unread.length) return;

  try {
    const batch = writeBatch(db);
    unread.slice(0, 450).forEach((msg) => {
      batch.set(msg.ref, {
        readByUser: true,
        readByUserAt: serverTimestamp()
      }, { merge: true });
    });
    await batch.commit();

    state.unreadCount = 0;
    writeChatCache({ unreadCount: 0, chatOpen: true });
    renderBadge();
  } catch (_) {}
}

async function deleteSupportChat() {
  const profile = await ensureProfileReady();
  if (!profile) return;

  const ok = window.confirm("Fechar este chat vai apagar todo o histórico deste atendimento. Deseja continuar?");
  if (!ok) return;

  const btn = qs("ghub-support-delete-chat");
  const originalHtml = btn?.innerHTML || "";

  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<i data-lucide="loader-2" class="w-4 h-4 animate-spin"></i> Fechando...';
    refreshIcons();
  }

  try {
    const colRef = getMessagesCollectionRef();
    const snap = await getDocs(colRef);

    let batch = writeBatch(db);
    let count = 0;

    snap.docs.forEach((docSnap) => {
      batch.delete(docSnap.ref);
      count += 1;

      if (count >= 450) {
        // Evita estourar o limite do batch.
        // O próximo lote será criado após commit abaixo.
      }
    });

    batch.delete(getChatDocRef());
    await batch.commit();

    state.messages = [];
    state.unreadCount = 0;
    writeChatCache({ chatOpen: false, unreadCount: 0 });

    renderModalState();
    showToast("success", "Chat fechado e histórico apagado.");
  } catch (error) {
    console.error(error);
    showToast("error", "Não foi possível fechar o chat.");
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = originalHtml || '<i data-lucide="trash-2" class="w-4 h-4"></i> Fechar chat';
      refreshIcons();
    }
  }
}

function applyCachedBadge() {
  const uid = state.user?.uid;
  if (!uid) return;
  const cached = readChatCache(uid);
  state.unreadCount = cached.unreadCount || 0;
  renderBadge();
}

function bootSupport() {
  ensureShell();

  onAuthStateChanged(auth, async (user) => {
    state.user = user || null;

    if (!user) {
      if (state.unsubMessages) {
        try { state.unsubMessages(); } catch (_) {}
      }
      state.unsubMessages = null;
      state.profile = null;
      state.profileLoaded = false;
      state.messages = [];
      state.unreadCount = 0;
      renderBadge();
      return;
    }

    applyCachedBadge();

    const profile = await resolveProfile(false);
    if (profile?.profileId) {
      startMessageListener();
    }

    renderBadge();
  });
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", bootSupport, { once: true });
} else {
  bootSupport();
}
