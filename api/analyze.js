// api/analyze.js
// Streaming version — pipes Claude's response chunk-by-chunk to the browser.
// This sidesteps Vercel's 10s timeout on the free plan since bytes are
// flowing continuously rather than waiting for one big response.

export const config = {
  runtime: 'edge', // Edge runtime has no timeout on Hobby plan for streaming
};

export default async function handler(req) {
  // CORS headers
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };

  // Handle preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const CLAUDE_KEY = process.env.CLAUDE_API_KEY;
  if (!CLAUDE_KEY) {
    return new Response(
      JSON.stringify({ error: 'Claude API key not configured on server. Check Vercel environment variables.' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  let body;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON body' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const { prompt } = body;
  if (!prompt) {
    return new Response(JSON.stringify({ error: 'No prompt provided' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  // Call Anthropic with stream: true
  let anthropicRes;
  try {
    anthropicRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': CLAUDE_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5',
        max_tokens: 3500,
        stream: true,
        messages: [{ role: 'user', content: prompt }],
      }),
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: `Failed to reach Anthropic: ${err.message}` }), {
      status: 502,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  if (!anthropicRes.ok) {
    let errMsg = `Anthropic error ${anthropicRes.status}`;
    try {
      const errBody = await anthropicRes.json();
      errMsg = errBody.error?.message || errMsg;
    } catch {
      try { errMsg = await anthropicRes.text(); } catch {}
    }
    return new Response(JSON.stringify({ error: errMsg }), {
      status: anthropicRes.status,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  // Transform Anthropic's SSE stream into plain text chunks for the browser.
  // Anthropic sends events like:
  //   data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"Hello"}}
  // We extract just the text and forward it as plain UTF-8 chunks.
  const transformStream = new TransformStream({
    transform(chunk, controller) {
      const text = new TextDecoder().decode(chunk);
      const lines = text.split('\n');
      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const data = line.slice(6).trim();
        if (data === '[DONE]') return;
        try {
          const parsed = JSON.parse(data);
          if (parsed.type === 'content_block_delta' && parsed.delta?.type === 'text_delta') {
            controller.enqueue(new TextEncoder().encode(parsed.delta.text));
          }
        } catch {
          // Skip malformed lines
        }
      }
    },
  });

  return new Response(anthropicRes.body.pipeThrough(transformStream), {
    status: 200,
    headers: {
      ...corsHeaders,
      'Content-Type': 'text/plain; charset=utf-8',
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'no-cache',
    },
  });
}
