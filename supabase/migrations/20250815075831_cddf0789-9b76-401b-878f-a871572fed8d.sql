-- Mark all stuck running jobs as completed
UPDATE scraping_jobs 
SET status = 'completed', 
    completed_at = now(),
    error_message = 'Job automatically closed - was stuck in running state'
WHERE status = 'running' AND completed_at IS NULL;