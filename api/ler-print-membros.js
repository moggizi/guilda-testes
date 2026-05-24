// api/ler-print-membros.js
// Vercel Serverless Function para analisar prints do Free Fire com Gemini.
// Configure na Vercel: GEMINI_API_KEY
// Opcional: GEMINI_MODEL=gemini-2.5-flash-lite
// Opcional: GEMINI_MODELS=gemini-2.5-flash-lite,gemini-3.1-flash-lite,gemini-2.5-flash
// Se existir GEMINI_MODEL=gemini-2.0-flash na Vercel, esta versão ignora automaticamente.

const DEFAULT_MODELS = [
  // Pelos limites do AI Studio, estes são os melhores para o nível gratuito.
  'gemini-2.5-flash-lite',
  'gemini-3.1-flash-lite',
  'gemini-2.5-flash'
];

const BLOCKED_ZERO_QUOTA_MODELS = new Set([
  // Em alguns projetos free tier esses modelos aparecem com limite 0.
  // Se estiverem configurados por engano na Vercel, a rota ignora e usa os modelos acima.
  'gemini-2.0-flash',
  'gemini-2.0-flash-lite'
]);

function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

async function readJsonBody(req) {
  if (req.body) {
    if (typeof req.body === 'string') return JSON.parse(req.body || '{}');
    return req.body;
  }

  let raw = '';
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > 9_000_000) {
      throw new Error('Payload muito grande. Envie menos prints por vez.');
    }
  }

  return raw ? JSON.parse(raw) : {};
}

function cleanBase64(value) {
  return String(value || '').replace(/^data:image\/[^;]+;base64,/, '').trim();
}

function simplifyMembers(members) {
  return (Array.isArray(members) ? members : [])
    .filter((m) => m && (m.id || m.visibleId || m.nick))
    .slice(0, 140)
    .map((m) => ({
      id: String(m.id || ''),
      visibleId: String(m.visibleId || ''),
      nick: String(m.nick || '')
    }));
}

function getModelsToTry() {
  const fromList = process.env.GEMINI_MODELS;
  const fromSingle = process.env.GEMINI_MODEL;
  const envModels = `${fromList || ''},${fromSingle || ''}`
    .split(',')
    .map((m) => m.trim())
    .filter(Boolean);

  // Mesmo que a Vercel ainda esteja com GEMINI_MODEL=gemini-2.0-flash,
  // não vamos usar esse modelo porque ele costuma vir com limite 0 no free tier.
  const allowZeroQuotaModels = String(process.env.GEMINI_ALLOW_ZERO_QUOTA_MODELS || '').toLowerCase() === 'true';
  const models = [...new Set([...envModels, ...DEFAULT_MODELS])]
    .filter((model) => allowZeroQuotaModels || !BLOCKED_ZERO_QUOTA_MODELS.has(model));

  return models.length ? models : DEFAULT_MODELS;
}

function buildPrompt(members) {
  return `
Você é um extrator de dados de prints do jogo Free Fire para o sistema Guilda HUB.

Tarefa:
Analise as imagens enviadas e extraia as linhas da tabela de membros.

Existem dois tipos principais de print:

1) "PLACAR INDIVIDUAL", "PLACAR GUERRA DE GUILDAS" ou tela parecida:
- A pontuação correta fica na coluna "PONTUAÇÃO INDIVIDUAL".
- Retorne metric = "gg".
- Ignore posição/ranking 1, 2, 3, 4, nível "Nv.", porcentagem, moedas, rodada e patentes.
- Exemplo: se uma linha mostra AUTISTA.3 e na coluna direita 565, retorne value 565.

2) Tela "MEMBROS ONLINE" / lista da guilda:
- A pontuação correta fica na coluna "ESTA SEMANA".
- Retorne metric = "honra".
- Ignore status online, horas atrás, "Nv.", contagem 48/55 e número de nível.

Use a lista de membros cadastrados abaixo para tentar mapear cada linha para o memberId correto.
Só preencha memberId quando a correspondência for provável. Se tiver dúvida, use memberId null.
Mesmo quando houver dúvida, retorne a linha com detectedNick e value para revisão manual.

Membros cadastrados:
${JSON.stringify(members)}

Regras importantes:
- Não invente pontuação.
- Não retorne cabeçalhos da tabela.
- Não retorne linhas sem pontuação.
- Retorne também a linha destacada no rodapé se ela mostrar um membro e uma pontuação real.
- Preserve o nick lido no campo detectedNick.
- Retorne JSON puro, sem markdown.

Formato obrigatório:
{
  "rows": [
    {
      "metric": "gg",
      "detectedNick": "AUTISTA.3",
      "memberId": "id-do-membro-ou-null",
      "visibleId": "id-visivel-se-aparecer-ou-null",
      "value": 565,
      "confidence": 0.92,
      "notes": "opcional"
    }
  ]
}
`.trim();
}

function extractJson(text) {
  const raw = String(text || '').trim();
  if (!raw) return { rows: [] };

  const withoutFence = raw
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/```$/i, '')
    .trim();

  try {
    return JSON.parse(withoutFence);
  } catch (_) {
    const start = withoutFence.indexOf('{');
    const end = withoutFence.lastIndexOf('}');
    if (start >= 0 && end > start) {
      return JSON.parse(withoutFence.slice(start, end + 1));
    }
    throw new Error('O Gemini não retornou um JSON válido.');
  }
}

function normalizeRows(rows, members) {
  const memberIds = new Set(members.map((m) => String(m.id || '')).filter(Boolean));

  return (Array.isArray(rows) ? rows : [])
    .map((row) => {
      const metricRaw = String(row.metric || row.tipo || '').toLowerCase();
      const metric = metricRaw.includes('honra') || metricRaw.includes('semana') ? 'honra' : 'gg';

      const value = Number(row.value ?? row.pontuacao ?? row.score);
      if (!Number.isFinite(value)) return null;

      const memberId = row.memberId && memberIds.has(String(row.memberId))
        ? String(row.memberId)
        : null;

      const confidence = Number(row.confidence ?? row.confianca ?? 0);

      return {
        metric,
        detectedNick: String(row.detectedNick || row.nick || row.apelido || '').trim(),
        memberId,
        visibleId: row.visibleId ? String(row.visibleId) : null,
        value,
        confidence: Number.isFinite(confidence) ? Math.max(0, Math.min(1, confidence)) : 0,
        notes: String(row.notes || '').slice(0, 160)
      };
    })
    .filter(Boolean);
}

function friendlyGeminiError(status, geminiJson, modelsTried) {
  const rawMessage = String(geminiJson?.error?.message || '');
  const modelList = modelsTried.join(', ');

  if (status === 429) {
    return {
      status: 429,
      error:
        `A cota do Gemini estourou ou está zerada para este projeto/modelo. ` +
        `Na Vercel, tente trocar/remover GEMINI_MODEL e usar GEMINI_MODEL=gemini-2.5-flash-lite. ` +
        `No Google AI Studio, confira Projeto > Limite de taxa. Modelos testados: ${modelList}.`
    };
  }

  if (status === 400 && /model|not found|invalid/i.test(rawMessage)) {
    return {
      status: 400,
      error:
        `O modelo configurado no Gemini parece inválido ou indisponível neste projeto. ` +
        `Use GEMINI_MODEL=gemini-2.5-flash-lite na Vercel e faça redeploy.`
    };
  }

  if (status === 403) {
    return {
      status: 403,
      error:
        'A API key do Gemini não tem permissão ou está incorreta. Confira a variável GEMINI_API_KEY na Vercel e faça redeploy.'
    };
  }

  return {
    status,
    error: rawMessage || `Erro do Gemini: ${status}`
  };
}

async function callGemini({ model, apiKey, parts }) {
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [
        {
          role: 'user',
          parts
        }
      ],
      generationConfig: {
        temperature: 0.1,
        responseMimeType: 'application/json'
      }
    })
  });

  const json = await response.json().catch(() => null);
  return { response, json };
}

module.exports = async function handler(req, res) {
  setCors(res);

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Use POST.' });
  }

  try {
    const apiKey =
      process.env.GEMINI_API_KEY ||
      process.env.GOOGLE_GENERATIVE_AI_API_KEY ||
      process.env.GOOGLE_API_KEY;

    if (!apiKey) {
      return res.status(500).json({
        error: 'GEMINI_API_KEY não foi configurada nas variáveis de ambiente da Vercel.'
      });
    }

    const body = await readJsonBody(req);
    const images = Array.isArray(body.images) ? body.images.slice(0, 8) : [];
    const members = simplifyMembers(body.members);

    if (!images.length) {
      return res.status(400).json({ error: 'Envie pelo menos uma imagem.' });
    }

    const parts = [
      { text: buildPrompt(members) },
      ...images.map((image) => ({
        inlineData: {
          mimeType: String(image.mimeType || 'image/jpeg'),
          data: cleanBase64(image.data)
        }
      }))
    ];

    if (parts.some((part) => part.inlineData && !part.inlineData.data)) {
      return res.status(400).json({ error: 'Uma das imagens está sem base64 válido.' });
    }

    const models = getModelsToTry();
    const modelsTried = [];
    let lastFailure = null;

    for (const model of models) {
      modelsTried.push(model);
      const { response, json } = await callGemini({ model, apiKey, parts });

      if (!response.ok) {
        lastFailure = { status: response.status, json };

        // Tenta o próximo modelo quando o problema pode ser só cota/modelo.
        if ([400, 404, 429, 500, 503].includes(response.status)) {
          continue;
        }

        const friendly = friendlyGeminiError(response.status, json, modelsTried);
        return res.status(friendly.status).json({ error: friendly.error, modelsTried });
      }

      const text = json?.candidates?.[0]?.content?.parts
        ?.map((part) => part.text || '')
        .join('\n')
        .trim();

      const parsed = extractJson(text);
      const rows = normalizeRows(parsed.rows, members);

      return res.status(200).json({ rows, modelUsed: model });
    }

    const friendly = friendlyGeminiError(lastFailure?.status || 500, lastFailure?.json, modelsTried);
    return res.status(friendly.status).json({ error: friendly.error, modelsTried });
  } catch (error) {
    console.error('Erro em /api/ler-print-membros:', error);
    return res.status(500).json({
      error: error?.message || 'Erro interno ao analisar print.'
    });
  }
};
