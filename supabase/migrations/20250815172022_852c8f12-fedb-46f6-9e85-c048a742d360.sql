-- Enable pg_cron extension
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- Create a scheduled job to run vectorization every 7 days
SELECT cron.schedule(
  'auto-vectorize-new-articles',
  '0 2 * * 0', -- Every Sunday at 2 AM
  $$
  SELECT
    net.http_post(
        url:='https://zdmjwyzchjriezxnjppg.supabase.co/functions/v1/vectorize-articles',
        headers:='{"Content-Type": "application/json", "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InpkbWp3eXpjaGpyaWV6eG5qcHBnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTUxOTQ0OTcsImV4cCI6MjA3MDc3MDQ5N30.wGTGm4S8xp-8lXMLr5d0uLrkaxtCI2kgLE2qv7kjYbU"}'::jsonb,
        body:='{"batch_size": 50, "auto_scheduled": true}'::jsonb
    ) as request_id;
  $$
);

-- Create a table to track vectorization schedules and progress
CREATE TABLE IF NOT EXISTS public.vectorization_schedules (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  schedule_name text NOT NULL,
  last_run_at timestamp with time zone,
  next_run_at timestamp with time zone,
  articles_processed integer DEFAULT 0,
  articles_failed integer DEFAULT 0,
  status text DEFAULT 'pending',
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now()
);

-- Enable RLS on the new table
ALTER TABLE public.vectorization_schedules ENABLE ROW LEVEL SECURITY;

-- Create policies for vectorization_schedules
CREATE POLICY "Vectorization schedules are publicly readable" 
ON public.vectorization_schedules 
FOR SELECT 
USING (true);

CREATE POLICY "Allow inserting vectorization schedules" 
ON public.vectorization_schedules 
FOR INSERT 
WITH CHECK (true);

CREATE POLICY "Allow updating vectorization schedules" 
ON public.vectorization_schedules 
FOR UPDATE 
USING (true);

-- Insert the weekly schedule record
INSERT INTO public.vectorization_schedules (schedule_name, next_run_at, status)
VALUES ('weekly-auto-vectorization', '2025-08-24 02:00:00+00', 'active')
ON CONFLICT DO NOTHING;