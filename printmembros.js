// printmembros.js
// Leitor de prints com Gemini API + revisão manual.
// Não usa leitor local no navegador. A imagem vai para /api/ler-print-membros,
// a API chama o Gemini com a chave protegida no backend e devolve as linhas reconhecidas.

export function setupPrintScanner({ onSave }) {
    let membersList = [];
    let pendingUpdates = [];

    const input = document.getElementById('upload-prints');
    const resultDiv = document.getElementById('print-results');
    const btnSave = document.getElementById('btn-save-prints');
    const statusText = document.getElementById('print-status');

    const API_ROUTE = '/api/ler-print-membros';
    const MAX_FILES = 8;
    const MAX_IMAGE_WIDTH = 1600;
    const JPEG_QUALITY = 0.82;

    function setStatus(text) {
        if (statusText) statusText.innerText = text;
    }

    function escapeHtml(value) {
        return String(value ?? '')
            .replaceAll('&', '&amp;')
            .replaceAll('<', '&lt;')
            .replaceAll('>', '&gt;')
            .replaceAll('"', '&quot;')
            .replaceAll("'", '&#039;');
    }

    function normalizeText(value) {
        return String(value ?? '')
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .toLowerCase()
            .replace(/[|!]/g, 'i')
            .replace(/[0]/g, 'o')
            .replace(/[^a-z0-9]+/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
    }

    function compactText(value) {
        return normalizeText(value).replace(/\s+/g, '');
    }

    function getMemberDisplayName(member) {
        return String(member?.nick || member?.name || member?.visibleId || member?.id || 'Sem nome');
    }

    function updateCache(cache) {
        membersList = Array.isArray(cache) ? cache : [];
        membersList.sort((a, b) => getMemberDisplayName(a).localeCompare(getMemberDisplayName(b)));
        resetScanner();
    }

    function resetScanner() {
        if (input) input.value = '';
        if (resultDiv) resultDiv.innerHTML = '';
        if (btnSave) {
            btnSave.classList.add('hidden');
            btnSave.innerHTML = 'Confirmar e Salvar Pontuações';
            btnSave.disabled = false;
        }
        setStatus('Selecione os prints para começar a leitura.');
        pendingUpdates = [];
    }

    function loadImageFromFile(file) {
        return new Promise((resolve, reject) => {
            const url = URL.createObjectURL(file);
            const img = new Image();
            img.onload = () => {
                URL.revokeObjectURL(url);
                resolve(img);
            };
            img.onerror = () => {
                URL.revokeObjectURL(url);
                reject(new Error('Não foi possível carregar a imagem.'));
            };
            img.src = url;
        });
    }

    async function fileToCompressedBase64(file) {
        const mimeType = String(file.type || '').startsWith('image/') ? file.type : 'image/jpeg';
        const img = await loadImageFromFile(file);
        const originalWidth = img.naturalWidth || img.width || 1;
        const originalHeight = img.naturalHeight || img.height || 1;
        const scale = Math.min(1, MAX_IMAGE_WIDTH / originalWidth);

        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(originalWidth * scale));
        canvas.height = Math.max(1, Math.round(originalHeight * scale));

        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

        const outputMime = mimeType === 'image/png' || mimeType === 'image/webp' ? 'image/jpeg' : mimeType;
        const dataUrl = canvas.toDataURL(outputMime, JPEG_QUALITY);
        const data = dataUrl.split(',')[1] || '';

        return {
            name: file.name || 'print.jpg',
            mimeType: outputMime,
            data,
            width: canvas.width,
            height: canvas.height
        };
    }

    function simplifyMembersForApi() {
        return membersList
            .filter(m => m && (m.id || m.visibleId || m.nick))
            .slice(0, 140)
            .map(m => ({
                id: String(m.id || ''),
                visibleId: String(m.visibleId || ''),
                nick: getMemberDisplayName(m)
            }));
    }

    function levenshtein(a, b) {
        a = String(a || '');
        b = String(b || '');
        if (!a) return b.length;
        if (!b) return a.length;

        const matrix = Array.from({ length: b.length + 1 }, (_, i) => [i]);
        for (let j = 0; j <= a.length; j++) matrix[0][j] = j;

        for (let i = 1; i <= b.length; i++) {
            for (let j = 1; j <= a.length; j++) {
                matrix[i][j] = b.charAt(i - 1) === a.charAt(j - 1)
                    ? matrix[i - 1][j - 1]
                    : Math.min(
                        matrix[i - 1][j - 1] + 1,
                        matrix[i][j - 1] + 1,
                        matrix[i - 1][j] + 1
                    );
            }
        }
        return matrix[b.length][a.length];
    }

    function similarity(a, b) {
        a = compactText(a);
        b = compactText(b);
        if (!a || !b) return 0;
        if (a.includes(b) || b.includes(a)) return 1;
        const maxLen = Math.max(a.length, b.length);
        return 1 - (levenshtein(a, b) / maxLen);
    }

    function findBestLocalMember(text, suggestedId = '') {
        const byId = suggestedId
            ? membersList.find(m => String(m.id || '') === String(suggestedId))
            : null;
        if (byId) return { member: byId, score: 1 };

        let best = null;
        for (const member of membersList) {
            const nickScore = similarity(getMemberDisplayName(member), text);
            const visibleId = String(member.visibleId || '');
            const idScore = visibleId && String(text || '').includes(visibleId) ? 0.98 : 0;
            const score = Math.max(nickScore, idScore);

            if (!best || score > best.score) {
                best = { member, score };
            }
        }

        return best && best.score >= 0.58 ? best : null;
    }

    function normalizeMetric(row) {
        const metric = String(row?.metric || row?.tipo || row?.type || '').toLowerCase();
        if (metric.includes('honra') || metric.includes('semana') || metric.includes('weekly')) return 'honra';
        if (metric.includes('gg') || metric.includes('guerra') || metric.includes('guild') || metric.includes('score')) return 'gg';
        return 'gg';
    }

    function normalizeApiRows(apiRows) {
        const rows = Array.isArray(apiRows) ? apiRows : [];
        return rows.map((row, index) => {
            const metric = normalizeMetric(row);
            const detectedNick = String(row.detectedNick || row.nick || row.apelido || '').trim();
            const suggestedId = String(row.memberId || row.id || '').trim();
            const best = findBestLocalMember(detectedNick || row.sourceText || row.notes || '', suggestedId);
            const member = best?.member || null;

            let value = Number(row.value ?? row.pontuacao ?? row.score ?? row.gg ?? row.honra);
            if (!Number.isFinite(value)) value = '';

            const item = {
                id: member?.id || '',
                visibleId: member?.visibleId || row.visibleId || '',
                nick: member ? getMemberDisplayName(member) : '',
                detectedNick,
                metric,
                value,
                confidence: Number(row.confidence ?? row.confianca ?? best?.score ?? 0),
                notes: String(row.notes || row.observacao || ''),
                source: String(row.source || row.sourceText || row.imagem || ''),
                index
            };

            if (metric === 'honra') item.honra = value;
            else item.gg = value;

            return item;
        }).filter(row => row.value !== '' && Number.isFinite(Number(row.value)));
    }

    async function readPrintsWithGemini(files) {
        const selectedFiles = files.slice(0, MAX_FILES);
        const images = [];

        for (let i = 0; i < selectedFiles.length; i++) {
            setStatus(`Preparando print ${i + 1} de ${selectedFiles.length}...`);
            images.push(await fileToCompressedBase64(selectedFiles[i]));
        }

        setStatus('Enviando para análise com Gemini...');
        const response = await fetch(API_ROUTE, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                images,
                members: simplifyMembersForApi()
            })
        });

        let payload = null;
        try {
            payload = await response.json();
        } catch (_) {}

        if (!response.ok) {
            const message = payload?.error || payload?.message || 'Erro ao analisar prints com Gemini.';
            throw new Error(message);
        }

        return payload?.rows || [];
    }

    function memberOptionsHtml(selectedId = '') {
        const options = [
            `<option value="">Escolha o membro...</option>`,
            ...membersList.map(member => {
                const id = String(member.id || '');
                const selected = String(selectedId || '') === id ? 'selected' : '';
                const label = `${getMemberDisplayName(member)}${member.visibleId ? ` — ID ${member.visibleId}` : ''}`;
                return `<option value="${escapeHtml(id)}" ${selected}>${escapeHtml(label)}</option>`;
            })
        ];
        return options.join('');
    }

    function metricOptionsHtml(metric) {
        return `
            <option value="gg" ${metric === 'gg' ? 'selected' : ''}>GG / Guerra</option>
            <option value="honra" ${metric === 'honra' ? 'selected' : ''}>Honra semanal</option>
        `;
    }

    function confidenceLabel(value) {
        const confidence = Number(value || 0);
        if (confidence >= 0.88) return 'alta';
        if (confidence >= 0.65) return 'média';
        if (confidence > 0) return 'baixa';
        return 'manual';
    }

    function renderResults() {
        if (!resultDiv || !btnSave) return;

        if (pendingUpdates.length === 0) {
            setStatus('Nenhuma pontuação encontrada. Tente um print mais aberto ou confira se é a tela de GG/Honra.');
            resultDiv.innerHTML = `
                <div class="text-center text-gray-500 text-sm p-5 bg-white rounded-2xl border border-gray-100">
                    Nenhum dado encontrado pelo Gemini.
                </div>
            `;
            btnSave.classList.add('hidden');
            return;
        }

        setStatus(`${pendingUpdates.length} linha(s) encontrada(s). Revise membro, tipo e pontuação antes de salvar.`);

        resultDiv.innerHTML = pendingUpdates.map((row, index) => {
            const isManual = !row.id;
            const confidence = confidenceLabel(row.confidence);
            const firstLetter = (row.nick || row.detectedNick || '?').charAt(0).toUpperCase() || '?';

            return `
                <div class="bg-white border ${isManual ? 'border-amber-200' : 'border-gray-100'} rounded-2xl p-3.5 shadow-sm">
                    <div class="flex items-start gap-3">
                        <div class="w-9 h-9 rounded-full ${isManual ? 'bg-amber-50 text-amber-700' : 'bg-emerald-50 text-emerald-700'} flex items-center justify-center flex-shrink-0 font-bold text-sm">
                            ${escapeHtml(firstLetter)}
                        </div>

                        <div class="min-w-0 flex-1">
                            <div class="flex flex-wrap items-center gap-2">
                                <p class="font-bold text-gray-900 text-sm truncate">
                                    ${escapeHtml(row.nick || row.detectedNick || 'Linha encontrada')}
                                </p>
                                <span class="px-2 py-0.5 rounded-full text-[11px] font-bold ${isManual ? 'bg-amber-50 text-amber-700 border border-amber-100' : 'bg-emerald-50 text-emerald-700 border border-emerald-100'}">
                                    ${isManual ? 'escolha manual' : `sugestão ${confidence}`}
                                </span>
                            </div>
                            <p class="text-[11px] text-gray-400 mt-0.5">
                                Lido no print: ${escapeHtml(row.detectedNick || 'sem nick claro')}
                                ${row.notes ? ` • ${escapeHtml(row.notes)}` : ''}
                            </p>
                        </div>
                    </div>

                    <div class="mt-3 grid grid-cols-1 sm:grid-cols-3 gap-2">
                        <div class="sm:col-span-3">
                            <label class="text-[11px] uppercase tracking-wide text-gray-400 font-bold mb-1 block">Membro</label>
                            <select data-print-member-index="${index}" class="w-full px-3 py-2.5 rounded-xl border ${isManual ? 'border-amber-200 bg-amber-50/50' : 'border-gray-200 bg-white'} text-sm font-semibold text-gray-700 outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100">
                                ${memberOptionsHtml(row.id)}
                            </select>
                        </div>

                        <div>
                            <label class="text-[11px] uppercase tracking-wide text-gray-400 font-bold mb-1 block">Tipo</label>
                            <select data-print-metric-index="${index}" class="w-full px-3 py-2.5 rounded-xl border border-gray-200 bg-white text-sm font-semibold text-gray-700 outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100">
                                ${metricOptionsHtml(row.metric)}
                            </select>
                        </div>

                        <div class="sm:col-span-2">
                            <label class="text-[11px] uppercase tracking-wide text-gray-400 font-bold mb-1 block">Pontuação</label>
                            <input data-print-value-index="${index}" type="number" min="0" inputmode="numeric" value="${escapeHtml(row.value)}" class="w-full px-3 py-2.5 rounded-xl border border-gray-200 bg-white text-sm font-bold text-gray-900 outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100">
                        </div>
                    </div>
                </div>
            `;
        }).join('');

        btnSave.classList.remove('hidden');
        if (window.lucide) window.lucide.createIcons();
    }

    function readSelectedUpdates() {
        const merged = new Map();

        pendingUpdates.forEach((item, index) => {
            const selectMember = document.querySelector(`[data-print-member-index="${index}"]`);
            const selectMetric = document.querySelector(`[data-print-metric-index="${index}"]`);
            const inputValue = document.querySelector(`[data-print-value-index="${index}"]`);

            const selectedId = selectMember?.value || '';
            const metric = selectMetric?.value || item.metric || 'gg';
            const value = Number(inputValue?.value);

            if (!selectedId || !Number.isFinite(value)) return;

            const member = membersList.find(m => String(m.id || '') === String(selectedId));
            if (!member) return;

            const key = String(member.id);
            const existing = merged.get(key) || {
                id: member.id,
                visibleId: member.visibleId,
                nick: getMemberDisplayName(member)
            };

            if (metric === 'honra') existing.honra = value;
            else existing.gg = value;

            merged.set(key, existing);
        });

        return Array.from(merged.values());
    }

    if (input && resultDiv && btnSave) {
        input.addEventListener('change', async (event) => {
            const files = Array.from(event.target.files || []);
            if (!files.length) return;

            const selectedFiles = files.slice(0, MAX_FILES);

            btnSave.classList.add('hidden');
            btnSave.disabled = false;
            btnSave.innerHTML = 'Confirmar e Salvar Pontuações';
            resultDiv.innerHTML = `
                <div class="flex flex-col items-center justify-center p-6 bg-white rounded-2xl border border-gray-100">
                    <i data-lucide="loader-2" class="w-7 h-7 text-emerald-500 animate-spin mb-2"></i>
                    <p class="text-sm font-semibold text-gray-700">Analisando com Gemini...</p>
                    <p class="text-xs text-gray-400 mt-1">Isso pode levar alguns segundos.</p>
                </div>
            `;
            if (window.lucide) window.lucide.createIcons();

            try {
                if (files.length > MAX_FILES) {
                    setStatus(`Foram enviados ${files.length} prints, mas vou analisar só os primeiros ${MAX_FILES}.`);
                }

                const rows = await readPrintsWithGemini(selectedFiles);
                pendingUpdates = normalizeApiRows(rows);
                renderResults();
            } catch (err) {
                console.error('Erro ao analisar prints com Gemini:', err);
                pendingUpdates = [];
                setStatus(err?.message || 'Erro ao analisar prints com Gemini.');
                resultDiv.innerHTML = `
                    <div class="text-center text-red-500 text-sm p-5 bg-white rounded-2xl border border-red-100">
                        ${escapeHtml(err?.message || 'Erro ao analisar imagem.')}
                    </div>
                `;
            }
        });
    }

    if (btnSave) {
        btnSave.addEventListener('click', async () => {
            const selectedUpdates = readSelectedUpdates();
            if (!selectedUpdates.length) {
                setStatus('Escolha pelo menos um membro e confira a pontuação antes de salvar.');
                return;
            }

            btnSave.innerHTML = '<i data-lucide="loader-2" class="w-4 h-4 animate-spin inline mr-2"></i> Salvando...';
            btnSave.disabled = true;
            if (window.lucide) window.lucide.createIcons();

            try {
                await onSave(selectedUpdates);
            } finally {
                btnSave.innerHTML = 'Confirmar e Salvar Pontuações';
                btnSave.disabled = false;
            }
        });
    }

    return { updateCache, resetScanner };
}
