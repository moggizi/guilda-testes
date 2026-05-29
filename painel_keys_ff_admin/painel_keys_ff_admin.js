import { initializeApp } from 'https://www.gstatic.com/firebasejs/12.3.0/firebase-app.js';
    import {
      getAuth,
      signInWithEmailAndPassword,
      signOut,
      onAuthStateChanged,
      setPersistence,
      browserLocalPersistence
    } from 'https://www.gstatic.com/firebasejs/12.3.0/firebase-auth.js';
    import {
      getFirestore,
      collection,
      doc,
      setDoc,
      deleteDoc,
      onSnapshot,
      query,
      orderBy,
      serverTimestamp,
      Timestamp
    } from 'https://www.gstatic.com/firebasejs/12.3.0/firebase-firestore.js';

    const firebaseConfig = {
      apiKey: "AIzaSyAZQv-ImckNQW1Pb1AMfQ8f5rtKLU6VijU",
      authDomain: "api-ff-guildahub.firebaseapp.com",
      projectId: "api-ff-guildahub",
      storageBucket: "api-ff-guildahub.firebasestorage.app",
      messagingSenderId: "98820381088",
      appId: "1:98820381088:web:21da613e35c33096c12cc5",
      measurementId: "G-5RBH2Q2NKG"
    };

    // Opcional: coloque e-mails autorizados aqui para reforçar o painel na interface.
    // O ideal é reforçar isso também nas regras do Firestore.
    const ADMIN_EMAILS = [
      'SEU_EMAIL_AQUI'
    ];

    const app = initializeApp(firebaseConfig);
    const auth = getAuth(app);
    const db = getFirestore(app);

    const loginView = document.getElementById('loginView');
    const panelView = document.getElementById('panelView');
    const logoutBtn = document.getElementById('logoutBtn');
    const loginBtn = document.getElementById('loginBtn');
    const createKeyBtn = document.getElementById('createKeyBtn');
    const generateKeyBtn = document.getElementById('generateKeyBtn');
    const loginMessage = document.getElementById('loginMessage');
    const panelMessage = document.getElementById('panelMessage');
    const emailInput = document.getElementById('email');
    const passwordInput = document.getElementById('password');
    const keyInput = document.getElementById('keyInput');
    const daysInput = document.getElementById('daysInput');
    const customDateInput = document.getElementById('customDateInput');
    const currentUserEmail = document.getElementById('currentUserEmail');
    const keysList = document.getElementById('keysList');
    const keysEmpty = document.getElementById('keysEmpty');
    const statTotal = document.getElementById('statTotal');
    const statAtivas = document.getElementById('statAtivas');
    const statUrgentes = document.getElementById('statUrgentes');
    const statExpiradas = document.getElementById('statExpiradas');

    let unsubscribeKeys = null;

    function showMessage(el, text, type = 'error') {
      el.textContent = text;
      el.className = `message show ${type}`;
    }

    function hideMessage(el) {
      el.textContent = '';
      el.className = 'message';
    }

    function formatDate(value) {
      if (!value) return '-';
      const date = value instanceof Date ? value : (typeof value?.toDate === 'function' ? value.toDate() : new Date(value));
      if (Number.isNaN(date.getTime())) return '-';
      return new Intl.DateTimeFormat('pt-BR', {
        dateStyle: 'long',
        timeStyle: 'short'
      }).format(date);
    }

    function getExpirationInfo(expiraValue) {
      const now = new Date();
      const expira = expiraValue instanceof Date ? expiraValue : (typeof expiraValue?.toDate === 'function' ? expiraValue.toDate() : new Date(expiraValue));
      if (Number.isNaN(expira.getTime())) {
        return { label: 'Data inválida', badge: 'badge-danger', expired: true, daysLeft: null, sortDays: -99999 };
      }

      const diffMs = expira.getTime() - now.getTime();
      const daysLeft = Math.ceil(diffMs / 86400000);

      if (diffMs < 0) {
        const expiredDays = Math.abs(daysLeft);
        return {
          label: expiredDays <= 1 ? 'Expirada' : `Expirada há ${expiredDays} dias`,
          badge: 'badge-danger',
          expired: true,
          daysLeft,
          sortDays: daysLeft
        };
      }

      if (daysLeft <= 7) {
        return {
          label: daysLeft <= 1 ? 'Expira hoje/amanhã' : `Expira em ${daysLeft} dias`,
          badge: 'badge-warning',
          expired: false,
          daysLeft,
          sortDays: daysLeft
        };
      }

      return {
        label: `Faltam ${daysLeft} dias`,
        badge: 'badge-ok',
        expired: false,
        daysLeft,
        sortDays: daysLeft
      };
    }

    function randomChunk(size) {
      const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
      let out = '';
      for (let i = 0; i < size; i++) {
        out += chars[Math.floor(Math.random() * chars.length)];
      }
      return out;
    }

    function generateKey() {
      return `HUB-${randomChunk(4)}${randomChunk(4)}${randomChunk(4)}`;
    }

    function updateStats(items) {
      const total = items.length;
      const expiradas = items.filter(item => item.expInfo.expired).length;
      const ativas = total - expiradas;
      const urgentes = items.filter(item => !item.expInfo.expired && item.expInfo.daysLeft !== null && item.expInfo.daysLeft <= 7).length;

      statTotal.textContent = total;
      statAtivas.textContent = ativas;
      statUrgentes.textContent = urgentes;
      statExpiradas.textContent = expiradas;
    }

    function renderKeys(snapshot) {
      const items = snapshot.docs.map(docSnap => {
        const data = docSnap.data() || {};
        const expInfo = getExpirationInfo(data.expira);
        return {
          id: docSnap.id,
          keypass: data.keypass || docSnap.id,
          criacao: data.criacao || null,
          expira: data.expira || null,
          expInfo
        };
      }).sort((a, b) => a.expInfo.sortDays - b.expInfo.sortDays);

      updateStats(items);

      if (!items.length) {
        keysEmpty.classList.remove('hidden');
        keysList.classList.add('hidden');
        keysList.innerHTML = '';
        return;
      }

      keysEmpty.classList.add('hidden');
      keysList.classList.remove('hidden');

      keysList.innerHTML = items.map(item => `
        <div class="key-card">
          <div class="key-top">
            <div class="key-name">${item.keypass}</div>
            <div class="badge ${item.expInfo.badge}">${item.expInfo.label}</div>
          </div>
          <div class="meta">
            <div><strong>Criada em:</strong> ${formatDate(item.criacao)}</div>
            <div><strong>Expira em:</strong> ${formatDate(item.expira)}</div>
            <div><strong>ID do documento:</strong> ${item.id}</div>
          </div>
          <button class="btn btn-danger delete-key-btn" data-key="${item.id}">Excluir</button>
        </div>
      `).join('');

      document.querySelectorAll('.delete-key-btn').forEach(btn => {
        btn.addEventListener('click', async () => {
          const key = btn.dataset.key;
          const ok = confirm(`Excluir a key ${key}?`);
          if (!ok) return;

          try {
            await deleteDoc(doc(db, 'tempo', key));
            showMessage(panelMessage, 'Key excluída com sucesso.', 'success');
          } catch (error) {
            showMessage(panelMessage, error?.message || 'Erro ao excluir a key.', 'error');
          }
        });
      });
    }

    async function saveKey() {
      hideMessage(panelMessage);

      let key = keyInput.value.trim().toUpperCase();
      const days = Number(daysInput.value || 0);
      const customDateValue = customDateInput.value;

      if (!key) {
        key = generateKey();
        keyInput.value = key;
      }

      let expiraDate;

      if (customDateValue) {
        expiraDate = new Date(customDateValue);
      } else {
        if (!days || days < 1) {
          showMessage(panelMessage, 'Informe pelo menos 1 dia ou escolha uma data e hora exata.', 'error');
          return;
        }
        expiraDate = new Date(Date.now() + (days * 86400000));
      }

      if (Number.isNaN(expiraDate.getTime())) {
        showMessage(panelMessage, 'Data de expiração inválida.', 'error');
        return;
      }

      createKeyBtn.disabled = true;
      createKeyBtn.textContent = 'Salvando...';

      try {
        await setDoc(doc(db, 'tempo', key), {
          keypass: key,
          criacao: serverTimestamp(),
          expira: Timestamp.fromDate(expiraDate)
        }, { merge: true });

        showMessage(panelMessage, 'Key salva com sucesso.', 'success');
        customDateInput.value = '';
      } catch (error) {
        showMessage(panelMessage, error?.message || 'Erro ao salvar a key.', 'error');
      } finally {
        createKeyBtn.disabled = false;
        createKeyBtn.textContent = 'Salvar key';
      }
    }

    async function login() {
      hideMessage(loginMessage);
      const email = emailInput.value.trim();
      const password = passwordInput.value;

      if (!email || !password) {
        showMessage(loginMessage, 'Preencha e-mail e senha.', 'error');
        return;
      }

      loginBtn.disabled = true;
      loginBtn.textContent = 'Entrando...';

      try {
        await signInWithEmailAndPassword(auth, email, password);
      } catch (error) {
        showMessage(loginMessage, 'Login inválido. Verifique e-mail e senha.', 'error');
      } finally {
        loginBtn.disabled = false;
        loginBtn.textContent = 'Entrar';
      }
    }

    function bindRealtimeKeys() {
      if (unsubscribeKeys) unsubscribeKeys();
      const q = query(collection(db, 'tempo'), orderBy('expira', 'asc'));
      unsubscribeKeys = onSnapshot(q, renderKeys, (error) => {
        showMessage(panelMessage, error?.message || 'Erro ao carregar as keys.', 'error');
      });
    }

    async function logout() {
      await signOut(auth);
      hideMessage(panelMessage);
      hideMessage(loginMessage);
    }

    document.querySelectorAll('.quick-days').forEach(btn => {
      btn.addEventListener('click', () => {
        daysInput.value = btn.dataset.days;
        customDateInput.value = '';
      });
    });

    generateKeyBtn.addEventListener('click', () => {
      keyInput.value = generateKey();
    });

    createKeyBtn.addEventListener('click', saveKey);
    loginBtn.addEventListener('click', login);
    logoutBtn.addEventListener('click', logout);
    passwordInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') login(); });
    emailInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') login(); });

    await setPersistence(auth, browserLocalPersistence);

    onAuthStateChanged(auth, async (user) => {
      if (!user) {
        if (unsubscribeKeys) unsubscribeKeys();
        logoutBtn.classList.add('hidden');
        panelView.classList.add('hidden');
        loginView.classList.remove('hidden');
        currentUserEmail.textContent = '-';
        return;
      }

      const email = user.email || '';
      const enforceEmailList = !ADMIN_EMAILS.includes('SEU_EMAIL_AQUI');

      if (enforceEmailList && !ADMIN_EMAILS.includes(email)) {
        await signOut(auth);
        showMessage(loginMessage, 'Este usuário não está autorizado para o painel.', 'error');
        return;
      }

      currentUserEmail.textContent = email || '-';
      logoutBtn.classList.remove('hidden');
      loginView.classList.add('hidden');
      panelView.classList.remove('hidden');
      bindRealtimeKeys();
    });