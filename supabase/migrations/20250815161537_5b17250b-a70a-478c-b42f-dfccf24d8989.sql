-- Enable DELETE on scraping_jobs via RLS policy
ALTER TABLE public.scraping_jobs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow deleting scraping jobs"
ON public.scraping_jobs
FOR DELETE
USING (true);
