-- Update the stuck job to failed status
UPDATE scraping_jobs 
SET status = 'failed',
    error_message = 'Edge function timeout - job stopped at 305/582 articles',
    completed_at = now()
WHERE id = 'ee4e2d20-c61b-45d7-b712-6f07b7e1e0d6' AND status = 'running';