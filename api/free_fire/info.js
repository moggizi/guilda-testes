const { initializeApp, cert, getApps } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');

const ADMIN_APP_NAME = 'ff-api-admin';
const SERVICE_ACCOUNT_ENV = 'FIREBASE_SERVICE_ACCOUNT_FF_API';

function getDb() {
  let adminApp = getApps().find(app => app.name === ADMIN_APP_NAME);

  if (!adminApp) {
    const raw = process.env[SERVICE_ACCOUNT_ENV];

    if (!raw) {
      throw new Error(`A variável ${SERVICE_ACCOUNT_ENV} não foi configurada.`);
    }

    const serviceAccount = JSON.parse(raw);

    adminApp = initializeApp(
      { credential: cert(serviceAccount) },
      ADMIN_APP_NAME
    );
  }

  return getFirestore(adminApp);
}

function buildRealApiUrl(idJogador) {
  const baseUrl = process.env.FF_API_BASE_URL;
  const apiKey = process.env.FF_API_KEY;
  const profilePath = process.env.FF_API_PROFILE_PATH || '/api/v1/freefire/profile';

  if (!baseUrl || !apiKey) {
    throw new Error('As variáveis FF_API_BASE_URL e FF_API_KEY não foram configuradas.');
  }

  const normalizedBase = baseUrl.replace(/\/+$/, '');
  const normalizedPath = profilePath.startsWith('/') ? profilePath : `/${profilePath}`;

  return `${normalizedBase}${normalizedPath}/${encodeURIComponent(idJogador)}?api_key=${encodeURIComponent(apiKey)}`;
}

module.exports = async function handler(req, res) {
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
    const db = getDb();
    const docSnap = await db.collection('tempo').doc(chaveCliente).get();

    if (!docSnap.exists) {
      return res.status(401).json({
        success: false,
        mensagem: 'Chave de API inválida.'
      });
    }

    const dadosChave = docSnap.data() || {};
    let dataExpiracao = dadosChave.expira;

    if (dataExpiracao && typeof dataExpiracao.toDate === 'function') {
      dataExpiracao = dataExpiracao.toDate();
    } else {
      dataExpiracao = new Date(dataExpiracao);
    }

    if (!dataExpiracao || Number.isNaN(dataExpiracao.getTime())) {
      return res.status(500).json({
        success: false,
        mensagem: 'Campo expira inválido na chave.',
        detalhe: { expira: dadosChave.expira ?? null }
      });
    }

    if (new Date() > dataExpiracao) {
      return res.status(403).json({
        success: false,
        mensagem: 'Sua chave de acesso expirou! Renove o seu plano.'
      });
    }

    const urlOriginal = buildRealApiUrl(idJogador);
    const response = await fetch(urlOriginal);

    if (!response.ok) {
      const errorText = await response.text();

      return res.status(502).json({
        success: false,
        mensagem: 'Falha ao buscar dados no servidor fonte do FF.',
        detalhe: `Status ${response.status}: ${errorText}`
      });
    }

    const dados = await response.json();
    return res.status(200).json(dados);
  } catch (error) {
    return res.status(500).json({
      success: false,
      mensagem: 'Erro interno no servidor ao processar a requisição.',
      detalhe: String(error?.message || error)
    });
  }
};
