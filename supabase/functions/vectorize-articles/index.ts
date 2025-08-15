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
    console.log('🚀 Starting vectorization process');
    console.log('Qdrant URL:', QDRANT_URL);
    console.log('Qdrant API Key available:', !!QDRANT_API_KEY);
    
    // Return early for testing
    return new Response(JSON.stringify({ 
      message: 'Function is accessible',
      qdrant_configured: !!QDRANT_API_KEY,
      url: QDRANT_URL
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
    
    if (!QDRANT_API_KEY) {
      throw new Error('QDRANT_API_KEY is not configured');
    }

    // Get articles that haven't been indexed yet
    console.log('📚 Fetching unindexed articles...');
    const { data: articles, error: articlesError } = await supabase
      .from('kb_articles')
      .select('*')
      .is('last_indexed_at', null)
      .order('created_at', { ascending: true });

    if (articlesError) {
      console.error('Error fetching articles:', articlesError);
      throw articlesError;
    }

    if (!articles || articles.length === 0) {
      console.log('No articles need vectorization');
      return new Response(JSON.stringify({ 
        message: 'No articles need vectorization',
        processed: 0 
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    console.log(`Found ${articles.length} articles to vectorize`);

    // Ensure Qdrant collection exists
    console.log('🔍 Checking Qdrant collection...');
    await ensureQdrantCollection();

    let processedCount = 0;
    let failedCount = 0;

    // Process articles in batches (smaller batch size to avoid timeout)
    const maxArticles = Math.min(articles.length, 10); // Limit to max 10 articles per run
    
    console.log(`Processing first ${maxArticles} articles out of ${articles.length} total`);
    
    for (let i = 0; i < maxArticles; i++) {
      const article = articles[i];
      
      try {
        console.log(`Processing article ${i + 1}/${maxArticles}: ${article.title}`);
        await vectorizeAndStoreArticle(article);
        processedCount++;
        console.log(`✅ Successfully vectorized: ${article.title}`);
      } catch (error) {
        failedCount++;
        console.error(`❌ Failed to vectorize article ${article.id}:`, error);
      }

      // Small delay between articles to avoid rate limiting
      if (i < maxArticles - 1) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }

    console.log(`Vectorization completed. Processed: ${processedCount}, Failed: ${failedCount}`);

    return new Response(JSON.stringify({ 
      success: true,
      processed: processedCount,
      failed: failedCount,
      total: articles.length
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('Error in vectorize-articles function:', error);
    return new Response(JSON.stringify({ 
      error: error.message 
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
            size: 1536, // OpenAI embedding size
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
  // For now, return a mock embedding
  // In production, you would call OpenAI's embedding API here
  // We'll implement this when OpenAI API key is added
  
  // Generate a simple mock embedding of the right size (1536 dimensions)
  const mockEmbedding = Array.from({ length: 1536 }, () => Math.random() - 0.5);
  
  // Normalize the vector
  const magnitude = Math.sqrt(mockEmbedding.reduce((sum, val) => sum + val * val, 0));
  return mockEmbedding.map(val => val / magnitude);
}