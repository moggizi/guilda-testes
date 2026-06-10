import { checkAuth, setupSidebar, initIcons, logout, db, showToast, getMemberTagConfig, getGuildGoalsConfig, getGuildContext, getGuildMultiConfig, getVipTier } from '../logic.js';
    import { collection, getDocs, setDoc, doc, deleteDoc, serverTimestamp, query, where, limit, writeBatch } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

    // CARREGA OS ÍCONES IMEDIATAMENTE INDEPENDENTE DE TER DADOS!
    setupSidebar();
    initIcons();

    const MEMBERS_JSON_IMPORT_MAX_BYTES = 3 * 1024 * 1024;
    const MEMBER_BACKUP_FIELDS = [
      'id',
      'visibleId',
      'nick',
      'whatsapp',
      'whatsappCountryCode',
      'contactType',
      'contactValue',
      'contactCountryCode',
      'instagram',
      'discord',
      'guildWar',
      'guildWarMeta',
      'weeklyMeta',
      'weeklyMetaValue',
      'hasTag',
      'playMode',
      'mode',
      'role',
      'status',
      'source',
      'joinDate',
      'warningActive',
      'hasWarning',
      'warningReason',
      'warningPreset',
      'warningAt',
      'advertencia',
      'advertenciaMotivo',
      'advertenciaAt'
    ];

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

    function readJsonFile(file, maxBytes = MEMBERS_JSON_IMPORT_MAX_BYTES) {
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
          reject(new Error('Esse JSON esta grande demais. Exporte novamente somente os dados desta tela.'));
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

    function backupBoolean(value, fallback = false) {
      if (typeof value === 'boolean') return value;
      const raw = String(value ?? '').toLowerCase().trim();
      if (['sim', 'true', '1', 'yes'].includes(raw)) return true;
      if (['nao', 'não', 'false', '0', 'no'].includes(raw)) return false;
      return fallback;
    }

    function backupNumber(value, fallback = 0) {
      const n = Number(value);
      if (!Number.isFinite(n) || n < 0) return fallback;
      return Math.floor(n);
    }

    function backupString(value, max = 120) {
      return String(value ?? '').trim().slice(0, max);
    }

    const MEMBER_CONTACT_TYPES = {
      whatsapp: { label: 'WhatsApp', brandClass: 'fa-whatsapp', placeholder: 'DDD + número' },
      instagram: { label: 'Instagram', brandClass: 'fa-instagram', placeholder: 'nome.de.usuario' },
      discord: { label: 'Discord', brandClass: 'fa-discord', placeholder: 'nome_de_usuario' }
    };
    const MEMBER_CONTACT_COUNTRIES = [
      { code: '55', flag: '🇧🇷', label: 'Brasil', maxDigits: 11, placeholder: 'DDD + número' },
      { code: '1', flag: '🇺🇸', label: 'Estados Unidos', maxDigits: 10, placeholder: 'Área + número' },
      { code: '54', flag: '🇦🇷', label: 'Argentina', maxDigits: 10, placeholder: 'Área + número' },
      { code: '351', flag: '🇵🇹', label: 'Portugal', maxDigits: 9, placeholder: 'Número' },
      { code: '52', flag: '🇲🇽', label: 'México', maxDigits: 10, placeholder: 'Área + número' },
      { code: '595', flag: '🇵🇾', label: 'Paraguai', maxDigits: 10, placeholder: 'Área + número' },
      { code: '56', flag: '🇨🇱', label: 'Chile', maxDigits: 9, placeholder: 'Número' },
      { code: '57', flag: '🇨🇴', label: 'Colômbia', maxDigits: 10, placeholder: 'Número' },
      { code: '51', flag: '🇵🇪', label: 'Peru', maxDigits: 9, placeholder: 'Número' }
    ];
    const DEFAULT_MEMBER_CONTACT_COUNTRY = '55';

    function memberContactDigits(value) {
      return String(value ?? '').replace(/\D+/g, '');
    }

    function normalizeMemberContactType(value, member = {}) {
      const type = String(value || '').trim().toLowerCase();
      if (MEMBER_CONTACT_TYPES[type]) return type;
      if (member.instagram) return 'instagram';
      if (member.discord) return 'discord';
      return 'whatsapp';
    }

    function getMemberContactCountry(code) {
      const wanted = memberContactDigits(code || DEFAULT_MEMBER_CONTACT_COUNTRY);
      return MEMBER_CONTACT_COUNTRIES.find((country) => country.code === wanted) || MEMBER_CONTACT_COUNTRIES[0];
    }

    function cleanMemberContactUsername(value, type) {
      let clean = String(value || '').trim();
      clean = clean.replace(/^https?:\/\/(www\.)?instagram\.com\//i, '');
      clean = clean.replace(/^https?:\/\/(www\.)?discord(?:app)?\.com\/users\//i, '');
      clean = clean.replace(/^@+/, '').replace(/[/?#].*$/, '');
      if (type === 'instagram') return clean.replace(/[^a-zA-Z0-9._]/g, '').slice(0, 30);
      return clean.replace(/[^a-zA-Z0-9._]/g, '').slice(0, 32);
    }

    function getMemberContactData(member = {}) {
      const type = normalizeMemberContactType(member.contactType, member);
      const countryCode = memberContactDigits(
        member.contactCountryCode || member.whatsappCountryCode || DEFAULT_MEMBER_CONTACT_COUNTRY
      ) || DEFAULT_MEMBER_CONTACT_COUNTRY;
      const rawValue = member.contactValue
        || (type === 'instagram' ? member.instagram : '')
        || (type === 'discord' ? member.discord : '')
        || member.whatsapp
        || member.phone
        || '';
      let value = type === 'whatsapp'
        ? memberContactDigits(rawValue)
        : cleanMemberContactUsername(rawValue, type);
      if (type === 'whatsapp') {
        const country = getMemberContactCountry(countryCode);
        if (value.startsWith(country.code) && value.length > country.maxDigits) {
          value = value.slice(country.code.length);
        }
        value = value.slice(0, country.maxDigits);
      }

      return { type, value, countryCode };
    }

    function buildMemberContactPayload(typeValue, rawValue, countryValue) {
      const type = normalizeMemberContactType(typeValue);
      const country = getMemberContactCountry(countryValue);
      const value = type === 'whatsapp'
        ? memberContactDigits(rawValue).slice(0, country.maxDigits)
        : cleanMemberContactUsername(rawValue, type);

      return {
        type,
        value,
        countryCode: country.code,
        valid: type === 'whatsapp'
          ? value.length === country.maxDigits
          : value.length >= 2,
        country
      };
    }

    function getMemberContactLabel(member = {}) {
      const contact = getMemberContactData(member);
      if (!contact.value) return '-';
      if (contact.type === 'whatsapp') return `+${contact.countryCode} ${contact.value}`;
      return `@${contact.value}`;
    }

    function getMemberContactHref(member = {}) {
      const contact = getMemberContactData(member);
      if (!contact.value) return '';
      if (contact.type === 'whatsapp') return `https://wa.me/${contact.countryCode}${contact.value}`;
      if (contact.type === 'instagram') return `https://instagram.com/${encodeURIComponent(contact.value)}`;
      return /^\d{15,22}$/.test(contact.value)
        ? `https://discord.com/users/${contact.value}`
        : 'https://discord.com/app';
    }

    function renderMemberContactLink(member = {}, className = 'text-emerald-600 text-xs hover:underline') {
      const contact = getMemberContactData(member);
      if (!contact.value) return '<span class="text-xs text-gray-400">-</span>';
      const href = getMemberContactHref(member);
      const label = getMemberContactLabel(member);
      const discordCopy = contact.type === 'discord' && !/^\d{15,22}$/.test(contact.value)
        ? ` onclick="copyDiscordContact(event, '${escapeHtml(contact.value)}')"`
        : '';
      const brandClass = MEMBER_CONTACT_TYPES[contact.type]?.brandClass || 'fa-link';
      return `<a href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer"${discordCopy} class="${className} inline-flex items-center gap-1.5"><i class="fa-brands ${brandClass}" aria-hidden="true"></i><span>${escapeHtml(label)}</span></a>`;
    }

    function backupPlayModes(value) {
      const list = Array.isArray(value) ? value : (value != null && value !== '' ? [value] : []);
      const clean = list.map(v => backupString(v, 40)).filter(Boolean);
      return clean.length ? clean.slice(0, 8) : null;
    }

    function sanitizeMemberForBackup(member) {
      const out = {};
      MEMBER_BACKUP_FIELDS.forEach((field) => {
        if (member && Object.prototype.hasOwnProperty.call(member, field)) out[field] = member[field];
      });
      out.id = backupString(out.id || member?.visibleId || member?.id, 80);
      out.visibleId = backupString(out.visibleId || out.id, 80);
      out.nick = backupString(out.nick || member?.nickname || '', 80);
      const contact = getMemberContactData(out);
      out.contactType = contact.type;
      out.contactValue = backupString(contact.value, 80);
      out.contactCountryCode = backupString(contact.countryCode, 8);
      out.whatsapp = contact.type === 'whatsapp' ? backupString(contact.value, 32) : '';
      out.whatsappCountryCode = contact.type === 'whatsapp' ? backupString(contact.countryCode, 8) : '';
      out.instagram = contact.type === 'instagram' ? backupString(contact.value, 40) : '';
      out.discord = contact.type === 'discord' ? backupString(contact.value, 40) : '';
      out.guildWar = backupBoolean(out.guildWar, false);
      out.guildWarMeta = backupNumber(out.guildWarMeta, 0);
      out.weeklyMeta = backupBoolean(out.weeklyMeta, false);
      out.weeklyMetaValue = backupNumber(out.weeklyMetaValue, 0);
      out.hasTag = backupBoolean(out.hasTag, false);
      out.playMode = backupPlayModes(out.playMode ?? out.mode);
      out.mode = out.playMode;
      out.joinDate = backupString(out.joinDate || '', 20);
      out.warningActive = backupBoolean(out.warningActive || out.hasWarning || out.advertencia, false);
      out.hasWarning = out.warningActive;
      out.warningReason = backupString(out.warningReason || out.advertenciaMotivo || '', 300);
      if (out.warningReason && !out.warningActive) {
        out.warningActive = true;
        out.hasWarning = true;
      }
      return out;
    }

    function sanitizeImportedMember(raw) {
      if (!raw || typeof raw !== 'object') return null;
      const id = backupString(raw.id || raw.visibleId || raw.playerId || raw.uid, 80);
      const visibleId = backupString(raw.visibleId || raw.id || raw.playerId || raw.uid, 80);
      if (!id || !visibleId || id.includes('/') || visibleId.includes('/')) return null;
      const nick = backupString(raw.nick || raw.nickname || raw.name || 'Sem nick', 80);
      const playMode = backupPlayModes(raw.playMode ?? raw.mode);
      const warningActive = backupBoolean(raw.warningActive || raw.hasWarning || raw.advertencia, false);
      const warningReason = backupString(raw.warningReason || raw.warningPreset || raw.advertenciaMotivo || '', 300);
      const contact = getMemberContactData(raw);
      return {
        id: visibleId,
        visibleId,
        nick,
        contactType: contact.type,
        contactValue: backupString(contact.value, 80),
        contactCountryCode: backupString(contact.countryCode, 8),
        whatsapp: contact.type === 'whatsapp' ? backupString(contact.value, 32) : '',
        whatsappCountryCode: contact.type === 'whatsapp' ? backupString(contact.countryCode, 8) : '',
        instagram: contact.type === 'instagram' ? backupString(contact.value, 40) : '',
        discord: contact.type === 'discord' ? backupString(contact.value, 40) : '',
        guildWar: backupBoolean(raw.guildWar, false),
        guildWarMeta: backupNumber(raw.guildWarMeta, 0),
        weeklyMeta: backupBoolean(raw.weeklyMeta, false),
        weeklyMetaValue: backupNumber(raw.weeklyMetaValue, 0),
        hasTag: backupBoolean(raw.hasTag, false),
        playMode,
        mode: playMode,
        role: backupString(raw.role || (Array.isArray(playMode) ? playMode[0] : ''), 40),
        status: backupString(raw.status || 'ativo', 40),
        source: backupString(raw.source || '', 40),
        joinDate: backupString(raw.joinDate || new Date().toISOString().split('T')[0], 20),
        warningActive: warningActive || !!warningReason,
        hasWarning: warningActive || !!warningReason,
        warningReason,
        warningPreset: backupString(raw.warningPreset || '', 80),
        warningAt: raw.warningAt || null,
        advertencia: warningActive || !!warningReason,
        advertenciaMotivo: warningReason,
        advertenciaAt: raw.advertenciaAt || raw.warningAt || null
      };
    }

    function closeMembersJsonBackupModal() {
      const modal = document.getElementById('members-json-backup-modal');
      if (!modal) return;
      modal.classList.add('hidden');
      modal.classList.remove('flex');
      document.documentElement.classList.remove('overflow-hidden');
    }

    function ensureMembersJsonBackupModal() {
      if (document.getElementById('members-json-backup-modal')) return;
      const modal = document.createElement('div');
      modal.id = 'members-json-backup-modal';
      modal.className = 'fixed inset-0 z-[70] hidden items-end sm:items-center justify-center p-0 sm:p-4';
      modal.innerHTML = `
        <div data-json-backup-backdrop class="fixed inset-0 bg-black/50 backdrop-blur-sm"></div>
        <div class="relative w-full sm:max-w-lg rounded-t-3xl sm:rounded-3xl border border-emerald-100 bg-white shadow-2xl overflow-hidden">
          <div class="h-1.5 bg-emerald-500"></div>
          <div class="flex items-start justify-between gap-4 p-5 border-b border-gray-100">
            <div class="flex items-start gap-3 min-w-0">
              <span class="inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-emerald-100 bg-emerald-50 text-emerald-700">
                <i data-lucide="database-backup" class="w-6 h-6"></i>
              </span>
              <div class="min-w-0">
                <h3 class="text-lg font-black text-gray-900">Backup em JSON</h3>
                <p class="mt-1 text-xs font-semibold leading-relaxed text-gray-500">
                  Baixe os membros desta guilda ou importe um arquivo gerado por esta mesma tela.
                </p>
              </div>
            </div>
            <button type="button" data-json-backup-close class="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-gray-200 text-gray-500 hover:bg-gray-50" aria-label="Fechar backup">
              <i data-lucide="x" class="w-5 h-5"></i>
            </button>
          </div>
          <div class="p-5 space-y-4">
            <div class="rounded-2xl border border-emerald-100 bg-emerald-50 p-4 text-xs font-semibold leading-relaxed text-gray-700">
              A importacao atualiza membros com o mesmo ID e adiciona novos membros. Ela nao apaga ninguem e bloqueia arquivos de outra tela, outra guilda ou outra lista.
            </div>
            <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <button id="btn-export-members-json" type="button" class="inline-flex items-center justify-center gap-2 rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm font-black text-gray-700 hover:bg-gray-50">
                <i data-lucide="download" class="w-4 h-4"></i>
                Exportar JSON
              </button>
              <button id="btn-import-members-json" type="button" class="inline-flex items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 py-3 text-sm font-black text-white shadow-sm hover:bg-emerald-700">
                <i data-lucide="upload" class="w-4 h-4"></i>
                Importar JSON
              </button>
              <input id="input-import-members-json" type="file" accept=".json,application/json" class="hidden" />
            </div>
          </div>
        </div>
      `;
      document.body.appendChild(modal);
      modal.querySelector('[data-json-backup-close]')?.addEventListener('click', closeMembersJsonBackupModal);
      modal.querySelector('[data-json-backup-backdrop]')?.addEventListener('click', closeMembersJsonBackupModal);
      modal.querySelector('#btn-export-members-json')?.addEventListener('click', exportMembersJson);
      modal.querySelector('#btn-import-members-json')?.addEventListener('click', () => {
        modal.querySelector('#input-import-members-json')?.click();
      });
      modal.querySelector('#input-import-members-json')?.addEventListener('change', async (event) => {
        const input = event.currentTarget;
        try { await importMembersJson(input.files?.[0]); }
        finally { if (input) input.value = ''; }
      });
      initIcons();
    }

    function openMembersJsonBackupModal() {
      ensureMembersJsonBackupModal();
      const modal = document.getElementById('members-json-backup-modal');
      if (!modal) return;
      modal.classList.remove('hidden');
      modal.classList.add('flex');
      document.documentElement.classList.add('overflow-hidden');
      initIcons();
    }

    function mountMembersJsonBackupPanel() {
      if (document.getElementById('members-json-backup-panel')) return;
      const list = document.getElementById('members-list');
      const parent = list?.parentElement;
      if (!parent) return;

      const panel = document.createElement('section');
      panel.id = 'members-json-backup-panel';
      panel.className = 'mb-4 flex justify-end';
      panel.innerHTML = `
        <button id="btn-open-members-json-backup" type="button" class="inline-flex items-center justify-center gap-2 rounded-xl border border-emerald-200 bg-white px-4 py-3 text-sm font-black text-gray-700 shadow-sm hover:bg-emerald-50 hover:text-emerald-700 transition">
          <span class="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-50 text-emerald-700">
            <i data-lucide="database-backup" class="w-4 h-4"></i>
          </span>
          Backup JSON
        </button>
      `;
      parent.insertBefore(panel, list);
      ensureMembersJsonBackupModal();
      document.getElementById('btn-open-members-json-backup')?.addEventListener('click', openMembersJsonBackupModal);
      initIcons();
    }

    function exportMembersJson() {
      const ctx = getGuildContext();
      if (!ctx?.guildId) {
        showToast('error', 'A guilda ainda nao foi carregada.');
        return;
      }
      const collectionName = __membersCollectionName();
      const payload = {
        app: 'guilda-hub',
        screen: 'membros',
        version: 1,
        guildId: ctx.guildId,
        guildName: __currentGuildDisplayName(),
        slot: currentGuildSlot,
        collection: collectionName,
        exportedAt: new Date().toISOString(),
        data: {
          goals: normalizeGoalsFromAnySource(guildGoals || {}),
          members: (membersCache || []).map(sanitizeMemberForBackup)
        }
      };
      downloadJsonFile(`guilda-membros-${ctx.guildId}-${collectionName}.json`, payload);
      showToast('success', 'JSON dos membros baixado.');
    }

    async function importMembersJson(file) {
      const ctx = getGuildContext();
      if (!ctx?.guildId) {
        showToast('error', 'A guilda ainda nao foi carregada.');
        return;
      }
      try {
        const payload = await readJsonFile(file);
        if (!payload || payload.screen !== 'membros' || !Array.isArray(payload?.data?.members)) {
          throw new Error('Esse arquivo nao parece ser um backup da tela de membros.');
        }
        if (payload.guildId && String(payload.guildId) !== String(ctx.guildId)) {
          throw new Error('Esse JSON foi gerado para outra guilda.');
        }
        if (payload.collection && String(payload.collection) !== __membersCollectionName()) {
          throw new Error('Esse JSON pertence a outra lista de membros. Troque a guilda selecionada e tente novamente.');
        }
        const imported = payload.data.members.map(sanitizeImportedMember).filter(Boolean);
        if (!imported.length) throw new Error('Nao encontrei nenhum membro valido dentro desse JSON.');

        const ok = window.confirm(`Importar ${imported.length} membro(s)? Membros com o mesmo ID serao atualizados, mas nada sera apagado.`);
        if (!ok) return;

        const collectionName = __membersCollectionName();
        for (let i = 0; i < imported.length; i += 400) {
          const batch = writeBatch(db);
          imported.slice(i, i + 400).forEach((member) => {
            const { id, ...data } = member;
            batch.set(doc(db, 'guildas', ctx.guildId, collectionName, id), {
              ...data,
              updatedAt: serverTimestamp()
            }, { merge: true });
          });
          await batch.commit();
        }

        const merged = new Map((membersCache || []).map(item => [String(item.id || item.visibleId || ''), item]));
        imported.forEach((member) => merged.set(String(member.id), { ...(merged.get(String(member.id)) || {}), ...member, updatedAt: Date.now() }));
        __setMembersCache(Array.from(merged.values()));
        showToast('success', 'JSON importado nos membros.');
      } catch (err) {
        console.error(err);
        showToast('error', err?.message || 'Nao foi possivel importar o JSON.');
      }
    }

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
    let historyCache = [];
    let historyMetaCache = null;
    let historyCacheHydrated = false;
    let historyLoadedOnce = false;
    let historyToastShown = false;

    const SETTINGS_SCREEN_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
    const HISTORY_MAX_ITEMS = 500;
    const HISTORY_META_DOC_ID = 'history_meta';
    const HISTORY_CLEANUP_DELAY_MS = 3 * 24 * 60 * 60 * 1000;
    const HISTORY_WARNING_TOAST_MS = 4500;
    const HISTORY_PLANS_CACHE_KEY = 'membersHistoryPlansCache_v1';
    const HISTORY_PLANS_CACHE_TTL_MS = 60 * 60 * 1000;
    const SHARED_PLANS_CACHE_KEYS = ['plans_upgrade_cache_v3', 'hub_ceo_plans_v2'];
    const DEFAULT_HISTORY_PLANS = [
      { id: 'free', price: 0, active: true, visible: true },
      { id: 'plus', price: 6.99, active: true, visible: true },
      { id: 'pro', price: 9.99, active: true, visible: true },
      { id: 'business', price: 99.9, active: true, visible: true },
      { id: 'ultra', price: 14.99, active: true, visible: true },
      { id: 'parceiro', price: 0, active: true, visible: true }
    ];
    const VIP_TIER_SCORE = {
      free: 0,
      plus: 1,
      pro: 2,
      business: 3,
      ultra: 4,
      parceiro: 5
    };
    let historyPlansCache = null;
    let historyPlansLoadPromise = null;

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
      if (s.includes('vital') || s.includes('life') || s.includes('parceiro') || s.includes('partner')) return 'parceiro';
      if (s.includes('ultra')) return 'ultra';
      if (s.includes('buss') || s.includes('business')) return 'business';
      if (s.includes('pro')) return 'pro';
      if (s.includes('plus')) return 'plus';
      if (s.includes('free') || s.includes('gratuito')) return 'free';
      return s || 'free';
    }

    function __planField(data = {}, names = [], fallback = undefined) {
      for (const name of names) {
        if (Object.prototype.hasOwnProperty.call(data || {}, name) && data[name] !== undefined) return data[name];
      }
      return fallback;
    }

    function __planBoolField(data = {}, names = [], fallback = true) {
      const value = __planField(data, names, undefined);
      if (value === undefined || value === null || value === '') return fallback;
      if (typeof value === 'boolean') return value;
      const s = String(value).toLowerCase().trim();
      if (['1', 'true', 'sim', 'yes', 'ativo', 'enabled'].includes(s)) return true;
      if (['0', 'false', 'nao', 'não', 'no', 'inativo', 'disabled'].includes(s)) return false;
      return fallback;
    }

    function __planMoney(value, fallback = 0) {
      if (typeof value === 'number' && Number.isFinite(value)) return value;
      const clean = String(value ?? '')
        .replace(/[^0-9,.-]/g, '')
        .replace(/\.(?=\d{3}(\D|$))/g, '')
        .replace(',', '.');
      const parsed = Number(clean);
      return Number.isFinite(parsed) ? parsed : fallback;
    }

    function __isHistoryAddonDoc(id, data = {}) {
      const type = String(__planField(data, ['type', 'tipo', 'kind'], '') || '').toLowerCase();
      const s = String(id || '').toLowerCase();
      return type.includes('adicional') || type.includes('addon') || type.includes('extra') || s.includes('adicional') || s.includes('addon') || s.includes('extra');
    }

    function __normalizePlanIdForHistory(value) {
      const s = String(value || '').toLowerCase().trim();
      if (!s) return 'free';
      if (s.includes('vital') || s.includes('life') || s.includes('parceiro') || s.includes('partner')) return 'parceiro';
      if (s.includes('ultra')) return 'ultra';
      if (s.includes('buss') || s.includes('business') || s.includes('anual')) return 'business';
      if (s.includes('pro')) return 'pro';
      if (s.includes('plus')) return 'plus';
      if (s.includes('free') || s.includes('gratuito')) return 'free';
      return s.replace(/[^a-z0-9_-]/g, '');
    }

    function __sanitizeHistoryPlan(id, data = {}) {
      const planId = __normalizePlanIdForHistory(data.id || id);
      if (!planId || __isHistoryAddonDoc(id, data)) return null;
      const defaultPlan = DEFAULT_HISTORY_PLANS.find((item) => item.id === planId) || { id: planId, price: 0, active: true, visible: true };
      return {
        id: planId,
        sourceId: String(data.sourceId || id || planId),
        price: __planMoney(__planField(data, ['price', 'preco', 'valor', 'amount'], defaultPlan.price), defaultPlan.price),
        active: __planBoolField(data, ['active', 'ativo', 'enabled'], defaultPlan.active !== false),
        visible: __planBoolField(data, ['visible', 'visivel', 'show', 'mostrar'], defaultPlan.visible !== false)
      };
    }

    function __mergeHistoryPlans(plans = []) {
      const map = new Map(DEFAULT_HISTORY_PLANS.map((plan) => [plan.id, { ...plan }]));
      (Array.isArray(plans) ? plans : []).forEach((raw) => {
        const plan = __sanitizeHistoryPlan(raw?.id || raw?.sourceId, raw || {});
        if (!plan) return;
        map.set(plan.id, { ...(map.get(plan.id) || {}), ...plan });
      });
      return Array.from(map.values());
    }

    function __readHistoryPlansFromStorageKey(key) {
      try {
        const raw = __safeStorageGet(key);
        const parsed = raw ? JSON.parse(raw) : null;
        if (!parsed || !Array.isArray(parsed.plans)) return null;
        if (Date.now() - Number(parsed.ts || 0) > HISTORY_PLANS_CACHE_TTL_MS) return null;
        return __mergeHistoryPlans(parsed.plans);
      } catch (_) {
        return null;
      }
    }

    function __writeHistoryPlansCache(plans = []) {
      historyPlansCache = __mergeHistoryPlans(plans);
      __safeStorageSet(HISTORY_PLANS_CACHE_KEY, JSON.stringify({ ts: Date.now(), plans: historyPlansCache }));
    }

    function __readHistoryPlansCache() {
      if (Array.isArray(historyPlansCache) && historyPlansCache.length) return historyPlansCache;
      const own = __readHistoryPlansFromStorageKey(HISTORY_PLANS_CACHE_KEY);
      if (own?.length) {
        historyPlansCache = own;
        return historyPlansCache;
      }
      for (const key of SHARED_PLANS_CACHE_KEYS) {
        const shared = __readHistoryPlansFromStorageKey(key);
        if (shared?.length) {
          historyPlansCache = shared;
          __writeHistoryPlansCache(shared);
          return historyPlansCache;
        }
      }
      historyPlansCache = __mergeHistoryPlans([]);
      return historyPlansCache;
    }

    async function __ensureHistoryPlansCache(force = false) {
      if (!force) {
        const cached = __readHistoryPlansCache();
        if (cached?.length && __readHistoryPlansFromStorageKey(HISTORY_PLANS_CACHE_KEY)) return cached;
      }
      if (historyPlansLoadPromise) return historyPlansLoadPromise;

      historyPlansLoadPromise = (async () => {
        try {
          const snap = await getDocs(collection(db, 'planos'));
          const plans = [];
          snap.forEach((docSnap) => {
            const raw = docSnap.data() || {};
            const plan = __sanitizeHistoryPlan(docSnap.id, raw);
            if (plan) plans.push(plan);
          });
          __writeHistoryPlansCache(plans);
        } catch (err) {
          console.warn('Falha ao carregar planos para historico:', err);
          __readHistoryPlansCache();
        } finally {
          historyPlansLoadPromise = null;
        }
        return historyPlansCache || __mergeHistoryPlans([]);
      })();

      return historyPlansLoadPromise;
    }

    function __readCachedGuildContextRaw() {
      try {
        const raw = __safeStorageGet('guildCtx_cache_v1');
        return raw ? (JSON.parse(raw) || null) : null;
      } catch (_) {
        return null;
      }
    }

    function __getRawVipTierFast() {
      const ctx = getGuildContext?.() || {};
      const cachedCtx = __readCachedGuildContextRaw() || {};
      return ctx.vipTier || cachedCtx.vipTier || getVipTier?.() || 'free';
    }

    function __getCachedVipTierFast() {
      return normalizeVipTierClient(__getRawVipTierFast());
    }

    function __getVipTierScore(vipTier = __getCachedVipTierFast()) {
      const normalized = normalizeVipTierClient(vipTier);
      return Number(VIP_TIER_SCORE[normalized] ?? 0);
    }

    function __canUseMultiGuildFromCache() {
      return ['pro', 'business', 'ultra', 'parceiro'].includes(__getCachedVipTierFast());
    }

    function __canUsePrintScannerFromCache() {
      return ['pro', 'business', 'ultra', 'parceiro'].includes(__getCachedVipTierFast());
    }

    function __findHistoryPlanById(planId) {
      const id = __normalizePlanIdForHistory(planId);
      const plans = __readHistoryPlansCache();
      return (plans || []).find((plan) => __normalizePlanIdForHistory(plan.id || plan.sourceId) === id) || null;
    }

    function __canUseHistoryFromCache() {
      const planId = __normalizePlanIdForHistory(__getRawVipTierFast());
      if (planId === 'parceiro') return true;
      if (planId === 'ultra') return true;

      const ultraPlan = __findHistoryPlanById('ultra');
      const currentPlan = __findHistoryPlanById(planId);
      const ultraPrice = Number(ultraPlan?.price || 0);
      const currentPrice = Number(currentPlan?.price || 0);

      if (ultraPrice > 0 && currentPlan && currentPlan.active !== false && currentPlan.visible !== false) {
        return currentPrice >= ultraPrice;
      }

      return __getVipTierScore(planId) >= VIP_TIER_SCORE.ultra;
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

    function __syncHistoryAccessState() {
      const btn = document.getElementById('btn-open-history');
      if (!btn) return;
      btn.classList.remove('hidden');
      btn.disabled = false;
      btn.setAttribute('aria-disabled', 'false');
      btn.title = __canUseHistoryFromCache()
        ? 'Ver historico de membros'
        : 'Disponivel no plano ULTRA ou superior';
    }

    function canShowPrintUpgradeSuggestion(vipTier = __getCachedVipTierFast()) {
      const tier = normalizeVipTierClient(vipTier);
      return tier === 'free' || tier === 'plus';
    }

    function mountPrintUpgradeSuggestion() {
      if (document.getElementById('print-upgrade-suggestion')) return;
      const list = document.getElementById('members-list');
      const parent = list?.parentElement;
      if (!parent) return;

      const panel = document.createElement('section');
      panel.id = 'print-upgrade-suggestion';
      panel.className = 'hidden mb-4 overflow-hidden rounded-2xl border border-emerald-200 bg-white p-4 shadow-sm';
      panel.innerHTML = `
        <div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div class="min-w-0 flex items-start gap-3">
            <span class="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-700 border border-emerald-100">
              <i data-lucide="scan-line" class="w-5 h-5"></i>
            </span>
            <div class="min-w-0">
              <div class="flex flex-wrap items-center gap-2">
                <h3 class="text-sm font-black text-slate-900">Automatize pontuacoes por print</h3>
                <span class="inline-flex items-center rounded-full border border-emerald-100 bg-emerald-50 px-2 py-0.5 text-[10px] font-black uppercase tracking-wide text-emerald-700">PRO</span>
              </div>
              <p class="mt-1 text-xs font-semibold leading-relaxed text-slate-600">
                No plano PRO, voce envia o print e a IA preenche GG e honras automaticamente para economizar tempo na rotina da guilda.
              </p>
            </div>
          </div>
          <a href="/upgrade" class="inline-flex shrink-0 items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 py-2.5 text-xs font-black text-white shadow-sm hover:bg-emerald-700">
            <i data-lucide="sparkles" class="w-4 h-4"></i>
            Ver plano PRO
          </a>
        </div>`;
      const backupPanel = document.getElementById('members-json-backup-panel');
      parent.insertBefore(panel, backupPanel?.nextSibling || list);
      initIcons();
    }

    function syncPrintUpgradeSuggestion(vipTier = __getCachedVipTierFast()) {
      mountPrintUpgradeSuggestion();
      const panel = document.getElementById('print-upgrade-suggestion');
      if (!panel) return;
      panel.classList.toggle('hidden', !canShowPrintUpgradeSuggestion(vipTier));
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
        __syncHistoryAccessState();
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

    function __historyLsKey() {
      const gid = getGuildContext()?.guildId;
      return gid ? `membersHistory_${gid}` : 'membersHistory';
    }

    function __historyMetaLsKey() {
      const gid = getGuildContext()?.guildId;
      return gid ? `membersHistoryMeta_${gid}` : 'membersHistoryMeta';
    }

    function __historyCollectionRef() {
      const guildId = getGuildContext()?.guildId;
      return guildId ? collection(db, 'guildas', guildId, 'historico') : null;
    }

    function __historyDocRef(docId) {
      const guildId = getGuildContext()?.guildId;
      const cleanId = String(docId || '').trim();
      return guildId && cleanId ? doc(db, 'guildas', guildId, 'historico', cleanId) : null;
    }

    function __historyDocIdFromMember(member = {}) {
      return backupString(member.visibleId || member.id || member.playerId || '', 80);
    }

    function __sortHistoryList(list = []) {
      return [...(Array.isArray(list) ? list : [])].sort((a, b) => {
        const diff = Number(b?.removedAtMs || 0) - Number(a?.removedAtMs || 0);
        if (diff !== 0) return diff;
        return String(a?.nick || a?.lastNick || '').localeCompare(String(b?.nick || b?.lastNick || ''));
      });
    }

    function __toMillis(value, fallback = 0) {
      try {
        if (typeof value === 'number' && Number.isFinite(value)) return value;
        if (typeof value === 'string') {
          const asNumber = Number(value);
          if (Number.isFinite(asNumber) && asNumber > 0) return asNumber;
          const parsed = new Date(value).getTime();
          if (Number.isFinite(parsed) && parsed > 0) return parsed;
        }
        if (value?.toDate && typeof value.toDate === 'function') {
          const parsed = value.toDate().getTime();
          if (Number.isFinite(parsed) && parsed > 0) return parsed;
        }
        if (typeof value?.seconds === 'number') {
          const parsed = Math.floor(Number(value.seconds) * 1000);
          if (Number.isFinite(parsed) && parsed > 0) return parsed;
        }
      } catch (_) {}
      return Number(fallback) || 0;
    }

    function __formatHistoryDate(value) {
      try {
        const millis = __toMillis(value, 0);
        if (!millis) return '';
        return new Intl.DateTimeFormat('pt-BR', {
          dateStyle: 'short',
          timeStyle: 'short'
        }).format(new Date(millis));
      } catch (_) {
        return '';
      }
    }

    function __sanitizeHistoryMeta(raw = {}, totalItems = 0) {
      const cleanupAtMs = __toMillis(raw?.cleanupAtMs || raw?.cleanupAt || raw?.cleanupAfterMs || raw?.cleanupAfter, 0);
      return {
        totalItems: Math.max(0, Math.floor(Number(raw?.totalItems ?? totalItems) || 0)),
        cleanupAtMs: cleanupAtMs || null,
        cleanupAt: cleanupAtMs ? new Date(cleanupAtMs).toISOString() : null,
        lastPlanTier: normalizeVipTierClient(raw?.lastPlanTier || __getCachedVipTierFast()),
        updatedAtMs: __toMillis(raw?.updatedAtMs || raw?.updatedAt, Date.now())
      };
    }

    function __sanitizeHistoryEntry(raw, docId = '') {
      if (!raw || typeof raw !== 'object') return null;
      const visibleId = backupString(docId || raw.visibleId || raw.id || raw.playerId || raw.uid, 80);
      if (!visibleId || visibleId === HISTORY_META_DOC_ID || visibleId.includes('/')) return null;
      const removedAtMs = __toMillis(raw.removedAtMs || raw.removedAt || raw.updatedAt, Date.now());
      const playMode = backupPlayModes(raw.playMode ?? raw.mode);
      const warningActive = backupBoolean(raw.warningActive || raw.hasWarning || raw.advertencia, false);
      const warningReason = backupString(raw.warningReason || raw.advertenciaMotivo || raw.warningPreset || '', 300);
      const removedFromSlot = Math.max(1, Math.min(4, Math.floor(Number(raw.removedFromSlot) || 1)));
      const contact = getMemberContactData(raw);
      return {
        id: visibleId,
        visibleId,
        nick: backupString(raw.nick || raw.lastNick || raw.nickname || 'Sem nick', 80),
        lastNick: backupString(raw.lastNick || raw.nick || raw.nickname || 'Sem nick', 80),
        contactType: contact.type,
        contactValue: backupString(contact.value, 80),
        contactCountryCode: backupString(contact.countryCode, 8),
        whatsapp: contact.type === 'whatsapp' ? backupString(contact.value, 32) : '',
        whatsappCountryCode: contact.type === 'whatsapp' ? backupString(contact.countryCode, 8) : '',
        instagram: contact.type === 'instagram' ? backupString(contact.value, 40) : '',
        discord: contact.type === 'discord' ? backupString(contact.value, 40) : '',
        guildWar: backupBoolean(raw.guildWar, false),
        guildWarMeta: backupNumber(raw.guildWarMeta, 0),
        weeklyMeta: backupBoolean(raw.weeklyMeta, false),
        weeklyMetaValue: backupNumber(raw.weeklyMetaValue, 0),
        hasTag: backupBoolean(raw.hasTag, false),
        playMode,
        mode: playMode,
        role: backupString(raw.role || '', 40),
        status: backupString(raw.status || '', 40),
        source: backupString(raw.source || '', 40),
        joinDate: backupString(raw.joinDate || '', 20),
        warningActive: warningActive || !!warningReason,
        hasWarning: warningActive || !!warningReason,
        warningReason,
        warningPreset: backupString(raw.warningPreset || '', 80),
        warningAt: raw.warningAt || null,
        advertencia: warningActive || !!warningReason,
        advertenciaMotivo: warningReason,
        advertenciaAt: raw.advertenciaAt || raw.warningAt || null,
        removedAtMs,
        removedAt: backupString(raw.removedAt || new Date(removedAtMs).toISOString(), 40),
        removedAtLabel: backupString(raw.removedAtLabel || __formatHistoryDate(removedAtMs), 40),
        removedByEmail: backupString(raw.removedByEmail || '', 120),
        removedByRole: backupString(raw.removedByRole || '', 40),
        removedFromSlot,
        removedFromCollection: backupString(raw.removedFromCollection || __membersCollectionName(removedFromSlot), 20),
        removedFromGuildName: backupString(raw.removedFromGuildName || '', 80),
        historyVersion: 1
      };
    }

    function __serializeHistoryEntry(entry = {}) {
      const payload = { ...(entry || {}) };
      delete payload.id;
      payload.updatedAt = serverTimestamp();
      payload.updatedAtMs = Date.now();
      return payload;
    }

    function __buildHistoryEntryFromMember(member = {}) {
      const historyDocId = __historyDocIdFromMember(member);
      const nowMs = Date.now();
      return __sanitizeHistoryEntry({
        ...member,
        id: historyDocId,
        visibleId: historyDocId,
        lastNick: member.nick || member.lastNick || '',
        removedAtMs: nowMs,
        removedAt: new Date(nowMs).toISOString(),
        removedAtLabel: __formatHistoryDate(nowMs),
        removedByEmail: getGuildContext()?.email || '',
        removedByRole: getGuildContext()?.role || '',
        removedFromSlot: currentGuildSlot,
        removedFromCollection: __membersCollectionName(currentGuildSlot),
        removedFromGuildName: __currentGuildDisplayName(currentGuildSlot)
      }, historyDocId);
    }

    function __buildMemberPayloadFromHistory(entry = {}) {
      const playMode = backupPlayModes(entry.playMode ?? entry.mode);
      const warningActive = backupBoolean(entry.warningActive || entry.hasWarning || entry.advertencia, false);
      const warningReason = backupString(entry.warningReason || entry.advertenciaMotivo || entry.warningPreset || '', 300);
      const contact = getMemberContactData(entry);
      return {
        visibleId: backupString(entry.visibleId || entry.id, 80),
        nick: backupString(entry.lastNick || entry.nick || 'Sem nick', 80),
        contactType: contact.type,
        contactValue: backupString(contact.value, 80),
        contactCountryCode: backupString(contact.countryCode, 8),
        whatsapp: contact.type === 'whatsapp' ? backupString(contact.value, 32) : '',
        whatsappCountryCode: contact.type === 'whatsapp' ? backupString(contact.countryCode, 8) : '',
        instagram: contact.type === 'instagram' ? backupString(contact.value, 40) : '',
        discord: contact.type === 'discord' ? backupString(contact.value, 40) : '',
        guildWar: backupBoolean(entry.guildWar, false),
        guildWarMeta: backupNumber(entry.guildWarMeta, 0),
        weeklyMeta: backupBoolean(entry.weeklyMeta, false),
        weeklyMetaValue: backupNumber(entry.weeklyMetaValue, 0),
        hasTag: backupBoolean(entry.hasTag, false),
        playMode,
        mode: playMode,
        role: backupString(entry.role || '', 40),
        status: backupString(entry.status || 'ativo', 40),
        source: backupString(entry.source || 'historico', 40),
        joinDate: backupString(entry.joinDate || new Date().toISOString().split('T')[0], 20),
        warningActive: warningActive || !!warningReason,
        hasWarning: warningActive || !!warningReason,
        warningReason,
        warningPreset: backupString(entry.warningPreset || '', 80),
        warningAt: entry.warningAt || null,
        advertencia: warningActive || !!warningReason,
        advertenciaMotivo: warningReason,
        advertenciaAt: entry.advertenciaAt || entry.warningAt || null,
        updatedAt: serverTimestamp()
      };
    }

    function __readHistoryFromCache() {
      try {
        const raw = __safeStorageGet(__historyLsKey());
        if (raw == null) return null;
        const list = JSON.parse(raw);
        return Array.isArray(list)
          ? __sortHistoryList(list.map(item => __sanitizeHistoryEntry(item, item?.id || item?.visibleId)).filter(Boolean))
          : null;
      } catch (_) {
        return null;
      }
    }

    function __writeHistoryToCache(list) {
      try {
        __safeStorageSet(__historyLsKey(), JSON.stringify(__sortHistoryList(list)));
      } catch (_) {}
    }

    function __readHistoryMetaFromCache() {
      try {
        const raw = __safeStorageGet(__historyMetaLsKey());
        if (raw == null) return null;
        const parsed = JSON.parse(raw);
        return parsed ? __sanitizeHistoryMeta(parsed, historyCache.length) : null;
      } catch (_) {
        return null;
      }
    }

    function __writeHistoryMetaToCache(meta) {
      try {
        __safeStorageSet(__historyMetaLsKey(), JSON.stringify(meta || null));
      } catch (_) {}
    }

    function __setHistoryCache(list, meta = null) {
      historyCache = __sortHistoryList((Array.isArray(list) ? list : []).map(item => __sanitizeHistoryEntry(item, item?.id || item?.visibleId)).filter(Boolean));
      historyMetaCache = __sanitizeHistoryMeta(meta || historyMetaCache || {}, historyCache.length);
      historyCacheHydrated = true;
      __writeHistoryToCache(historyCache);
      __writeHistoryMetaToCache(historyMetaCache);
      renderHistoryList();
    }

    function __hydrateHistoryFromCacheNow() {
      const cachedList = __readHistoryFromCache();
      const cachedMeta = __readHistoryMetaFromCache();
      if (cachedList === null && cachedMeta === null) return;
      historyCache = __sortHistoryList(cachedList || []);
      historyMetaCache = __sanitizeHistoryMeta(cachedMeta || {}, historyCache.length);
      historyCacheHydrated = true;
    }

    function __syncHistoryEntryInCache(entry) {
      const clean = __sanitizeHistoryEntry(entry, entry?.id || entry?.visibleId);
      if (!clean) return;
      const next = historyCache.filter(item => String(item?.id || '') !== String(clean.id || ''));
      next.push(clean);
      __setHistoryCache(next, {
        ...(historyMetaCache || {}),
        totalItems: next.length
      });
    }

    function __removeHistoryEntryFromCache(historyId) {
      const cleanId = String(historyId || '').trim();
      const next = historyCache.filter(item => String(item?.id || '') !== cleanId);
      __setHistoryCache(next, {
        ...(historyMetaCache || {}),
        totalItems: next.length
      });
    }

    function __upsertMemberCacheBySlot(slot, member) {
      const cleanId = String(member?.id || member?.visibleId || '').trim();
      if (!cleanId) return;
      const next = __readMembersFromCacheBySlot(slot) || [];
      const idx = next.findIndex(item => String(item?.id || '') === cleanId);
      if (idx >= 0) next[idx] = { ...next[idx], ...member };
      else next.push({ ...member, id: cleanId });
      next.sort((a, b) => String(a?.nick || '').localeCompare(String(b?.nick || '')));
      __writeMembersToCacheBySlot(slot, next);
    }

    async function __purgeHistoryCollection(options = {}) {
      const colRef = __historyCollectionRef();
      if (!colRef) return;
      try {
        const snap = await getDocs(colRef);
        if (!snap.empty) {
          const docsToDelete = snap.docs;
          for (let i = 0; i < docsToDelete.length; i += 400) {
            const batch = writeBatch(db);
            docsToDelete.slice(i, i + 400).forEach((item) => batch.delete(item.ref));
            await batch.commit();
          }
        }
        __setHistoryCache([], { totalItems: 0, cleanupAtMs: null, cleanupAt: null, lastPlanTier: __getCachedVipTierFast() });
        if (options.silent !== true) {
          showToast('info', 'O historico desta guilda foi apagado porque a assinatura nao esta ativa.');
        }
      } catch (err) {
        console.error(err);
      }
    }

    async function __applyHistoryRetentionPolicy(options = {}) {
      const hasEntries = Array.isArray(historyCache) && historyCache.length > 0;
      const canUseHistory = __canUseHistoryFromCache();
      const persist = options.persist === true;
      const metaRef = __historyDocRef(HISTORY_META_DOC_ID);
      const metaBase = __sanitizeHistoryMeta(historyMetaCache || {}, historyCache.length);

      if (!hasEntries) {
        historyMetaCache = {
          ...metaBase,
          totalItems: 0,
          cleanupAtMs: null,
          cleanupAt: null,
          lastPlanTier: __getCachedVipTierFast()
        };
        __writeHistoryMetaToCache(historyMetaCache);
        if (persist && metaRef) {
          await setDoc(metaRef, {
            totalItems: 0,
            cleanupAtMs: null,
            cleanupAt: null,
            lastPlanTier: __getCachedVipTierFast(),
            updatedAt: serverTimestamp(),
            updatedAtMs: Date.now()
          }, { merge: true });
        }
        return;
      }

      if (canUseHistory) {
        historyMetaCache = {
          ...metaBase,
          totalItems: historyCache.length,
          cleanupAtMs: null,
          cleanupAt: null,
          lastPlanTier: __getCachedVipTierFast()
        };
        __writeHistoryMetaToCache(historyMetaCache);
        if (persist && metaRef) {
          await setDoc(metaRef, {
            totalItems: historyCache.length,
            cleanupAtMs: null,
            cleanupAt: null,
            lastPlanTier: __getCachedVipTierFast(),
            updatedAt: serverTimestamp(),
            updatedAtMs: Date.now()
          }, { merge: true });
        }
        return;
      }

      let cleanupAtMs = Number(metaBase.cleanupAtMs || 0);
      if (!cleanupAtMs) {
        cleanupAtMs = Date.now() + HISTORY_CLEANUP_DELAY_MS;
      }

      historyMetaCache = {
        ...metaBase,
        totalItems: historyCache.length,
        cleanupAtMs,
        cleanupAt: new Date(cleanupAtMs).toISOString(),
        lastPlanTier: __getCachedVipTierFast()
      };
      __writeHistoryMetaToCache(historyMetaCache);

      if (!historyToastShown) {
        historyToastShown = true;
        showToast('info', 'Seu historico pode ser apagado em ate 3 dias se a assinatura nao estiver ativa.', HISTORY_WARNING_TOAST_MS);
      }

      if (cleanupAtMs <= Date.now()) {
        await __purgeHistoryCollection({ silent: false });
        return;
      }

      if (persist && metaRef) {
        await setDoc(metaRef, {
          totalItems: historyCache.length,
          cleanupAtMs,
          cleanupAt: new Date(cleanupAtMs).toISOString(),
          lastPlanTier: __getCachedVipTierFast(),
          updatedAt: serverTimestamp(),
          updatedAtMs: Date.now()
        }, { merge: true });
      }
    }

    async function __loadHistoryMembers(options = {}) {
      const forceRefresh = options.forceRefresh === true;
      const shouldApplyPolicy = options.applyPolicy !== false;
      const colRef = __historyCollectionRef();

      if (!colRef) {
        __setHistoryCache([], { totalItems: 0 });
        return { items: [], meta: __sanitizeHistoryMeta({}, 0) };
      }

      if (!forceRefresh && historyCacheHydrated) {
        if (shouldApplyPolicy) {
          await __applyHistoryRetentionPolicy({ persist: false });
        }
        return { items: historyCache, meta: historyMetaCache };
      }

      try {
        const snap = await getDocs(colRef);
        const items = [];
        let meta = null;
        snap.forEach((item) => {
          if (item.id === HISTORY_META_DOC_ID) {
            meta = __sanitizeHistoryMeta(item.data() || {}, items.length);
            return;
          }
          const parsed = __sanitizeHistoryEntry(item.data() || {}, item.id);
          if (parsed) items.push(parsed);
        });
        historyLoadedOnce = true;
        __setHistoryCache(items, meta || { totalItems: items.length });
        if (shouldApplyPolicy) {
          await __applyHistoryRetentionPolicy({ persist: true });
        }
        return { items: historyCache, meta: historyMetaCache };
      } catch (err) {
        console.error(err);
        if (!historyCacheHydrated) {
          __setHistoryCache([], { totalItems: 0 });
        }
        return { items: historyCache, meta: historyMetaCache };
      }
    }

    function __historyEntryMatchesSearch(entry, term = '') {
      const normalizedTerm = String(term || '').trim().toLowerCase();
      if (!normalizedTerm) return true;
      const haystack = [
        entry?.nick,
        entry?.lastNick,
        entry?.visibleId,
        entry?.whatsapp,
        entry?.contactValue,
        entry?.instagram,
        entry?.discord,
        entry?.removedAt,
        entry?.removedAtLabel,
        entry?.joinDate,
        entry?.removedFromGuildName
      ].map(value => String(value || '').toLowerCase()).join(' ');
      return haystack.includes(normalizedTerm);
    }

    function renderHistoryList() {
      const modal = document.getElementById('history-modal');
      if (!modal) return;

      const listEl = document.getElementById('history-list');
      const countEl = document.getElementById('history-count');
      const lockedBox = document.getElementById('history-locked-box');
      const bodyBox = document.getElementById('history-body');
      const helperEl = document.getElementById('history-helper-text');
      const emptyEl = document.getElementById('history-empty-state');
      const lockText = document.getElementById('history-locked-copy');
      if (!listEl || !countEl || !lockedBox || !bodyBox || !helperEl || !emptyEl || !lockText) return;

      const canUseHistory = __canUseHistoryFromCache();
      const total = Array.isArray(historyCache) ? historyCache.length : 0;
      const searchEl = document.getElementById('history-search-input');
      const term = String(searchEl?.value || '').trim().toLowerCase();
      const filtered = historyCache.filter(entry => __historyEntryMatchesSearch(entry, term));

      countEl.textContent = `${total}/${HISTORY_MAX_ITEMS} no historico`;
      helperEl.textContent = canUseHistory
        ? 'Pesquise por nick, ID, numero ou data de saida.'
        : 'O historico fica disponivel apenas no plano ULTRA ou superior.';

      lockedBox.classList.toggle('hidden', canUseHistory);
      bodyBox.classList.toggle('hidden', !canUseHistory);
      lockText.textContent = total > 0
        ? 'Existe um historico salvo nesta guilda, mas ele so pode ser gerenciado no plano ULTRA ou superior.'
        : 'O historico de membros fica disponivel apenas no plano ULTRA ou superior.';

      if (!canUseHistory) {
        listEl.innerHTML = '';
        emptyEl.classList.add('hidden');
        initIcons();
        return;
      }

      if (!filtered.length) {
        listEl.innerHTML = '';
        emptyEl.classList.remove('hidden');
        emptyEl.querySelector('[data-empty-history-text]')?.replaceChildren(document.createTextNode(
          total > 0 ? 'Nenhum registro combina com essa busca.' : 'Nenhum membro foi guardado no historico ainda.'
        ));
        initIcons();
        return;
      }

      emptyEl.classList.add('hidden');
      listEl.innerHTML = filtered.map((entry) => `
        <div class="rounded-2xl border border-gray-100 bg-white p-4 shadow-sm">
          <div class="flex items-start gap-3">
            <div class="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-slate-500 to-slate-700 text-sm font-bold text-white">
              ${escapeHtml((entry.lastNick || entry.nick || '?').charAt(0).toUpperCase())}
            </div>
            <div class="min-w-0 flex-1">
              <div class="flex flex-wrap items-center gap-2">
                <p class="truncate text-sm font-bold text-gray-900">${escapeHtml(entry.lastNick || entry.nick || 'Sem nick')}</p>
                <span class="inline-flex items-center rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-slate-600">
                  ${escapeHtml(entry.removedFromGuildName || __currentGuildDisplayName(entry.removedFromSlot || 1))}
                </span>
              </div>
              <p class="mt-1 text-xs text-gray-500">ID: ${escapeHtml(entry.visibleId || '-')} - Saida: ${escapeHtml(entry.removedAtLabel || '-')}</p>
              <p class="mt-1 text-xs text-gray-500">${escapeHtml(MEMBER_CONTACT_TYPES[getMemberContactData(entry).type]?.label || 'Contato')}: ${escapeHtml(getMemberContactLabel(entry))} - Entrada: ${escapeHtml(entry.joinDate || '-')}</p>
            </div>
          </div>
          <div class="mt-4 grid grid-cols-2 gap-2">
            <button type="button" onclick="restoreHistoryMember('${escapeHtml(entry.id)}')" class="rounded-xl border border-emerald-200 px-3 py-2.5 text-sm font-semibold text-emerald-700 hover:bg-emerald-50">
              Adicionar
            </button>
            <button type="button" onclick="deleteHistoryMember('${escapeHtml(entry.id)}')" class="rounded-xl border border-red-200 px-3 py-2.5 text-sm font-semibold text-red-600 hover:bg-red-50">
              Deletar
            </button>
          </div>
        </div>
      `).join('');
      initIcons();
    }

    function __renderRemoveMemberModal() {
      const titleEl = document.getElementById('remove-member-title');
      const descEl = document.getElementById('remove-member-desc');
      const noteEl = document.getElementById('remove-member-history-note');
      const withHistoryBtn = document.getElementById('btn-delete-with-history');
      const withoutHistoryBtn = document.getElementById('btn-delete-no-history');
      const canUseHistory = __canUseHistoryFromCache();
      const member = membersCache.find(x => String(x.id || '') === String(currentDeleteId || ''));

      if (titleEl) titleEl.textContent = 'Remover membro?';
      if (descEl) {
        descEl.innerHTML = member
          ? `Escolha como deseja remover <b>${escapeHtml(member.nick || member.visibleId || 'este membro')}</b> da guilda.`
          : 'Escolha como deseja remover este membro da guilda.';
      }

      if (noteEl) {
        noteEl.className = canUseHistory
          ? 'remove-history-note remove-history-note--available mb-5 rounded-2xl border border-emerald-100 bg-emerald-50/80 p-4 text-sm text-gray-700'
          : 'remove-history-note remove-history-note--locked mb-5 rounded-2xl border border-amber-100 bg-amber-50/80 p-4 text-sm text-gray-700';
        noteEl.innerHTML = canUseHistory
          ? `Voce pode remover e guardar este jogador no historico da guilda. O limite atual e de <b>${HISTORY_MAX_ITEMS} pessoas</b>.`
          : 'Guardar no historico fica disponivel apenas no plano <b>ULTRA ou superior</b>. Sem esse plano, a remocao sera definitiva.';
      }

      if (withHistoryBtn) {
        withHistoryBtn.classList.toggle('hidden', !canUseHistory);
      }

      if (withoutHistoryBtn) {
        withoutHistoryBtn.textContent = canUseHistory ? 'Deletar sem historico' : 'Deletar agora';
      }
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
                <p class="text-xs text-gray-400 mb-1">${escapeHtml(MEMBER_CONTACT_TYPES[getMemberContactData(m).type]?.label || 'Contato')}</p>
                ${renderMemberContactLink(m)}
              </div>
            </div>
            <div class="grid grid-cols-2 sm:grid-cols-5 gap-2 pt-2">
              <button type="button" onclick="event.stopPropagation(); copyMemberData('${m.id}'); return false;" class="py-2.5 rounded-xl border border-gray-200 text-gray-700 text-sm font-medium hover:bg-gray-50">Copiar</button>
              <button type="button" onclick="event.stopPropagation(); editMember('${m.id}'); return false;" class="py-2.5 rounded-xl border border-emerald-200 text-emerald-700 text-sm font-medium hover:bg-emerald-50">Editar</button>
              <button type="button" onclick="event.stopPropagation(); openWarningMemberModal('${m.id}'); return false;" class="py-2.5 rounded-xl border ${hasMemberWarning(m) ? 'border-amber-300 bg-amber-50 text-amber-700 hover:bg-amber-100' : 'border-amber-200 text-amber-600 hover:bg-amber-50'} text-sm font-medium">${hasMemberWarning(m) ? 'Ver advert.' : 'Advertir'}</button>
              <button type="button" onclick="event.stopPropagation(); moveMember('${m.id}'); return false;" class="py-2.5 rounded-xl border border-blue-200 text-blue-600 text-sm font-medium hover:bg-blue-50">Mover</button>
              <button type="button" onclick="event.stopPropagation(); deleteMember('${m.id}'); return false;" class="py-2.5 rounded-xl border border-red-200 text-red-500 text-sm font-medium hover:bg-red-50">Remover</button>
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
            printScannerLoadPromise = import('./printmembros.js?v=gemini-fallback-v1')
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

    function closeMemberContactMenus(exceptId = '') {
      ['contact-type-menu', 'contact-country-menu'].forEach((id) => {
        if (id === exceptId) return;
        document.getElementById(id)?.classList.add('hidden');
        const buttonId = id === 'contact-type-menu' ? 'contact-type-button' : 'contact-country-button';
        document.getElementById(buttonId)?.setAttribute('aria-expanded', 'false');
      });
    }

    function setMemberContactType(typeValue, preserveValue = false) {
      const type = normalizeMemberContactType(typeValue);
      const meta = MEMBER_CONTACT_TYPES[type];
      const typeInput = document.getElementById('contact-type');
      const valueInput = document.getElementById('contact-value');
      const countryWrap = document.getElementById('contact-country-wrap');
      const valueWrap = document.getElementById('contact-value-wrap');
      const label = document.getElementById('contact-type-label');
      const icon = document.getElementById('contact-type-icon');
      const help = document.getElementById('contact-help');

      if (typeInput) typeInput.value = type;
      if (label) label.textContent = meta.label;
      if (icon) icon.className = `fa-brands ${meta.brandClass} contact-brand-icon text-emerald-600`;
      if (!preserveValue && valueInput) valueInput.value = '';
      if (countryWrap) countryWrap.classList.toggle('hidden', type !== 'whatsapp');
      if (valueWrap) valueWrap.className = type === 'whatsapp'
        ? 'mt-2 grid grid-cols-[118px_minmax(0,1fr)] gap-2'
        : 'mt-2 grid grid-cols-1 gap-2';

      if (valueInput) {
        valueInput.inputMode = type === 'whatsapp' ? 'numeric' : 'text';
        valueInput.maxLength = type === 'instagram' ? 30 : type === 'discord' ? 32 : getMemberContactCountry(document.getElementById('contact-country-code')?.value).maxDigits;
        valueInput.placeholder = type === 'instagram'
          ? '@usuario ou usuario'
          : type === 'discord'
            ? '@usuario ou usuario'
            : `${getMemberContactCountry(document.getElementById('contact-country-code')?.value).placeholder}`;
      }
      if (help) {
        help.textContent = type === 'whatsapp'
          ? 'Informe o DDD e o número do WhatsApp.'
          : type === 'instagram'
            ? 'Digite somente o nome de usuário do Instagram.'
            : 'Digite o usuário do Discord. Ao abrir, o nome será copiado para facilitar a busca.';
      }

      document.querySelectorAll('[data-member-contact-type]').forEach((option) => {
        option.classList.toggle('is-selected', option.getAttribute('data-member-contact-type') === type);
      });
      syncMemberContactInput();
      closeMemberContactMenus();
    }

    function setMemberContactCountry(countryCode) {
      const country = getMemberContactCountry(countryCode);
      const input = document.getElementById('contact-country-code');
      const label = document.getElementById('contact-country-label');
      if (input) input.value = country.code;
      if (label) label.textContent = `${country.flag} +${country.code}`;
      document.querySelectorAll('[data-member-country-code]').forEach((option) => {
        option.classList.toggle('is-selected', option.getAttribute('data-member-country-code') === country.code);
      });
      syncMemberContactInput();
      closeMemberContactMenus();
    }

    function syncMemberContactInput() {
      const type = normalizeMemberContactType(document.getElementById('contact-type')?.value);
      const valueInput = document.getElementById('contact-value');
      const whatsappInput = document.getElementById('whatsapp');
      if (!valueInput) return;

      if (type === 'whatsapp') {
        const country = getMemberContactCountry(document.getElementById('contact-country-code')?.value);
        let digits = memberContactDigits(valueInput.value);
        if (digits.startsWith(country.code) && digits.length > country.maxDigits) {
          digits = digits.slice(country.code.length);
        }
        valueInput.value = digits.slice(0, country.maxDigits);
        valueInput.maxLength = country.maxDigits;
        valueInput.placeholder = `${country.placeholder} (${country.maxDigits} dígitos)`;
        if (whatsappInput) whatsappInput.value = valueInput.value;
      } else {
        valueInput.value = cleanMemberContactUsername(valueInput.value, type);
        if (whatsappInput) whatsappInput.value = '';
      }
    }

    function setMemberContactForm(member = {}) {
      const contact = getMemberContactData(member);
      setMemberContactCountry(contact.countryCode);
      setMemberContactType(contact.type, true);
      const valueInput = document.getElementById('contact-value');
      if (valueInput) valueInput.value = contact.value;
      syncMemberContactInput();
    }

    function readMemberContactForm() {
      return buildMemberContactPayload(
        document.getElementById('contact-type')?.value,
        document.getElementById('contact-value')?.value,
        document.getElementById('contact-country-code')?.value
      );
    }

    function initMemberContactPicker() {
      const typeButton = document.getElementById('contact-type-button');
      const countryButton = document.getElementById('contact-country-button');
      const valueInput = document.getElementById('contact-value');
      if (!typeButton || typeButton.dataset.bound === '1') return;
      typeButton.dataset.bound = '1';

      typeButton.addEventListener('click', (event) => {
        event.preventDefault();
        const menu = document.getElementById('contact-type-menu');
        if (!menu) return;
        const opening = menu.classList.contains('hidden');
        closeMemberContactMenus(opening ? 'contact-type-menu' : '');
        menu.classList.toggle('hidden', !opening);
        typeButton.setAttribute('aria-expanded', opening ? 'true' : 'false');
      });
      countryButton?.addEventListener('click', (event) => {
        event.preventDefault();
        const menu = document.getElementById('contact-country-menu');
        if (!menu) return;
        const opening = menu.classList.contains('hidden');
        closeMemberContactMenus(opening ? 'contact-country-menu' : '');
        menu.classList.toggle('hidden', !opening);
        countryButton.setAttribute('aria-expanded', opening ? 'true' : 'false');
      });
      document.getElementById('contact-type-menu')?.addEventListener('click', (event) => {
        const option = event.target.closest('[data-member-contact-type]');
        if (option) setMemberContactType(option.getAttribute('data-member-contact-type'));
      });
      document.getElementById('contact-country-menu')?.addEventListener('click', (event) => {
        const option = event.target.closest('[data-member-country-code]');
        if (option) setMemberContactCountry(option.getAttribute('data-member-country-code'));
      });
      valueInput?.addEventListener('input', syncMemberContactInput);
      valueInput?.addEventListener('paste', () => setTimeout(syncMemberContactInput, 0));
      document.addEventListener('click', (event) => {
        if (!event.target.closest('.contact-dd')) closeMemberContactMenus();
      });
      setMemberContactForm({});
    }

    window.copyDiscordContact = async (event, username) => {
      try {
        await navigator.clipboard.writeText(String(username || ''));
        showToast('success', 'Usuário do Discord copiado. Cole na busca do Discord.');
      } catch (_) {
        showToast('info', `Usuário do Discord: ${String(username || '')}`);
      }
      return true;
    };


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
      setMemberContactForm({});
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
      setMemberContactForm(m);
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
        `${MEMBER_CONTACT_TYPES[getMemberContactData(member).type]?.label || 'Contato'}: ${getMemberContactLabel(member)}`,
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

    function __setRemoveMemberBusy(isBusy, label = '') {
      ['btn-delete-with-history', 'btn-delete-no-history'].forEach((id) => {
        const btn = document.getElementById(id);
        if (!btn) return;
        btn.disabled = !!isBusy;
        btn.classList.toggle('opacity-60', !!isBusy);
        btn.classList.toggle('cursor-wait', !!isBusy);
      });
      const noHistoryBtn = document.getElementById('btn-delete-no-history');
      if (noHistoryBtn) noHistoryBtn.textContent = isBusy ? (label || 'Removendo...') : (__canUseHistoryFromCache() ? 'Deletar sem historico' : 'Deletar agora');
    }

    function __removeMemberFromCurrentCache(id) {
      membersCache = (membersCache || []).filter(member => String(member.id || '') !== String(id || ''));
      __setMembersCache(membersCache);
    }

    async function __deleteMemberWithoutHistory(id, member) {
      await deleteDoc(doc(db, "guildas", getGuildContext().guildId, __membersCollectionName(), id));
      __removeMemberFromCurrentCache(id);
      closeDeleteConfirmModal();

      if (member && member.id !== member.visibleId) {
        showToast('info', 'Usuario antigo foi migrado/removido.');
      } else {
        showToast('success', 'Membro removido.');
      }
    }

    async function __deleteMemberKeepingHistory(id, member) {
      await __ensureHistoryPlansCache(false).catch(() => null);
      if (!__canUseHistoryFromCache()) {
        showToast('info', 'Salvar historico esta disponivel apenas no plano ULTRA ou superior.');
        return;
      }

      const entry = __buildHistoryEntryFromMember(member);
      const historyId = String(entry?.id || '').trim();
      if (!entry || !historyId) {
        showToast('error', 'Nao foi possivel gerar o historico deste membro.');
        return;
      }

      if (!historyCacheHydrated) {
        await __loadHistoryMembers({ forceRefresh: false, applyPolicy: false });
      }

      const alreadyExists = historyCache.some(item => String(item.id || '') === historyId);
      if (!alreadyExists && historyCache.length >= HISTORY_MAX_ITEMS) {
        showToast('error', `O historico ja tem ${HISTORY_MAX_ITEMS} pessoas. Delete um registro antes de salvar outro.`);
        return;
      }

      const guildId = getGuildContext().guildId;
      const memberRef = doc(db, "guildas", guildId, __membersCollectionName(), id);
      const historyRef = __historyDocRef(historyId);
      const metaRef = __historyDocRef(HISTORY_META_DOC_ID);
      if (!historyRef || !metaRef) {
        showToast('error', 'A guilda ainda nao foi carregada.');
        return;
      }

      const nextTotal = alreadyExists ? historyCache.length : Math.min(HISTORY_MAX_ITEMS, historyCache.length + 1);
      const batch = writeBatch(db);
      batch.set(historyRef, __serializeHistoryEntry(entry), { merge: true });
      batch.delete(memberRef);
      batch.set(metaRef, {
        totalItems: nextTotal,
        cleanupAtMs: null,
        cleanupAt: null,
        lastPlanTier: __getCachedVipTierFast(),
        updatedAt: serverTimestamp(),
        updatedAtMs: Date.now()
      }, { merge: true });
      await batch.commit();

      __syncHistoryEntryInCache(entry);
      __removeMemberFromCurrentCache(id);
      closeDeleteConfirmModal();
      showToast('success', 'Membro removido e salvo no historico.');
    }

    window.executeDeleteMember = async (mode = 'delete') => {
      const id = String(currentDeleteId || '').trim();
      if (!id) {
        closeDeleteConfirmModal();
        return;
      }

      try {
        const m = membersCache.find(x => String(x.id || '') === id);
        if (!m) {
          closeDeleteConfirmModal();
          return;
        }
        __setRemoveMemberBusy(true, mode === 'history' ? 'Salvando...' : 'Removendo...');
        if (mode === 'history') {
          await __deleteMemberKeepingHistory(id, m);
        } else {
          await __deleteMemberWithoutHistory(id, m);
        }
      } catch(e) {
        console.error(e);
        closeDeleteConfirmModal();
        showToast('error', 'Erro ao remover.');
      } finally {
        __setRemoveMemberBusy(false);
      }
    };

    window.deleteMember = (id) => {
      currentDeleteId = String(id || '').trim();
      if (!currentDeleteId) return;
      __renderRemoveMemberModal();
      document.getElementById('delete-confirm-modal').classList.remove('hidden');
      initIcons();
    };

    function __showStyledConfirm(options = {}) {
      return new Promise((resolve) => {
        const previous = document.getElementById('styled-confirm-modal');
        if (previous) previous.remove();

        const danger = options.danger === true;
        const modal = document.createElement('div');
        modal.id = 'styled-confirm-modal';
        modal.className = 'fixed inset-0 z-[90] flex items-end sm:items-center justify-center';
        modal.innerHTML = `
          <div data-confirm-backdrop class="fixed inset-0 bg-black/50 backdrop-blur-sm"></div>
          <div class="relative bg-white w-full sm:max-w-sm sm:rounded-3xl rounded-t-3xl shadow-2xl p-6 m-0 sm:m-4 zoom-in-95">
            <div class="flex items-center justify-center w-14 h-14 rounded-full ${danger ? 'bg-red-100 text-red-600' : 'bg-emerald-100 text-emerald-700'} mb-4 mx-auto">
              <i data-lucide="${danger ? 'trash-2' : 'rotate-ccw'}" class="w-7 h-7"></i>
            </div>
            <h3 class="text-xl font-bold text-center text-gray-900 mb-2">${escapeHtml(options.title || 'Confirmar acao?')}</h3>
            <p class="text-sm text-center text-gray-500 mb-6 leading-relaxed">${escapeHtml(options.message || 'Deseja continuar?')}</p>
            <div class="grid gap-2">
              <button data-confirm-ok type="button" class="w-full py-3 rounded-xl ${danger ? 'bg-red-600 hover:bg-red-700 shadow-red-200' : 'bg-emerald-600 hover:bg-emerald-700 shadow-emerald-200'} text-white font-bold text-sm shadow-lg transition-all active:scale-95">
                ${escapeHtml(options.confirmText || 'Confirmar')}
              </button>
              <button data-confirm-cancel type="button" class="w-full py-3 rounded-xl border border-gray-200 text-gray-600 font-bold text-sm hover:bg-gray-50 transition-colors">
                Cancelar
              </button>
            </div>
          </div>
        `;
        document.body.appendChild(modal);
        initIcons();

        const done = (value) => {
          modal.remove();
          resolve(value);
        };
        modal.querySelector('[data-confirm-ok]')?.addEventListener('click', () => done(true));
        modal.querySelector('[data-confirm-cancel]')?.addEventListener('click', () => done(false));
        modal.querySelector('[data-confirm-backdrop]')?.addEventListener('click', () => done(false));
      });
    }

    window.openHistoryModal = async () => {
      __hydrateHistoryFromCacheNow();
      __syncHistoryAccessState();
      renderHistoryList();

      const modal = document.getElementById('history-modal');
      if (modal) modal.classList.remove('hidden');
      document.documentElement.classList.add('overflow-hidden');
      initIcons();

      await __ensureHistoryPlansCache(false).catch(() => null);
      __syncHistoryAccessState();
      renderHistoryList();
      await __loadHistoryMembers({ forceRefresh: false, applyPolicy: true });
    };

    window.closeHistoryModal = () => {
      document.getElementById('history-modal')?.classList.add('hidden');
      document.documentElement.classList.remove('overflow-hidden');
    };

    window.restoreHistoryMember = async (historyId) => {
      await __ensureHistoryPlansCache(false).catch(() => null);
      if (!__canUseHistoryFromCache()) {
        showToast('info', 'O historico fica disponivel apenas no plano ULTRA ou superior.');
        renderHistoryList();
        return;
      }

      const id = String(historyId || '').trim();
      if (!id) return;
      if (!historyCacheHydrated) await __loadHistoryMembers({ forceRefresh: false, applyPolicy: false });
      const entry = historyCache.find(item => String(item.id || '') === id);
      if (!entry) {
        showToast('error', 'Registro nao encontrado no historico.');
        return;
      }

      const targetSlot = __isGuildSlotAvailable(entry.removedFromSlot) ? Number(entry.removedFromSlot) : Number(currentGuildSlot || 1);
      const visibleId = backupString(entry.visibleId || entry.id, 80);
      if (!visibleId) {
        showToast('error', 'Este registro nao tem ID valido.');
        return;
      }

      try {
        const duplicate = await __findMemberInGuildSlotByVisibleId(targetSlot, visibleId);
        if (duplicate) {
          showToast('error', `Este ID ja esta em ${__currentGuildDisplayName(targetSlot)}.`);
          return;
        }

        await __ensureMembersCollectionExists(targetSlot);
        const guildId = getGuildContext().guildId;
        const memberPayload = __buildMemberPayloadFromHistory(entry);
        const historyRef = __historyDocRef(id);
        const metaRef = __historyDocRef(HISTORY_META_DOC_ID);
        const memberRef = doc(db, 'guildas', guildId, __membersCollectionName(targetSlot), visibleId);
        const nextTotal = Math.max(0, historyCache.length - 1);
        const batch = writeBatch(db);
        batch.set(memberRef, memberPayload, { merge: true });
        if (historyRef) batch.delete(historyRef);
        if (metaRef) {
          batch.set(metaRef, {
            totalItems: nextTotal,
            cleanupAtMs: historyMetaCache?.cleanupAtMs || null,
            cleanupAt: historyMetaCache?.cleanupAt || null,
            lastPlanTier: __getCachedVipTierFast(),
            updatedAt: serverTimestamp(),
            updatedAtMs: Date.now()
          }, { merge: true });
        }
        await batch.commit();

        const restoredMember = { id: visibleId, ...memberPayload, updatedAt: Date.now() };
        if (Number(targetSlot) === Number(currentGuildSlot)) {
          const next = (membersCache || []).filter(item => String(item.id || '') !== visibleId);
          next.push(restoredMember);
          __setMembersCache(next);
        }
        __upsertMemberCacheBySlot(targetSlot, restoredMember);
        __removeHistoryEntryFromCache(id);
        showToast('success', `Membro adicionado em ${__currentGuildDisplayName(targetSlot)}.`);
      } catch (e) {
        console.error(e);
        showToast('error', 'Nao foi possivel restaurar este membro.');
      }
    };

    window.deleteHistoryMember = async (historyId) => {
      await __ensureHistoryPlansCache(false).catch(() => null);
      if (!__canUseHistoryFromCache()) {
        showToast('info', 'O historico fica disponivel apenas no plano ULTRA ou superior.');
        renderHistoryList();
        return;
      }

      const id = String(historyId || '').trim();
      if (!id) return;
      const ok = await __showStyledConfirm({
        title: 'Deletar do historico?',
        message: 'Esse registro sera removido do historico da guilda.',
        confirmText: 'Deletar',
        danger: true
      });
      if (!ok) return;

      try {
        const historyRef = __historyDocRef(id);
        const metaRef = __historyDocRef(HISTORY_META_DOC_ID);
        const nextTotal = Math.max(0, historyCache.length - 1);
        const batch = writeBatch(db);
        if (historyRef) batch.delete(historyRef);
        if (metaRef) {
          batch.set(metaRef, {
            totalItems: nextTotal,
            updatedAt: serverTimestamp(),
            updatedAtMs: Date.now()
          }, { merge: true });
        }
        await batch.commit();
        __removeHistoryEntryFromCache(id);
        showToast('success', 'Registro deletado do historico.');
      } catch (e) {
        console.error(e);
        showToast('error', 'Nao foi possivel deletar do historico.');
      }
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
          feedback.innerHTML = `<span class="text-emerald-600 font-bold">✓ ${escapeHtml(name)} (Nível ${Number.isFinite(levelNum) ? levelNum : '?'})</span> <span class="text-gray-500">Confira o resultado. Se o nick estiver incorreto, edite o campo manualmente.</span>`;

          syncHasTagToggleFromNick();
        } else {
          feedback.innerHTML = '<span class="text-amber-600">Não foi possível confirmar o nick agora. Você pode digitá-lo manualmente e continuar normalmente.</span>';
        }
      } catch(e) {
        const msg = (e?.name === 'AbortError')
          ? 'A API demorou demais para responder.'
          : 'Jogador não encontrado ou erro na API.';
        feedback.innerHTML = `<span class="text-amber-600">${escapeHtml(msg)} Você pode digitar o nick manualmente e continuar.</span>`;
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
      const memberContact = readMemberContactForm();

      if (memberContact.value && !memberContact.valid) {
        const message = memberContact.type === 'whatsapp'
          ? `Informe ${memberContact.country.maxDigits} dígitos para um WhatsApp de ${memberContact.country.label}, incluindo DDD/área.`
          : `Informe um usuário válido do ${MEMBER_CONTACT_TYPES[memberContact.type]?.label || 'contato'}.`;
        showToast('error', message);
        return;
      }

      const payload = {
        visibleId,
        nick: finalNick,
        contactType: memberContact.type,
        contactValue: memberContact.value,
        contactCountryCode: memberContact.countryCode,
        whatsapp: memberContact.type === 'whatsapp' ? memberContact.value : '',
        whatsappCountryCode: memberContact.type === 'whatsapp' ? memberContact.countryCode : '',
        instagram: memberContact.type === 'instagram' ? memberContact.value : '',
        discord: memberContact.type === 'discord' ? memberContact.value : '',
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

    bindReliableTap(document.getElementById('btn-open-history'), () => {
      window.openHistoryModal();
    });

    document.getElementById('history-search-input')?.addEventListener('input', renderHistoryList);

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
    mountMembersJsonBackupPanel();
    syncPrintUpgradeSuggestion();

    window.addEventListener('resize', () => {
      __positionGuildSlotDropdown();
      positionPlayModeCounterDropdown();
      positionGoalMetDropdown();
    });

    // ==========================================
    // FINALIZAÇÃO DE BOOT E AUTENTICAÇÃO
    // ==========================================
    initPlayModePicker();
    initMemberContactPicker();

    checkAuth().then(async (user) => {
      if(!user) return;
      document.getElementById('btn-logout').onclick = logout;

      const settingsCache = __readFreshDirectSettingsCache();
      const cachedSlots = Array.isArray(settingsCache?.multiGuildSlots) ? normalizeGuildSlotMetaList(settingsCache.multiGuildSlots) : null;
      currentGuildSlotsMeta = cachedSlots && cachedSlots.length
        ? cachedSlots
        : [{ slot: 1, name: getGuildContext()?.guildName || '', tag: settingsCache?.tag || '', exists: true }];
      const vipTier = __getCachedVipTierFast();
      canUseMultiGuildMembers = ['pro', 'business', 'ultra', 'parceiro'].includes(vipTier);
      canUsePrintScanner = ['pro', 'business', 'ultra', 'parceiro'].includes(vipTier);
      syncPrintUpgradeSuggestion(vipTier);
      currentGuildSlot = canUseMultiGuildMembers ? __readSelectedGuildSlot() : 1;
      if (!__isGuildSlotAvailable(currentGuildSlot)) currentGuildSlot = 1;
      __writeSelectedGuildSlot(currentGuildSlot);

      memberTag = settingsCache?.tag ? String(settingsCache.tag || '').trim() : memberTag;
      __updateCurrentMemberTag();
      guildGoals = settingsCache?.goals ? normalizeGoalsFromAnySource(settingsCache.goals) : guildGoals;
      __syncGuildSlotButtonState();
      __syncPrintScannerAccessState();
      __syncHistoryAccessState();
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
        __syncHistoryAccessState();
        syncPrintUpgradeSuggestion(__getCachedVipTierFast());
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
      __hydrateHistoryFromCacheNow();
      __syncHistoryAccessState();
      renderHistoryList();
      __ensureHistoryPlansCache(false).then(() => {
        __syncHistoryAccessState();
        renderHistoryList();
        return __applyHistoryRetentionPolicy({ persist: false });
      }).catch(() => {});
      await __loadHistoryMembers({ forceRefresh: false, applyPolicy: true });
      
      const searchInput = document.getElementById('search-input');
      if (searchInput) {
        searchInput.addEventListener('input', window.applyFiltersAndRender);
      }
    });
