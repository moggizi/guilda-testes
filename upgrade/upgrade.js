import { checkAuth, setupSidebar, initIcons, logout, getVipTier, showToast, getGuildContext, applyVipUiAndGates, auth } from '../logic.js?v=upgrade-admin-20260517';

  // Ícones do sidebar são inicializados na hora!
  setupSidebar();
  initIcons();

  try { localStorage.removeItem('plans_upgrade_cache_v2'); } catch (_) {}

  function normalizeTier(raw){
    const s = (raw || 'free').toString().toLowerCase().trim();
    if (s.includes('vital') || s.includes('life')) return 'vitalicio';
    if (s.includes('buss') || s.includes('business')) return 'business';
    if (s.includes('pro')) return 'pro';
    if (s.includes('plus')) return 'plus';
    return 'free';
  }

  function prettyTierName(tier){
    return normalizeTier(tier) === 'vitalicio' ? 'VITALÍCIO' : normalizeTier(tier).toUpperCase();
  }

  function computeDiscounts(plans){
    const fullMonthly = 9.99;
    const fullAnnual = fullMonthly * 12;

    return plans.map(p => {
      let discount = 0;
      if (p.id === 'free') discount = 100;
      else if (p.id === 'plus' || p.id === 'pro') discount = Math.round((1 - (p.price / fullMonthly)) * 100);
      else if (p.id === 'business') discount = Math.round((1 - (p.price / fullAnnual)) * 100);
      return { ...p, discount: discount > 0 ? discount : 0 };
    });
  }

  function getPlans(){
    const basePlans = [
      {
        id: 'free',
        name: 'FREE',
        price: 0,
        priceLabel: 'R$0 / mês',
        access: ['Dashboard', 'Membros', 'Configuração de tag'],
        noAccess: ['Administradores + Líderes', 'Lines', 'Estatísticas', 'Recrutamento (BETA)', 'Multi-guilda (BETA)', 'Atualizar pontos por print', 'Eventos/Camp (EM BREVE)']
      },
      {
        id: 'plus',
        name: 'PLUS',
        price: 6.99,
        priceLabel: 'R$6,99 / mês',
        access: ['Dashboard', 'Membros', 'Configuração de tag', 'Administradores + Líderes', 'Lines', 'Estatísticas'],
        noAccess: ['Recrutamento (BETA)', 'Multi-guilda (BETA)', 'Atualizar pontos por print', 'Eventos/Camp (EM BREVE)']
      },
      {
        id: 'pro',
        name: 'PRO',
        price: 9.99,
        priceLabel: 'R$9,99 / mês',
        access: ['Dashboard', 'Membros', 'Configuração de tag', 'Administradores + Líderes', 'Lines', 'Estatísticas', 'Recrutamento (BETA)', 'Multi-guilda (BETA)', 'Atualizar pontos por print', 'Eventos/Camp (EM BREVE)'],
        noAccess: []
      },
      {
        id: 'business',
        name: 'BUSINESS',
        price: 99.90,
        priceLabel: 'R$99,90 / ano',
        access: ['Dashboard', 'Membros', 'Configuração de tag', 'Administradores + Líderes', 'Lines', 'Estatísticas', 'Recrutamento (BETA)', 'Multi-guilda (BETA)', 'Atualizar pontos por print', 'Eventos/Camp (EM BREVE)'],
        noAccess: [], 
        note: '+ 2 meses grátis!'
      },
      {
        id: 'vitalicio',
        name: 'VITALÍCIO',
        price: 599.99,
        priceLabel: 'R$599,99 pagamento único',
        access: [],
        noAccess: [],
        fullAccessText: 'Acesso total a tudo que é VIP e a todos os futuros sistemas da plataforma.',
        note: 'Pagamento único com acesso total enquanto a Guilda HUB estiver operando; se a plataforma for encerrada no futuro, o plano também será finalizado, sem reembolso.'
      },
    ];

    return computeDiscounts(basePlans);
  }

  // --- Pagamento Mercado Pago (PIX automático) ------------------------------
  
  // NOVA FUNÇÃO: Modal de Identificação (Passo 1)
  window.requestUpgrade = (planId) => {
    const root = ensureModalRoot();
    
    root.innerHTML = modalShell(`
      <div class="p-6">
       <div class="flex items-center gap-3 mb-4">
          
          <div class="flex items-center gap-3">
            <img src="/assets/logo.png" alt="Logo" class="app-logo app-logo--nav">
          </div>
          <div>
            <h3 class="text-lg font-extrabold text-gray-900">Identificação</h3>
            <p class="text-xs text-gray-500">Etapa de segurança anti-fraude</p>
          </div>
          <button class="ml-auto p-2 rounded-lg hover:bg-gray-100 text-gray-400" data-close="1">
            <i data-lucide="x" class="w-5 h-5"></i>
          </button>
        </div>

        <p class="text-sm text-gray-600 mb-6 leading-relaxed">
          Para sua segurança e conformidade com o sistema de pagamentos, precisamos do seu <b>CPF</b> para processar a geração do seu código PIX.
        </p>

        <div class="space-y-4">
          <div>
            <label class="block text-xs font-bold text-gray-400 uppercase tracking-wider mb-2">Digite seu CPF</label>
            <input 
              type="text" 
              id="input-cpf-field" 
              placeholder="000.000.000-00" 
              class="w-full px-4 py-3 rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 transition-all text-sm font-medium"
            >
          </div>
          
          <button id="btn-confirm-cpf" class="w-full py-4 rounded-xl bg-emerald-600 text-white font-extrabold text-sm hover:bg-emerald-700 shadow-lg shadow-emerald-200 transition-all flex items-center justify-center gap-2">
            Gerar Código PIX <i data-lucide="arrow-right" class="w-4 h-4"></i>
          </button>
        </div>
      </div>
    `);

    initIcons();

    const input = document.getElementById('input-cpf-field');
    const btn = document.getElementById('btn-confirm-cpf');

    // Máscara simples de CPF
    input.addEventListener('input', (e) => {
      let v = e.target.value.replace(/\D/g, '').slice(0, 11);
      if (v.length > 9) v = v.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, "$1.$2.$3-$4");
      else if (v.length > 6) v = v.replace(/(\d{3})(\d{3})(\d{3})/, "$1.$2.$3");
      else if (v.length > 3) v = v.replace(/(\d{3})(\d{3})/, "$1.$2");
      e.target.value = v;
    });

    btn.onclick = () => {
      const cpf = input.value.replace(/\D/g, '');
      if (cpf.length !== 11) {
        showToast('error', 'CPF inválido. Digite os 11 números.');
        return;
      }
      openPaymentModal(planId, cpf);
    };

    root.querySelectorAll('[data-close="1"]').forEach(el => el.addEventListener('click', closeModals));
  };

  function statusLabelFromMp(status){
    const s = (status || '').toString().toLowerCase();
    if (s === 'approved') return 'aprovado';
    if (s === 'pending' || s === 'in_process') return 'pendente';
    if (s === 'rejected') return 'recusado';
    if (s === 'cancelled' || s === 'expired' || s === 'refunded' || s === 'charged_back') return 'expirado';
    return s || 'pendente';
  }

  function badgeClass(status){
    const s = statusLabelFromMp(status);
    if (s === 'aprovado') return 'bg-emerald-50 text-emerald-700 ring-emerald-200';
    if (s === 'pendente') return 'bg-amber-50 text-amber-700 ring-amber-200';
    if (s === 'recusado') return 'bg-rose-50 text-rose-700 ring-rose-200';
    if (s === 'expirado') return 'bg-gray-100 text-gray-700 ring-gray-200';
    return 'bg-gray-100 text-gray-700 ring-gray-200';
  }

  async function createPixPayment(planId, cpf){
    const user = auth.currentUser;
    if (!user) throw new Error('Você precisa estar logado.');

    const ctx = await getGuildContext();
    const guildId = String(ctx?.guildId || '');
    const email = String(user.email || '');
    const uid = String(user.uid || '');

    if (!guildId || !email || !uid) {
      throw new Error('Dados ausentes (uid/email/guildId).');
    }

    const idToken = await user.getIdToken(true);

    const res = await fetch('/api/mp_create_pix', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${idToken}`
      },
      body: JSON.stringify({ plano: planId, guildId, cpf })
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data?.error || 'Falha ao criar pagamento.');
    return data;
  }

  async function fetchPaymentStatus(paymentId){
    const res = await fetch(`/api/mp_status?paymentId=${encodeURIComponent(paymentId)}`, { method: 'GET' });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data?.error || 'Falha ao consultar status.');
    return data;
  }

  function ensureModalRoot() {
    let root = document.getElementById('upgrade-modal-root');
    if (root) return root;
    root = document.createElement('div');
    root.id = 'upgrade-modal-root';
    document.body.appendChild(root);
    return root;
  }

  function closeModals() {
    const root = document.getElementById('upgrade-modal-root');
    if (root) root.innerHTML = '';
  }

  function modalShell(innerHtml) {
    return `
      <div class="fixed inset-0 z-[9999]">
        <div class="absolute inset-0 bg-black/40 backdrop-blur-sm transition-all" data-close="1"></div>
        <div class="absolute inset-0 flex items-end sm:items-center justify-center p-4">
          <div class="w-full max-w-lg bg-white rounded-3xl shadow-2xl border border-gray-100 overflow-hidden animate-in fade-in zoom-in duration-200">
            ${innerHtml}
          </div>
        </div>
      </div>
    `;
  }

  function openInfoModal(type){
    const root = ensureModalRoot();

    let title = 'Informações';
    let body = '';

    if (type === 'terms') {
      title = 'Termos dos planos';
      body = `
        <div class="space-y-4 text-sm text-gray-700 leading-6">
          <div class="rounded-xl border border-emerald-100 bg-emerald-50 p-3">
            <p><b>Plano Vitalício:</b> pagamento único de <b>R$599,99</b>, com acesso total a tudo que for VIP na plataforma e também aos futuros sistemas liberados enquanto a Guilda HUB continuar em operação.</p>
          </div>

          <div>
            <div class="font-extrabold text-gray-900 mb-1">1. Vigência do plano</div>
            <p>O plano Vitalício não funciona como assinatura mensal ou anual. Ele permanece ativo por todo o tempo em que a plataforma Guilda HUB estiver disponível, funcionando e sendo mantida por nossa equipe.</p>
          </div>

          <div>
            <div class="font-extrabold text-gray-900 mb-1">2. O que está incluído</div>
            <p>Ao adquirir este plano, a guilda vinculada à compra recebe acesso completo às funções VIP já existentes e também às novas ferramentas VIP que forem adicionadas futuramente durante a operação normal da plataforma.</p>
          </div>

          <div>
            <div class="font-extrabold text-gray-900 mb-1">3. Encerramento da plataforma</div>
            <p>Se em algum momento a Guilda HUB for encerrada, descontinuada, fechada ou deixar de operar definitivamente, o plano Vitalício também será considerado encerrado junto com a plataforma.</p>
          </div>

          <div>
            <div class="font-extrabold text-gray-900 mb-1">4. Reembolso</div>
            <p>Por se tratar de um plano com validade condicionada ao período de funcionamento da plataforma, <b>não haverá reembolso total nem parcial</b> em caso de encerramento futuro do projeto, paralisação definitiva dos serviços ou fechamento da plataforma.</p>
          </div>

          <div>
            <div class="font-extrabold text-gray-900 mb-1">5. Termos dos planos PLUS, PRO e BUSINESS</div>
           <p>Os planos PLUS, PRO e BUSINESS funcionam por prazo determinado, conforme a modalidade contratada no momento da compra. Durante esse período, a guilda terá acesso às funcionalidades incluídas no plano ativo. Após o vencimento, caso não haja renovação, o acesso às funções pagas poderá ser encerrado automaticamente.</p> <p>Em relação a reembolsos, caso seja necessário solicitar uma análise, o contato deverá ser feito pelo grupo de suporte no WhatsApp. Cada solicitação será analisada individualmente para verificar se está dentro da política de reembolso da plataforma. Pedidos de reembolso só poderão ser avaliados após 24 horas da contratação do plano.</p>  
           </div>

          <div>
            <div class="font-extrabold text-gray-900 mb-1">6. Liberação do acesso</div>
            <p>Depois da confirmação do pagamento, a liberação normalmente ocorre em poucos segundos para a conta/guilda vinculada à compra. Se o pagamento for aprovado e a ativação não acontecer, o suporte pode ser acionado pelo Instagram oficial informado na página.</p>
        </div>
      `;
    } else if (type === 'privacy') {
      title = 'Privacidade e dados do pagamento';
      body = `
        <div class="space-y-4 text-sm text-gray-700 leading-6">
          <div class="rounded-xl border border-slate-200 bg-slate-50 p-3">
            <p>Usamos somente os dados necessários para identificar a compra, confirmar o pagamento e liberar o plano corretamente na plataforma.</p>
          </div>

          <div>
            <div class="font-extrabold text-gray-900 mb-1">1. Dados utilizados</div>
            <p>Durante a solicitação do upgrade, podem ser utilizados dados como <b>e-mail da conta</b>, <b>ID do usuário</b>, <b>ID da guilda</b>, <b>plano escolhido</b> e <b>status do pagamento</b>.</p>
          </div>

          <div>
            <div class="font-extrabold text-gray-900 mb-1">2. Finalidade</div>
            <p>Essas informações são usadas exclusivamente para gerar o PIX, validar a aprovação do pagamento, registrar a solicitação e liberar o acesso correto para a guilda/conta vinculada.</p>
          </div>

          <div>
            <div class="font-extrabold text-gray-900 mb-1">3. Pagamentos</div>
            <p>O processamento do pagamento é realizado pelo <b>Mercado Pago</b>. Por isso, parte das informações necessárias para cobrança e confirmação da transação segue o fluxo normal dessa plataforma de pagamento.</p>
          </div>

          <div>
            <div class="font-extrabold text-gray-900 mb-1">4. Compartilhamento</div>
            <p>Não exibimos publicamente esses dados na plataforma e não utilizamos essas informações para finalidades diferentes da gestão do acesso e da confirmação do pagamento.</p>
          </div>

          <div>
            <div class="font-extrabold text-gray-900 mb-1">5. Suporte</div>
            <p>Se acontecer qualquer erro na ativação, poderemos consultar os registros da solicitação e do pagamento apenas para verificar o ocorrido e concluir a liberação correta do plano.</p>
          </div>
        </div>
      `;
    }

    root.innerHTML = modalShell(`
      <div class="p-4 border-b border-gray-100 flex items-center justify-between gap-3">
        <div>
          <div class="text-sm font-extrabold text-gray-900">${title}</div>
          <div class="text-xs text-gray-500 mt-0.5">Leia com atenção as informações abaixo.</div>
        </div>
        <button class="p-2 rounded-lg hover:bg-gray-50 text-gray-500" data-close="1"><i data-lucide="x" class="w-5 h-5"></i></button>
      </div>

      <div class="p-4 max-h-[80vh] overflow-y-auto">
        ${body}
      </div>
    `);

    root.querySelectorAll('[data-close="1"]').forEach(el => el.addEventListener('click', closeModals));
    initIcons();
  }


  function openPaymentModal(planId, cpf){
    const plan = (planId || '').toString().toLowerCase().trim();
    if (!['plus','pro','business','vitalicio'].includes(plan)) {
      showToast('error', 'Plano inválido.');
      return;
    }

    const root = ensureModalRoot();
    root.innerHTML = modalShell(`
      <div class="p-4 border-b border-gray-100 flex items-center justify-between gap-3">
        <div>
          <div class="text-sm font-extrabold text-gray-900">Pagamento via PIX — ${prettyTierName(plan)}</div>
          <div class="text-xs text-gray-500 mt-0.5">Gerando cobrança…</div>
        </div>
        <button class="p-2 rounded-lg hover:bg-gray-50 text-gray-500" data-close="1"><i data-lucide="x" class="w-5 h-5"></i></button>
      </div>

      <div class="p-4 space-y-4">
        <div class="flex items-center justify-between gap-3">
          <div class="text-xs text-gray-600">Status do pagamento</div>
          <div id="pay-status" class="inline-flex items-center gap-2 px-3 py-1.5 rounded-full ring-1 bg-gray-100 text-gray-700 ring-gray-200 text-xs font-extrabold">
            <span class="w-2 h-2 rounded-full bg-current opacity-70"></span>
            <span id="pay-status-text">pendente</span>
          </div>
        </div>

        <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div class="rounded-2xl border border-gray-200 bg-gray-50 p-4 flex items-center justify-center">
            <div class="text-center">
              <div id="qr-wrap" class="hidden">
                <img id="qr-img" class="mx-auto w-48 h-48 rounded-xl bg-white p-2 border border-gray-200" alt="QR Code PIX"/>
                <div class="mt-2 text-xs text-gray-600">Aponte a câmera do banco no QR Code</div>
              </div>
              <div id="qr-loading" class="text-sm text-gray-600">Carregando QR Code…</div>
            </div>
          </div>

          <div>
            <label class="text-xs font-bold text-gray-600">PIX Copia e Cola</label>
            <textarea id="pix-code" class="mt-2 w-full h-36 rounded-xl border border-gray-200 bg-gray-50 p-3 text-xs text-gray-800 focus:outline-none focus:ring-2 focus:ring-emerald-200" readonly></textarea>
            <div class="mt-3 flex flex-col sm:flex-row gap-2">
              <button id="btn-copy-pix" class="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-4 py-2 rounded-xl bg-gray-900 text-white text-sm font-bold hover:bg-black transition" disabled>
                <i data-lucide="copy" class="w-4 h-4"></i> Copiar código
              </button>
              <button id="btn-refresh-status" class="w-full sm:flex-1 inline-flex items-center justify-center gap-2 px-4 py-2 rounded-xl bg-emerald-600 text-white text-sm font-extrabold hover:bg-emerald-700 transition" disabled>
                <i data-lucide="refresh-ccw" class="w-4 h-4"></i> Atualizar status
              </button>
            </div>
            <div class="mt-2 text-[11px] text-gray-500">
              O status muda automaticamente quando o pagamento for aprovado.
            </div>
          </div>
        </div>
      </div>
    `);

    root.querySelectorAll('[data-close="1"]').forEach(el => el.addEventListener('click', () => { closeModals(); stopPoll(); }));

    let pollTimer = null;
    let currentPaymentId = null;

    function setStatus(mpStatus){
      const label = statusLabelFromMp(mpStatus);
      const pill = root.querySelector('#pay-status');
      const text = root.querySelector('#pay-status-text');
      if (text) text.textContent = label;

      if (pill) {
        pill.className = `inline-flex items-center gap-2 px-3 py-1.5 rounded-full ring-1 text-xs font-extrabold ${badgeClass(mpStatus)}`;
      }
    }

    function stopPoll(){
      if (pollTimer) clearInterval(pollTimer);
      pollTimer = null;
    }

    async function tick(){
      if (!currentPaymentId) return;
      try {
        const data = await fetchPaymentStatus(currentPaymentId);
        setStatus(data.status);

        if (statusLabelFromMp(data.status) === 'aprovado') {
          stopPoll();
          showToast('success', 'Pagamento aprovado! Liberando plano…');
          setTimeout(() => window.location.href = 'dashboard.html', 1200);
        }
      } catch (_) {
      }
    }

    const btnCopy = root.querySelector('#btn-copy-pix');
    const btnRefresh = root.querySelector('#btn-refresh-status');
    btnRefresh.onclick = () => tick();

    (async () => {
      try {
        const data = await createPixPayment(plan, cpf);
        currentPaymentId = data.paymentId;

        const ta = root.querySelector('#pix-code');
        if (ta) ta.value = data.qrCode || data.copiaECola || '';

        const qrLoading = root.querySelector('#qr-loading');
        const qrWrap = root.querySelector('#qr-wrap');
        const qrImg = root.querySelector('#qr-img');

        if ((data.qrBase64 || data.qrCodeBase64) && qrImg) {
          qrImg.src = `data:image/png;base64,${data.qrBase64 || data.qrCodeBase64}`;
          if (qrLoading) qrLoading.classList.add('hidden');
          if (qrWrap) qrWrap.classList.remove('hidden');
        } else {
          if (qrLoading) qrLoading.textContent = 'QR Code indisponível. Use o código Copia e Cola.';
        }

        setStatus(data.status || 'pending');

        if (btnCopy) btnCopy.disabled = false;
        if (btnRefresh) btnRefresh.disabled = false;

        if (btnCopy) {
          btnCopy.onclick = () => {
            const txt = (root.querySelector('#pix-code')?.value || '').trim();
            if (!txt) return;
            navigator.clipboard.writeText(txt);
            showToast('success', 'Código PIX copiado.');
          };
        }

        pollTimer = setInterval(tick, 3500);
        await tick();

      } catch (e) {
        showToast('error', e?.message || 'Erro ao gerar pagamento.');
        closeModals();
      } finally {
        initIcons();
      }
    })();

    initIcons();
  }

  // NOVA VERSÃO DA FUNÇÃO: AGORA LÊ DA MEMÓRIA DO APP (Seguro contra WebView)
  function render(){
    const plans = getPlans();
    
    // FIX WEBVIEW: Pega direto da memória do logic.js em vez do localStorage!
    const currentTier = normalizeTier(getVipTier());

    const pillName = document.getElementById('current-plan-name');
    if (pillName) pillName.textContent = prettyTierName(currentTier || 'free');

    const box = document.getElementById('plans');
    if (!box) return;

    box.innerHTML = plans.map(p => {
      const isCurrent = p.id === currentTier;
      const border = isCurrent ? 'border-emerald-200 ring-2 ring-emerald-100' : 'border-gray-200';
      const tag = isCurrent ? '<span class="px-2 py-1 rounded-lg bg-emerald-50 text-emerald-700 text-[10px] font-bold border border-emerald-200">Atual</span>' : '';

      const accessList = p.access.map(x => `<li class="flex items-start gap-2"><i data-lucide="check" class="w-3.5 h-3.5 mt-0.5 text-emerald-500"></i><span>${x}</span></li>`).join('');
      const noAccessList = (p.noAccess || []).map(x => `<li class="flex items-start gap-2 text-gray-400"><i data-lucide="x" class="w-3.5 h-3.5 mt-0.5"></i><span>${x}</span></li>`).join('');
      const accessContent = p.fullAccessText
        ? `<div class="text-[11px] text-gray-700 leading-5 bg-emerald-50 border border-emerald-100 rounded-lg p-3">${p.fullAccessText}</div>`
        : `<ul class="space-y-1.5 text-[11px] text-gray-700">${accessList}</ul>`;

      return `
        <div class="bg-white rounded-xl border ${border} p-3 shadow-sm flex flex-col h-full">
          <div class="flex items-center justify-between gap-2 mb-2">
            <h3 class="text-sm font-extrabold text-gray-900 truncate">${p.name}</h3>
            ${tag}
          </div>
          <div class="text-lg font-black text-gray-900 leading-none">${p.priceLabel}</div>
          ${p.discount > 0 ? `<div class="text-[10px] text-emerald-600 font-bold mt-1">Economize ${p.discount}%</div>` : ''}
          
          <div class="mt-4 flex-1">
            <div class="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-2">Acesso</div>
            ${accessContent}
            ${!p.fullAccessText && noAccessList ? `<div class="mt-4 text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-2">Sem acesso</div><ul class="space-y-1.5 text-[11px]">${noAccessList}</ul>` : ''}
          </div>

          ${p.note ? `<div class="mt-3 text-[10px] text-gray-500 italic">${p.note}</div>` : ''}
          ${!isCurrent ? `<button onclick="requestUpgrade('${p.id}')" class="mt-3 w-full py-2 rounded-lg bg-emerald-600 text-white font-bold text-xs hover:bg-emerald-700 transition">Solicitar</button>` : ''}
        </div>
      `;
    }).join('');
    
    initIcons();
  }

  const btnTermsModal = document.getElementById('open-terms-modal');
  const btnPrivacyModal = document.getElementById('open-privacy-modal');

  if (btnTermsModal) {
    btnTermsModal.addEventListener('click', () => openInfoModal('terms'));
  }

  if (btnPrivacyModal) {
    btnPrivacyModal.addEventListener('click', () => openInfoModal('privacy'));
  }

  // Tenta renderizar com o que tem (provavelmente 'free' antes do Firebase carregar na WebView)
  render();

  checkAuth().then((user) => {
    if (!user) return;
    document.getElementById('btn-logout').onclick = logout;
    
    // Assim que o Firebase termina de validar, ele joga o plano real na tela!
    try {
      const tier = normalizeTier(getVipTier());
      
      const pillName = document.getElementById('current-plan-name');
      if (pillName) pillName.textContent = prettyTierName(tier);
      
      const vipLabel = document.querySelector('#vip-label span');
      if (vipLabel) vipLabel.textContent = prettyTierName(tier);

      render(); // Atualiza a caixinha "Atual" corretamente!
    } catch (_) {}
  });