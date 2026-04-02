// api/analyze.js
// This is the middleman between your browser and Claude's API.
// It runs on Vercel's servers, so CORS is not an issue.

export default async function handler(req, res) {
  // Allow requests from your browser
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  // Handle preflight
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const CLAUDE_KEY = process.env.CLAUDE_API_KEY;
  if (!CLAUDE_KEY) {
    return res.status(500).json({ error: 'Claude API key not configured on server. Check Vercel environment variables.' });
  }

  const { prompt } = req.body;
  if (!prompt) {
    return res.status(400).json({ error: 'No prompt provided' });
  }

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': CLAUDE_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5',
        max_tokens: 3500,
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    if (!response.ok) {
      let errMsg = `Claude API error ${response.status}`;
      try {
        const err = await response.json();
        errMsg = err.error?.message || errMsg;
      } catch {
        errMsg = await response.text();
      }
      return res.status(response.status).json({ error: errMsg });
    }

    const data = await response.json();
    return res.status(200).json({ text: data.content[0]?.text || '' });

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
