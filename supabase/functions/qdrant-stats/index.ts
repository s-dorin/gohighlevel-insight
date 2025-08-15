import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const QDRANT_URL = 'https://qdrant.multiseco.eu';

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const QDRANT_API_KEY = Deno.env.get('QDRANT_API_KEY');
    if (!QDRANT_API_KEY) {
      throw new Error('Missing QDRANT_API_KEY');
    }

    // Fetch collection info from Qdrant
    const resp = await fetch(`${QDRANT_URL}/collections/knowledge_base`, {
      headers: {
        'Api-Key': QDRANT_API_KEY,
        'Content-Type': 'application/json',
      },
    });

    if (!resp.ok) {
      const text = await resp.text();
      throw new Error(`Qdrant responded ${resp.status}: ${text}`);
    }

    const data = await resp.json();
    const result = data?.result || {};

    const payload = {
      success: true,
      name: result?.config?.params?.name || 'knowledge_base',
      vectors_size: result?.config?.params?.vectors?.size ?? null,
      distance: result?.config?.params?.vectors?.distance ?? null,
      points_count: result?.points_count ?? null,
      status: result?.status ?? null,
    };

    return new Response(JSON.stringify(payload), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('qdrant-stats error:', error);
    return new Response(JSON.stringify({ success: false, error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
