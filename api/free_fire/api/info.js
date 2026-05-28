import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

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

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const idJogador = searchParams.get('ID');
  const chaveCliente = searchParams.get('key');

  if (!chaveCliente) {
    return Response.json(
      { success: false, mensagem: 'Chave de API não fornecida. Contate +5531998241241' },
      { status: 401 }
    );
  }

  if (!idJogador) {
    return Response.json(
      { success: false, mensagem: 'ID do jogador não informado. Use ?ID=numero' },
      { status: 400 }
    );
  }

  try {
    const db = getDb();
    const docSnap = await db.collection('tempo').doc(chaveCliente).get();

    if (!docSnap.exists) {
      return Response.json(
        { success: false, mensagem: 'Chave de API inválida.' },
        { status: 401 }
      );
    }

    const dadosChave = docSnap.data() || {};
    let dataExpiracao = dadosChave.expira;

    if (dataExpiracao && typeof dataExpiracao.toDate === 'function') {
      dataExpiracao = dataExpiracao.toDate();
    } else {
      dataExpiracao = new Date(dataExpiracao);
    }

    if (!dataExpiracao || Number.isNaN(dataExpiracao.getTime())) {
      return Response.json(
        { success: false, mensagem: 'Campo expira inválido na chave.', detalhe: { expira: dadosChave.expira ?? null } },
        { status: 500 }
      );
    }

    if (new Date() > dataExpiracao) {
      return Response.json(
        { success: false, mensagem: 'Sua chave de acesso expirou! Renove o seu plano.' },
        { status: 403 }
      );
    }

    const urlOriginal = buildRealApiUrl(idJogador);
    const response = await fetch(urlOriginal);

    if (!response.ok) {
      const errorText = await response.text();
      return Response.json(
        { success: false, mensagem: 'Falha ao buscar dados no servidor fonte do FF.', detalhe: `Status ${response.status}: ${errorText}` },
        { status: 502 }
      );
    }

    const dados = await response.json();
    return Response.json(dados);
  } catch (error) {
    return Response.json(
      { success: false, mensagem: 'Erro interno no servidor ao processar a requisição.', detalhe: String(error?.message || error) },
      { status: 500 }
    );
  }
}
