-- Create knowledge base articles table
CREATE TABLE public.kb_articles (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  title TEXT NOT NULL,
  url TEXT NOT NULL UNIQUE,
  content TEXT,
  summary TEXT,
  category TEXT,
  tags TEXT[],
  vector_id TEXT,
  last_scraped_at TIMESTAMP WITH TIME ZONE,
  last_indexed_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Create scraping jobs table
CREATE TABLE public.scraping_jobs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'running', 'completed', 'failed')),
  total_urls INTEGER DEFAULT 0,
  processed_urls INTEGER DEFAULT 0,
  failed_urls INTEGER DEFAULT 0,
  error_message TEXT,
  started_at TIMESTAMP WITH TIME ZONE,
  completed_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Create indexes for better performance
CREATE INDEX idx_kb_articles_url ON public.kb_articles(url);
CREATE INDEX idx_kb_articles_last_scraped ON public.kb_articles(last_scraped_at);
CREATE INDEX idx_scraping_jobs_status ON public.scraping_jobs(status);
CREATE INDEX idx_scraping_jobs_created_at ON public.scraping_jobs(created_at);

-- Enable RLS
ALTER TABLE public.kb_articles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.scraping_jobs ENABLE ROW LEVEL SECURITY;

-- Create policies for public access (since this is a knowledge base system)
CREATE POLICY "KB articles are publicly readable" 
ON public.kb_articles 
FOR SELECT 
USING (true);

CREATE POLICY "Scraping jobs are publicly readable" 
ON public.scraping_jobs 
FOR SELECT 
USING (true);

CREATE POLICY "Allow inserting kb articles" 
ON public.kb_articles 
FOR INSERT 
WITH CHECK (true);

CREATE POLICY "Allow updating kb articles" 
ON public.kb_articles 
FOR UPDATE 
USING (true);

CREATE POLICY "Allow inserting scraping jobs" 
ON public.scraping_jobs 
FOR INSERT 
WITH CHECK (true);

CREATE POLICY "Allow updating scraping jobs" 
ON public.scraping_jobs 
FOR UPDATE 
USING (true);

-- Create function to update timestamps
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create triggers for automatic timestamp updates
CREATE TRIGGER update_kb_articles_updated_at
  BEFORE UPDATE ON public.kb_articles
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_scraping_jobs_updated_at
  BEFORE UPDATE ON public.scraping_jobs
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();