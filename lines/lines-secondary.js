import {
  getGuildContext,
  getVipTier,
  getGuildMultiConfig,
  showToast,
  initIcons
} from '../logic.js';
import { getSharedCache, setSharedCache, readSharedJsonCache } from '../cache.js';

const MAX_GUILD_SLOTS = 4;
const CACHE_TTL_MS = 5 * 60 * 1000;

let guildId = '';
let currentSlot = 1;
let canUseMultiGuildLines = false;
let slotsMeta = [];

function normalizeText(value) {
  return String(value || '').trim();
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function normalizeSlot(value) {
  const n = Math.floor(Number(value) || 1);
  return Math.max(1, Math.min(MAX_GUILD_SLOTS, n));
}

function normalizeVipTier(value) {
  const s = String(value || '').toLowerCase().trim();
  if (s.includes('vital') || s.includes('life')) return 'vitalicio';
  if (s.includes('business') || s.includes('buss')) return 'business';
  if (s.includes('pro')) return 'pro';
  if (s.includes('plus')) return 'plus';
  return 'free';
}

function getCachedCtx() {
  return readSharedJsonCache('guildCtx_cache_v1', null) || {};
}

function resolveContext() {
  const live = getGuildContext?.() || {};
  const cached = getCachedCtx();
  const merged = { ...cached, ...live };
  if (merged.guildId) guildId = String(merged.guildId);
  return merged;
}

function isProOrHigher() {
  const ctx = resolveContext();
  const tier = normalizeVipTier(ctx.vipTier || getVipTier?.() || 'free');
  return ['pro', 'business', 'vitalicio'].includes(tier);
}

function selectionKey(id = guildId) {
  return id ? `linesGuildSlot_${id}` : 'linesGuildSlot';
}

function readSelectedSlot() {
  const raw = getSharedCache(selectionKey());
  return normalizeSlot(raw || 1);
}

function writeSelectedSlot(slot) {
  setSharedCache(selectionKey(), String(normalizeSlot(slot)));
}

function collectionName(base, slot = currentSlot) {
  const n = normalizeSlot(slot);
  return n <= 1 ? base : `${base}${n}`;
}

function lineCacheKey(id = guildId, slot = currentSlot) {
  const n = normalizeSlot(slot);
  if (!id) return n <= 1 ? 'linesList' : `linesList_${collectionName('lines', n)}`;
  return n <= 1 ? `linesList_${id}` : `linesList_${id}_${collectionName('lines', n)}`;
}

function lineCountCacheKey(id = guildId, slot = currentSlot) {
  const n = normalizeSlot(slot);
  if (!id) return n <= 1 ? 'linesCount' : `linesCount_${collectionName('lines', n)}`;
  return n <= 1 ? `linesCount_${id}` : `linesCount_${id}_${collectionName('lines', n)}`;
}

function memberCacheKey(id = guildId, slot = currentSlot) {
  const n = normalizeSlot(slot);
  if (!id) return `membersList_${collectionName('membros', n)}`;
  return `membersList_${id}_${collectionName('membros', n)}`;
}

function memberCacheKeys(id = guildId, slot = currentSlot) {
  const n = normalizeSlot(slot);
  const primary = memberCacheKey(id, n);
  if (!id) return [primary];
  if (n <= 1) return [primary, `membersList_${id}`];
  return [primary];
}

function fallbackSlots() {
  const ctx = resolveContext();
  return [{
    slot: 1,
    nameField: 'name',
    tagField: 'tagMembros',
    name: normalizeText(ctx.guildName || ctx.name || 'Guilda principal'),
    tag: '',
    exists: true
  }];
}

function normalizeSlots(list) {
  const map = new Map();
  fallbackSlots().forEach((slot) => map.set(1, slot));

  (Array.isArray(list) ? list : []).forEach((slot) => {
    const n = normalizeSlot(slot?.slot);
    map.set(n, {
      slot: n,
      nameField: slot?.nameField || (n <= 1 ? 'name' : `name${n}`),
      tagField: slot?.tagField || (n <= 1 ? 'tagMembros' : `tagMembros${n}`),
      name: normalizeText(slot?.name),
      tag: normalizeText(slot?.tag),
      exists: n === 1 ? true : slot?.exists !== false && !!normalizeText(slot?.name)
    });
  });

  return Array.from(map.values()).sort((a, b) => a.slot - b.slot).slice(0, MAX_GUILD_SLOTS);
}

function readSlotsFromCache() {
  if (!guildId) return null;
  const cached = readSharedJsonCache(`guildMulti_${guildId}`, null);
  if (Array.isArray(cached) && cached.length) {
    return normalizeSlots(cached);
  }
  return null;
}

function getSlotMeta(slot = currentSlot) {
  const n = normalizeSlot(slot);
  return (slotsMeta || []).find((item) => Number(item?.slot) === n) || null;
}

function isSlotAvailable(slot) {
  const n = normalizeSlot(slot);
  if (n <= 1) return true;
  const meta = getSlotMeta(n);
  return !!(meta && meta.exists);
}

function displayName(slot = currentSlot) {
  const n = normalizeSlot(slot);
  const meta = getSlotMeta(n);
  const name = normalizeText(meta?.name);
  if (name) return name;
  return n <= 1 ? 'Guilda principal' : `Guilda ${n}`;
}

function syncStateFromCache() {
  resolveContext();
  canUseMultiGuildLines = isProOrHigher();

  const cachedSlots = readSlotsFromCache();
  slotsMeta = cachedSlots && cachedSlots.length ? cachedSlots : normalizeSlots(slotsMeta.length ? slotsMeta : fallbackSlots());

  const nextSlot = canUseMultiGuildLines ? readSelectedSlot() : 1;
  currentSlot = isSlotAvailable(nextSlot) ? nextSlot : 1;
  writeSelectedSlot(currentSlot);
}

function getSnapshot() {
  return {
    guildId,
    slot: currentSlot,
    canUseMultiGuildLines,
    linesCollection: collectionName('lines'),
    membersCollection: collectionName('membros'),
    slotName: displayName()
  };
}

function updateButtonState() {
  const btn = document.getElementById('btn-lines-guild-slot');
  const label = document.getElementById('lines-guild-slot-label');
  if (!btn || !label) return;

  label.textContent = displayName();
  btn.classList.toggle('opacity-60', !canUseMultiGuildLines);
  btn.classList.toggle('cursor-not-allowed', !canUseMultiGuildLines);
  btn.setAttribute('aria-disabled', canUseMultiGuildLines ? 'false' : 'true');
  btn.title = canUseMultiGuildLines ? 'Trocar guilda' : 'Disponivel no plano PRO ou superior';
}

function renderDropdown() {
  const box = document.getElementById('lines-guild-slot-dropdown');
  if (!box) return;

  box.innerHTML = [1, 2, 3, 4].map((slot) => {
    const available = isSlotAvailable(slot);
    const active = Number(currentSlot) === Number(slot);
    const locked = slot > 1 && (!canUseMultiGuildLines || !available);
    const subtitle = slot === 1
      ? 'Principal'
      : (available ? 'Lines separadas desta guilda' : 'Configure em Ajustes');

    return `
      <button
        type="button"
        data-lines-guild-slot-option="${slot}"
        class="w-full text-left px-3 py-3 rounded-xl border transition-colors ${active ? 'border-emerald-200 bg-emerald-50' : 'border-gray-200 bg-white hover:bg-gray-50'} ${locked ? 'opacity-60' : ''}"
      >
        <div class="flex items-center justify-between gap-3">
          <div class="min-w-0">
            <div class="text-sm font-semibold text-gray-900 truncate">${escapeHtml(displayName(slot))}</div>
            <div class="text-[11px] text-gray-500 mt-0.5">${escapeHtml(subtitle)}</div>
          </div>
          ${active ? '<span class="text-[10px] font-bold uppercase tracking-wide px-2 py-1 rounded-full bg-emerald-100 text-emerald-700">Ativa</span>' : ''}
        </div>
      </button>
    `;
  }).join('');

  initIcons();
}

function positionDropdown() {
  const box = document.getElementById('lines-guild-slot-dropdown');
  if (!box || box.classList.contains('hidden')) return;

  box.style.left = '';
  box.style.right = '0';
  box.style.transform = 'translateX(0)';

  requestAnimationFrame(() => {
    const rect = box.getBoundingClientRect();
    const margin = 12;
    let shiftX = 0;
    if (rect.right > window.innerWidth - margin) shiftX -= rect.right - (window.innerWidth - margin);
    if (rect.left + shiftX < margin) shiftX += margin - (rect.left + shiftX);
    box.style.transform = `translateX(${shiftX}px)`;
  });
}

function syncUi() {
  syncStateFromCache();
  updateButtonState();
  renderDropdown();
}

function notifySlotChanged() {
  window.dispatchEvent(new CustomEvent('lines:guild-slot-changed', { detail: getSnapshot() }));
}

async function selectSlot(slot) {
  const nextSlot = normalizeSlot(slot);

  if (nextSlot > 1 && !canUseMultiGuildLines) {
    showToast('info', 'Trocar lines entre guildas requer plano PRO ou superior.');
    return;
  }

  if (!isSlotAvailable(nextSlot)) {
    showToast('info', `A guilda ${nextSlot} ainda nao esta disponivel nesta conta.`);
    return;
  }

  const changed = currentSlot !== nextSlot;
  currentSlot = nextSlot;
  writeSelectedSlot(currentSlot);
  updateButtonState();
  renderDropdown();
  document.getElementById('lines-guild-slot-dropdown')?.classList.add('hidden');

  if (changed) notifySlotChanged();
}

async function refreshSlots(forceRefresh = false) {
  const previousSlot = currentSlot;
  syncStateFromCache();
  syncUi();

  try {
    const fresh = await getGuildMultiConfig(MAX_GUILD_SLOTS, { ttlMs: CACHE_TTL_MS, forceRefresh });
    if (Array.isArray(fresh) && fresh.length) {
      slotsMeta = normalizeSlots(fresh);
      const nextSlot = canUseMultiGuildLines ? readSelectedSlot() : 1;
      currentSlot = isSlotAvailable(nextSlot) ? nextSlot : 1;
      writeSelectedSlot(currentSlot);
      updateButtonState();
      renderDropdown();
    }
  } catch (_) {}

  if (previousSlot !== currentSlot) notifySlotChanged();
}

window.linesSecondaryGuilds = {
  currentSlot: () => currentSlot,
  canUseMultiGuildLines: () => canUseMultiGuildLines,
  linesCollectionName: () => collectionName('lines'),
  membersCollectionName: () => collectionName('membros'),
  keyLines: (id) => lineCacheKey(id),
  keyLinesCount: (id) => lineCountCacheKey(id),
  keyMembers: (id) => memberCacheKey(id),
  memberCacheKeys: (id) => memberCacheKeys(id),
  displayName: () => displayName(),
  refresh: refreshSlots,
  snapshot: getSnapshot
};

syncStateFromCache();

const btn = document.getElementById('btn-lines-guild-slot');
const dropdown = document.getElementById('lines-guild-slot-dropdown');

btn?.addEventListener('click', () => {
  syncUi();
  if (!canUseMultiGuildLines) {
    showToast('info', 'Trocar lines entre guildas requer plano PRO ou superior.');
    return;
  }
  dropdown?.classList.toggle('hidden');
  positionDropdown();
});

dropdown?.addEventListener('click', async (event) => {
  const option = event.target.closest('[data-lines-guild-slot-option]');
  if (!option) return;
  await selectSlot(option.getAttribute('data-lines-guild-slot-option'));
});

document.addEventListener('click', (event) => {
  const wrap = btn?.parentElement;
  if (wrap && !wrap.contains(event.target)) dropdown?.classList.add('hidden');
});

window.addEventListener('resize', positionDropdown);

window.addEventListener('storage', (event) => {
  if (!guildId) return;
  if (event.key === `guildMulti_${guildId}` || event.key === `guildMulti_${guildId}_ts` || event.key === 'guildCtx_cache_v1') {
    syncUi();
  }
});

refreshSlots(false);
window.addEventListener('load', () => refreshSlots(false));
setTimeout(() => refreshSlots(false), 1200);
