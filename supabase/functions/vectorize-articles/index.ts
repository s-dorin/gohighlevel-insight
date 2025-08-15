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

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    console.log('🚀 Starting vectorization process');
    
    // Get secrets fresh from environment
    const QDRANT_API_KEY = Deno.env.get('QDRANT_API_KEY');
    const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY');
    
    console.log('🔍 Debug environment variables:');
    console.log('QDRANT_API_KEY exists:', !!QDRANT_API_KEY);
    console.log('QDRANT_API_KEY length:', QDRANT_API_KEY?.length || 0);
    console.log('OPENAI_API_KEY exists:', !!OPENAI_API_KEY);
    console.log('OPENAI_API_KEY length:', OPENAI_API_KEY?.length || 0);
    console.log('OPENAI_API_KEY value preview:', OPENAI_API_KEY?.substring(0, 10) || 'null/undefined');
    
    const results = {
      qdrant_url: QDRANT_URL,
      qdrant_key_available: !!QDRANT_API_KEY,
      openai_key_available: !!OPENAI_API_KEY,
      debug: {
        qdrant_length: QDRANT_API_KEY?.length || 0,
        openai_length: OPENAI_API_KEY?.length || 0,
        openai_preview: OPENAI_API_KEY?.substring(0, 10) || 'null/undefined'
      },
      tests: []
    };

    // Test 1: Check API keys
    results.tests.push('✅ API keys checked');
    
    // Debug: Show available env vars (without values)
    const envVars = Object.keys(Deno.env.toObject());
    results.tests.push(`🔍 Available env vars: ${envVars.filter(k => k.includes('API')).join(', ')}`);
    
    if (!QDRANT_API_KEY || QDRANT_API_KEY.length === 0) {
      results.tests.push('❌ QDRANT_API_KEY missing or empty');
      return new Response(JSON.stringify({ 
        success: false,
        error: 'QDRANT_API_KEY not configured',
        results: results
      }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    
    if (!OPENAI_API_KEY || OPENAI_API_KEY.length === 0) {
      results.tests.push(`❌ OPENAI_API_KEY missing or empty (length: ${OPENAI_API_KEY?.length || 0})`);
      return new Response(JSON.stringify({ 
        success: false,
        error: 'OPENAI_API_KEY not configured',
        results: results
      }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    
    results.tests.push(`✅ OPENAI_API_KEY found (${OPENAI_API_KEY.substring(0, 8)}...)`);
    results.tests.push(`✅ QDRANT_API_KEY found (${QDRANT_API_KEY.substring(0, 8)}...)`);

    // Test 2: Qdrant connection
    results.tests.push('🔍 Testing Qdrant...');
    try {
      const qdrantResponse = await fetch(`${QDRANT_URL}/collections`, {
        headers: {
          'Api-Key': QDRANT_API_KEY,
          'Content-Type': 'application/json',
        },
      });
      
      if (qdrantResponse.ok) {
        const collections = await qdrantResponse.json();
        results.tests.push(`✅ Qdrant accessible - ${collections.result?.collections?.length || 0} collections`);
      } else {
        const error = await qdrantResponse.text();
        results.tests.push(`❌ Qdrant error: ${qdrantResponse.status} ${error}`);
        throw new Error(`Qdrant error: ${qdrantResponse.status}`);
      }
    } catch (qdrantError) {
      results.tests.push(`❌ Qdrant connection failed: ${qdrantError.message}`);
      throw qdrantError;
    }

    // Test 3: Database query
    results.tests.push('📚 Testing database...');
    const { data: articles, error: articlesError } = await supabase
      .from('kb_articles')
      .select('id, title, content')
      .is('last_indexed_at', null)
      .limit(10);

    if (articlesError) {
      results.tests.push(`❌ Database error: ${articlesError.message}`);
      throw articlesError;
    }

    results.tests.push(`✅ Database query successful - ${articles?.length || 0} articles found`);
    
    if (articles && articles.length > 0) {
      const testArticle = articles[0];
      results.tests.push(`Test article: "${testArticle.title}" (${testArticle.content?.length || 0} chars)`);

      // Test 4: OpenAI API
      if (testArticle.content) {
        results.tests.push('🤖 Testing OpenAI...');
        try {
          const openaiResponse = await fetch('https://api.openai.com/v1/embeddings', {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${OPENAI_API_KEY}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              model: 'text-embedding-3-small',
              input: testArticle.content.substring(0, 1000),
            }),
          });

          if (openaiResponse.ok) {
            const embeddingResult = await openaiResponse.json();
            results.tests.push(`✅ OpenAI successful - ${embeddingResult.data[0].embedding.length} dimensions`);
          } else {
            const error = await openaiResponse.text();
            results.tests.push(`❌ OpenAI error: ${openaiResponse.status} ${error}`);
          }
        } catch (openaiError) {
          results.tests.push(`❌ OpenAI connection failed: ${openaiError.message}`);
        }
      }
    }

    // Now do actual vectorization
    results.tests.push('🚀 Starting vectorization...');
    
    let processedCount = 0;
    for (const article of articles || []) {
      if (!article.content) continue;
      
      try {
        // Generate embedding
        const embeddingResponse = await fetch('https://api.openai.com/v1/embeddings', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${OPENAI_API_KEY}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: 'text-embedding-3-small',
            input: article.content,
          }),
        });

        if (!embeddingResponse.ok) {
          throw new Error(`OpenAI error: ${embeddingResponse.status}`);
        }

        const embeddingResult = await embeddingResponse.json();
        const embedding = embeddingResult.data[0].embedding;

        // Store in Qdrant
        const qdrantResponse = await fetch(`${QDRANT_URL}/collections/knowledge_base/points`, {
          method: 'PUT',
          headers: {
            'Api-Key': QDRANT_API_KEY,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            points: [{
              id: article.id,
              vector: embedding,
              payload: {
                title: article.title,
                content: article.content,
              }
            }]
          }),
        });

        if (!qdrantResponse.ok) {
          throw new Error(`Qdrant error: ${qdrantResponse.status}`);
        }

        // Update database
        await supabase
          .from('kb_articles')
          .update({ last_indexed_at: new Date().toISOString() })
          .eq('id', article.id);

        processedCount++;
        results.tests.push(`✅ Processed: ${article.title}`);

      } catch (error) {
        results.tests.push(`❌ Failed: ${article.title} - ${error.message}`);
      }
    }

    results.tests.push('✅ All tests completed');

    return new Response(JSON.stringify({ 
      success: true,
      message: 'Debug tests completed',
      results: results
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('Error in vectorize function:', error);
    return new Response(JSON.stringify({ 
      success: false,
      error: error.message,
      stack: error.stack
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});