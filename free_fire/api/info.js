import { initializeApp, getApps, getApp } from 'firebase/app';
import { getFirestore, doc, getDoc } from 'firebase/firestore';

const firebaseConfig = {
  apiKey: "AIzaSyAZQv-ImckNQW1Pb1AMfQ8f5rtKLU6VijU",
  authDomain: "api-ff-guildahub.firebaseapp.com",
  projectId: "api-ff-guildahub",
  storageBucket: "api-ff-guildahub.firebasestorage.app",
  messagingSenderId: "98820381088",
  appId: "1:98820381088:web:21da613e35c33096c12cc5",
  measurementId: "G-5RBH2Q2NKG"
};

const firebaseApp = getApps().length ? getApp() : initializeApp(firebaseConfig);
const db = getFirestore(firebaseApp);


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
    const chaveRef = doc(db, 'tempo', chaveCliente);
    const docSnap = await getDoc(chaveRef);

    if (!docSnap.exists()) {
      return Response.json(
        { success: false, mensagem: 'Chave de API inválida.' },
        { status: 401 }
      );
    }

    const dadosChave = docSnap.data();

    let dataExpiracao = dadosChave.expira;

    if (dataExpiracao && typeof dataExpiracao.toDate === 'function') {
      dataExpiracao = dataExpiracao.toDate();
    } else {
      dataExpiracao = new Date(dataExpiracao);
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
      throw new Error('Falha ao buscar dados no servidor fonte do FF');
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
