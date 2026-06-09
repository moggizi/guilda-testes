import { checkAuth, setupSidebar, initIcons, logout, db, ensureCeoStatus, applyCeoNavVisibility, showToast, getVipTier } from '../logic.js';
    import { collection, getDocs, getDoc, doc, updateDoc, deleteDoc, deleteField, writeBatch, query, where, serverTimestamp, setDoc, runTransaction } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

    setupSidebar();

    // Normalização
    function normalizeVip(v) {
      const s = (v || 'free').toString().toLowerCase().trim();
      if (s.includes('vital') || s.includes('life') || s.includes('parceiro') || s.includes('partner')) return 'parceiro';
      if (s.includes('ultra')) return 'ultra';
      if (s.includes('buss') || s.includes('business')) return 'business';
      if (s.includes('pro')) return 'pro';
      if (s.includes('plus')) return 'plus';
      return s || 'free';
    }

    function prettyVipName(v) {
      const t = normalizeVip(v);
      return t.toUpperCase();
    }

    function vipDurationDays(tier) {
      const t = normalizeVip(tier);
      if (t === 'plus' || t === 'pro' || t === 'ultra') return 30;
      if (t === 'business') return 365;
      if (t === 'parceiro') return null;
      return null;
    }
    
    function buildVipExpiresAt(tier) {
      const days = vipDurationDays(tier);
      if (!days) return null;
      return Date.now() + days * 24 * 60 * 60 * 1000;
    }

    function fmtDate(ts) {
      if(!ts) return '—';
      const d = ts.toMillis ? new Date(ts.toMillis()) : new Date(ts);
      return d.toLocaleDateString('pt-BR', { day:'2-digit', month:'2-digit', year:'numeric', hour:'2-digit', minute:'2-digit'});
    }

    function vipExpiresAtMsFromAny(v) {
      if (v == null) return null;
      if (typeof v === 'number' && isFinite(v)) return v;
      if (typeof v === 'string' && v.trim() !== '' && isFinite(Number(v))) return Number(v);
      if (v && typeof v.toMillis === 'function') return v.toMillis();
      if (v && typeof v.seconds === 'number') return v.seconds * 1000;
      return null;
    }

    function remainingTag(expiresAtMs, tier) {
      const t = normalizeVip(tier);
      if (t === 'parceiro') return { text: 'Parceiro ativo', cls: 'bg-amber-100 text-amber-700' };

      const ms = vipExpiresAtMsFromAny(expiresAtMs);
      if (!ms) return { text: (t === 'free' ? 'FREE' : 'Sem expiração'), cls: 'bg-gray-100 text-gray-600' };

      const diff = ms - Date.now();
      if (diff <= 0) return { text: 'Expirado', cls: 'bg-red-100 text-red-700' };

      const days = Math.ceil(diff / (24 * 60 * 60 * 1000));
      if (days <= 3) return { text: `Faltam ${days}d`, cls: 'bg-orange-100 text-orange-700' };
      return { text: `Faltam ${days}d`, cls: 'bg-sky-100 text-sky-700' };
    }

    function vipBadgeClass(tier) {
      const t = normalizeVip(tier);
      if (t === 'parceiro') return 'bg-amber-100 text-amber-700';
      if (t === 'ultra') return 'bg-fuchsia-100 text-fuchsia-700';
      if (t === 'business') return 'bg-purple-100 text-purple-700';
      if (t === 'pro') return 'bg-blue-100 text-blue-700';
      if (t === 'plus') return 'bg-emerald-50 text-emerald-700';
      return 'bg-gray-100 text-gray-600';
    }

    function normalizeMemberCount(v) {
      const n = Number(v);
      if (!Number.isFinite(n) || n < 0) return 0;
      return Math.floor(n);
    }

    function toTimestampMs(v) {
      if (v == null) return null;
      if (typeof v === 'number' && Number.isFinite(v)) return v;
      if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) return Number(v);
      if (v && typeof v.toMillis === 'function') return v.toMillis();
      if (v && typeof v.seconds === 'number') return v.seconds * 1000;
      const parsed = new Date(v).getTime();
      return Number.isFinite(parsed) ? parsed : null;
    }

    function updatedDaysAgo(v) {
      const ms = toTimestampMs(v);
      if (ms == null) return null;

      const now = new Date();
      const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
      const d = new Date(ms);
      const dateStart = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
      const diff = Math.floor((todayStart - dateStart) / 86400000);

      return diff >= 0 ? diff : null;
    }

    function matchesUpdatedFilter(v, filterValue) {
      const f = (filterValue || 'all').toString();
      if (f === 'all') return true;

      const days = updatedDaysAgo(v);
      if (days == null) return false;
      if (f === 'today') return days === 0;
      if (f === 'yesterday') return days === 1;
      if (f === 'd2') return days >= 2 && days <= 6;
      if (f === 'd7') return days >= 7 && days <= 14;
      if (f === 'd15') return days >= 15 && days <= 29;
      if (f === 'd30') return days >= 30;
      return true;
    }

    let allGuilds = [];
    let allPartners = [];
    let currentAdminView = 'guildas';
    let ceoSessionUser = null;
    const adminViewRendered = { guildas: false, partners: false, plans: false };
    const adminViewSearch = { guildas: '', partners: '', plans: '' };
    let partnerCommissionHydrationPromise = null;
    let financePartnerDataDirty = false;
    window.allSolicita = [];
    window.allPartners = [];

    const AVISOS_CACHE_KEY = 'chefe_avisos_cache_v1';
    const AVISOS_CACHE_TTL_MS = 12 * 60 * 60 * 1000;
    const AVISOS_DOCS = [
      { id: 'geral', label: 'Geral', desc: 'Aparece para todos: dashboard e jogador.' },
      { id: 'guilda', label: 'Guilda', desc: 'Aparece no dashboard das guildas.' },
      { id: 'jogador', label: 'Jogador', desc: 'Aparece na tela do jogador.' }
    ];
    let avisosState = {};
    let allPlansAdmin = [];
    let allPlanAddonsAdmin = [];
    const SYSTEM_PLAN_IDS = ['free', 'plus', 'pro', 'business', 'ultra', 'parceiro'];
    const PLANS_ADMIN_CACHE_KEY = 'hub_ceo_plans_v2';
    const FINANCE_CACHE_KEY = 'hub_ceo_finance_v1';
    const LIST_CACHE_TTL_MS = 60 * 60 * 1000;
    const FINANCE_CACHE_TTL_MS = LIST_CACHE_TTL_MS;
    const TRANSACTION_FEE_RATE = 0.0099;
    const SELECT_UI_CLASS = 'appearance-none rounded-xl border border-gray-200 bg-white px-3 py-2 pr-8 text-[11px] font-black text-gray-700 shadow-sm outline-none transition focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100';
    const FINANCE_UNKNOWN_MONTH = 'sem-data';
    const RECRUITMENT_DETAIL_CACHE_PREFIX = 'hub_ceo_recruitment_detail_v1_';
    const RECRUITMENT_DETAIL_CACHE_TTL_MS = 60 * 60 * 1000;
    const RECRUITMENT_ROOT_COLLECTION = 'recrutamento';
    const RECRUITMENT_ITEMS_COLLECTION = 'itens';
    const RECRUITMENT_STATUSES = ['ativo', 'inativo'];
    const GUILD_SUBCOLLECTIONS = ['membros', 'membros2', 'membros3', 'membros4', 'lines', 'lines2', 'lines3', 'lines4', 'campeonatos', 'historico'];
    let lastFinanceSolicitaDocs = [];

    const PLAN_ADMIN_DEFAULTS = [
      { id: 'free', name: 'FREE', price: 0, period: 'monthly', order: 0, active: true, visible: true, purchasable: false, access: ['Dashboard', 'Membros', 'Configuração de tag'], noAccess: ['Administradores + Líderes', 'Lines', 'Estatísticas'] },
      { id: 'plus', name: 'PLUS', price: 6.99, period: 'monthly', order: 10, active: true, visible: true, purchasable: true, access: ['Dashboard', 'Membros', 'Configuração de tag', 'Administradores + Líderes', 'Lines', 'Estatísticas'], noAccess: ['Recrutamento', 'Multi-guilda', 'Atualizar pontos por print'] },
      { id: 'pro', name: 'PRO', price: 9.99, period: 'monthly', order: 20, active: true, visible: true, purchasable: true, popular: true, badge: 'Popular', access: ['Tudo do PLUS', 'Recrutamento', 'Multi-guilda', 'Atualizar pontos por print'], noAccess: [] },
      { id: 'business', sourceId: 'bussines', name: 'BUSINESS', price: 99.9, period: 'yearly', order: 30, active: true, visible: true, purchasable: true, access: ['Mesmo acesso do PRO em cobrança anual'], noAccess: [] },
      { id: 'ultra', name: 'ULTRA', price: 14.99, period: 'monthly', order: 40, active: true, visible: true, purchasable: true, badge: 'Mais completo', access: ['Tudo do PRO', 'Prioridade em novos recursos', 'Limites ampliados'], noAccess: [] },
      { id: 'parceiro', name: 'PARCEIRO', price: 0, period: 'partner', order: 50, active: true, visible: true, purchasable: false, badge: 'Manual', access: ['Quase todas as funções VIP enquanto a parceria estiver ativa'], noAccess: ['Comissão por esse benefício'], note: 'Benefício manual para divulgadores. Pode ser removido se a parceria parar ou não trouxer resultado.' }
    ];
    const ADDON_ADMIN_DEFAULTS = [
      { id: 'adicional1', name: 'Adicional 1', price: 0, active: true, visible: true, order: 100, plans: [] },
      { id: 'adicional2', name: 'Adicional 2', price: 0, active: true, visible: true, order: 110, plans: [] }
    ];

    function cleanAviso(value, max = 2000) {
      return String(value ?? '').trim().slice(0, max);
    }

    function readAvisosCache() {
      try {
        const raw = localStorage.getItem(AVISOS_CACHE_KEY);
        return raw ? (JSON.parse(raw) || null) : null;
      } catch (_) {
        return null;
      }
    }

    function writeAvisosCache(data = {}) {
      try {
        localStorage.setItem(AVISOS_CACHE_KEY, JSON.stringify({ ts: Date.now(), data }));
      } catch (_) {}
    }

    function isAvisosCacheFresh(cache) {
      const ts = Number(cache?.ts || 0);
      return !!ts && Number.isFinite(ts) && (Date.now() - ts) < AVISOS_CACHE_TTL_MS;
    }

    function normalizeAviso(data = {}) {
      return {
        titulo: cleanAviso(data?.titulo, 120),
        aviso: cleanAviso(data?.aviso, 2000)
      };
    }

    function showAvisosStatus(type, message) {
      const box = document.getElementById('avisos-admin-status');
      if (!box) return;
      const isSuccess = type === 'success';
      box.className = `rounded-xl border px-4 py-3 text-xs font-bold ${isSuccess ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-red-200 bg-red-50 text-red-700'}`;
      box.textContent = message;
      setTimeout(() => {
        box.className = 'hidden rounded-xl border px-4 py-3 text-xs font-bold';
        box.textContent = '';
      }, 3500);
    }

    function setAvisosAdminOpen(open) {
      const content = document.getElementById('avisos-admin-content');
      const btn = document.getElementById('btn-toggle-avisos');
      if (content) content.classList.toggle('hidden', !open);
      if (btn) {
        btn.setAttribute('aria-expanded', String(!!open));
        btn.innerHTML = `
          <i data-lucide="${open ? 'chevron-up' : 'chevron-down'}" class="w-4 h-4"></i>
          ${open ? 'Ocultar avisos' : 'Abrir avisos'}
        `;
      }
      initIcons();
    }

    function setupAvisosAdminToggle() {
      const btn = document.getElementById('btn-toggle-avisos');
      setAvisosAdminOpen(false);
      btn?.addEventListener('click', () => {
        const content = document.getElementById('avisos-admin-content');
        setAvisosAdminOpen(content?.classList.contains('hidden'));
      });
    }

    function renderAvisosAdmin(data = avisosState) {
      const grid = document.getElementById('avisos-admin-grid');
      if (!grid) return;
      avisosState = data || {};
      grid.innerHTML = AVISOS_DOCS.map((item) => {
        const current = normalizeAviso(avisosState[item.id] || {});
        const active = !!(current.titulo || current.aviso);
        return `
          <div class="rounded-2xl border border-gray-200 bg-gray-50/70 p-4 space-y-3" data-aviso-card="${item.id}">
            <div class="flex items-start justify-between gap-3">
              <div>
                <span class="inline-flex items-center rounded-full bg-emerald-50 px-2.5 py-1 text-[10px] font-black uppercase tracking-wide text-emerald-700 ring-1 ring-emerald-100">${item.label}</span>
                <p class="mt-2 text-xs text-gray-500 leading-relaxed">${item.desc}</p>
              </div>
              <span class="shrink-0 rounded-full px-2 py-1 text-[10px] font-black ${active ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-200 text-gray-500'}">${active ? 'Ativo' : 'Vazio'}</span>
            </div>
            <div>
              <label class="block mb-1 text-xs font-bold text-gray-700">Título do aviso</label>
              <input id="aviso-title-${item.id}" type="text" maxlength="120" placeholder="Ex: Manutenção hoje à noite" class="w-full rounded-xl border border-gray-200 bg-white px-3 py-3 text-sm outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100" />
            </div>
            <div>
              <label class="block mb-1 text-xs font-bold text-gray-700">Texto completo</label>
              <textarea id="aviso-body-${item.id}" maxlength="2000" placeholder="Escreva aqui o aviso completo..." class="min-h-[130px] w-full resize-y rounded-xl border border-gray-200 bg-white px-3 py-3 text-sm outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100"></textarea>
            </div>
            <div class="flex gap-2">
              <button type="button" data-save-aviso="${item.id}" class="flex-1 rounded-xl bg-emerald-600 px-3 py-2.5 text-xs font-black text-white hover:bg-emerald-700 transition">Salvar</button>
              <button type="button" data-delete-aviso="${item.id}" class="rounded-xl bg-red-50 px-3 py-2.5 text-xs font-black text-red-600 hover:bg-red-100 transition">Excluir</button>
            </div>
          </div>
        `;
      }).join('');

      AVISOS_DOCS.forEach((item) => {
        const current = normalizeAviso(avisosState[item.id] || {});
        const title = document.getElementById(`aviso-title-${item.id}`);
        const body = document.getElementById(`aviso-body-${item.id}`);
        if (title) title.value = current.titulo || '';
        if (body) body.value = current.aviso || '';
      });

      grid.querySelectorAll('[data-save-aviso]').forEach((btn) => {
        btn.addEventListener('click', () => saveAviso(btn.getAttribute('data-save-aviso')));
      });
      grid.querySelectorAll('[data-delete-aviso]').forEach((btn) => {
        btn.addEventListener('click', () => deleteAviso(btn.getAttribute('data-delete-aviso')));
      });
      initIcons();
    }

    async function loadAvisos(force = false) {
      const cached = readAvisosCache();
      if (!force && isAvisosCacheFresh(cached)) {
        renderAvisosAdmin(cached.data || {});
        return;
      }

      const next = {};
      for (const item of AVISOS_DOCS) {
        const snap = await getDoc(doc(db, 'avisos', item.id));
        next[item.id] = snap.exists() ? normalizeAviso(snap.data() || {}) : { titulo: '', aviso: '' };
      }
      writeAvisosCache(next);
      renderAvisosAdmin(next);
      if (force) {
        showToast('success', 'Avisos atualizados.');
        showAvisosStatus('success', 'Avisos atualizados com sucesso.');
      }
    }

    async function saveAviso(id) {
      if (!AVISOS_DOCS.some((item) => item.id === id)) return;
      const titulo = cleanAviso(document.getElementById(`aviso-title-${id}`)?.value, 120);
      const aviso = cleanAviso(document.getElementById(`aviso-body-${id}`)?.value, 2000);
      if (!titulo && !aviso) {
        showAvisosStatus('error', 'Preencha pelo menos o título ou o texto do aviso.');
        return;
      }

      try {
        await setDoc(doc(db, 'avisos', id), { titulo, aviso, updatedAt: serverTimestamp() }, { merge: true });
        avisosState = { ...avisosState, [id]: { titulo, aviso } };
        writeAvisosCache(avisosState);
        renderAvisosAdmin(avisosState);
        showToast('success', 'Aviso salvo com sucesso.');
        showAvisosStatus('success', 'Aviso salvo. Os usuários verão respeitando o cache de 12h.');
      } catch (e) {
        console.error(e);
        showToast('error', 'Erro ao salvar aviso.');
        showAvisosStatus('error', 'Não foi possível salvar o aviso.');
      }
    }

    async function deleteAviso(id) {
      if (!AVISOS_DOCS.some((item) => item.id === id)) return;
      if (!confirm('Excluir este aviso? Ele deixa de aparecer após o cache das telas renovar.')) return;

      try {
        await deleteDoc(doc(db, 'avisos', id));
        avisosState = { ...avisosState, [id]: { titulo: '', aviso: '' } };
        writeAvisosCache(avisosState);
        renderAvisosAdmin(avisosState);
        showToast('info', 'Aviso excluído.');
        showAvisosStatus('success', 'Aviso excluído com sucesso.');
      } catch (e) {
        console.error(e);
        showToast('error', 'Erro ao excluir aviso.');
        showAvisosStatus('error', 'Não foi possível excluir o aviso.');
      }
    }

    renderAvisosAdmin({});
    setupAvisosAdminToggle();

    // Boot
    checkAuth().then(async (user) => {
      if (!user) return;
      ceoSessionUser = user;
      document.getElementById('btn-logout').onclick = logout;
      
      const isCEO = await ensureCeoStatus();
      if (!isCEO) {
        showToast('error', 'Acesso negado: Apenas o Chefe pode entrar aqui.');
        window.location.href = '/dashboard';
        return;
      }
      
      applyCeoNavVisibility();
      syncGlobalVip();
      loadAvisos(false).catch((e) => {
        console.error(e);
        showAvisosStatus('error', 'Não foi possível carregar os avisos.');
      });
      loadData(false); // Só usa Firebase se o cache estiver vazio ou velho
    });

    function syncGlobalVip() {
      const tier = (getVipTier() || 'free').toUpperCase();
      const label = document.querySelector('#vip-label span');
      if (label) label.textContent = tier;
    }

    async function fetchCeoDataFromFirebase() {
      const guildasSnap = await getDocs(collection(db, 'guildas'));
      const configSnap = await getDocs(collection(db, 'configGuilda'));

      const guildasArr = guildasSnap.docs.map(d => ({ id: d.id, ...d.data() }));
      const configArr = configSnap.docs.map(d => ({ id: d.id, ...d.data() }));

      return { guildas: guildasArr, configGuilda: configArr };
    }

    async function loadData(force = false) {
      const cachedGuildas = localStorage.getItem('hub_ceo_guildas_v1');
      const cachedConfig = localStorage.getItem('hub_ceo_config_v1');

      // Se não for forçado e existir cache (com menos de 30 min), carrega apenas do cache!
      if (!force && cachedGuildas && cachedConfig) {
        try {
          const pGuildas = JSON.parse(cachedGuildas);
          const pConfig = JSON.parse(cachedConfig);
          
          if (Date.now() - pGuildas.ts < LIST_CACHE_TTL_MS) {
            hydrateFromSnapshots(pGuildas.items, pConfig.items);
            updateSolicitacoesBadge(); // Solicitações atualizam no fundo pra manter em tempo real
            return; // PARA AQUI! Não busca do Firebase a lista de guildas.
          }
        } catch (e) {
          console.error("Erro no cache:", e);
        }
      }

      if (force) showToast('info', 'A sincronizar com Firebase...');
      else document.getElementById('guilds-grid').innerHTML = `<div class="col-span-full py-10 text-center text-gray-400">A carregar dados do servidor pela primeira vez...</div>`;
      
      try {
        const { guildas, configGuilda } = await fetchCeoDataFromFirebase();
        
        // Salva novo cache
        localStorage.setItem('hub_ceo_guildas_v1', JSON.stringify({ ts: Date.now(), items: guildas }));
        localStorage.setItem('hub_ceo_config_v1', JSON.stringify({ ts: Date.now(), items: configGuilda }));

        hydrateFromSnapshots(guildas, configGuilda);
        updateSolicitacoesBadge();

        if (force) showToast('success', 'Atualizado com sucesso!');
      } catch (e) {
        console.error(e);
        if (force) showToast('error', 'Falha ao atualizar dados do servidor.');
      }
    }

    function hydrateFromSnapshots(guildasArr, configArr) {
      const configMap = {};
      (configArr || []).forEach(d => { configMap[d.id] = d; });

      window.allConfigGuilda = (configArr || []);

      window.allGuildas = (guildasArr || []).map(d => ({
        id: d.id,
        ...d,
        vip: configMap[d.id]?.vipTier || configMap[d.id]?.vip || d.vipTier || d.vip || 'free',
        vipExpiresAt: configMap[d.id]?.vipExpiresAt || d.vipExpiresAt,
        leaders: configMap[d.id]?.leaders || (d.ownerEmail ? [d.ownerEmail] : []),
        admins: configMap[d.id]?.admins || [],
        ownerUid: d.ownerUid || configMap[d.id]?.ownerUid || configMap[d.id]?.uid || null,
        memberCount: normalizeMemberCount(configMap[d.id]?.totalMembros),
        configUpdatedAt: configMap[d.id]?.updatedAt || d.configUpdatedAt || d.updatedAt || null
      }));

      // Ordena por data de criação (Mais novas primeiro)
      window.allGuildas.sort((a, b) => {
        const tA = a.createdAt?.seconds || a.createdAt || 0;
        const tB = b.createdAt?.seconds || b.createdAt || 0;
        return tB - tA;
      });

      allGuilds = window.allGuildas;
      
      const statGuilds = document.getElementById('stat-guilds');
      if (statGuilds) statGuilds.textContent = allGuilds.length;

      renderUserGrowth(allGuilds);
      renderGuilds();
    }

    function renderUserGrowth(guilds = []) {
      const panel = document.getElementById('user-growth-panel');
      const bars = document.getElementById('growth-bars');
      if (!panel || !bars) return;

      const now = new Date();
      const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
      const weekStart = todayStart - (6 * 86400000);
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
      const createdTimes = (guilds || []).map((g) => toTimestampMs(g?.createdAt)).filter((ms) => Number.isFinite(ms));
      const setText = (id, value) => {
        const el = document.getElementById(id);
        if (el) el.textContent = String(value);
      };

      setText('growth-today', createdTimes.filter((ms) => ms >= todayStart).length);
      setText('growth-week', createdTimes.filter((ms) => ms >= weekStart).length);
      setText('growth-month', createdTimes.filter((ms) => ms >= monthStart).length);
      setText('growth-total', (guilds || []).length);

      const dayFormatter = new Intl.DateTimeFormat('pt-BR', { weekday: 'short' });
      const points = Array.from({ length: 7 }, (_, index) => {
        const start = weekStart + (index * 86400000);
        const end = start + 86400000;
        return {
          label: dayFormatter.format(new Date(start)).replace('.', '').slice(0, 3),
          count: createdTimes.filter((ms) => ms >= start && ms < end).length
        };
      });
      const max = Math.max(1, ...points.map((point) => point.count));
      bars.innerHTML = points.map((point) => `
        <div class="flex h-full min-w-0 flex-col items-center justify-end gap-1.5">
          <span class="text-[10px] font-black text-gray-500">${point.count}</span>
          <div class="flex h-16 w-full max-w-7 items-end overflow-hidden rounded-md bg-gray-100">
            <div class="w-full rounded-md bg-blue-500 transition-all" style="height:${point.count ? Math.max(12, Math.round((point.count / max) * 100)) : 4}%"></div>
          </div>
          <span class="truncate text-[9px] font-black uppercase text-gray-400">${escapeHtml(point.label)}</span>
        </div>
      `).join('');
      panel.classList.toggle('hidden', currentAdminView !== 'guildas');
      initIcons();
    }
    
    // Atualiza apenas o contador de badges em tempo real (fora da lista de guildas)
    async function updateSolicitacoesBadge() {
        try {
            const snap = await getDocs(collection(db, 'solicita'));
            const data = snap.docs.map(d => d.data());
            const pendentes = data.filter(s => s.status === 'pendente').length;
            const badgeEl = document.getElementById('stat-solicita');
            if(badgeEl) badgeEl.textContent = pendentes;
        } catch(e) {}
    }


    function escapeHtml(value) {
      return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
    }

    function safeJsString(value) {
      return String(value ?? '')
        .replace(/\\/g, '\\\\')
        .replace(/'/g, "\\'")
        .replace(/\n/g, '\\n')
        .replace(/\r/g, '');
    }

    function cssEscapeValue(value) {
      try {
        if (window.CSS && typeof window.CSS.escape === 'function') return window.CSS.escape(String(value));
      } catch (_) {}
      return String(value ?? '').replace(/["\\]/g, '\\$&');
    }

    function toMoneyNumber(value) {
      if (typeof value === 'number' && Number.isFinite(value)) return value;
      const clean = String(value ?? '')
        .replace(/[^0-9,.-]/g, '')
        .replace(/\.(?=\d{3}(\D|$))/g, '')
        .replace(',', '.');
      const parsed = Number(clean);
      return Number.isFinite(parsed) ? parsed : 0;
    }

    function roundMoney(value) {
      return Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100;
    }

    function estimatedTransactionFee(amount) {
      return roundMoney(toMoneyNumber(amount) * TRANSACTION_FEE_RATE);
    }

    function formatMoney(value) {
      return toMoneyNumber(value).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
    }

    function getField(data, names, fallback = undefined) {
      for (const name of names) {
        if (Object.prototype.hasOwnProperty.call(data || {}, name) && data[name] !== undefined) return data[name];
      }
      return fallback;
    }

    function boolField(data, names, fallback = false) {
      const value = getField(data, names, undefined);
      if (value === undefined || value === null || value === '') return fallback;
      if (typeof value === 'boolean') return value;
      const s = String(value).toLowerCase().trim();
      if (['1', 'true', 'sim', 'yes', 'ativo', 'enabled'].includes(s)) return true;
      if (['0', 'false', 'nao', 'não', 'no', 'inativo', 'disabled'].includes(s)) return false;
      return fallback;
    }

    function listField(data, names, fallback = []) {
      const value = getField(data, names, undefined);
      if (Array.isArray(value)) return value.map((x) => String(x || '').trim()).filter(Boolean);
      if (typeof value === 'string') return value.split(/\r?\n|;/g).map((x) => x.trim()).filter(Boolean);
      return Array.isArray(fallback) ? fallback : [];
    }

    function canonicalPlanId(id) {
      return normalizeVip(id);
    }

    function defaultAffiliatePercent(planId) {
      const p = canonicalPlanId(planId);
      if (p === 'plus' || p === 'pro' || p === 'ultra') return 20;
      if (p === 'business') return 10;
      return 0;
    }

    function defaultDurationDays(planId, period = '') {
      const p = canonicalPlanId(planId);
      if (p === 'parceiro' || p === 'free') return null;
      if (p === 'business' || String(period).toLowerCase() === 'yearly') return 365;
      return 30;
    }

    function planAdminCandidates(planId) {
      const normalized = canonicalPlanId(planId);
      const raw = String(planId || '').toLowerCase().trim();
      const out = [raw, normalized].filter(Boolean);
      if (normalized === 'business') out.push('bussines');
      return Array.from(new Set(out));
    }

    async function getPlanAdminConfig(planId) {
      const normalized = canonicalPlanId(planId);
      const fromMemory = allPlansAdmin.find((p) => p.id === normalized || p.sourceId === planId);
      if (fromMemory) return fromMemory;

      for (const candidate of planAdminCandidates(planId)) {
        try {
          const snap = await getDoc(doc(db, 'planos', candidate));
          if (snap.exists()) return hydratePlanAdmin(candidate, snap.data() || {});
        } catch (_) {}
      }

      return PLAN_ADMIN_DEFAULTS.find((p) => p.id === normalized) || { id: normalized, period: 'monthly', durationDays: 30 };
    }

    function getPlanAdminConfigSync(planId) {
      const normalized = canonicalPlanId(planId);
      return allPlansAdmin.find((p) => p.id === normalized || p.sourceId === planId)
        || PLAN_ADMIN_DEFAULTS.find((p) => p.id === normalized)
        || { id: normalized, price: 999999, order: 999 };
    }

    async function buildVipExpiresAtFromPlan(planId) {
      const normalized = canonicalPlanId(planId);
      if (normalized === 'free' || normalized === 'parceiro') return null;
      const plan = await getPlanAdminConfig(normalized);
      const days = Number(plan?.durationDays || defaultDurationDays(normalized, plan?.period || 'monthly'));
      if (!Number.isFinite(days) || days <= 0) return null;
      return Date.now() + Math.floor(days) * 24 * 60 * 60 * 1000;
    }

    function defaultPlanDurationDaysSync(planId) {
      const normalized = canonicalPlanId(planId);
      if (normalized === 'free' || normalized === 'parceiro') return null;
      const plan = getPlanAdminConfigSync(normalized);
      const days = Number(plan?.durationDays || defaultDurationDays(normalized, plan?.period || 'monthly'));
      return Number.isFinite(days) && days > 0 ? Math.floor(days) : 30;
    }

    function durationOptionsHtml(planId) {
      const defaultDays = defaultPlanDurationDaysSync(planId);
      const defaultLabel = defaultDays ? `Padrão do plano (${defaultDays} dias)` : 'Padrão do plano (sem expiração)';
      return `
        <option value="default">${escapeHtml(defaultLabel)}</option>
        <option value="30">30 dias</option>
        <option value="90">90 dias</option>
        <option value="180">180 dias</option>
        <option value="365">1 ano</option>
        <option value="730">2 anos</option>
        <option value="1095">3 anos</option>
        <option value="1460">4 anos</option>
        <option value="1825">5 anos</option>
        <option value="custom">Quantidade personalizada</option>
        <option value="none">Sem expiração</option>
      `;
    }

    async function manualVipExpiresAt(planId) {
      const normalized = canonicalPlanId(planId);
      if (normalized === 'free') return null;
      const mode = String(document.getElementById('edit-vip-duration')?.value || 'default');
      if (mode === 'none') return null;
      if (mode === 'default') return buildVipExpiresAtFromPlan(normalized);
      const rawDays = mode === 'custom'
        ? Number(document.getElementById('edit-vip-custom-days')?.value || 0)
        : Number(mode);
      if (!Number.isFinite(rawDays) || rawDays < 1 || rawDays > 1825) {
        throw new Error('Escolha uma duração entre 1 dia e 5 anos.');
      }
      return Date.now() + Math.floor(rawDays) * 86400000;
    }

    function planCatalogForSelect() {
      const cached = (() => {
        try {
          const parsed = JSON.parse(localStorage.getItem(PLANS_ADMIN_CACHE_KEY) || 'null');
          return Array.isArray(parsed?.plans) ? parsed.plans : [];
        } catch (_) {
          return [];
        }
      })();
      const map = new Map();
      [...PLAN_ADMIN_DEFAULTS, ...cached, ...allPlansAdmin].forEach((p) => {
        if (!p?.id) return;
        map.set(p.id, p);
      });
      return Array.from(map.values())
        .filter((p) => p.active !== false)
        .sort((a, b) => {
          if (a.id === 'free' && b.id !== 'free') return -1;
          if (b.id === 'free' && a.id !== 'free') return 1;
          if (a.id === 'parceiro' && b.id !== 'parceiro') return 1;
          if (b.id === 'parceiro' && a.id !== 'parceiro') return -1;
          return (Number(a.price || 0) - Number(b.price || 0)) || ((a.order || 0) - (b.order || 0));
        });
    }

    function planOptionsHtml(currentPlan) {
      const current = canonicalPlanId(currentPlan);
      const plans = planCatalogForSelect();
      const fallback = current && !plans.some((p) => canonicalPlanId(p.id) === current)
        ? `<option value="${escapeHtml(current)}" selected>${escapeHtml(prettyVipName(current))}</option>`
        : '';
      return fallback + plans.map((p) => {
        const selected = canonicalPlanId(p.id) === current ? 'selected' : '';
        return `<option value="${escapeHtml(p.id)}" ${selected}>${escapeHtml(p.name || prettyVipName(p.id))}</option>`;
      }).join('');
    }

    function matchesMembersFilter(count, filterValue) {
      const f = String(filterValue || 'all');
      if (f === 'all') return true;
      const n = normalizeMemberCount(count);
      const min = Number(f.replace('+', ''));
      return Number.isFinite(min) ? n >= min : true;
    }

    function isAddonDoc(id, data = {}) {
      const type = String(getField(data, ['type', 'tipo', 'kind'], '') || '').toLowerCase();
      const s = String(id || '').toLowerCase();
      return type.includes('adicional') || type.includes('addon') || type.includes('extra') || s.includes('adicional') || s.includes('addon') || s.includes('extra');
    }

    function hydratePlanAdmin(id, data = {}) {
      const planId = canonicalPlanId(id);
      const base = PLAN_ADMIN_DEFAULTS.find((p) => p.id === planId) || { id: planId, name: planId.toUpperCase(), price: 0, order: 999, active: true, visible: true, purchasable: true, access: [], noAccess: [] };
      const forcedNotPurchasable = planId === 'free' || planId === 'parceiro';
      const period = String(getField(data, ['period', 'periodo', 'ciclo'], base.period || 'monthly')).toLowerCase();
      return {
        ...base,
        id: planId,
        sourceId: id || base.sourceId || planId,
        name: String(getField(data, ['name', 'nome', 'titulo', 'title'], base.name || planId.toUpperCase())),
        price: roundMoney(toMoneyNumber(getField(data, ['price', 'preco', 'valor', 'amount'], base.price || 0))),
        period,
        durationDays: Number(getField(data, ['durationDays', 'duracaoDias', 'dias', 'validadeDias'], base.durationDays ?? defaultDurationDays(planId, period))) || null,
        affiliatePercent: Number(getField(data, ['affiliatePercent', 'afiliadoPercent', 'commissionPercent', 'comissaoPercentual'], base.affiliatePercent ?? defaultAffiliatePercent(planId))) || 0,
        order: Number(getField(data, ['order', 'ordem', 'posicao'], base.order || 999)) || 999,
        active: boolField(data, ['active', 'ativo', 'enabled'], base.active !== false),
        visible: boolField(data, ['visible', 'visivel', 'show', 'mostrar'], base.visible !== false),
        purchasable: forcedNotPurchasable ? false : boolField(data, ['purchasable', 'vendavel', 'compravel', 'checkout', 'allowCheckout'], base.purchasable !== false),
        popular: boolField(data, ['popular', 'destaque'], base.popular === true),
        badge: String(getField(data, ['badge', 'tag', 'selo'], base.badge || '')),
        access: listField(data, ['access', 'libera', 'beneficios', 'features', 'inclui'], base.access || []),
        noAccess: listField(data, ['noAccess', 'naoLibera', 'bloqueia', 'semAcesso'], base.noAccess || []),
        note: String(getField(data, ['note', 'nota', 'observacao', 'obs'], base.note || '')),
        warning: String(getField(data, ['warning', 'aviso', 'alerta', 'checkoutWarning', 'avisoCheckout'], base.warning || ''))
      };
    }

    function hydrateAddonAdmin(id, data = {}) {
      const base = ADDON_ADMIN_DEFAULTS.find((x) => x.id === id) || {};
      return {
        id,
        name: String(getField(data, ['name', 'nome', 'titulo', 'title'], base.name || id)),
        price: roundMoney(toMoneyNumber(getField(data, ['price', 'preco', 'valor', 'amount'], base.price || 0))),
        description: String(getField(data, ['description', 'descricao', 'subtitulo'], base.description || '')),
        active: boolField(data, ['active', 'ativo', 'enabled'], base.active !== false),
        visible: boolField(data, ['visible', 'visivel', 'show', 'mostrar'], base.visible !== false),
        order: Number(getField(data, ['order', 'ordem', 'posicao'], base.order || 900)) || 900,
        plans: listField(data, ['plans', 'planos', 'aplicaEm', 'aplicarEm'], base.plans || []).map(canonicalPlanId)
      };
    }

    function normalizePartnerType(p = {}) {
      const raw = String(p.tipoParceiro || p.tipo || '').toLowerCase().trim();
      if (raw === 'verificado' || p.verificado === true || p.beneficiosLiberados === true) return 'verificado';
      return 'normal';
    }

    function partnerTypeBadge(p = {}) {
      const type = normalizePartnerType(p);
      return type === 'verificado'
        ? '<span class="px-3 py-1 rounded-xl bg-amber-100 text-amber-700 text-[10px] font-black uppercase tracking-wider border border-amber-200">Verificado</span>'
        : '<span class="px-3 py-1 rounded-xl bg-gray-100 text-gray-600 text-[10px] font-black uppercase tracking-wider border border-gray-200">Normal</span>';
    }

    function getPendingWithdraw(partner = {}) {
      const saque = partner.saque || {};
      const pending = saque.status === 'pendente' || partner.saquePendente === true;
      if (!pending) return null;
      const valor = toMoneyNumber(saque.valor || partner.valorSaqueSolicitado || partner.saldoEmSaque || 0);
      return {
        valor,
        pix: saque.pix || partner.pix || '',
        solicitadoEm: saque.solicitadoEm || saque.solicitadoEmMs || partner.updatedAt || null,
        solicitadoPorEmail: saque.solicitadoPorEmail || partner.email || ''
      };
    }

    function getConfigByGuildId(gid) {
      const id = String(gid || '').trim();
      if (!id) return null;
      return (window.allConfigGuilda || []).find((g) => String(g.id || '') === id) || null;
    }

    function findGuildForPartner(partner = {}, configArr = [], guildsArr = []) {
      const pid = String(partner.id || partner.userId || partner.gameId || '').trim();
      const uid = String(partner.uid || '').trim();
      const email = String(partner.email || '').trim().toLowerCase();

      // Sem leitura extra em /users: usa somente o que já veio de /monetize
      // e o cache/lista já carregada de /configGuilda e /guildas.
      let guildId = String(
        partner.guildId ||
        partner.guild ||
        partner.referralGuildUid ||
        partner.guildUid ||
        ''
      ).trim();

      let cfg = guildId ? (configArr || []).find((c) => String(c.id || '') === guildId) : null;

      if (!cfg && (uid || email || pid)) {
        cfg = (configArr || []).find((c) => {
          const leaders = Array.isArray(c.leaders) ? c.leaders.map((x) => String(x || '').toLowerCase().trim()) : [];
          const admins = Array.isArray(c.admins) ? c.admins.map((x) => String(x || '').toLowerCase().trim()) : [];
          return (!!uid && String(c.ownerUid || c.uid || '').trim() === uid)
            || (!!email && String(c.ownerEmail || c.playerEmail || '').trim().toLowerCase() === email)
            || (!!email && leaders.includes(email))
            || (!!email && admins.includes(email))
            || (!!pid && String(c.referralOwnerGameId || '').trim() === pid);
        }) || null;
        if (cfg) guildId = String(cfg.id || '').trim();
      }

      const guild = guildId ? ((guildsArr || []).find((g) => String(g.id || '') === guildId) || {}) : {};
      const guildName = partner.guildName || guild.name || cfg?.name || '';

      return {
        guildId,
        guildName,
        guildVip: cfg?.vipTier || guild.vipTier || guild.vip || 'free',
        guildVipExpiresAt: cfg?.vipExpiresAt || guild.vipExpiresAt || null,
        userDocIds: []
      };
    }

    function setActiveView(view) {
      currentAdminView = view === 'partners' ? 'partners' : (view === 'plans' ? 'plans' : 'guildas');
      const isPartners = currentAdminView === 'partners';
      const isPlans = currentAdminView === 'plans';
      document.getElementById('guilds-grid')?.classList.toggle('hidden', isPartners || isPlans);
      document.getElementById('partners-grid')?.classList.toggle('hidden', !isPartners);
      document.getElementById('plans-admin-panel')?.classList.toggle('hidden', !isPlans);
      document.getElementById('user-growth-panel')?.classList.toggle('hidden', isPartners || isPlans);

      const btnGuildas = document.getElementById('view-guildas');
      const btnPartners = document.getElementById('view-partners');
      const btnPlans = document.getElementById('view-plans');
      if (btnGuildas && btnPartners && btnPlans) {
        btnGuildas.className = (isPartners || isPlans)
          ? 'flex-1 inline-flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-gray-50 text-gray-600 text-sm font-black hover:bg-gray-100 transition'
          : 'flex-1 inline-flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-emerald-600 text-white text-sm font-black transition';
        btnPartners.className = isPartners
          ? 'flex-1 inline-flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-amber-500 text-white text-sm font-black transition'
          : 'flex-1 inline-flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-gray-50 text-gray-600 text-sm font-black hover:bg-gray-100 transition';
        btnPlans.className = isPlans
          ? 'flex-1 inline-flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-sky-600 text-white text-sm font-black transition'
          : 'flex-1 inline-flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-gray-50 text-gray-600 text-sm font-black hover:bg-gray-100 transition';
      }

      const search = document.getElementById('guild-search');
      if (search) {
        search.value = adminViewSearch[currentAdminView] || '';
        search.placeholder = isPlans
          ? 'Procurar plano, selo, benefício ou aviso...'
          : (isPartners
            ? 'Procurar parceiro por nick, ID, e-mail, Pix ou guilda...'
            : 'Procurar por nome, ID ou e-mail de líder...');
      }

      closeCeoCustomSelects();
      requestAnimationFrame(() => {
        if (isPlans) {
          if (!allPlansAdmin.length || !adminViewRendered.plans) loadPlansAdmin(false);
          else if (financePartnerDataDirty) {
            financePartnerDataDirty = false;
            setTimeout(refreshFinancePanelFromPartnerData, 120);
          }
          if (!allPartners.length) loadPartners(false).catch((e) => console.error(e));
          else schedulePartnerCommissionHydration();
        } else if (isPartners) {
          if (!allPartners.length) loadPartners(false);
          else if (!adminViewRendered.partners) renderPartners();
        } else if (!adminViewRendered.guildas) {
          renderGuilds();
        }
      });
    }

    function activeSearchQuery(view = currentAdminView) {
      return String(adminViewSearch[view] || '').toLowerCase().trim();
    }

    function renderCurrentAdminView() {
      if (currentAdminView === 'plans') renderPlansAdmin();
      else if (currentAdminView === 'partners') renderPartners();
      else renderGuilds();
    }

    function applyAdminSearch() {
      adminViewSearch[currentAdminView] = String(document.getElementById('guild-search')?.value || '').trim();
      renderCurrentAdminView();
    }

    function isApprovedPayment(p = {}) {
      const status = String(p.status || p.mpStatus || '').toLowerCase();
      return status.includes('aprov') || status === 'approved';
    }

    function approvedPaymentsFromSolicita(s = {}) {
      const entries = s.pagamentos && typeof s.pagamentos === 'object' ? Object.entries(s.pagamentos) : [];
      const rows = entries
        .filter(([, p]) => isApprovedPayment(p))
        .map(([paymentKey, p]) => ({
          ...p,
          paymentKey,
          docId: s.id,
          email: p.email || s.email,
          guildId: p.guildId || s.guildId,
          uid: p.uid || s.uid,
          affiliatePartnerId: p.affiliatePartnerId || p.partnerId || s.affiliatePartnerId || s.partnerId || s.parceiroId,
          solicitaDoc: s
        }));

      if (!rows.length && String(s.status || '').toLowerCase() === 'aprovado') {
        rows.push({
          paymentId: s.paymentId || s.id,
          paymentKey: '__legacy__',
          docId: s.id,
          email: s.email,
          guildId: s.guildId,
          uid: s.uid,
          plano: s.plano,
          amount: s.amount,
          transactionFee: s.transactionFee,
          affiliateFee: s.affiliateFee,
          netAmount: s.netAmount,
          affiliatePartnerId: s.affiliatePartnerId || s.partnerId || s.parceiroId,
          updatedAtMs: s.updatedAtMs || s.lastApprovedAtMs,
          status: 'aprovado',
          solicitaDoc: s
        });
      }
      return rows;
    }

    function readFinanceCache() {
      try {
        const raw = localStorage.getItem(FINANCE_CACHE_KEY);
        const cached = raw ? JSON.parse(raw) : null;
        if (!cached?.docs || !Array.isArray(cached.docs)) return null;
        if (Date.now() - Number(cached.ts || 0) > FINANCE_CACHE_TTL_MS) return null;
        return cached.docs;
      } catch (_) {
        return null;
      }
    }

    function writeFinanceCache(docs = []) {
      try {
        localStorage.setItem(FINANCE_CACHE_KEY, JSON.stringify({ ts: Date.now(), docs }));
      } catch (_) {}
    }

    function hydratePartnersFromCacheForFinance() {
      if ((allPartners || []).length) return true;
      if ((window.allPartners || []).length) {
        allPartners = window.allPartners;
        return true;
      }
      try {
        const raw = localStorage.getItem('hub_ceo_partners_v1');
        const parsed = raw ? JSON.parse(raw) : null;
        if (parsed?.items && Array.isArray(parsed.items) && (Date.now() - Number(parsed.ts || 0)) < LIST_CACHE_TTL_MS) {
          allPartners = parsed.items;
          window.allPartners = allPartners;
          const statPartners = document.getElementById('stat-partners');
          if (statPartners) statPartners.textContent = allPartners.length;
          return allPartners.length > 0;
        }
      } catch (_) {}
      return false;
    }

    function paymentTimestampMs(p = {}) {
      const keys = ['approvedAtMs', 'paidAtMs', 'updatedAtMs', 'createdAtMs', 'lastApprovedAtMs', 'approvedAt', 'paidAt', 'updatedAt', 'createdAt', 'data', 'date'];
      for (const key of keys) {
        const ms = toTimestampMs(p[key]);
        if (ms) return ms;
      }
      return null;
    }

    function financeMonthKeyFromMs(ms) {
      if (!ms) return FINANCE_UNKNOWN_MONTH;
      const d = new Date(ms);
      if (Number.isNaN(d.getTime())) return FINANCE_UNKNOWN_MONTH;
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    }

    function financeMonthKey(p = {}) {
      return financeMonthKeyFromMs(paymentTimestampMs(p));
    }

    function financeMonthLabel(key) {
      if (!key || key === 'all') return 'Todos os meses';
      if (key === FINANCE_UNKNOWN_MONTH) return 'Sem data';
      const [year, month] = String(key).split('-').map(Number);
      if (!year || !month) return key;
      return new Date(year, month - 1, 1).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
    }

    function financeSelectValue(id, fallback = 'all') {
      return document.getElementById(id)?.value || fallback;
    }

    function setFinanceSelectOptions(id, options, selected) {
      const sel = document.getElementById(id);
      if (!sel) return;
      const value = options.some((opt) => opt.value === selected) ? selected : 'all';
      sel.innerHTML = options.map((opt) => `<option value="${escapeHtml(opt.value)}">${escapeHtml(opt.label)}</option>`).join('');
      sel.value = value;
      refreshCeoCustomSelect(sel);
    }

    function hydrateFinanceFilters(payments = []) {
      const currentMonth = financeSelectValue('finance-month-filter');
      const currentPlan = financeSelectValue('finance-plan-filter');
      const monthKeys = Array.from(new Set(payments.map(financeMonthKey))).filter(Boolean).sort((a, b) => {
        if (a === FINANCE_UNKNOWN_MONTH) return 1;
        if (b === FINANCE_UNKNOWN_MONTH) return -1;
        return b.localeCompare(a);
      });
      const planMap = new Map();
      planCatalogForSelect().forEach((p) => {
        if (!p?.id) return;
        planMap.set(canonicalPlanId(p.id), p);
      });
      payments.forEach((p) => {
        const id = canonicalPlanId(p.plano || p.approvedVipTier || 'free');
        if (!planMap.has(id)) planMap.set(id, getPlanAdminConfigSync(id));
      });
      const planKeys = Array.from(planMap.keys()).sort((a, b) => {
        const aPlan = getPlanAdminConfigSync(a);
        const bPlan = getPlanAdminConfigSync(b);
        return (Number(aPlan?.price ?? 999999) - Number(bPlan?.price ?? 999999)) || String(a).localeCompare(String(b));
      });

      setFinanceSelectOptions('finance-month-filter', [
        { value: 'all', label: 'Todos os meses' },
        ...monthKeys.map((key) => ({ value: key, label: financeMonthLabel(key) }))
      ], currentMonth);

      setFinanceSelectOptions('finance-plan-filter', [
        { value: 'all', label: 'Todos os planos' },
        ...planKeys.map((plan) => ({ value: plan, label: prettyVipName(plan) }))
      ], currentPlan);
    }

    function syncFinanceDeleteButton() {
      const btn = document.getElementById('btn-delete-finance-month');
      if (!btn) return;
      const month = financeSelectValue('finance-month-filter');
      const disabled = !month || month === 'all' || month === FINANCE_UNKNOWN_MONTH;
      btn.disabled = disabled;
      btn.classList.toggle('opacity-50', disabled);
      btn.classList.toggle('cursor-not-allowed', disabled);
    }

    function financePartnerRefs(partner = {}) {
      return [
        partner.id, partner.userId, partner.uid, partner.gameId, partner.discordId,
        partner.email, partner.guildId, partner.codigo, partner.code, partner.refCode
      ].map((v) => String(v || '').toLowerCase().trim()).filter(Boolean);
    }

    function financePaymentRefs(payment = {}) {
      const docData = payment.solicitaDoc || {};
      const guildId = payment.guildId || docData.guildId;
      const cfg = (window.allConfigGuilda || []).find((x) => String(x.id || x.guildId || '') === String(guildId || '')) || {};
      return [
        payment.affiliatePartnerId, payment.partnerId, payment.parceiroId, payment.indicadoPor, payment.indicadoPorParceiro,
        payment.comissaoParceiroId, payment.referralPartnerId, payment.afiliadoId, payment.monetizeId, payment.parceiroRef,
        docData.affiliatePartnerId, docData.partnerId, docData.parceiroId, docData.indicadoPor, docData.indicadoPorParceiro, docData.comissaoParceiroId,
        cfg.affiliatePartnerId, cfg.partnerId, cfg.parceiroId, cfg.indicadoPor, cfg.indicadoPorParceiro, cfg.comissaoParceiroId, cfg.parceiroRef
      ].map((v) => String(v || '').toLowerCase().trim()).filter(Boolean);
    }

    function findFinancePartner(payment = {}) {
      const partners = (allPartners && allPartners.length) ? allPartners : (window.allPartners || []);
      const refs = new Set(financePaymentRefs(payment));
      if (!refs.size) return null;
      return partners.find((partner) => financePartnerRefs(partner).some((ref) => refs.has(ref))) || null;
    }

    function normalizePercentValue(value) {
      const n = Number(value);
      if (!Number.isFinite(n) || n <= 0) return null;
      return n <= 1 ? n * 100 : n;
    }

    function partnerCommissionPercent(partner = {}, plan = 'free') {
      const normalized = normalizeVip(plan);
      const maps = [partner.comissaoPorPlano, partner.comissaoPlanos, partner.percentualPorPlano, partner.planPercents, partner.planos];
      for (const map of maps) {
        if (!map || typeof map !== 'object') continue;
        const item = map[normalized] || map[prettyVipName(normalized)] || map[normalized.toUpperCase()];
        const direct = normalizePercentValue(typeof item === 'object' ? (item.percent || item.percentual || item.comissaoPercentual || item.affiliatePercent) : item);
        if (direct != null) return direct;
      }
      for (const key of ['commissionPercent', 'comissaoPercentual', 'percentualComissao', 'percentualAfiliado', 'affiliatePercent', 'afiliadoPercentual']) {
        const n = normalizePercentValue(partner[key]);
        if (n != null) return n;
      }
      return null;
    }

    function storedAffiliateFee(payment = {}) {
      const docData = payment.solicitaDoc || {};
      const values = [
        payment.affiliateFee,
        payment.taxaAfiliado,
        payment.comissaoAfiliado,
        payment.comissaoParceiroValor,
        payment.partnerFee,
        payment.partnerCommission,
        payment.comissao,
        payment.pagamentoAtual?.affiliateFee,
        docData.affiliateFee,
        docData.comissaoParceiroValor
      ];
      for (const value of values) {
        const n = roundMoney(toMoneyNumber(value));
        if (n > 0) return n;
      }
      return 0;
    }

    function financePaymentIds(payment = {}) {
      const docData = payment.solicitaDoc || {};
      return [
        payment.paymentId,
        payment.paymentKey,
        payment.id,
        payment.mpPaymentId,
        payment.mercadoPagoId,
        docData.paymentId,
        docData.pagamentoAtual?.paymentId,
        docData.comissaoParceiroPagamentoId
      ].map((v) => String(v || '').trim()).filter((v) => v && v !== '__legacy__');
    }

    function financeCommissionEntries() {
      const partners = (allPartners && allPartners.length) ? allPartners : (window.allPartners || []);
      return partners.flatMap((partner) => {
        const list = Array.isArray(partner.financeComissoes)
          ? partner.financeComissoes
          : (Array.isArray(partner.comissoes) ? partner.comissoes : []);
        return list.map((c) => ({ partnerId: partner.id, partner, ...c }));
      });
    }

    function isApprovedCommission(entry = {}) {
      const status = String(entry.status || entry.situacao || '').toLowerCase();
      return !status || status.includes('aprov') || status === 'approved' || status === 'pago' || status === 'paid';
    }

    function commissionEntryAmount(entry = {}) {
      return roundMoney(toMoneyNumber(entry.comissao ?? entry.valorComissao ?? entry.comissaoParceiroValor ?? entry.affiliateFee ?? entry.valor ?? 0));
    }

    function commissionMatchesPayment(entry = {}, payment = {}) {
      if (!isApprovedCommission(entry) || commissionEntryAmount(entry) <= 0) return false;
      const paymentIds = new Set(financePaymentIds(payment));
      const commissionIds = [
        entry.paymentId,
        entry.pagamentoId,
        entry.mpPaymentId,
        entry.mercadoPagoId,
        entry.primeiroPagamentoId,
        entry.comissaoParceiroPagamentoId
      ].map((v) => String(v || '').trim()).filter(Boolean);

      if (commissionIds.length && paymentIds.size) return commissionIds.some((id) => paymentIds.has(id));
      if (commissionIds.length && !paymentIds.size) return false;

      const paymentGuild = String(payment.guildId || payment.solicitaDoc?.guildId || '').trim();
      const commissionGuild = String(entry.guildId || entry.guild || entry.id || '').trim();
      if (!paymentGuild || !commissionGuild || paymentGuild !== commissionGuild) return false;

      const paymentPlan = normalizeVip(payment.plano || payment.approvedVipTier || payment.solicitaDoc?.plano || 'free');
      const commissionPlan = normalizeVip(entry.plano || entry.plan || entry.comissaoParceiroPlano || paymentPlan);
      return paymentPlan === commissionPlan;
    }

    function partnerCommissionFeeForPayment(payment = {}) {
      const matched = financeCommissionEntries().filter((entry) => commissionMatchesPayment(entry, payment));
      if (!matched.length) return { fee: 0, partner: null, percent: null };
      const fee = matched.reduce((sum, entry) => roundMoney(sum + commissionEntryAmount(entry)), 0);
      const first = matched[0] || {};
      const percent = normalizePercentValue(first.percentual ?? first.percent ?? first.comissaoPercentual);
      return { fee, partner: first.partner || findFinancePartner(payment), percent };
    }

    function configCommissionFeeForPayment(payment = {}) {
      const guildId = String(payment.guildId || payment.solicitaDoc?.guildId || '').trim();
      if (!guildId) return { fee: 0, percent: null };
      const cfg = (window.allConfigGuilda || []).find((x) => String(x.id || x.guildId || '') === guildId) || null;
      if (!cfg) return { fee: 0, percent: null };
      const fee = roundMoney(toMoneyNumber(cfg.comissaoParceiroValor || 0));
      if (fee <= 0) return { fee: 0, percent: null };

      const paymentIds = new Set(financePaymentIds(payment));
      const cfgPaymentId = String(cfg.comissaoParceiroPagamentoId || '').trim();
      if (cfgPaymentId && paymentIds.size && !paymentIds.has(cfgPaymentId)) return { fee: 0, percent: null };

      const paymentPlan = normalizeVip(payment.plano || payment.approvedVipTier || payment.solicitaDoc?.plano || 'free');
      const cfgPlan = normalizeVip(cfg.comissaoParceiroPlano || paymentPlan);
      if (cfgPlan && paymentPlan !== cfgPlan) return { fee: 0, percent: null };
      return { fee, percent: normalizePercentValue(cfg.comissaoParceiroPercentual || cfg.percentualComissao) };
    }

    function affiliateFeeForPayment(payment = {}, amount = 0, partnerDataReady = false) {
      if (!partnerDataReady) return { known: false, fee: 0, partner: null, percent: null };
      const stored = storedAffiliateFee(payment);
      if (stored > 0) {
        return { known: true, fee: stored, partner: findFinancePartner(payment), percent: null };
      }

      const fromPartners = partnerCommissionFeeForPayment(payment);
      if (fromPartners.fee > 0) return { known: true, ...fromPartners };

      const fromConfig = configCommissionFeeForPayment(payment);
      if (fromConfig.fee > 0) {
        return { known: true, fee: fromConfig.fee, partner: findFinancePartner(payment), percent: fromConfig.percent };
      }

      const partner = findFinancePartner(payment);
      const percent = partner ? partnerCommissionPercent(partner, payment.plano || payment.approvedVipTier || 'free') : null;
      const flagged = payment.affiliateCommissionApplied === true || payment.afiliadoContabilizado === true || payment.comissaoAfiliadoAplicada === true || payment.comissaoParceiroCreditada === true;
      const calculated = percent != null ? roundMoney(amount * percent / 100) : 0;
      return {
        known: true,
        fee: flagged && partner && calculated > 0 ? calculated : 0,
        partner,
        percent
      };
    }

    function addFinanceBucket(map, key, label, amount) {
      if (!map[key]) map[key] = { key, label, total: 0, count: 0 };
      map[key].total = roundMoney(map[key].total + amount);
      map[key].count += 1;
    }

    function renderFinanceBars(items = [], colorClass = 'bg-emerald-500') {
      const maxTotal = Math.max(1, ...items.map((x) => x.total));
      return items.map((item) => `
        <div class="space-y-1">
          <div class="flex items-center justify-between gap-2 text-[10px] font-black text-gray-500">
            <span>${escapeHtml(item.label)} &bull; ${item.count}</span>
            <span>${formatMoney(item.total)}</span>
          </div>
          <div class="h-2 rounded-full bg-gray-100 overflow-hidden">
            <div class="h-full rounded-full ${colorClass}" style="width:${Math.max(4, Math.round((item.total / maxTotal) * 100))}%"></div>
          </div>
        </div>
      `).join('');
    }

    const CEO_FILTER_SELECT_IDS = ['vip-filter', 'updated-filter', 'members-filter', 'finance-month-filter', 'finance-plan-filter', 'edit-vip-sel', 'edit-vip-duration'];

    function isCeoFilterSelect(select) {
      return !!select && CEO_FILTER_SELECT_IDS.includes(String(select.id || ''));
    }

    function closeCeoCustomSelects(exceptId = '') {
      document.querySelectorAll('[data-ceo-dd-menu]').forEach((menu) => {
        if (exceptId && menu.getAttribute('data-ceo-dd-menu') === exceptId) return;
        menu.classList.add('hidden');
      });
      document.querySelectorAll('[data-ceo-dd-trigger]').forEach((trigger) => {
        if (exceptId && trigger.getAttribute('data-ceo-dd-trigger') === exceptId) return;
        trigger.setAttribute('aria-expanded', 'false');
      });
    }

    function syncCeoCustomSelect(select) {
      if (!isCeoFilterSelect(select)) return;
      const selectId = String(select.id || '');
      const selectedOption = select.options[select.selectedIndex] || select.options[0] || null;
      const label = document.querySelector(`[data-ceo-dd-label="${selectId}"]`);
      if (label) label.textContent = selectedOption ? selectedOption.textContent : 'Selecione';
      const trigger = document.querySelector(`[data-ceo-dd-trigger="${selectId}"]`);
      if (trigger) trigger.disabled = !!select.disabled;
      document.querySelectorAll(`[data-ceo-dd-option="${selectId}"]`).forEach((btn) => {
        const active = String(btn.getAttribute('data-value') || '') === String(select.value || '');
        btn.className = active
          ? 'w-full rounded-lg bg-emerald-50 px-3 py-2 text-left text-[11px] font-black text-emerald-700 transition dark:bg-emerald-500/15 dark:text-emerald-200'
          : 'w-full rounded-lg px-3 py-2 text-left text-[11px] font-black text-gray-600 transition hover:bg-gray-50 dark:text-gray-200 dark:hover:bg-gray-800';
        btn.setAttribute('aria-selected', active ? 'true' : 'false');
      });
    }

    function refreshCeoCustomSelect(select, refreshIcons = true) {
      if (!isCeoFilterSelect(select) || !select.id) return;
      const wrap = select.parentElement;
      if (!wrap) return;
      wrap.setAttribute('data-ceo-dd-root', select.id);
      wrap.classList.add('relative');
      Array.from(wrap.children).forEach((child) => {
        if (child !== select && child.tagName === 'I' && child.getAttribute('data-lucide') === 'chevron-down') child.classList.add('hidden');
      });
      wrap.querySelectorAll(`[data-ceo-dd-trigger="${select.id}"], [data-ceo-dd-menu="${select.id}"]`).forEach((node) => node.remove());

      select.style.position = 'absolute';
      select.style.opacity = '0';
      select.style.pointerEvents = 'none';
      select.style.width = '1px';
      select.style.height = '1px';
      select.style.left = '0';
      select.style.top = '0';
      select.tabIndex = -1;
      select.setAttribute('aria-hidden', 'true');

      const trigger = document.createElement('button');
      trigger.type = 'button';
      trigger.setAttribute('data-ceo-dd-trigger', select.id);
      trigger.setAttribute('aria-haspopup', 'listbox');
      trigger.setAttribute('aria-expanded', 'false');
      trigger.className = 'inline-flex w-full min-w-[9rem] items-center justify-between gap-2 rounded-xl border border-gray-200 bg-white px-3 py-2 text-left text-[11px] font-black text-gray-700 shadow-sm outline-none transition hover:bg-gray-50 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 dark:hover:bg-gray-800';
      trigger.innerHTML = `<span data-ceo-dd-label="${escapeHtml(select.id)}" class="truncate"></span><i data-lucide="chevron-down" class="h-4 w-4 shrink-0 text-gray-400"></i>`;

      const menu = document.createElement('div');
      menu.setAttribute('data-ceo-dd-menu', select.id);
      menu.setAttribute('role', 'listbox');
      menu.className = 'hidden absolute left-0 top-full z-[80] mt-1 max-h-64 min-w-full overflow-auto rounded-xl border border-gray-200 bg-white p-1 shadow-xl dark:border-gray-700 dark:bg-gray-900';

      Array.from(select.options).forEach((option) => {
        const item = document.createElement('button');
        item.type = 'button';
        item.setAttribute('role', 'option');
        item.setAttribute('data-ceo-dd-option', select.id);
        item.setAttribute('data-value', option.value);
        item.textContent = option.textContent || option.value;
        item.addEventListener('click', () => {
          select.value = option.value;
          select.dispatchEvent(new Event('change', { bubbles: true }));
          closeCeoCustomSelects();
          syncCeoCustomSelect(select);
        });
        menu.appendChild(item);
      });

      trigger.addEventListener('click', (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        if (select.disabled) return;
        const willOpen = menu.classList.contains('hidden');
        closeCeoCustomSelects(willOpen ? select.id : '');
        menu.classList.toggle('hidden', !willOpen);
        trigger.setAttribute('aria-expanded', willOpen ? 'true' : 'false');
      });

      select.insertAdjacentElement('afterend', trigger);
      trigger.insertAdjacentElement('afterend', menu);
      if (select.dataset.ceoDdBound !== '1') {
        select.dataset.ceoDdBound = '1';
        select.addEventListener('change', () => syncCeoCustomSelect(select));
      }
      syncCeoCustomSelect(select);
      if (refreshIcons) initIcons();
    }

    function initCeoCustomSelects() {
      CEO_FILTER_SELECT_IDS.forEach((id) => {
        const select = document.getElementById(id);
        if (select) refreshCeoCustomSelect(select);
      });
      if (window.__ceoCustomSelectGlobalBound !== true) {
        window.__ceoCustomSelectGlobalBound = true;
        document.addEventListener('click', (ev) => {
          if (!ev.target?.closest?.('[data-ceo-dd-root]')) closeCeoCustomSelects();
        });
      }
    }

    function renderFinanceSummary(solicitaDocs = []) {
      const box = document.getElementById('finance-summary');
      if (!box) return;

      lastFinanceSolicitaDocs = solicitaDocs || [];
      const partnerDataReady = hydratePartnersFromCacheForFinance();
      const payments = lastFinanceSolicitaDocs.flatMap(approvedPaymentsFromSolicita);
      hydrateFinanceFilters(payments);
      syncFinanceDeleteButton();

      const monthFilter = financeSelectValue('finance-month-filter');
      const planFilter = financeSelectValue('finance-plan-filter');
      const filteredPayments = payments.filter((p) => {
        const plan = normalizeVip(p.plano || p.approvedVipTier || 'free');
        if (monthFilter !== 'all' && financeMonthKey(p) !== monthFilter) return false;
        if (planFilter !== 'all' && plan !== normalizeVip(planFilter)) return false;
        return true;
      });

      const totals = filteredPayments.reduce((acc, p) => {
        const amount = roundMoney(toMoneyNumber(p.amount || p.valorPago || 0));
        const txFee = estimatedTransactionFee(amount);
        const affiliate = affiliateFeeForPayment(p, amount, partnerDataReady);
        const affFee = affiliate.fee;
        const netAmount = roundMoney(amount - txFee - affFee);
        const plan = normalizeVip(p.plano || p.approvedVipTier || 'free');
        acc.bruto += amount;
        acc.transacao += txFee;
        acc.afiliado += affFee;
        acc.lucro += netAmount;
        acc.count += 1;
        if (affiliate.known && (affFee > 0 || p.affiliateCommissionApplied === true || p.afiliadoContabilizado === true || p.comissaoAfiliadoAplicada === true)) acc.affiliateCount += 1;
        addFinanceBucket(acc.byPlan, plan, prettyVipName(plan), netAmount);
        addFinanceBucket(acc.byMonth, financeMonthKey(p), financeMonthLabel(financeMonthKey(p)), netAmount);
        return acc;
      }, { bruto: 0, transacao: 0, afiliado: 0, lucro: 0, count: 0, affiliateCount: 0, byPlan: {}, byMonth: {} });

      const planBars = renderFinanceBars(Object.values(totals.byPlan).sort((a, b) => b.total - a.total), 'bg-emerald-500');
      const monthBars = renderFinanceBars(Object.values(totals.byMonth).sort((a, b) => String(b.key).localeCompare(String(a.key))), 'bg-sky-500');
      const affiliateText = partnerDataReady ? formatMoney(totals.afiliado) : 'Sem dados';
      const affiliateCountText = partnerDataReady ? totals.affiliateCount : 'Sem dados';
      const profitText = partnerDataReady ? formatMoney(totals.lucro) : 'Sem dados';
      const partnerHint = partnerDataReady ? 'monetize carregado' : 'carregue a aba Parceiros';

      box.innerHTML = `
        <div class="bg-white border border-gray-200 rounded-2xl p-4 shadow-sm">
          <p class="text-[10px] font-black text-gray-400 uppercase">Entrada bruta</p>
          <p class="mt-1 text-2xl font-black text-gray-900">${formatMoney(totals.bruto)}</p>
        </div>
        <div class="bg-white border border-gray-200 rounded-2xl p-4 shadow-sm">
          <p class="text-[10px] font-black text-gray-400 uppercase">Taxa transação 0,99%</p>
          <p class="mt-1 text-2xl font-black text-amber-700">${formatMoney(totals.transacao)}</p>
        </div>
        <div class="bg-white border border-gray-200 rounded-2xl p-4 shadow-sm">
          <p class="text-[10px] font-black text-gray-400 uppercase">Taxa afiliado</p>
          <p class="mt-1 text-2xl font-black text-sky-700">${affiliateText}</p>
          <p class="mt-1 text-[10px] font-bold text-gray-400">${partnerHint}</p>
        </div>
        <div class="bg-white border border-gray-200 rounded-2xl p-4 shadow-sm">
          <p class="text-[10px] font-black text-gray-400 uppercase">Lucro estimado</p>
          <p class="mt-1 text-2xl font-black text-emerald-700">${profitText}</p>
        </div>
        <div class="bg-white border border-gray-200 rounded-2xl p-4 shadow-sm">
          <p class="text-[10px] font-black text-gray-400 uppercase">Pagamentos</p>
          <p class="mt-1 text-2xl font-black text-gray-900">${totals.count}</p>
        </div>
        <div class="bg-white border border-gray-200 rounded-2xl p-4 shadow-sm">
          <p class="text-[10px] font-black text-gray-400 uppercase">Com afiliado</p>
          <p class="mt-1 text-2xl font-black text-indigo-700">${affiliateCountText}</p>
        </div>
        <div class="sm:col-span-2 xl:col-span-3 bg-white border border-gray-200 rounded-2xl p-4 shadow-sm space-y-3">
          <div class="flex items-center justify-between gap-2">
            <p class="text-xs font-black text-gray-700">Entradas por plano</p>
            <p class="text-[10px] text-gray-400 font-bold">líquido aprovado</p>
          </div>
          ${planBars || '<p class="text-xs text-gray-400">Nenhum pagamento aprovado ainda.</p>'}
        </div>
        <div class="sm:col-span-2 xl:col-span-3 bg-white border border-gray-200 rounded-2xl p-4 shadow-sm space-y-3">
          <div class="flex items-center justify-between gap-2">
            <p class="text-xs font-black text-gray-700">Entradas por mês</p>
            <p class="text-[10px] text-gray-400 font-bold">líquido aprovado</p>
          </div>
          ${monthBars || '<p class="text-xs text-gray-400">Nenhum pagamento aprovado ainda.</p>'}
        </div>
      `;
    }

    async function loadFinanceSummary(force = false) {
      if (!force) {
        const cached = readFinanceCache();
        if (cached) {
          renderFinanceSummary(cached);
          return;
        }
      } else {
        try { localStorage.removeItem(FINANCE_CACHE_KEY); } catch (_) {}
      }

      try {
        const snap = await getDocs(collection(db, 'solicita'));
        const docs = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        writeFinanceCache(docs);
        renderFinanceSummary(docs);
      } catch (e) {
        console.error(e);
        renderFinanceSummary([]);
      }
    }

    function showCeoConfirm({ title, message, confirmLabel = 'Confirmar', onConfirm }) {
      let root = document.getElementById('ceo-confirm-root');
      if (!root) {
        root = document.createElement('div');
        root.id = 'ceo-confirm-root';
        document.body.appendChild(root);
      }
      root.className = 'fixed inset-0 z-[90] flex items-center justify-center bg-gray-950/55 px-4';
      root.innerHTML = `
        <div class="w-full max-w-md rounded-2xl border border-gray-200 bg-white p-5 shadow-2xl">
          <div class="flex items-start gap-3">
            <div class="grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-red-50 text-red-600">
              <i data-lucide="triangle-alert" class="h-5 w-5"></i>
            </div>
            <div class="min-w-0">
              <h3 class="text-base font-black text-gray-900">${escapeHtml(title)}</h3>
              <p class="mt-1 text-sm font-medium leading-relaxed text-gray-500">${escapeHtml(message)}</p>
            </div>
          </div>
          <div class="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <button type="button" data-ceo-cancel class="inline-flex items-center justify-center rounded-xl border border-gray-200 bg-white px-4 py-2 text-xs font-black text-gray-600 transition hover:bg-gray-50">Cancelar</button>
            <button type="button" data-ceo-confirm class="inline-flex items-center justify-center gap-2 rounded-xl bg-red-600 px-4 py-2 text-xs font-black text-white transition hover:bg-red-700">
              <i data-lucide="trash-2" class="h-4 w-4"></i>
              ${escapeHtml(confirmLabel)}
            </button>
          </div>
        </div>
      `;
      const close = () => {
        root.className = 'hidden';
        root.innerHTML = '';
        root.onclick = null;
      };
      root.querySelector('[data-ceo-cancel]')?.addEventListener('click', close);
      root.onclick = (ev) => { if (ev.target === root) close(); };
      root.querySelector('[data-ceo-confirm]')?.addEventListener('click', async (ev) => {
        const btn = ev.currentTarget;
        btn.disabled = true;
        btn.classList.add('opacity-60', 'cursor-wait');
        try {
          await onConfirm?.();
          close();
        } catch (error) {
          console.error(error);
        } finally {
          btn.disabled = false;
          btn.classList.remove('opacity-60', 'cursor-wait');
        }
      });
      initIcons();
    }

    async function commitFinanceWrites(writes = []) {
      for (let i = 0; i < writes.length; i += 450) {
        const batch = writeBatch(db);
        writes.slice(i, i + 450).forEach((item) => {
          if (item.type === 'delete') batch.delete(item.ref);
          else if (item.type === 'update') batch.update(item.ref, item.data);
          else batch.set(item.ref, item.data, { merge: true });
        });
        await batch.commit();
      }
    }

    async function deleteFinanceMonthData(monthKey) {
      if (!monthKey || monthKey === 'all' || monthKey === FINANCE_UNKNOWN_MONTH) {
        showToast('info', 'Escolha um mês específico para excluir.');
        return;
      }

      const docs = lastFinanceSolicitaDocs.length ? lastFinanceSolicitaDocs : (readFinanceCache() || []);
      const writes = [];
      let removedPayments = 0;

      docs.forEach((s) => {
        if (!s?.id) return;
        const ref = doc(db, 'solicita', s.id);
        const pagamentos = s.pagamentos && typeof s.pagamentos === 'object' ? s.pagamentos : null;

        if (pagamentos) {
          const remaining = {};
          const removedKeys = [];
          let changed = false;
          Object.entries(pagamentos).forEach(([key, value]) => {
            const row = { ...value, paymentKey: key, docId: s.id, guildId: value.guildId || s.guildId, uid: value.uid || s.uid, solicitaDoc: s };
            if (isApprovedPayment(value) && financeMonthKey(row) === monthKey) {
              changed = true;
              removedKeys.push(key);
              removedPayments += 1;
            } else {
              remaining[key] = value;
            }
          });

          if (changed) {
            const remainingApproved = Object.values(remaining).some(isApprovedPayment);
            const payload = {
              updatedAt: serverTimestamp(),
              updatedAtMs: Date.now()
            };
            removedKeys.forEach((key) => {
              payload[`pagamentos.${key}`] = deleteField();
            });
            if (!remainingApproved && String(s.status || '').toLowerCase() === 'aprovado') {
              payload.status = 'removido_mes';
              payload.removedMonth = monthKey;
              payload.amount = 0;
              payload.affiliateFee = 0;
              payload.transactionFee = 0;
            }
            writes.push({ type: 'update', ref, data: payload });
          }
          return;
        }

        if (String(s.status || '').toLowerCase() === 'aprovado' && financeMonthKey({ ...s, solicitaDoc: s }) === monthKey) {
          writes.push({ type: 'delete', ref });
          removedPayments += 1;
        }
      });

      if (!writes.length) {
        showToast('info', 'Nenhum pagamento aprovado encontrado nesse mês.');
        return;
      }

      await commitFinanceWrites(writes);
      try { localStorage.removeItem(FINANCE_CACHE_KEY); } catch (_) {}
      await loadFinanceSummary(true);
      if (!document.getElementById('solicita-panel')?.classList.contains('hidden')) loadSolicita();
      showToast('success', `${removedPayments} pagamento(s) removido(s) desse mês.`);
    }

    window.confirmDeleteFinanceMonth = () => {
      const month = financeSelectValue('finance-month-filter');
      if (!month || month === 'all' || month === FINANCE_UNKNOWN_MONTH) {
        showToast('info', 'Escolha um mês específico para excluir.');
        return;
      }
      const count = lastFinanceSolicitaDocs
        .flatMap(approvedPaymentsFromSolicita)
        .filter((p) => financeMonthKey(p) === month).length;
      showCeoConfirm({
        title: 'Excluir dados do mês',
        message: `Isso remove ${count} pagamento(s) aprovado(s) de ${financeMonthLabel(month)} na coleção solicita. Essa ação não mexe nos planos ativos das guildas.`,
        confirmLabel: 'Excluir mês',
        onConfirm: () => deleteFinanceMonthData(month)
      });
    };

    async function loadPlansCatalogOnly(force = false) {
      if (!force && allPlansAdmin.length) return allPlansAdmin;
      if (!force) {
        try {
          const parsed = JSON.parse(localStorage.getItem(PLANS_ADMIN_CACHE_KEY) || 'null');
          if (parsed?.plans && (Date.now() - Number(parsed.ts || 0)) < LIST_CACHE_TTL_MS) {
            allPlansAdmin = parsed.plans;
            return allPlansAdmin;
          }
        } catch (_) {}
      }

      const snap = await getDocs(collection(db, 'planos'));
      const planMap = new Map(PLAN_ADMIN_DEFAULTS.map((p) => [p.id, { ...p, sourceId: p.sourceId || p.id }]));
      snap.forEach((d) => {
        const data = d.data() || {};
        if (isAddonDoc(d.id, data)) return;
        const plan = hydratePlanAdmin(d.id, data);
        planMap.set(plan.id, { ...(planMap.get(plan.id) || {}), ...plan });
      });
      allPlansAdmin = Array.from(planMap.values()).sort((a, b) => (Number(a.price || 0) - Number(b.price || 0)) || ((a.order || 0) - (b.order || 0)));
      localStorage.setItem(PLANS_ADMIN_CACHE_KEY, JSON.stringify({ ts: Date.now(), plans: allPlansAdmin }));
      return allPlansAdmin;
    }

    async function loadPlansAdmin(force = false) {
      const grid = document.getElementById('plans-admin-grid');
      if (grid) {
        grid.innerHTML = `<div class="col-span-full py-10 text-center text-gray-400">A carregar planos...</div>`;
      }

      if (force) {
        try { localStorage.removeItem(PLANS_ADMIN_CACHE_KEY); } catch (_) {}
        try { localStorage.removeItem(FINANCE_CACHE_KEY); } catch (_) {}
      }

      const cached = localStorage.getItem(PLANS_ADMIN_CACHE_KEY);
      if (!force && cached) {
        try {
          const parsed = JSON.parse(cached);
          if (parsed?.plans && (Date.now() - Number(parsed.ts || 0)) < LIST_CACHE_TTL_MS) {
            allPlansAdmin = parsed.plans;
            allPlanAddonsAdmin = [];
            renderPlansAdmin();
            loadFinanceSummary();
            return;
          }
        } catch (_) {}
      }

      try {
        const snap = await getDocs(collection(db, 'planos'));
        const planMap = new Map(PLAN_ADMIN_DEFAULTS.map((p) => [p.id, { ...p, sourceId: p.sourceId || p.id }]));

        snap.forEach((d) => {
          const data = d.data() || {};
          if (isAddonDoc(d.id, data)) return;
          const plan = hydratePlanAdmin(d.id, data);
          if (plan.id && plan.id !== 'free') planMap.set(plan.id, { ...(planMap.get(plan.id) || {}), ...plan });
          else planMap.set(plan.id, { ...(planMap.get(plan.id) || {}), ...plan });
        });

        allPlansAdmin = Array.from(planMap.values()).sort((a, b) => (Number(a.price || 0) - Number(b.price || 0)) || ((a.order || 0) - (b.order || 0)));
        allPlanAddonsAdmin = [];
        localStorage.setItem(PLANS_ADMIN_CACHE_KEY, JSON.stringify({ ts: Date.now(), plans: allPlansAdmin }));
        renderPlansAdmin();
        loadFinanceSummary(force);
        if (force) showToast('success', 'Planos atualizados.');
      } catch (e) {
        console.error(e);
        if (grid) grid.innerHTML = `<div class="col-span-full py-10 text-center text-red-500">Erro ao carregar planos.</div>`;
        showToast('error', 'Falha ao carregar planos.');
      }
    }

    function planAdminCard(plan) {
      const access = (plan.access || []).join('\n');
      const noAccess = (plan.noAccess || []).join('\n');
      const disabledCheckout = plan.id === 'free' || plan.id === 'parceiro';
      const isSystemPlan = SYSTEM_PLAN_IDS.includes(plan.id);
      return `
        <div class="bg-white border border-gray-200 rounded-2xl p-4 shadow-sm space-y-3" data-plan-admin="${escapeHtml(plan.id)}" style="content-visibility:auto;contain-intrinsic-size:auto 520px">
          <div class="flex items-start justify-between gap-3">
            <div>
              <p class="text-[10px] font-black text-emerald-600 uppercase tracking-wider">Plano</p>
              <h4 class="text-lg font-black text-gray-900">${escapeHtml(plan.name)}</h4>
              <p class="text-[10px] text-gray-400 font-mono">${escapeHtml(plan.sourceId || plan.id)}</p>
            </div>
            <span class="px-2 py-1 rounded-lg bg-gray-100 text-gray-600 text-[10px] font-black">${prettyVipName(plan.id)}</span>
          </div>
          <div class="grid grid-cols-1 sm:grid-cols-3 gap-2">
            <label class="text-xs font-bold text-gray-600">Nome<input data-plan-field="name" value="${escapeHtml(plan.name)}" class="mt-1 w-full rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-sm"></label>
            <label class="text-xs font-bold text-gray-600">Valor<input data-plan-field="price" value="${escapeHtml(plan.price)}" class="mt-1 w-full rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-sm"></label>
            <label class="text-xs font-bold text-gray-600">Ciclo<select data-plan-field="period" class="mt-1 w-full ${SELECT_UI_CLASS} text-sm">
              <option value="monthly" ${plan.period === 'monthly' ? 'selected' : ''}>Mensal</option>
              <option value="yearly" ${plan.period === 'yearly' ? 'selected' : ''}>Anual</option>
              <option value="partner" ${plan.period === 'partner' ? 'selected' : ''}>Parceiro</option>
            </select></label>
          </div>
          <div class="grid grid-cols-1 sm:grid-cols-4 gap-2">
            <label class="text-xs font-bold text-gray-600">Selo<input data-plan-field="badge" value="${escapeHtml(plan.badge || '')}" placeholder="Popular" class="mt-1 w-full rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-sm"></label>
            <label class="text-xs font-bold text-gray-600">Ordem<input data-plan-field="order" value="${escapeHtml(plan.order || 0)}" class="mt-1 w-full rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-sm"></label>
            <label class="text-xs font-bold text-gray-600">Dias<input data-plan-field="durationDays" value="${escapeHtml(plan.durationDays ?? '')}" placeholder="30" class="mt-1 w-full rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-sm"></label>
            <label class="text-xs font-bold text-gray-600">Afiliado %<input data-plan-field="affiliatePercent" value="${escapeHtml(plan.affiliatePercent ?? 0)}" placeholder="20" class="mt-1 w-full rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-sm"></label>
          </div>
          <label class="text-xs font-bold text-gray-600 block">O que libera<textarea data-plan-field="access" class="mt-1 min-h-[120px] w-full rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-sm">${escapeHtml(access)}</textarea></label>
          <label class="text-xs font-bold text-gray-600 block">O que não libera<textarea data-plan-field="noAccess" class="mt-1 min-h-[90px] w-full rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-sm">${escapeHtml(noAccess)}</textarea></label>
          <label class="text-xs font-bold text-gray-600 block">Aviso antes da assinatura<textarea data-plan-field="warning" placeholder="Ex: recurso beta, pode mudar durante os testes." class="mt-1 min-h-[90px] w-full rounded-xl border border-amber-100 bg-amber-50/60 px-3 py-2 text-sm">${escapeHtml(plan.warning || '')}</textarea></label>
          <label class="text-xs font-bold text-gray-600 block">Observação<textarea data-plan-field="note" class="mt-1 min-h-[70px] w-full rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-sm">${escapeHtml(plan.note || '')}</textarea></label>
          <div class="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs font-bold text-gray-600">
            <label class="flex items-center gap-2 rounded-xl bg-gray-50 border border-gray-200 px-3 py-2"><input data-plan-field="active" type="checkbox" ${plan.active ? 'checked' : ''}> Ativo</label>
            <label class="flex items-center gap-2 rounded-xl bg-gray-50 border border-gray-200 px-3 py-2"><input data-plan-field="visible" type="checkbox" ${plan.visible ? 'checked' : ''}> Visível</label>
            <label class="flex items-center gap-2 rounded-xl bg-gray-50 border border-gray-200 px-3 py-2"><input data-plan-field="popular" type="checkbox" ${plan.popular ? 'checked' : ''}> Popular</label>
            <label class="flex items-center gap-2 rounded-xl bg-gray-50 border border-gray-200 px-3 py-2 ${disabledCheckout ? 'opacity-60' : ''}"><input data-plan-field="purchasable" type="checkbox" ${plan.purchasable ? 'checked' : ''} ${disabledCheckout ? 'disabled' : ''}> Vende</label>
          </div>
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <button type="button" onclick="window.savePlanAdmin('${safeJsString(plan.id)}')" class="w-full rounded-xl bg-emerald-600 px-4 py-3 text-xs font-black text-white hover:bg-emerald-700 transition">SALVAR PLANO</button>
            <button type="button" onclick="window.removePlanAdmin('${safeJsString(plan.id)}')" class="w-full rounded-xl ${isSystemPlan ? 'bg-gray-100 text-gray-500 hover:bg-gray-200' : 'bg-red-50 text-red-700 hover:bg-red-100'} px-4 py-3 text-xs font-black transition">${isSystemPlan ? 'OCULTAR PLANO' : 'REMOVER PLANO'}</button>
          </div>
        </div>
      `;
    }

    function addonAdminCard(addon) {
      return `
        <div class="bg-white border border-sky-100 rounded-2xl p-4 shadow-sm space-y-3" data-addon-admin="${escapeHtml(addon.id)}">
          <div class="flex items-start justify-between gap-3">
            <div>
              <p class="text-[10px] font-black text-sky-600 uppercase tracking-wider">Adicional</p>
              <h4 class="text-lg font-black text-gray-900">${escapeHtml(addon.name)}</h4>
              <p class="text-[10px] text-gray-400 font-mono">${escapeHtml(addon.id)}</p>
            </div>
            <span class="px-2 py-1 rounded-lg bg-sky-50 text-sky-700 text-[10px] font-black">${formatMoney(addon.price)}</span>
          </div>
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <label class="text-xs font-bold text-gray-600">Nome<input data-addon-field="name" value="${escapeHtml(addon.name)}" class="mt-1 w-full rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-sm"></label>
            <label class="text-xs font-bold text-gray-600">Valor<input data-addon-field="price" value="${escapeHtml(addon.price)}" class="mt-1 w-full rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-sm"></label>
          </div>
          <label class="text-xs font-bold text-gray-600 block">Descrição<input data-addon-field="description" value="${escapeHtml(addon.description || '')}" class="mt-1 w-full rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-sm"></label>
          <label class="text-xs font-bold text-gray-600 block">Planos permitidos<input data-addon-field="plans" value="${escapeHtml((addon.plans || []).join(', '))}" placeholder="plus, pro, business, ultra" class="mt-1 w-full rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-sm"></label>
          <div class="grid grid-cols-2 gap-2 text-xs font-bold text-gray-600">
            <label class="flex items-center gap-2 rounded-xl bg-gray-50 border border-gray-200 px-3 py-2"><input data-addon-field="active" type="checkbox" ${addon.active ? 'checked' : ''}> Ativo</label>
            <label class="flex items-center gap-2 rounded-xl bg-gray-50 border border-gray-200 px-3 py-2"><input data-addon-field="visible" type="checkbox" ${addon.visible ? 'checked' : ''}> Visível</label>
          </div>
          <button type="button" onclick="window.saveAddonAdmin('${safeJsString(addon.id)}')" class="w-full rounded-xl bg-sky-600 px-4 py-3 text-xs font-black text-white hover:bg-sky-700 transition">SALVAR ADICIONAL</button>
        </div>
      `;
    }

    function renderPlansAdmin() {
      const q = activeSearchQuery('plans');
      const grid = document.getElementById('plans-admin-grid');
      if (!grid) return;
      adminViewRendered.plans = true;
      const plans = allPlansAdmin.filter((p) => !q || [p.id, p.name, p.badge, p.note, p.warning, ...(p.access || []), ...(p.noAccess || [])].join(' ').toLowerCase().includes(q));
      grid.innerHTML = plans.map(planAdminCard).join('') || `<div class="col-span-full py-10 text-center text-gray-400">Nenhum plano encontrado.</div>`;
      initIcons();
    }

    function linesFromTextarea(value) {
      return String(value || '').split(/\r?\n|;/g).map((x) => x.trim()).filter(Boolean);
    }

    window.savePlanAdmin = async (planId) => {
      const plan = allPlansAdmin.find((p) => p.id === planId);
      const card = document.querySelector(`[data-plan-admin="${cssEscapeValue(planId)}"]`);
      if (!plan || !card) return showToast('error', 'Plano não encontrado.');
      const val = (name) => card.querySelector(`[data-plan-field="${name}"]`);
      const docId = plan.sourceId || plan.id;
      const payload = {
        name: val('name')?.value?.trim() || plan.name,
        nome: val('name')?.value?.trim() || plan.name,
        price: roundMoney(toMoneyNumber(val('price')?.value || 0)),
        preco: roundMoney(toMoneyNumber(val('price')?.value || 0)),
        period: val('period')?.value || plan.period || 'monthly',
        durationDays: Number(val('durationDays')?.value || 0) || null,
        duracaoDias: Number(val('durationDays')?.value || 0) || null,
        affiliatePercent: Math.max(0, Number(val('affiliatePercent')?.value || 0) || 0),
        afiliadoPercent: Math.max(0, Number(val('affiliatePercent')?.value || 0) || 0),
        order: Number(val('order')?.value || plan.order || 0),
        active: !!val('active')?.checked,
        visible: !!val('visible')?.checked,
        popular: !!val('popular')?.checked,
        purchasable: (plan.id === 'free' || plan.id === 'parceiro') ? false : !!val('purchasable')?.checked,
        badge: val('badge')?.value?.trim() || '',
        access: linesFromTextarea(val('access')?.value),
        noAccess: linesFromTextarea(val('noAccess')?.value),
        warning: val('warning')?.value?.trim() || '',
        aviso: val('warning')?.value?.trim() || '',
        note: val('note')?.value?.trim() || '',
        updatedAt: serverTimestamp(),
        updatedAtMs: Date.now()
      };

      try {
        await setDoc(doc(db, 'planos', docId), payload, { merge: true });
        Object.assign(plan, hydratePlanAdmin(docId, payload));
        localStorage.removeItem(PLANS_ADMIN_CACHE_KEY);
        renderPlansAdmin();
        showToast('success', 'Plano salvo.');
      } catch (e) {
        console.error(e);
        showToast('error', 'Erro ao salvar plano.');
      }
    };

    window.openCreatePlanAdmin = () => {
      const body = document.getElementById('drawer-body');
      document.getElementById('drawer-title').textContent = 'Novo plano';
      document.getElementById('drawer-content').innerHTML = `
        <div class="space-y-4">
          <div class="rounded-2xl border border-sky-100 bg-sky-50 p-4 text-xs text-sky-800 font-bold">
            O ID vira o documento em planos. Use algo simples, tipo elite, ultra2 ou mensal-premium.
          </div>
          <label class="text-xs font-bold text-gray-600 block">ID do plano<input id="new-plan-id" placeholder="elite" class="mt-1 w-full rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-sm"></label>
          <label class="text-xs font-bold text-gray-600 block">Nome<input id="new-plan-name" placeholder="ELITE" class="mt-1 w-full rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-sm"></label>
          <div class="grid grid-cols-2 gap-2">
            <label class="text-xs font-bold text-gray-600 block">Valor<input id="new-plan-price" placeholder="19,99" class="mt-1 w-full rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-sm"></label>
            <label class="text-xs font-bold text-gray-600 block">Ciclo<select id="new-plan-period" class="mt-1 w-full ${SELECT_UI_CLASS} text-sm">
              <option value="monthly">Mensal</option>
              <option value="yearly">Anual</option>
              <option value="partner">Parceiro</option>
            </select></label>
          </div>
          <div class="grid grid-cols-2 gap-2">
            <label class="text-xs font-bold text-gray-600 block">Dias<input id="new-plan-days" placeholder="30" class="mt-1 w-full rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-sm"></label>
            <label class="text-xs font-bold text-gray-600 block">Afiliado %<input id="new-plan-affiliate" placeholder="0" class="mt-1 w-full rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-sm"></label>
          </div>
          <label class="text-xs font-bold text-gray-600 block">O que libera<textarea id="new-plan-access" class="mt-1 min-h-[110px] w-full rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-sm"></textarea></label>
          <label class="text-xs font-bold text-gray-600 block">Aviso antes da assinatura<textarea id="new-plan-warning" class="mt-1 min-h-[90px] w-full rounded-xl border border-amber-100 bg-amber-50/60 px-3 py-2 text-sm"></textarea></label>
          <button type="button" onclick="window.saveNewPlanAdmin()" class="w-full rounded-xl bg-sky-600 px-4 py-3 text-xs font-black text-white hover:bg-sky-700 transition">CRIAR PLANO</button>
        </div>
      `;
      document.getElementById('drawer').classList.remove('hidden');
      setTimeout(() => body.classList.remove('translate-x-full'), 20);
      initIcons();
    };

    window.saveNewPlanAdmin = async () => {
      const rawId = document.getElementById('new-plan-id')?.value || '';
      const docId = String(rawId).toLowerCase().trim().replace(/\s+/g, '-').replace(/[^a-z0-9_-]/g, '');
      if (!docId || docId === 'free' || docId === 'parceiro' || docId.includes('/')) {
        return showToast('error', 'Informe um ID valido para o novo plano.');
      }
      const name = document.getElementById('new-plan-name')?.value?.trim() || docId.toUpperCase();
      const price = roundMoney(toMoneyNumber(document.getElementById('new-plan-price')?.value || 0));
      const period = document.getElementById('new-plan-period')?.value || 'monthly';
      const durationDays = Number(document.getElementById('new-plan-days')?.value || 0) || defaultDurationDays(docId, period);
      const affiliatePercent = Math.max(0, Number(document.getElementById('new-plan-affiliate')?.value || 0) || 0);
      const warning = document.getElementById('new-plan-warning')?.value?.trim() || '';
      const payload = {
        name,
        nome: name,
        price,
        preco: price,
        period,
        durationDays,
        duracaoDias: durationDays,
        affiliatePercent,
        afiliadoPercent: affiliatePercent,
        order: allPlansAdmin.length ? Math.max(...allPlansAdmin.map((p) => Number(p.order || 0))) + 10 : 10,
        active: true,
        visible: true,
        purchasable: price > 0 && period !== 'partner',
        access: linesFromTextarea(document.getElementById('new-plan-access')?.value),
        noAccess: [],
        warning,
        aviso: warning,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        updatedAtMs: Date.now()
      };

      try {
        await setDoc(doc(db, 'planos', docId), payload, { merge: false });
        allPlansAdmin.push(hydratePlanAdmin(docId, payload));
        allPlansAdmin.sort((a, b) => (Number(a.price || 0) - Number(b.price || 0)) || ((a.order || 0) - (b.order || 0)));
        localStorage.removeItem(PLANS_ADMIN_CACHE_KEY);
        renderPlansAdmin();
        closeDrawer();
        showToast('success', 'Plano criado.');
      } catch (e) {
        console.error(e);
        showToast('error', 'Erro ao criar plano.');
      }
    };

    window.removePlanAdmin = async (planId) => {
      const plan = allPlansAdmin.find((p) => p.id === planId);
      if (!plan) return showToast('error', 'Plano nao encontrado.');
      const systemPlan = SYSTEM_PLAN_IDS.includes(plan.id);
      const question = systemPlan
        ? `Ocultar ${plan.name}? Ele deixa de aparecer na assinatura, mas pode ser reativado depois.`
        : `Remover ${plan.name}? Esta acao apaga o documento do plano.`;
      if (!confirm(question)) return;

      try {
        const docId = plan.sourceId || plan.id;
        if (systemPlan) {
          await setDoc(doc(db, 'planos', docId), {
            active: false,
            visible: false,
            purchasable: false,
            updatedAt: serverTimestamp(),
            updatedAtMs: Date.now()
          }, { merge: true });
          Object.assign(plan, { active: false, visible: false, purchasable: false });
        } else {
          await deleteDoc(doc(db, 'planos', docId));
          allPlansAdmin = allPlansAdmin.filter((p) => p.id !== plan.id);
        }
        localStorage.removeItem(PLANS_ADMIN_CACHE_KEY);
        renderPlansAdmin();
        showToast('success', systemPlan ? 'Plano ocultado.' : 'Plano removido.');
      } catch (e) {
        console.error(e);
        showToast('error', 'Erro ao remover plano.');
      }
    };

    window.saveAddonAdmin = async (addonId) => {
      const addon = allPlanAddonsAdmin.find((a) => a.id === addonId);
      const card = document.querySelector(`[data-addon-admin="${cssEscapeValue(addonId)}"]`);
      if (!addon || !card) return showToast('error', 'Adicional não encontrado.');
      const val = (name) => card.querySelector(`[data-addon-field="${name}"]`);
      const payload = {
        tipo: 'adicional',
        type: 'addon',
        name: val('name')?.value?.trim() || addon.name,
        nome: val('name')?.value?.trim() || addon.name,
        price: roundMoney(toMoneyNumber(val('price')?.value || 0)),
        preco: roundMoney(toMoneyNumber(val('price')?.value || 0)),
        description: val('description')?.value?.trim() || '',
        descricao: val('description')?.value?.trim() || '',
        plans: String(val('plans')?.value || '').split(/[,\s;]+/g).map(canonicalPlanId).filter((x) => x && x !== 'free'),
        active: !!val('active')?.checked,
        visible: !!val('visible')?.checked,
        updatedAt: serverTimestamp(),
        updatedAtMs: Date.now()
      };

      try {
        await setDoc(doc(db, 'planos', addonId), payload, { merge: true });
        Object.assign(addon, hydrateAddonAdmin(addonId, payload));
        localStorage.removeItem(PLANS_ADMIN_CACHE_KEY);
        renderPlansAdmin();
        showToast('success', 'Adicional salvo.');
      } catch (e) {
        console.error(e);
        showToast('error', 'Erro ao salvar adicional.');
      }
    };

    async function hydratePartnerCommissionSummaries(partners = []) {
      const list = Array.isArray(partners) ? partners : [];
      const hydrated = [];
      for (let index = 0; index < list.length; index += 8) {
        const chunk = await Promise.all(list.slice(index, index + 8).map(async (partner) => {
          const partnerId = String(partner.id || '').trim();
          if (!partnerId) return partner;
          try {
            const snap = await getDocs(collection(db, 'monetize', partnerId, 'comissoes'));
            const financeComissoes = snap.docs.map((d) => ({ id: d.id, partnerId, ...d.data() }));
            return { ...partner, financeComissoes, financeComissoesLoaded: true, financeComissoesAttempted: true };
          } catch (_) {
            return {
              ...partner,
              financeComissoes: Array.isArray(partner.financeComissoes) ? partner.financeComissoes : [],
              financeComissoesLoaded: false,
              financeComissoesAttempted: true
            };
          }
        }));
        hydrated.push(...chunk);
      }
      return hydrated;
    }

    function financePartnersNeedCommissionHydration(partners = []) {
      return (partners || []).some((p) => p.financeComissoesAttempted !== true && (p.financeComissoesLoaded !== true || !Array.isArray(p.financeComissoes)));
    }

    function refreshFinancePanelFromPartnerData() {
      if (currentAdminView !== 'plans') return;
      const docs = lastFinanceSolicitaDocs.length ? lastFinanceSolicitaDocs : (readFinanceCache() || []);
      renderFinanceSummary(docs);
    }

    function hydratePartnerCommissionsInBackground() {
      if (!allPartners.length || !financePartnersNeedCommissionHydration(allPartners)) {
        refreshFinancePanelFromPartnerData();
        return Promise.resolve(allPartners);
      }
      if (partnerCommissionHydrationPromise) return partnerCommissionHydrationPromise;
      partnerCommissionHydrationPromise = hydratePartnerCommissionSummaries(allPartners)
        .then((items) => {
          allPartners = items;
          window.allPartners = items;
          try { localStorage.setItem('hub_ceo_partners_v1', JSON.stringify({ ts: Date.now(), items })); } catch (_) {}
          if (currentAdminView === 'plans') refreshFinancePanelFromPartnerData();
          else financePartnerDataDirty = true;
          return items;
        })
        .catch((error) => {
          console.error('Falha ao carregar comissões em segundo plano:', error);
          return allPartners;
        })
        .finally(() => {
          partnerCommissionHydrationPromise = null;
        });
      return partnerCommissionHydrationPromise;
    }

    function schedulePartnerCommissionHydration(delay = 120) {
      setTimeout(() => {
        hydratePartnerCommissionsInBackground().catch((error) => console.error(error));
      }, delay);
    }

    async function loadPartners(force = false) {
      const grid = document.getElementById('partners-grid');
      if (grid && (force || !adminViewRendered.partners)) {
        grid.innerHTML = `<div class="col-span-full py-20 text-center space-y-3"><div class="inline-block animate-spin rounded-full h-8 w-8 border-4 border-amber-500 border-t-transparent"></div><p class="text-gray-500 font-medium">A carregar parceiros...</p></div>`;
      }

      if (force) {
        try { localStorage.removeItem('hub_ceo_partners_v1'); } catch (_) {}
      }

      const cached = localStorage.getItem('hub_ceo_partners_v1');
      if (!force && cached) {
        try {
          const parsed = JSON.parse(cached);
          if (parsed?.items && (Date.now() - Number(parsed.ts || 0)) < LIST_CACHE_TTL_MS) {
            allPartners = parsed.items;
            window.allPartners = allPartners;
            const statPartners = document.getElementById('stat-partners');
            if (statPartners) statPartners.textContent = allPartners.length;
            renderPartners();
            schedulePartnerCommissionHydration();
            return;
          }
        } catch (_) {}
      }

      try {
        // Leitura mínima: a aba Parceiros busca apenas /monetize.
        // Não relê /guildas, /configGuilda nem /users ao trocar de aba.
        // Para mostrar a guilda vinculada, reaproveita o que já estiver em memória/cache.
        const monetizeSnap = await getDocs(collection(db, 'monetize'));

        let configArr = window.allConfigGuilda || [];
        let guildsArr = window.allGuildas || [];
        if (!configArr.length || !guildsArr.length) {
          try {
            const cachedGuildas = localStorage.getItem('hub_ceo_guildas_v1');
            const cachedConfig = localStorage.getItem('hub_ceo_config_v1');
            if (cachedGuildas) guildsArr = JSON.parse(cachedGuildas)?.items || guildsArr;
            if (cachedConfig) configArr = JSON.parse(cachedConfig)?.items || configArr;
          } catch (_) {}
        }

        allPartners = monetizeSnap.docs.map((d) => {
          const data = { id: d.id, ...d.data() };
          const guildInfo = findGuildForPartner(data, configArr, guildsArr);
          return { ...data, ...guildInfo };
        }).sort((a, b) => {
          const pA = getPendingWithdraw(a) ? 1 : 0;
          const pB = getPendingWithdraw(b) ? 1 : 0;
          if (pA !== pB) return pB - pA;
          return toMoneyNumber(b.saldoAtual || 0) - toMoneyNumber(a.saldoAtual || 0);
        });

        window.allPartners = allPartners;
        localStorage.setItem('hub_ceo_partners_v1', JSON.stringify({ ts: Date.now(), items: allPartners }));
        const statPartners = document.getElementById('stat-partners');
        if (statPartners) statPartners.textContent = allPartners.length;
        renderPartners();
        schedulePartnerCommissionHydration();
        if (force) showToast('success', 'Parceiros atualizados.');
      } catch (e) {
        console.error(e);
        if (grid) grid.innerHTML = `<div class="col-span-full py-10 text-center text-red-500">Erro ao carregar parceiros.</div>`;
        showToast('error', 'Falha ao carregar parceiros.');
      }
    }

    function renderPartners() {
      const q = activeSearchQuery('partners');
      const filtered = allPartners.filter((p) => {
        const fields = [p.id, p.userId, p.gameId, p.uid, p.email, p.nick, p.pix, p.guildId, p.guildName, p.redesSociais].map((v) => String(v || '').toLowerCase());
        return !q || fields.some((x) => x.includes(q));
      });

      const grid = document.getElementById('partners-grid');
      if (!grid) return;
      adminViewRendered.partners = true;
      if (!filtered.length) {
        grid.innerHTML = `<div class="col-span-full py-10 text-center text-gray-400">Nenhum parceiro encontrado.</div>`;
        return;
      }

      grid.innerHTML = filtered.map((p) => {
        const pending = getPendingWithdraw(p);
        const saldo = toMoneyNumber(p.saldoAtual || p.saldoDisponivel || 0);
        const sacado = toMoneyNumber(p.saldoSacado || p.totalSacado || 0);
        const type = normalizePartnerType(p);
        const guildVip = prettyVipName(p.guildVip || 'free');
        const guildLabel = p.guildId ? `${escapeHtml(p.guildName || 'Guilda sem nome')} <span class="text-gray-400 font-mono">${escapeHtml(p.guildId)}</span>` : '<span class="text-red-500">Guilda não localizada</span>';
        return `
          <div class="bg-white border border-gray-100 rounded-3xl p-5 shadow-sm hover:shadow-xl transition-all duration-300" style="content-visibility:auto;contain-intrinsic-size:auto 330px">
            <div class="flex items-start justify-between gap-3 mb-4">
              <div class="min-w-0">
                <h4 class="font-black text-gray-900 truncate text-lg">${escapeHtml(p.nick || p.email || p.id)}</h4>
                <p class="text-[10px] text-gray-400 font-mono tracking-tighter break-all">${escapeHtml(p.id)}</p>
              </div>
              ${partnerTypeBadge(p)}
            </div>

            <div class="grid grid-cols-2 gap-2 mb-4">
              <div class="p-3 rounded-2xl bg-emerald-50 border border-emerald-100">
                <p class="text-[10px] font-black text-emerald-700 uppercase">Saldo</p>
                <p class="text-lg font-black text-emerald-900">${formatMoney(saldo)}</p>
              </div>
              <div class="p-3 rounded-2xl bg-slate-50 border border-slate-100">
                <p class="text-[10px] font-black text-slate-500 uppercase">Sacado</p>
                <p class="text-lg font-black text-slate-900">${formatMoney(sacado)}</p>
              </div>
            </div>

            <div class="space-y-2 mb-4 text-[11px] text-gray-500">
              <div class="flex items-start gap-2"><i data-lucide="mail" class="w-3.5 h-3.5 text-blue-500 mt-0.5"></i><span class="break-all"><b>Email:</b> ${escapeHtml(p.email || '—')}</span></div>
              <div class="flex items-start gap-2"><i data-lucide="shield" class="w-3.5 h-3.5 text-amber-500 mt-0.5"></i><span><b>Guilda:</b> ${guildLabel}</span></div>
              <div class="flex items-center gap-2"><i data-lucide="sparkles" class="w-3.5 h-3.5 text-purple-500"></i><span><b>Plano guilda:</b> ${guildVip}</span></div>
              <div class="flex items-center gap-2"><i data-lucide="users" class="w-3.5 h-3.5 text-emerald-500"></i><span><b>Convidados:</b> ${Number(p.totalConvidados || 0) || 0} • <b>Pagantes:</b> ${Number(p.totalPagantes || 0) || 0}</span></div>
            </div>

            ${pending ? `
              <div class="rounded-2xl bg-amber-50 border border-amber-100 p-3 mb-4">
                <p class="text-[10px] font-black text-amber-700 uppercase">Saque pendente</p>
                <p class="text-sm font-black text-amber-900">${formatMoney(pending.valor)}</p>
                <p class="text-[11px] text-amber-700 break-all">Pix: ${escapeHtml(pending.pix || '—')}</p>
              </div>
            ` : `<div class="rounded-2xl bg-gray-50 border border-gray-100 p-3 mb-4 text-[11px] text-gray-500 font-bold">Sem saque pendente.</div>`}

            <div class="grid grid-cols-2 gap-2">
              <button onclick="window.openPartnerDetails('${safeJsString(p.id)}')" class="py-2.5 rounded-xl bg-gray-50 text-gray-900 text-[11px] font-bold hover:bg-gray-100 transition border border-gray-100">DETALHES</button>
              ${type === 'verificado'
                ? `<button onclick="window.setPartnerNormal('${safeJsString(p.id)}')" class="py-2.5 rounded-xl bg-slate-900 text-white text-[11px] font-bold hover:bg-black transition">TORNAR NORMAL</button>`
                : `<button onclick="window.setPartnerVerified('${safeJsString(p.id)}')" class="py-2.5 rounded-xl bg-amber-500 text-white text-[11px] font-bold hover:bg-amber-600 transition">VERIFICAR</button>`}
              ${pending ? `<button onclick="window.approvePartnerWithdraw('${safeJsString(p.id)}')" class="col-span-1 py-2.5 rounded-xl bg-emerald-600 text-white text-[11px] font-bold hover:bg-emerald-700 transition">APROVAR SAQUE</button>
              <button onclick="window.rejectPartnerWithdraw('${safeJsString(p.id)}')" class="col-span-1 py-2.5 rounded-xl bg-red-50 text-red-600 text-[11px] font-bold hover:bg-red-100 transition border border-red-100">RECUSAR SAQUE</button>` : ''}
            </div>
          </div>
        `;
      }).join('');
      initIcons();
    }

    async function applyVipToGuild(guildId, tier) {
      const gid = String(guildId || '').trim();
      if (!gid) throw new Error('Guilda não localizada para alterar VIP.');
      const normalized = normalizeVip(tier);
      const expiresAtMs = await buildVipExpiresAtFromPlan(normalized);
      const patch = {
        vipTier: normalized,
        vipExpiresAt: expiresAtMs,
        permissoesAtivas: normalized !== 'free',
        updatedAt: serverTimestamp(),
        updatedAtMs: Date.now()
      };

      await Promise.all([
        setDoc(doc(db, 'configGuilda', gid), patch, { merge: true }),
        setDoc(doc(db, 'guildas', gid), patch, { merge: true })
      ]);

      try {
        const gx = (window.allGuildas || []).find((x) => String(x.id) === gid);
        if (gx) {
          gx.vip = normalized;
          gx.vipTier = normalized;
          gx.vipExpiresAt = expiresAtMs;
          gx.configUpdatedAt = Date.now();
        }
        localStorage.setItem('hub_ceo_guildas_v1', JSON.stringify({ ts: Date.now(), items: window.allGuildas || [] }));
      } catch (_) {}
      return { tier: normalized, expiresAtMs };
    }

    async function updatePartnerLocalAndCache(partnerId, patch = {}) {
      const p = allPartners.find((x) => String(x.id) === String(partnerId));
      if (p) Object.assign(p, patch);
      window.allPartners = allPartners;
      try { localStorage.setItem('hub_ceo_partners_v1', JSON.stringify({ ts: Date.now(), items: allPartners })); } catch (_) {}
      renderPartners();
    }

    async function syncPartnerUserFlags(partner = {}, patch = {}) {
      const ids = new Set([partner.userId, partner.gameId, ...(partner.userDocIds || [])].map((x) => String(x || '').trim()).filter(Boolean));
      if (!ids.size) return;
      await Promise.all(Array.from(ids).map((id) => setDoc(doc(db, 'users', id), patch, { merge: true }).catch(() => null)));
    }

    window.setPartnerVerified = async (partnerId) => {
      const p = allPartners.find((x) => String(x.id) === String(partnerId));
      if (!p) return showToast('error', 'Parceiro não encontrado.');
      if (!p.guildId) return showToast('error', 'Não encontrei a guilda vinculada a este parceiro.');
      if (!confirm(`Tornar ${p.nick || p.email || p.id} parceiro verificado e liberar o plano Parceiro na guilda ${p.guildName || p.guildId}?`)) return;

      try {
        const patch = {
          tipoParceiro: 'verificado',
          verificado: true,
          beneficiosLiberados: true,
          updatedAt: serverTimestamp(),
          updatedAtMs: Date.now()
        };
        await setDoc(doc(db, 'monetize', partnerId), patch, { merge: true });
        await syncPartnerUserFlags(p, {
          parceiroTipo: 'verificado',
          parceiroVerificado: true,
          updatedAt: serverTimestamp()
        });
        await applyVipToGuild(p.guildId, 'parceiro');
        await updatePartnerLocalAndCache(partnerId, { ...patch, guildVip: 'parceiro', guildVipExpiresAt: buildVipExpiresAt('parceiro') });
        showToast('success', 'Parceiro verificado e guilda liberada com plano Parceiro.');
      } catch (e) {
        console.error(e);
        showToast('error', 'Erro ao verificar parceiro.');
      }
    };

    window.setPartnerNormal = async (partnerId) => {
      const p = allPartners.find((x) => String(x.id) === String(partnerId));
      if (!p) return showToast('error', 'Parceiro não encontrado.');
      const shouldFree = p.guildId ? confirm('Deseja também voltar a guilda deste parceiro para FREE?\n\nOK = mudar para FREE\nCancelar = manter o plano atual da guilda') : false;

      try {
        const patch = {
          tipoParceiro: 'normal',
          verificado: false,
          beneficiosLiberados: false,
          updatedAt: serverTimestamp(),
          updatedAtMs: Date.now()
        };
        await setDoc(doc(db, 'monetize', partnerId), patch, { merge: true });
        await syncPartnerUserFlags(p, {
          parceiroTipo: 'normal',
          parceiroVerificado: false,
          updatedAt: serverTimestamp()
        });
        if (shouldFree && p.guildId) {
          await applyVipToGuild(p.guildId, 'free');
          await updatePartnerLocalAndCache(partnerId, { ...patch, guildVip: 'free', guildVipExpiresAt: null });
        } else {
          await updatePartnerLocalAndCache(partnerId, patch);
        }
        showToast('success', shouldFree ? 'Parceiro normal e guilda alterada para FREE.' : 'Parceiro alterado para normal.');
      } catch (e) {
        console.error(e);
        showToast('error', 'Erro ao alterar parceiro.');
      }
    };

    window.approvePartnerWithdraw = async (partnerId) => {
      const p = allPartners.find((x) => String(x.id) === String(partnerId));
      if (!p) return showToast('error', 'Parceiro não encontrado.');
      const pending = getPendingWithdraw(p);
      if (!pending) return showToast('error', 'Não existe saque pendente.');
      if (!confirm(`Confirmar que o saque de ${formatMoney(pending.valor)} foi pago para este parceiro?`)) return;

      try {
        const ref = doc(db, 'monetize', partnerId);
        let updated = null;
        await runTransaction(db, async (tx) => {
          const snap = await tx.get(ref);
          if (!snap.exists()) throw new Error('Parceiro não encontrado.');
          const data = snap.data() || {};
          const saque = data.saque || {};
          if (saque.status !== 'pendente' && data.saquePendente !== true) throw new Error('Não existe saque pendente.');
          const amount = roundMoney(toMoneyNumber(saque.valor || data.valorSaqueSolicitado || data.saldoEmSaque || 0));
          const saldoAtual = roundMoney(toMoneyNumber(data.saldoAtual || data.saldoDisponivel || 0));
          const saldoSacado = roundMoney(toMoneyNumber(data.saldoSacado || data.totalSacado || 0));
          if (!amount || amount < 10) throw new Error('Valor de saque inválido.');
          if (amount > saldoAtual) throw new Error('Saldo insuficiente para aprovar este saque.');

          updated = {
            saldoAtual: roundMoney(saldoAtual - amount),
            saldoSacado: roundMoney(saldoSacado + amount),
            totalSacado: roundMoney(saldoSacado + amount),
            saque: {
              ...saque,
              status: 'aprovado',
              aprovadoEm: serverTimestamp(),
              aprovadoEmMs: Date.now()
            },
            saquePendente: false,
            valorSaqueSolicitado: 0,
            saldoEmSaque: 0,
            ultimoSaqueAprovado: {
              valor: amount,
              pix: saque.pix || data.pix || '',
              aprovadoEm: serverTimestamp(),
              aprovadoEmMs: Date.now()
            },
            updatedAt: serverTimestamp(),
            updatedAtMs: Date.now()
          };
          tx.set(ref, updated, { merge: true });
        });

        await updatePartnerLocalAndCache(partnerId, updated || {});
        showToast('success', 'Saque marcado como aprovado.');
      } catch (e) {
        console.error(e);
        showToast('error', e?.message || 'Erro ao aprovar saque.');
      }
    };

    window.rejectPartnerWithdraw = async (partnerId) => {
      const p = allPartners.find((x) => String(x.id) === String(partnerId));
      if (!p) return showToast('error', 'Parceiro não encontrado.');
      const pending = getPendingWithdraw(p);
      if (!pending) return showToast('error', 'Não existe saque pendente.');
      const reason = prompt('Motivo da recusa do saque:', 'Dados Pix inválidos ou revisão interna.');
      if (reason === null) return;
      try {
        const patch = {
          saque: {
            ...(p.saque || {}),
            status: 'recusado',
            recusadoEm: serverTimestamp(),
            recusadoEmMs: Date.now(),
            motivoRecusa: String(reason || '').trim()
          },
          saquePendente: false,
          saldoEmSaque: 0,
          updatedAt: serverTimestamp(),
          updatedAtMs: Date.now()
        };
        await setDoc(doc(db, 'monetize', partnerId), patch, { merge: true });
        await updatePartnerLocalAndCache(partnerId, patch);
        showToast('info', 'Saque recusado.');
      } catch (e) {
        console.error(e);
        showToast('error', 'Erro ao recusar saque.');
      }
    };

    window.openPartnerDetails = async (partnerId) => {
      const p = allPartners.find((x) => String(x.id) === String(partnerId));
      if (!p) return;
      const body = document.getElementById('drawer-body');
      const pending = getPendingWithdraw(p);
      document.getElementById('drawer-title').textContent = p.nick || p.email || 'Parceiro';
      document.getElementById('drawer-content').innerHTML = `<div class="py-10 text-center text-gray-400">Carregando detalhes do parceiro...</div>`;
      document.getElementById('drawer').classList.remove('hidden');
      setTimeout(() => body.classList.remove('translate-x-full'), 10);

      let indicados = [];
      let comissoes = [];
      try {
        const [iSnap, cSnap] = await Promise.all([
          getDocs(collection(db, 'monetize', partnerId, 'indicados')).catch(() => ({ docs: [] })),
          getDocs(collection(db, 'monetize', partnerId, 'comissoes')).catch(() => ({ docs: [] }))
        ]);
        indicados = iSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
        comissoes = cSnap.docs.map((d) => ({ id: d.id, partnerId, ...d.data() }));
        p.financeComissoes = comissoes;
        p.financeComissoesLoaded = true;
        p.financeComissoesAttempted = true;
        window.allPartners = allPartners;
        try { localStorage.setItem('hub_ceo_partners_v1', JSON.stringify({ ts: Date.now(), items: allPartners })); } catch (_) {}
        refreshFinancePanelFromPartnerData();
      } catch (_) {}

      const raw = JSON.stringify(p, (key, value) => {
        if (value && typeof value.toDate === 'function') return value.toDate().toISOString();
        if (value && typeof value.seconds === 'number') return new Date(value.seconds * 1000).toISOString();
        return value;
      }, 2);

      document.getElementById('drawer-content').innerHTML = `
        <div class="space-y-5 animate-in slide-in-from-right duration-300">
          <div class="rounded-2xl border border-gray-100 bg-gray-50 p-4">
            <div class="flex items-center justify-between gap-3 mb-3">
              <div>
                <p class="text-[10px] font-black text-gray-400 uppercase">Tipo</p>
                ${partnerTypeBadge(p)}
              </div>
              <div class="text-right">
                <p class="text-[10px] font-black text-gray-400 uppercase">ID</p>
                <p class="text-xs font-mono text-gray-500 break-all">${escapeHtml(p.id)}</p>
              </div>
            </div>
            <div class="grid grid-cols-2 gap-2">
              <div class="p-3 rounded-xl bg-white border border-gray-100"><p class="text-[10px] font-black text-gray-400 uppercase">Saldo</p><p class="text-lg font-black text-emerald-700">${formatMoney(p.saldoAtual || 0)}</p></div>
              <div class="p-3 rounded-xl bg-white border border-gray-100"><p class="text-[10px] font-black text-gray-400 uppercase">Sacado</p><p class="text-lg font-black text-slate-900">${formatMoney(p.saldoSacado || p.totalSacado || 0)}</p></div>
            </div>
          </div>

          <div class="rounded-2xl border border-gray-100 bg-white p-4 text-sm text-gray-600 space-y-2">
            <p><b>Email:</b> ${escapeHtml(p.email || '—')}</p>
            <p><b>UID Auth:</b> <span class="font-mono text-xs break-all">${escapeHtml(p.uid || '—')}</span></p>
            <p><b>Game ID:</b> <span class="font-mono text-xs break-all">${escapeHtml(p.gameId || p.userId || p.id || '—')}</span></p>
            <p><b>Guilda vinculada:</b> ${p.guildId ? `${escapeHtml(p.guildName || 'Sem nome')} <span class="font-mono text-xs text-gray-400">${escapeHtml(p.guildId)}</span>` : '<span class="text-red-500">não localizada</span>'}</p>
            <p><b>Plano da guilda:</b> ${prettyVipName(p.guildVip || 'free')}</p>
            <p><b>Pix:</b> <span class="break-all">${escapeHtml(p.pix || '—')}</span></p>
            <p><b>Redes sociais:</b><br><span class="whitespace-pre-wrap">${escapeHtml(p.redesSociais || '—')}</span></p>
            <p><b>Link de indicação:</b><br><span class="break-all text-xs">${escapeHtml(p.linkIndicacao || '—')}</span></p>
          </div>

          ${pending ? `<div class="rounded-2xl border border-amber-100 bg-amber-50 p-4">
            <p class="text-[10px] font-black text-amber-700 uppercase mb-1">Saque pendente</p>
            <p class="text-xl font-black text-amber-900">${formatMoney(pending.valor)}</p>
            <p class="text-xs text-amber-700 break-all mt-1">Pix: ${escapeHtml(pending.pix || '—')}</p>
            <div class="grid grid-cols-2 gap-2 mt-3">
              <button onclick="window.approvePartnerWithdraw('${safeJsString(p.id)}')" class="py-2.5 rounded-xl bg-emerald-600 text-white text-[11px] font-black hover:bg-emerald-700 transition">APROVAR</button>
              <button onclick="window.rejectPartnerWithdraw('${safeJsString(p.id)}')" class="py-2.5 rounded-xl bg-red-50 text-red-600 text-[11px] font-black hover:bg-red-100 transition border border-red-100">RECUSAR</button>
            </div>
          </div>` : ''}

          <div class="grid grid-cols-2 gap-2">
            <button onclick="window.setPartnerVerified('${safeJsString(p.id)}')" class="py-3 rounded-xl bg-amber-500 text-white text-xs font-black hover:bg-amber-600 transition">MARCAR VERIFICADO</button>
            <button onclick="window.setPartnerNormal('${safeJsString(p.id)}')" class="py-3 rounded-xl bg-slate-900 text-white text-xs font-black hover:bg-black transition">MARCAR NORMAL</button>
          </div>

          <div class="rounded-2xl border border-gray-100 bg-white p-4">
            <p class="text-[10px] font-black text-gray-400 uppercase mb-2">Indicados (${indicados.length})</p>
            <div class="space-y-2 max-h-40 overflow-y-auto">
              ${indicados.length ? indicados.map((i) => `<div class="p-2 rounded-xl bg-gray-50 border border-gray-100 text-[11px] text-gray-600"><b>${escapeHtml(i.guildId || i.id)}</b> • ${escapeHtml(i.status || 'convidado')} • ${escapeHtml(i.email || '')}</div>`).join('') : '<p class="text-xs text-gray-400">Nenhum indicado listado.</p>'}
            </div>
          </div>

          <div class="rounded-2xl border border-gray-100 bg-white p-4">
            <p class="text-[10px] font-black text-gray-400 uppercase mb-2">Comissões (${comissoes.length})</p>
            <div class="space-y-2 max-h-40 overflow-y-auto">
              ${comissoes.length ? comissoes.map((c) => `<div class="p-2 rounded-xl bg-gray-50 border border-gray-100 text-[11px] text-gray-600"><b>${formatMoney(c.comissao || 0)}</b> • ${escapeHtml(c.plano || '—')} • ${escapeHtml(c.status || '—')}</div>`).join('') : '<p class="text-xs text-gray-400">Nenhuma comissão listada.</p>'}
            </div>
          </div>

          <details class="rounded-2xl border border-gray-100 bg-gray-950 text-gray-100 p-4">
            <summary class="cursor-pointer text-xs font-black uppercase tracking-wider">Dados brutos</summary>
            <pre class="mt-3 text-[10px] whitespace-pre-wrap break-words">${escapeHtml(raw)}</pre>
          </details>
        </div>
      `;
      initIcons();
    };

    function recruitmentDetailCacheKey(guildId) {
      return `${RECRUITMENT_DETAIL_CACHE_PREFIX}${String(guildId || '').trim()}`;
    }

    function readRecruitmentDetailCache(guildId) {
      try {
        const cached = JSON.parse(localStorage.getItem(recruitmentDetailCacheKey(guildId)) || 'null');
        if (!cached?.ts || (Date.now() - Number(cached.ts)) >= RECRUITMENT_DETAIL_CACHE_TTL_MS) return null;
        return cached.value || null;
      } catch (_) {
        return null;
      }
    }

    function writeRecruitmentDetailCache(guildId, value) {
      try {
        localStorage.setItem(recruitmentDetailCacheKey(guildId), JSON.stringify({ ts: Date.now(), value }));
      } catch (_) {}
    }

    function clearRecruitmentDetailCache(guildId) {
      try { localStorage.removeItem(recruitmentDetailCacheKey(guildId)); } catch (_) {}
    }

    function recruitmentItemRef(status, guildId) {
      return doc(db, RECRUITMENT_ROOT_COLLECTION, status, RECRUITMENT_ITEMS_COLLECTION, guildId);
    }

    function recruitmentRequestsRef(status, guildId) {
      return collection(db, RECRUITMENT_ROOT_COLLECTION, status, RECRUITMENT_ITEMS_COLLECTION, guildId, 'pedidos');
    }

    function extractR2KeyFromUrl(value = '') {
      const clean = String(value || '').trim();
      if (!clean) return '';
      if (!/^https?:\/\//i.test(clean)) return clean.replace(/^\/+/, '');
      try {
        return decodeURIComponent(new URL(clean).pathname.replace(/^\/+/, ''));
      } catch (_) {
        return '';
      }
    }

    async function callRecruitmentImageAdmin(payload = {}) {
      const token = await ceoSessionUser?.getIdToken?.();
      if (!token) throw new Error('Sessão expirada. Entre novamente.');
      const response = await fetch('/api/recruitment_image', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify(payload)
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || data?.ok === false) throw new Error(data?.error || 'Não foi possível excluir a imagem do R2.');
      return data;
    }

    async function commitDeleteRefs(refs = []) {
      const unique = Array.from(new Map(
        (refs || []).filter((ref) => ref?.path).map((ref) => [ref.path, ref])
      ).values());
      for (let index = 0; index < unique.length; index += 450) {
        const batch = writeBatch(db);
        unique.slice(index, index + 450).forEach((ref) => batch.delete(ref));
        await batch.commit();
      }
    }

    async function loadGuildRecruitmentInfo(guildId, force = false) {
      const gid = String(guildId || '').trim();
      if (!gid) return { status: 'none', item: null };
      if (!force) {
        const cached = readRecruitmentDetailCache(gid);
        if (cached) return cached;
      }

      const [activeSnap, inactiveSnap] = await Promise.all(
        RECRUITMENT_STATUSES.map((status) => getDoc(recruitmentItemRef(status, gid)))
      );
      const active = activeSnap?.exists() ? { id: activeSnap.id, ...activeSnap.data() } : null;
      const inactive = inactiveSnap?.exists() ? { id: inactiveSnap.id, ...inactiveSnap.data() } : null;
      const value = {
        status: active ? 'ativo' : (inactive ? 'inativo' : 'none'),
        item: active || inactive || null,
        active,
        inactive
      };
      writeRecruitmentDetailCache(gid, value);
      return value;
    }

    function renderGuildRecruitmentInfo(guildId, info = null, loading = false) {
      const box = document.getElementById('guild-recruitment-admin');
      if (!box) return;
      const drawerContent = box.closest('#drawer-content');
      if (drawerContent?.dataset?.guildId && drawerContent.dataset.guildId !== String(guildId)) return;
      if (loading) {
        box.innerHTML = `
          <div class="flex items-center gap-3 py-3 text-xs font-bold text-gray-500">
            <span class="h-5 w-5 animate-spin rounded-full border-2 border-emerald-500 border-t-transparent"></span>
            Carregando recrutamento...
          </div>
        `;
        return;
      }

      const item = info?.item || null;
      if (!item) {
        box.innerHTML = `
          <div class="flex items-center gap-3 rounded-xl border border-gray-100 bg-gray-50 p-3">
            <i data-lucide="user-round-search" class="h-5 w-5 text-gray-400"></i>
            <div>
              <p class="text-xs font-black text-gray-700">Sem recrutamento</p>
              <p class="text-[10px] text-gray-400">Nenhum anúncio ativo ou inativo foi encontrado.</p>
            </div>
          </div>
        `;
        initIcons();
        return;
      }

      const status = info.status === 'ativo' ? 'Ativo' : 'Inativo';
      const statusClass = info.status === 'ativo'
        ? 'bg-emerald-100 text-emerald-700'
        : 'bg-amber-100 text-amber-700';
      const targetStatus = info.status === 'ativo' ? 'inativo' : 'ativo';
      const toggleLabel = targetStatus === 'ativo' ? 'ATIVAR RECRUTAMENTO' : 'MOVER PARA INATIVO';
      const toggleClass = targetStatus === 'ativo'
        ? 'border-emerald-100 bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
        : 'border-amber-100 bg-amber-50 text-amber-700 hover:bg-amber-100';
      const image = String(item.photoUrl || item.photoBase64 || '').trim();
      const updatedAt = toTimestampMs(item.updatedAtMs || item.updatedAt || item.createdAtMs || item.createdAt);
      box.innerHTML = `
        <div class="space-y-3">
          <div class="flex items-start gap-3">
            ${image
              ? `<img src="${escapeHtml(image)}" alt="" class="h-14 w-14 shrink-0 rounded-xl border border-gray-200 object-cover">`
              : `<span class="inline-flex h-14 w-14 shrink-0 items-center justify-center rounded-xl bg-gray-100 text-gray-400"><i data-lucide="image-off" class="h-5 w-5"></i></span>`}
            <div class="min-w-0 flex-1">
              <div class="flex items-center justify-between gap-2">
                <p class="truncate text-sm font-black text-gray-900">${escapeHtml(item.guildName || 'Recrutamento')}</p>
                <span class="rounded-lg px-2 py-1 text-[9px] font-black uppercase ${statusClass}">${status}</span>
              </div>
              <p class="mt-1 line-clamp-2 text-[11px] leading-relaxed text-gray-500">${escapeHtml(item.description || 'Sem descrição.')}</p>
              <p class="mt-1 text-[9px] font-bold text-gray-400">Atualizado em ${updatedAt ? fmtDate(updatedAt) : '—'}</p>
            </div>
          </div>
          <div class="grid gap-2 sm:grid-cols-2">
            <button id="btn-toggle-guild-recruitment" type="button" class="inline-flex items-center justify-center gap-2 rounded-xl border px-3 py-2.5 text-[11px] font-black transition ${toggleClass}">
              <i data-lucide="${targetStatus === 'ativo' ? 'circle-play' : 'circle-pause'}" class="h-4 w-4"></i>
              ${toggleLabel}
            </button>
            <button id="btn-delete-guild-recruitment" type="button" class="inline-flex items-center justify-center gap-2 rounded-xl border border-red-100 bg-red-50 px-3 py-2.5 text-[11px] font-black text-red-600 transition hover:bg-red-100">
              <i data-lucide="trash-2" class="h-4 w-4"></i>
              EXCLUIR
            </button>
          </div>
        </div>
      `;
      document.getElementById('btn-toggle-guild-recruitment')?.addEventListener('click', async (event) => {
        const button = event.currentTarget;
        if (button.disabled) return;
        const original = button.innerHTML;
        button.disabled = true;
        button.classList.add('opacity-60', 'cursor-wait');
        button.innerHTML = `<span class="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent"></span>${targetStatus === 'ativo' ? 'ATIVANDO...' : 'INATIVANDO...'}`;
        try {
          const nextInfo = await moveGuildRecruitmentStatus(guildId, info.status);
          renderGuildRecruitmentInfo(guildId, nextInfo);
          showToast('success', targetStatus === 'ativo' ? 'Recrutamento ativado.' : 'Recrutamento movido para inativo.');
        } catch (error) {
          console.error(error);
          showToast('error', error?.message || 'Não foi possível alterar o recrutamento.');
          button.disabled = false;
          button.classList.remove('opacity-60', 'cursor-wait');
          button.innerHTML = original;
          initIcons();
        }
      });
      document.getElementById('btn-delete-guild-recruitment')?.addEventListener('click', () => {
        showCeoConfirm({
          title: 'Excluir recrutamento',
          message: 'O anúncio, todos os pedidos vinculados e a imagem armazenada no R2 serão apagados. Essa ação é irreversível.',
          confirmLabel: 'Excluir recrutamento',
          onConfirm: async () => {
            await deleteGuildRecruitment(guildId);
            renderGuildRecruitmentInfo(guildId, { status: 'none', item: null });
            showToast('success', 'Recrutamento e imagem excluídos.');
          }
        });
      });
      initIcons();
    }

    async function moveGuildRecruitmentStatus(guildId, fromStatus) {
      const gid = String(guildId || '').trim();
      const from = fromStatus === 'inativo' ? 'inativo' : 'ativo';
      const to = from === 'ativo' ? 'inativo' : 'ativo';
      if (!gid) throw new Error('Guilda não encontrada.');

      const [sourceSnap, targetSnap, sourceRequests, targetRequests] = await Promise.all([
        getDoc(recruitmentItemRef(from, gid)),
        getDoc(recruitmentItemRef(to, gid)),
        getDocs(recruitmentRequestsRef(from, gid)),
        getDocs(recruitmentRequestsRef(to, gid))
      ]);
      if (!sourceSnap.exists()) throw new Error('O recrutamento não existe mais nesse status.');

      const sourceData = sourceSnap.data() || {};
      let obsoleteTargetImage = null;
      if (targetSnap.exists()) {
        const targetData = targetSnap.data() || {};
        const sourceKey = String(sourceData.photoKey || extractR2KeyFromUrl(sourceData.photoUrl || '')).trim();
        const targetKey = String(targetData.photoKey || extractR2KeyFromUrl(targetData.photoUrl || '')).trim();
        if (targetKey && targetKey !== sourceKey) {
          obsoleteTargetImage = { key: targetKey, url: targetData.photoUrl || '' };
        }
      }

      await commitDeleteRefs(targetRequests.docs.map((item) => item.ref));
      const now = Date.now();
      const nextData = {
        ...sourceData,
        id: gid,
        guildId: gid,
        status: to,
        active: to === 'ativo',
        updatedAt: serverTimestamp(),
        updatedAtMs: now,
        ...(to === 'ativo'
          ? { activatedAtMs: now, inactivatedAtMs: null, inactiveReason: null }
          : { inactivatedAtMs: now, inactiveReason: 'ceo_manual' })
      };
      await setDoc(recruitmentItemRef(to, gid), nextData);

      for (let index = 0; index < sourceRequests.docs.length; index += 220) {
        const batch = writeBatch(db);
        sourceRequests.docs.slice(index, index + 220).forEach((requestDoc) => {
          batch.set(doc(recruitmentRequestsRef(to, gid), requestDoc.id), requestDoc.data() || {}, { merge: true });
          batch.delete(requestDoc.ref);
        });
        await batch.commit();
      }
      await deleteDoc(sourceSnap.ref);
      if (obsoleteTargetImage) {
        try {
          await callRecruitmentImageAdmin({ action: 'delete', guildId: gid, ...obsoleteTargetImage });
        } catch (error) {
          console.warn('O status foi alterado, mas a imagem antiga do destino não pôde ser removida:', error);
        }
      }
      clearRecruitmentDetailCache(gid);
      return loadGuildRecruitmentInfo(gid, true);
    }

    async function deleteGuildRecruitment(guildId) {
      const gid = String(guildId || '').trim();
      if (!gid) return;
      const snapshots = await Promise.all(
        RECRUITMENT_STATUSES.map((status) => getDoc(recruitmentItemRef(status, gid)))
      );
      const imageKeys = new Map();
      snapshots.forEach((snap) => {
        if (!snap?.exists()) return;
        const data = snap.data() || {};
        const key = String(data.photoKey || extractR2KeyFromUrl(data.photoUrl || '')).trim();
        if (key) imageKeys.set(key, { key, url: data.photoUrl || '' });
      });
      for (const image of imageKeys.values()) {
        await callRecruitmentImageAdmin({ action: 'delete', guildId: gid, key: image.key, url: image.url });
      }

      const refs = [];
      for (let index = 0; index < RECRUITMENT_STATUSES.length; index += 1) {
        const status = RECRUITMENT_STATUSES[index];
        const requests = await getDocs(recruitmentRequestsRef(status, gid));
        requests?.forEach((requestDoc) => refs.push(requestDoc.ref));
        if (snapshots[index]?.exists()) refs.push(snapshots[index].ref);
      }
      await commitDeleteRefs(refs);
      clearRecruitmentDetailCache(gid);
    }

    function renderGuilds() {
      const q = activeSearchQuery('guildas');
      const vf = (document.getElementById('vip-filter')?.value || 'all');
      const uf = (document.getElementById('updated-filter')?.value || 'all');
      const mf = (document.getElementById('members-filter')?.value || 'all');
      const filtered = allGuilds.filter(g => {
        const matchesQ =
          (g.name && g.name.toLowerCase().includes(q)) ||
          (g.id && g.id.toLowerCase().includes(q)) ||
          (g.leaders && g.leaders.join(' ').toLowerCase().includes(q));

        const matchesVip = (vf === 'all') ? true : (normalizeVip(g.vip) === vf);
        const matchesUpdated = matchesUpdatedFilter(g.configUpdatedAt, uf);
        const matchesMembers = matchesMembersFilter(g.memberCount, mf);
        return matchesQ && matchesVip && matchesUpdated && matchesMembers;
      });

      const grid = document.getElementById('guilds-grid');
      if (!grid) return;
      adminViewRendered.guildas = true;
      if (filtered.length === 0) {
        grid.innerHTML = `<div class="col-span-full py-10 text-center text-gray-400">Nenhuma guilda encontrada.</div>`;
        return;
      }

      grid.innerHTML = filtered.map(g => `
        <div class="bg-white border border-gray-100 rounded-3xl p-5 shadow-sm hover:shadow-xl transition-all duration-300 group" style="content-visibility:auto;contain-intrinsic-size:auto 270px">
          <div class="flex items-start justify-between mb-4">
            <div class="min-w-0">
              <h4 class="font-black text-gray-900 truncate text-lg">${g.name || 'Sem nome'}</h4>
              <p class="text-[10px] text-gray-400 font-mono tracking-tighter">${g.id}</p>
            </div>
            <div class="flex flex-col items-end gap-2">
            <span class="px-3 py-1 rounded-xl ${vipBadgeClass(g.vip)} text-[10px] font-black uppercase tracking-wider shadow-sm border border-black/5">
              ${prettyVipName(g.vip)}
            </span>
            ${(() => { const rt = remainingTag(g.vipExpiresAt, g.vip); return '<span class="px-3 py-1 rounded-xl '+rt.cls+' text-[10px] font-black tracking-wider shadow-sm border border-black/5">'+rt.text+'</span>'; })()}
          </div>
          </div>

          <div class="space-y-2 mb-5">
            <div class="flex items-center gap-2 text-[11px] text-gray-500">
              <i data-lucide="crown" class="w-3.5 h-3.5 text-amber-500"></i>
              <span class="truncate"><b>Líder:</b> ${g.leaders && g.leaders[0] ? g.leaders[0] : '—'}</span>
            </div>
            <div class="flex items-center gap-2 text-[11px] text-gray-500">
              <i data-lucide="shield-check" class="w-3.5 h-3.5 text-blue-500"></i>
              <span><b>Admins:</b> ${g.admins ? g.admins.length : 0}</span>
            </div>
            <div class="flex items-center gap-2 text-[11px] text-gray-500">
              <i data-lucide="users" class="w-3.5 h-3.5 text-emerald-500"></i>
              <span><b>Membros:</b> <span id="card-members-${g.id}" class="font-bold">${normalizeMemberCount(g.memberCount)}</span></span>
            </div>
          </div>

          <div class="grid grid-cols-2 gap-2">
            <button onclick="window.openDetails('${g.id}')" class="py-2.5 rounded-xl bg-gray-50 text-gray-900 text-[11px] font-bold hover:bg-gray-100 transition border border-gray-100">
              DETALHES
            </button>
            <button onclick="window.fullDeleteGuild('${g.id}', '${g.name ? g.name.replace(/'/g, "\\'") : 'Guilda'}')" class="py-2.5 rounded-xl bg-red-50 text-red-600 text-[11px] font-bold hover:bg-red-100 transition border border-red-100">
              ELIMINAR TUDO
            </button>
          </div>
        </div>
      `).join('');
      initIcons();
    }

    window.openDetails = async (gid) => {
      const g = allGuilds.find(x => x.id === gid);
      if(!g) return;
      const plansCatalogPromise = loadPlansCatalogOnly(false).catch((error) => {
        console.error('Falha ao atualizar catálogo de planos:', error);
        return allPlansAdmin;
      });
      const body = document.getElementById('drawer-body');
      const drawerContent = document.getElementById('drawer-content');
      document.getElementById('drawer-title').textContent = g.name || 'Detalhes';
      document.getElementById('drawer').classList.remove('hidden');
      drawerContent.dataset.guildId = String(gid);
      setTimeout(() => body.classList.remove('translate-x-full'), 10);
      drawerContent.innerHTML = `
        <div class="space-y-6 animate-in slide-in-from-right duration-300">
          <div class="p-4 bg-gray-50 rounded-2xl border border-gray-100">
             <p class="text-[10px] font-bold text-gray-400 uppercase mb-2">Plano Atual</p>
             <div class="relative">
               <select id="edit-vip-sel" class="w-full ${SELECT_UI_CLASS} text-sm">
                  ${planOptionsHtml(g.vip)}
               </select>
             </div>
             <p class="mt-3 text-[10px] font-bold text-gray-400 uppercase mb-2">Duração</p>
             <div class="relative">
               <select id="edit-vip-duration" class="w-full ${SELECT_UI_CLASS} text-sm">
                 ${durationOptionsHtml(g.vip)}
               </select>
             </div>
             <div id="edit-vip-custom-days-wrap" class="mt-3 hidden">
               <label class="mb-1 block text-[10px] font-black uppercase text-gray-400">Dias personalizados</label>
               <input id="edit-vip-custom-days" type="number" min="1" max="1825" value="${defaultPlanDurationDaysSync(g.vip) || 30}" class="w-full rounded-xl border border-gray-200 bg-white px-3 py-3 text-sm font-bold outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100" />
             </div>
             <p id="edit-vip-expiry-preview" class="mt-2 text-[10px] font-bold text-gray-500"></p>
             <button id="btn-save-vip" class="w-full mt-3 py-3 rounded-xl bg-emerald-600 text-white font-black text-xs hover:bg-emerald-700 transition">ATUALIZAR PLANO</button>
          </div>

          <div class="p-4 bg-white rounded-2xl border border-gray-100">
            <p class="text-[10px] font-bold text-gray-400 uppercase mb-3">Informações da Guilda</p>
            <div class="grid grid-cols-2 gap-2">
              <div class="p-3 bg-gray-50 rounded-xl border border-gray-100">
                <p class="text-[10px] text-gray-500 font-black uppercase">Membros</p>
                <p class="text-xl font-black text-gray-900 mt-1"><span id="members-count">${normalizeMemberCount(g.memberCount)}</span></p>
              </div>
              <div class="p-3 bg-gray-50 rounded-xl border border-gray-100">
                <p class="text-[10px] text-gray-500 font-black uppercase">Plano</p>
                <p class="text-xl font-black text-gray-900 mt-1">${prettyVipName(g.vip)}</p>
              </div>
            </div>
          </div>

          <div class="p-4 bg-white rounded-2xl border border-gray-100">
            <p class="text-[10px] font-bold text-gray-400 uppercase mb-3">Recrutamento</p>
            <div id="guild-recruitment-admin"></div>
          </div>

          <div class="p-4 bg-white rounded-2xl border border-gray-100">
            <p class="text-[10px] font-bold text-gray-400 uppercase mb-2">Renomear Guilda</p>
            <input id="edit-guild-name" type="text" value="${(g.name||'').replaceAll('"','&quot;')}" class="w-full p-3 rounded-xl border border-gray-200 bg-white text-sm font-bold" />
            <button id="btn-save-name" class="w-full mt-3 py-3 rounded-xl bg-gray-900 text-white font-black text-xs hover:bg-black transition">SALVAR NOME</button>
            <p class="mt-2 text-[10px] text-gray-400">Atualiza o nome em <b>guildas</b> e <b>configGuilda</b>.</p>
          </div>

          <div>
            <p class="text-[10px] font-bold text-gray-400 uppercase mb-3">Administração</p>
            <div class="space-y-2">
               <div class="p-3 bg-white border border-gray-100 rounded-xl">
                  <p class="text-[10px] text-amber-600 font-bold uppercase">Líderes (${g.leaders?g.leaders.length:0})</p>
                  <p class="text-xs text-gray-700 break-all mt-1">${g.leaders?g.leaders.join('<br>'):'—'}</p>
               </div>
               <div class="p-3 bg-white border border-gray-100 rounded-xl">
                  <p class="text-[10px] text-blue-600 font-bold uppercase">Admins (${g.admins?g.admins.length:0})</p>
                  <p class="text-xs text-gray-700 break-all mt-1">${(g.admins && g.admins.length > 0) ? g.admins.join('<br>') : 'Nenhum administrador.'}</p>
               </div>
            </div>
          </div>

          <div class="pt-4 border-t border-gray-100 text-[10px] text-gray-400">
            <p>ID da Guilda: ${g.id}</p>
            <p>Criada em: ${fmtDate(g.createdAt)}</p>
            <p>Última atualização: ${fmtDate(g.configUpdatedAt)}</p>
          </div>
        </div>
      `;

      refreshCeoCustomSelect(document.getElementById('edit-vip-sel'), false);
      refreshCeoCustomSelect(document.getElementById('edit-vip-duration'), false);
      initIcons();
      const cachedRecruitment = readRecruitmentDetailCache(gid);
      if (cachedRecruitment) {
        renderGuildRecruitmentInfo(gid, cachedRecruitment);
      } else {
        renderGuildRecruitmentInfo(gid, null, true);
        loadGuildRecruitmentInfo(gid, true)
          .then((info) => renderGuildRecruitmentInfo(gid, info))
          .catch((error) => {
            console.error(error);
            const box = document.getElementById('guild-recruitment-admin');
            if (box) box.innerHTML = `<p class="rounded-xl bg-red-50 p-3 text-xs font-bold text-red-600">Não foi possível carregar o recrutamento.</p>`;
          });
      }

      const syncVipDurationUi = () => {
        const planId = document.getElementById('edit-vip-sel')?.value || 'free';
        const mode = document.getElementById('edit-vip-duration')?.value || 'default';
        const customWrap = document.getElementById('edit-vip-custom-days-wrap');
        const preview = document.getElementById('edit-vip-expiry-preview');
        customWrap?.classList.toggle('hidden', mode !== 'custom');
        let days = mode === 'default' ? defaultPlanDurationDaysSync(planId) : Number(mode);
        if (mode === 'custom') days = Number(document.getElementById('edit-vip-custom-days')?.value || 0);
        if (mode === 'none' || canonicalPlanId(planId) === 'free' || (!days && mode === 'default')) {
          if (preview) preview.textContent = 'Este plano ficará sem data de expiração.';
          return;
        }
        if (preview) {
          preview.textContent = Number.isFinite(days) && days > 0
            ? `Validade: ${Math.floor(days)} dia(s), até ${new Date(Date.now() + Math.floor(days) * 86400000).toLocaleDateString('pt-BR')}.`
            : 'Informe uma quantidade entre 1 dia e 5 anos.';
        }
      };

      document.getElementById('edit-vip-sel')?.addEventListener('change', () => {
        const duration = document.getElementById('edit-vip-duration');
        if (duration) {
          duration.innerHTML = durationOptionsHtml(document.getElementById('edit-vip-sel')?.value || 'free');
          duration.value = 'default';
          refreshCeoCustomSelect(duration);
        }
        syncVipDurationUi();
      });
      document.getElementById('edit-vip-duration')?.addEventListener('change', syncVipDurationUi);
      document.getElementById('edit-vip-custom-days')?.addEventListener('input', syncVipDurationUi);
      syncVipDurationUi();

      plansCatalogPromise.then(() => {
        if (drawerContent.dataset.guildId !== String(gid)) return;
        const select = document.getElementById('edit-vip-sel');
        if (!select) return;
        const selected = select.value || g.vip;
        select.innerHTML = planOptionsHtml(selected);
        select.value = canonicalPlanId(selected);
        refreshCeoCustomSelect(select);
      });

      document.getElementById('btn-save-vip').onclick = async () => {
        const nv = document.getElementById('edit-vip-sel').value;
        const button = document.getElementById('btn-save-vip');
        if (button?.disabled) return;
        try {
          if (button) {
            button.disabled = true;
            button.textContent = 'ATUALIZANDO...';
          }
          const expiresAtMs = await manualVipExpiresAt(nv);
          const patch = { vipTier: nv, vipExpiresAt: expiresAtMs, permissoesAtivas: normalizeVip(nv) !== 'free', updatedAt: serverTimestamp(), updatedAtMs: Date.now() };
          await updateDoc(doc(db, 'configGuilda', gid), patch);
          try { await updateDoc(doc(db, 'guildas', gid), patch); } catch(_) {}
          showToast('success', `Plano da guilda ${g.name} alterado para ${prettyVipName(nv)}`);
          closeDrawer();
          try { const gx = window.allGuildas.find(x=>x.id===gid); if (gx) {gx.vipTier = nv; gx.vip = nv; gx.vipExpiresAt = expiresAtMs; gx.configUpdatedAt = Date.now();} } catch(_) {}
          renderGuilds();
          
          localStorage.setItem('hub_ceo_guildas_v1', JSON.stringify({ ts: Date.now(), items: window.allGuildas }));
        } catch(e) {
          console.error('VIP save error:', e);
          showToast('error', e?.message || 'Erro ao salvar VIP.');
          if (button) {
            button.disabled = false;
            button.textContent = 'ATUALIZAR PLANO';
          }
        }
      };

      document.getElementById('btn-save-name').onclick = async () => {
        const newName = (document.getElementById('edit-guild-name').value || '').trim();
        if (!newName) { showToast('error', 'Nome inválido.'); return; }
        const patchName = { name: newName, updatedAtMs: Date.now(), updatedAt: serverTimestamp() };
        try {
          try { await updateDoc(doc(db, 'configGuilda', gid), patchName); }
          catch(_) { await setDoc(doc(db, 'configGuilda', gid), patchName, { merge: true }); }

          try { await updateDoc(doc(db, 'guildas', gid), patchName); }
          catch(_) { await setDoc(doc(db, 'guildas', gid), patchName, { merge: true }); }

          showToast('success', 'Nome da guilda atualizado.');
          closeDrawer();
          try { const gx = window.allGuildas.find(x=>x.id===gid); if (gx) { gx.name = newName; gx.configUpdatedAt = Date.now(); } } catch(_) {}
          renderGuilds();
          
          localStorage.setItem('hub_ceo_guildas_v1', JSON.stringify({ ts: Date.now(), items: window.allGuildas }));
        } catch (e) {
          console.error('NAME save error:', e);
          showToast('error', 'Erro ao salvar nome da guilda.');
        }
      };
    };

    async function deleteGuildCompletely(gid, name) {
      showToast('info', 'A eliminar dados... por favor aguarde.');
      try {
        const refsToDelete = [];
        const guild = (window.allGuildas || []).find((item) => String(item.id) === String(gid)) || {};
        const config = getConfigByGuildId(gid) || {};
        const ownerUid = String(guild.ownerUid || config.ownerUid || gid).trim();
        const ownerEmail = String(guild.ownerEmail || config.ownerEmail || guild.leaders?.[0] || '').toLowerCase().trim();
        const userDocs = new Map();

        await deleteGuildRecruitment(gid);

        const guildSubSnaps = await Promise.all(
          GUILD_SUBCOLLECTIONS.map((subcollection) => getDocs(collection(db, 'guildas', gid, subcollection)))
        );
        guildSubSnaps.forEach((snap) => snap?.forEach((item) => refsToDelete.push(item.ref)));

        const directUserSnap = await getDoc(doc(db, 'users', ownerUid || gid));
        if (directUserSnap?.exists()) userDocs.set(directUserSnap.ref.path, directUserSnap);
        const userQueries = await Promise.all([
          getDocs(query(collection(db, 'users'), where('guildId', '==', gid))),
          ownerUid ? getDocs(query(collection(db, 'users'), where('uid', '==', ownerUid))) : null,
          ownerEmail ? getDocs(query(collection(db, 'users'), where('email', '==', ownerEmail))) : null
        ]);
        userQueries.forEach((snap) => snap?.forEach((item) => userDocs.set(item.ref.path, item)));
        refsToDelete.push(doc(db, 'users', gid));
        userDocs.forEach((item) => refsToDelete.push(item.ref));

        const ownerIds = new Set([gid, ownerUid].filter(Boolean));
        const ownerEmails = new Set([ownerEmail].filter(Boolean));
        userDocs.forEach((item) => {
          const data = item.data() || {};
          [item.id, data.id, data.gameId, data.userId, data.uid].forEach((value) => {
            const clean = String(value || '').trim();
            if (clean) ownerIds.add(clean);
          });
          [data.email, data.playerEmail].forEach((value) => {
            const clean = String(value || '').toLowerCase().trim();
            if (clean) ownerEmails.add(clean);
          });
        });

        const monetizeSnap = await getDocs(collection(db, 'monetize'));
        const monetizeDocs = [];
        monetizeSnap?.forEach((item) => {
          const data = item.data() || {};
          const ids = [item.id, data.uid, data.userId, data.gameId, data.guildId, data.guildUid].map((value) => String(value || '').trim());
          const emails = [data.email, data.playerEmail].map((value) => String(value || '').toLowerCase().trim());
          if (ids.some((value) => ownerIds.has(value)) || emails.some((value) => ownerEmails.has(value))) monetizeDocs.push(item);
        });
        for (const partnerDoc of monetizeDocs) {
          const [indicados, comissoes] = await Promise.all([
            getDocs(collection(db, 'monetize', partnerDoc.id, 'indicados')),
            getDocs(collection(db, 'monetize', partnerDoc.id, 'comissoes'))
          ]);
          indicados?.forEach((item) => refsToDelete.push(item.ref));
          comissoes?.forEach((item) => refsToDelete.push(item.ref));
          refsToDelete.push(partnerDoc.ref);
        }

        const solicitaSnaps = await Promise.all([
          getDocs(query(collection(db, 'solicita'), where('guildId', '==', gid))),
          ownerUid ? getDocs(query(collection(db, 'solicita'), where('uid', '==', ownerUid))) : null,
          ...Array.from(ownerIds).map((id) => getDoc(doc(db, 'solicita', id)))
        ]);
        solicitaSnaps.forEach((snap) => {
          if (snap?.docs) snap.forEach((item) => refsToDelete.push(item.ref));
          else if (snap?.exists?.()) refsToDelete.push(snap.ref);
        });

        const supportSnap = await getDocs(query(collection(db, 'mensagem'), where('guildId', '==', gid)));
        if (supportSnap) {
          for (const ticket of supportSnap.docs) {
            const messages = await getDocs(collection(db, 'mensagem', ticket.id, 'mensagens'));
            messages?.forEach((item) => refsToDelete.push(item.ref));
            refsToDelete.push(ticket.ref);
          }
        }

        refsToDelete.push(doc(db, 'estatisticas', gid));
        refsToDelete.push(doc(db, 'tempo', gid));
        refsToDelete.push(doc(db, 'configGuilda', gid));
        refsToDelete.push(doc(db, 'guildas', gid));

        await commitDeleteRefs(refsToDelete);

        showToast('success', 'Guilda e todos os vínculos eliminados com sucesso.');
        try {
          window.allGuildas = (window.allGuildas || []).filter(x => x.id !== gid);
          allGuilds = window.allGuildas;
          window.allSolicita = (window.allSolicita || []).filter((item) => {
            const ids = [item.id, item.uid, item.userId, item.gameId, item.guildId, item.gid].map((value) => String(value || '').trim());
            return !ids.some((value) => ownerIds.has(value));
          });
          window.allConfigGuilda = (window.allConfigGuilda || []).filter((item) => String(item.id) !== String(gid));
          allPartners = (allPartners || []).filter((item) => {
            const ids = [item.id, item.uid, item.userId, item.gameId, item.guildId].map((value) => String(value || '').trim());
            return !ids.some((value) => ownerIds.has(value));
          });
          window.allPartners = allPartners;
        } catch(_) {}

        localStorage.setItem('hub_ceo_guildas_v1', JSON.stringify({ ts: Date.now(), items: window.allGuildas }));
        localStorage.setItem('hub_ceo_config_v1', JSON.stringify({ ts: Date.now(), items: window.allConfigGuilda || [] }));
        localStorage.setItem('hub_ceo_partners_v1', JSON.stringify({ ts: Date.now(), items: allPartners || [] }));
        localStorage.removeItem(FINANCE_CACHE_KEY);
        clearRecruitmentDetailCache(gid);

        renderGuilds();
        renderUserGrowth(allGuilds);
        const statGuilds = document.getElementById('stat-guilds');
        if (statGuilds) statGuilds.textContent = allGuilds.length;
        const statPartners = document.getElementById('stat-partners');
        if (statPartners) statPartners.textContent = allPartners.length;

        if (!document.getElementById('solicita-panel').classList.contains('hidden')) {
           loadSolicita();
        }
      } catch(e) {
        console.error('FULL DELETE ERROR:', e);
        const details = (e && (e.code || e.message)) ? ` (${e.code || e.message})` : '';
        showToast('error', 'Erro ao eliminar dados da guilda.' + details);
        throw e;
      }
    }

    window.fullDeleteGuild = (gid, name) => {
      showCeoConfirm({
        title: `Eliminar ${name || 'guilda'}`,
        message: 'Isso apagará permanentemente a guilda, membros, lines, histórico, campeonatos, estatísticas, recrutamento e imagem, solicitações, suporte, perfis do criador e dados de parceiro. Essa ação é irreversível.',
        confirmLabel: 'Eliminar tudo',
        onConfirm: () => deleteGuildCompletely(gid, name)
      });
    };

    // Solicitações (Busca em tempo real)
    async function loadSolicita() {
      const grid = document.getElementById('solicita-grid');
      grid.innerHTML = `<div class="col-span-full py-10 text-center text-gray-400">A carregar solicitações do servidor...</div>`;
      
      try {
        const snap = await getDocs(collection(db, 'solicita'));
        window.allSolicita = snap.docs.map(d => ({ id: d.id, ...d.data() }));

        const pendentesCount = window.allSolicita.filter(s => s.status === 'pendente').length;
        document.getElementById('stat-solicita').textContent = pendentesCount;

        if(window.allSolicita.length === 0) {
          grid.innerHTML = `<div class="col-span-full py-10 text-center text-gray-400">Sem solicitações no momento.</div>`;
          return;
        }

        grid.innerHTML = window.allSolicita.sort((a,b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0)).map(s => `
          <div class="bg-gray-50 border border-gray-100 p-4 rounded-2xl shadow-sm hover:bg-white transition">
            <div class="flex justify-between items-start mb-3">
               <div class="min-w-0">
                  <p class="text-[10px] font-black text-emerald-600 uppercase tracking-widest">${prettyVipName(s.plano || 'FREE')}</p>
                  <h5 class="font-bold text-gray-900 text-sm truncate">${s.email || '—'}</h5>
               </div>
               <span class="px-2 py-0.5 rounded-lg text-[9px] font-bold ${s.status === 'pendente' ? 'bg-orange-100 text-orange-700' : 'bg-blue-100 text-blue-700'} uppercase">
                  ${s.status || 'pendente'}
               </span>
            </div>
            <div class="text-[10px] text-gray-500 space-y-1 mb-4">
               <p><b>Titular:</b> ${s.nomePagador || '—'}</p>
               <p><b>Data:</b> ${fmtDate(s.createdAt)}</p>
               <p><b>Valor:</b> ${formatMoney(s.amount || 0)}</p>
               <p><b>Taxas:</b> transação ${formatMoney(estimatedTransactionFee(s.amount || 0))} (0,99%) • afiliado ${formatMoney(s.affiliateFee || 0)}</p>
               <p><b>Afiliado:</b> ${toMoneyNumber(s.affiliateFee || s.pagamentoAtual?.affiliateFee || 0) > 0 ? 'comissão aplicada' : 'sem comissão neste pagamento'}</p>
               <p><b>Pagamentos aprovados:</b> ${approvedPaymentsFromSolicita(s).length}</p>
            </div>
            <div class="flex gap-2">
               <button onclick="window.approveSolicita('${s.id}', '${s.plano}')" 
                       class="flex-1 py-2 bg-emerald-600 text-white rounded-xl text-[10px] font-bold hover:bg-emerald-700 transition">APROVAR</button>
               <button onclick="window.rejectSolicita('${s.id}')" 
                       class="px-3 py-2 bg-gray-200 text-gray-600 rounded-xl text-[10px] font-bold hover:bg-gray-300 transition">REJEITAR</button>
               <button onclick="window.deleteSolicita('${s.id}')" 
                       class="px-3 py-2 bg-red-50 text-red-500 rounded-xl hover:bg-red-100 transition"><i data-lucide="trash-2" class="w-3.5 h-3.5"></i></button>
            </div>
          </div>
        `).join('');
        initIcons();
      } catch (e) {
         console.error(e);
         grid.innerHTML = `<div class="col-span-full py-10 text-center text-red-500">Erro ao carregar solicitações.</div>`;
      }
    }

    window.approveSolicita = async (sid, plano) => {
      try {
        const uid = sid;
        const uSnap = await getDoc(doc(db, 'users', uid));
        if (!uSnap.exists()) throw new Error("Usuário não encontrado.");

        const gid = uSnap.data().guildId;
        if (!gid) throw new Error("Guilda não localizada.");

        const normalizedPlano = normalizeVip(plano);
        const expiresAtMs = await buildVipExpiresAtFromPlan(normalizedPlano);

        await setDoc(doc(db, 'configGuilda', gid), {
          vipTier: normalizedPlano,
          vipExpiresAt: expiresAtMs,
          permissoesAtivas: normalizedPlano !== 'free',
          updatedAt: serverTimestamp(),
          updatedAtMs: Date.now()
        }, { merge: true });

        await setDoc(doc(db, 'guildas', gid), {
          vipTier: normalizedPlano,
          vipExpiresAt: expiresAtMs,
          permissoesAtivas: normalizedPlano !== 'free',
          updatedAt: serverTimestamp(),
          updatedAtMs: Date.now()
        }, { merge: true });

        await updateDoc(doc(db, 'solicita', sid), {
          status: 'aprovado',
          approvedVipTier: normalizedPlano,
          plano: normalizedPlano,
          vipExpiresAt: expiresAtMs,
          updatedAt: serverTimestamp(),
          updatedAtMs: Date.now()
        });

        showToast('success', 'Upgrade aprovado e ativo para a guilda!');
        try {
          const gx = (window.allGuildas || []).find(x => x.id === gid);
          if (gx) {
            gx.vipTier = normalizedPlano;
            gx.vip = normalizedPlano;
            gx.vipExpiresAt = expiresAtMs;
            gx.configUpdatedAt = Date.now();
          }
          localStorage.setItem('hub_ceo_guildas_v1', JSON.stringify({ ts: Date.now(), items: window.allGuildas }));
        } catch(_) {}
        
        renderGuilds();
        loadSolicita(); 
      } catch (e) {
        console.error(e);
        showToast('error', 'Erro ao aprovar: ' + (e?.message || e));
      }
    };

    window.rejectSolicita = async (sid) => {
       await updateDoc(doc(db, 'solicita', sid), { status: 'recusado', updatedAt: serverTimestamp() });
       showToast('info', 'Solicitação recusada.');
       loadSolicita();
    };

    window.deleteSolicita = async (sid) => {
      if(!confirm('Realmente quer excluir esta solicitação da lista?')) return;
      await deleteDoc(doc(db, 'solicita', sid));
      loadSolicita();
    };

    function closeDrawer() {
      const body = document.getElementById('drawer-body');
      body.classList.add('translate-x-full');
      setTimeout(() => document.getElementById('drawer').classList.add('hidden'), 300);
    }

    // Eventos
    document.getElementById('drawer-close').onclick = closeDrawer;
    document.getElementById('drawer-backdrop').onclick = closeDrawer;
    document.getElementById('btn-reload-guilds').onclick = () => loadData(true); // recarrega somente guildas/configGuilda
    document.getElementById('btn-reload-partners').onclick = () => loadPartners(true); // recarrega somente monetize/parceiros
    document.getElementById('btn-reload-plans')?.addEventListener('click', () => loadPlansAdmin(true));
    document.getElementById('btn-new-plan')?.addEventListener('click', () => window.openCreatePlanAdmin());
    document.getElementById('btn-reload-avisos')?.addEventListener('click', () => loadAvisos(true).catch((e) => {
      console.error(e);
      showAvisosStatus('error', 'Não foi possível atualizar os avisos.');
    }));
    document.getElementById('btn-run-search')?.addEventListener('click', applyAdminSearch);
    document.getElementById('guild-search')?.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter') return;
      event.preventDefault();
      applyAdminSearch();
    });
    document.getElementById('vip-filter').onchange = renderCurrentAdminView;
    document.getElementById('updated-filter').onchange = renderCurrentAdminView;
    document.getElementById('members-filter')?.addEventListener('change', renderCurrentAdminView);
    document.getElementById('finance-month-filter')?.addEventListener('change', () => renderFinanceSummary(lastFinanceSolicitaDocs));
    document.getElementById('finance-plan-filter')?.addEventListener('change', () => renderFinanceSummary(lastFinanceSolicitaDocs));
    document.getElementById('btn-delete-finance-month')?.addEventListener('click', () => window.confirmDeleteFinanceMonth());
    document.getElementById('view-guildas').onclick = () => setActiveView('guildas');
    document.getElementById('view-partners').onclick = () => setActiveView('partners');
    document.getElementById('view-plans').onclick = () => setActiveView('plans');
    document.getElementById('btn-open-solicita').onclick = () => { 
      document.getElementById('solicita-panel').classList.remove('hidden'); 
      loadSolicita(); 
    };
    document.getElementById('btn-close-solicita').onclick = () => document.getElementById('solicita-panel').classList.add('hidden');
    document.getElementById('solicita-overlay').onclick = () => document.getElementById('solicita-panel').classList.add('hidden');
    initCeoCustomSelects();
