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
    console.log('Starting knowledge base scraping process');
    
    // Create a new scraping job
    const { data: job, error: jobError } = await supabase
      .from('scraping_jobs')
      .insert({ status: 'running', started_at: new Date().toISOString() })
      .select()
      .single();

    if (jobError) {
      console.error('Error creating scraping job:', jobError);
      throw jobError;
    }

    console.log(`Created scraping job: ${job.id}`);

    // Discover all solution articles from the main page
    const baseUrl = 'https://help.gohighlevel.com/support/solutions';
    const discoveredUrls = await discoverArticleUrls(baseUrl);
    
    console.log(`Discovered ${discoveredUrls.length} article URLs`);

    // Update job with total URLs
    await supabase
      .from('scraping_jobs')
      .update({ total_urls: discoveredUrls.length })
      .eq('id', job.id);

    let processedCount = 0;
    let failedCount = 0;

    // Process articles in batches to avoid overwhelming the server
    const batchSize = 5;
    for (let i = 0; i < discoveredUrls.length; i += batchSize) {
      const batch = discoveredUrls.slice(i, i + batchSize);
      
      const batchPromises = batch.map(async (url) => {
        try {
          await scrapeAndStoreArticle(url);
          processedCount++;
          console.log(`Processed article: ${url}`);
        } catch (error) {
          failedCount++;
          console.error(`Failed to process article ${url}:`, error);
        }
      });

      await Promise.all(batchPromises);

      // Update progress
      await supabase
        .from('scraping_jobs')
        .update({ 
          processed_urls: processedCount,
          failed_urls: failedCount 
        })
        .eq('id', job.id);

      // Small delay between batches
      await new Promise(resolve => setTimeout(resolve, 1000));
    }

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

    return new Response(JSON.stringify({ 
      success: true,
      jobId: job.id,
      processed: processedCount,
      failed: failedCount,
      total: discoveredUrls.length
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