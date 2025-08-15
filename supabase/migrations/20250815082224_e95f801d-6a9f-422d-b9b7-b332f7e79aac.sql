-- Update the job stuck at 410 articles to failed status
UPDATE scraping_jobs 
SET status = 'failed',
    error_message = 'Edge function timeout - job stopped at 410/582 articles',
    completed_at = now()
WHERE id = 'c28b7c4e-c7d7-4db1-8ff2-6ce7d9e5eeea' AND status = 'running';