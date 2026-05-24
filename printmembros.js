// printmembros.js
// Leitor de prints com OCR + revisão manual.
// Versão reforçada: usa posição dos textos na imagem para pegar a pontuação correta
// e SEMPRE permite trocar o membro sugerido antes de salvar.
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
        'dos', 'br', 'nv', 'nw', 'nivel', 'level', 'on', 'line', 'ocr', 'match'
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

        // Corta só a parte da tabela. Isso evita pegar moedas, diamantes, nível do perfil, etc.
        if (variant === 'score-table') {
            return { x: w * 0.145, y: h * 0.085, w: w * 0.535, h: h * 0.86 };
        }
        if (variant === 'weekly-table') {
            return { x: w * 0.18, y: h * 0.12, w: w * 0.49, h: h * 0.78 };
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
        ctx.drawImage(img, crop.x, crop.y, crop.w, crop.h, 0, 0, canvas.width, canvas.height);

        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const data = imageData.data;

        for (let i = 0; i < data.length; i += 4) {
            const r = data[i];
            const g = data[i + 1];
            const b = data[i + 2];
            const brightness = (r * 0.299) + (g * 0.587) + (b * 0.114);

            if (variant.mode === 'mask') {
                // Isola letras claras/amarelas. Ajuda muito no texto do Free Fire.
                const isYellow = r > 115 && g > 90 && b < 145;
                const isWhite = r > 150 && g > 150 && b > 135;
                const isBlueWhite = r > 105 && g > 135 && b > 145;
                const ink = (isYellow || isWhite || isBlueWhite) ? 0 : 255;
                data[i] = ink;
                data[i + 1] = ink;
                data[i + 2] = ink;
            } else {
                // Contraste forte, mas sem destruir tanto os números.
                let v = (brightness - 105) * 2.05 + 128;
                v = Math.max(0, Math.min(255, v));
                data[i] = v;
                data[i + 1] = v;
                data[i + 2] = v;
            }
        }

        ctx.putImageData(imageData, 0, 0);
        return canvas;
    }

    function normalizeOcrWords(data) {
        const rawWords = Array.isArray(data?.words) ? data.words : [];
        return rawWords.map(word => {
            const bbox = word.bbox || word.boundingBox || {};
            const x0 = Number(bbox.x0 ?? bbox.left ?? word.x0 ?? 0);
            const y0 = Number(bbox.y0 ?? bbox.top ?? word.y0 ?? 0);
            const x1 = Number(bbox.x1 ?? (bbox.left + bbox.width) ?? word.x1 ?? 0);
            const y1 = Number(bbox.y1 ?? (bbox.top + bbox.height) ?? word.y1 ?? 0);
            const text = String(word.text || '').trim();
            return {
                text,
                x0,
                y0,
                x1,
                y1,
                cx: (x0 + x1) / 2,
                cy: (y0 + y1) / 2,
                w: Math.max(1, x1 - x0),
                h: Math.max(1, y1 - y0),
                conf: Number(word.confidence ?? word.conf ?? 0)
            };
        }).filter(w => w.text && Number.isFinite(w.cx) && Number.isFinite(w.cy));
    }

    async function recognizeCanvas(canvas, variant) {
        const options = {
            tessedit_pageseg_mode: '6',
            tessedit_char_whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-.%/ ÀÁÂÃÉÊÍÓÔÕÚÜÇàáâãéêíóôõúüç'
        };

        try {
            const { data } = await window.Tesseract.recognize(canvas, OCR_LANGUAGE, options);
            return {
                text: data?.text || '',
                words: normalizeOcrWords(data),
                width: canvas.width,
                height: canvas.height,
                variant: variant.name
            };
        } catch (err) {
            console.warn('Falha no OCR com eng+por, tentando por:', err);
            const { data } = await window.Tesseract.recognize(canvas, 'por', options);
            return {
                text: data?.text || '',
                words: normalizeOcrWords(data),
                width: canvas.width,
                height: canvas.height,
                variant: variant.name
            };
        }
    }

    async function readFileWithOcr(file, fileIndex, totalFiles) {
        const img = await loadImage(file);
        const variants = [
            { name: 'score-table', mode: 'gray', scale: 3.4 },
            { name: 'score-table', mode: 'mask', scale: 3.4 },
            { name: 'weekly-table', mode: 'gray', scale: 3.2 },
            { name: 'weekly-table', mode: 'mask', scale: 3.2 }
        ];

        const pages = [];
        for (let i = 0; i < variants.length; i++) {
            const variant = variants[i];
            setStatus(`Analisando print ${fileIndex + 1} de ${totalFiles}... etapa ${i + 1}/${variants.length}`);
            const canvas = prepareCanvas(img, variant);
            const page = await recognizeCanvas(canvas, variant);
            page.fileKey = file.name || `print-${fileIndex + 1}`;
            pages.push(page);
        }
        return pages;
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
                    : Math.min(matrix[i - 1][j - 1] + 1, matrix[i][j - 1] + 1, matrix[i - 1][j] + 1);
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
                if (best >= 0.93) return best;
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

        if (memberCompact.length >= 4 && textCompact.includes(memberCompact)) return 0.98;

        let best = bestSlidingSimilarity(textCompact, memberCompact);
        const tokens = memberNick.split(' ').filter(t => t.length >= 3 && !COMMON_WORDS.has(t));
        for (const token of tokens) {
            if (textNorm.includes(token)) best = Math.max(best, token.length >= 5 ? 0.84 : 0.72);
            best = Math.max(best, bestSlidingSimilarity(textCompact, token));
        }

        const visibleId = String(member.visibleId || '').trim();
        if (visibleId && text.includes(visibleId)) best = Math.max(best, 0.99);
        return best;
    }

    function findBestMember(text) {
        let best = null;
        for (const member of membersList) {
            const score = scoreMemberAgainstText(member, text);
            if (!best || score > best.score) best = { member, score };
        }
        return best;
    }

    function detectPageType(text, variant = '') {
        const norm = normalizeText(text);
        const compact = compactText(norm);
        if (
            norm.includes('pontuacao individual') ||
            compact.includes('pontuacaoindividual') ||
            norm.includes('placar individual') ||
            norm.includes('rodada') ||
            variant.includes('score')
        ) return 'score';
        if (
            norm.includes('esta semana') ||
            compact.includes('estasemana') ||
            norm.includes('membros online') ||
            norm.includes('status') ||
            norm.includes('gerenciar membros') ||
            variant.includes('weekly')
        ) return 'weekly';
        return 'unknown';
    }

    function cleanNumberText(value) {
        return String(value || '').replace(/[^0-9]/g, '');
    }

    function isProbablyLevel(word, rowWords) {
        const idx = rowWords.indexOf(word);
        const before = rowWords.slice(Math.max(0, idx - 2), idx).map(w => normalizeText(w.text)).join(' ');
        const after = rowWords.slice(idx + 1, idx + 3).map(w => normalizeText(w.text)).join(' ');
        return /(?:nv|nw|lv|nivel|level)$/.test(before) || /^(?:nv|nw|lv|nivel|level)/.test(after);
    }

    function median(values) {
        const nums = values.filter(Number.isFinite).sort((a, b) => a - b);
        if (!nums.length) return 20;
        return nums[Math.floor(nums.length / 2)];
    }

    function groupWordsIntoRows(words) {
        const sorted = words.slice().sort((a, b) => a.cy - b.cy || a.x0 - b.x0);
        const medH = median(sorted.map(w => w.h));
        const threshold = Math.max(18, medH * 0.75);
        const rows = [];

        sorted.forEach(word => {
            let row = rows.find(r => Math.abs(r.cy - word.cy) <= threshold);
            if (!row) {
                row = { words: [], cy: word.cy };
                rows.push(row);
            }
            row.words.push(word);
            row.cy = row.words.reduce((sum, w) => sum + w.cy, 0) / row.words.length;
        });

        return rows
            .map(row => ({
                words: row.words.sort((a, b) => a.x0 - b.x0),
                cy: row.cy,
                text: row.words.sort((a, b) => a.x0 - b.x0).map(w => w.text).join(' ')
            }))
            .sort((a, b) => a.cy - b.cy);
    }

    function numericGroupsInBand(rowWords, minX, maxX, pageType) {
        const numeric = rowWords
            .filter(w => w.cx >= minX && w.cx <= maxX)
            .filter(w => cleanNumberText(w.text))
            .filter(w => !isProbablyLevel(w, rowWords))
            .sort((a, b) => a.x0 - b.x0);

        if (!numeric.length) return [];

        const groups = [];
        numeric.forEach(word => {
            const n = cleanNumberText(word.text);
            if (!n) return;
            const last = groups[groups.length - 1];
            const maxGap = pageType === 'score' ? Math.max(42, word.h * 1.8) : Math.max(32, word.h * 1.4);
            if (last && Math.abs(last.cy - word.cy) < word.h * 0.9 && word.x0 - last.x1 <= maxGap) {
                last.raw += n;
                last.x1 = word.x1;
                last.cy = (last.cy + word.cy) / 2;
            } else {
                groups.push({ raw: n, x0: word.x0, x1: word.x1, cy: word.cy });
            }
        });

        return groups.map(g => ({ ...g, value: parseInt(g.raw, 10) })).filter(g => Number.isFinite(g.value));
    }

    function extractValueFromRow(row, page, pageType) {
        const width = page.width || 1;
        if (pageType === 'score') {
            // No placar individual/GG, a pontuação fica na coluna mais à direita da tabela.
            const groups = numericGroupsInBand(row.words, width * 0.60, width * 0.98, pageType)
                .filter(g => g.value >= 1 && g.value <= 9999 && String(g.raw).length <= 4);
            if (!groups.length) return {};
            const best = groups.sort((a, b) => b.x1 - a.x1)[0];
            return { gg: best.value };
        }

        if (pageType === 'weekly') {
            // Na lista de membros, a honra semanal fica na coluna central/direita chamada ESTA SEMANA.
            const groups = numericGroupsInBand(row.words, width * 0.46, width * 0.76, pageType)
                .filter(g => g.value >= 10 && g.value <= 99999 && String(g.raw).length >= 2);
            if (!groups.length) return {};
            const best = groups.sort((a, b) => b.value - a.value)[0];
            return { honra: best.value };
        }

        return {};
    }

    function candidateLabelFromText(text) {
        const words = normalizeText(text)
            .split(' ')
            .filter(w => w.length >= 2 && !COMMON_WORDS.has(w) && !/^\d+$/.test(w));
        return words.slice(0, 5).join(' ') || 'Linha sem nick legível';
    }

    function rowHasName(row) {
        const text = normalizeText(row.text);
        if (!text || text.length < 2) return false;
        if (/^(patente|apelido|pontuacao|status|membros|esta|semana|rodada|melhores)/.test(text)) return false;
        return /[a-z]/.test(text);
    }

    function hasAnyValue(candidate) {
        return Number.isFinite(Number(candidate.gg)) || Number.isFinite(Number(candidate.honra));
    }

    function extractSpatialCandidates(page) {
        const pageType = detectPageType(page.text, page.variant);
        if (!Array.isArray(page.words) || page.words.length < 4) return [];

        const rows = groupWordsIntoRows(page.words);
        const candidates = [];

        rows.forEach((row, index) => {
            if (!rowHasName(row)) return;

            // Às vezes o OCR separa nick e número em linhas vizinhas. Junta um contexto curto.
            const contextRows = [rows[index - 1], row, rows[index + 1]].filter(Boolean);
            const contextText = contextRows.map(r => r.text).join(' ');
            const values = extractValueFromRow(row, page, pageType);
            if (!hasAnyValue(values)) return;

            const best = findBestMember(contextText);
            // Só deixa como sugestão automática acima de um mínimo. Mesmo assim o usuário pode trocar.
            const matched = best && best.score >= 0.70 ? best.member : null;

            candidates.push({
                id: matched?.id,
                visibleId: matched?.visibleId,
                nick: matched ? getMemberDisplayName(matched) : '',
                gg: values.gg,
                honra: values.honra,
                matchScore: best?.score || 0,
                rawLabel: candidateLabelFromText(contextText),
                sourceText: contextText,
                pageType,
                variant: page.variant
            });
        });

        return candidates;
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

    function extractTextFallbackCandidates(page) {
        const pageType = detectPageType(page.text, page.variant);
        const lines = String(page.text || '').split('\n').map(l => l.trim()).filter(Boolean);
        const candidates = [];

        for (let i = 0; i < lines.length; i++) {
            const block = [lines[i], lines[i + 1]].filter(Boolean).join(' ');
            const nums = extractNumbersWithContext(block).filter(n => !n.isLevel && !n.isPercent && !n.isRound && !n.isRatio);
            if (!nums.length) continue;

            let values = {};
            if (pageType === 'score') {
                const valid = nums.map(n => n.value).filter(v => v >= 20 && v <= 9999);
                if (valid.length) values.gg = valid[valid.length - 1];
            } else if (pageType === 'weekly') {
                const valid = nums.map(n => n.value).filter(v => v >= 100 && v <= 99999);
                if (valid.length) values.honra = Math.max(...valid);
            }
            if (!hasAnyValue(values)) continue;

            const best = findBestMember(block);
            const matched = best && best.score >= 0.70 ? best.member : null;
            candidates.push({
                id: matched?.id,
                visibleId: matched?.visibleId,
                nick: matched ? getMemberDisplayName(matched) : '',
                gg: values.gg,
                honra: values.honra,
                matchScore: best?.score || 0,
                rawLabel: candidateLabelFromText(block),
                sourceText: block,
                pageType,
                variant: page.variant
            });
        }
        return candidates;
    }

    function candidateQuality(candidate) {
        let q = 0;
        if (candidate.pageType === 'score' && Number.isFinite(Number(candidate.gg))) {
            q += candidate.gg >= 20 ? 4 : -8;
            q += Math.min(3, String(candidate.gg).length);
        }
        if (candidate.pageType === 'weekly' && Number.isFinite(Number(candidate.honra))) {
            q += candidate.honra >= 100 ? 4 : -6;
            q += Math.min(5, String(candidate.honra).length);
        }
        if (candidate.id) q += 1;
        if ((candidate.matchScore || 0) >= 0.85) q += 1;
        return q;
    }

    function chooseBestPageCandidates(pagesForFile) {
        const attempts = pagesForFile.map(page => {
            let candidates = extractSpatialCandidates(page);
            if (!candidates.length) candidates = extractTextFallbackCandidates(page);
            const pageType = detectPageType(page.text, page.variant);
            const quality = candidates.reduce((sum, c) => sum + candidateQuality(c), 0)
                + (pageType === 'score' || pageType === 'weekly' ? 2 : 0)
                - Math.max(0, candidates.length - 20);
            return { page, candidates, quality };
        });

        attempts.sort((a, b) => b.quality - a.quality);
        return attempts[0]?.candidates || [];
    }

    function mergeCandidateIntoMap(map, candidate) {
        if (!hasAnyValue(candidate)) return;

        const valueKey = `${candidate.gg ?? ''}:${candidate.honra ?? ''}`;
        const textKey = compactText(candidate.sourceText || candidate.rawLabel || '').slice(0, 42);
        const memberKey = candidate.id ? `member:${candidate.id}:${candidate.pageType}` : `unknown:${candidate.pageType}:${valueKey}:${textKey}`;

        const existing = map.get(memberKey);
        if (existing) {
            if (candidate.gg !== undefined) existing.gg = candidate.gg;
            if (candidate.honra !== undefined) existing.honra = candidate.honra;
            existing.sourceText = existing.sourceText || candidate.sourceText;
            existing.matchScore = Math.max(existing.matchScore || 0, candidate.matchScore || 0);
            return;
        }
        map.set(memberKey, candidate);
    }

    function extractDataFromPages(pages) {
        const byFile = new Map();
        pages.forEach(page => {
            const key = page.fileKey || 'print';
            if (!byFile.has(key)) byFile.set(key, []);
            byFile.get(key).push(page);
        });

        const map = new Map();
        byFile.forEach(pagesForFile => {
            const candidates = chooseBestPageCandidates(pagesForFile);
            candidates.forEach(candidate => mergeCandidateIntoMap(map, candidate));
        });

        return Array.from(map.values()).filter(hasAnyValue).slice(0, 80);
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
            return '<span class="px-2 py-1 rounded-full bg-emerald-50 text-emerald-700 text-[10px] font-bold border border-emerald-100">Sugestão</span>';
        }
        return '<span class="px-2 py-1 rounded-full bg-amber-50 text-amber-700 text-[10px] font-bold border border-amber-100">Escolha manual</span>';
    }

    function renderValueInput(index, key, value, label) {
        if (value === undefined) return '';
        return `
            <label class="block">
                <span class="text-[10px] text-gray-400 uppercase font-bold">${label}</span>
                <input data-print-${key}-index="${index}" type="number" min="0" value="${escapeHtml(value)}" class="mt-1 w-24 px-3 py-2 rounded-xl border border-gray-200 bg-white text-right text-sm font-bold text-gray-900 outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100">
            </label>
        `;
    }

    function renderResults() {
        if (!resultDiv || !btnSave) return;

        if (pendingUpdates.length === 0) {
            setStatus('Nenhuma pontuação foi encontrada. Tente enviar o print sem cortar e com boa resolução.');
            resultDiv.innerHTML = '<p class="text-center text-gray-500 text-sm p-4">Nenhum dado encontrado.</p>';
            btnSave.classList.add('hidden');
            return;
        }

        const suggestedCount = pendingUpdates.filter(item => item.id).length;
        setStatus(`${pendingUpdates.length} linha(s) com pontuação encontrada(s). Revise o membro e a pontuação antes de salvar. ${suggestedCount ? 'Algumas linhas já vêm com sugestão automática.' : ''}`);

        resultDiv.innerHTML = pendingUpdates.map((m, index) => {
            const displayName = m.nick || m.rawLabel || 'Membro não identificado';
            const scoreText = Number.isFinite(Number(m.matchScore)) && m.matchScore > 0 ? `${Math.round((m.matchScore || 0) * 100)}%` : '';
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
                  <div class="flex gap-2 text-right flex-shrink-0">
                    ${renderValueInput(index, 'gg', m.gg, 'GG')}
                    ${renderValueInput(index, 'honra', m.honra, 'Honra')}
                  </div>
                </div>
                <div class="mt-3">
                  <select data-print-member-index="${index}" class="w-full px-3 py-2.5 rounded-xl border ${m.id ? 'border-gray-200 bg-white' : 'border-amber-200 bg-amber-50/50'} text-sm font-semibold text-gray-700 outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100">
                    ${memberOptionsHtml(m.id)}
                  </select>
                </div>
             </div>
            `;
        }).join('');

        btnSave.classList.remove('hidden');
        if (window.lucide) window.lucide.createIcons();
    }

    function readNumberInput(index, key) {
        const inputEl = document.querySelector(`[data-print-${key}-index="${index}"]`);
        if (!inputEl) return undefined;
        const value = Number(inputEl.value);
        return Number.isFinite(value) ? value : undefined;
    }

    function collectSelectedUpdates() {
        const merged = new Map();

        pendingUpdates.forEach((item, index) => {
            const select = document.querySelector(`[data-print-member-index="${index}"]`);
            const selectedId = select?.value || item.id || '';
            if (!selectedId) return;

            const member = membersList.find(m => String(m.id || '') === String(selectedId));
            if (!member) return;

            const gg = readNumberInput(index, 'gg');
            const honra = readNumberInput(index, 'honra');
            if (!Number.isFinite(Number(gg)) && !Number.isFinite(Number(honra))) return;

            const key = String(member.id);
            const existing = merged.get(key) || {
                id: member.id,
                visibleId: member.visibleId,
                nick: getMemberDisplayName(member)
            };
            if (Number.isFinite(Number(gg))) existing.gg = Number(gg);
            if (Number.isFinite(Number(honra))) existing.honra = Number(honra);
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
