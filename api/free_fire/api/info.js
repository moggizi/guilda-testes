const firebaseConfig = {
  apiKey: "AIzaSyAZQv-ImckNQW1Pb1AMfQ8f5rtKLU6VijU",
  authDomain: "api-ff-guildahub.firebaseapp.com",
  projectId: "api-ff-guildahub",
  storageBucket: "api-ff-guildahub.firebasestorage.app",
  messagingSenderId: "98820381088",
  appId: "1:98820381088:web:21da613e35c33096c12cc5",
  measurementId: "G-5RBH2Q2NKG"
};

let cachedDb = null;

async function getDb() {
  if (cachedDb) return cachedDb;

  const { initializeApp, getApps, getApp } = await import('firebase/app');
  const { getFirestore } = await import('firebase/firestore');

  const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
  cachedDb = getFirestore(app);
  return cachedDb;
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'GET') {
    return res.status(405).json({
      success: false,
      mensagem: 'Método não permitido.'
    });
  }

  const idJogador = req.query.ID;
  const chaveCliente = req.query.key;

  if (!chaveCliente) {
    return res.status(401).json({
      success: false,
      mensagem: 'Chave de API não fornecida. Contate +5531998241241'
    });
  }

  if (!idJogador) {
    return res.status(400).json({
      success: false,
      mensagem: 'ID do jogador não informado. Use ?ID=numero'
    });
  }

  try {
    const db = await getDb();
    const { doc, getDoc, collection, query, where, limit, getDocs } = await import('firebase/firestore');

    let dadosChave = null;

    // 1) Tenta encontrar usando a própria key como ID do documento: tempo/{key}
    const chaveRef = doc(db, 'tempo', chaveCliente);
    const docSnap = await getDoc(chaveRef);

    if (docSnap.exists()) {
      dadosChave = docSnap.data() || {};
    } else {
      // 2) Se não existir, tenta encontrar por campo keypass == key
      const q = query(
        collection(db, 'tempo'),
        where('keypass', '==', chaveCliente),
        limit(1)
      );

      const resultado = await getDocs(q);
      if (!resultado.empty) {
        dadosChave = resultado.docs[0].data() || {};
      }
    }

    if (!dadosChave) {
      return res.status(401).json({
        success: false,
        mensagem: 'Chave de API inválida.'
      });
    }

    let dataExpiracao = dadosChave.expira;

    if (dataExpiracao && typeof dataExpiracao.toDate === 'function') {
      dataExpiracao = dataExpiracao.toDate();
    } else {
      dataExpiracao = new Date(dataExpiracao);
    }

    if (!dataExpiracao || Number.isNaN(dataExpiracao.getTime())) {
      return res.status(500).json({
        success: false,
        mensagem: 'Campo expira inválido na chave.'
      });
    }

    if (new Date() > dataExpiracao) {
      return res.status(403).json({
        success: false,
        mensagem: 'Sua chave de acesso expirou! Renove o seu plano.'
      });
    }

    const urlOriginal = `https://axicld.duckdns.org:5006/api/v1/freefire/profile/${idJogador}?api_key=ilimitado`;
    const response = await fetch(urlOriginal);

    if (!response.ok) {
      return res.status(502).json({
        success: false,
        mensagem: 'Falha ao buscar dados no servidor fonte do FF.'
      });
    }

    const dados = await response.json();
    return res.status(200).json(dados);
  } catch (error) {
    console.error('Erro na API Free Fire:', error);

    return res.status(500).json({
      success: false,
      mensagem: 'Erro interno no servidor ao processar a requisição.'
    });
  }
};
