-- First, check if there's a trigger on scraping_jobs and remove it if it exists
DROP TRIGGER IF EXISTS update_scraping_jobs_updated_at ON scraping_jobs;

-- Now update the stuck jobs
UPDATE scraping_jobs 
SET status = 'completed', 
    completed_at = now(),
    error_message = 'Job automatically closed - was stuck in running state'
WHERE status = 'running' AND completed_at IS NULL;