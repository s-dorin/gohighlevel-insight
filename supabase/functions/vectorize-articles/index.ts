// Vectorize articles function - Updated to force redeploy
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
    const body = await req.json().catch(() => ({}));
    const { 
      batch_size = 50, 
      auto_scheduled = false,
      force_all = false 
    } = body;
    console.log('🚀 Starting vectorization process with batch size:', batch_size);
    
    // Debug all environment variables
    const allEnvVars = Deno.env.toObject();
    console.log('All available environment variables:', Object.keys(allEnvVars));
    console.log('Environment variables containing API:', Object.keys(allEnvVars).filter(key => key.includes('API')));
    
    const QDRANT_API_KEY = Deno.env.get('QDRANT_API_KEY');
    const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY');
    
    console.log('Debug - API keys status:');
    console.log('QDRANT_API_KEY exists:', !!QDRANT_API_KEY);
    console.log('OPENAI_API_KEY exists:', !!OPENAI_API_KEY);
    console.log('QDRANT_API_KEY length:', QDRANT_API_KEY?.length || 0);
    console.log('OPENAI_API_KEY length:', OPENAI_API_KEY?.length || 0);
    
    if (!QDRANT_API_KEY) {
      console.error('QDRANT_API_KEY is missing from environment');
      throw new Error('QDRANT_API_KEY not found in environment variables');
    }
    
    if (!OPENAI_API_KEY) {
      console.error('OPENAI_API_KEY is missing from environment');
      console.error('Available env vars:', Object.keys(allEnvVars).join(', '));
      throw new Error('OPENAI_API_KEY not found in environment variables');
    }

    // Ensure knowledge_base collection exists in Qdrant
    const qdrantResponse = await fetch(`${QDRANT_URL}/collections`, {
      headers: {
        'Api-Key': QDRANT_API_KEY,
        'Content-Type': 'application/json',
      },
    });
    
    if (qdrantResponse.ok) {
      const collections = await qdrantResponse.json();
      const hasKnowledgeBase = collections.result?.collections?.some(col => col.name === 'knowledge_base');
      
      if (!hasKnowledgeBase) {
        console.log('Creating knowledge_base collection...');
        await fetch(`${QDRANT_URL}/collections/knowledge_base`, {
          method: 'PUT',
          headers: {
            'Api-Key': QDRANT_API_KEY,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            vectors: {
              size: 1536, // OpenAI text-embedding-3-small dimension
              distance: 'Cosine'
            }
          }),
        });
      }
    }

    // Get unvectorized articles (articles without vector_id, regardless of last_indexed_at)
    const { data: articles, error: articlesError } = await supabase
      .from('kb_articles')
      .select('id, title, content, url')
      .is('vector_id', null)
      .not('content', 'is', null)
      .limit(batch_size);

    if (articlesError) {
      throw new Error(`Database error: ${articlesError.message}`);
    }

    if (!articles || articles.length === 0) {
      return new Response(JSON.stringify({ 
        success: true,
        message: 'No articles to vectorize',
        processed: 0,
        remaining: 0
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    console.log(`Processing ${articles.length} articles...`);
    
    let processedCount = 0;
    let failedCount = 0;

    // Process articles in smaller batches to avoid rate limits
    const processingBatchSize = 3;
    for (let i = 0; i < articles.length; i += processingBatchSize) {
      const batch = articles.slice(i, i + processingBatchSize);
      
      const batchPromises = batch.map(async (article) => {
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
              input: article.content.substring(0, 8000), // Limit content length
            }),
          });

          if (!embeddingResponse.ok) {
            const error = await embeddingResponse.text();
            throw new Error(`OpenAI error: ${embeddingResponse.status} ${error}`);
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
                  content: article.content.substring(0, 2000), // Store shorter content in payload
                  url: article.url
                }
              }]
            }),
          });

          if (!qdrantResponse.ok) {
            const error = await qdrantResponse.text();
            throw new Error(`Qdrant error: ${qdrantResponse.status} ${error}`);
          }

          // Update database with vector_id and last_indexed_at
          await supabase
            .from('kb_articles')
            .update({ 
              last_indexed_at: new Date().toISOString(),
              vector_id: article.id
            })
            .eq('id', article.id);

          processedCount++;
          console.log(`✅ Vectorized: ${article.title} (${processedCount}/${articles.length})`);

        } catch (error) {
          failedCount++;
          console.error(`❌ Failed to vectorize ${article.title}:`, error.message);
        }
      });

      await Promise.all(batchPromises);
      
      // Small delay between batches to respect rate limits
      if (i + processingBatchSize < articles.length) {
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    }

    // Check if there are more articles to process
    const { count: remainingCount } = await supabase
      .from('kb_articles')
      .select('*', { count: 'exact', head: true })
      .is('vector_id', null)
      .not('content', 'is', null);

    console.log(`Batch completed. Processed: ${processedCount}, Failed: ${failedCount}, Remaining: ${remainingCount || 0}`);

    // Update schedule tracking if this was an auto-scheduled run
    if (auto_scheduled) {
      try {
        // Find the most recently updated auto schedule (daily/weekly/monthly)
        const { data: activeSchedule, error: scheduleFetchError } = await supabase
          .from('vectorization_schedules')
          .select('*')
          .in('schedule_name', ['daily-auto-vectorization','weekly-auto-vectorization','monthly-auto-vectorization'])
          .order('updated_at', { ascending: false })
          .limit(1)
          .single();

        if (scheduleFetchError) {
          console.error('Failed to fetch active schedule:', scheduleFetchError.message);
        }

        const nowIso = new Date().toISOString();

        // Compute next_run_at based on existing next_run_at and frequency
        let nextRun = activeSchedule?.next_run_at ? new Date(activeSchedule.next_run_at) : new Date();
        const freq = activeSchedule?.schedule_name?.startsWith('daily') ? 'daily' : activeSchedule?.schedule_name?.startsWith('weekly') ? 'weekly' : activeSchedule?.schedule_name?.startsWith('monthly') ? 'monthly' : 'weekly';
        function addPeriod(d: Date) {
          const nd = new Date(d);
          if (freq === 'daily') nd.setDate(nd.getDate() + 1);
          else if (freq === 'weekly') nd.setDate(nd.getDate() + 7);
          else if (freq === 'monthly') nd.setMonth(nd.getMonth() + 1);
          return nd;
        }
        const now = new Date();
        if (!activeSchedule?.next_run_at) {
          // If no next_run_at set yet, set to 02:00 today then roll forward at least once
          nextRun.setHours(2, 0, 0, 0);
        }
        while (nextRun <= now) nextRun = addPeriod(nextRun);

        const { error: updateErr } = await supabase
          .from('vectorization_schedules')
          .update({
            last_run_at: nowIso,
            articles_processed: processedCount,
            articles_failed: failedCount,
            status: remainingCount && remainingCount > 0 ? 'running' : 'active',
            next_run_at: nextRun.toISOString(),
            updated_at: nowIso
          })
          .eq('id', activeSchedule?.id);

        if (updateErr) {
          console.error('Failed to update schedule tracking:', updateErr.message);
        } else {
          console.log('Updated schedule tracking');
        }
      } catch (scheduleError) {
        console.error('Failed to update schedule tracking:', scheduleError);
      }
    }

    // Auto-continue if there are more articles to process
    if (remainingCount && remainingCount > 0) {
      console.log('Auto-continuing vectorization for remaining articles...');
      
      try {
        const continueResponse = await fetch(
          `${Deno.env.get('SUPABASE_URL')}/functions/v1/vectorize-articles`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${Deno.env.get('SUPABASE_ANON_KEY')}`
            },
              body: JSON.stringify({ 
                batch_size: batch_size,
                auto_scheduled: auto_scheduled
              })
          }
        );
        
        console.log('Continuation vectorization started:', continueResponse.status);
      } catch (continueError) {
        console.error('Failed to start continuation vectorization:', continueError);
      }
    }

    return new Response(JSON.stringify({ 
      success: true,
      processed: processedCount,
      failed: failedCount,
      remaining: remainingCount || 0,
      isComplete: !remainingCount || remainingCount === 0,
      nextBatch: remainingCount && remainingCount > 0
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