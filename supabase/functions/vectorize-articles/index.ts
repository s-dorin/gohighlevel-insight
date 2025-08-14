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
    console.log('Starting article vectorization process');

    // Get articles that haven't been indexed yet
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
    await ensureQdrantCollection();

    let processedCount = 0;
    let failedCount = 0;

    // Process articles in batches
    const batchSize = 3;
    for (let i = 0; i < articles.length; i += batchSize) {
      const batch = articles.slice(i, i + batchSize);
      
      const batchPromises = batch.map(async (article) => {
        try {
          await vectorizeAndStoreArticle(article);
          processedCount++;
          console.log(`Vectorized article: ${article.title}`);
        } catch (error) {
          failedCount++;
          console.error(`Failed to vectorize article ${article.id}:`, error);
        }
      });

      await Promise.all(batchPromises);

      // Small delay between batches to avoid rate limiting
      await new Promise(resolve => setTimeout(resolve, 2000));
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
    // Create text for embedding (title + content)
    const textToEmbed = `${article.title}\n\n${article.content}`;
    
    // Get embedding from OpenAI (we'll need to add OpenAI API key)
    const embedding = await getEmbedding(textToEmbed);
    
    // Generate a unique vector ID
    const vectorId = `article_${article.id}`;
    
    // Store in Qdrant
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

    if (!qdrantResponse.ok) {
      const error = await qdrantResponse.text();
      throw new Error(`Failed to store in Qdrant: ${error}`);
    }

    // Update article with vector_id and last_indexed_at
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

  } catch (error) {
    console.error(`Error vectorizing article ${article.id}:`, error);
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