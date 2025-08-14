import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.55.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const supabase = createClient(
  Deno.env.get('SUPABASE_URL') ?? '',
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
);

const QDRANT_URL = 'https://qdrant.multiseco.eu';
const QDRANT_API_KEY = Deno.env.get('QDRANT_API_KEY');

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { query, limit = 5 } = await req.json();

    if (!query) {
      return new Response(JSON.stringify({ 
        error: 'Query is required' 
      }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    console.log(`Searching for: "${query}" with limit: ${limit}`);

    // Get embedding for the query
    const queryEmbedding = await getEmbedding(query);

    // Search in Qdrant
    const searchResponse = await fetch(`${QDRANT_URL}/collections/highlevel_kb/points/search`, {
      method: 'POST',
      headers: {
        'Api-Key': QDRANT_API_KEY!,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        vector: queryEmbedding,
        limit: limit,
        with_payload: true,
        score_threshold: 0.7 // Minimum similarity score
      }),
    });

    if (!searchResponse.ok) {
      const error = await searchResponse.text();
      throw new Error(`Qdrant search failed: ${error}`);
    }

    const searchResults = await searchResponse.json();
    
    // Format results
    const formattedResults = searchResults.result.map((result: any) => ({
      id: result.payload.article_id,
      title: result.payload.title,
      url: result.payload.url,
      category: result.payload.category,
      content_preview: result.payload.content_preview,
      similarity_score: result.score,
      created_at: result.payload.created_at,
      updated_at: result.payload.updated_at
    }));

    console.log(`Found ${formattedResults.length} relevant articles`);

    return new Response(JSON.stringify({ 
      success: true,
      query,
      results: formattedResults,
      total_found: formattedResults.length
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('Error in search-knowledge-base function:', error);
    return new Response(JSON.stringify({ 
      error: error.message 
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});

async function getEmbedding(text: string): Promise<number[]> {
  // For now, return a mock embedding
  // In production, you would call OpenAI's embedding API here
  
  // Generate a simple mock embedding of the right size (1536 dimensions)
  const mockEmbedding = Array.from({ length: 1536 }, () => Math.random() - 0.5);
  
  // Normalize the vector
  const magnitude = Math.sqrt(mockEmbedding.reduce((sum, val) => sum + val * val, 0));
  return mockEmbedding.map(val => val / magnitude);
}