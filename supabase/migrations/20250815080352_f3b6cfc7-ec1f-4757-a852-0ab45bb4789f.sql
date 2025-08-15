-- Delete the jobs that were automatically closed due to being stuck
DELETE FROM scraping_jobs 
WHERE error_message = 'Job automatically closed - was stuck in running state';