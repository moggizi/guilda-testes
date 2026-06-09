// Vercel Serverless Function (Node)
// Proxy seguro para evitar CORS e esconder a chave no servidor.
// Front:
//   GET /api/proxy?endpoint=ff_info&query=123456789

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-api-key');
  res.setHeader('Access-Control-Max-Age', '86400');
}

function findNestedValue(source, wantedKeys, depth = 0) {
  if (!source || typeof source !== 'object' || depth > 5) return undefined;
  const entries = Object.entries(source);
  const wanted = new Set(wantedKeys.map((key) => String(key).toLowerCase()));

  for (const [key, value] of entries) {
    if (wanted.has(String(key).toLowerCase()) && value != null && value !== '') return value;
  }
  for (const [, value] of entries) {
    if (value && typeof value === 'object') {
      const found = findNestedValue(value, wantedKeys, depth + 1);
      if (found != null && found !== '') return found;
    }
  }
  return undefined;
}

function normalizeFreeFireResponse(data) {
  const nick = findNestedValue(data, [
    'nick',
    'nickname',
    'name',
    'accountname',
    'account_name',
    'playername',
    'player_name'
  ]);
  const level = findNestedValue(data, ['level', 'accountlevel', 'account_level', 'lvl']);
  const successValue = findNestedValue(data, ['success', 'ok', 'status']);
  const explicitFailure = successValue === false || String(successValue || '').toLowerCase() === 'false';

  return {
    success: !explicitFailure && !!String(nick || '').trim(),
    nick: String(nick || '').trim(),
    level: level == null ? null : Number(level),
    raw: data
  };
}

module.exports = async (req, res) => {
  cors(res);

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const endpoint = String(req.query?.endpoint || '').trim();
    const q = String(req.query?.query || '').trim();

    // Evita virar um open-proxy
    if (endpoint !== 'ff_info') return res.status(400).json({ error: 'endpoint inválido' });
    if (!q) return res.status(400).json({ error: 'query ausente' });
    if (!/^[0-9]{5,20}$/.test(q)) return res.status(400).json({ error: 'ID inválido' });

    const upstreamUrl = `https://axicld.duckdns.org:5006/api/v1/custom/info-ff?prompt=${encodeURIComponent(q)}&api_key=ilimitado`;

    const upstreamResp = await fetch(upstreamUrl, {
      method: 'GET',
      headers: {
        'accept': 'application/json'
      }
    });

    const text = await upstreamResp.text();
    let data;
    try { data = JSON.parse(text); } catch { data = { raw: text }; }

    if (!upstreamResp.ok) {
      return res.status(upstreamResp.status).json({
        error: 'Falha no upstream',
        status: upstreamResp.status,
        data
      });
    }

    return res.status(200).json(normalizeFreeFireResponse(data));
  } catch (e) {
    return res.status(500).json({ error: e?.message || 'Erro interno' });
  }
};
