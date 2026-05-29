import { db, setupSidebar, initIcons } from '../logic.js';
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

setupSidebar();
initIcons();
const __sbClose = document.getElementById('sidebar-close');
__sbClose?.addEventListener('click', () => {
  document.getElementById('sidebar')?.classList.add('-translate-x-full');
  document.getElementById('sidebar-overlay')?.classList.add('hidden');
});


const elGuildId = document.getElementById('guildId');
const elMemberId = document.getElementById('memberId');
const elBtn = document.getElementById('btn');
const elOut = document.getElementById('result');
const elHint = document.getElementById('hint');

const norm = (v) => (v == null ? '' : String(v)).toLowerCase().trim();
const safeStr = (v) => (v == null ? '' : String(v));

function card(html) {
  elOut.innerHTML = `<div class="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">${html}</div>`;
}

function escapeHtml(s) {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

async function findMemberDirect(guildId, memberId) {
  const gid = (guildId || '').trim();
  const mid = (memberId || '').trim();
  if (!gid || !mid) return null;

  try {
    const snap = await getDoc(doc(db, "guildas", gid, "membros", mid));
    if (!snap.exists()) return null;
    const d = snap.data() || {};
    // evita 2ª leitura: tenta usar nome salvo no próprio membro
    const gname = (d.guildName || d.guildaNome || d.guilda || "").toString().trim() || "Guilda";
    return { guildId: gid, guildName: gname, id: snap.id, data: d };
  } catch (_) {
    return null;
  }
}

function renderMember(res) {
  const d = res.data || {};
  const guildName = safeStr(res.guildName || d.guildName || "Guilda");
  const nick = safeStr(d.nick || d.nickname || d.nome || d.name || "—");

  // ✅ ID do jogador (pelo seu Firestore: visibleId)
  const playerId = safeStr(
    d.visibleId || d.playerId || d.idJogador || d.idPlayer || d.idJogo || d.idDoJogo ||
    d.gameId || d.idff || d.idFF || d.freeFireId || d.ffId || d.idFreeFire || res.id || "—"
  );

  const playModeRaw = d.playMode;
  const playMode = (playModeRaw == null || String(playModeRaw).trim() === '') ? '—' : String(playModeRaw).trim();

  const hasTag = (d.hasTag === true) || !!(d.tag && String(d.tag).trim());
  const guildWarOk = (d.guildWar === true);
  const weeklyOk = (d.weeklyMeta === true);

  const guildWarMeta = (d.guildWarMeta != null ? String(d.guildWarMeta) : "");
  const weeklyMetaValue = (d.weeklyMetaValue != null ? String(d.weeklyMetaValue) : "");

  const yesNoPill = (ok) =>
    ok
      ? `<span class="inline-flex items-center rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-black text-emerald-700 ring-1 ring-emerald-100">Sim</span>`
      : `<span class="inline-flex items-center rounded-full bg-slate-100 px-2.5 py-1 text-xs font-black text-slate-700 ring-1 ring-slate-200">Não</span>`;

  card(`
    <div class="flex items-start justify-between gap-3">
      <div class="min-w-0">
        <div class="text-lg font-black text-slate-900 truncate">${escapeHtml(nick)}</div>
        <div class="mt-1 text-xs text-slate-500">Guilda: <span class="font-semibold">${escapeHtml(guildName)}</span></div>
        <div class="mt-1 text-sm text-slate-700">ID do jogador: <span class="font-extrabold">${escapeHtml(playerId)}</span></div>
      </div>
      <div class="h-11 w-11 rounded-2xl bg-emerald-600 text-white grid place-items-center shadow-sm shrink-0">
        <i data-lucide="user" class="h-5 w-5"></i>
      </div>
    </div>

    <div class="mt-5 grid gap-3 sm:grid-cols-2">
      <div class="rounded-2xl border border-slate-200 bg-white p-4">
        <div class="text-xs text-slate-500">Tem tag?</div>
        <div class="mt-2">${yesNoPill(hasTag)}</div>
      </div>

      <div class="rounded-2xl border border-slate-200 bg-white p-4">
        <div class="text-xs text-slate-500">Modo de jogo</div>
        <div class="mt-2">
          <span class="inline-flex items-center rounded-full bg-white px-2.5 py-1 text-xs font-black text-slate-800 ring-1 ring-slate-200">${escapeHtml(playMode)}</span>
        </div>
      </div>

      <div class="rounded-2xl border border-slate-200 bg-white p-4">
        <div class="text-xs text-slate-500">Bateu meta de guerra?</div>
        <div class="mt-2 flex items-center gap-2">
          ${yesNoPill(guildWarOk)}
          ${guildWarMeta ? `<span class="text-xs text-slate-500">Meta: <span class="font-bold text-slate-700">${escapeHtml(guildWarMeta)}</span></span>` : ``}
        </div>
      </div>

      <div class="rounded-2xl border border-slate-200 bg-white p-4 sm:col-span-2">
        <div class="text-xs text-slate-500">Bateu meta semanal?</div>
        <div class="mt-2 flex items-center gap-2">
          ${yesNoPill(weeklyOk)}
          ${weeklyMetaValue ? `<span class="text-xs text-slate-500">Meta: <span class="font-bold text-slate-700">${escapeHtml(weeklyMetaValue)}</span></span>` : ``}
        </div>
      </div>
    </div>

    <div class="mt-4 text-xs text-slate-500">
      Observação: O nick que aparece aqui é o nick que o seu lider da guilda cadastrou em nossa plataforma.
    </div>
  `);

  try { initIcons(); } catch (_) {}
}


async function run() {
  const gid = (elGuildId?.value || "").trim();
  const mid = (elMemberId?.value || "").trim();

  if (!gid || !mid) {
    elHint.textContent = "Preencha UID da guilda e ID do membro.";
    return;
  }

  elHint.textContent = "Buscando…";
  elOut.innerHTML = `<div class="rounded-3xl border border-slate-200 bg-white p-5 text-slate-600">Carregando…</div>`;
  try {
    const res = await findMemberDirect(gid, mid);
    if (!res) {
      elHint.textContent = "Não encontrei esse jogador ainda.";
      elOut.innerHTML = `<div class="rounded-3xl border border-slate-200 bg-white p-5 text-slate-600">Nada encontrado.</div>`;
      return;
    }
    elHint.textContent = "";
    renderMember(res);
  } catch (e) {
    console.error(e);
    elHint.textContent = "Erro ao buscar. Abra o console.";
    elOut.innerHTML = `<div class="rounded-3xl border border-red-200 bg-red-50 p-5 text-red-800">Erro ao buscar.</div>`;
  }
}

elBtn?.addEventListener('click', run);
elGuildId?.addEventListener('keydown', (e)=>{ if(e.key==='Enter') run(); });
elMemberId?.addEventListener('keydown', (e)=>{ if(e.key==='Enter') run(); });

// Sidebar publico migrado de stats-inline-2.js
(function(){
  const openBtn = document.getElementById('sidebar-open');
  const closeBtn = document.getElementById('sidebar-close');
  const overlay = document.getElementById('sidebar-overlay');
  const sidebar = document.getElementById('sidebar');
  function open(){
    overlay.classList.remove('hidden');
    sidebar.classList.remove('-translate-x-full');
    document.body.style.overflow='hidden';
  }
  function close(){
    overlay.classList.add('hidden');
    sidebar.classList.add('-translate-x-full');
    document.body.style.overflow='';
  }
  if(openBtn) openBtn.addEventListener('click', open);
  if(closeBtn) closeBtn.addEventListener('click', close);
  if(overlay) overlay.addEventListener('click', close);
  document.addEventListener('keydown', (e)=>{ if(e.key==='Escape') close(); });
})();

// Icones migrados de stats-inline-3.js
lucide.createIcons();
