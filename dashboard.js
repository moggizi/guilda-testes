// dashboard.js — código exclusivo do painel
// Separado do dashboard.html para facilitar manutenção e reduzir bugs.

    import { initializeApp, getApp, getApps } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
    import { getAuth, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
    import { collection, getDocs, doc, getDoc, onSnapshot, setDoc, writeBatch, serverTimestamp, query, where, limit } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
    import { getFirestore } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
    import { getSharedCache, setSharedCache, removeSharedCache, readSharedJsonCache, writeSharedJsonCache, isSharedCacheFresh, getSharedGuildContextCache, setSharedGuildContextCache, clearSharedGuildContextCache } from './logic.js';

    const GUILDCTX_LS_KEY = 'guildCtx_cache_v1';
    const SETTINGS_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
    const MEMBERS_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
    const MODE_OPTIONS = [
      { key: 'rush', label: 'Rush', goalField: 'metaGGRush' },
      { key: 'full-gas', label: 'Full Gás', goalField: 'metaGGFullGas' },
      { key: 'curandeiro', label: 'Curandeiro', goalField: 'metaGGCurandeiro' },
      { key: 'suporte', label: 'Suporte', goalField: 'metaGGSuporte' },
      { key: 'fuzileiro', label: 'Fuzileiro', goalField: 'metaGGFuzileiro' },
      { key: 'coringa', label: 'Coringa 🃏', goalField: 'metaGGCoringa' }
    ];

    let currentGuildSlot = 1;
    let currentGuildSlotsMeta = [{ slot: 1, name: '', tag: '', exists: true }];
    let canUseMultiGuildDashboard = false;
    let guildGoals = normalizeGoalsFromAnySource({});


    // Firebase/API exclusivos do dashboard. O logic.js é importado só para cache compartilhado.
    const firebaseConfig = {
      apiKey: "AIzaSyC7UJxBOViZj8ELjw-Xvy645QYfDfpBzxM",
      authDomain: "guilda-hubb.firebaseapp.com",
      projectId: "guilda-hubb",
      storageBucket: "guilda-hubb.firebasestorage.app",
      messagingSenderId: "117135418619",
      appId: "1:117135418619:web:e8ca8ec52eb0eeeff87c5e",
      measurementId: "G-9CHV67E64Y"
    };

    const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
    const auth = getAuth(app);
    const db = getFirestore(app);

    let dashboardGuildCtx = null;
    let dashboardIsCeo = false;

    function cleanEmail(email) {
      return (email || '').toString().toLowerCase().trim();
    }

    function uniq(arr) {
      const out = [];
      const seen = new Set();
      for (const v of (arr || [])) {
        const s = (v || '').toString();
        if (!s || seen.has(s)) continue;
        seen.add(s);
        out.push(s);
      }
      return out;
    }

    function getGuildContext() {
      if (dashboardGuildCtx?.guildId) return dashboardGuildCtx;
      const cached = getSharedGuildContextCache();
      if (cached?.guildId) {
        const role = String(cached.role || 'Membro');
        dashboardGuildCtx = {
          guildId: String(cached.guildId),
          guildName: cached.guildName ? String(cached.guildName) : null,
          role,
          email: String(cached.email || cached.emailLower || ''),
          emailLower: cleanEmail(cached.emailLower || cached.email || ''),
          uid: String(cached.uid || ''),
          vipTier: cached.vipTier ? String(cached.vipTier) : 'free',
          vipExpiresAtMs: cached.vipExpiresAtMs != null ? Number(cached.vipExpiresAtMs) : null,
          isLeader: cached.isLeader === true || role === 'Líder',
          isAdmin: cached.isAdmin === true || role === 'Admin',
          isOwner: cached.isOwner === true,
          isCeo: cached.isCeo === true
        };
      }
      return dashboardGuildCtx;
    }


    function readCeoCacheForEmail(email){
      const clean = cleanEmail(email);
      const cached = readSharedJsonCache('ceo_cache_v1', null);
      if (!cached || !clean) return null;
      const cachedEmail = cleanEmail(cached.email || cached.emailLower || '');
      if (cachedEmail !== clean) return null;
      if (!isSharedCacheFresh(cached, SETTINGS_CACHE_TTL_MS)) return null;
      return cached;
    }

    function hasCompleteSidebarIdentity(ctx, user){
      const email = cleanEmail(user?.email || ctx?.email || ctx?.emailLower || '');
      if (!ctx || !user || !ctx.guildId || !ctx.uid || !ctx.role) return false;
      if (String(ctx.uid) !== String(user.uid || '')) return false;
      if (!email || cleanEmail(ctx.email || ctx.emailLower || '') !== email) return false;
      const role = String(ctx.role || '').trim();
      if (!role) return false;
      const hasFlags = typeof ctx.isLeader === 'boolean' && typeof ctx.isAdmin === 'boolean';
      return hasFlags && isSharedCacheFresh(ctx, SETTINGS_CACHE_TTL_MS);
    }

    function applyCachedSidebarNow(){
      try {
        const ctx = getGuildContext();
        if (!ctx?.guildId) return false;

        const emailEl = document.getElementById('user-email');
        if (emailEl && (ctx.email || ctx.emailLower)) emailEl.textContent = ctx.email || ctx.emailLower || '';

        const roleEl = document.getElementById('user-role');
        if (roleEl && ctx.role) roleEl.textContent = ctx.role;

        if (ctx.vipTier) applyVipUiAndGates(ctx.vipTier);

        const ceo = readCeoCacheForEmail(ctx.email || ctx.emailLower || '');
        if (ceo) dashboardIsCeo = ceo.isCeo === true;
        else if (ctx.isCeo === true) dashboardIsCeo = true;
        applyCeoNavVisibility();
        initIcons();
        return true;
      } catch (_) {
        return false;
      }
    }

    function mergeCeoIntoGuildCache(isCeo){
      try {
        const prev = getGuildContext();
        if (!prev?.guildId) return;
        const next = setSharedGuildContextCache({ ...prev, isCeo: isCeo === true });
        dashboardGuildCtx = { ...dashboardGuildCtx, ...next };
      } catch (_) {}
    }

    function getVipTier() {
      return getGuildContext()?.vipTier || 'free';
    }

    function getVipExpiresAtMs() {
      const ms = getGuildContext()?.vipExpiresAtMs;
      return ms != null ? Number(ms) : null;
    }

    function getVipRemainingDays() {
      const ms = getVipExpiresAtMs();
      if (!ms) return null;
      const diff = ms - Date.now();
      if (!isFinite(diff)) return null;
      return Math.max(0, Math.ceil(diff / 86400000));
    }

    function vipTierFromValue(v) {
      const s = (v || '').toString().toLowerCase().trim();
      if (!s || s === 'free') return 'free';
      if (s === 'vitalicio' || s === 'vitalício' || s.includes('vital') || s.includes('life')) return 'vitalicio';
      if (s === 'business' || s === 'bussines' || s.includes('buss') || s.includes('business')) return 'business';
      if (s === 'pro' || s.includes('pro')) return 'pro';
      return 'plus';
    }

    function toastEscapeHtml(str) {
      return String(str)
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#039;');
    }

    function showToast(type = 'info', message = '') {
      let container = document.getElementById('toast-container');
      if (!container) {
        container = document.createElement('div');
        container.id = 'toast-container';
        container.className = 'fixed top-4 right-4 z-[9999] flex flex-col gap-2';
        document.body.appendChild(container);
      }
      const toast = document.createElement('div');
      toast.className = 'px-4 py-3 rounded-xl shadow-lg border text-sm font-medium flex items-start gap-2 max-w-[340px] ' +
        (type === 'success' ? 'bg-emerald-50 text-emerald-800 border-emerald-200' :
         type === 'error' ? 'bg-red-50 text-red-800 border-red-200' :
         'bg-gray-900 text-white border-white/10');
      toast.innerHTML = `<div class="flex-1 leading-snug">${toastEscapeHtml(message)}</div>`;
      container.appendChild(toast);
      setTimeout(() => { toast.style.opacity = '0'; toast.style.transform = 'translateY(-4px)'; toast.style.transition = 'all 180ms ease'; }, 2600);
      setTimeout(() => toast.remove(), 3000);
    }

    function initIcons() {
      try { if (window.lucide && typeof window.lucide.createIcons === 'function') window.lucide.createIcons(); } catch (_) {}
    }

    function setupSidebar() {
      const sidebar = document.getElementById('sidebar');
      const overlay = document.getElementById('sidebar-overlay');
      const btn = document.getElementById('mobile-menu-btn');
      if (!sidebar || !overlay || !btn) return;
      const open = () => { sidebar.classList.remove('-translate-x-full'); overlay.classList.remove('hidden'); };
      const close = () => { sidebar.classList.add('-translate-x-full'); overlay.classList.add('hidden'); };
      btn.addEventListener('click', open);
      overlay.addEventListener('click', close);
      sidebar.querySelectorAll('a[href]').forEach(a => a.addEventListener('click', () => { if (window.innerWidth < 1024) close(); }));
      if (window.innerWidth < 1024) close();
    }

    async function logout() {
      try { await signOut(auth); }
      finally {
        try {
          clearSharedGuildContextCache();
          removeSharedCache('membersList');
          removeSharedCache('dashboard_stats');
          removeSharedCache('campsList');
          for (let i = localStorage.length - 1; i >= 0; i--) {
            const k = localStorage.key(i) || '';
            if (k.startsWith('securityConfig_') || k.startsWith('tagMembros_')) removeSharedCache(k);
          }
        } catch (_) {}
        window.location.href = 'index.html';
      }
    }

    function applyCeoNavVisibility() {
      try {
        document.querySelectorAll('[data-ceo-only="true"], #nav-chefe').forEach((el) => {
          if (dashboardIsCeo) el.classList.remove('hidden');
          else el.classList.add('hidden');
        });
      } catch (_) {}
    }

    async function refreshCeoStatus(emailLower) {
      const email = cleanEmail(emailLower);
      if (!email) return false;
      try {
        const snap = await getDoc(doc(db, 'chefe', 'security'));
        const data = snap.exists() ? (snap.data() || {}) : {};
        const list = Array.isArray(data.ceo) ? data.ceo : [];
        const ok = list.map(cleanEmail).includes(email);
        dashboardIsCeo = ok;
        setSharedCache('ceo_cache_v1', JSON.stringify({ email, emailLower: email, isCeo: ok, ts: Date.now() }));
        mergeCeoIntoGuildCache(ok);
        return ok;
      } catch (_) {
        dashboardIsCeo = false;
        return false;
      }
    }

    function applyVipUiAndGates(tierRaw) {
      const tier = normalizeTier(tierRaw || getVipTier());
      const vipLabel = document.getElementById('vip-label');
      if (vipLabel) {
        const days = getVipRemainingDays();
        const daysTxt = (tier !== 'free' && tier !== 'vitalicio' && days != null) ? ` • ${days} dias` : '';
        vipLabel.innerHTML = `Guilda: <span class="font-bold text-gray-800">${tier === 'vitalicio' ? 'VITALÍCIO' : tier.toUpperCase()}${daysTxt}</span>`;
      }
      document.querySelectorAll('span').forEach((sp) => {
        if (sp.closest && sp.closest('#vip-label')) return;
        if (sp.dataset && sp.dataset.vipTag) return;
        const t = (sp.textContent || '').trim().toUpperCase();
        if (t === 'PLUS') sp.dataset.vipTag = 'plus';
        if (t === 'PRO') sp.dataset.vipTag = 'pro';
      });
      const showPlusTags = tier === 'free';
      const showProTags = (tier !== 'pro' && tier !== 'business' && tier !== 'vitalicio');
      document.querySelectorAll('[data-vip-tag]').forEach((el) => {
        const tag = (el.dataset.vipTag || '').toLowerCase();
        if (tag === 'plus') el.style.display = showPlusTags ? '' : 'none';
        if (tag === 'pro') el.style.display = showProTags ? '' : 'none';
      });
    }

    async function getGuildName(guildId) {
      try {
        const snap = await getDoc(doc(db, 'guildas', guildId));
        if (!snap.exists()) return null;
        const data = snap.data() || {};
        return (data.name || '').toString().trim() || null;
      } catch (_) { return null; }
    }

    async function findGuildByEmail(emailLower) {
      if (!emailLower) return null;
      try { const s = await getDocs(query(collection(db, 'configGuilda'), where('leaders', 'array-contains', emailLower), limit(1))); if (!s.empty) return { guildId: s.docs[0].id, source: 'leaders' }; } catch (_) {}
      try { const s = await getDocs(query(collection(db, 'configGuilda'), where('admins', 'array-contains', emailLower), limit(1))); if (!s.empty) return { guildId: s.docs[0].id, source: 'admins' }; } catch (_) {}
      try { const s = await getDocs(query(collection(db, 'configGuilda'), where('ownerEmail', '==', emailLower), limit(1))); if (!s.empty) return { guildId: s.docs[0].id, source: 'ownerEmail' }; } catch (_) {}
      try { const s = await getDocs(query(collection(db, 'configGuilda'), where('playerEmail', '==', emailLower), limit(1))); if (!s.empty) return { guildId: s.docs[0].id, source: 'playerEmail' }; } catch (_) {}
      try {
        const snap = await getDocs(query(collection(db, 'configGuilda'), limit(300)));
        for (const d of snap.docs) {
          const data = d.data() || {};
          const leaders = uniq((Array.isArray(data.leaders) ? data.leaders : []).map(cleanEmail)).filter(Boolean);
          const admins = uniq((Array.isArray(data.admins) ? data.admins : []).map(cleanEmail)).filter(Boolean);
          if (leaders.includes(emailLower)) return { guildId: d.id, source: 'scan-leaders' };
          if (admins.includes(emailLower)) return { guildId: d.id, source: 'scan-admins' };
          if (cleanEmail(data.ownerEmail) === emailLower) return { guildId: d.id, source: 'scan-ownerEmail' };
          if (cleanEmail(data.playerEmail) === emailLower) return { guildId: d.id, source: 'scan-playerEmail' };
        }
      } catch (_) {}
      return null;
    }

    async function resolveRoleInGuild(guildId, email) {
      const e = cleanEmail(email);
      if (!guildId || !e) return 'Membro';
      try {
        const snap = await getDoc(doc(db, 'configGuilda', guildId));
        if (snap.exists()) {
          const data = snap.data() || {};
          const leaders = uniq((Array.isArray(data.leaders) ? data.leaders : []).map(cleanEmail)).filter(Boolean);
          const admins = uniq((Array.isArray(data.admins) ? data.admins : []).map(cleanEmail)).filter(Boolean);
          if (leaders.includes(e)) return 'Líder';
          if (admins.includes(e)) return 'Admin';
          if (cleanEmail(data.playerEmail) === e) return 'Jogador';
        }
        const g = await getDoc(doc(db, 'guildas', guildId));
        if (g.exists()) {
          const gd = g.data() || {};
          if ((gd.ownerUid || '').toString().trim() === auth.currentUser?.uid) return 'Líder';
          if (cleanEmail(gd.ownerEmail) === e) return 'Líder';
        }
        return 'Membro';
      } catch (_) { return 'Membro'; }
    }

    async function normalizeConfigGuilda(guildId) {
      try {
        const ref = doc(db, 'configGuilda', guildId);
        const snap = await getDoc(ref);
        if (!snap.exists()) return;
        const data = snap.data() || {};
        const leaders = Array.isArray(data.leaders) ? data.leaders : [];
        const admins = Array.isArray(data.admins) ? data.admins : [];
        const leadersN = uniq(leaders.map(cleanEmail)).filter(Boolean);
        const adminsN = uniq(admins.map(cleanEmail)).filter(Boolean);
        const ownerEmailN = data.ownerEmail ? cleanEmail(data.ownerEmail) : null;
        const changed = JSON.stringify(leadersN) !== JSON.stringify(leaders) || JSON.stringify(adminsN) !== JSON.stringify(admins) || (data.ownerEmail ? ownerEmailN !== data.ownerEmail : false);
        if (!changed) return;
        await setDoc(ref, { ...(ownerEmailN ? { ownerEmail: ownerEmailN } : {}), leaders: leadersN, admins: adminsN, updatedAt: serverTimestamp() }, { merge: true });
      } catch (_) {}
    }

    async function ensureOwnerDocsLight(user) {
      const uid = user?.uid;
      if (!uid) return;
      const batch = writeBatch(db);
      batch.set(doc(db, 'guildas', uid), { updatedAt: serverTimestamp() }, { merge: true });
      batch.set(doc(db, 'configGuilda', uid), { updatedAt: serverTimestamp() }, { merge: true });
      batch.set(doc(db, 'users', uid), { updatedAt: serverTimestamp() }, { merge: true });
      await batch.commit();
    }

    async function syncPermissoesAtivasIfNeeded(guildId, cfgData, vipTier, vipExpiresAtMs) {
      try {
        if (!guildId) return null;
        const tier = (vipTier || cfgData?.vipTier || 'free').toString().toLowerCase().trim();
        const paid = (tier === 'plus' || tier === 'pro' || tier === 'business' || tier === 'vitalicio' || tier.includes('pro') || tier.includes('business') || tier.includes('buss') || tier.includes('vital'));
        const exp = (vipExpiresAtMs != null && isFinite(Number(vipExpiresAtMs))) ? Number(vipExpiresAtMs) : null;
        const vipAtivo = paid && (tier.includes('vital') || exp == null || Date.now() < exp);
        const atual = (cfgData && cfgData.permissoesAtivas !== undefined) ? (cfgData.permissoesAtivas !== false) : null;
        const novo = !!vipAtivo;
        if (atual === null || atual !== novo) await setDoc(doc(db, 'configGuilda', guildId), { permissoesAtivas: novo, updatedAt: serverTimestamp() }, { merge: true });
        return novo;
      } catch (_) { return null; }
    }

    function parseVipFromData(data = {}) {
      const rawVip = data.vipTier ?? data.vip ?? data.planoVip ?? data.planoVIP ?? data.vipLevel ?? data.vipPlano ?? data.vipName ?? data.plano ?? data.plan ?? data.tier;
      const rawExp = data.vipExpiresAt ?? data.vipExpiraEm ?? data.vipExpireAt ?? data.expiresAt ?? data.vipExpires;
      return { vipTier: vipTierFromValue(rawVip), vipExpiresAtMs: toMs(rawExp) };
    }

    function showWelcomeLoginModal() {
      try {
        const params = new URLSearchParams(window.location.search || '');
        if (params.get('login') !== '1') return false;
        const overlay = document.getElementById('welcome-overlay');
        const modal = document.getElementById('welcome-modal');
        const closeBtn = document.getElementById('welcome-close');
        if (!overlay || !modal || !closeBtn) return false;
        if (modal.dataset.bound === '1') return true;
        const close = () => {
          modal.classList.remove('show'); overlay.classList.remove('show'); modal.setAttribute('aria-hidden', 'true'); document.documentElement.classList.remove('overflow-hidden');
          setTimeout(() => { modal.classList.add('hidden'); overlay.classList.add('hidden'); }, 240);
        };
        modal.dataset.bound = '1';
        closeBtn.addEventListener('click', close);
        overlay.addEventListener('click', close);
        document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !modal.classList.contains('hidden')) close(); });
        overlay.classList.remove('hidden'); modal.classList.remove('hidden'); modal.setAttribute('aria-hidden', 'false'); document.documentElement.classList.add('overflow-hidden');
        requestAnimationFrame(() => { overlay.classList.add('show'); modal.classList.add('show'); });
        initIcons();
        return true;
      } catch (_) { return false; }
    }

    function consumeLoginToasts() {
      try {
        const params = new URLSearchParams(window.location.search || '');
        if (params.get('login') !== '1') return;
        const email = (document.getElementById('user-email')?.textContent || auth.currentUser?.email || '').trim();
        const role = (document.getElementById('user-role')?.textContent || 'Membro').trim();
        showToast('success', 'Login realizado com sucesso!');
        showToast('info', `Perfil: ${role} • ${email}`);
        params.delete('login');
        const qs = params.toString();
        history.replaceState({}, '', window.location.pathname + (qs ? `?${qs}` : '') + (window.location.hash || ''));
      } catch (_) {}
    }

    async function getGuildInfoCached(guildId, options = {}) {
      const gid = (guildId || getGuildContext()?.guildId || '').toString().trim();
      if (!gid) return { guildId: null, name: null, createdAtMs: null };
      const key = `guildInfo_${gid}`;
      const cached = readSharedJsonCache(key, null);
      if (isSharedCacheFresh(cached, options?.ttlMs ?? SETTINGS_CACHE_TTL_MS) && cached?.guildId === gid) return { guildId: gid, name: cached.name || null, createdAtMs: cached.createdAtMs != null ? Number(cached.createdAtMs) : null };
      try {
        const snap = await getDoc(doc(db, 'guildas', gid));
        const data = snap.exists() ? (snap.data() || {}) : {};
        const name = (data.name || '').toString().trim() || null;
        const createdAtMs = toMs(data.createdAt);
        writeSharedJsonCache(key, { guildId: gid, name, createdAtMs, ts: Date.now() });
        return { guildId: gid, name, createdAtMs };
      } catch (_) {
        if (cached?.guildId === gid) return { guildId: gid, name: cached.name || null, createdAtMs: cached.createdAtMs != null ? Number(cached.createdAtMs) : null };
        return { guildId: gid, name: null, createdAtMs: null };
      }
    }

    function readGuildMultiCache(guildId) {
      return readSharedJsonCache(`guildMulti_${guildId}`, null);
    }

    function writeGuildMultiCache(guildId, slots) {
      writeSharedJsonCache(`guildMulti_${guildId}`, Array.isArray(slots) ? slots : []);
      setSharedCache(`guildMulti_${guildId}_ts`, String(Date.now()));
    }

    async function getGuildMultiConfig(maxSlots = 4, options = {}) {
      if (typeof maxSlots === 'object' && maxSlots !== null) { options = maxSlots; maxSlots = 4; }
      const guildId = getGuildContext()?.guildId;
      if (!guildId) return [];
      const safeMax = Math.max(1, Math.min(4, Math.floor(Number(maxSlots) || 4)));
      const cachedSlots = readGuildMultiCache(guildId);
      const cachedTs = Number(getSharedCache(`guildMulti_${guildId}_ts`) || 0) || 0;
      if (options?.forceRefresh !== true && cachedSlots?.length && isSharedCacheFresh({ ts: cachedTs }, options?.ttlMs ?? SETTINGS_CACHE_TTL_MS)) return cachedSlots.filter(Boolean).slice(0, safeMax);
      let cfg = {};
      try { const snap = await getDoc(doc(db, 'configGuilda', guildId)); cfg = snap.exists() ? (snap.data() || {}) : {}; }
      catch (_) { if (cachedSlots?.length) return cachedSlots.filter(Boolean).slice(0, safeMax); }
      let primaryName = (cfg.name || '').toString().trim();
      if (!primaryName) primaryName = (await getGuildInfoCached(guildId, options))?.name || getGuildContext()?.guildName || 'Guilda 1';
      const out = [];
      for (let i = 1; i <= safeMax; i++) {
        const nameField = i <= 1 ? 'name' : `name${i}`;
        const tagField = i <= 1 ? 'tagMembros' : `tagMembros${i}`;
        const name = i <= 1 ? primaryName : (cfg[nameField] || '').toString().trim();
        const tag = (cfg[tagField] || '').toString();
        out.push({ slot: i, nameField, tagField, name, tag, exists: i === 1 || !!name || !!tag || cfg[`guild${i}Ativa`] === true });
      }
      writeGuildMultiCache(guildId, out);
      return out;
    }

    function normalizeGuildGoalsForCache(data = {}) {
      return normalizeGoalsFromAnySource(data || {});
    }

    async function getGuildGoalsConfig(options = {}) {
      const guildId = getGuildContext()?.guildId;
      if (!guildId) return normalizeGuildGoalsForCache({});
      const key = `guildGoals_${guildId}`;
      const cached = readSharedJsonCache(key, null);
      if (options?.forceRefresh !== true && isSharedCacheFresh(cached, options?.ttlMs ?? SETTINGS_CACHE_TTL_MS)) return normalizeGuildGoalsForCache(cached || {});
      try {
        const snap = await getDoc(doc(db, 'configGuilda', guildId));
        const goals = normalizeGuildGoalsForCache(snap.exists() ? (snap.data() || {}) : {});
        writeSharedJsonCache(key, { ...goals, ts: Date.now() });
        return goals;
      } catch (_) {
        if (cached) return normalizeGuildGoalsForCache(cached || {});
        return normalizeGuildGoalsForCache({});
      }
    }

    function checkAuth(redirectToLogin = true) {
      return new Promise((resolve) => {
        onAuthStateChanged(auth, async (user) => {
          const isLoginPage = /index\.html$|\/$/i.test(window.location.pathname || '');
          if (!user) {
            if (redirectToLogin && !isLoginPage) window.location.href = 'index.html';
            resolve(null);
            return;
          }

          const emailLower = cleanEmail(user.email);
          const emailEl = document.getElementById('user-email');
          if (emailEl) emailEl.textContent = user.email || '';

          const cachedCtx = getSharedGuildContextCache();
          if (hasCompleteSidebarIdentity(cachedCtx, user)) {
            dashboardGuildCtx = {
              ...cachedCtx,
              email: cleanEmail(cachedCtx.email || cachedCtx.emailLower || emailLower),
              emailLower,
              uid: String(user.uid)
            };
            applyCachedSidebarNow();

            const cachedCeo = readCeoCacheForEmail(emailLower);
            if (cachedCeo) {
              dashboardIsCeo = cachedCeo.isCeo === true;
              applyCeoNavVisibility();
            } else if (typeof cachedCtx.isCeo === 'boolean') {
              dashboardIsCeo = cachedCtx.isCeo === true;
              applyCeoNavVisibility();
            } else {
              // Só consulta o Firebase para chefe/CEO quando esse dado ainda não existe no cache.
              try { await refreshCeoStatus(emailLower); } catch (_) {}
              applyCeoNavVisibility();
            }

            if (String(cachedCtx.role || '') === 'Jogador') {
              window.location.href = 'jogador.html';
              resolve(null); return;
            }

            resolve(user);
            return;
          }

          let guildId = null;
          let roleHint = null;
          let userProfile = null;
          try {
            const uSnap = await getDoc(doc(db, 'users', user.uid));
            if (uSnap.exists()) {
              userProfile = uSnap.data() || {};
              if (userProfile.guildId) guildId = String(userProfile.guildId);
              if (userProfile.role) roleHint = String(userProfile.role);
            }
          } catch (_) {}

          if (!guildId) {
            try { const found = await findGuildByEmail(emailLower); if (found?.guildId) guildId = found.guildId; } catch (_) {}
          }
          if (!guildId) {
            try { const selfCfg = await getDoc(doc(db, 'configGuilda', user.uid)); if (selfCfg.exists()) guildId = user.uid; } catch (_) {}
          }
          if (!guildId) {
            try { await signOut(auth); } catch (_) {}
            if (!isLoginPage) window.location.href = 'index.html';
            resolve(null); return;
          }

          try { if (guildId === user.uid) await ensureOwnerDocsLight(user); } catch (_) {}

          let role = null;
          const hint = (roleHint || '').toString().trim();
          if (hint && ['Líder', 'Admin', 'Jogador'].includes(hint)) role = hint;
          const resolved = await resolveRoleInGuild(guildId, user.email || '');
          if (!role || role === 'Membro') role = resolved;
          if (role === 'Membro' && hint && hint !== 'Membro') role = hint;
          if (role === 'Líder') normalizeConfigGuilda(guildId);

          const guildName = await getGuildName(guildId);
          let vipTier = 'free';
          let vipExpiresAtMs = null;
          let cfgData = null;

          try {
            const cfgSnap = await getDoc(doc(db, 'configGuilda', guildId));
            if (cfgSnap.exists()) {
              cfgData = cfgSnap.data() || {};
              const parsed = parseVipFromData(cfgData);
              vipTier = parsed.vipTier;
              vipExpiresAtMs = parsed.vipExpiresAtMs;
            }
          } catch (_) {}

          if (!vipTier || vipTier === 'free' || vipExpiresAtMs == null) {
            try {
              const gSnap = await getDoc(doc(db, 'guildas', guildId));
              if (gSnap.exists()) {
                const parsed = parseVipFromData(gSnap.data() || {});
                if (parsed.vipTier) vipTier = parsed.vipTier;
                if (vipExpiresAtMs == null) vipExpiresAtMs = parsed.vipExpiresAtMs;
              }
            } catch (_) {}
          }

          if (vipTier && vipTier !== 'free' && vipTier !== 'vitalicio' && vipExpiresAtMs != null && isFinite(vipExpiresAtMs) && Date.now() > vipExpiresAtMs) {
            vipTier = 'free'; vipExpiresAtMs = null;
            try { await setDoc(doc(db, 'configGuilda', guildId), { vipTier: 'free', vipExpiresAt: null, updatedAt: serverTimestamp() }, { merge: true }); } catch (_) {}
            try { await setDoc(doc(db, 'guildas', guildId), { vipTier: 'free', updatedAt: serverTimestamp() }, { merge: true }); } catch (_) {}
          }

          let permissoesAtivas = null;
          try {
            permissoesAtivas = await syncPermissoesAtivasIfNeeded(guildId, cfgData, vipTier, vipExpiresAtMs);
            if (permissoesAtivas == null && cfgData && cfgData.permissoesAtivas !== undefined) permissoesAtivas = cfgData.permissoesAtivas !== false;
          } catch (_) {}

          try {
            const ownerEmail = cfgData?.ownerEmail ? cleanEmail(cfgData.ownerEmail) : '';
            const isOwner = (guildId === user.uid) || (!!ownerEmail && ownerEmail === emailLower);
            const okPerm = permissoesAtivas == null ? true : !!permissoesAtivas;
            if (!okPerm && ((role === 'Líder' && !isOwner) || role === 'Admin')) {
              showToast('error', 'Conta expirada');
              try { await signOut(auth); } catch (_) {}
              clearSharedGuildContextCache();
              window.location.href = 'index.html';
              resolve(null); return;
            }
          } catch (_) {}

          const isOwner = (() => {
            try {
              const ownerEmail = cfgData?.ownerEmail ? cleanEmail(cfgData.ownerEmail) : '';
              return guildId === user.uid || (!!ownerEmail && ownerEmail === emailLower);
            } catch (_) {
              return guildId === user.uid;
            }
          })();

          dashboardGuildCtx = {
            guildId,
            guildName,
            role,
            vipTier,
            vipExpiresAtMs,
            email: emailLower,
            emailLower,
            uid: user.uid,
            isLeader: role === 'Líder',
            isAdmin: role === 'Admin',
            isOwner
          };
          setSharedGuildContextCache(dashboardGuildCtx);
          applyVipUiAndGates(vipTier);
          try { await refreshCeoStatus(emailLower); } catch (_) {}
          applyCeoNavVisibility();

          const roleEl = document.getElementById('user-role');
          if (roleEl) roleEl.textContent = role;

          const path = (window.location.pathname || '').toLowerCase();
          const isDashboardPage = path.endsWith('/dashboard') || path.endsWith('/dashboard.html') || path.includes('dashboard.html');
          if (role === 'Membro') {
            const hasUserLink = !!(userProfile && userProfile.guildId);
            if (!hasUserLink && (!hint || hint === 'Membro')) {
              try { await signOut(auth); } catch (_) {}
              if (!isLoginPage) window.location.href = 'index.html';
              resolve(null); return;
            }
          }
          if (role === 'Jogador') {
            window.location.href = 'jogador.html';
            resolve(null); return;
          }
          // No dashboard o admin pode entrar. Páginas antigas continuam protegidas pelo logic.js.
          try {
            const message = sessionStorage.getItem('hub_signup_promo_toast');
            if (message) { sessionStorage.removeItem('hub_signup_promo_toast'); showToast('success', message); }
          } catch (_) {}
          resolve(user);
        });
      });
    }

    function normalizeTier(raw){
      const s = (raw || 'free').toString().toLowerCase().trim();
      if (s.includes('vital') || s.includes('life')) return 'vitalicio';
      if (s.includes('buss') || s.includes('business')) return 'business';
      if (s.includes('pro')) return 'pro';
      if (s.includes('plus')) return 'plus';
      return 'free';
    }

    function safeParseJSON(raw, fallback){
      try { return JSON.parse(raw); } catch { return fallback; }
    }

    function safeStorageGet(key){
      return getSharedCache(key);
    }

    function safeStorageSet(key, value){
      setSharedCache(key, value);
    }

    function safeSessionGet(key){
      try { return key ? sessionStorage.getItem(key) : null; } catch { return null; }
    }

    function safeSessionSet(key, value){
      try { if (key) sessionStorage.setItem(key, value); } catch {}
    }

    const PARTNER_REF_KEY = 'ghub_partner_ref';

    function sanitizePartnerRef(value){
      return String(value || '').trim().replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 80);
    }

    function getStoredPartnerRef(){
      return sanitizePartnerRef(safeStorageGet(PARTNER_REF_KEY) || safeSessionGet(PARTNER_REF_KEY) || '');
    }

    function capturePartnerRefOnDashboard(){
      try {
        const ref = sanitizePartnerRef(new URLSearchParams(window.location.search || '').get('ref'));
        if (!ref) return '';
        safeStorageSet(PARTNER_REF_KEY, ref);
        safeSessionSet(PARTNER_REF_KEY, ref);
        return ref;
      } catch {
        return '';
      }
    }

    async function ensurePartnerInviteCountedOnDashboard(user){
      try {
        if (!user) return;
        const ctx = getGuildContext();
        const guildId = String(ctx?.guildId || user?.uid || '').trim();
        if (!guildId || guildId !== String(user?.uid || '').trim()) return;

        const urlRef = capturePartnerRefOnDashboard();
        const storedRef = getStoredPartnerRef();
        const ref = sanitizePartnerRef(urlRef || storedRef || '');

        // Chama mesmo sem ref local: a API consegue recuperar o parceiro direto de configGuilda/{guildId}
        // quando o cadastro já gravou indicadoPorParceiro/parceiroRef.
        const idToken = await user.getIdToken(true);
        const res = await fetch('/api/monetize_bind_referral', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${idToken}`
          },
          body: JSON.stringify({ ref, guildId })
        });

        const data = await res.json().catch(() => ({}));
        if (!res.ok || data?.ok !== true) {
          console.warn('[dashboard-referral-sync]', data?.error || data);
          return;
        }

        if (data?.ref) {
          safeStorageSet(PARTNER_REF_KEY, sanitizePartnerRef(data.ref));
          safeSessionSet(PARTNER_REF_KEY, sanitizePartnerRef(data.ref));
        }
      } catch (error) {
        console.warn('[dashboard-referral-sync]', error);
      }
    }

    function isFreshCache(cached, ttlMs = SETTINGS_CACHE_TTL_MS){
      return isSharedCacheFresh(cached, ttlMs);
    }

    function readJsonStorage(key, fallback = null){
      try {
        if (!key) return fallback;
        const raw = safeStorageGet(key);
        return raw ? (JSON.parse(raw) || fallback) : fallback;
      } catch { return fallback; }
    }

    function writeJsonStorage(key, value){
      safeStorageSet(key, JSON.stringify(value));
    }

    function currentGuildId(){
      return getGuildContext()?.guildId || '';
    }

    function guildSlotSelectionKey(){
      const gid = currentGuildId();
      return gid ? `membersGuildSlot_${gid}` : 'membersGuildSlot';
    }

    function readSelectedGuildSlot(){
      try {
        const n = Math.floor(Number(safeStorageGet(guildSlotSelectionKey())) || 1);
        return (n >= 1 && n <= 4) ? n : 1;
      } catch { return 1; }
    }

    function writeSelectedGuildSlot(slot){
      safeStorageSet(guildSlotSelectionKey(), String(Math.max(1, Math.min(4, Math.floor(Number(slot) || 1)))));
    }

    function membersCollectionName(slot = currentGuildSlot){
      const n = Math.max(1, Math.min(4, Math.floor(Number(slot) || 1)));
      return n <= 1 ? 'membros' : `membros${n}`;
    }

    function membersCacheKey(guildId, slot = currentGuildSlot){
      return guildId ? `membersList_${guildId}_${membersCollectionName(slot)}` : `membersList_${membersCollectionName(slot)}`;
    }

    function legacyMembersCacheKey(guildId){
      return `membersList_${guildId}`;
    }

    function membersCacheMetaKey(guildId, slot = currentGuildSlot){
      const key = membersCacheKey(guildId, slot);
      return key ? `${key}_meta` : '';
    }

    function legacyMembersCacheMetaKey(guildId){
      const key = legacyMembersCacheKey(guildId);
      return key ? `${key}_meta` : '';
    }

    function normalizeGuildSlotMetaList(list){
      const map = new Map();
      (Array.isArray(list) ? list : []).forEach((slot) => {
        const n = Math.floor(Number(slot?.slot));
        if (!Number.isFinite(n) || n < 1 || n > 4) return;
        map.set(n, {
          slot: n,
          nameField: slot?.nameField || (n <= 1 ? 'name' : `name${n}`),
          tagField: slot?.tagField || (n <= 1 ? 'tagMembros' : `tagMembros${n}`),
          name: (slot?.name || '').toString(),
          tag: (slot?.tag || '').toString(),
          exists: slot?.exists !== false
        });
      });
      if (!map.has(1)) map.set(1, { slot: 1, name: getGuildContext()?.guildName || '', tag: '', exists: true });
      return Array.from(map.values()).sort((a, b) => a.slot - b.slot);
    }

    function getGuildSlotMeta(slot = currentGuildSlot){
      return (currentGuildSlotsMeta || []).find(item => Number(item?.slot) === Number(slot)) || null;
    }

    function isGuildSlotAvailable(slot){
      const n = Number(slot);
      if (n === 1) return true;
      const meta = getGuildSlotMeta(n);
      return !!(meta && meta.exists);
    }

    function currentGuildDisplayName(slot = currentGuildSlot){
      const meta = getGuildSlotMeta(slot);
      const name = (meta?.name || '').toString().trim();
      return name || (slot === 1 ? (getGuildContext()?.guildName || 'Guilda 1') : `Guilda ${slot}`);
    }

    function readFreshSettingsCache(){
      const gid = currentGuildId();
      if (!gid) return null;
      const ajustes = readJsonStorage(`ajustesTela_${gid}`, null);
      const info = readJsonStorage(`guildInfo_${gid}`, null);
      const goals = readJsonStorage(`guildGoals_${gid}`, null);
      const multi = readJsonStorage(`guildMulti_${gid}`, null);
      const multiTs = Number(safeStorageGet(`guildMulti_${gid}_ts`) || 0) || 0;

      const merged = { ...(isFreshCache(ajustes) ? ajustes : {}), guildId: gid };
      if (!merged.guildName && isFreshCache(info) && info?.name) merged.guildName = info.name;
      if (!merged.goals && isFreshCache(goals)) merged.goals = goals;
      if ((!Array.isArray(merged.multiGuildSlots) || !merged.multiGuildSlots.length) && Array.isArray(multi) && multi.length && isFreshCache({ ts: multiTs })) {
        merged.multiGuildSlots = multi;
      }
      return merged;
    }

    function writeSettingsSnapshot(){
      const gid = currentGuildId();
      if (!gid) return;
      const prev = readJsonStorage(`ajustesTela_${gid}`, {}) || {};
      writeJsonStorage(`ajustesTela_${gid}`, {
        ...prev,
        guildId: gid,
        guildName: currentGuildDisplayName(1),
        goals: normalizeGoalsFromAnySource(guildGoals || {}),
        multiGuildSlots: normalizeGuildSlotMetaList(currentGuildSlotsMeta),
        ts: Date.now()
      });
    }

    function normalizeMembers(list){
      const arr = Array.isArray(list) ? list.slice() : [];
      arr.sort((a,b)=> String(a.nick||'').localeCompare(String(b.nick||'')));
      return arr;
    }

    function normalizeModeValue(value){
      const raw = (value == null ? '' : String(value))
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/🃏/g, '')
        .trim();
      if (!raw) return '';
      if (raw === 'rush') return 'rush';
      if (raw === 'full gas' || raw === 'fullgas') return 'full-gas';
      if (raw === 'curandeiro') return 'curandeiro';
      if (raw === 'suporte') return 'suporte';
      if (raw === 'fuzileiro') return 'fuzileiro';
      if (raw === 'coringa') return 'coringa';
      return raw.replace(/\s+/g, '-');
    }

    function getMemberPlayModes(member){
      const raw = member?.playMode;
      const list = Array.isArray(raw)
        ? raw
        : (raw ? String(raw).split(/[|,;/]+/) : []);
      return list.map(normalizeModeValue).filter(Boolean);
    }

    function isCoringaMember(member){
      const modes = getMemberPlayModes(member).filter(mode => mode !== 'coringa');
      return new Set(modes).size >= 2 || getMemberPlayModes(member).includes('coringa');
    }

    function toSafeNumber(value){
      const n = Number(value);
      return Number.isFinite(n) ? n : 0;
    }

    function toNullableGoal(value){
      const n = Number(value);
      return Number.isFinite(n) && n >= 0 ? Math.floor(n) : null;
    }

    function normalizeGoalsFromAnySource(source = {}){
      const data = source && typeof source === 'object' ? source : {};
      const legacy = toNullableGoal(data.metaGG);
      const goals = {
        metaGG: legacy,
        metaGGRush: toNullableGoal(data.metaGGRush ?? legacy),
        metaGGCurandeiro: toNullableGoal(data.metaGGCurandeiro ?? legacy),
        metaGGFullGas: toNullableGoal(data.metaGGFullGas ?? legacy),
        metaGGSuporte: toNullableGoal(data.metaGGSuporte ?? legacy),
        metaGGFuzileiro: toNullableGoal(data.metaGGFuzileiro ?? legacy),
        metaGGCoringa: toNullableGoal(data.metaGGCoringa ?? legacy),
        metaHonra: toNullableGoal(data.metaHonra)
      };
      goals.metaGGByRole = {
        Rush: goals.metaGGRush,
        Curandeiro: goals.metaGGCurandeiro,
        'Full Gás': goals.metaGGFullGas,
        Suporte: goals.metaGGSuporte,
        Fuzileiro: goals.metaGGFuzileiro,
        Coringa: goals.metaGGCoringa,
        'Coringa 🃏': goals.metaGGCoringa
      };
      return goals;
    }

    function getGoalValue(field){
      const normalized = normalizeGoalsFromAnySource(guildGoals || {});
      const value = normalized[field];
      return (value != null && Number.isFinite(Number(value))) ? Number(value) : null;
    }

    function getGoalForMode(modeKey){
      const option = MODE_OPTIONS.find(item => item.key === normalizeModeValue(modeKey));
      if (!option) return getGoalValue('metaGG');
      return getGoalValue(option.goalField) ?? getGoalValue('metaGG');
    }

    function memberMetGoalForMode(member, modeKey){
      const mode = normalizeModeValue(modeKey);
      if (mode === 'coringa') {
        if (!isCoringaMember(member)) return false;
        const goal = getGoalForMode('coringa');
        if (goal == null) return !!member.guildWar;
        return toSafeNumber(member.guildWarMeta) >= goal;
      }
      const modes = getMemberPlayModes(member);
      if (!modes.includes(mode)) return false;
      const goal = getGoalForMode(mode);
      if (goal == null) return !!member.guildWar;
      return toSafeNumber(member.guildWarMeta) >= goal;
    }

    function memberMetAnyGuildWarGoal(member){
      const modes = getMemberPlayModes(member).filter(mode => mode !== 'coringa');
      if (isCoringaMember(member)) {
        const goal = getGoalForMode('coringa');
        if (goal != null) return toSafeNumber(member.guildWarMeta) >= goal;
      }
      if (modes.length) return modes.some(mode => memberMetGoalForMode(member, mode));
      const legacy = getGoalValue('metaGG');
      if (legacy == null) return !!member.guildWar;
      return toSafeNumber(member.guildWarMeta) >= legacy;
    }

    function memberMetWeeklyGoal(member){
      const goal = getGoalValue('metaHonra');
      if (goal == null) return !!member.weeklyMeta;
      return toSafeNumber(member.weeklyMetaValue) >= goal;
    }

    function calcStats(members){
      const total = members.length;
      const hasTag = members.filter(m => !!m.hasTag).length;
      const guildWar = members.filter(memberMetAnyGuildWarGoal).length;
      const weeklyMeta = members.filter(memberMetWeeklyGoal).length;
      const modeStats = MODE_OPTIONS.map((option) => {
        const players = option.key === 'coringa'
          ? members.filter(isCoringaMember)
          : members.filter(member => getMemberPlayModes(member).includes(option.key));
        const met = players.filter(member => memberMetGoalForMode(member, option.key)).length;
        return { ...option, total: players.length, met, goal: getGoalForMode(option.key) };
      });
      return { total, hasTag, guildWar, weeklyMeta, modeStats };
    }

    async function syncTotalMembros(guildId, slot, total){
      try {
        const safeGuildId = (guildId || '').toString().trim();
        const safeTotal = Math.max(0, Math.floor(Number(total)));
        if (!safeGuildId || !Number.isFinite(safeTotal)) return;
        const field = Number(slot) <= 1 ? 'totalMembros' : `totalMembros${Number(slot)}`;
        await setDoc(doc(db, 'configGuilda', safeGuildId), { [field]: safeTotal }, { merge: true });
      } catch (e) {
        console.warn('Falha ao sincronizar totalMembros:', e);
      }
    }

    function readMembersCachePayloadForSlot(slot = currentGuildSlot){
      const gid = currentGuildId();
      if (!gid) {
        return { members: [], hasCache: false, isVerifiedEmpty: false, key: '' };
      }

      const primaryKey = membersCacheKey(gid, slot);
      const legacyKey = Number(slot) === 1 ? legacyMembersCacheKey(gid) : '';
      const candidates = [primaryKey, legacyKey].filter(Boolean);

      for (const key of candidates) {
        const raw = safeStorageGet(key);
        if (raw == null) continue;

        const members = normalizeMembers(safeParseJSON(raw, []));
        const metaKey = key === primaryKey ? membersCacheMetaKey(gid, slot) : legacyMembersCacheMetaKey(gid);
        const meta = readJsonStorage(metaKey, null);
        const metaFresh = isFreshCache(meta, MEMBERS_CACHE_TTL_MS);
        const isVerifiedEmpty = members.length === 0 && metaFresh && meta?.verified === true;

        return { members, hasCache: true, isVerifiedEmpty, key, meta };
      }

      return { members: [], hasCache: false, isVerifiedEmpty: false, key: primaryKey };
    }

    function readMembersCacheForSlot(slot = currentGuildSlot){
      return readMembersCachePayloadForSlot(slot).members;
    }

    function shouldFetchMembersForSlot(slot = currentGuildSlot){
      const payload = readMembersCachePayloadForSlot(slot);
      if (!payload.hasCache) return true;

      // Importante: cache com lista vazia não é tratado como dado final do dashboard.
      // Isso corrige o primeiro login quando um cache vazio antigo/temporário fazia o painel
      // acreditar que não precisava consultar o Firebase.
      if (payload.members.length === 0) return true;

      return false;
    }

    function writeMembersCacheForSlot(slot, members){
      const gid = currentGuildId();
      if (!gid) return;
      const normalized = normalizeMembers(members);
      const meta = { verified: true, count: normalized.length, ts: Date.now() };
      safeStorageSet(membersCacheKey(gid, slot), JSON.stringify(normalized));
      writeJsonStorage(membersCacheMetaKey(gid, slot), meta);
      if (Number(slot) === 1) {
        safeStorageSet(legacyMembersCacheKey(gid), JSON.stringify(normalized));
        writeJsonStorage(legacyMembersCacheMetaKey(gid), meta);
      }
    }

    function renderFromMembersCache(){
      const ctx = getGuildContext();
      if(!ctx?.guildId) {
        updateUI(calcStats([]));
        return { members: [], hasCache: false, isVerifiedEmpty: false };
      }
      const payload = readMembersCachePayloadForSlot(currentGuildSlot);
      updateUI(calcStats(payload.members));
      return payload;
    }

    function syncGuildSlotButtonState(){
      const label = document.getElementById('dashboard-guild-slot-label');
      const btn = document.getElementById('btn-dashboard-guild-slot');
      if (label) label.textContent = currentGuildDisplayName(currentGuildSlot);
      if (btn) {
        btn.classList.toggle('opacity-60', !canUseMultiGuildDashboard);
        btn.title = canUseMultiGuildDashboard ? 'Trocar guilda exibida no painel' : 'Troca de guilda disponível no plano PRO ou superior';
      }
      const subtitle = document.querySelector('p.text-gray-500.text-sm.mt-1');
      if (subtitle) subtitle.textContent = `Resumo de ${currentGuildDisplayName(currentGuildSlot)} em tempo real`;
    }

    function renderGuildSlotDropdown(){
      const dropdown = document.getElementById('dashboard-guild-slot-dropdown');
      if (!dropdown) return;
      const slots = normalizeGuildSlotMetaList(currentGuildSlotsMeta).filter(slot => slot.slot === 1 || slot.exists);
      dropdown.innerHTML = slots.map((slot) => {
        const active = Number(slot.slot) === Number(currentGuildSlot);
        const disabled = slot.slot >= 2 && !canUseMultiGuildDashboard;
        const name = (slot.name || '').toString().trim() || `Guilda ${slot.slot}`;
        return `
          <button type="button" data-dashboard-guild-slot-option="${slot.slot}" ${disabled ? 'disabled' : ''} class="w-full flex items-center justify-between gap-3 px-3 py-3 rounded-xl text-left border transition-colors ${active ? 'bg-emerald-50 border-emerald-200 text-emerald-800' : 'bg-white border-gray-100 text-gray-700 hover:bg-gray-50'} ${disabled ? 'opacity-50 cursor-not-allowed' : ''}">
            <span class="min-w-0">
              <span class="block text-sm font-bold truncate">${escapeHtml(name)}</span>
              <span class="block text-[11px] text-gray-400">${slot.slot === 1 ? 'Principal' : 'Guilda extra'}</span>
            </span>
            ${active ? '<i data-lucide="check" class="w-4 h-4 text-emerald-600"></i>' : ''}
          </button>`;
      }).join('');
      initIcons();
    }

    function positionGuildSlotDropdown(){
      const dropdown = document.getElementById('dashboard-guild-slot-dropdown');
      const btn = document.getElementById('btn-dashboard-guild-slot');
      if (!dropdown || !btn || dropdown.classList.contains('hidden')) return;
      dropdown.style.left = '';
      dropdown.style.right = '0';
      requestAnimationFrame(() => {
        const rect = dropdown.getBoundingClientRect();
        const margin = 12;
        if (rect.left < margin) {
          dropdown.style.left = '0';
          dropdown.style.right = 'auto';
        }
      });
    }

    async function applyGuildSlot(slot, fetchFresh = true){
      const n = Math.max(1, Math.min(4, Math.floor(Number(slot) || 1)));
      if (n >= 2 && !canUseMultiGuildDashboard) {
        showToast?.('info', 'Trocar entre guildas no painel é um recurso do plano PRO ou superior.');
        return;
      }
      if (!isGuildSlotAvailable(n)) {
        showToast?.('info', 'Essa guilda extra ainda não foi criada em Ajustes.');
        return;
      }
      currentGuildSlot = n;
      writeSelectedGuildSlot(n);
      syncGuildSlotButtonState();
      renderGuildSlotDropdown();
      document.getElementById('dashboard-guild-slot-dropdown')?.classList.add('hidden');
      renderFromMembersCache();
      if (fetchFresh && shouldFetchMembersForSlot(n)) {
        await fetchMembersAndUpdateCache(currentGuildId(), n);
      }
    }

    async function hydrateSettings(){
      const ctx = getGuildContext();
      if (!ctx?.guildId) return;
      const cached = readFreshSettingsCache();
      if (cached?.goals) guildGoals = normalizeGoalsFromAnySource(cached.goals);
      const cachedSlots = Array.isArray(cached?.multiGuildSlots) ? normalizeGuildSlotMetaList(cached.multiGuildSlots) : null;
      if (cachedSlots?.length) currentGuildSlotsMeta = cachedSlots;
      else currentGuildSlotsMeta = [{ slot: 1, name: ctx.guildName || cached?.guildName || '', tag: '', exists: true }];

      const vipTier = normalizeTier(ctx?.vipTier || getVipTier());
      canUseMultiGuildDashboard = ['pro', 'business', 'vitalicio'].includes(vipTier);
      currentGuildSlot = canUseMultiGuildDashboard ? readSelectedGuildSlot() : 1;
      if (!isGuildSlotAvailable(currentGuildSlot)) currentGuildSlot = 1;
      writeSelectedGuildSlot(currentGuildSlot);
      syncGuildSlotButtonState();
      renderGuildSlotDropdown();
      renderFromMembersCache();

      try {
        const [freshSlots, freshGoals] = await Promise.all([
          getGuildMultiConfig(4, { ttlMs: SETTINGS_CACHE_TTL_MS }).catch(() => null),
          getGuildGoalsConfig({ ttlMs: SETTINGS_CACHE_TTL_MS }).catch(() => null)
        ]);
        if (Array.isArray(freshSlots) && freshSlots.length) currentGuildSlotsMeta = normalizeGuildSlotMetaList(freshSlots);
        if (freshGoals) guildGoals = normalizeGoalsFromAnySource(freshGoals);
        if (!isGuildSlotAvailable(currentGuildSlot)) currentGuildSlot = 1;
        writeSelectedGuildSlot(currentGuildSlot);
        syncGuildSlotButtonState();
        renderGuildSlotDropdown();
        writeSettingsSnapshot();
        renderFromMembersCache();
      } catch {
        writeSettingsSnapshot();
      }
    }

    function escapeHtml(value){
      return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
    }

    function renderPercentBar(label, val, total, color){
      const pct = total > 0 ? Math.round((val / total) * 100) : 0;
      return `
        <div>
          <div class="flex items-center justify-between mb-1">
            <span class="text-sm text-gray-600">${label}</span>
            <span class="text-sm font-semibold text-gray-900">${pct}%</span>
          </div>
          <div class="w-full h-2.5 bg-gray-100 rounded-full overflow-hidden">
            <div class="h-full bg-gradient-to-r ${color} rounded-full transition-all duration-1000" style="width: ${pct}%"></div>
          </div>
        </div>`;
    }

    function updateUI(data) {
      const { total, guildWar, weeklyMeta, hasTag, modeStats = [] } = data;

      document.getElementById('stat-total').innerText = total;
      document.getElementById('stat-war').innerText = guildWar;
      document.getElementById('stat-war-sub').innerText = `de ${total}`;
      document.getElementById('stat-meta').innerText = weeklyMeta;
      document.getElementById('stat-meta-sub').innerText = `de ${total}`;
      document.getElementById('stat-tag').innerText = hasTag;
      document.getElementById('stat-tag-sub').innerText = `de ${total}`;

      const noWar = total - guildWar;
      const noMeta = total - weeklyMeta;
      const noTag = total - hasTag;

      const roleEl = document.getElementById('role-stats-container');
      if (roleEl) {
        roleEl.innerHTML = modeStats.map((stat) => {
          const pct = stat.total > 0 ? Math.round((stat.met / stat.total) * 100) : 0;
          const goalText = stat.goal != null ? `${stat.goal} GG` : 'não definida';
          return `
            <div class="rounded-xl border border-gray-100 bg-white px-3 py-3">
              <div class="flex items-start justify-between gap-3 mb-2">
                <div class="min-w-0">
                  <p class="text-sm font-bold text-gray-900 truncate">${stat.label}</p>
                  <p class="text-[11px] text-gray-500">${stat.total} membro${stat.total === 1 ? '' : 's'} nessa função</p>
                  <p class="text-[11px] text-gray-500 mt-0.5">Meta: <b>${goalText}</b></p>
                </div>
                <div class="text-right shrink-0">
                  <span class="inline-flex text-xs font-bold text-emerald-700 bg-emerald-50 border border-emerald-100 px-2.5 py-1 rounded-full">${stat.met}/${stat.total}</span>
                  <p class="text-[11px] text-gray-400 mt-1">${pct}% bateram</p>
                </div>
              </div>
              <div class="w-full h-2 bg-gray-100 rounded-full overflow-hidden">
                <div class="h-full bg-gradient-to-r from-emerald-400 to-green-500 rounded-full transition-all duration-1000" style="width:${pct}%"></div>
              </div>
            </div>`;
        }).join('');
      }

      document.getElementById('attention-container').innerHTML = `
        <div class="flex items-center justify-between p-3 bg-red-50 rounded-xl">
          <div class="flex items-center gap-2"><div class="w-2 h-2 rounded-full bg-red-500"></div><span class="text-sm text-red-700">Sem GG batida</span></div>
          <span class="text-sm font-bold text-red-700">${noWar}</span>
        </div>
        <div class="flex items-center justify-between p-3 bg-orange-50 rounded-xl">
          <div class="flex items-center gap-2"><div class="w-2 h-2 rounded-full bg-orange-500"></div><span class="text-sm text-orange-700">Meta Semanal Pendente</span></div>
          <span class="text-sm font-bold text-orange-700">${noMeta}</span>
        </div>
        <div class="flex items-center justify-between p-3 bg-gray-50 rounded-xl">
          <div class="flex items-center gap-2"><div class="w-2 h-2 rounded-full bg-gray-400"></div><span class="text-sm text-gray-600">Sem Tag</span></div>
          <span class="text-sm font-bold text-gray-600">${noTag}</span>
        </div>
      `;

      document.getElementById('summary-container').innerHTML =
        renderPercentBar('GG batida por meta', guildWar, total, 'from-emerald-400 to-green-500') +
        renderPercentBar('Meta Semanal Cumprida', weeklyMeta, total, 'from-violet-400 to-purple-500') +
        renderPercentBar('Membros com Tag', hasTag, total, 'from-amber-400 to-orange-500') +
        renderPercentBar('Coringas 🃏', modeStats.find(s => s.key === 'coringa')?.total || 0, total, 'from-slate-500 to-gray-700');

      initIcons();
    }

    async function fetchMembersAndUpdateCache(guildId, slot = currentGuildSlot){
      if (!guildId) return;
      try {
        const snap = await getDocs(collection(db, 'guildas', guildId, membersCollectionName(slot)));
        const members = [];
        snap.forEach(d => { if (d.id === '__meta__') return; members.push({ id: d.id, ...d.data() }); });
        const normalized = normalizeMembers(members);
        writeMembersCacheForSlot(slot, normalized);
        if (Number(slot) === Number(currentGuildSlot)) updateUI(calcStats(normalized));
        syncTotalMembros(guildId, slot, normalized.length);
      } catch (e) {
        console.warn('Falha ao atualizar membros em tempo real:', e);
      }
    }

    function toMs(v){
      try {
        if (!v) return null;
        if (typeof v === 'number') return v;
        if (typeof v === 'string') {
          const n = Number(v);
          if (isFinite(n)) return n;
          const t = Date.parse(v);
          return isNaN(t) ? null : t;
        }
        if (typeof v === 'object') {
          if (typeof v.toMillis === 'function') return v.toMillis();
          if (typeof v.seconds === 'number') return v.seconds * 1000;
        }
      } catch {}
      return null;
    }

    function updateGuildCtxCache(patch){
      const prev = getGuildContext() || safeParseJSON(safeStorageGet(GUILDCTX_LS_KEY) || '{}', {});
      const next = setSharedGuildContextCache({ ...prev, ...patch });
      dashboardGuildCtx = { ...dashboardGuildCtx, ...next };
      return next;
    }

    function startVipRealtime(guildId){
      if (!guildId || window.__vipUnsub) return;

      // Antes havia 2 listeners em tempo real: /configGuilda e /guildas.
      // O webhook já grava o plano em /configGuilda também, então 1 listener basta
      // e economiza 1 leitura inicial por abertura do dashboard.
      const ref1 = doc(db, 'configGuilda', guildId);
      const unsub1 = onSnapshot(ref1, (snap) => {
        if (!snap.exists()) return;
        const data = snap.data() || {};
        const vipTier = normalizeTier(data.vipTier ?? data.vip ?? data.planoVip ?? data.planoVIP ?? data.vipLevel ?? data.vipPlano ?? data.vipName ?? data.plano ?? data.plan ?? data.tier);
        const vipExpiresAtMs = toMs(data.vipExpiresAt ?? data.vipExpiresAtMs ?? data.expiresAt ?? data.expireAt ?? data.expiraEm ?? data.expire ?? data.expiration);
        const cached = updateGuildCtxCache({ vipTier, vipExpiresAtMs });
        applyVipUiAndGates(cached.vipTier);
        canUseMultiGuildDashboard = ['pro', 'business', 'vitalicio'].includes(normalizeTier(cached.vipTier));
        syncGuildSlotButtonState();
        renderGuildSlotDropdown();
      }, () => {});

      window.__vipUnsub = () => { try{unsub1();}catch{} };
    }

    setupSidebar();
    initIcons();

    // Só renderiza cache antes do checkAuth quando já existe contexto salvo.
    // No primeiro login, ainda não há guildCtx; renderizar aqui zerava os cards antes
    // da autenticação terminar e dava a impressão de que o dashboard não carregou.
    if (getGuildContext()?.guildId) {
      hydrateSettings().then(() => renderFromMembersCache()).catch(() => renderFromMembersCache());
    }

    window.addEventListener('storage', (e) => {
      const ctx = getGuildContext();
      if(!ctx?.guildId) return;
      if (e.key === membersCacheKey(ctx.guildId, currentGuildSlot) || (currentGuildSlot === 1 && e.key === legacyMembersCacheKey(ctx.guildId))) {
        renderFromMembersCache();
      }
      if (e.key === GUILDCTX_LS_KEY) {
        try {
          const cached = safeParseJSON(e.newValue || '{}', {});
          applyVipUiAndGates(cached?.vipTier || getVipTier());
          canUseMultiGuildDashboard = ['pro', 'business', 'vitalicio'].includes(normalizeTier(cached?.vipTier || getVipTier()));
          syncGuildSlotButtonState();
          renderGuildSlotDropdown();
        } catch {}
      }
      if (e.key === `ajustesTela_${ctx.guildId}` || e.key === `guildGoals_${ctx.guildId}` || e.key === `guildMulti_${ctx.guildId}`) {
        hydrateSettings().catch(() => {});
      }
    });

    document.getElementById('btn-dashboard-guild-slot')?.addEventListener('click', () => {
      if (!canUseMultiGuildDashboard) {
        showToast?.('info', 'Trocar entre guildas no painel é um recurso do plano PRO ou superior.');
      }
      renderGuildSlotDropdown();
      const dropdown = document.getElementById('dashboard-guild-slot-dropdown');
      dropdown?.classList.toggle('hidden');
      positionGuildSlotDropdown();
    });

    document.getElementById('dashboard-guild-slot-dropdown')?.addEventListener('click', async (e) => {
      const option = e.target.closest('[data-dashboard-guild-slot-option]');
      if (!option) return;
      const slot = Number(option.getAttribute('data-dashboard-guild-slot-option') || 1);
      await applyGuildSlot(slot, true);
    });

    document.addEventListener('click', (e) => {
      const btn = document.getElementById('btn-dashboard-guild-slot');
      const dropdown = document.getElementById('dashboard-guild-slot-dropdown');
      if (btn && dropdown && !btn.contains(e.target) && !dropdown.contains(e.target)) dropdown.classList.add('hidden');
    });

    window.addEventListener('resize', positionGuildSlotDropdown);

    // Preenche e-mail/cargo/chefe pelo cache antes de qualquer leitura do Firebase.
    applyCachedSidebarNow();

    checkAuth().then(async (user) => {
      if(!user) return;
      document.getElementById('btn-logout').onclick = logout;
      showWelcomeLoginModal();
      consumeLoginToasts();

      const ctx = getGuildContext();
      if(!ctx?.guildId) return;

      // Não bloqueia o carregamento do painel por causa da sincronização de parceiro.
      // Essa rotina chama API externa do site e, no primeiro login, podia atrasar/travar
      // a leitura dos membros até trocar de tela ou recarregar.
      ensurePartnerInviteCountedOnDashboard(user).catch((error) => {
        console.warn('[dashboard-referral-sync]', error);
      });

      try { applyVipUiAndGates(ctx?.vipTier || getVipTier()); } catch {}
      await hydrateSettings();

      // Cache-first: usa a lista salva pelas telas. Só lê o Firebase quando não existe cache
      // ou quando existe um cache antigo/vazio sem confirmação de que aquela guilda está realmente vazia.
      const cachedPayload = renderFromMembersCache();
      if (!cachedPayload?.hasCache || shouldFetchMembersForSlot(currentGuildSlot)) {
        await fetchMembersAndUpdateCache(ctx.guildId, currentGuildSlot);
      }

      startVipRealtime(ctx.guildId);
    });

    // Tutorial (bottom sheet)
    (function setupTutorialModal(){
      const btn = document.getElementById('btn-tutorial');
      const overlay = document.getElementById('tutorial-overlay');
      const modal = document.getElementById('tutorial-modal');
      const closeBtn = document.getElementById('tutorial-close');
      if(!btn || !overlay || !modal || !closeBtn) return;
      let embedLoaded = false;
      function loadTikTokEmbed(){
        if(embedLoaded) return;
        embedLoaded = true;
        const s = document.createElement('script');
        s.async = true;
        s.src = 'https://www.tiktok.com/embed.js';
        document.body.appendChild(s);
      }
      function open(){
        loadTikTokEmbed();
        overlay.classList.remove('hidden');
        modal.classList.remove('hidden');
        modal.setAttribute('aria-hidden', 'false');
        requestAnimationFrame(() => modal.classList.remove('translate-y-full'));
        document.documentElement.classList.add('overflow-hidden');
      }
      function close(){
        modal.classList.add('translate-y-full');
        modal.setAttribute('aria-hidden', 'true');
        document.documentElement.classList.remove('overflow-hidden');
        setTimeout(() => {
          modal.classList.add('hidden');
          overlay.classList.add('hidden');
        }, 260);
      }
      btn.addEventListener('click', open);
      overlay.addEventListener('click', close);
      closeBtn.addEventListener('click', close);
      document.addEventListener('keydown', (e) => {
        if(e.key === 'Escape' && !modal.classList.contains('hidden')) close();
      });
    })();
