// api/quote.js
// Fetches current stock price and 200-day MA from Yahoo Finance.
// No API key required — uses Yahoo's public quote endpoint.

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();

  const { ticker } = req.query;
  if (!ticker) return res.status(400).json({ error: 'No ticker provided' });

  try {
    // Yahoo Finance v8 quote endpoint — public, no auth required
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${ticker.toUpperCase()}?interval=1d&range=1y`;

    const response = await fetch(url, {
      headers: {
        // Yahoo sometimes blocks without a user-agent
        'User-Agent': 'Mozilla/5.0 (compatible; VolEdge/1.0)',
      },
    });

    if (!response.ok) {
      return res.status(response.status).json({ error: `Yahoo Finance returned ${response.status}` });
    }

    const data = await response.json();
    const result = data?.chart?.result?.[0];

    if (!result) {
      return res.status(404).json({ error: 'No data returned for ticker' });
    }

    const meta = result.meta;
    const closes = result.indicators?.quote?.[0]?.close || [];

    // Current price — use regularMarketPrice or most recent close
    const price = meta.regularMarketPrice || closes[closes.length - 1];

    // 200-day MA — average of last 200 closes (or however many we have)
    const validCloses = closes.filter(c => c !== null && c !== undefined);
    const last200 = validCloses.slice(-200);
    const ma200 = last200.length > 0
      ? parseFloat((last200.reduce((a, b) => a + b, 0) / last200.length).toFixed(2))
      : null;

    // Direction vs 200MA
    let ma200pos = '';
    if (ma200 && price) {
      const pct = ((price - ma200) / ma200) * 100;
      if (pct > 1) ma200pos = 'above';
      else if (pct < -1) ma200pos = 'below';
      else ma200pos = 'testing';
    }

    return res.status(200).json({
      ticker: ticker.toUpperCase(),
      price: price ? parseFloat(price.toFixed(2)) : null,
      ma200,
      ma200pos,
      dataPoints: last200.length,
    });

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
