import { checkAuth, setupSidebar, initIcons, logout, showToast, getMemberTagConfig, setMemberTagConfig, getGuildContext, getGuildInfoCached, getGuildAccessKeyConfig, generateGuildAccessKey, getCachedGuildProfileState, getGuildProfileExists, createGuildProfile, getGuildGoalsConfig, setGuildGoalsConfig, setGuildNameConfig, getVipTier, getGuildMultiConfig, addGuildSlotConfig, setGuildSlotConfig } from '../logic.js';

    setupSidebar();
    initIcons();

    const tagInput = document.getElementById('tag-input');
    const btnSave = document.getElementById('btn-save-tag');
    const hint = document.getElementById('tag-hint');
    const readOnlyNote = document.getElementById('readonly-note');
    const guildUidEl = document.getElementById('guild-uid');
    const btnCopyGuildUid = document.getElementById('btn-copy-guild-uid');
    const guildNameInput = document.getElementById('guild-name-input');
    const btnSaveGuildName = document.getElementById('btn-save-guild-name');
    const guildNameHint = document.getElementById('guild-name-hint');
    const guildCreatedEl = document.getElementById('guild-created');
    const goalGgRushInput = document.getElementById('goal-gg-rush-input');
    const goalGgCurandeiroInput = document.getElementById('goal-gg-curandeiro-input');
    const goalGgFullGasInput = document.getElementById('goal-gg-full-gas-input');
    const goalGgSuporteInput = document.getElementById('goal-gg-suporte-input');
    const goalGgFuzileiroInput = document.getElementById('goal-gg-fuzileiro-input');
    const goalGgCoringaInput = document.getElementById('goal-gg-coringa-input');
    const goalHonraInput = document.getElementById('goal-honra-input');
    const goalLineGgInput = document.getElementById('goal-line-gg-input');
    const goalLineHonraInput = document.getElementById('goal-line-honra-input');
    const ggGoalInputs = {
      metaGGRush: goalGgRushInput,
      metaGGCurandeiro: goalGgCurandeiroInput,
      metaGGFullGas: goalGgFullGasInput,
      metaGGSuporte: goalGgSuporteInput,
      metaGGFuzileiro: goalGgFuzileiroInput,
      metaGGCoringa: goalGgCoringaInput
    };
    const btnSaveGoals = document.getElementById('btn-save-goals');
    const goalsHint = document.getElementById('goals-hint');
    const guildAccessKeyEl = document.getElementById('guild-access-key');
    const guildAccessKeyHintEl = document.getElementById('guild-access-key-hint');
    const guildAccessKeyAdminPill = document.getElementById('guild-access-key-admin-pill');
    const btnGenerateGuildKey = document.getElementById('btn-generate-guild-key');
    const btnCopyGuildKey = document.getElementById('btn-copy-guild-key');
    const btnCreateGuildProfile = document.getElementById('btn-create-guild-profile');
    const btnAddGuildSlot = document.getElementById('btn-add-guild-slot');
    const btnRefreshSettings = document.getElementById('btn-refresh-settings');
    const multiGuildHint = document.getElementById('multi-guild-hint');
    const extraGuildsList = document.getElementById('extra-guilds-list');

    let currentCtx = null;
    let currentIsLeader = false;
    let currentIsAdmin = false;
    let currentCanAddGuildSlot = false;
    let currentGuildKey = '';
    let guildProfileExists = null;
    let currentGuildKeyForCache = '';
    let currentGuildProfileExistsForCache = null;
    let freshSettingsLoaded = false;
    let multiGuildSlots = [];
    function getMultiGuildCacheKey(guildId) {
      const gid = (guildId || currentCtx?.guildId || '').toString().trim();
      return gid ? `guildMulti_${gid}` : '';
    }

    function readMultiGuildCache(guildId) {
      try {
        const key = getMultiGuildCacheKey(guildId);
        if (!key) return [];
        const raw = localStorage.getItem(key);
        if (!raw) return [];
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed : [];
      } catch (_) {
        return [];
      }
    }

    function getSettingsCacheKey(guildId) {
      const gid = (guildId || currentCtx?.guildId || '').toString().trim();
      return gid ? `ajustesTela_${gid}` : '';
    }

    function readSettingsCache(guildId) {
      try {
        const key = getSettingsCacheKey(guildId);
        if (!key) return null;
        const raw = localStorage.getItem(key);
        return raw ? (JSON.parse(raw) || null) : null;
      } catch (_) {
        return null;
      }
    }

    function writeSettingsCache(guildId, data = {}) {
      try {
        const key = getSettingsCacheKey(guildId);
        if (!key) return;
        const previous = readSettingsCache(guildId) || {};
        localStorage.setItem(key, JSON.stringify({ ...previous, ...data, guildId, ts: Date.now() }));
      } catch (_) {}
    }

    function normalizeGoalValue(value) {
      const n = toNumberOrNull(value);
      return n == null ? null : n;
    }

    function normalizeGoalsPayload(source = {}) {
      const legacy = normalizeGoalValue(source.metaGG);
      const goals = {
        metaGGRush: normalizeGoalValue(source.metaGGRush ?? legacy),
        metaGGCurandeiro: normalizeGoalValue(source.metaGGCurandeiro ?? legacy),
        metaGGFullGas: normalizeGoalValue(source.metaGGFullGas ?? legacy),
        metaGGSuporte: normalizeGoalValue(source.metaGGSuporte ?? legacy),
        metaGGFuzileiro: normalizeGoalValue(source.metaGGFuzileiro ?? legacy),
        metaGGCoringa: normalizeGoalValue(source.metaGGCoringa ?? legacy),
        metaHonra: normalizeGoalValue(source.metaHonra),
        metaLineGG: normalizeGoalValue(source.metaLineGG ?? source.metaLinesGG ?? source.lineMetaGG),
        metaLineHonra: normalizeGoalValue(source.metaLineHonra ?? source.metaLinesHonra ?? source.lineMetaHonra)
      };
      goals.metaGG = goals.metaGGRush ?? legacy;
      return goals;
    }

    function applyGoalsToInputs(goals = {}) {
      const normalized = normalizeGoalsPayload(goals);
      Object.entries(ggGoalInputs).forEach(([field, input]) => {
        if (!input) return;
        input.value = normalized[field] != null ? String(normalized[field]) : '';
      });
      if (goalHonraInput) goalHonraInput.value = normalized.metaHonra != null ? String(normalized.metaHonra) : '';
      if (goalLineGgInput) goalLineGgInput.value = normalized.metaLineGG != null ? String(normalized.metaLineGG) : '';
      if (goalLineHonraInput) goalLineHonraInput.value = normalized.metaLineHonra != null ? String(normalized.metaLineHonra) : '';
    }

    function readGoalsFromInputs() {
      return normalizeGoalsPayload({
        metaGGRush: goalGgRushInput?.value,
        metaGGCurandeiro: goalGgCurandeiroInput?.value,
        metaGGFullGas: goalGgFullGasInput?.value,
        metaGGSuporte: goalGgSuporteInput?.value,
        metaGGFuzileiro: goalGgFuzileiroInput?.value,
        metaGGCoringa: goalGgCoringaInput?.value,
        metaHonra: goalHonraInput?.value,
        metaLineGG: goalLineGgInput?.value,
        metaLineHonra: goalLineHonraInput?.value
      });
    }

    function hasAnyGoal(goals = {}) {
      const normalized = normalizeGoalsPayload(goals);
      return ['metaGGRush', 'metaGGCurandeiro', 'metaGGFullGas', 'metaGGSuporte', 'metaGGFuzileiro', 'metaGGCoringa', 'metaHonra', 'metaLineGG', 'metaLineHonra']
        .some((field) => normalized[field] != null);
    }

    function getGoalsHintText(goals = {}) {
      const g = normalizeGoalsPayload(goals);
      if (!hasAnyGoal(g)) return 'Nenhuma meta configurada ainda.';
      return `Metas atuais: Rush ${g.metaGGRush ?? 0} • Curandeiro ${g.metaGGCurandeiro ?? 0} • Full Gás ${g.metaGGFullGas ?? 0} • Suporte ${g.metaGGSuporte ?? 0} • Fuzileiro ${g.metaGGFuzileiro ?? 0} • Coringa 🃏 ${g.metaGGCoringa ?? 0} • Honra ${g.metaHonra ?? 0} • Lines GG ${g.metaLineGG ?? 0} • Lines Honra ${g.metaLineHonra ?? 0}`;
    }

    function writeCurrentSettingsCache(extra = {}) {
      const gid = (currentCtx?.guildId || '').toString().trim();
      if (!gid) return;
      writeSettingsCache(gid, {
        tag: (tagInput?.value || '').trim(),
        guildName: (guildNameInput?.value || '').trim(),
        guildCreatedText: (guildCreatedEl?.textContent || '').trim(),
        goals: readGoalsFromInputs(),
        guildAccessKey: currentGuildKeyForCache || '',
        guildProfileExists: currentGuildProfileExistsForCache,
        multiGuildSlots: normalizeMultiGuildSlots(multiGuildSlots),
        ...extra
      });
    }

    function normalizeMultiGuildSlots(list) {
      const map = new Map();
      (Array.isArray(list) ? list : []).forEach((slot) => {
        const n = Number(slot?.slot);
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
      return Array.from(map.values()).sort((a, b) => a.slot - b.slot);
    }

    const SETTINGS_JSON_IMPORT_MAX_BYTES = 1024 * 1024;

    function downloadJsonFile(filename, payload) {
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    }

    function readJsonFile(file, maxBytes = SETTINGS_JSON_IMPORT_MAX_BYTES) {
      return new Promise((resolve, reject) => {
        if (!file) {
          reject(new Error('Selecione um arquivo JSON.'));
          return;
        }
        const isJson = file.type === 'application/json' || /\.json$/i.test(file.name || '');
        if (!isJson) {
          reject(new Error('O arquivo precisa estar no formato .json.'));
          return;
        }
        if (file.size > maxBytes) {
          reject(new Error('Esse JSON esta grande demais para ajustes.'));
          return;
        }
        const reader = new FileReader();
        reader.onload = () => {
          try { resolve(JSON.parse(String(reader.result || '{}'))); }
          catch (_) { reject(new Error('Nao foi possivel ler o JSON. Verifique se o arquivo nao esta corrompido.')); }
        };
        reader.onerror = () => reject(new Error('Nao foi possivel abrir o arquivo.'));
        reader.readAsText(file, 'utf-8');
      });
    }

    function cleanSettingsString(value, max = 120) {
      return String(value ?? '').trim().slice(0, max);
    }

    function sanitizeSettingsPayload(data = {}) {
      const slots = normalizeMultiGuildSlots(data.multiGuildSlots || data.guilds || []);
      const normalizedGoals = normalizeGoalsPayload(data.goals || data.metas || {});
      const tag = cleanSettingsString(data.tag ?? data.tagMembros ?? slots.find(item => Number(item.slot) === 1)?.tag ?? '', 80);
      const guildName = cleanSettingsString(data.guildName ?? data.name ?? slots.find(item => Number(item.slot) === 1)?.name ?? '', 120);
      const cleanSlots = slots.map((slot) => ({
        ...slot,
        name: cleanSettingsString(slot.name || '', 120),
        tag: cleanSettingsString(slot.tag || '', 80),
        exists: slot.slot === 1 ? true : slot.exists !== false && !!cleanSettingsString(slot.name || '', 120)
      }));
      return { tag, guildName, goals: normalizedGoals, multiGuildSlots: cleanSlots };
    }

    function mountSettingsJsonBackupPanel() {
      if (document.getElementById('settings-json-backup-panel')) return;
      const container = document.querySelector('main .max-w-3xl');
      if (!container) return;

      const panel = document.createElement('section');
      panel.id = 'settings-json-backup-panel';
      panel.className = 'rounded-2xl border border-emerald-100 bg-white p-4 shadow-sm';
      panel.innerHTML = `
        <div class="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div class="min-w-0">
            <div class="flex items-center gap-2">
              <span class="inline-flex h-9 w-9 items-center justify-center rounded-xl bg-emerald-50 text-emerald-700">
                <i data-lucide="file-json" class="w-5 h-5"></i>
              </span>
              <div>
                <h3 class="text-sm font-extrabold text-gray-900">Backup em JSON dos ajustes</h3>
                <p class="text-xs text-gray-500 mt-0.5">Baixe ou restaure tag, nome da guilda, metas e guildas extras configuradas nesta tela.</p>
              </div>
            </div>
            <p class="text-[11px] text-gray-500 mt-3 leading-relaxed">
              Use apenas JSON gerado por esta tela. Ao importar, os campos encontrados serao salvos na guilda atual; nada de membros ou lines e alterado aqui.
            </p>
          </div>
          <div class="flex shrink-0 flex-wrap gap-2 sm:justify-end">
            <button id="btn-export-settings-json" type="button" class="inline-flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-3 py-2 text-xs font-bold text-gray-700 hover:bg-gray-50">
              <i data-lucide="download" class="w-4 h-4"></i> Exportar JSON
            </button>
            <button id="btn-import-settings-json" type="button" class="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-3 py-2 text-xs font-bold text-white hover:bg-emerald-700">
              <i data-lucide="upload" class="w-4 h-4"></i> Importar JSON
            </button>
            <input id="input-import-settings-json" type="file" accept=".json,application/json" class="hidden" />
          </div>
        </div>
      `;
      const firstBlock = container.firstElementChild;
      if (firstBlock?.nextSibling) container.insertBefore(panel, firstBlock.nextSibling);
      else container.appendChild(panel);

      document.getElementById('btn-export-settings-json')?.addEventListener('click', exportSettingsJson);
      document.getElementById('btn-import-settings-json')?.addEventListener('click', () => {
        document.getElementById('input-import-settings-json')?.click();
      });
      document.getElementById('input-import-settings-json')?.addEventListener('change', async (event) => {
        const input = event.currentTarget;
        try { await importSettingsJson(input.files?.[0]); }
        finally { if (input) input.value = ''; }
      });
      initIcons();
    }

    function exportSettingsJson() {
      const gid = (currentCtx?.guildId || getGuildContext()?.guildId || '').toString().trim();
      if (!gid) {
        showToast('error', 'A guilda ainda nao foi carregada.');
        return;
      }
      const payload = {
        app: 'guilda-hub',
        screen: 'ajustes',
        version: 1,
        guildId: gid,
        guildName: cleanSettingsString(guildNameInput?.value || currentCtx?.guildName || '', 120),
        exportedAt: new Date().toISOString(),
        data: sanitizeSettingsPayload({
          tag: tagInput?.value || '',
          guildName: guildNameInput?.value || '',
          goals: readGoalsFromInputs(),
          multiGuildSlots
        })
      };
      downloadJsonFile(`guilda-ajustes-${gid}.json`, payload);
      showToast('success', 'JSON dos ajustes baixado.');
    }

    async function importSettingsJson(file) {
      const gid = (currentCtx?.guildId || getGuildContext()?.guildId || '').toString().trim();
      if (!gid) {
        showToast('error', 'A guilda ainda nao foi carregada.');
        return;
      }
      if (!currentIsLeader) {
        showToast('error', 'Apenas o Lider pode importar ajustes.');
        return;
      }
      if (!freshSettingsLoaded) {
        showToast('info', 'Aguarde o carregamento terminar antes de importar.');
        return;
      }
      try {
        const payload = await readJsonFile(file);
        if (!payload || payload.screen !== 'ajustes' || !payload.data || typeof payload.data !== 'object') {
          throw new Error('Esse arquivo nao parece ser um backup da tela de ajustes.');
        }
        if (payload.guildId && String(payload.guildId) !== String(gid)) {
          throw new Error('Esse JSON foi gerado para outra guilda.');
        }
        const rawData = payload.data || {};
        const hasGoalsInFile = Object.prototype.hasOwnProperty.call(rawData, 'goals') || Object.prototype.hasOwnProperty.call(rawData, 'metas');
        const data = sanitizeSettingsPayload(rawData);
        const hasSomething = !!data.tag || !!data.guildName || (hasGoalsInFile && hasAnyGoal(data.goals)) || data.multiGuildSlots.some(slot => slot.slot >= 2 && slot.exists);
        if (!hasSomething) throw new Error('Nao encontrei ajustes validos dentro desse JSON.');

        const ok = window.confirm('Importar estes ajustes para a guilda atual? Isso pode atualizar tag, nome, metas e guildas extras.');
        if (!ok) return;

        if (data.tag) await setMemberTagConfig(data.tag);
        if (data.guildName) await setGuildNameConfig(data.guildName);
        if (hasGoalsInFile) await setGuildGoalsConfig(data.goals);

        multiGuildSlots = normalizeMultiGuildSlots(data.multiGuildSlots.length ? data.multiGuildSlots : multiGuildSlots);
        if (data.guildName || data.tag) {
          upsertMultiGuildSlot(1, { name: data.guildName || guildNameInput?.value || '', tag: data.tag || tagInput?.value || '' });
        }
        for (const slot of multiGuildSlots.filter(item => Number(item.slot) >= 2 && item.exists)) {
          if (!slot.name && !slot.tag) continue;
          await setGuildSlotConfig(slot.slot, { name: slot.name || '', tag: slot.tag || '' });
        }

        if (tagInput && data.tag) tagInput.value = data.tag;
        if (guildNameInput && data.guildName) guildNameInput.value = data.guildName;
        if (hasGoalsInFile) {
          applyGoalsToInputs(data.goals);
          goalsHint.textContent = getGoalsHintText(data.goals);
        }
        if (hint && data.tag) hint.textContent = `Tag configurada: "${data.tag}"`;
        if (guildNameHint && data.guildName) guildNameHint.textContent = `Nome atual: ${data.guildName}`;
        renderExtraGuildSlots();
        setAddGuildSlotState();
        const cacheExtra = { multiGuildSlots };
        if (hasGoalsInFile) cacheExtra.goals = data.goals;
        if (data.tag) cacheExtra.tag = data.tag;
        if (data.guildName) cacheExtra.guildName = data.guildName;
        writeCurrentSettingsCache(cacheExtra);
        showToast('success', 'JSON importado nos ajustes.');
      } catch (err) {
        console.error(err);
        showToast('error', err?.message || 'Nao foi possivel importar o JSON.');
      }
    }


    function fmtDate(ms) {
      try {
        if (!ms) return '-';
        const d = new Date(Number(ms));
        return d.toLocaleDateString('pt-BR') + ' ' + d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
      } catch (_) {
        return '-';
      }
    }

    function maskGuildAccessKey(value) {
      const v = (value || '').toString().trim();
      if (!v) return 'Nenhuma chave gerada';
      if (v.length <= 6) return '••••••';
      return `${v.slice(0, 4)}•••••••••`;
    }

    function applyGuildKeyVisibility(value, isAdmin = false) {
      const hasValue = !!(value && String(value).trim());
      if (!guildAccessKeyEl) return;

      if (!hasValue) {
        guildAccessKeyEl.textContent = 'Nenhuma chave gerada';
        guildAccessKeyEl.classList.remove('blur-[6px]', 'select-none');
        guildAccessKeyAdminPill?.classList.add('hidden');
        return;
      }

      if (isAdmin) {
        guildAccessKeyEl.textContent = maskGuildAccessKey(value);
        guildAccessKeyEl.classList.add('blur-[6px]', 'select-none');
        guildAccessKeyAdminPill?.classList.remove('hidden');
        return;
      }

      guildAccessKeyEl.textContent = String(value);
      guildAccessKeyEl.classList.remove('blur-[6px]', 'select-none');
      guildAccessKeyAdminPill?.classList.add('hidden');
    }

    function syncGuildKeyButtons(value, isLeader = false, isAdmin = false, profileExists = null) {
      const hasValue = !!(value && String(value).trim());
      const hasProfile = profileExists === true;
      const needsProfile = hasValue && profileExists === false;

      if (btnGenerateGuildKey) {
        if (isLeader && !hasValue) btnGenerateGuildKey.classList.remove('hidden');
        else btnGenerateGuildKey.classList.add('hidden');
      }

      if (btnCopyGuildKey) {
        if (hasValue && hasProfile && !isAdmin) btnCopyGuildKey.classList.remove('hidden');
        else btnCopyGuildKey.classList.add('hidden');
      }

      if (btnCreateGuildProfile) {
        if (hasValue && needsProfile && isLeader && !isAdmin) btnCreateGuildProfile.classList.remove('hidden');
        else btnCreateGuildProfile.classList.add('hidden');
      }

      if (guildAccessKeyHintEl) {
        guildAccessKeyHintEl.textContent = !hasValue
          ? (isLeader
              ? 'Ainda não existe uma chave. Gere uma para usar no perfil da guilda e guarde com segurança.'
              : 'Ainda não existe uma chave gerada para essa guilda.')
          : hasProfile
            ? 'Perfil da guilda já criado. Use essa chave para acessar o perfil da guilda. Nunca compartilhe com ninguém.'
            : 'Essa chave já foi gerada. Agora crie o perfil da guilda e nunca compartilhe essa chave com ninguém.';
      }
    }

    function setReadonly(isReadonly, showAdminNote = false) {
      tagInput.disabled = isReadonly;
      btnSave.disabled = isReadonly;
      if (isReadonly) {
        tagInput.classList.add('bg-gray-50');
        btnSave.classList.add('opacity-50', 'cursor-not-allowed');
        if (showAdminNote) readOnlyNote.classList.remove('hidden');
        else readOnlyNote.classList.add('hidden');
      } else {
        tagInput.classList.remove('bg-gray-50');
        btnSave.classList.remove('opacity-50', 'cursor-not-allowed');
        readOnlyNote.classList.add('hidden');
      }
    }

    function setGoalsReadonly(isReadonly) {
      [...Object.values(ggGoalInputs), goalHonraInput, goalLineGgInput, goalLineHonraInput].forEach((el) => {
        if (!el) return;
        el.disabled = isReadonly;
        if (isReadonly) el.classList.add('bg-gray-50');
        else el.classList.remove('bg-gray-50');
      });
      if (btnSaveGoals) {
        btnSaveGoals.disabled = isReadonly;
        if (isReadonly) btnSaveGoals.classList.add('opacity-50', 'cursor-not-allowed');
        else btnSaveGoals.classList.remove('opacity-50', 'cursor-not-allowed');
      }
    }

    function setGuildNameReadonly(isReadonly) {
      if (guildNameInput) {
        guildNameInput.disabled = isReadonly;
        if (isReadonly) guildNameInput.classList.add('bg-gray-50');
        else guildNameInput.classList.remove('bg-gray-50');
      }
      if (btnSaveGuildName) {
        btnSaveGuildName.disabled = isReadonly;
        if (isReadonly) btnSaveGuildName.classList.add('opacity-50', 'cursor-not-allowed');
        else btnSaveGuildName.classList.remove('opacity-50', 'cursor-not-allowed');
      }
    }

    function toNumberOrNull(value) {
      const raw = (value ?? '').toString().trim();
      if (!raw) return null;
      const n = Number(raw);
      if (!Number.isFinite(n) || n < 0) return null;
      return Math.floor(n);
    }

    function normalizeVipTierClient(v) {
      const s = (v || '').toString().toLowerCase().trim();
      if (s.includes('vital') || s.includes('life') || s.includes('parceiro') || s.includes('partner')) return 'parceiro';
      if (s.includes('ultra')) return 'ultra';
      if (s.includes('buss') || s.includes('business')) return 'business';
      if (s.includes('pro')) return 'pro';
      if (s.includes('plus')) return 'plus';
      return 'free';
    }

    function escapeAttr(value) {
      return String(value ?? '')
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#039;');
    }

    function setAddGuildSlotState() {
      if (!btnAddGuildSlot) return;
      const usedExtraSlots = multiGuildSlots.filter((slot) => slot?.slot >= 2 && slot?.exists).length;
      const reachedLimit = usedExtraSlots >= 3;

      btnAddGuildSlot.disabled = !currentCanAddGuildSlot || reachedLimit;
      btnAddGuildSlot.classList.toggle('opacity-50', btnAddGuildSlot.disabled);
      btnAddGuildSlot.classList.toggle('cursor-not-allowed', btnAddGuildSlot.disabled);

      if (multiGuildHint) {
        if (!currentIsLeader) {
          multiGuildHint.textContent = 'Apenas o Líder pode editar ou criar guildas extras.';
        } else if (!currentCanAddGuildSlot) {
          multiGuildHint.textContent = 'Criar novas guildas extras é um recurso do plano PRO ou superior.';
        } else if (reachedLimit) {
          multiGuildHint.textContent = 'Limite máximo atingido: esta conta já possui 4 guildas no total.';
        } else {
          multiGuildHint.textContent = 'Você pode manter até 4 guildas no total nesta conta, sem opção de excluir por aqui.';
        }
      }
    }

    function renderExtraGuildSlots() {
      if (!extraGuildsList) return;
      multiGuildSlots = normalizeMultiGuildSlots(multiGuildSlots);
      const extras = multiGuildSlots.filter((slot) => slot?.slot >= 2 && slot?.exists);

      if (!extras.length) {
        extraGuildsList.innerHTML = `
          <div class="rounded-xl border border-dashed border-gray-300 bg-white/80 px-4 py-4 text-xs text-gray-500">
            Nenhuma guilda extra criada ainda.
          </div>
        `;
        return;
      }

      extraGuildsList.innerHTML = extras.map((slot) => `
        <div class="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm" data-slot-card="${slot.slot}">
          <div class="flex items-start justify-between gap-3 mb-3">
            <div>
              <p class="text-sm font-semibold text-gray-900">Guilda ${slot.slot}</p>
              <p class="text-[11px] text-gray-500">Edite o nome e a tag desta guilda extra.</p>
            </div>
            <span class="text-[10px] font-bold uppercase tracking-wide px-2.5 py-1 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-100">Extra</span>
          </div>

          <div class="grid md:grid-cols-2 gap-3">
            <div>
              <label class="text-xs font-medium text-gray-700 mb-1 block">Nome da guilda</label>
              <input
                type="text"
                data-slot-field="name"
                value="${escapeAttr(slot.name || '')}"
                placeholder="Nome da guilda ${slot.slot}"
                ${currentIsLeader ? '' : 'disabled'}
                class="w-full px-4 py-3 rounded-xl border border-gray-200 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100 outline-none text-sm ${currentIsLeader ? '' : 'bg-gray-50'}"
              />
            </div>

            <div>
              <label class="text-xs font-medium text-gray-700 mb-1 block">Tag correspondente</label>
              <input
                type="text"
                data-slot-field="tag"
                value="${escapeAttr(slot.tag || '')}"
                placeholder="Ex: ᵒᵗᵏ"
                ${currentIsLeader ? '' : 'disabled'}
                class="w-full px-4 py-3 rounded-xl border border-gray-200 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100 outline-none text-sm ${currentIsLeader ? '' : 'bg-gray-50'}"
              />
            </div>
          </div>

          <div class="mt-3 flex justify-end">
            <button
              type="button"
              data-action="save-slot"
              data-slot="${slot.slot}"
              ${currentIsLeader ? '' : 'disabled'}
              class="px-4 py-3 rounded-xl bg-gradient-to-r from-emerald-500 to-green-600 text-white text-sm font-medium shadow-lg hover:shadow-xl transition-all active:scale-95 ${currentIsLeader ? '' : 'opacity-50 cursor-not-allowed'}"
            >
              Salvar guilda ${slot.slot}
            </button>
          </div>
        </div>
      `).join('');
    }

    function upsertMultiGuildSlot(slotNumber, payload = {}) {
      const slot = Number(slotNumber);
      const idx = multiGuildSlots.findIndex((item) => Number(item?.slot) === slot);
      if (idx >= 0) {
        multiGuildSlots[idx] = { ...multiGuildSlots[idx], ...payload, exists: true };
      } else {
        multiGuildSlots.push({
          slot,
          nameField: slot <= 1 ? 'name' : `name${slot}`,
          tagField: slot <= 1 ? 'tagMembros' : `tagMembros${slot}`,
          name: (payload?.name || '').toString(),
          tag: (payload?.tag || '').toString(),
          exists: true
        });
      }
      multiGuildSlots = normalizeMultiGuildSlots(multiGuildSlots);
    }

    extraGuildsList?.addEventListener('click', async (event) => {
      const btn = event.target.closest('[data-action="save-slot"]');
      if (!btn || !currentIsLeader) return;

      const slot = Number(btn.dataset.slot);
      const card = btn.closest('[data-slot-card]');
      if (!slot || !card) return;

      const nameValue = (card.querySelector('[data-slot-field="name"]')?.value || '').trim();
      const tagValue = (card.querySelector('[data-slot-field="tag"]')?.value || '').trim();

      if (!nameValue) {
        showToast('error', `Digite o nome da guilda ${slot} antes de salvar.`);
        return;
      }

      try {
        btn.disabled = true;
        btn.classList.add('opacity-50', 'cursor-not-allowed');
        if (!freshSettingsLoaded) {
          showToast('info', 'Aguarde o carregamento terminar antes de salvar.');
          return;
        }
        await setGuildSlotConfig(slot, { name: nameValue, tag: tagValue });
        upsertMultiGuildSlot(slot, { name: nameValue, tag: tagValue });
        writeCurrentSettingsCache({ multiGuildSlots });
        renderExtraGuildSlots();
        setAddGuildSlotState();
        showToast('success', `Guilda ${slot} salva com sucesso!`);
      } catch (e) {
        console.error(e);
        showToast('error', `Não foi possível salvar a guilda ${slot}.`);
      } finally {
        btn.disabled = false;
        btn.classList.remove('opacity-50', 'cursor-not-allowed');
      }
    });

    btnAddGuildSlot?.addEventListener('click', async () => {
      if (!currentCanAddGuildSlot) return;

      try {
        btnAddGuildSlot.disabled = true;
        btnAddGuildSlot.classList.add('opacity-50', 'cursor-not-allowed');
        if (!freshSettingsLoaded) {
          showToast('info', 'Aguarde o carregamento terminar antes de criar outra guilda.');
          return;
        }
        const created = await addGuildSlotConfig(4);
        upsertMultiGuildSlot(created.slot, created);
        writeCurrentSettingsCache({ multiGuildSlots });
        renderExtraGuildSlots();
        setAddGuildSlotState();
        showToast('success', `Guilda ${created.slot} criada com sucesso!`);
      } catch (e) {
        console.error(e);
        showToast('error', e?.message || 'Não foi possível criar outra guilda.');
      } finally {
        btnAddGuildSlot.disabled = false;
        btnAddGuildSlot.classList.remove('opacity-50', 'cursor-not-allowed');
        setAddGuildSlotState();
      }
    });

    btnCopyGuildUid?.addEventListener('click', async () => {
      const value = (guildUidEl?.textContent || '').trim();
      if (!value) return;
      try { await navigator.clipboard.writeText(value); showToast('success', 'Copiado!'); } catch (_) { showToast('info', value); }
    });

    mountSettingsJsonBackupPanel();

    try {
      const ctx = getGuildContext();
      currentCtx = ctx || null;
      if (ctx) {
        const isLeader = false;
        const isAdmin = ctx.role === 'Admin';
        // Cache só pré-carrega visualmente. A escrita fica travada até a leitura atual do Firebase terminar.
        currentIsLeader = false;
        currentIsAdmin = isAdmin;
        currentCanAddGuildSlot = false;
        setReadonly(true, isAdmin);
        setGoalsReadonly(true);
        setGuildNameReadonly(true);
        setAddGuildSlotState();

        if (guildUidEl) guildUidEl.textContent = ctx.guildId || '';

        try {
          const rawInfo = localStorage.getItem(`guildInfo_${ctx.guildId}`);
          if (rawInfo) {
            const c = JSON.parse(rawInfo) || {};
            if (guildNameInput) guildNameInput.value = c?.name ? String(c.name) : (ctx.guildName || '');
            if (guildNameHint) guildNameHint.textContent = c?.name ? `Nome atual: ${String(c.name)}` : (ctx.guildName ? `Nome atual: ${ctx.guildName}` : 'Nenhum nome encontrado.');
            if (guildCreatedEl && c?.createdAtMs) guildCreatedEl.textContent = fmtDate(c.createdAtMs);
          }
        } catch (_) {}

        try {
          const pageCache = readSettingsCache(ctx.guildId);
          if (pageCache?.goals) applyGoalsToInputs(pageCache.goals);
          else {
            const rawGoals = localStorage.getItem(`guildGoals_${ctx.guildId}`);
            if (rawGoals) applyGoalsToInputs(JSON.parse(rawGoals) || {});
          }
        } catch (_) {}

        try {
          const raw = localStorage.getItem(`tagMembros_${ctx.guildId}`);
          if (raw) {
            const cached = JSON.parse(raw);
            if (cached?.value) {
              tagInput.value = String(cached.value);
              hint.textContent = `Tag configurada: "${cached.value}"`;
            }
          }
        } catch (_) {}

        try {
          const rawKey = localStorage.getItem(`guildAccessKey_${ctx.guildId}`);
          if (rawKey) {
            const cachedKey = JSON.parse(rawKey);
            const value = cachedKey?.value ? String(cachedKey.value) : '';
            applyGuildKeyVisibility(value, isAdmin);
            syncGuildKeyButtons(value, isLeader, isAdmin, getCachedGuildProfileState(ctx.guildId));
          } else {
            applyGuildKeyVisibility('', isAdmin);
            syncGuildKeyButtons('', isLeader, isAdmin, null);
          }
        } catch (_) {
          applyGuildKeyVisibility('', isAdmin);
          syncGuildKeyButtons('', isLeader, isAdmin, null);
        }

        try {
          multiGuildSlots = normalizeMultiGuildSlots(readMultiGuildCache(ctx.guildId));
          const primarySlot = multiGuildSlots.find((slot) => Number(slot?.slot) === 1);
          if (primarySlot?.name && guildNameInput) guildNameInput.value = primarySlot.name;
          if (primarySlot?.name && guildNameHint) guildNameHint.textContent = `Nome atual: ${primarySlot.name}`;
          if (primarySlot && typeof primarySlot.tag === 'string') {
            tagInput.value = primarySlot.tag || '';
            hint.textContent = primarySlot.tag ? `Tag configurada: "${primarySlot.tag}"` : 'Nenhuma tag configurada ainda.';
          }
          renderExtraGuildSlots();
        } catch (_) {}
      } else {
        setReadonly(true, false);
        setGoalsReadonly(true);
        setGuildNameReadonly(true);
        applyGuildKeyVisibility('', false);
        syncGuildKeyButtons('', false, false, null);
        renderExtraGuildSlots();
      }
    } catch (_) {
      setReadonly(true, false);
      setGoalsReadonly(true);
      setGuildNameReadonly(true);
      applyGuildKeyVisibility('', false);
      syncGuildKeyButtons('', false, false, null);
      renderExtraGuildSlots();
    }

    async function loadSettingsData({ forceRefresh = false, feedback = false } = {}) {
      const ctx = currentCtx || getGuildContext();
      if (!ctx?.guildId) return;

      const options = { forceRefresh };
      freshSettingsLoaded = false;
      if (btnRefreshSettings) {
        btnRefreshSettings.disabled = true;
        btnRefreshSettings.classList.add('opacity-50', 'cursor-not-allowed');
      }

      try {
        try {
          const current = await getMemberTagConfig(options);
          tagInput.value = current || '';
          hint.textContent = current ? `Tag configurada: "${current}"` : 'Nenhuma tag configurada ainda.';
        } catch (_) {
          hint.textContent = 'Nenhuma tag configurada ainda.';
        }

        try {
          const goals = await getGuildGoalsConfig(options);
          applyGoalsToInputs(goals || {});
          goalsHint.textContent = getGoalsHintText(goals || {});
        } catch (_) {
          goalsHint.textContent = 'Nenhuma meta configurada ainda.';
        }

        try {
          const info = await getGuildInfoCached(ctx.guildId, options);
          if (guildUidEl && info?.guildId) guildUidEl.textContent = info.guildId;
          if (guildNameInput) guildNameInput.value = info?.name || (ctx?.guildName || '');
          if (guildNameHint) guildNameHint.textContent = info?.name ? `Nome atual: ${info.name}` : ((ctx?.guildName) ? `Nome atual: ${ctx.guildName}` : 'Nenhum nome encontrado.');
          if (guildCreatedEl) guildCreatedEl.textContent = fmtDate(info?.createdAtMs);
        } catch (_) {
          if (guildUidEl) guildUidEl.textContent = ctx?.guildId || '-';
          if (guildNameInput) guildNameInput.value = ctx?.guildName || '';
          if (guildNameHint) guildNameHint.textContent = ctx?.guildName ? `Nome atual: ${ctx.guildName}` : 'Nenhum nome encontrado.';
        }

        try {
          multiGuildSlots = normalizeMultiGuildSlots(await getGuildMultiConfig(4, options));
          const primarySlot = multiGuildSlots.find((slot) => Number(slot?.slot) === 1);
          if (primarySlot?.name && guildNameInput) guildNameInput.value = primarySlot.name;
          if (primarySlot?.name && guildNameHint) guildNameHint.textContent = `Nome atual: ${primarySlot.name}`;
          if (primarySlot && typeof primarySlot.tag === 'string') {
            tagInput.value = primarySlot.tag || '';
            hint.textContent = primarySlot.tag ? `Tag configurada: "${primarySlot.tag}"` : 'Nenhuma tag configurada ainda.';
          }
        } catch (_) {
          multiGuildSlots = [];
        }
        renderExtraGuildSlots();
        setAddGuildSlotState();

        try {
          currentGuildKey = await getGuildAccessKeyConfig(options);
        } catch (_) {
          currentGuildKey = '';
        }

        if (currentGuildKey) {
          try {
            guildProfileExists = await getGuildProfileExists(options);
          } catch (_) {
            guildProfileExists = getCachedGuildProfileState(ctx?.guildId);
          }
        } else {
          guildProfileExists = null;
        }

        currentGuildKeyForCache = currentGuildKey || '';
        currentGuildProfileExistsForCache = guildProfileExists;
        applyGuildKeyVisibility(currentGuildKey || '', currentIsAdmin);
        syncGuildKeyButtons(currentGuildKey || '', currentIsLeader, currentIsAdmin, guildProfileExists);

        writeCurrentSettingsCache({
          guildAccessKey: currentGuildKeyForCache,
          guildProfileExists: currentGuildProfileExistsForCache,
          multiGuildSlots
        });

        if (feedback) showToast('success', 'Dados atualizados.');
      } catch (e) {
        console.error(e);
        if (feedback) showToast('error', 'Não foi possível recarregar os dados agora.');
      } finally {
        freshSettingsLoaded = true;
        if (btnRefreshSettings) {
          btnRefreshSettings.disabled = false;
          btnRefreshSettings.classList.remove('opacity-50', 'cursor-not-allowed');
        }
      }
    }

    checkAuth().then(async (user) => {
      if (!user) return;
      document.getElementById('btn-logout').onclick = logout;

      const ctx = getGuildContext();
      currentCtx = ctx || null;
      const isLeader = ctx?.role === 'Líder';
      const isAdmin = ctx?.role === 'Admin';
      currentIsLeader = !!isLeader;
      currentIsAdmin = !!isAdmin;
      currentCanAddGuildSlot = !!isLeader && ['pro', 'business', 'ultra', 'parceiro'].includes(normalizeVipTierClient(ctx?.vipTier || getVipTier()));
      freshSettingsLoaded = false;
      setReadonly(!isLeader, isAdmin);
      setGoalsReadonly(!isLeader);
      setGuildNameReadonly(!isLeader);
      setAddGuildSlotState();

      await loadSettingsData({ forceRefresh: false });

      btnRefreshSettings?.addEventListener('click', async () => {
        await loadSettingsData({ forceRefresh: true, feedback: true });
      });

      btnCopyGuildKey?.addEventListener('click', async () => {
        const realValue = (currentGuildKey || '').trim();
        if (!realValue || realValue === 'Nenhuma chave gerada' || isAdmin) return;
        try {
          await navigator.clipboard.writeText(realValue);
          showToast('success', 'Chave copiada!');
        } catch (_) {
          showToast('info', realValue);
        }
      });

      btnGenerateGuildKey?.addEventListener('click', async () => {
        if (!isLeader) return;
        try {
          btnGenerateGuildKey.disabled = true;
          btnGenerateGuildKey.classList.add('opacity-50', 'cursor-not-allowed');
          currentGuildKey = await generateGuildAccessKey();
          guildProfileExists = false;
          currentGuildKeyForCache = currentGuildKey || '';
          currentGuildProfileExistsForCache = guildProfileExists;
          writeCurrentSettingsCache({ guildAccessKey: currentGuildKeyForCache, guildProfileExists });
          applyGuildKeyVisibility(currentGuildKey, false);
          syncGuildKeyButtons(currentGuildKey, true, false, guildProfileExists);
          showToast('success', 'Chave gerada com sucesso!');
        } catch (e) {
          console.error(e);
          showToast('error', 'Não foi possível gerar a chave.');
        } finally {
          btnGenerateGuildKey.disabled = false;
          btnGenerateGuildKey.classList.remove('opacity-50', 'cursor-not-allowed');
        }
      });

      btnCreateGuildProfile?.addEventListener('click', async () => {
        if (!isLeader) return;
        try {
          btnCreateGuildProfile.disabled = true;
          btnCreateGuildProfile.classList.add('opacity-50', 'cursor-not-allowed');
          const result = await createGuildProfile();
          guildProfileExists = true;
          currentGuildProfileExistsForCache = guildProfileExists;
          writeCurrentSettingsCache({ guildProfileExists });
          syncGuildKeyButtons(currentGuildKey || '', true, false, guildProfileExists);
          showToast('success', result?.alreadyExists ? 'Perfil da guilda já existia.' : 'Perfil da guilda criado com sucesso!');
        } catch (e) {
          console.error(e);
          showToast('error', 'Não foi possível criar o perfil da guilda.');
        } finally {
          btnCreateGuildProfile.disabled = false;
          btnCreateGuildProfile.classList.remove('opacity-50', 'cursor-not-allowed');
        }
      });

      btnSave.addEventListener('click', async () => {
        if (!isLeader) return;
        if (!freshSettingsLoaded) {
          showToast('info', 'Aguarde o carregamento terminar antes de salvar.');
          return;
        }
        const value = (tagInput.value || '').trim();
        if (!value) {
          showToast('error', 'Digite uma tag antes de salvar.');
          return;
        }

        try {
          await setMemberTagConfig(value);
          upsertMultiGuildSlot(1, { tag: value });
          writeCurrentSettingsCache({ tag: value, multiGuildSlots });
          showToast('success', 'Tag salva com sucesso!');
          hint.textContent = `Tag configurada: "${value}"`;
        } catch (e) {
          console.error(e);
          showToast('error', 'Não foi possível salvar a tag.');
        }
      });

      btnSaveGoals?.addEventListener('click', async () => {
        if (!isLeader) return;
        if (!freshSettingsLoaded) {
          showToast('info', 'Aguarde o carregamento terminar antes de salvar.');
          return;
        }
        const goals = readGoalsFromInputs();

        try {
          await setGuildGoalsConfig(goals);
          applyGoalsToInputs(goals);
          goalsHint.textContent = getGoalsHintText(goals);
          writeCurrentSettingsCache({ goals });
          showToast('success', 'Metas salvas com sucesso!');
        } catch (e) {
          console.error(e);
          showToast('error', 'Não foi possível salvar as metas.');
        }
      });

      btnSaveGuildName?.addEventListener('click', async () => {
        if (!isLeader) return;
        if (!freshSettingsLoaded) {
          showToast('info', 'Aguarde o carregamento terminar antes de salvar.');
          return;
        }
        const value = (guildNameInput?.value || '').trim();
        if (!value) {
          showToast('error', 'Digite o nome da guilda antes de salvar.');
          return;
        }

        try {
          await setGuildNameConfig(value);
          upsertMultiGuildSlot(1, { name: value });
          writeCurrentSettingsCache({ guildName: value, multiGuildSlots });
          guildNameHint.textContent = `Nome atual: ${value}`;
          showToast('success', 'Nome da guilda salvo com sucesso!');
        } catch (e) {
          console.error(e);
          showToast('error', 'Não foi possível salvar o nome da guilda.');
        }
      });
    });
