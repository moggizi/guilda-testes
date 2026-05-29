import { checkAuth, setupSidebar, initIcons, logout, db, showToast, getMemberTagConfig, getGuildGoalsConfig, getGuildContext, getGuildMultiConfig, getVipTier } from '../logic.js';
    import { collection, getDocs, setDoc, doc, deleteDoc, serverTimestamp, query, where, limit, writeBatch } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

    // CARREGA OS ÍCONES IMEDIATAMENTE INDEPENDENTE DE TER DADOS!
    setupSidebar();
    initIcons();

    // ==========================================
    // VARIÁVEIS DE ESTADO E CHAVES DE CACHE
    // ==========================================
    let membersCache = [];
    let currentFilter = 'all';
    let currentPlayModeFilter = 'all';
    let currentGoalMetFilter = 'none';
    let memberTag = null;
    let guildGoals = { metaGG: null, metaHonra: null };
    let hasTagManualOverride = false;
    let pendingEdits = {}; 
    let currentZeroAction = ''; 
    let currentDeleteId = ''; 
    let currentMoveId = ''; 
    let currentMoveTargetSlot = null; 
    let currentWarningId = '';
    let currentGuildSlot = 1;
    let currentGuildSlotsMeta = [];
    let canUseMultiGuildMembers = false;
    let canUsePrintScanner = false;

    const SETTINGS_SCREEN_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

    function __safeStorageGet(key) {
      try { return key ? localStorage.getItem(key) : null; } catch { return null; }
    }

    function __safeStorageSet(key, value) {
      try { if (key) localStorage.setItem(key, value); } catch {}
    }

    function __isFreshCacheObject(cached, ttlMs = SETTINGS_SCREEN_CACHE_TTL_MS) {
      try {
        const ts = Number(cached?.ts || 0);
        return !!ts && Number.isFinite(ts) && (Date.now() - ts) < ttlMs;
      } catch (_) {
        return false;
      }
    }

    function __settingsScreenCacheKey() {
      const gid = getGuildContext()?.guildId;
      return gid ? `ajustesTela_${gid}` : '';
    }

    function __readSettingsScreenCache() {
      try {
        const key = __settingsScreenCacheKey();
        if (!key) return null;
        const raw = __safeStorageGet(key);
        return raw ? (JSON.parse(raw) || null) : null;
      } catch (_) {
        return null;
      }
    }

    function __writeSettingsScreenCache(data = {}) {
      try {
        const key = __settingsScreenCacheKey();
        if (!key) return;
        const previous = __readSettingsScreenCache() || {};
        __safeStorageSet(key, JSON.stringify({ ...previous, ...(data || {}), guildId: getGuildContext()?.guildId || previous.guildId || '', ts: Date.now() }));
      } catch (_) {}
    }

    function __readJsonStorage(key) {
      try {
        if (!key) return null;
        const raw = __safeStorageGet(key);
        return raw ? (JSON.parse(raw) || null) : null;
      } catch (_) {
        return null;
      }
    }

    function __readFreshSettingsScreenCache() {
      const cached = __readSettingsScreenCache();
      return __isFreshCacheObject(cached) ? cached : null;
    }

    function __readFreshDirectSettingsCache() {
      const gid = getGuildContext()?.guildId;
      if (!gid) return null;

      const ajustesCache = __readFreshSettingsScreenCache();
      const guildInfoCache = __readJsonStorage(`guildInfo_${gid}`);
      const goalsCache = __readJsonStorage(`guildGoals_${gid}`);
      const tagCache = __readJsonStorage(`tagMembros_${gid}`);
      const guildMultiRaw = __readJsonStorage(`guildMulti_${gid}`);
      const guildMultiTs = Number(__safeStorageGet(`guildMulti_${gid}_ts`) || 0) || 0;

      const freshGuildInfo = __isFreshCacheObject(guildInfoCache) ? guildInfoCache : null;
      const freshGoals = __isFreshCacheObject(goalsCache) ? goalsCache : null;
      const freshTag = __isFreshCacheObject(tagCache) ? tagCache : null;
      const freshMultiGuildSlots = Array.isArray(guildMultiRaw) && guildMultiRaw.length && __isFreshCacheObject({ ts: guildMultiTs })
        ? guildMultiRaw
        : null;

      const merged = { ...(ajustesCache || {}), guildId: gid };

      if (!Array.isArray(merged.multiGuildSlots) || !merged.multiGuildSlots.length) {
        if (freshMultiGuildSlots) merged.multiGuildSlots = freshMultiGuildSlots;
      }

      if (!merged.goals && freshGoals) merged.goals = freshGoals;
      if (!merged.tag && freshTag?.value) merged.tag = String(freshTag.value || '').trim();
      if (!merged.guildName && freshGuildInfo?.name) merged.guildName = String(freshGuildInfo.name || '').trim();

      if ((!Array.isArray(merged.multiGuildSlots) || !merged.multiGuildSlots.length) && (merged.guildName || getGuildContext()?.guildName)) {
        merged.multiGuildSlots = [{
          slot: 1,
          nameField: 'name',
          tagField: 'tagMembros',
          name: merged.guildName || getGuildContext()?.guildName || '',
          tag: merged.tag || '',
          exists: true
        }];
      }

      const hasUsefulData =
        (Array.isArray(merged.multiGuildSlots) && merged.multiGuildSlots.length) ||
        !!merged.goals ||
        !!merged.tag ||
        !!merged.guildName;

      return hasUsefulData ? merged : null;
    }

    function __cacheSettingsSnapshot(extra = {}) {
      const primarySlot = (currentGuildSlotsMeta || []).find(item => Number(item?.slot) === 1) || {};
      __writeSettingsScreenCache({
        guildName: primarySlot.name || getGuildContext()?.guildName || '',
        tag: memberTag || primarySlot.tag || '',
        goals: normalizeGoalsFromAnySource(guildGoals || {}),
        multiGuildSlots: normalizeGuildSlotMetaList(currentGuildSlotsMeta),
        ...extra
      });
    }

    function normalizeGuildSlotMetaList(list = []) {
      const map = new Map();
      (Array.isArray(list) ? list : []).forEach((slot) => {
        const n = Math.max(1, Math.min(4, Math.floor(Number(slot?.slot) || 1)));
        map.set(n, {
          slot: n,
          nameField: slot?.nameField || (n <= 1 ? 'name' : `name${n}`),
          tagField: slot?.tagField || (n <= 1 ? 'tagMembros' : `tagMembros${n}`),
          name: String(slot?.name || '').trim(),
          tag: String(slot?.tag || '').trim(),
          exists: n === 1 ? true : slot?.exists !== false && !!String(slot?.name || '').trim()
        });
      });
      return Array.from(map.values()).sort((a, b) => a.slot - b.slot);
    }

    function normalizeVipTierClient(v) {
      const s = (v || '').toString().toLowerCase().trim();
      if (s.includes('vital') || s.includes('life')) return 'vitalicio';
      if (s.includes('buss') || s.includes('business')) return 'business';
      if (s.includes('pro')) return 'pro';
      if (s.includes('plus')) return 'plus';
      return 'free';
    }

    function __readCachedGuildContextRaw() {
      try {
        const raw = __safeStorageGet('guildCtx_cache_v1');
        return raw ? (JSON.parse(raw) || null) : null;
      } catch (_) {
        return null;
      }
    }

    function __getCachedVipTierFast() {
      const ctx = getGuildContext?.() || {};
      const cachedCtx = __readCachedGuildContextRaw() || {};
      return normalizeVipTierClient(ctx.vipTier || cachedCtx.vipTier || getVipTier?.() || 'free');
    }

    function __canUseMultiGuildFromCache() {
      return ['pro', 'business', 'vitalicio'].includes(__getCachedVipTierFast());
    }

    function __canUsePrintScannerFromCache() {
      return ['pro', 'business', 'vitalicio'].includes(__getCachedVipTierFast());
    }

    function __syncPrintScannerAccessState() {
      canUsePrintScanner = __canUsePrintScannerFromCache();
      const btn = document.getElementById('btn-print-scanner');
      if (!btn) return;

      // O botão fica visível para todos. Quem não tem plano compatível vê o aviso ao clicar.
      btn.classList.remove('hidden', 'opacity-60', 'cursor-not-allowed');
      btn.disabled = false;
      btn.setAttribute('aria-disabled', 'false');
      btn.title = canUsePrintScanner
        ? 'Ler prints com Gemini'
        : 'Disponível no plano PRO ou superior';
    }

    function __guildSlotSelectionKey() {
      const gid = getGuildContext()?.guildId;
      return gid ? `membersGuildSlot_${gid}` : 'membersGuildSlot';
    }

    function __membersCollectionName(slot = currentGuildSlot) {
      const n = Math.max(1, Math.min(4, Math.floor(Number(slot) || 1)));
      return n <= 1 ? 'membros' : `membros${n}`;
    }

    function __membersLsKey() {
      const gid = getGuildContext()?.guildId;
      return gid ? `membersList_${gid}_${__membersCollectionName()}` : `membersList_${__membersCollectionName()}`;
    }

    function __readSelectedGuildSlot() {
      try {
        const raw = __safeStorageGet(__guildSlotSelectionKey());
        const n = Math.floor(Number(raw) || 1);
        return (n >= 1 && n <= 4) ? n : 1;
      } catch (_) {
        return 1;
      }
    }

    function __writeSelectedGuildSlot(slot) {
      try {
        __safeStorageSet(__guildSlotSelectionKey(), String(Math.max(1, Math.min(4, Math.floor(Number(slot) || 1)))));
      } catch (_) {}
    }

    function __getGuildSlotMeta(slot = currentGuildSlot) {
      return (currentGuildSlotsMeta || []).find(item => Number(item?.slot) === Number(slot)) || null;
    }

    function __isGuildSlotAvailable(slot) {
      const n = Number(slot);
      if (n === 1) return true;
      const meta = __getGuildSlotMeta(n);
      return !!(meta && meta.exists);
    }

    function __currentGuildDisplayName(slot = currentGuildSlot) {
      const meta = __getGuildSlotMeta(slot);
      const name = (meta?.name || '').toString().trim();
      if (name) return name;
      if (Number(slot) === 1) return (getGuildContext()?.guildName || '').toString().trim() || 'Guilda principal';
      return `Guilda ${slot}`;
    }

    function __updateCurrentMemberTag() {
      const meta = __getGuildSlotMeta(currentGuildSlot);
      const tag = (meta?.tag || '').toString().trim();
      if (tag) {
        memberTag = tag;
        return;
      }
      if (currentGuildSlot === 1) return;
      memberTag = null;
    }

    async function __ensureMembersCollectionExists(slot = currentGuildSlot) {
      const n = Math.max(1, Math.min(4, Math.floor(Number(slot) || 1)));
      if (n <= 1) return;
      try {
        const snap = await getDocs(query(collection(db, "guildas", getGuildContext().guildId, __membersCollectionName(n)), limit(1)));
        if (!snap.empty) return;
        await setDoc(doc(db, "guildas", getGuildContext().guildId, __membersCollectionName(n), "__meta__"), {
          slot: n,
          updatedAt: serverTimestamp()
        }, { merge: true });
      } catch (_) {}
    }

    function __syncGuildSlotButtonState() {
      const btn = document.getElementById('btn-guild-slot');
      const label = document.getElementById('guild-slot-label');
      if (!btn || !label) return;
      label.textContent = __currentGuildDisplayName();
      btn.classList.toggle('opacity-60', !canUseMultiGuildMembers);
      btn.classList.toggle('cursor-not-allowed', !canUseMultiGuildMembers);
      btn.setAttribute('aria-disabled', canUseMultiGuildMembers ? 'false' : 'true');
    }

    function __hydrateToolbarFromCacheNow() {
      try {
        const settingsCache = __readFreshDirectSettingsCache();
        const cachedSlots = Array.isArray(settingsCache?.multiGuildSlots)
          ? normalizeGuildSlotMetaList(settingsCache.multiGuildSlots)
          : null;

        if (cachedSlots && cachedSlots.length) {
          currentGuildSlotsMeta = cachedSlots;
        } else if (!currentGuildSlotsMeta.length) {
          currentGuildSlotsMeta = [{
            slot: 1,
            nameField: 'name',
            tagField: 'tagMembros',
            name: settingsCache?.guildName || getGuildContext()?.guildName || '',
            tag: settingsCache?.tag || '',
            exists: true
          }];
        }

        canUseMultiGuildMembers = __canUseMultiGuildFromCache();
        currentGuildSlot = canUseMultiGuildMembers ? __readSelectedGuildSlot() : 1;
        if (!__isGuildSlotAvailable(currentGuildSlot)) currentGuildSlot = 1;

        if (settingsCache?.tag) memberTag = String(settingsCache.tag || '').trim();
        __updateCurrentMemberTag();
        if (settingsCache?.goals) guildGoals = normalizeGoalsFromAnySource(settingsCache.goals);

        __syncGuildSlotButtonState();
        __syncPrintScannerAccessState();
        __renderGuildSlotDropdown();
        refreshPlayModeCounterUi();
        refreshGoalMetFilterUi();
      } catch (_) {}
    }

    function __positionGuildSlotDropdown() {
      const box = document.getElementById('guild-slot-dropdown');
      if (!box || box.classList.contains('hidden')) return;

      box.style.left = '';
      box.style.right = '0';
      box.style.transform = 'translateX(0)';

      requestAnimationFrame(() => {
        const rect = box.getBoundingClientRect();
        const margin = 12;
        const maxRight = window.innerWidth - margin;
        let shiftX = 0;

        if (rect.right > maxRight) {
          shiftX -= (rect.right - maxRight);
        }
        if ((rect.left + shiftX) < margin) {
          shiftX += (margin - (rect.left + shiftX));
        }

        box.style.transform = `translateX(${shiftX}px)`;
      });
    }

    function __renderGuildSlotDropdown() {
      const box = document.getElementById('guild-slot-dropdown');
      if (!box) return;

      const rows = [1, 2, 3, 4].map(slot => {
        const available = __isGuildSlotAvailable(slot);
        const name = __currentGuildDisplayName(slot);
        const isActive = Number(currentGuildSlot) === slot;
        const subtitle = slot === 1
          ? 'Principal'
          : (available ? 'Lista separada desta guilda' : 'Indisponível nesta conta');

        return `
          <button
            type="button"
            data-guild-slot-option="${slot}"
            class="w-full text-left px-3 py-3 rounded-xl border transition-colors ${isActive ? 'border-emerald-200 bg-emerald-50' : 'border-gray-200 bg-white hover:bg-gray-50'} ${(!available && slot !== 1) ? 'opacity-60' : ''}"
          >
            <div class="flex items-center justify-between gap-3">
              <div class="min-w-0">
                <div class="text-sm font-semibold text-gray-900 truncate">${name}</div>
                <div class="text-[11px] text-gray-500 mt-0.5">${subtitle}</div>
              </div>
              ${isActive ? '<span class="text-[10px] font-bold uppercase tracking-wide px-2 py-1 rounded-full bg-emerald-100 text-emerald-700">Ativa</span>' : ''}
            </div>
          </button>
        `;
      }).join('');

      box.innerHTML = rows;
      initIcons();
    }

    async function __applyGuildSlot(slot, forceRefresh = false) {
      const nextSlot = Math.max(1, Math.min(4, Math.floor(Number(slot) || 1)));
      if (!__isGuildSlotAvailable(nextSlot)) {
        showToast('info', `A ${nextSlot === 1 ? 'guilda principal' : `guilda ${nextSlot}`} ainda não está disponível nesta conta.`);
        return;
      }

      currentGuildSlot = nextSlot;
      __writeSelectedGuildSlot(nextSlot);
      __updateCurrentMemberTag();
      __syncGuildSlotButtonState();
      __renderGuildSlotDropdown();
      document.getElementById('guild-slot-dropdown')?.classList.add('hidden');

      const cached = __readMembersFromCache();
      if (cached && cached.length) {
        __setMembersCache(cached);
        if (forceRefresh) await loadMembers(true);
        else await loadMembers(false);
        return;
      }

      membersCache = [];
      document.getElementById('member-count').textContent = `Carregando ${__currentGuildDisplayName(nextSlot)}...`;
      await __ensureMembersCollectionExists(nextSlot);

      document.getElementById('members-list').innerHTML = `
        <div class="bg-white rounded-2xl border border-gray-100 p-5 animate-pulse flex items-center gap-3">
          <div class="w-11 h-11 bg-gray-200 rounded-full"></div>
          <div class="flex-1 space-y-2">
            <div class="h-4 bg-gray-200 rounded w-1/3"></div>
            <div class="h-3 bg-gray-100 rounded w-1/4"></div>
          </div>
        </div>
      `;
      await loadMembers(false);
    }

    function __readMembersFromCache() {
      try {
        const raw = __safeStorageGet(__membersLsKey());
        if (!raw) return null;
        const arr = JSON.parse(raw);
        return Array.isArray(arr) ? arr : null;
      } catch (_) {
        return null;
      }
    }

    function __writeMembersToCache(list) {
      try {
        __safeStorageSet(__membersLsKey(), JSON.stringify(list || []));
      } catch (_) {}
    }
    function __membersLsKeyBySlot(slot) {
      const gid = getGuildContext()?.guildId;
      const collectionName = __membersCollectionName(slot);
      return gid ? `membersList_${gid}_${collectionName}` : `membersList_${collectionName}`;
    }

    function __readMembersFromCacheBySlot(slot) {
      try {
        const raw = __safeStorageGet(__membersLsKeyBySlot(slot));
        if (!raw) return null;
        const arr = JSON.parse(raw);
        return Array.isArray(arr) ? arr : null;
      } catch (_) {
        return null;
      }
    }

    function __writeMembersToCacheBySlot(slot, list) {
      try {
        __safeStorageSet(__membersLsKeyBySlot(slot), JSON.stringify(list || []));
      } catch (_) {}
    }

    async function __findMemberAcrossGuildsByVisibleId(visibleId, excludeSlot = null) {
      const searchId = String(visibleId || '').trim();
      if (!searchId) return null;
      const guildId = getGuildContext()?.guildId;
      if (!guildId) return null;

      for (let slot = 1; slot <= 4; slot++) {
        if (excludeSlot != null && Number(excludeSlot) === slot) continue;
        if (slot !== 1 && !__isGuildSlotAvailable(slot)) continue;
        try {
          const snap = await getDocs(query(
            collection(db, 'guildas', guildId, __membersCollectionName(slot)),
            where('visibleId', '==', searchId),
            limit(1)
          ));
          if (!snap.empty) {
            const found = snap.docs[0];
            if (found.id === '__meta__') continue;
            return { slot, docId: found.id, data: found.data() || {} };
          }
        } catch (_) {}
      }
      return null;
    }
    async function __findMemberInGuildSlotByVisibleId(slot, visibleId) {
      const searchId = String(visibleId || '').trim();
      const targetSlot = Math.max(1, Math.min(4, Math.floor(Number(slot) || 1)));
      if (!searchId) return null;
      const guildId = getGuildContext()?.guildId;
      if (!guildId) return null;
      try {
        const snap = await getDocs(query(
          collection(db, 'guildas', guildId, __membersCollectionName(targetSlot)),
          where('visibleId', '==', searchId),
          limit(1)
        ));
        if (snap.empty) return null;
        const found = snap.docs[0];
        if (found.id === '__meta__') return null;
        return { slot: targetSlot, docId: found.id, data: found.data() || {} };
      } catch (_) {
        return null;
      }
    }

    function __syncCacheAfterMove(member, fromSlot, toSlot) {
      const moved = { ...member, id: member.visibleId, updatedAt: Date.now() };
      delete moved.__name__;

      try {
        const fromList = (__readMembersFromCacheBySlot(fromSlot) || []).filter(item => String(item?.id || '') !== String(member.id || ''));
        __writeMembersToCacheBySlot(fromSlot, fromList);
      } catch (_) {}

      try {
        const toList = __readMembersFromCacheBySlot(toSlot) || [];
        const idx = toList.findIndex(item => String(item?.visibleId || '') === String(member.visibleId || ''));
        if (idx >= 0) toList[idx] = { ...toList[idx], ...moved };
        else toList.push(moved);
        toList.sort((a,b)=> String(a?.nick || '').localeCompare(String(b?.nick || '')));
        __writeMembersToCacheBySlot(toSlot, toList);
      } catch (_) {}
    }

    function __setMembersCache(list) {
      membersCache = Array.isArray(list) ? list : [];
      membersCache.sort((a,b)=> String(a.nick || '').localeCompare(String(b.nick || '')));
      __writeMembersToCache(membersCache);
      applyFiltersAndRender();
      const countEl = document.getElementById('member-count');
      if (countEl) countEl.textContent = `${membersCache.length} membros • ${__currentGuildDisplayName()}`;
    }

    // ==========================================
    // FUNÇÕES DE RENDERIZAÇÃO
    // ==========================================
    const PLAY_MODE_FILTER_OPTIONS = [
      { key: 'all', label: 'Exibir todos' },
      { key: 'rush', label: 'Rush' },
      { key: 'full-gas', label: 'Full Gás' },
      { key: 'curandeiro', label: 'Curandeiro' },
      { key: 'fuzileiro', label: 'Fuzileiro' },
      { key: 'suporte', label: 'Suporte' },
      { key: 'coringa', label: 'Coringa 🃏' }
    ];

    const GOAL_MET_FILTER_OPTIONS = [
      { key: 'none', label: 'Exibir todos' },
      { key: 'all', label: 'Todos que bateram' },
      { key: 'rush', label: 'Rush' },
      { key: 'full-gas', label: 'Full Gás' },
      { key: 'curandeiro', label: 'Curandeiro' },
      { key: 'fuzileiro', label: 'Fuzileiro' },
      { key: 'suporte', label: 'Suporte' },
      { key: 'coringa', label: 'Coringa 🃏' }
    ];

    const GG_GOAL_FIELD_BY_MODE = {
      'rush': 'metaGGRush',
      'full-gas': 'metaGGFullGas',
      'curandeiro': 'metaGGCurandeiro',
      'fuzileiro': 'metaGGFuzileiro',
      'suporte': 'metaGGSuporte',
      'coringa': 'metaGGCoringa'
    };

    function normalizePlayModeValue(value) {
      const raw = (value == null ? '' : String(value))
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .toLowerCase()
        .trim();

      if (!raw) return '';
      if (raw === 'rush') return 'rush';
      if (raw === 'full gas' || raw === 'fullgas') return 'full-gas';
      if (raw === 'curandeiro') return 'curandeiro';
      if (raw === 'fuzileiro') return 'fuzileiro';
      if (raw === 'suporte') return 'suporte';
      if (raw === 'coringa' || raw === 'coringa 🃏') return 'coringa';
      return raw.replace(/\s+/g, '-');
    }

    function getMemberPlayModes(member) {
      const raw = member?.playMode;
      const list = Array.isArray(raw) ? raw : (raw ? [raw] : []);
      return list
        .map(normalizePlayModeValue)
        .filter(Boolean);
    }

    function isCoringaMember(member) {
      const modes = getMemberPlayModes(member).filter((mode) => mode !== 'coringa');
      return new Set(modes).size >= 2 || getMemberPlayModes(member).includes('coringa');
    }

    function getPlayModeLabel(value) {
      const normalized = normalizePlayModeValue(value);
      if (normalized === 'rush') return 'Rush';
      if (normalized === 'full-gas') return 'Full Gás';
      if (normalized === 'curandeiro') return 'Curandeiro';
      if (normalized === 'fuzileiro') return 'Fuzileiro';
      if (normalized === 'suporte') return 'Suporte';
      if (normalized === 'coringa') return 'Coringa 🃏';
      return '';
    }

    function getMemberPlayModeLabels(member) {
      const labels = getMemberPlayModes(member)
        .map(getPlayModeLabel)
        .filter(Boolean);
      return [...new Set(labels)];
    }

    function normalizeGoalsFromAnySource(source = {}) {
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

    function renderMemberPlayModeLine(member) {
      const labels = getMemberPlayModeLabels(member).filter((label) => label !== 'Coringa 🃏');
      const coringaBadge = isCoringaMember(member) ? ' • 🃏 Coringa' : '';
      if (!labels.length && !coringaBadge) return '';

      return `
        <div class="mt-2 flex justify-end">
          <span class="max-w-full overflow-hidden text-ellipsis whitespace-nowrap text-[11px] font-semibold text-emerald-700">${labels.join(' • ')}${coringaBadge}</span>
        </div>
      `;
    }

    function matchesCurrentMainFilter(member) {
      if (currentFilter === 'with-tag') return !!member.hasTag;
      if (currentFilter === 'no-tag') return !member.hasTag;
      if (currentFilter === 'with-gg') return !!member.guildWar;
      if (currentFilter === 'no-gg') return !member.guildWar;
      if (currentFilter === 'with-weekly') return !!member.weeklyMeta;
      if (currentFilter === 'no-weekly') return !member.weeklyMeta;
      if (currentFilter === 'all-met') return !!(member.weeklyMeta && member.guildWar);
      return true;
    }

    function matchesCurrentPlayModeFilter(member) {
      if (currentPlayModeFilter === 'all') return true;
      if (currentPlayModeFilter === 'coringa') return isCoringaMember(member);
      return getMemberPlayModes(member).includes(currentPlayModeFilter);
    }

    function matchesGoalMetFilter(member) {
      if (currentGoalMetFilter === 'none') return true;
      if (currentGoalMetFilter === 'all') return memberMetAnyGuildWarGoal(member);
      return memberMetGuildWarGoalForMode(member, currentGoalMetFilter);
    }

    function getVisibleMembers({ ignorePlayMode = false, ignoreGoalMet = false } = {}) {
      const termo = document.getElementById('search-input')?.value.toLowerCase() || '';

      return membersCache.filter((member) => {
        const matchBusca = (member.nick && member.nick.toLowerCase().includes(termo)) ||
                           (member.visibleId && String(member.visibleId).includes(termo));
        if (!matchBusca) return false;
        if (!matchesCurrentMainFilter(member)) return false;
        if (!ignorePlayMode && !matchesCurrentPlayModeFilter(member)) return false;
        if (!ignoreGoalMet && !matchesGoalMetFilter(member)) return false;
        return true;
      });
    }

    function updatePlayModeFilterButtonLabel() {
      const labelEl = document.getElementById('playmode-filter-label');
      const buttonEl = document.getElementById('btn-playmode-counter');
      const active = PLAY_MODE_FILTER_OPTIONS.find(option => option.key === currentPlayModeFilter);
      const label = currentPlayModeFilter === 'all' ? 'Função' : (active ? active.label : 'Função');

      if (labelEl) labelEl.innerText = label;
      if (buttonEl) {
        buttonEl.classList.toggle('border-emerald-300', currentPlayModeFilter !== 'all');
        buttonEl.classList.toggle('bg-emerald-50', currentPlayModeFilter !== 'all');
      }
    }

    function renderPlayModeCounterDropdown() {
      const dropdown = document.getElementById('playmode-counter-dropdown');
      if (!dropdown) return;

      const baseMembers = getVisibleMembers({ ignorePlayMode: true });
      dropdown.innerHTML = PLAY_MODE_FILTER_OPTIONS.map((option) => {
        const count = option.key === 'all'
          ? baseMembers.length
          : option.key === 'coringa'
            ? baseMembers.filter(member => isCoringaMember(member)).length
            : baseMembers.filter(member => getMemberPlayModes(member).includes(option.key)).length;
        const active = currentPlayModeFilter === option.key;

        return `
          <button
            type="button"
            class="counter-option ${active ? 'counter-active' : ''}"
            data-playmode-filter-option="${option.key}"
          >
            <span class="counter-option-label">${option.label} - ${count}</span>
            <span class="counter-option-count">${count}</span>
          </button>
        `;
      }).join('');
    }

    function positionPlayModeCounterDropdown() {
      const dropdown = document.getElementById('playmode-counter-dropdown');
      if (!dropdown || dropdown.classList.contains('hidden')) return;

      dropdown.style.left = '';
      dropdown.style.right = '0';
      dropdown.style.transform = 'translateX(0)';

      requestAnimationFrame(() => {
        const rect = dropdown.getBoundingClientRect();
        const margin = 12;
        const maxRight = window.innerWidth - margin;
        let shiftX = 0;

        if (rect.right > maxRight) shiftX -= (rect.right - maxRight);
        if ((rect.left + shiftX) < margin) shiftX += (margin - (rect.left + shiftX));

        dropdown.style.transform = `translateX(${shiftX}px)`;
      });
    }

    function refreshPlayModeCounterUi() {
      updatePlayModeFilterButtonLabel();
      renderPlayModeCounterDropdown();
      positionPlayModeCounterDropdown();
      initIcons();
    }

    function updateGoalMetFilterButtonLabel() {
      const labelEl = document.getElementById('goal-met-filter-label');
      const buttonEl = document.getElementById('btn-goal-met-filter');
      const active = GOAL_MET_FILTER_OPTIONS.find(option => option.key === currentGoalMetFilter);
      const label = currentGoalMetFilter === 'none' ? 'Meta cumprida' : (active ? active.label : 'Meta cumprida');

      if (labelEl) labelEl.innerText = label;
      if (buttonEl) {
        buttonEl.classList.toggle('border-emerald-300', currentGoalMetFilter !== 'none');
        buttonEl.classList.toggle('bg-emerald-50', currentGoalMetFilter !== 'none');
      }
    }

    function renderGoalMetDropdown() {
      const dropdown = document.getElementById('goal-met-dropdown');
      if (!dropdown) return;

      const baseMembers = getVisibleMembers({ ignoreGoalMet: true });
      dropdown.innerHTML = GOAL_MET_FILTER_OPTIONS.map((option) => {
        const count = option.key === 'none'
          ? baseMembers.length
          : option.key === 'all'
            ? baseMembers.filter(member => memberMetAnyGuildWarGoal(member)).length
            : baseMembers.filter(member => memberMetGuildWarGoalForMode(member, option.key)).length;
        const active = currentGoalMetFilter === option.key;

        return `
          <button
            type="button"
            class="counter-option ${active ? 'counter-active' : ''}"
            data-goal-met-filter-option="${option.key}"
          >
            <span class="counter-option-label">${option.label} - ${count}</span>
            <span class="counter-option-count">${count}</span>
          </button>
        `;
      }).join('');
    }

    function positionGoalMetDropdown() {
      const dropdown = document.getElementById('goal-met-dropdown');
      if (!dropdown || dropdown.classList.contains('hidden')) return;

      dropdown.style.left = '';
      dropdown.style.right = '0';
      dropdown.style.transform = 'translateX(0)';

      requestAnimationFrame(() => {
        const rect = dropdown.getBoundingClientRect();
        const margin = 12;
        const maxRight = window.innerWidth - margin;
        let shiftX = 0;

        if (rect.right > maxRight) shiftX -= (rect.right - maxRight);
        if ((rect.left + shiftX) < margin) shiftX += (margin - (rect.left + shiftX));

        dropdown.style.transform = `translateX(${shiftX}px)`;
      });
    }

    function refreshGoalMetFilterUi() {
      updateGoalMetFilterButtonLabel();
      renderGoalMetDropdown();
      positionGoalMetDropdown();
      initIcons();
    }

    window.toggleGoalMetDropdown = () => {
      refreshGoalMetFilterUi();
      document.getElementById('goal-met-dropdown')?.classList.toggle('hidden');
      positionGoalMetDropdown();
    };

    window.applyGoalMetFilter = (filterKey) => {
      currentGoalMetFilter = filterKey || 'none';
      document.getElementById('goal-met-dropdown')?.classList.add('hidden');
      refreshGoalMetFilterUi();
      applyFiltersAndRender();
    };

    window.togglePlayModeCounterDropdown = () => {
      refreshPlayModeCounterUi();
      refreshGoalMetFilterUi();
      document.getElementById('playmode-counter-dropdown')?.classList.toggle('hidden');
      positionPlayModeCounterDropdown();
    };

    window.applyPlayModeFilter = (filterKey) => {
      currentPlayModeFilter = filterKey || 'all';
      document.getElementById('playmode-counter-dropdown')?.classList.add('hidden');
      refreshPlayModeCounterUi();
      applyFiltersAndRender();
    };

    window.applyFiltersAndRender = function() {
      const termo = document.getElementById('search-input')?.value.toLowerCase() || '';
      const filtrados = getVisibleMembers();

      renderList(filtrados, termo !== '' || currentFilter !== 'all' || currentPlayModeFilter !== 'all' || currentGoalMetFilter !== 'none');
      refreshPlayModeCounterUi();
      refreshGoalMetFilterUi();
    };

    function escapeHtml(value) {
      return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
    }

    function hasMemberWarning(member) {
      return !!(member && (member.warningActive || member.hasWarning || member.advertencia || member.warningReason));
    }

    function getMemberWarningReason(member) {
      return (member?.warningReason || member?.advertenciaMotivo || member?.warningPreset || '').toString().trim();
    }

    function formatWarningDate(value) {
      try {
        if (!value) return '';
        let date = null;
        if (typeof value === 'number') date = new Date(value);
        else if (typeof value === 'string') date = new Date(value);
        else if (typeof value?.toDate === 'function') date = value.toDate();
        else if (typeof value?.seconds === 'number') date = new Date(value.seconds * 1000);
        if (!date || Number.isNaN(date.getTime())) return '';
        return date.toLocaleDateString('pt-BR');
      } catch (_) {
        return '';
      }
    }

    function renderWarningSummary(member) {
      if (!hasMemberWarning(member)) return '';
      const reason = getMemberWarningReason(member) || 'Sem motivo informado';
      return `
        <div class="mt-3 warning-reason-box rounded-xl px-3 py-2">
          <div class="flex items-start gap-2">
            <i data-lucide="triangle-alert" class="w-4 h-4 text-amber-600 mt-0.5 flex-shrink-0"></i>
            <div class="min-w-0">
              <p class="text-[11px] font-bold uppercase tracking-wide text-amber-700">Advertência ativa</p>
              <p class="text-xs text-amber-900 mt-0.5 break-words">${escapeHtml(reason)}</p>
            </div>
          </div>
        </div>`;
    }

    function renderWarningDetails(member) {
      if (!hasMemberWarning(member)) return '';
      const reason = getMemberWarningReason(member) || 'Sem motivo informado';
      const date = formatWarningDate(member.warningAt || member.advertenciaAt || member.updatedAt);
      return `
        <div class="warning-reason-box rounded-xl p-3">
          <div class="flex items-start gap-2">
            <i data-lucide="triangle-alert" class="w-4 h-4 text-amber-600 mt-0.5 flex-shrink-0"></i>
            <div class="min-w-0 flex-1">
              <p class="text-xs font-bold text-amber-800">Advertência</p>
              <p class="text-xs text-amber-900 mt-1 break-words">${escapeHtml(reason)}</p>
              ${date ? `<p class="text-[11px] text-amber-700 mt-1">Marcada em ${escapeHtml(date)}</p>` : ''}
            </div>
          </div>
        </div>`;
    }

    function badge(active, icon) {
      return `<div class="w-7 h-7 rounded-lg flex items-center justify-center ${active ? 'bg-emerald-100 text-emerald-600' : 'bg-gray-100 text-gray-400'}"><i data-lucide="${icon}" class="w-3 h-3"></i></div>`;
    }

    function detailBox(label, active, meta) {
      return `<div class="bg-white rounded-xl p-3 border border-gray-100">
        <p class="text-xs text-gray-400 mb-1">${label}</p>
        <div class="flex items-center gap-1.5">
          <i data-lucide="${active ? 'check' : 'x'}" class="w-4 h-4 ${active ? 'text-emerald-500' : 'text-red-400'}"></i>
          <span class="text-xs text-gray-500">Meta: ${meta}</span>
        </div>
      </div>`;
    }

    function renderList(list, isSearch = false) {
      const el = document.getElementById('members-list');
      
      if(list.length === 0) {
        if(isSearch) {
           el.innerHTML = `<div class="text-center py-8 text-gray-400">Nenhum membro encontrado neste filtro/busca.</div>`;
        } else {
           el.innerHTML = `<div class="bg-white rounded-2xl p-8 border border-gray-100 text-center text-gray-400 text-sm">Nenhum membro encontrado.</div>`;
        }
        initIcons(); // garante que o ícone do estado vazio renderize (se houver)
        return;
      }

      el.innerHTML = list.map(m => `
        <div class="${hasMemberWarning(m) ? 'member-warning-card' : 'bg-white'} rounded-2xl border border-gray-100 shadow-sm overflow-hidden transition-all hover:shadow-md animate-in">
          <div class="w-full p-5 cursor-pointer" onclick="toggleDetails('${m.id}')">
            <div class="flex items-center gap-3">
              <div class="w-11 h-11 rounded-full ${hasMemberWarning(m) ? 'member-warning-avatar' : 'bg-gradient-to-br from-emerald-400 to-green-500'} flex items-center justify-center flex-shrink-0 text-white font-bold text-sm">
                ${m.nick ? m.nick.charAt(0).toUpperCase() : '?'}
              </div>
              <div class="flex-1 min-w-0">
                <p class="font-semibold text-gray-900 text-sm truncate">${m.nick || 'Sem Nick'}</p>
                <p class="text-xs text-gray-400">ID: ${m.visibleId || '?'}</p>
              </div>
              <div class="flex gap-1.5">
                ${badge(m.guildWar, 'swords')}
                ${badge(m.weeklyMeta, 'target')}
                ${badge(m.hasTag, 'tag')}
                ${hasMemberWarning(m) ? badge(true, 'triangle-alert') : ''}
              </div>
              <div class="text-gray-300"><i data-lucide="chevron-down" class="w-5 h-5"></i></div>
            </div>
            ${renderMemberPlayModeLine(m)}
            ${renderWarningSummary(m)}
          </div>
          <div id="details-${m.id}" class="hidden border-t border-gray-100 p-4 bg-gray-50/50 space-y-3">
            ${renderWarningDetails(m)}
            <div class="grid grid-cols-2 gap-3">
              ${detailBox('Guerra', m.guildWar, m.guildWarMeta)}
              ${detailBox('Meta Semanal', m.weeklyMeta, m.weeklyMetaValue)}
              <div class="bg-white rounded-xl p-3 border border-gray-100">
                <p class="text-xs text-gray-400 mb-1">Tag</p>
                ${m.hasTag ? '<span class="text-emerald-500 font-bold text-xs">Sim</span>' : '<span class="text-red-400 text-xs">Não</span>'}
              </div>
              <div class="bg-white rounded-xl p-3 border border-gray-100">
                <p class="text-xs text-gray-400 mb-1">WhatsApp</p>
                ${m.whatsapp ? `<a href="https://wa.me/55${m.whatsapp}" target="_blank" class="text-emerald-600 text-xs hover:underline">${m.whatsapp}</a>` : '<span class="text-xs text-gray-400">-</span>'}
              </div>
            </div>
            <div class="grid grid-cols-2 sm:grid-cols-5 gap-2 pt-2">
              <button type="button" onclick="event.stopPropagation(); copyMemberData('${m.id}'); return false;" class="py-2.5 rounded-xl border border-gray-200 text-gray-700 text-sm font-medium hover:bg-gray-50">Copiar</button>
              <button type="button" onclick="event.stopPropagation(); editMember('${m.id}'); return false;" class="py-2.5 rounded-xl border border-emerald-200 text-emerald-700 text-sm font-medium hover:bg-emerald-50">Editar</button>
              <button type="button" onclick="event.stopPropagation(); openWarningMemberModal('${m.id}'); return false;" class="py-2.5 rounded-xl border ${hasMemberWarning(m) ? 'border-amber-300 bg-amber-50 text-amber-700 hover:bg-amber-100' : 'border-amber-200 text-amber-600 hover:bg-amber-50'} text-sm font-medium">${hasMemberWarning(m) ? 'Ver advert.' : 'Advertir'}</button>
              <button type="button" onclick="event.stopPropagation(); moveMember('${m.id}'); return false;" class="py-2.5 rounded-xl border border-blue-200 text-blue-600 text-sm font-medium hover:bg-blue-50">Mover</button>
              <button type="button" onclick="event.stopPropagation(); deleteMember('${m.id}'); return false;" class="py-2.5 rounded-xl border border-red-200 text-red-500 text-sm font-medium hover:bg-red-50">Excluir</button>
            </div>
          </div>
        </div>
      `).join('');
      initIcons();
    }


    // ==========================================
    // INICIALIZAÇÃO INSTANTÂNEA DO CACHE (Sem piscar)
    // ==========================================
    try {
      const initCache = __readMembersFromCache();
      if (initCache && initCache.length > 0) {
        __setMembersCache(initCache);
      }
    } catch(e) { 
      console.error("Erro no carregamento instantâneo do cache:", e); 
    }


    // ==========================================
    // LÓGICA DE SINCRONIZAÇÃO (Firebase)
    // ==========================================
    window.loadMembers = async function(forceRefresh = false) {
      const cached = __readMembersFromCache();
      const needsFirstFetch = !cached || !cached.length;

      // Se NÃO pediu pra forçar, E a gente JÁ achou os membros no cache, encerra aqui na hora!
      if (!forceRefresh && !needsFirstFetch) {
        // Garantia extra: se a tela por algum motivo esvaziou a variável, reabastece ela.
        if (membersCache.length === 0 && cached) {
           __setMembersCache(cached);
        }
        return; 
      }

      if (forceRefresh) showToast('info', 'Sincronizando com a base de dados...');

      try {
        const snap = await getDocs(collection(db, "guildas", getGuildContext().guildId, __membersCollectionName()));
        const fresh = [];
        snap.forEach(d => { if (d.id === "__meta__") return; fresh.push({ id: d.id, ...d.data() }); });
        fresh.sort((a,b)=> String(a.nick || '').localeCompare(String(b.nick || '')));

        const cachedJSON = JSON.stringify(cached || []);
        const freshJSON = JSON.stringify(fresh);

        // Atualiza a tela só se tiver novidade ou for o primeiro acesso
        if (cachedJSON !== freshJSON) {
          __setMembersCache(fresh);
          if (forceRefresh) showToast('success', 'Lista atualizada com sucesso.');
        } else {
          if (needsFirstFetch) __setMembersCache(fresh);
          if (forceRefresh) showToast('success', 'Tudo já estava atualizado.');
        }
      } catch (err) {
        console.error(err);
        if (needsFirstFetch) {
          __setMembersCache([]);
          showToast('error', 'Erro ao buscar dados.');
        } else if (forceRefresh) {
          showToast('error', 'Erro ao sincronizar.');
        }
      }
    };


    // ==========================================
    // FUNCIONALIDADES DOS MODAIS (EDIÇÃO RÁPIDA, ETC)
    // ==========================================
    window.openQuickEditModal = () => {
       pendingEdits = {};
       document.getElementById('qe-save-btn').classList.add('hidden');
       document.getElementById('qe-info-text').classList.remove('hidden');
       renderQuickEditList();
       document.getElementById('quick-edit-modal').classList.remove('hidden');
    };

    window.closeQuickEditModal = () => document.getElementById('quick-edit-modal').classList.add('hidden');

    // --- LÓGICA DO PRINT ---
    let scannerInstance = null;
    let printScannerLoadPromise = null;

    const salvarDadosDoPrint = async (dadosExtraidos) => {
        const lista = Array.isArray(dadosExtraidos) ? dadosExtraidos : [];
        if (!lista.length) {
            showToast('info', 'Nenhum dado de print para salvar.');
            return;
        }

        const btnSalvar = document.getElementById('btn-save-prints');
        const batch = writeBatch(db);
        const guildId = getGuildContext().guildId;

        lista.forEach(dado => {
            const member = membersCache.find(m => String(m.id || '') === String(dado.id || ''));
            if (!member) return;

            const updates = { updatedAt: serverTimestamp() };
            const cacheUpdates = { updatedAt: Date.now() };

            if (dado.gg !== undefined && dado.gg !== null && dado.gg !== '') {
                const gg = Number(dado.gg || 0);
                if (Number.isFinite(gg)) {
                    updates.guildWar = true;
                    updates.guildWarMeta = gg;
                    cacheUpdates.guildWar = true;
                    cacheUpdates.guildWarMeta = gg;
                }
            }

            if (dado.honra !== undefined && dado.honra !== null && dado.honra !== '') {
                const honra = Number(dado.honra || 0);
                if (Number.isFinite(honra)) {
                    updates.weeklyMeta = true;
                    updates.weeklyMetaValue = honra;
                    cacheUpdates.weeklyMeta = true;
                    cacheUpdates.weeklyMetaValue = honra;
                }
            }

            if (Object.keys(updates).length <= 1) return;

            const docId = String(member.id || dado.id || member.visibleId || '').trim();
            if (!docId) return;

            const ref = doc(db, "guildas", guildId, __membersCollectionName(), docId);
            batch.set(ref, updates, { merge: true });
            Object.assign(member, cacheUpdates);
        });

        try {
            await batch.commit();
            showToast('success', `${lista.length} membro(s) atualizado(s) pelo print!`);
            __setMembersCache(membersCache);
            closePrintModal();
        } catch (e) {
            console.error(e);
            showToast('error', 'Erro ao salvar pontos dos prints.');
        } finally {
            if (btnSalvar) {
                btnSalvar.innerHTML = 'Confirmar e Salvar Pontuações';
                btnSalvar.disabled = false;
            }
        }
    };

    async function initPrintScannerIfNeeded() {
        if (scannerInstance) return scannerInstance;

        if (!printScannerLoadPromise) {
            printScannerLoadPromise = import('./printmembros.js')
                .then(({ setupPrintScanner }) => {
                    if (typeof setupPrintScanner !== 'function') {
                        throw new Error('setupPrintScanner não foi encontrado em printmembros.js');
                    }
                    scannerInstance = setupPrintScanner({ onSave: salvarDadosDoPrint });
                    scannerInstance.updateCache(membersCache);
                    return scannerInstance;
                })
                .catch((e) => {
                    console.error(e);
                    printScannerLoadPromise = null;
                    showToast('error', 'Erro ao carregar o leitor de prints. Confira se o arquivo printmembros.js está junto do membros.html.');
                    return null;
                });
        }

        return printScannerLoadPromise;
    }

    window.openPrintModal = async () => {
        if (!__canUsePrintScannerFromCache()) {
            canUsePrintScanner = false;
            __syncPrintScannerAccessState();
            const upgradeModal = document.getElementById('print-upgrade-modal');
            if (upgradeModal) {
                upgradeModal.classList.remove('hidden');
                initIcons();
            } else {
                showToast('info', 'Ler prints está disponível apenas no plano PRO ou superior.');
            }
            return;
        }

        const modal = document.getElementById('print-modal');
        if (!modal) return;
        modal.classList.remove('hidden');
        initIcons();

        const scanner = await initPrintScannerIfNeeded();
        if (scanner) scanner.updateCache(membersCache);
    };

    window.closePrintModal = () => {
        document.getElementById('print-modal')?.classList.add('hidden');
        if (scannerInstance) scannerInstance.resetScanner();
    };

    window.closePrintUpgradeModal = () => {
        document.getElementById('print-upgrade-modal')?.classList.add('hidden');
    };


    
    function renderQuickEditList() {
       const container = document.getElementById('qe-members-list');
       const sorted = [...membersCache].sort((a,b) => String(a.nick).localeCompare(String(b.nick)));

       container.innerHTML = sorted.map(m => {
           const state = pendingEdits[m.id] || { hasTag: !!m.hasTag, guildWar: !!m.guildWar, weeklyMeta: !!m.weeklyMeta };

           return `
             <div class="flex flex-col sm:flex-row sm:items-center justify-between p-3.5 bg-white border border-gray-100 rounded-xl gap-3 shadow-sm hover:border-emerald-100 transition-colors">
                <div class="flex-1 min-w-0 flex items-center gap-3">
                  <div class="w-8 h-8 rounded-full bg-emerald-100 flex items-center justify-center flex-shrink-0 text-emerald-700 font-bold text-xs">
                    ${m.nick ? m.nick.charAt(0).toUpperCase() : '?'}
                  </div>
                  <div>
                    <p class="font-bold text-gray-900 text-sm truncate">${m.nick || 'Sem Nick'}</p>
                    <p class="text-[11px] text-gray-400 font-medium">ID: ${m.visibleId || '?'}</p>
                  </div>
                </div>
                <div class="flex gap-2">
                   <button onclick="toggleQE('${m.id}', 'hasTag')" id="qe-${m.id}-hasTag" class="pm-option !p-2 !gap-1.5 !text-xs !rounded-lg flex justify-center flex-1 sm:flex-none ${state.hasTag ? 'pm-selected' : ''}">
                     <span class="pm-circle scale-[0.75]"></span> Tag
                   </button>
                   <button onclick="toggleQE('${m.id}', 'guildWar')" id="qe-${m.id}-guildWar" class="pm-option !p-2 !gap-1.5 !text-xs !rounded-lg flex justify-center flex-1 sm:flex-none ${state.guildWar ? 'pm-selected' : ''}">
                     <span class="pm-circle scale-[0.75]"></span> GG
                   </button>
                   <button onclick="toggleQE('${m.id}', 'weeklyMeta')" id="qe-${m.id}-weeklyMeta" class="pm-option !p-2 !gap-1.5 !text-xs !rounded-lg flex justify-center flex-1 sm:flex-none ${state.weeklyMeta ? 'pm-selected' : ''}">
                     <span class="pm-circle scale-[0.75]"></span> Sem.
                   </button>
                </div>
             </div>
           `;
       }).join('');
    }

    window.toggleQE = (id, field) => {
       const m = membersCache.find(x => x.id === id);
       if(!m) return;

       if(!pendingEdits[id]) {
           pendingEdits[id] = { hasTag: !!m.hasTag, guildWar: !!m.guildWar, weeklyMeta: !!m.weeklyMeta };
       }

       pendingEdits[id][field] = !pendingEdits[id][field];

       const btn = document.getElementById(`qe-${id}-${field}`);
       if(pendingEdits[id][field]) {
           btn.classList.add('pm-selected');
       } else {
           btn.classList.remove('pm-selected');
       }

       document.getElementById('qe-save-btn').classList.remove('hidden');
       document.getElementById('qe-info-text').classList.add('hidden');
    };

    window.saveQuickEdits = async () => {
       const keys = Object.keys(pendingEdits);
       if(keys.length === 0) return;

       const btn = document.getElementById('qe-save-btn');
       btn.innerHTML = '<i data-lucide="loader-2" class="w-4 h-4 animate-spin inline mr-2"></i> Salvando...';
       btn.disabled = true;

       const batch = writeBatch(db);
       const guildId = getGuildContext().guildId;
       let didMigrate = false;

       keys.forEach(id => {
           const m = membersCache.find(x => x.id === id);
           const updates = {
               hasTag: pendingEdits[id].hasTag,
               guildWar: pendingEdits[id].guildWar,
               weeklyMeta: pendingEdits[id].weeklyMeta,
               updatedAt: serverTimestamp()
           };

           // MIGRATION ON THE FLY (Edição rápida)
           if (m.id !== m.visibleId) {
               didMigrate = true;
               const newRef = doc(db, "guildas", guildId, __membersCollectionName(), m.visibleId);
               const oldRef = doc(db, "guildas", guildId, __membersCollectionName(), m.id);
               
               const fullObj = { ...m, ...updates };
               delete fullObj.id; // remove o campo id para não sujar o documento
               batch.set(newRef, fullObj);
               batch.delete(oldRef);
           } else {
               const ref = doc(db, "guildas", guildId, __membersCollectionName(), id);
               batch.update(ref, updates);
           }
       });

       try {
           await batch.commit();
           
           if (didMigrate) {
               showToast('info', 'Usuário(s) migrado(s) para o novo sistema!');
           } else {
               showToast('success', `${keys.length} membro(s) atualizado(s)!`);
           }
           closeQuickEditModal();

           // Atualiza cache local
           keys.forEach(id => {
             const idx = membersCache.findIndex(m => m.id === id);
             if (idx >= 0) {
               const m = membersCache[idx];
               const newId = m.id !== m.visibleId ? m.visibleId : m.id;
               membersCache[idx] = {
                 ...m,
                 hasTag: pendingEdits[id].hasTag,
                 guildWar: pendingEdits[id].guildWar,
                 weeklyMeta: pendingEdits[id].weeklyMeta,
                 id: newId,
                 updatedAt: Date.now()
               };
             }
           });
           __setMembersCache(membersCache);
       } catch(e) {
           console.error(e);
           showToast('error', 'Erro ao salvar alterações em lote.');
       } finally {
           btn.innerHTML = 'Salvar Alterações';
           btn.disabled = false;
       }
    };

    // ----- ZERAR TODOS -----
    window.promptZero = (type) => {
       currentZeroAction = type;
       const label = type === 'gg' ? 'a Guerra (GG)' : 'o Semanal';
       document.getElementById('confirm-title').innerText = `Zerar ${label}?`;
       document.getElementById('confirm-desc').innerHTML = `Essa ação irá colocar <strong>0 pontos</strong> e desmarcar a meta de <strong>TODOS OS MEMBROS</strong> da guilda.<br><br><span class="text-red-500 font-bold">Atenção: É irreversível!</span>`;
       document.getElementById('confirm-modal').classList.remove('hidden');
    };

    window.closeConfirmModal = () => document.getElementById('confirm-modal').classList.add('hidden');

    window.executeZero = async () => {
       if(!membersCache || membersCache.length === 0) {
           showToast('info', 'Não há membros para zerar.');
           closeConfirmModal();
           return;
       }

       const batch = writeBatch(db);
       const guildId = getGuildContext().guildId;
       let didMigrate = false;

       membersCache.forEach(m => {
           const updateData = { updatedAt: serverTimestamp() };
           
           if(currentZeroAction === 'gg') {
               updateData.guildWar = false;
               updateData.guildWarMeta = 0;
           } else {
               updateData.weeklyMeta = false;
               updateData.weeklyMetaValue = 0;
           }
           
           // MIGRATION ON THE FLY (Ao Zerar)
           if (m.id !== m.visibleId) {
               didMigrate = true;
               const newRef = doc(db, "guildas", guildId, __membersCollectionName(), m.visibleId);
               const oldRef = doc(db, "guildas", guildId, __membersCollectionName(), m.id);
               const fullObj = { ...m, ...updateData };
               delete fullObj.id;
               batch.set(newRef, fullObj);
               batch.delete(oldRef);
           } else {
               const ref = doc(db, "guildas", guildId, __membersCollectionName(), m.id);
               batch.update(ref, updateData);
           }
       });

       try {
           closeConfirmModal();
           showToast('info', 'Zerando todos os membros... aguarde.');
           await batch.commit();
           
           if (didMigrate) {
               showToast('info', 'Zerados e migrados para o novo sistema!');
           } else {
               showToast('success', 'Todos os membros zerados com sucesso!');
           }
           closeQuickEditModal();

           // Atualiza cache local
           membersCache = membersCache.map(m => {
               const base = { ...m, updatedAt: Date.now() };
               if (currentZeroAction === 'gg') {
                   base.guildWar = false;
                   base.guildWarMeta = 0;
               } else {
                   base.weeklyMeta = false;
                   base.weeklyMetaValue = 0;
               }
               // atualiza ID localmente se foi migrado
               if (base.id !== base.visibleId) base.id = base.visibleId;
               return base;
           });
           __setMembersCache(membersCache);
       } catch(e) {
           console.error(e);
           showToast('error', 'Erro ao processar zeramento.');
       }
    };


    // ----- FILTRO DROPDOWN -----
    window.toggleFilterDropdown = () => {
      document.getElementById('filter-dropdown').classList.toggle('hidden');
    };

    window.applyFilter = (filterKey, filterLabel) => {
      currentFilter = filterKey;
      document.getElementById('filter-label').innerText = filterLabel;
      document.getElementById('filter-dropdown').classList.add('hidden');

      document.querySelectorAll('[data-filter-btn]').forEach(btn => {
        btn.classList.remove('pm-selected');
      });
      
      const activeBtn = document.querySelector(`[data-filter-btn="${filterKey}"]`);
      if (activeBtn) {
        activeBtn.classList.add('pm-selected');
      }

      applyFiltersAndRender();
    };

    document.addEventListener('click', (e) => {
      const btn = document.getElementById('btn-filter');
      const dropdown = document.getElementById('filter-dropdown');
      if (btn && dropdown && !btn.contains(e.target) && !dropdown.contains(e.target)) {
        dropdown.classList.add('hidden');
      }

      const guildBtn = document.getElementById('btn-guild-slot');
      const guildDropdown = document.getElementById('guild-slot-dropdown');
      if (guildBtn && guildDropdown && !guildBtn.contains(e.target) && !guildDropdown.contains(e.target)) {
        guildDropdown.classList.add('hidden');
      }

      const playModeBtn = document.getElementById('btn-playmode-counter');
      const playModeDropdown = document.getElementById('playmode-counter-dropdown');
      if (playModeBtn && playModeDropdown && !playModeBtn.contains(e.target) && !playModeDropdown.contains(e.target)) {
        playModeDropdown.classList.add('hidden');
      }

      const goalMetBtn = document.getElementById('btn-goal-met-filter');
      const goalMetDropdown = document.getElementById('goal-met-dropdown');
      if (goalMetBtn && goalMetDropdown && !goalMetBtn.contains(e.target) && !goalMetDropdown.contains(e.target)) {
        goalMetDropdown.classList.add('hidden');
      }
    });


    // ==========================================
    // HELPERS DE TAGS E PLAYMODE
    // ==========================================
    function escapeRegExp(str) {
      return String(str).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    }

    function nickHasMemberTag(nick) {
      if (!memberTag) return false;
      const raw = String(nick || "");
      const t = String(memberTag || "").trim();
      if (!t) return false;
      try {
        const re = new RegExp(escapeRegExp(t), 'i');
        return re.test(raw);
      } catch {
        return raw.toLowerCase().includes(t.toLowerCase());
      }
    }

    function syncHasTagToggleFromNick() {
      const hasTagEl = document.getElementById('has-tag');
      const nickEl = document.getElementById('nick');
      if (!hasTagEl || !nickEl) return;
      if (hasTagManualOverride) return;
      if (!memberTag) return;
      hasTagEl.checked = nickHasMemberTag(nickEl.value);
    }

    function toSafeNumber(value) {
      const n = Number(value);
      return Number.isFinite(n) ? n : 0;
    }

    function toNullableGoal(value) {
      const n = Number(value);
      return Number.isFinite(n) && n >= 0 ? Math.floor(n) : null;
    }

    function getGoalThreshold(key) {
      const normalized = normalizeGoalsFromAnySource(guildGoals || {});
      const raw = normalized && key in normalized ? normalized[key] : null;
      return (raw != null && Number.isFinite(Number(raw))) ? Number(raw) : null;
    }

    function getGoalThresholdForMode(modeKey) {
      const normalized = normalizePlayModeValue(modeKey);
      const field = GG_GOAL_FIELD_BY_MODE[normalized];
      if (!field) return getGoalThreshold('metaGG');

      const specific = getGoalThreshold(field);
      if (specific != null) return specific;
      return getGoalThreshold('metaGG');
    }

    function getRequiredGuildWarGoalForModes(modes = []) {
      const normalizedModes = (Array.isArray(modes) ? modes : [modes])
        .map(normalizePlayModeValue)
        .filter(Boolean);
      const uniqueModes = [...new Set(normalizedModes.filter((mode) => mode !== 'coringa'))];

      if (uniqueModes.length >= 2) {
        const coringaGoal = getGoalThresholdForMode('coringa');
        if (coringaGoal != null) return coringaGoal;
      }

      const goals = normalizedModes
        .map(getGoalThresholdForMode)
        .filter((value) => value != null && Number.isFinite(Number(value)));

      if (goals.length) return Math.max(...goals);
      return getGoalThreshold('metaGG');
    }

    function memberMetGuildWarGoalForMode(member, modeKey) {
      const normalizedMode = normalizePlayModeValue(modeKey);
      if (!normalizedMode || normalizedMode === 'all') return memberMetAnyGuildWarGoal(member);

      if (normalizedMode === 'coringa') {
        if (!isCoringaMember(member)) return false;
        const goal = getGoalThresholdForMode('coringa');
        if (goal == null) return !!member.guildWar;
        return toSafeNumber(member.guildWarMeta) >= goal;
      }

      const modes = getMemberPlayModes(member);
      if (!modes.includes(normalizedMode)) return false;

      const goal = getGoalThresholdForMode(normalizedMode);
      if (goal == null) return !!member.guildWar;
      return toSafeNumber(member.guildWarMeta) >= goal;
    }

    function memberMetAnyGuildWarGoal(member) {
      const modes = getMemberPlayModes(member);
      if (isCoringaMember(member)) {
        const coringaGoal = getGoalThresholdForMode('coringa');
        if (coringaGoal != null) return toSafeNumber(member.guildWarMeta) >= coringaGoal;
      }
      if (modes.length) return modes.some((mode) => memberMetGuildWarGoalForMode(member, mode));

      const legacyGoal = getGoalThreshold('metaGG');
      if (legacyGoal == null) return !!member.guildWar;
      return toSafeNumber(member.guildWarMeta) >= legacyGoal;
    }

    function syncGoalToggle(toggleId, inputId, goalKeyOrGetter) {
      const toggleEl = document.getElementById(toggleId);
      const inputEl = document.getElementById(inputId);
      if (!toggleEl || !inputEl) return;

      const goal = typeof goalKeyOrGetter === 'function' ? goalKeyOrGetter() : getGoalThreshold(goalKeyOrGetter);
      if (goal == null) return;

      toggleEl.checked = toSafeNumber(inputEl.value) >= goal;
    }

    function syncGoalTogglesFromValues() {
      syncGoalToggle('guild-war', 'guild-war-meta', () => getRequiredGuildWarGoalForModes(getSelectedPlayModes()));
      syncGoalToggle('weekly-meta', 'weekly-meta-value', 'metaHonra');
    }

    function getSelectedPlayModes() {
      const hidden = document.getElementById('play-mode');
      if (!hidden) return [];
      const raw = (hidden.value || '').trim();
      if (!raw) return [];
      try {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) return parsed.filter(Boolean).map(v => String(v).trim()).filter(Boolean);
      } catch {}
      return [raw].filter(Boolean);
    }

    function setSelectedPlayModes(values) {
      const hidden = document.getElementById('play-mode');
      const wrap = document.getElementById('playmode-wrap');
      if (!hidden || !wrap) return;

      const list = (Array.isArray(values) ? values : [values])
        .map(v => (v == null ? '' : String(v).trim()))
        .filter(Boolean);

      hidden.value = list.length ? JSON.stringify(list) : '';

      const set = new Set(list);
      wrap.querySelectorAll('.pm-option').forEach(btn => {
        if (btn.hasAttribute('data-filter-btn')) return;
        if (btn.id && btn.id.startsWith('qe-')) return;
        
        const v = (btn.dataset.value || '').trim();
        const isSelected = set.has(v);
        btn.classList.toggle('pm-selected', isSelected);
        btn.setAttribute('aria-checked', isSelected ? 'true' : 'false');
      });
    }

    function togglePlayMode(value) {
      const v = (value || '').trim();
      if (!v) return;

      const current = getSelectedPlayModes();
      const idx = current.findIndex(x => String(x).trim() === v);

      if (idx >= 0) current.splice(idx, 1);
      else current.push(v);

      setSelectedPlayModes(current);
      syncGoalTogglesFromValues();
    }

    function applyPlayMode(value) {
      if (Array.isArray(value)) setSelectedPlayModes(value);
      else setSelectedPlayModes(value ? [value] : []);
      syncGoalTogglesFromValues();
    }

    function initPlayModePicker() {
      const wrap = document.getElementById('playmode-wrap');
      if (!wrap) return;
      if (wrap.dataset.bound === '1') return;
      wrap.dataset.bound = '1';

      wrap.addEventListener('click', (e) => {
        const btn = e.target.closest('.pm-option');
        if (!btn || btn.hasAttribute('data-filter-btn') || (btn.id && btn.id.startsWith('qe-'))) return;
        togglePlayMode(btn.dataset.value || '');
      });
    }


    // ==========================================
    // EVENTOS DO MODAL DE MEMBROS E SUBMIT
    // ==========================================
    window.toggleDetails = (id) => {
      const el = document.getElementById(`details-${id}`);
      el.classList.toggle('hidden');
    };

    window.openModal = () => {
      document.getElementById('member-form').reset();
      document.getElementById('member-id').value = '';
      document.getElementById('modal-title').innerText = 'Novo Membro';
      document.getElementById('api-feedback').innerHTML = '';
      hasTagManualOverride = false;
      setSelectedPlayModes([]);
      syncHasTagToggleFromNick();
      syncGoalTogglesFromValues();
      document.getElementById('modal').classList.remove('hidden');
    };

    window.closeModal = () => document.getElementById('modal').classList.add('hidden');

    window.editMember = (id) => {
      const m = membersCache.find(x => x.id === id);
      if(!m) return;
      document.getElementById('member-id').value = m.id;
      document.getElementById('visible-id').value = m.visibleId;
      document.getElementById('nick').value = (m.nick || '');
      applyPlayMode(m.playMode || '');
      hasTagManualOverride = false;
      syncHasTagToggleFromNick();
      document.getElementById('whatsapp').value = m.whatsapp;
      document.getElementById('guild-war').checked = m.guildWar;
      document.getElementById('guild-war-meta').value = (m.guildWarMeta ?? 0);
      document.getElementById('weekly-meta').checked = m.weeklyMeta;
      document.getElementById('weekly-meta-value').value = (m.weeklyMetaValue ?? 0);
      document.getElementById('has-tag').checked = m.hasTag;
      document.getElementById('join-date').value = m.joinDate;
      
      syncHasTagToggleFromNick();
      syncGoalTogglesFromValues();
      document.getElementById('modal-title').innerText = 'Editar Membro';
      document.getElementById('modal').classList.remove('hidden');
    };

    function buildMemberCopyText(member) {
      const modeKeys = getMemberPlayModes(member);
      const modes = getMemberPlayModeLabels(member).filter((label) => label !== 'Coringa 🃏');
      const isCoringa = isCoringaMember(member);
      const modesText = `${modes.length ? modes.join(' • ') : '-'}${isCoringa ? ' • 🃏 Coringa' : ''}`;
      const honraGoal = getGoalThreshold('metaHonra');
      const ggValue = toSafeNumber(member.guildWarMeta);
      const honraValue = toSafeNumber(member.weeklyMetaValue);
      const honraStatus = honraGoal == null ? (member.weeklyMeta ? 'Batida' : 'Pendente') : (honraValue >= honraGoal ? 'Batida' : 'Pendente');
      const ggLines = (() => {
        const lines = [];
        if (isCoringa) {
          const goal = getGoalThresholdForMode('coringa');
          const status = goal == null ? (member.guildWar ? 'Batida' : 'Pendente') : (ggValue >= goal ? 'Batida' : 'Pendente');
          lines.push(`• Coringa 🃏: ${ggValue}${goal != null ? ` / ${goal}` : ''} • ${status}`);
        }
        if (modeKeys.length) {
          lines.push(...modeKeys.filter((mode) => mode !== 'coringa').map((mode) => {
            const label = getPlayModeLabel(mode) || mode;
            const goal = getGoalThresholdForMode(mode);
            const status = goal == null ? (member.guildWar ? 'Batida' : 'Pendente') : (ggValue >= goal ? 'Batida' : 'Pendente');
            return `• ${label}: ${ggValue}${goal != null ? ` / ${goal}` : ''} • ${status}`;
          }));
          return lines;
        }
        const goal = getGoalThreshold('metaGG');
        const status = goal == null ? (member.guildWar ? 'Batida' : 'Pendente') : (ggValue >= goal ? 'Batida' : 'Pendente');
        return [`• GG: ${ggValue}${goal != null ? ` / ${goal}` : ''} • ${status}`];
      })();

      return [
        `📋 Dados do membro`,
        ``,
        `Nick: ${member.nick || '-'}`,
        `ID: ${member.visibleId || member.id || '-'}`,
        `Guilda: ${__currentGuildDisplayName()}`,
        `Modo(s): ${modesText}`,
        `WhatsApp: ${member.whatsapp || '-'}`,
        `Tag: ${member.hasTag ? 'Sim' : 'Não'}`,
        `Advertência: ${hasMemberWarning(member) ? 'Sim' : 'Não'}`,
        ...(hasMemberWarning(member) ? [`Motivo: ${getMemberWarningReason(member) || '-'}`] : []),
        ``,
        `GG por modalidade:`,
        ...ggLines,
        `Honra semanal: ${honraValue}${honraGoal != null ? ` / ${honraGoal}` : ''} • ${honraStatus}`,
        `Entrada: ${member.joinDate || '-'}`
      ].join('\n');
    }

    window.copyMemberData = async (id) => {
      const member = membersCache.find(x => String(x.id || '') === String(id || ''));
      if (!member) return;

      const text = buildMemberCopyText(member);
      try {
        if (navigator.clipboard?.writeText) {
          await navigator.clipboard.writeText(text);
        } else {
          const textarea = document.createElement('textarea');
          textarea.value = text;
          textarea.setAttribute('readonly', 'true');
          textarea.style.position = 'fixed';
          textarea.style.opacity = '0';
          document.body.appendChild(textarea);
          textarea.select();
          document.execCommand('copy');
          textarea.remove();
        }
        showToast('success', 'Dados do membro copiados.');
      } catch (e) {
        console.error(e);
        showToast('error', 'Não foi possível copiar os dados.');
      }
    };

    window.closeDeleteConfirmModal = () => {
      currentDeleteId = '';
      document.getElementById('delete-confirm-modal').classList.add('hidden');
    };

    window.executeDeleteMember = async () => {
      const id = String(currentDeleteId || '').trim();
      if (!id) {
        closeDeleteConfirmModal();
        return;
      }

      try {
        const m = membersCache.find(x => x.id === id);
        await deleteDoc(doc(db, "guildas", getGuildContext().guildId, __membersCollectionName(), id));

        membersCache = (membersCache || []).filter(member => member.id !== id);
        __setMembersCache(membersCache);
        closeDeleteConfirmModal();

        // Aviso se era um usuário antigo que foi limpo
        if (m && m.id !== m.visibleId) {
             showToast('info', 'Usuário (sistema antigo) foi migrado/removido.');
        } else {
             showToast('success', 'Membro excluído.');
        }
      } catch(e) {
        console.error(e);
        closeDeleteConfirmModal();
        showToast('error', 'Erro ao excluir.');
      }
    };

    window.deleteMember = (id) => {
      currentDeleteId = String(id || '').trim();
      if (!currentDeleteId) return;
      document.getElementById('delete-confirm-modal').classList.remove('hidden');
      initIcons();
    };

    window.closeMoveMemberModal = () => {
      currentMoveId = '';
      currentMoveTargetSlot = null;
      document.getElementById('move-member-modal').classList.add('hidden');
    };

    window.moveMember = (id) => {
      const member = membersCache.find(x => x.id === id);
      if (!member) return;
      if (!canUseMultiGuildMembers) {
        showToast('info', 'Mover membros entre guildas é um recurso do plano PRO ou superior.');
        return;
      }

      const destinations = [1, 2, 3, 4].filter(slot => slot !== Number(currentGuildSlot) && __isGuildSlotAvailable(slot));
      if (!destinations.length) {
        showToast('info', 'Nenhuma outra guilda disponível para mover este membro.');
        return;
      }

      currentMoveId = String(id || '').trim();
      currentMoveTargetSlot = destinations[0] || null;

      const optionsEl = document.getElementById('move-member-options');
      const descEl = document.getElementById('move-member-desc');
      if (descEl) descEl.innerHTML = `Escolha para qual guilda <b>${member.nick || member.visibleId || 'este membro'}</b> deve ser movido.`;
      if (optionsEl) {
        optionsEl.innerHTML = destinations.map(slot => `
          <button
            type="button"
            data-move-slot="${slot}"
            class="w-full text-left px-4 py-3 rounded-xl border border-gray-200 bg-white hover:bg-gray-50 transition-colors"
          >
            <div class="flex items-center justify-between gap-3">
              <div>
                <div class="text-sm font-semibold text-gray-900">${__currentGuildDisplayName(slot)}</div>
                <div class="text-[11px] text-gray-500 mt-0.5">Mover para a lista desta guilda</div>
              </div>
              <span class="w-4 h-4 rounded-full border-2 border-gray-300 inline-block" data-move-slot-dot="${slot}"></span>
            </div>
          </button>
        `).join('');
      }

      const syncMoveSelection = () => {
        document.querySelectorAll('[data-move-slot]').forEach((btn) => {
          const slot = Number(btn.getAttribute('data-move-slot') || 0);
          const active = slot === Number(currentMoveTargetSlot);
          btn.classList.toggle('border-emerald-300', active);
          btn.classList.toggle('bg-emerald-50', active);
          btn.classList.toggle('border-gray-200', !active);
          btn.classList.toggle('bg-white', !active);
        });
        document.querySelectorAll('[data-move-slot-dot]').forEach((dot) => {
          const slot = Number(dot.getAttribute('data-move-slot-dot') || 0);
          const active = slot === Number(currentMoveTargetSlot);
          dot.classList.toggle('border-emerald-500', active);
          dot.classList.toggle('bg-emerald-500', active);
          dot.classList.toggle('border-gray-300', !active);
          dot.classList.toggle('bg-white', !active);
        });
      };

      optionsEl?.querySelectorAll('[data-move-slot]').forEach((btn) => {
        btn.addEventListener('click', () => {
          currentMoveTargetSlot = Number(btn.getAttribute('data-move-slot') || 0) || null;
          syncMoveSelection();
        });
      });

      syncMoveSelection();
      document.getElementById('move-member-modal').classList.remove('hidden');
      initIcons();
    };

    window.executeMoveMember = async () => {
      const id = String(currentMoveId || '').trim();
      const targetSlot = Math.max(1, Math.min(4, Math.floor(Number(currentMoveTargetSlot) || 0)));
      const member = membersCache.find(x => String(x.id || '') === id);
      if (!id || !member || !targetSlot || targetSlot === Number(currentGuildSlot)) {
        closeMoveMemberModal();
        return;
      }

      try {
        const duplicate = await __findMemberInGuildSlotByVisibleId(targetSlot, member.visibleId);
        if (duplicate) {
          showToast('error', `Este ID já está em ${__currentGuildDisplayName(targetSlot)}.`);
          return;
        }

        await __ensureMembersCollectionExists(targetSlot);

        const guildId = getGuildContext().guildId;
        const payload = { ...member, visibleId: member.visibleId, updatedAt: serverTimestamp() };
        delete payload.id;

        await setDoc(doc(db, 'guildas', guildId, __membersCollectionName(targetSlot), member.visibleId), payload, { merge: true });
        await deleteDoc(doc(db, 'guildas', guildId, __membersCollectionName(currentGuildSlot), member.id));

        membersCache = (membersCache || []).filter(item => String(item.id || '') !== id);
        __setMembersCache(membersCache);
        __syncCacheAfterMove(member, currentGuildSlot, targetSlot);
        closeMoveMemberModal();
        showToast('success', `Membro movido para ${__currentGuildDisplayName(targetSlot)}.`);
      } catch (e) {
        console.error(e);
        showToast('error', 'Não foi possível mover o membro.');
      }
    };

    function closeWarningPresetMenu() {
      const menu = document.getElementById('warning-preset-menu');
      const btn = document.getElementById('warning-preset-btn');
      if (menu) menu.classList.add('hidden');
      if (btn) btn.setAttribute('aria-expanded', 'false');
    }

    function setWarningPresetLabel(value = '') {
      const clean = String(value || '').trim();
      const label = document.getElementById('warning-preset-label');
      const preset = document.getElementById('warning-preset');
      if (preset) preset.value = clean;
      if (label) label.textContent = clean || 'Selecionar motivo';
      document.querySelectorAll('.warning-preset-option').forEach((btn) => {
        btn.classList.toggle('warning-preset-active', String(btn.dataset.warningPreset || '').trim() === clean);
      });
    }

    window.closeWarningMemberModal = () => {
      currentWarningId = '';
      closeWarningPresetMenu();
      document.getElementById('warning-member-modal')?.classList.add('hidden');
    };

    window.openWarningMemberModal = (id) => {
      const member = membersCache.find(x => String(x.id || '') === String(id || ''));
      if (!member) return;

      currentWarningId = String(id || '').trim();
      const warned = hasMemberWarning(member);
      const reason = getMemberWarningReason(member);

      const title = document.getElementById('warning-member-title');
      const desc = document.getElementById('warning-member-desc');
      const preset = document.getElementById('warning-preset');
      const textarea = document.getElementById('warning-reason');
      const removeBtn = document.getElementById('btn-remove-warning');

      if (title) title.textContent = warned ? 'Advertência do membro' : 'Advertir membro';
      if (desc) desc.innerHTML = `Membro: <b>${escapeHtml(member.nick || member.visibleId || 'Sem nick')}</b>`;
      setWarningPresetLabel('');
      if (textarea) textarea.value = reason || '';
      if (removeBtn) removeBtn.classList.toggle('hidden', !warned);
      closeWarningPresetMenu();

      document.getElementById('warning-member-modal')?.classList.remove('hidden');
      initIcons();
    };

    window.saveMemberWarning = async () => {
      const id = String(currentWarningId || '').trim();
      const member = membersCache.find(x => String(x.id || '') === id);
      if (!id || !member) {
        closeWarningMemberModal();
        return;
      }

      const textarea = document.getElementById('warning-reason');
      const reason = (textarea?.value || '').toString().trim();
      if (!reason) {
        showToast('error', 'Escreva ou selecione um motivo para a advertência.');
        return;
      }

      const btn = document.getElementById('btn-save-warning');
      if (btn) {
        btn.disabled = true;
        btn.textContent = 'Salvando...';
      }

      const payload = {
        warningActive: true,
        hasWarning: true,
        warningReason: reason,
        warningAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      };

      try {
        await setDoc(doc(db, 'guildas', getGuildContext().guildId, __membersCollectionName(), id), payload, { merge: true });
        const idx = membersCache.findIndex(x => String(x.id || '') === id);
        if (idx >= 0) {
          membersCache[idx] = {
            ...membersCache[idx],
            warningActive: true,
            hasWarning: true,
            warningReason: reason,
            warningAt: Date.now(),
            updatedAt: Date.now()
          };
          __setMembersCache(membersCache);
        }
        closeWarningMemberModal();
        showToast('success', 'Advertência salva.');
      } catch (e) {
        console.error(e);
        showToast('error', 'Erro ao salvar advertência.');
      } finally {
        if (btn) {
          btn.disabled = false;
          btn.textContent = 'Salvar';
        }
      }
    };

    window.removeMemberWarning = async () => {
      const id = String(currentWarningId || '').trim();
      const member = membersCache.find(x => String(x.id || '') === id);
      if (!id || !member) {
        closeWarningMemberModal();
        return;
      }

      const btn = document.getElementById('btn-remove-warning');
      if (btn) {
        btn.disabled = true;
        btn.textContent = 'Removendo...';
      }

      const payload = {
        warningActive: false,
        hasWarning: false,
        warningReason: '',
        warningAt: null,
        updatedAt: serverTimestamp()
      };

      try {
        await setDoc(doc(db, 'guildas', getGuildContext().guildId, __membersCollectionName(), id), payload, { merge: true });
        const idx = membersCache.findIndex(x => String(x.id || '') === id);
        if (idx >= 0) {
          membersCache[idx] = {
            ...membersCache[idx],
            warningActive: false,
            hasWarning: false,
            warningReason: '',
            warningAt: null,
            updatedAt: Date.now()
          };
          __setMembersCache(membersCache);
        }
        closeWarningMemberModal();
        showToast('success', 'Advertência removida.');
      } catch (e) {
        console.error(e);
        showToast('error', 'Erro ao remover advertência.');
      } finally {
        if (btn) {
          btn.disabled = false;
          btn.textContent = 'Remover';
        }
      }
    };

    document.getElementById('warning-preset-btn')?.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const menu = document.getElementById('warning-preset-menu');
      const btn = document.getElementById('warning-preset-btn');
      if (!menu) return;
      const opening = menu.classList.contains('hidden');
      menu.classList.toggle('hidden');
      if (btn) btn.setAttribute('aria-expanded', opening ? 'true' : 'false');
    });

    document.getElementById('warning-preset-menu')?.addEventListener('click', (e) => {
      const option = e.target.closest('[data-warning-preset]');
      if (!option) return;
      e.preventDefault();
      e.stopPropagation();
      const value = String(option.dataset.warningPreset || '').trim();
      setWarningPresetLabel(value);
      if (value) {
        const textarea = document.getElementById('warning-reason');
        if (textarea) textarea.value = value;
      }
      closeWarningPresetMenu();
    });

    document.addEventListener('click', (e) => {
      const menu = document.getElementById('warning-preset-menu');
      const btn = document.getElementById('warning-preset-btn');
      if (!menu || menu.classList.contains('hidden')) return;
      if (btn?.contains(e.target) || menu.contains(e.target)) return;
      closeWarningPresetMenu();
    });

    window.fetchNick = async () => {
      const uid = document.getElementById('visible-id').value.trim();
      const feedback = document.getElementById('api-feedback');
      if(!uid) { showToast('error', 'Digite o ID'); return; }

      feedback.innerHTML = '<span class="text-blue-500">Buscando...</span>';

      const controller = new AbortController();
      const t = setTimeout(() => controller.abort(), 12000);

      try {
        const url = `/api/proxy?endpoint=ff_info&query=${encodeURIComponent(uid)}`;
        const res = await fetch(url, { method: 'GET', signal: controller.signal });
        const data = await res.json().catch(() => ({}));

        const name = data?.nick;
        const level = data?.level;
        const levelNum = Number(level);

        if (res.ok && data?.success && name) {
          document.getElementById('nick').value = name;
          hasTagManualOverride = false;
          syncHasTagToggleFromNick();
          feedback.innerHTML = `<span class="text-emerald-600 font-bold">✓ ${name} (Nível ${Number.isFinite(levelNum) ? levelNum : '?'})</span> <span class="text-gray-500">Verifique se o nick realmente é esse! A api pode conter erros..</span>`;

          syncHasTagToggleFromNick();
        } else {
          feedback.innerHTML = '<span class="text-red-500">Jogador não encontrado ou API indisponivel no momento!</span>';
        }
      } catch(e) {
        const msg = (e?.name === 'AbortError')
          ? 'A API demorou demais para responder.'
          : 'Jogador não encontrado ou erro na API.';
        feedback.innerHTML = `<span class="text-red-500">${msg}</span>`;
      } finally {
        clearTimeout(t);
      }
    };

    document.getElementById('member-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const id = document.getElementById('member-id').value;
      const visibleId = document.getElementById('visible-id').value.trim();
      
      const rawNick = document.getElementById('nick').value.trim();
      syncHasTagToggleFromNick();
      syncGoalTogglesFromValues();
      const hasTag = document.getElementById('has-tag').checked;
      const finalNick = rawNick;
      const guildId = getGuildContext().guildId;
      const guildWarMetaValue = toSafeNumber(document.getElementById('guild-war-meta').value);
      const weeklyMetaValue = toSafeNumber(document.getElementById('weekly-meta-value').value);

      const payload = {
        visibleId,
        nick: finalNick,
        whatsapp: document.getElementById('whatsapp').value.trim(),
        guildWar: document.getElementById('guild-war').checked,
        guildWarMeta: guildWarMetaValue,
        weeklyMeta: document.getElementById('weekly-meta').checked,
        weeklyMetaValue: weeklyMetaValue,
        hasTag: hasTag,
        playMode: (() => {
          const arr = getSelectedPlayModes();
          return arr.length ? arr : null;
        })(),
        joinDate: document.getElementById('join-date').value || new Date().toISOString().split('T')[0],
        updatedAt: serverTimestamp()
      };

      try {
        if (!id || String(id || '').trim() !== visibleId) {
          const duplicateInOtherGuild = await __findMemberAcrossGuildsByVisibleId(visibleId, currentGuildSlot);
          if (duplicateInOtherGuild) {
            showToast('error', `Este ID já está em ${__currentGuildDisplayName(duplicateInOtherGuild.slot)}.`);
            return;
          }
        }

        if(id) {
          if (id !== visibleId) {
             // MIGRATION ON THE FLY (Edição de perfil)
             await setDoc(doc(db, "guildas", guildId, __membersCollectionName(), visibleId), payload);
             await deleteDoc(doc(db, "guildas", guildId, __membersCollectionName(), id));
             showToast('info', 'Usuário foi migrado para o novo sistema!');
             
             // Update cache
             const idx = membersCache.findIndex(m => m.id === id);
             if (idx >= 0) membersCache[idx] = { ...membersCache[idx], ...payload, id: visibleId, updatedAt: Date.now() };
          } else {
             // NORMAL UPDATE
             await setDoc(doc(db, "guildas", guildId, __membersCollectionName(), id), payload, { merge: true });
             showToast('success', 'Membro Atualizado!');
             
             // Update cache
             const idx = membersCache.findIndex(m => m.id === id);
             if (idx >= 0) membersCache[idx] = { ...membersCache[idx], ...payload, updatedAt: Date.now() };
          }
        } else {
          // CREATE NEW OR OVERWRITE (Usando sempre o ID do jogo)
          await setDoc(doc(db, "guildas", guildId, __membersCollectionName(), visibleId), payload);
          showToast('success', 'Adicionado (ou sobrescrito)!');
          
          // Tratamento no cache caso tenha sobrescrito
          const idx = membersCache.findIndex(m => m.id === visibleId);
          if (idx >= 0) {
             membersCache[idx] = { ...membersCache[idx], ...payload, updatedAt: Date.now() };
          } else {
             membersCache.push({ id: visibleId, ...payload, updatedAt: Date.now() });
          }
        }
        
        closeModal();
        __setMembersCache(membersCache);

      } catch(err) {
        showToast('error', 'Erro ao salvar.');
      }
    });

    document.addEventListener('change', (ev) => {
      if (ev && ev.target && ev.target.id === 'has-tag') {
        hasTagManualOverride = true;
      }
    });

    document.addEventListener('input', (ev) => {
      if (!ev || !ev.target) return;
      if (ev.target.id === 'nick') {
        syncHasTagToggleFromNick();
      }
      if (ev.target.id === 'guild-war-meta' || ev.target.id === 'weekly-meta-value') {
        syncGoalTogglesFromValues();
      }
    });


    function bindReliableTap(el, handler) {
      if (!el || typeof handler !== 'function') return;
      let lastPointerTs = 0;
      const run = (ev) => {
        const now = Date.now();
        if (ev.type === 'click' && lastPointerTs && (now - lastPointerTs) < 450) {
          ev.preventDefault();
          ev.stopPropagation();
          if (typeof ev.stopImmediatePropagation === 'function') ev.stopImmediatePropagation();
          return;
        }
        if (ev.type === 'pointerup') lastPointerTs = now;
        ev.preventDefault();
        ev.stopPropagation();
        if (typeof ev.stopImmediatePropagation === 'function') ev.stopImmediatePropagation();
        handler(ev);
      };
      el.addEventListener('pointerup', run);
      el.addEventListener('click', run, true);
    }

    bindReliableTap(document.getElementById('btn-filter'), () => {
      window.toggleFilterDropdown();
    });

    bindReliableTap(document.getElementById('btn-guild-slot'), () => {
      if (!canUseMultiGuildMembers) {
        showToast('info', 'Trocar entre guildas nesta tela é um recurso do plano PRO ou superior.');
        return;
      }
      __renderGuildSlotDropdown();
      const dropdown = document.getElementById('guild-slot-dropdown');
      dropdown?.classList.toggle('hidden');
      __positionGuildSlotDropdown();
    });

    bindReliableTap(document.getElementById('btn-playmode-counter'), () => {
      window.togglePlayModeCounterDropdown();
    });

    document.getElementById('playmode-counter-dropdown')?.addEventListener('click', (e) => {
      const option = e.target.closest('[data-playmode-filter-option]');
      if (!option) return;
      const filterKey = String(option.getAttribute('data-playmode-filter-option') || 'all');
      window.applyPlayModeFilter(filterKey);
    });

    bindReliableTap(document.getElementById('btn-goal-met-filter'), () => {
      window.toggleGoalMetDropdown();
    });

    document.getElementById('goal-met-dropdown')?.addEventListener('click', (e) => {
      const option = e.target.closest('[data-goal-met-filter-option]');
      if (!option) return;
      const filterKey = String(option.getAttribute('data-goal-met-filter-option') || 'all');
      window.applyGoalMetFilter(filterKey);
    });

    document.getElementById('guild-slot-dropdown')?.addEventListener('click', async (e) => {
      const option = e.target.closest('[data-guild-slot-option]');
      if (!option) return;
      if (!canUseMultiGuildMembers) {
        showToast('info', 'Trocar entre guildas nesta tela é um recurso do plano PRO ou superior.');
        return;
      }
      const slot = Number(option.getAttribute('data-guild-slot-option') || 1);
      await __applyGuildSlot(slot, false);
    });

    __hydrateToolbarFromCacheNow();

    window.addEventListener('resize', () => {
      __positionGuildSlotDropdown();
      positionPlayModeCounterDropdown();
      positionGoalMetDropdown();
    });

    // ==========================================
    // FINALIZAÇÃO DE BOOT E AUTENTICAÇÃO
    // ==========================================
    initPlayModePicker();

    checkAuth().then(async (user) => {
      if(!user) return;
      document.getElementById('btn-logout').onclick = logout;

      const settingsCache = __readFreshDirectSettingsCache();
      const cachedSlots = Array.isArray(settingsCache?.multiGuildSlots) ? normalizeGuildSlotMetaList(settingsCache.multiGuildSlots) : null;
      currentGuildSlotsMeta = cachedSlots && cachedSlots.length
        ? cachedSlots
        : [{ slot: 1, name: getGuildContext()?.guildName || '', tag: settingsCache?.tag || '', exists: true }];
      const vipTier = __getCachedVipTierFast();
      canUseMultiGuildMembers = ['pro', 'business', 'vitalicio'].includes(vipTier);
      canUsePrintScanner = ['pro', 'business', 'vitalicio'].includes(vipTier);
      currentGuildSlot = canUseMultiGuildMembers ? __readSelectedGuildSlot() : 1;
      if (!__isGuildSlotAvailable(currentGuildSlot)) currentGuildSlot = 1;
      __writeSelectedGuildSlot(currentGuildSlot);

      memberTag = settingsCache?.tag ? String(settingsCache.tag || '').trim() : memberTag;
      __updateCurrentMemberTag();
      guildGoals = settingsCache?.goals ? normalizeGoalsFromAnySource(settingsCache.goals) : guildGoals;
      __syncGuildSlotButtonState();
      __syncPrintScannerAccessState();
      __renderGuildSlotDropdown();
      refreshPlayModeCounterUi();
      refreshGoalMetFilterUi();

      try {
        const [freshSlots, freshTag, freshGoals] = await Promise.all([
          getGuildMultiConfig(4, { ttlMs: SETTINGS_SCREEN_CACHE_TTL_MS }).catch(() => null),
          getMemberTagConfig({ ttlMs: SETTINGS_SCREEN_CACHE_TTL_MS }).catch(() => null),
          getGuildGoalsConfig({ ttlMs: SETTINGS_SCREEN_CACHE_TTL_MS }).catch(() => null)
        ]);

        if (Array.isArray(freshSlots) && freshSlots.length) currentGuildSlotsMeta = normalizeGuildSlotMetaList(freshSlots);
        if (freshTag) memberTag = freshTag;
        __updateCurrentMemberTag();
        if (freshGoals) guildGoals = normalizeGoalsFromAnySource(freshGoals);

        if (!__isGuildSlotAvailable(currentGuildSlot)) currentGuildSlot = 1;
        __writeSelectedGuildSlot(currentGuildSlot);
        __syncGuildSlotButtonState();
        __syncPrintScannerAccessState();
        __renderGuildSlotDropdown();
        refreshPlayModeCounterUi();
        refreshGoalMetFilterUi();
        __cacheSettingsSnapshot();
      } catch (_) {
        __cacheSettingsSnapshot();
      }

      const hasTagEl = document.getElementById('has-tag');
      if (hasTagEl) {
        hasTagEl.addEventListener('change', () => {
          if (hasTagEl.checked && !memberTag) {
            showToast('error', 'Nenhuma tag configurada. Configure em Ajustes.');
            hasTagEl.checked = false;
          }
        });
      }

      const nickEl = document.getElementById('nick');
      if (nickEl) {
        nickEl.addEventListener('input', syncHasTagToggleFromNick);
        nickEl.addEventListener('blur', syncHasTagToggleFromNick);
      }

      const guildWarMetaEl = document.getElementById('guild-war-meta');
      const weeklyMetaValueEl = document.getElementById('weekly-meta-value');
      if (guildWarMetaEl) {
        guildWarMetaEl.addEventListener('input', syncGoalTogglesFromValues);
        guildWarMetaEl.addEventListener('blur', syncGoalTogglesFromValues);
      }
      if (weeklyMetaValueEl) {
        weeklyMetaValueEl.addEventListener('input', syncGoalTogglesFromValues);
        weeklyMetaValueEl.addEventListener('blur', syncGoalTogglesFromValues);
      }
      syncGoalTogglesFromValues();
      
      // Carrega a lista da guilda selecionada nesta tela
      await __applyGuildSlot(currentGuildSlot, false);
      
      const searchInput = document.getElementById('search-input');
      if (searchInput) {
        searchInput.addEventListener('input', window.applyFiltersAndRender);
      }
    });