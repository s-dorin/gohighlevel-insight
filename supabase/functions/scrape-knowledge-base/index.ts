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

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { resume_job_id, batch_size = 20 } = await req.json().catch(() => ({}));
    console.log('Starting knowledge base scraping process', { resume_job_id, batch_size });
    
    let job;
    let discoveredUrls: string[] = [];
    let startIndex = 0;

    if (resume_job_id) {
      // Resume existing job
      const { data: existingJob, error: jobError } = await supabase
        .from('scraping_jobs')
        .select('*')
        .eq('id', resume_job_id)
        .single();

      if (jobError || !existingJob) {
        throw new Error(`Job ${resume_job_id} not found`);
      }

      job = existingJob;
      startIndex = job.processed_urls || 0;
      console.log(`Resuming job ${job.id} from index ${startIndex}`);

      // Re-discover URLs (we need the full list to continue)
      const baseUrl = 'https://help.gohighlevel.com/support/solutions';
      discoveredUrls = await discoverArticleUrls(baseUrl);
    } else {
      // Create a new scraping job
      const { data: newJob, error: jobError } = await supabase
        .from('scraping_jobs')
        .insert({ status: 'running', started_at: new Date().toISOString() })
        .select()
        .single();

      if (jobError) {
        console.error('Error creating scraping job:', jobError);
        throw jobError;
      }

      job = newJob;
      console.log(`Created scraping job: ${job.id}`);

      // Discover all solution articles from the main page
      const baseUrl = 'https://help.gohighlevel.com/support/solutions';
      discoveredUrls = await discoverArticleUrls(baseUrl);
      
      console.log(`Discovered ${discoveredUrls.length} article URLs`);

      // Update job with total URLs
      await supabase
        .from('scraping_jobs')
        .update({ total_urls: discoveredUrls.length })
        .eq('id', job.id);
    }

    let processedCount = job.processed_urls || 0;
    let failedCount = job.failed_urls || 0;

    // Process only a limited batch to avoid timeout
    const maxBatchArticles = Math.min(batch_size, 50); // Maximum 50 articles per call
    const endIndex = Math.min(startIndex + maxBatchArticles, discoveredUrls.length);
    const currentBatch = discoveredUrls.slice(startIndex, endIndex);

    console.log(`Processing articles ${startIndex} to ${endIndex} of ${discoveredUrls.length}`);

    // Process articles in smaller batches
    const processingBatchSize = 3;
    for (let i = 0; i < currentBatch.length; i += processingBatchSize) {
      const batch = currentBatch.slice(i, i + processingBatchSize);
      
      const batchPromises = batch.map(async (url) => {
        try {
          await scrapeAndStoreArticle(url);
          processedCount++;
          console.log(`Processed article: ${url} (${processedCount}/${discoveredUrls.length})`);
        } catch (error) {
          failedCount++;
          console.error(`Failed to process article ${url}:`, error);
        }
      });

      await Promise.all(batchPromises);

      // Update progress after each small batch
      await supabase
        .from('scraping_jobs')
        .update({ 
          processed_urls: processedCount,
          failed_urls: failedCount 
        })
        .eq('id', job.id);

      // Small delay between batches
      await new Promise(resolve => setTimeout(resolve, 500));
    }

    const isComplete = processedCount + failedCount >= discoveredUrls.length;

    if (isComplete) {
      // Complete the job
      await supabase
        .from('scraping_jobs')
        .update({ 
          status: 'completed',
          completed_at: new Date().toISOString(),
          processed_urls: processedCount,
          failed_urls: failedCount
        })
        .eq('id', job.id);

      console.log(`Scraping completed. Processed: ${processedCount}, Failed: ${failedCount}`);
    } else {
      console.log(`Batch completed. Processed: ${processedCount}/${discoveredUrls.length}, continuing...`);
      
      // Auto-continue by calling self
      try {
        const continueResponse = await fetch(
          `${Deno.env.get('SUPABASE_URL')}/functions/v1/scrape-knowledge-base`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${Deno.env.get('SUPABASE_ANON_KEY')}`
            },
            body: JSON.stringify({ 
              resume_job_id: job.id,
              batch_size: batch_size 
            })
          }
        );
        
        console.log('Continuation job started:', continueResponse.status);
      } catch (continueError) {
        console.error('Failed to start continuation job:', continueError);
      }
    }

    return new Response(JSON.stringify({ 
      success: true,
      jobId: job.id,
      processed: processedCount,
      failed: failedCount,
      total: discoveredUrls.length,
      isComplete,
      nextBatch: !isComplete
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('Error in scrape-knowledge-base function:', error);
    return new Response(JSON.stringify({ 
      error: error.message 
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});

async function discoverArticleUrls(baseUrl: string): Promise<string[]> {
  try {
    const response = await fetch(baseUrl);
    const html = await response.text();
    
    // Extract article URLs from the page
    const urlRegex = /href="([^"]*\/support\/solutions\/articles\/[^"]+)"/g;
    const urls = new Set<string>();
    
    let match;
    while ((match = urlRegex.exec(html)) !== null) {
      const url = match[1];
      if (url.startsWith('/')) {
        urls.add(`https://help.gohighlevel.com${url}`);
      } else if (url.startsWith('https://help.gohighlevel.com')) {
        urls.add(url);
      }
    }

    // Also try to discover category pages
    const categoryRegex = /href="([^"]*\/support\/solutions\/[0-9]+[^"]+)"/g;
    const categoryUrls = new Set<string>();
    
    while ((match = categoryRegex.exec(html)) !== null) {
      const url = match[1];
      if (url.startsWith('/')) {
        categoryUrls.add(`https://help.gohighlevel.com${url}`);
      } else if (url.startsWith('https://help.gohighlevel.com')) {
        categoryUrls.add(url);
      }
    }

    // Scrape articles from category pages
    for (const categoryUrl of categoryUrls) {
      try {
        const categoryResponse = await fetch(categoryUrl);
        const categoryHtml = await categoryResponse.text();
        
        let categoryMatch;
        while ((categoryMatch = urlRegex.exec(categoryHtml)) !== null) {
          const url = categoryMatch[1];
          if (url.startsWith('/')) {
            urls.add(`https://help.gohighlevel.com${url}`);
          } else if (url.startsWith('https://help.gohighlevel.com')) {
            urls.add(url);
          }
        }
      } catch (error) {
        console.error(`Error scraping category ${categoryUrl}:`, error);
      }
    }

    return Array.from(urls);
  } catch (error) {
    console.error('Error discovering article URLs:', error);
    return [];
  }
}

async function scrapeAndStoreArticle(url: string): Promise<void> {
  try {
    const response = await fetch(url);
    const html = await response.text();

    // Extract article content
    const title = extractTitle(html);
    const content = extractContent(html);
    const category = extractCategory(html);

    if (!title || !content) {
      console.log(`Skipping article with missing title or content: ${url}`);
      return;
    }

    // Check if article already exists
    const { data: existing } = await supabase
      .from('kb_articles')
      .select('id')
      .eq('url', url)
      .maybeSingle();

    const articleData = {
      title,
      url,
      content,
      category: category || 'General',
      last_scraped_at: new Date().toISOString()
    };

    if (existing) {
      // Update existing article
      await supabase
        .from('kb_articles')
        .update(articleData)
        .eq('id', existing.id);
    } else {
      // Insert new article
      await supabase
        .from('kb_articles')
        .insert(articleData);
    }

  } catch (error) {
    console.error(`Error scraping article ${url}:`, error);
    throw error;
  }
}

function extractTitle(html: string): string | null {
  const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  if (titleMatch) {
    return titleMatch[1].trim().replace(/\s+/g, ' ');
  }
  
  const h1Match = html.match(/<h1[^>]*>([^<]+)<\/h1>/i);
  if (h1Match) {
    return h1Match[1].trim().replace(/\s+/g, ' ');
  }
  
  return null;
}

function extractContent(html: string): string | null {
  // Remove script and style tags
  let cleanHtml = html.replace(/<script[^>]*>.*?<\/script>/gis, '');
  cleanHtml = cleanHtml.replace(/<style[^>]*>.*?<\/style>/gis, '');
  
  // Try to find main content area
  const contentPatterns = [
    /<article[^>]*>(.*?)<\/article>/is,
    /<div[^>]*class="[^"]*content[^"]*"[^>]*>(.*?)<\/div>/is,
    /<div[^>]*class="[^"]*article[^"]*"[^>]*>(.*?)<\/div>/is,
    /<main[^>]*>(.*?)<\/main>/is,
  ];

  for (const pattern of contentPatterns) {
    const match = cleanHtml.match(pattern);
    if (match) {
      cleanHtml = match[1];
      break;
    }
  }

  // Remove HTML tags and normalize whitespace
  const textContent = cleanHtml
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  return textContent.length > 100 ? textContent : null;
}

function extractCategory(html: string): string | null {
  // Try to extract category from breadcrumbs or navigation
  const breadcrumbMatch = html.match(/<nav[^>]*aria-label="breadcrumb"[^>]*>(.*?)<\/nav>/is);
  if (breadcrumbMatch) {
    const breadcrumbText = breadcrumbMatch[1].replace(/<[^>]+>/g, ' ').trim();
    const parts = breadcrumbText.split(/\s+/).filter(part => part.length > 2);
    return parts[parts.length - 2] || 'General';
  }

  return null;
}