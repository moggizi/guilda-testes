// printmembros.js
export function setupPrintScanner({ onSave }) {
    let membersList = [];
    let pendingUpdates = [];

    const input = document.getElementById('upload-prints');
    const resultDiv = document.getElementById('print-results');
    const btnSave = document.getElementById('btn-save-prints');
    const statusText = document.getElementById('print-status');

    function updateCache(cache) {
        membersList = cache;
        resetScanner();
    }

    function resetScanner() {
        if(input) input.value = '';
        if(resultDiv) resultDiv.innerHTML = '';
        if(btnSave) btnSave.classList.add('hidden');
        if(statusText) statusText.innerText = 'Selecione os prints para começar a leitura.';
        pendingUpdates = [];
    }

    if(input) {
        input.addEventListener('change', async (e) => {
            const files = e.target.files;
            if (!files || files.length === 0) return;

            btnSave.classList.add('hidden');
            resultDiv.innerHTML = '<div class="flex justify-center p-4"><i data-lucide="loader-2" class="w-6 h-6 text-emerald-500 animate-spin"></i></div>';
            if (window.lucide) window.lucide.createIcons();

            let fullText = "";

            for (let i = 0; i < files.length; i++) {
                statusText.innerText = `Analisando imagem ${i + 1} de ${files.length}... (Aguarde)`;
                try {
                    const { data: { text } } = await Tesseract.recognize(files[i], 'por');
                    fullText += text + "\n";
                } catch (err) {
                    console.error("Erro ao ler imagem", err);
                }
            }

            statusText.innerText = `Processando dados...`;
            pendingUpdates = extractDataFromText(fullText);
            renderResults();
        });
    }

    function extractDataFromText(text) {
        const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0);
        let extracted = [];
        let membersFound = new Set();

        membersList.forEach(member => {
            const nick = (member.nick || "").toLowerCase();
            if (!nick) return;
            
            for (let i = 0; i < lines.length; i++) {
                const line = lines[i].toLowerCase();
                
                if (line.includes(nick) || (member.visibleId && line.includes(member.visibleId.toString()))) {
                    if (membersFound.has(member.id)) break; 
                    
                    const textNearName = line + " " + (lines[i+1] || "") + " " + (lines[i+2] || "");
                    const numbersFound = textNearName.match(/\d+/g);
                    
                    if (numbersFound && numbersFound.length >= 2) {
                        const num1 = parseInt(numbersFound[0]);
                        const num2 = parseInt(numbersFound[1]);
                        
                        const gg = Math.min(num1, num2);
                        const honra = Math.max(num1, num2);

                        extracted.push({
                            id: member.id,
                            visibleId: member.visibleId,
                            nick: member.nick,
                            gg: gg,
                            honra: honra
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
        if (pendingUpdates.length === 0) {
            statusText.innerText = "Nenhum membro reconhecido. Verifique a qualidade dos prints.";
            resultDiv.innerHTML = '<p class="text-center text-gray-500 text-sm p-4">Nenhum dado encontrado.</p>';
            return;
        }

        statusText.innerText = `${pendingUpdates.length} membros identificados! Verifique antes de salvar.`;
        
        resultDiv.innerHTML = pendingUpdates.map(m => `
             <div class="flex items-center justify-between p-3.5 bg-white border border-gray-100 rounded-xl mb-2 shadow-sm">
                <div class="flex-1 min-w-0 flex items-center gap-3">
                  <div class="w-8 h-8 rounded-full bg-emerald-100 flex items-center justify-center flex-shrink-0 text-emerald-700 font-bold text-xs">
                    ${m.nick.charAt(0).toUpperCase()}
                  </div>
                  <div>
                    <p class="font-bold text-gray-900 text-sm truncate">${m.nick}</p>
                    <p class="text-[11px] text-gray-400 font-medium">ID: ${m.visibleId || '?'}</p>
                  </div>
                </div>
                <div class="flex gap-3 text-right">
                    <div>
                        <p class="text-[10px] text-gray-400 uppercase font-bold">GG</p>
                        <p class="text-sm font-bold text-gray-900">${m.gg}</p>
                    </div>
                    <div>
                        <p class="text-[10px] text-gray-400 uppercase font-bold">Honra</p>
                        <p class="text-sm font-bold text-gray-900">${m.honra}</p>
                    </div>
                </div>
             </div>
        `).join('');

        btnSave.classList.remove('hidden');
        if (window.lucide) window.lucide.createIcons();
    }

    if(btnSave) {
        btnSave.addEventListener('click', () => {
            if (pendingUpdates.length > 0) {
                btnSave.innerHTML = '<i data-lucide="loader-2" class="w-4 h-4 animate-spin inline mr-2"></i> Salvando...';
                btnSave.disabled = true;
                onSave(pendingUpdates);
            }
        });
    }

    return { updateCache, resetScanner };
}
