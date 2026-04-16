// Antes de rodar, instale os pacotes no terminal: npm install express cors firebase
const express = require('express');
const cors = require('cors');
const { initializeApp } = require('firebase/app');
const { getFirestore, doc, getDoc } = require('firebase/firestore');

const app = express();
const PORT = 3000;

app.use(cors());

// Suas configurações do Firebase
const firebaseConfig = {
  apiKey: "AIzaSyAZQv-ImckNQW1Pb1AMfQ8f5rtKLU6VijU",
  authDomain: "api-ff-guildahub.firebaseapp.com",
  projectId: "api-ff-guildahub",
  storageBucket: "api-ff-guildahub.firebasestorage.app",
  messagingSenderId: "98820381088",
  appId: "1:98820381088:web:21da613e35c33096c12cc5",
  measurementId: "G-5RBH2Q2NKG"
};

// Inicializa o Firebase
const firebaseApp = initializeApp(firebaseConfig);
const db = getFirestore(firebaseApp);

// Rota da API (Alinhado com o que está na sua Landing Page)
app.get('/free_fire/api/info', async (req, res) => {
    const idJogador = req.query.ID;
    const chaveCliente = req.query.key;

    // 1. Verifica se mandou os parâmetros básicos
    if (!chaveCliente) {
        return res.status(401).json({ success: false, mensagem: 'Chave de API não fornecida. Contate +5531998241241' });
    }
    if (!idJogador) {
        return res.status(400).json({ success: false, mensagem: 'ID do jogador não informado. Use ?ID=numero' });
    }

    try {
        // 2. Busca a chave no Firestore (Coleção "tempo" > Documento "{chaveCliente}")
        const chaveRef = doc(db, 'tempo', chaveCliente);
        const docSnap = await getDoc(chaveRef);

        // Se o documento não existir, a chave é inválida
        if (!docSnap.exists()) {
            return res.status(401).json({ success: false, mensagem: 'Chave de API inválida.' });
        }

        const dadosChave = docSnap.data();

        // 3. Verifica se a chave expirou (Lê o campo "expira")
        let dataExpiracao = dadosChave.expira;
        
        // Converte para data caso seja um Timestamp do Firebase ou String
        if (dataExpiracao && typeof dataExpiracao.toDate === 'function') {
            dataExpiracao = dataExpiracao.toDate();
        } else {
            dataExpiracao = new Date(dataExpiracao);
        }

        // Se a data atual for maior que a data de expiração, barra o acesso
        if (new Date() > dataExpiracao) {
            return res.status(403).json({ success: false, mensagem: 'Sua chave de acesso expirou! Renove o seu plano.' });
        }

        // 4. Tudo certo! Chave válida e no prazo. Consome a sua API original oculta:
        const urlOriginal = `https://axicld.duckdns.org:5006/api/v1/freefire/profile/${idJogador}?api_key=ilimitado`;
        
        const response = await fetch(urlOriginal);
        if (!response.ok) {
            throw new Error('Falha ao buscar dados no servidor fonte do FF');
        }

        const dados = await response.json();

        // 5. Devolve o JSON do jogador para o seu cliente
        res.json(dados);

    } catch (error) {
        console.error('Erro no processamento da API:', error);
        res.status(500).json({ success: false, mensagem: 'Erro interno no servidor ao processar a requisição.' });
    }
});

app.listen(PORT, () => {
    console.log(`API do GuildaHub com Firebase rodando na porta ${PORT}`);
});
