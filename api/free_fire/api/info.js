const firebaseConfig = {
  apiKey: "AIzaSyAZQv-ImckNQW1Pb1AMfQ8f5rtKLU6VijU",
  authDomain: "api-ff-guildahub.firebaseapp.com",
  projectId: "api-ff-guildahub",
  storageBucket: "api-ff-guildahub.firebasestorage.app",
  messagingSenderId: "98820381088",
  appId: "1:98820381088:web:21da613e35c33096c12cc5",
  measurementId: "G-5RBH2Q2NKG"
};

function parseFirestoreValue(value) {
  if (!value || typeof value !== 'object') return value;

  if ('stringValue' in value) return value.stringValue;
  if ('integerValue' in value) return Number(value.integerValue);
  if ('doubleValue' in value) return Number(value.doubleValue);
  if ('booleanValue' in value) return value.booleanValue;
  if ('timestampValue' in value) return new Date(value.timestampValue);
  if ('nullValue' in value) return null;
  if ('mapValue' in value) {
    const fields = value.mapValue.fields || {};
    const out = {};
    for (const [key, fieldValue] of Object.entries(fields)) {
      out[key] = parseFirestoreValue(fieldValue);
    }
    return out;
  }
  if ('arrayValue' in value) {
    return (value.arrayValue.values || []).map(parseFirestoreValue);
  }

  return value;
}

function parseFirestoreDocument(doc) {
  const fields = doc?.fields || {};
  const out = {};

  for (const [key, value] of Object.entries(fields)) {
    out[key] = parseFirestoreValue(value);
  }

  return out;
}

async function getKeyData(chaveCliente) {
  const base = `https://firestore.googleapis.com/v1/projects/${firebaseConfig.projectId}/databases/(default)/documents`;
  const docUrl = `${base}/tempo/${encodeURIComponent(chaveCliente)}?key=${firebaseConfig.apiKey}`;

  const docResponse = await fetch(docUrl);

  if (docResponse.ok) {
    const docData = await docResponse.json();
    return parseFirestoreDocument(docData);
  }

  if (docResponse.status !== 404) {
    const errorText = await docResponse.text();
    throw new Error(`Firestore documento direto falhou (${docResponse.status}): ${errorText}`);
  }

  const queryUrl = `${base}:runQuery?key=${firebaseConfig.apiKey}`;
  const queryBody = {
    structuredQuery: {
      from: [{ collectionId: 'tempo' }],
      where: {
        fieldFilter: {
          field: { fieldPath: 'keypass' },
          op: 'EQUAL',
          value: { stringValue: chaveCliente }
        }
      },
      limit: 1
    }
  };

  const queryResponse = await fetch(queryUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(queryBody)
  });

  if (!queryResponse.ok) {
    const errorText = await queryResponse.text();
    throw new Error(`Firestore consulta por keypass falhou (${queryResponse.status}): ${errorText}`);
  }

  const queryResult = await queryResponse.json();
  const found = Array.isArray(queryResult)
    ? queryResult.find(item => item && item.document)
    : null;

  if (!found || !found.document) {
    return null;
  }

  return parseFirestoreDocument(found.document);
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
    const dadosChave = await getKeyData(chaveCliente);

    if (!dadosChave) {
      return res.status(401).json({
        success: false,
        mensagem: 'Chave de API inválida.'
      });
    }

    let dataExpiracao = dadosChave.expira;

    if (dataExpiracao instanceof Date) {
      // ok
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
    console.error('Erro na API Free Fire:', error);

    return res.status(500).json({
      success: false,
      mensagem: 'Erro interno no servidor ao processar a requisição.',
      detalhe: String(error?.message || error)
    });
  }
};
