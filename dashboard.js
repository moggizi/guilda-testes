// dashboard.js — código exclusivo do painel
// Separado do dashboard.html para facilitar manutenção e reduzir bugs.

    import { checkAuth, setupSidebar, initIcons, logout, db, auth, consumeLoginToasts, showWelcomeLoginModal, getGuildContext, applyVipUiAndGates, getVipTier, getGuildMultiConfig, getGuildGoalsConfig, showToast } from './logic.js';
    import { collection, getDocs, doc, onSnapshot, setDoc } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

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
      try { return key ? localStorage.getItem(key) : null; } catch { return null; }
    }

    function safeStorageSet(key, value){
      try { if (key) localStorage.setItem(key, value); } catch {}
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
      try {
        const ts = Number(cached?.ts || 0);
        return !!ts && Number.isFinite(ts) && (Date.now() - ts) < ttlMs;
      } catch { return false; }
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
      if (payload.members.length > 0) return false;
      return !payload.isVerifiedEmpty;
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
      const prev = safeParseJSON(safeStorageGet(GUILDCTX_LS_KEY) || '{}', {});
      const next = { ...prev, ...patch, ts: Date.now() };
      safeStorageSet(GUILDCTX_LS_KEY, JSON.stringify(next));
      return next;
    }

    function startVipRealtime(guildId){
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

      const ref2 = doc(db, 'guildas', guildId);
      const unsub2 = onSnapshot(ref2, (snap) => {
        if (!snap.exists()) return;
        const data = snap.data() || {};
        const vipTier = normalizeTier(data.vipTier ?? data.vip ?? data.planoVip ?? data.planoVIP ?? data.vipLevel ?? data.vipPlano ?? data.vipName ?? data.plano ?? data.plan ?? data.tier);
        if (!vipTier) return;
        const cached = updateGuildCtxCache({ vipTier });
        applyVipUiAndGates(cached.vipTier);
        canUseMultiGuildDashboard = ['pro', 'business', 'vitalicio'].includes(normalizeTier(cached.vipTier));
        syncGuildSlotButtonState();
        renderGuildSlotDropdown();
      }, () => {});

      window.__vipUnsub = () => { try{unsub1();}catch{} try{unsub2();}catch{} };
    }

    setupSidebar();
    initIcons();
    hydrateSettings().then(() => renderFromMembersCache()).catch(() => renderFromMembersCache());

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

    checkAuth().then(async (user) => {
      if(!user) return;
      document.getElementById('btn-logout').onclick = logout;
      showWelcomeLoginModal();
      consumeLoginToasts();

      const ctx = getGuildContext();
      if(!ctx?.guildId) return;

      await ensurePartnerInviteCountedOnDashboard(user);

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
