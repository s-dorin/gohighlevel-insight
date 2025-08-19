-- Enable required extensions for scheduling HTTP calls
create extension if not exists pg_net with schema extensions;
create extension if not exists pg_cron with schema extensions;

-- Unschedule previous job with the same name if it exists
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'vectorize-articles-daily-0200') THEN
    PERFORM cron.unschedule((SELECT jobid FROM cron.job WHERE jobname = 'vectorize-articles-daily-0200' LIMIT 1));
  END IF;
END
$$;

-- Schedule daily invocation at ~02:00 Romania time (23:00 UTC during DST)
select
  cron.schedule(
    'vectorize-articles-daily-0200',
    '0 23 * * *',
    $$
    select
      net.http_post(
          url:='https://zdmjwyzchjriezxnjppg.supabase.co/functions/v1/vectorize-articles',
          headers:='{"Content-Type": "application/json", "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InpkbWp3eXpjaGpyaWV6eG5qcHBnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTUxOTQ0OTcsImV4cCI6MjA3MDc3MDQ5N30.wGTGm4S8xp-8lXMLr5d0uLrkaxtCI2kgLE2qv7kjYbU"}'::jsonb,
          body:='{"auto_scheduled": true, "batch_size": 50}'::jsonb
      ) as request_id;
    $$
  );