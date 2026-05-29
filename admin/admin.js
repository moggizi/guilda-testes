import { checkAuth, setupSidebar, initIcons, showToast, logout, auth, db, getGuildContext, ensureUserAccount, cleanupFailedUserAccount, createPlayer_DISABLED_BETAAccess, revokePlayerAccess, deletePlayerAccount } from "../logic.js";
    import { doc, getDoc, setDoc, serverTimestamp, onSnapshot } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";


// Protecao instantanea migrada de admin-module-1.js
try {
  const ctx = getGuildContext();
  if (ctx && ctx.role === 'Admin') {
    window.location.replace('../dashboard/dashboard.html');
  }
} catch (_) {}

    setupSidebar();
    initIcons();

    function tierRank(t){
      const s = (t||'free').toString().toLowerCase().trim();
      if (s === 'vitalicio' || s === 'vitalício' || s.includes('vital') || s.includes('life')) return 2;
      if (s === 'pro' || s === 'business' || s.includes('business') || s.includes('buss')) return 2;
      if (s === 'plus' || s.includes('plus')) return 1;
      return 0;
    }

    function applyVipUI(tier){
      const vipLabel = document.getElementById('vip-label');
      if (vipLabel) vipLabel.innerHTML = `Guilda: <span class="font-bold text-gray-800 uppercase">${tier}</span>`;

      const needPlus = tierRank(tier) >= 1;
      ['btn-add-admin','btn-add-leader'].forEach(id => {
        const b = document.getElementById(id);
        if (b && (!needPlus || permissoesAtivas === false)) {
          b.disabled = true;
          b.classList.add('opacity-50','cursor-not-allowed');
          b.title = 'Recurso PLUS';
        }
      });
    }

    document.getElementById('player-email')?.addEventListener('input', (e) => {
      const v = (e.target?.value || '').trim().toLowerCase();
      const p = document.getElementById('player-email-preview');
      if (p) p.textContent = v || getPlayerEmailForGuild();
    });
    
    let securityData = { admins: [], leaders: [] };
    let permissoesAtivas = true;
    let unsubCfg = null;
    let hasLoadedFromCache = false;

    const guildCacheKey = () => {
      const ctx = getGuildContext();
      return `securityConfig_${ctx?.guildId || "unknown"}`;
    };

    let currentEmail = '';
    try {
      const ctx = getGuildContext();
      currentEmail = String(ctx?.email || '').toLowerCase().trim();
    } catch (_) {}

    // --- CARREGAMENTO INSTANTÂNEO DO CACHE ---
    try {
      const cachedSec = localStorage.getItem(guildCacheKey());
      if (cachedSec) {
        securityData = JSON.parse(cachedSec) || securityData;
        permissoesAtivas = (securityData.permissoesAtivas !== false);
        renderPlayerAccess(securityData.playerEmail);
        renderList('admins', securityData.admins || []);
        renderList('leaders', securityData.leaders || []);
        hasLoadedFromCache = true;
      }
    } catch (_) {}

    document.getElementById('btn-logout')?.addEventListener('click', logout);

    checkAuth().then(async (user) => {
      if(!user) return;
      try {
        const ctx0 = getGuildContext();
        applyVipUI(ctx0?.vipTier || 'free');
        currentEmail = String(user?.email || '').toLowerCase().trim();
      } catch (_) {}
      
      // Sempre acompanha em tempo real (igual o plano)
      startRealtime();

      // Só carrega do Firebase se não achou cache (fallback)
      if (!hasLoadedFromCache) {
        await load();
      }
    });

    async function load() {
      try {
        const snap = await getDoc(doc(db, "configGuilda", getGuildContext().guildId));
        const newData = snap.exists() ? (snap.data() || {}) : {};
        newData.admins = Array.isArray(newData.admins) ? newData.admins : [];
        newData.leaders = Array.isArray(newData.leaders) ? newData.leaders : [];
        newData.playerEmail = (newData.playerEmail || "").toString().toLowerCase().trim() || null;
        
        renderPlayerAccess(newData.playerEmail);
        securityData = newData;
        localStorage.setItem(guildCacheKey(), JSON.stringify(newData));
        renderList('admins', securityData.admins);
        renderList('leaders', securityData.leaders);
      } catch (e) {
        showToast('error', 'Erro ao carregar configurações.');
      }
    }


function startRealtime() {
  try {
    if (unsubCfg) return; // já rodando
    const gid = getGuildContext()?.guildId;
    if (!gid) return;

    unsubCfg = onSnapshot(doc(db, "configGuilda", gid), (snap) => {
      if (!snap.exists()) return;

      const data = snap.data() || {};
      const newData = {
        ...data,
        admins: Array.isArray(data.admins) ? data.admins : [],
        leaders: Array.isArray(data.leaders) ? data.leaders : [],
        playerEmail: (data.playerEmail || "").toString().toLowerCase().trim() || null,
        permissoesAtivas: (data.permissoesAtivas !== false)
      };

      permissoesAtivas = newData.permissoesAtivas;
      securityData = newData;

      renderPlayerAccess(newData.playerEmail);
      renderList('admins', newData.admins || []);
      renderList('leaders', newData.leaders || []);

      try { localStorage.setItem(guildCacheKey(), JSON.stringify(newData)); } catch (_) {}
    }, (err) => {
      // não quebra a tela
    });
  } catch (_) {}
}


    function renderList(type, list) {
      const ul = document.getElementById(`list-${type}`);
      ul.innerHTML = "";
      if (!list || list.length === 0) {
        ul.innerHTML = "<li class='text-sm text-gray-300 italic'>Nenhum usuário</li>";
        return;
      }
      const masterLeader = (type === 'leaders') ? String(list[0] || '').toLowerCase().trim() : '';
      list.forEach((email) => {
        const clean = String(email || '').toLowerCase().trim();
        const isMaster = type === 'leaders' && clean === masterLeader;
        const isSelf = clean === currentEmail;
        const li = document.createElement('li');
        li.className = "flex justify-between items-center bg-gray-50 p-3 rounded-xl text-sm border animate-in";
        li.innerHTML = `
          <span class="truncate pr-2 flex items-center gap-2">
            <span class="truncate">${email}</span>
            ${isMaster ? `<span class="text-[10px] px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 font-bold">Líder Master</span>` : ''}
            ${(!isMaster && isSelf) ? `<span class="text-[10px] px-2 py-0.5 rounded-full bg-gray-100 text-gray-600 font-semibold">Você</span>` : ''}
            ${(!permissoesAtivas && !isMaster) ? `<span class="text-[10px] px-2 py-0.5 rounded-full bg-rose-50 text-rose-700 ring-1 ring-rose-200 font-extrabold">Sem acesso</span>` : ''}
          </span>
          <button class="btn-remove text-red-400 hover:text-red-600 ${isMaster ? 'opacity-40 cursor-not-allowed' : ''}" data-type="${type}" data-email="${email}" ${isMaster ? 'disabled' : ''}>
            <i data-lucide="trash-2" class="w-4 h-4"></i>
          </button>
        `;
        ul.appendChild(li);
      });
      ul.querySelectorAll('.btn-remove').forEach(btn => {
        btn.onclick = () => removeAccess(btn.dataset.type, btn.dataset.email);
      });
      initIcons();
    }

    function getPlayerEmailForGuild() {
      return `jogador.${getGuildContext()?.guildId || 'id'}@guildahub.app`.toLowerCase();
    }

    function renderPlayerAccess(email) {
      if (email) {
        document.getElementById('player-create-box').classList.add('hidden');
        document.getElementById('player-manage-box').classList.remove('hidden');
        document.getElementById('player-email-active').textContent = email;
      } else {
        document.getElementById('player-manage-box').classList.add('hidden');
        document.getElementById('player-create-box').classList.remove('hidden');
        document.getElementById('player-email-preview').textContent = getPlayerEmailForGuild();
      }
    }

    // Botões desativados de jogador não farão nada
    document.getElementById('btn-create-player-disabled-beta')?.addEventListener('click', async () => {
      showToast('info', 'Em breve! Este recurso ainda está em desenvolvimento.');
    });

    const ACCESS_PASSWORD_RE = /^[A-Za-z0-9?.!#@_]{6,}$/;
    let pendingAccessType = null;
    let accessSubmitting = false;

    const accessModal = document.getElementById('access-modal');
    const accessForm = document.getElementById('access-form');
    const accessEmailInput = document.getElementById('access-email');
    const accessPassInput = document.getElementById('access-pass');
    const accessSubmitBtn = document.getElementById('access-submit');
    const accessModalTitle = document.getElementById('access-modal-title');
    const accessModalSubtitle = document.getElementById('access-modal-subtitle');
    const accessModalInstructions = document.getElementById('access-modal-instructions');

    function cleanAccessEmail(value) {
      return String(value || '').toLowerCase().trim();
    }

    function normalizeAccessList(list) {
      const out = [];
      const seen = new Set();
      (Array.isArray(list) ? list : []).forEach((item) => {
        const email = cleanAccessEmail(item);
        if (!email || seen.has(email)) return;
        seen.add(email);
        out.push(email);
      });
      return out;
    }

    function accessRoleLabel(type) {
      return type === 'leaders' ? 'Líder' : 'Admin';
    }

    function emailAlreadyHasAccess(email) {
      const all = [
        ...normalizeAccessList(securityData.admins),
        ...normalizeAccessList(securityData.leaders)
      ];
      return all.includes(cleanAccessEmail(email));
    }

    function setAccessSubmitting(isLoading) {
      accessSubmitting = !!isLoading;
      if (accessSubmitBtn) {
        accessSubmitBtn.disabled = accessSubmitting;
        accessSubmitBtn.classList.toggle('opacity-70', accessSubmitting);
        accessSubmitBtn.classList.toggle('cursor-not-allowed', accessSubmitting);
        accessSubmitBtn.textContent = accessSubmitting ? 'Criando conta...' : 'Criar e liberar acesso';
      }
      if (accessEmailInput) accessEmailInput.disabled = accessSubmitting;
      if (accessPassInput) accessPassInput.disabled = accessSubmitting;
      document.getElementById('access-cancel')?.classList.toggle('pointer-events-none', accessSubmitting);
      document.getElementById('access-modal-close')?.classList.toggle('pointer-events-none', accessSubmitting);
    }

    function openAccessModal(type) {
      pendingAccessType = type;
      const role = accessRoleLabel(type);
      if (accessModalTitle) accessModalTitle.textContent = `Adicionar ${role}`;
      if (accessModalSubtitle) accessModalSubtitle.textContent = `Crie uma conta de ${role} e libere o acesso para esta guilda.`;
      if (accessModalInstructions) accessModalInstructions.textContent = `Informe um e-mail que ainda não tenha conta e defina uma senha para criar o acesso de ${role}.`;
      if (accessForm) accessForm.reset();
      setAccessSubmitting(false);
      accessModal?.classList.remove('hidden');
      accessModal?.setAttribute('aria-hidden', 'false');
      document.body.classList.add('overflow-hidden');
      setTimeout(() => accessEmailInput?.focus(), 50);
      try { initIcons(); } catch (_) {}
    }

    function closeAccessModal(force = false) {
      if (accessSubmitting && !force) return;
      accessModal?.classList.add('hidden');
      accessModal?.setAttribute('aria-hidden', 'true');
      document.body.classList.remove('overflow-hidden');
      pendingAccessType = null;
    }

    function friendlyAccessError(error) {
      const msg = String(error?.message || error || '').trim();
      const code = String(error?.code || '').trim();
      if (code.includes('email-already-in-use') || code.includes('account-exists') || msg.toLowerCase().includes('já possui conta') || msg.toLowerCase().includes('já existe')) {
        return 'Esse e-mail já possui uma conta. Use outro e-mail para criar o acesso.';
      }
      if (code.includes('invalid-email') || msg.toLowerCase().includes('e-mail inválido')) return 'Informe um e-mail válido.';
      if (code.includes('weak-password') || msg.toLowerCase().includes('senha')) return 'Senha inválida. Use mínimo 6 caracteres, sem espaços, apenas letras, números e ? . ! # @ _.';
      return msg || 'Erro ao adicionar acesso.';
    }

    document.getElementById('btn-add-admin')?.addEventListener('click', () => openAccessModal('admins'));
    document.getElementById('btn-add-leader')?.addEventListener('click', () => openAccessModal('leaders'));
    document.getElementById('access-modal-close')?.addEventListener('click', () => closeAccessModal());
    document.getElementById('access-cancel')?.addEventListener('click', () => closeAccessModal());
    document.getElementById('access-modal-backdrop')?.addEventListener('click', () => closeAccessModal());
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !accessModal?.classList.contains('hidden')) closeAccessModal();
    });

    accessForm?.addEventListener('submit', async (event) => {
      event.preventDefault();
      await addAccess(pendingAccessType);
    });

    async function addAccess(type) {
      if (!type || !['admins', 'leaders'].includes(type)) return;
      if (accessSubmitting) return;

      const cleanEmail = cleanAccessEmail(accessEmailInput?.value);
      const pass = String(accessPassInput?.value || '');

      if (!cleanEmail || !cleanEmail.includes('@')) return showToast('error', 'Informe um e-mail válido.');
      if (emailAlreadyHasAccess(cleanEmail)) return showToast('info', 'Esse e-mail já está na lista de acesso desta guilda.');
      if (!ACCESS_PASSWORD_RE.test(pass)) {
        return showToast('error', 'Senha inválida. Use mínimo 6 caracteres, sem espaços, apenas letras, números e ? . ! # @ _.');
      }

      const role = accessRoleLabel(type);
      let createdAccount = null;
      let cleanupDone = false;
      setAccessSubmitting(true);

      try {
        createdAccount = await ensureUserAccount(cleanEmail, pass, { guildId: getGuildContext().guildId, role });

        if (!createdAccount?.created) {
          throw new Error('Esse e-mail já possui uma conta. Use outro e-mail para criar o acesso.');
        }

        const previousList = normalizeAccessList(securityData[type]);
        securityData[type] = normalizeAccessList([...previousList, cleanEmail]);
        renderList(type, securityData[type]);

        try {
          await saveSecurity();
        } catch (saveError) {
          securityData[type] = previousList;
          renderList(type, securityData[type]);
          try { localStorage.setItem(guildCacheKey(), JSON.stringify(securityData)); } catch (_) {}
          if (createdAccount?.cleanupToken) {
            await cleanupFailedUserAccount(createdAccount.cleanupToken, {
              reason: 'admin-access-save-failed',
              uid: createdAccount.uid
            });
            cleanupDone = true;
          }
          throw saveError;
        }

        closeAccessModal(true);
        showToast('success', `Conta de ${role} criada e acesso liberado.`);
      } catch (e) {
        showToast('error', friendlyAccessError(e));
        if (createdAccount?.cleanupToken && !cleanupDone) {
          try {
            await cleanupFailedUserAccount(createdAccount.cleanupToken, {
              reason: 'admin-access-create-failed',
              uid: createdAccount.uid
            });
          } catch (_) {}
        }
        load();
      } finally {
        setAccessSubmitting(false);
      }
    }

    async function removeAccess(type, email) {
      const cleanEmail = cleanAccessEmail(email);
      if (type === 'leaders' && cleanAccessEmail(securityData.leaders[0]) === cleanEmail) return showToast('info', 'O Líder Master não pode ser removido.');
      if (!confirm(`Remover acesso de ${cleanEmail || email}?`)) return;

      // Remove só da lista da guilda. Não procura em /users aqui para evitar leituras.
      // A própria conta removida será rebaixada automaticamente no próximo login/checkAuth.
      securityData[type] = normalizeAccessList(securityData[type]).filter(e => cleanAccessEmail(e) !== cleanEmail);
      renderList(type, securityData[type]);
      await saveSecurity();
      showToast('success', 'Acesso removido.');
    }

    async function saveSecurity() {
      securityData.admins = normalizeAccessList(securityData.admins);
      securityData.leaders = normalizeAccessList(securityData.leaders);

      // Salva no cache instantaneamente
      localStorage.setItem(guildCacheKey(), JSON.stringify(securityData));
      
      // Salva no Firebase
      await setDoc(doc(db, 'configGuilda', getGuildContext().guildId), {
        admins: securityData.admins || [],
        leaders: securityData.leaders || [],
        updatedAt: serverTimestamp()
      }, { merge: true });
    }