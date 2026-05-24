// printmembros.js
// Leitor de prints com OCR + fallback manual.
// Ele tenta reconhecer automaticamente os membros, mas quando o OCR não lê o nick com segurança,
// mostra a linha encontrada e permite escolher o membro antes de salvar.
export function setupPrintScanner({ onSave }) {
    let membersList = [];
    let pendingUpdates = [];

    const input = document.getElementById('upload-prints');
    const resultDiv = document.getElementById('print-results');
    const btnSave = document.getElementById('btn-save-prints');
    const statusText = document.getElementById('print-status');

    const OCR_LANGUAGE = 'eng+por';
    const COMMON_WORDS = new Set([
        'membros', 'membro', 'online', 'status', 'horas', 'hora', 'atras', 'min', 'bermuda',
        'apoio', 'apoiador', 'semana', 'esta', 'guilda', 'gerenciar', 'atividade', 'recompensas',
        'visao', 'geral', 'placar', 'individual', 'pontuacao', 'patente', 'apelido', 'rodada',
        'melhores', 'taxa', 'abates', 'vitorias', 'armas', 'guerra', 'de', 'da', 'do', 'das',
        'dos', 'br', 'nv', 'nw', 'nivel', 'level', 'on', 'line'
    ]);

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
            .replace(/[|]/g, 'i')
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

    function loadImage(file) {
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

    function getCropBox(img, variant) {
        const w = img.naturalWidth || img.width;
        const h = img.naturalHeight || img.height;
        if (variant === 'bottom-score') {
            return { x: w * 0.14, y: h * 0.82, w: w * 0.54, h: h * 0.18 };
        }
        if (variant === 'name-score-area') {
            return { x: w * 0.15, y: h * 0.08, w: w * 0.53, h: h * 0.90 };
        }
        return { x: w * 0.13, y: h * 0.06, w: w * 0.56, h: h * 0.90 };
    }

    function prepareCanvas(img, variant) {
        const crop = getCropBox(img, variant.name);
        const scale = variant.scale || 3;
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(crop.w * scale));
        canvas.height = Math.max(1, Math.round(crop.h * scale));
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        ctx.imageSmoothingEnabled = true;
        ctx.drawImage(
            img,
            crop.x, crop.y, crop.w, crop.h,
            0, 0, canvas.width, canvas.height
        );

        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const data = imageData.data;

        for (let i = 0; i < data.length; i += 4) {
            const r = data[i];
            const g = data[i + 1];
            const b = data[i + 2];
            const brightness = (r * 0.299) + (g * 0.587) + (b * 0.114);

            if (variant.mode === 'mask') {
                // Isola textos claros/amarelos do Free Fire e joga o fundo para branco.
                const isYellow = r > 120 && g > 95 && b < 130;
                const isWhite = r > 160 && g > 160 && b > 145;
                const isBlueWhite = r > 120 && g > 150 && b > 160;
                const ink = (isYellow || isWhite || isBlueWhite) ? 0 : 255;
                data[i] = ink;
                data[i + 1] = ink;
                data[i + 2] = ink;
            } else {
                // Cinza com contraste para letras pequenas.
                let v = (brightness - 115) * 1.85 + 128;
                v = Math.max(0, Math.min(255, v));
                data[i] = v;
                data[i + 1] = v;
                data[i + 2] = v;
            }
        }

        ctx.putImageData(imageData, 0, 0);
        return canvas;
    }

    async function recognizeCanvas(canvas, variantName) {
        const options = {
            tessedit_pageseg_mode: variantName === 'bottom-score' ? '11' : '6'
        };

        try {
            const { data: { text } } = await window.Tesseract.recognize(canvas, OCR_LANGUAGE, options);
            return text || '';
        } catch (err) {
            console.warn('Falha no OCR com eng+por, tentando por:', err);
            try {
                const { data: { text } } = await window.Tesseract.recognize(canvas, 'por', options);
                return text || '';
            } catch (err2) {
                console.warn('Falha no OCR com por, tentando eng:', err2);
                const { data: { text } } = await window.Tesseract.recognize(canvas, 'eng', options);
                return text || '';
            }
        }
    }

    async function readFileWithOcr(file, fileIndex, totalFiles) {
        const img = await loadImage(file);
        const variants = [
            { name: 'name-score-area', mode: 'gray', scale: 3 },
            { name: 'name-score-area', mode: 'mask', scale: 3 },
            { name: 'bottom-score', mode: 'gray', scale: 4 }
        ];

        const parts = [];
        for (let i = 0; i < variants.length; i++) {
            const variant = variants[i];
            setStatus(`Analisando print ${fileIndex + 1} de ${totalFiles}... etapa ${i + 1}/${variants.length}`);
            const canvas = prepareCanvas(img, variant);
            const text = await recognizeCanvas(canvas, variant.name);
            if (text && text.trim()) {
                parts.push({ text, variant: variant.name, fileName: file.name || `print-${fileIndex + 1}` });
            }
        }

        return parts;
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

    function bestSlidingSimilarity(textCompact, targetCompact) {
        if (!textCompact || !targetCompact) return 0;
        if (textCompact.includes(targetCompact)) return 1;
        const len = targetCompact.length;
        if (len < 4) return 0;
        let best = 0;
        const min = Math.max(3, len - 2);
        const max = Math.min(textCompact.length, len + 3);
        for (let size = min; size <= max; size++) {
            for (let i = 0; i <= textCompact.length - size; i++) {
                best = Math.max(best, similarity(textCompact.slice(i, i + size), targetCompact));
                if (best >= 0.92) return best;
            }
        }
        return best;
    }

    function scoreMemberAgainstText(member, text) {
        const memberNick = normalizeText(getMemberDisplayName(member));
        const memberCompact = compactText(memberNick);
        const textNorm = normalizeText(text);
        const textCompact = compactText(textNorm);
        if (!memberCompact || !textCompact) return 0;

        if (memberCompact.length >= 4 && textCompact.includes(memberCompact)) return 1;

        let best = bestSlidingSimilarity(textCompact, memberCompact);
        const tokens = memberNick.split(' ').filter(t => t.length >= 3 && !COMMON_WORDS.has(t));
        for (const token of tokens) {
            if (textNorm.includes(token)) best = Math.max(best, token.length >= 5 ? 0.88 : 0.78);
            best = Math.max(best, bestSlidingSimilarity(textCompact, token));
        }

        const visibleId = String(member.visibleId || '').trim();
        if (visibleId && text.includes(visibleId)) best = Math.max(best, 0.96);

        return best;
    }

    function findBestMember(text) {
        let best = null;
        for (const member of membersList) {
            const score = scoreMemberAgainstText(member, text);
            if (!best || score > best.score) {
                best = { member, score };
            }
        }
        return best;
    }

    function detectPageType(text) {
        const norm = normalizeText(text);
        const compact = compactText(norm);
        if (
            norm.includes('pontuacao individual') ||
            compact.includes('pontuacaoindividual') ||
            norm.includes('placar individual') ||
            norm.includes('rodada')
        ) {
            return 'score';
        }
        if (
            norm.includes('esta semana') ||
            compact.includes('estasemana') ||
            norm.includes('membros online') ||
            norm.includes('status') ||
            norm.includes('gerenciar membros')
        ) {
            return 'weekly';
        }
        return 'unknown';
    }

    function extractNumbersWithContext(text) {
        const result = [];
        const str = String(text || '');
        const regex = /\d+/g;
        let match;
        while ((match = regex.exec(str)) !== null) {
            const raw = match[0];
            const value = parseInt(raw, 10);
            if (!Number.isFinite(value)) continue;
            const before = str.slice(Math.max(0, match.index - 14), match.index).toLowerCase();
            const after = str.slice(match.index + raw.length, match.index + raw.length + 14).toLowerCase();
            const around = before + raw + after;
            const isLevel = /(?:nv|nw|lv|nivel|level)\s*\.?\s*$/.test(before) || /^\s*\.?\s*(?:nv|nw|lv|nivel|level)/.test(after);
            const isPercent = after.trim().startsWith('%') || around.includes('%');
            const isRound = /rodada\s*$/.test(before);
            const isRatio = before.endsWith('/') || after.trim().startsWith('/');
            result.push({ value, raw, isLevel, isPercent, isRound, isRatio, index: match.index });
        }
        return result;
    }

    function extractValuesFromBlock(block, pageType) {
        const nums = extractNumbersWithContext(block)
            .filter(n => !n.isLevel && !n.isPercent && !n.isRound && !n.isRatio);

        let honra;
        let gg;

        const weeklyCandidates = nums
            .map(n => n.value)
            .filter(v => v >= 1000 && v <= 99999);
        if ((pageType === 'weekly' || pageType === 'unknown') && weeklyCandidates.length) {
            honra = Math.max(...weeklyCandidates);
        }

        const scoreCandidates = nums
            .map(n => n.value)
            .filter(v => v >= 1 && v <= 9999);
        if ((pageType === 'score' || pageType === 'unknown') && scoreCandidates.length) {
            // Em placar individual, normalmente o valor correto fica mais à direita/por último.
            gg = scoreCandidates[scoreCandidates.length - 1];
        }

        // Evita confundir honra semanal alta com GG quando a página é claramente da lista de membros.
        if (pageType === 'weekly') gg = undefined;
        // Evita confundir pontuação individual com honra quando a página é claramente do placar.
        if (pageType === 'score') honra = undefined;

        return { gg, honra };
    }

    function candidateLabelFromText(text) {
        const words = normalizeText(text)
            .split(' ')
            .filter(w => w.length >= 2 && !COMMON_WORDS.has(w) && !/^\d+$/.test(w));
        return words.slice(0, 5).join(' ') || 'Linha sem nick legível';
    }

    function hasAnyValue(candidate) {
        return Number.isFinite(Number(candidate.gg)) || Number.isFinite(Number(candidate.honra));
    }

    function mergeCandidateIntoMap(map, candidate) {
        if (!hasAnyValue(candidate)) return;

        const hasMember = !!candidate.id;
        const valueKey = `${candidate.gg ?? ''}:${candidate.honra ?? ''}`;
        const textKey = compactText(candidate.sourceText || candidate.rawLabel || '').slice(0, 50);
        const key = hasMember ? `member:${candidate.id}` : `unknown:${valueKey}:${textKey}`;

        const existing = map.get(key);
        if (existing) {
            if (candidate.gg !== undefined) existing.gg = candidate.gg;
            if (candidate.honra !== undefined) existing.honra = candidate.honra;
            existing.sourceText = existing.sourceText || candidate.sourceText;
            existing.matchScore = Math.max(existing.matchScore || 0, candidate.matchScore || 0);
            return;
        }
        map.set(key, candidate);
    }

    function extractDataFromPages(pages) {
        const map = new Map();

        pages.forEach(page => {
            const allText = String(page.text || '');
            const pageType = detectPageType(allText);
            const lines = allText
                .split('\n')
                .map(line => line.trim())
                .filter(line => line.length > 0);

            for (let i = 0; i < lines.length; i++) {
                const block = [lines[i], lines[i + 1], lines[i + 2]]
                    .filter(Boolean)
                    .join(' ');

                const values = extractValuesFromBlock(block, pageType);
                if (!Number.isFinite(Number(values.gg)) && !Number.isFinite(Number(values.honra))) continue;

                const best = findBestMember(block);
                const matched = best && best.score >= 0.68 ? best.member : null;

                const candidate = {
                    id: matched?.id,
                    visibleId: matched?.visibleId,
                    nick: matched ? getMemberDisplayName(matched) : '',
                    gg: values.gg,
                    honra: values.honra,
                    matchScore: best?.score || 0,
                    rawLabel: candidateLabelFromText(block),
                    sourceText: block,
                    pageType
                };

                // Se não reconheceu membro, ainda mostra a linha para escolha manual.
                // Isso é essencial porque o OCR costuma trocar KUSHINA por algo como RUSAIAE nos prints do FF.
                mergeCandidateIntoMap(map, candidate);
            }
        });

        return Array.from(map.values())
            .filter(hasAnyValue)
            .slice(0, 80);
    }

    function memberOptionsHtml(selectedId = '') {
        return ['<option value="">Escolha o membro...</option>']
            .concat(membersList.map(member => {
                const id = String(member.id || '');
                const label = getMemberDisplayName(member);
                const selected = id === String(selectedId || '') ? ' selected' : '';
                return `<option value="${escapeHtml(id)}"${selected}>${escapeHtml(label)}</option>`;
            }))
            .join('');
    }

    function getBadge(candidate) {
        if (candidate.id) {
            return '<span class="px-2 py-1 rounded-full bg-emerald-50 text-emerald-700 text-[10px] font-bold border border-emerald-100">Reconhecido</span>';
        }
        return '<span class="px-2 py-1 rounded-full bg-amber-50 text-amber-700 text-[10px] font-bold border border-amber-100">Escolha manual</span>';
    }

    function renderResults() {
        if (!resultDiv || !btnSave) return;

        if (pendingUpdates.length === 0) {
            setStatus('Nenhuma pontuação foi encontrada. Tente enviar o print sem cortar e com boa resolução.');
            resultDiv.innerHTML = '<p class="text-center text-gray-500 text-sm p-4">Nenhum dado encontrado.</p>';
            btnSave.classList.add('hidden');
            return;
        }

        const manualCount = pendingUpdates.filter(item => !item.id).length;
        setStatus(
            manualCount > 0
                ? `${pendingUpdates.length} linha(s) com pontuação encontrada(s). Escolha o membro nas linhas amarelas antes de salvar.`
                : `${pendingUpdates.length} membro(s) identificado(s)! Verifique antes de salvar.`
        );

        resultDiv.innerHTML = pendingUpdates.map((m, index) => {
            const displayName = m.nick || m.rawLabel || 'Membro não identificado';
            const scoreText = Number.isFinite(Number(m.matchScore)) ? `${Math.round((m.matchScore || 0) * 100)}%` : '';
            return `
             <div class="p-3.5 bg-white border ${m.id ? 'border-gray-100' : 'border-amber-200'} rounded-xl mb-2 shadow-sm">
                <div class="flex items-start justify-between gap-3">
                  <div class="flex-1 min-w-0 flex items-center gap-3">
                    <div class="w-8 h-8 rounded-full ${m.id ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'} flex items-center justify-center flex-shrink-0 font-bold text-xs">
                      ${escapeHtml((displayName || '?').charAt(0).toUpperCase())}
                    </div>
                    <div class="min-w-0 flex-1">
                      <div class="flex items-center gap-2 flex-wrap">
                        <p class="font-bold text-gray-900 text-sm truncate">${escapeHtml(displayName)}</p>
                        ${getBadge(m)}
                      </div>
                      <p class="text-[10px] text-gray-400 font-medium mt-0.5">OCR: ${escapeHtml((m.sourceText || '').slice(0, 90))}${scoreText ? ` • match ${scoreText}` : ''}</p>
                    </div>
                  </div>
                  <div class="flex gap-3 text-right flex-shrink-0">
                    ${m.gg !== undefined ? `<div><p class="text-[10px] text-gray-400 uppercase font-bold">GG</p><p class="text-sm font-bold text-gray-900">${escapeHtml(m.gg)}</p></div>` : ''}
                    ${m.honra !== undefined ? `<div><p class="text-[10px] text-gray-400 uppercase font-bold">Honra</p><p class="text-sm font-bold text-gray-900">${escapeHtml(m.honra)}</p></div>` : ''}
                  </div>
                </div>
                <div class="mt-3 ${m.id ? 'hidden' : ''}">
                  <select data-print-member-index="${index}" class="w-full px-3 py-2.5 rounded-xl border border-amber-200 bg-amber-50/50 text-sm font-semibold text-gray-700 outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100">
                    ${memberOptionsHtml(m.id)}
                  </select>
                </div>
             </div>
            `;
        }).join('');

        btnSave.classList.remove('hidden');
        if (window.lucide) window.lucide.createIcons();
    }

    function collectSelectedUpdates() {
        const merged = new Map();

        pendingUpdates.forEach((item, index) => {
            const copy = { ...item };
            if (!copy.id) {
                const select = document.querySelector(`[data-print-member-index="${index}"]`);
                const selectedId = select?.value || '';
                if (selectedId) {
                    const member = membersList.find(m => String(m.id || '') === String(selectedId));
                    if (member) {
                        copy.id = member.id;
                        copy.visibleId = member.visibleId;
                        copy.nick = getMemberDisplayName(member);
                    }
                }
            }

            if (!copy.id || !hasAnyValue(copy)) return;

            const key = String(copy.id);
            const existing = merged.get(key) || {
                id: copy.id,
                visibleId: copy.visibleId,
                nick: copy.nick
            };
            if (copy.gg !== undefined) existing.gg = copy.gg;
            if (copy.honra !== undefined) existing.honra = copy.honra;
            merged.set(key, existing);
        });

        return Array.from(merged.values());
    }

    if (input && resultDiv && btnSave) {
        input.addEventListener('change', async (e) => {
            const files = Array.from(e.target.files || []);
            if (files.length === 0) return;

            btnSave.classList.add('hidden');
            btnSave.disabled = false;
            btnSave.innerHTML = 'Confirmar e Salvar Pontuações';
            resultDiv.innerHTML = '<div class="flex justify-center p-4"><i data-lucide="loader-2" class="w-6 h-6 text-emerald-500 animate-spin"></i></div>';
            if (window.lucide) window.lucide.createIcons();

            if (!window.Tesseract || typeof window.Tesseract.recognize !== 'function') {
                setStatus('O leitor OCR não carregou. Recarregue a página e tente novamente.');
                resultDiv.innerHTML = '<p class="text-center text-red-500 text-sm p-4">Erro ao carregar o leitor de prints.</p>';
                return;
            }

            try {
                const pages = [];
                for (let i = 0; i < files.length; i++) {
                    const filePages = await readFileWithOcr(files[i], i, files.length);
                    pages.push(...filePages);
                }

                setStatus('Processando pontuações...');
                pendingUpdates = extractDataFromPages(pages);
                renderResults();
            } catch (err) {
                console.error('Erro ao processar prints:', err);
                setStatus('Erro ao processar os prints. Tente novamente com outro print.');
                resultDiv.innerHTML = '<p class="text-center text-red-500 text-sm p-4">Erro ao ler imagem.</p>';
            }
        });
    }

    if (btnSave) {
        btnSave.addEventListener('click', async () => {
            const selectedUpdates = collectSelectedUpdates();
            if (selectedUpdates.length === 0) {
                setStatus('Escolha pelo menos um membro nas linhas encontradas antes de salvar.');
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
