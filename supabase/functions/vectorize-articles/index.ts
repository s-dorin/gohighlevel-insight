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
    const debugSteps = [];
    
    debugSteps.push('🚀 Function started');
    console.log('🚀 Function started');
    
    debugSteps.push(`Qdrant URL: ${QDRANT_URL}`);
    debugSteps.push(`Qdrant API Key available: ${!!QDRANT_API_KEY}`);
    debugSteps.push(`OpenAI API Key available: ${!!Deno.env.get('OPENAI_API_KEY')}`);
    
    console.log('Environment check completed');
    
    if (!QDRANT_API_KEY) {
      throw new Error('QDRANT_API_KEY is not configured');
    }

    if (!Deno.env.get('OPENAI_API_KEY')) {
      throw new Error('OPENAI_API_KEY is not configured');
    }

    debugSteps.push('✅ API keys verified');
    
    // Test Qdrant connection
    debugSteps.push('🔍 Testing Qdrant connection...');
    console.log('🔍 Testing Qdrant connection...');
    
    try {
      const testResponse = await fetch(`${QDRANT_URL}/collections`, {
        headers: {
          'Api-Key': QDRANT_API_KEY!,
          'Content-Type': 'application/json',
        },
      });
      
      debugSteps.push(`Qdrant response status: ${testResponse.status}`);
      
      if (testResponse.ok) {
        const collections = await testResponse.json();
        debugSteps.push('✅ Qdrant is accessible');
        debugSteps.push(`Collections found: ${JSON.stringify(collections)}`);
      } else {
        const error = await testResponse.text();
        debugSteps.push(`❌ Qdrant error: ${testResponse.status} ${error}`);
        throw new Error(`Qdrant not accessible: ${testResponse.status} ${error}`);
      }
    } catch (connectionError) {
      debugSteps.push(`❌ Qdrant connection failed: ${connectionError.message}`);
      throw connectionError;
    }

    // Get articles
    debugSteps.push('📚 Fetching articles...');
    console.log('📚 Fetching articles...');
    
    const { data: articles, error: articlesError } = await supabase
      .from('kb_articles')
      .select('id, title, content, last_indexed_at')
      .is('last_indexed_at', null)
      .order('created_at', { ascending: true })
      .limit(3); // Start with just 3 articles for testing

    if (articlesError) {
      debugSteps.push(`❌ Articles fetch error: ${articlesError.message}`);
      throw articlesError;
    }

    debugSteps.push(`Found ${articles?.length || 0} articles to process`);
    
    if (!articles || articles.length === 0) {
      debugSteps.push('No articles need vectorization');
      return new Response(JSON.stringify({ 
        message: 'No articles need vectorization',
        processed: 0,
        debug_steps: debugSteps
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Test with just one article
    const testArticle = articles[0];
    debugSteps.push(`Testing with article: ${testArticle.title}`);
    debugSteps.push(`Article content length: ${testArticle.content?.length || 0}`);
    
    if (!testArticle.content || testArticle.content.trim().length === 0) {
      debugSteps.push('❌ Test article has no content');
      return new Response(JSON.stringify({ 
        message: 'Test article has no content',
        processed: 0,
        failed: 1,
        debug_steps: debugSteps
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Test OpenAI embedding
    debugSteps.push('🤖 Testing OpenAI embedding...');
    const testText = `${testArticle.title}\n\n${testArticle.content.substring(0, 1000)}`;
    
    try {
      const embedding = await getEmbedding(testText);
      debugSteps.push(`✅ Got embedding with ${embedding.length} dimensions`);
    } catch (embeddingError) {
      debugSteps.push(`❌ Embedding error: ${embeddingError.message}`);
      throw embeddingError;
    }

    debugSteps.push('✅ All tests passed!');
    
    return new Response(JSON.stringify({ 
      message: 'Debug completed - all systems working',
      processed: 0,
      failed: 0,
      debug_steps: debugSteps,
      test_article: {
        id: testArticle.id,
        title: testArticle.title,
        content_length: testArticle.content.length
      }
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('Error in vectorize-articles function:', error);
    return new Response(JSON.stringify({ 
      error: error.message,
      debug_info: 'Function failed during execution'
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});

async function ensureQdrantCollection(): Promise<void> {
  try {
    // Check if collection exists
    const response = await fetch(`${QDRANT_URL}/collections/highlevel_kb`, {
      headers: {
        'Api-Key': QDRANT_API_KEY!,
        'Content-Type': 'application/json',
      },
    });

    if (response.status === 404) {
      // Collection doesn't exist, create it
      console.log('Creating Qdrant collection...');
      
      const createResponse = await fetch(`${QDRANT_URL}/collections/highlevel_kb`, {
        method: 'PUT',
        headers: {
          'Api-Key': QDRANT_API_KEY!,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          vectors: {
            size: 1536, // text-embedding-3-small dimensions
            distance: 'Cosine'
          },
          optimizers_config: {
            default_segment_number: 2
          },
          replication_factor: 1
        }),
      });

      if (!createResponse.ok) {
        const error = await createResponse.text();
        throw new Error(`Failed to create Qdrant collection: ${error}`);
      }

      console.log('Qdrant collection created successfully');
    } else if (!response.ok) {
      const error = await response.text();
      throw new Error(`Error checking Qdrant collection: ${error}`);
    } else {
      console.log('Qdrant collection already exists');
    }
  } catch (error) {
    console.error('Error with Qdrant collection:', error);
    throw error;
  }
}

async function vectorizeAndStoreArticle(article: any): Promise<void> {
  try {
    console.log(`Starting vectorization for article: ${article.id}`);
    console.log(`Article title: ${article.title}`);
    console.log(`Article has content: ${!!article.content}`);
    console.log(`Content length: ${article.content ? article.content.length : 0}`);
    
    // Check if article has valid content
    if (!article.content || article.content.trim().length === 0) {
      throw new Error('Article has no content to vectorize');
    }
    
    // Create text for embedding (title + content)
    const textToEmbed = `${article.title}\n\n${article.content}`;
    console.log(`Text to embed length: ${textToEmbed.length}`);
    
    // Get embedding from OpenAI (we'll need to add OpenAI API key)
    console.log('Generating embedding...');
    const embedding = await getEmbedding(textToEmbed);
    console.log(`Generated embedding with ${embedding.length} dimensions`);
    
    // Generate a unique vector ID
    const vectorId = `article_${article.id}`;
    console.log(`Vector ID: ${vectorId}`);
    
    // Store in Qdrant
    console.log('Storing in Qdrant...');
    const qdrantResponse = await fetch(`${QDRANT_URL}/collections/highlevel_kb/points`, {
      method: 'PUT',
      headers: {
        'Api-Key': QDRANT_API_KEY!,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        points: [
          {
            id: vectorId,
            vector: embedding,
            payload: {
              title: article.title,
              url: article.url,
              category: article.category,
              content_preview: article.content.substring(0, 500),
              article_id: article.id,
              created_at: article.created_at,
              updated_at: article.updated_at
            }
          }
        ]
      }),
    });

    console.log(`Qdrant response status: ${qdrantResponse.status}`);
    
    if (!qdrantResponse.ok) {
      const error = await qdrantResponse.text();
      console.error(`Qdrant error response: ${error}`);
      throw new Error(`Failed to store in Qdrant: ${error}`);
    }
    
    const qdrantResult = await qdrantResponse.text();
    console.log(`Qdrant success response: ${qdrantResult}`);

    // Update article with vector_id and last_indexed_at
    console.log('Updating article in database...');
    const { error: updateError } = await supabase
      .from('kb_articles')
      .update({
        vector_id: vectorId,
        last_indexed_at: new Date().toISOString()
      })
      .eq('id', article.id);

    if (updateError) {
      console.error('Error updating article:', updateError);
      throw updateError;
    }
    
    console.log(`✅ Successfully completed vectorization for article: ${article.id}`);

  } catch (error) {
    console.error(`❌ Error vectorizing article ${article.id}:`, error);
    throw error;
  }
}

async function getEmbedding(text: string): Promise<number[]> {
  const openAIApiKey = Deno.env.get('OPENAI_API_KEY');
  
  if (!openAIApiKey) {
    throw new Error('OpenAI API key not configured');
  }

  try {
    console.log('🤖 Calling OpenAI embeddings API...');
    const response = await fetch('https://api.openai.com/v1/embeddings', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${openAIApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'text-embedding-3-small',
        input: text.substring(0, 8192), // Limit text length for embeddings
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      console.error('OpenAI API error:', error);
      throw new Error(`OpenAI API error: ${response.status} ${error}`);
    }

    const result = await response.json();
    console.log(`✅ Got embedding with ${result.data[0].embedding.length} dimensions`);
    
    return result.data[0].embedding;
  } catch (error) {
    console.error('Error generating embedding:', error);
    throw error;
  }
}