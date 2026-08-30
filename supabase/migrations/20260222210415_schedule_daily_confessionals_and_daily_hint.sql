/*
  # Schedule daily confessionals and daily round-robin hint

  1. daily-confessionals cron (23:00 UTC daily)
     - Triggers the daily-confessionals edge function
     - Generates end-of-day confessionals for all agents that haven't done one today

  2. daily-agent-hint cron (12:00 UTC daily)
     - Triggers generate-host-clue with mode=daily
     - Selects one agent per day using round-robin (least covered first)
     - Ensures every agent gets a hint cycle before any repeats

  Both jobs use the same anon JWT as the existing auto-tick cron.
*/

do $$
begin
  if exists (select 1 from cron.job where jobname = 'daily-confessionals') then
    perform cron.unschedule('daily-confessionals');
  end if;
end $$;

select cron.schedule(
  'daily-confessionals',
  '0 23 * * *',
  $$
  select net.http_post(
    url := 'https://jthvygmsuurqvrbsbyns.supabase.co/functions/v1/daily-confessionals',
    headers := '{"Content-Type": "application/json", "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imp0aHZ5Z21zdXVycXZyYnNieW5zIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzEyNzEyMjEsImV4cCI6MjA4Njg0NzIyMX0.UbNkrguonO-z0K04LGI3VEoMVBq8EpD1QMrbOxKmZik"}'::jsonb,
    body := '{}'::jsonb
  ) as request_id;
  $$
);

do $$
begin
  if exists (select 1 from cron.job where jobname = 'daily-agent-hint') then
    perform cron.unschedule('daily-agent-hint');
  end if;
end $$;

select cron.schedule(
  'daily-agent-hint',
  '0 12 * * *',
  $$
  select net.http_post(
    url := 'https://jthvygmsuurqvrbsbyns.supabase.co/functions/v1/generate-host-clue',
    headers := '{"Content-Type": "application/json", "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imp0aHZ5Z21zdXVycXZyYnNieW5zIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzEyNzEyMjEsImV4cCI6MjA4Njg0NzIyMX0.UbNkrguonO-z0K04LGI3VEoMVBq8EpD1QMrbOxKmZik"}'::jsonb,
    body := '{"mode": "daily"}'::jsonb
  ) as request_id;
  $$
);
