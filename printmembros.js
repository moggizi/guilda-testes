// printmembros.js
export function setupPrintScanner({ onSave }) {
    let membersList = [];
    let pendingUpdates = [];

    const input = document.getElementById('upload-prints');
    const resultDiv = document.getElementById('print-results');
    const btnSave = document.getElementById('btn-save-prints');
    const statusText = document.getElementById('print-status');

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

    function updateCache(cache) {
        membersList = Array.isArray(cache) ? cache : [];
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

    if (input && resultDiv && btnSave) {
        input.addEventListener('change', async (e) => {
            const files = e.target.files;
            if (!files || files.length === 0) return;

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

            let fullText = "";

            for (let i = 0; i < files.length; i++) {
                setStatus(`Analisando imagem ${i + 1} de ${files.length}...`);
                try {
                    const { data: { text } } = await window.Tesseract.recognize(files[i], 'por');
                    fullText += text + "\n";
                } catch (err) {
                    console.error("Erro ao ler imagem", err);
                }
            }

            setStatus('Processando dados...');
            pendingUpdates = extractDataFromText(fullText);
            renderResults();
        });
    }

    function extractDataFromText(text) {
        const lines = String(text || '').split('\n').map(l => l.trim()).filter(l => l.length > 0);
        const extracted = [];
        const membersFound = new Set();

        membersList.forEach(member => {
            const nick = (member.nick || "").toLowerCase();
            const visibleId = member.visibleId ? String(member.visibleId) : "";
            if (!nick && !visibleId) return;

            for (let i = 0; i < lines.length; i++) {
                const line = lines[i].toLowerCase();
                const foundByNick = nick && line.includes(nick);
                const foundById = visibleId && line.includes(visibleId);

                if (foundByNick || foundById) {
                    if (membersFound.has(member.id)) break;

                    const textNearName = `${line} ${lines[i + 1] || ""} ${lines[i + 2] || ""}`;
                    const numbersFound = textNearName.match(/\d+/g);

                    if (numbersFound && numbersFound.length >= 2) {
                        const num1 = parseInt(numbersFound[0], 10);
                        const num2 = parseInt(numbersFound[1], 10);

                        const gg = Math.min(num1, num2);
                        const honra = Math.max(num1, num2);

                        extracted.push({
                            id: member.id,
                            visibleId: member.visibleId,
                            nick: member.nick,
                            gg,
                            honra
                        });
                        membersFound.add(member.id);
                        break;
                    }
                }
            }
        });

        return extracted;
    }

    function renderResults() {
        if (!resultDiv || !btnSave) return;

        if (pendingUpdates.length === 0) {
            setStatus("Nenhum membro reconhecido. Verifique a qualidade dos prints.");
            resultDiv.innerHTML = '<p class="text-center text-gray-500 text-sm p-4">Nenhum dado encontrado.</p>';
            return;
        }

        setStatus(`${pendingUpdates.length} membro(s) identificado(s)! Verifique antes de salvar.`);

        resultDiv.innerHTML = pendingUpdates.map(m => `
             <div class="flex items-center justify-between p-3.5 bg-white border border-gray-100 rounded-xl mb-2 shadow-sm">
                <div class="flex-1 min-w-0 flex items-center gap-3">
                  <div class="w-8 h-8 rounded-full bg-emerald-100 flex items-center justify-center flex-shrink-0 text-emerald-700 font-bold text-xs">
                    ${escapeHtml((m.nick || '?').charAt(0).toUpperCase())}
                  </div>
                  <div>
                    <p class="font-bold text-gray-900 text-sm truncate">${escapeHtml(m.nick || 'Sem nick')}</p>
                    <p class="text-[11px] text-gray-400 font-medium">ID: ${escapeHtml(m.visibleId || '?')}</p>
                  </div>
                </div>
                <div class="flex gap-3 text-right">
                    <div>
                        <p class="text-[10px] text-gray-400 uppercase font-bold">GG</p>
                        <p class="text-sm font-bold text-gray-900">${escapeHtml(m.gg)}</p>
                    </div>
                    <div>
                        <p class="text-[10px] text-gray-400 uppercase font-bold">Honra</p>
                        <p class="text-sm font-bold text-gray-900">${escapeHtml(m.honra)}</p>
                    </div>
                </div>
             </div>
        `).join('');

        btnSave.classList.remove('hidden');
        if (window.lucide) window.lucide.createIcons();
    }

    if (btnSave) {
        btnSave.addEventListener('click', async () => {
            if (pendingUpdates.length > 0) {
                btnSave.innerHTML = '<i data-lucide="loader-2" class="w-4 h-4 animate-spin inline mr-2"></i> Salvando...';
                btnSave.disabled = true;
                if (window.lucide) window.lucide.createIcons();
                await onSave(pendingUpdates);
            }
        });
    }

    return { updateCache, resetScanner };
}
