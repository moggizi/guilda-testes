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

    const upstreamUrl = `http://axicld.duckdns.org:5006/api/v1/freefire/profile/:${encodeURIComponent(q)}?api_key=ilimitado`;

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

    return res.status(200).json(data);
  } catch (e) {
    return res.status(500).json({ error: e?.message || 'Erro interno' });
  }
};
