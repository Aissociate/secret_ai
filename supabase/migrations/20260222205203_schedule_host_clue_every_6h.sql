/*
  # Schedule host clue generation every 6 hours

  Every 6 hours, the host agent generates a cryptic anonymous clue
  about a random living agent's secret and posts it publicly.
  The clue is indirect and never reveals the agent's name.
*/

do $$
begin
  if exists (select 1 from cron.job where jobname = 'host-clue-every-6h') then
    perform cron.unschedule('host-clue-every-6h');
  end if;
end $$;

select cron.schedule(
  'host-clue-every-6h',
  '0 */6 * * *',
  $$
  select net.http_post(
    url := 'https://jthvygmsuurqvrbsbyns.supabase.co/functions/v1/generate-host-clue',
    headers := '{"Content-Type": "application/json", "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imp0aHZ5Z21zdXVycXZyYnNieW5zIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzEyNzEyMjEsImV4cCI6MjA4Njg0NzIyMX0.UbNkrguonO-z0K04LGI3VEoMVBq8EpD1QMrbOxKmZik"}'::jsonb,
    body := '{}'::jsonb
  ) as request_id;
  $$
);
