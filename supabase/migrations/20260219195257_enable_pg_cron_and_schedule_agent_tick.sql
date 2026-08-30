/*
  Enable pg_cron and pg_net, then schedule automatic agent tick every 2 minutes.
  The cron job calls the auto-tick edge function which makes all idle agents act.
  Agents idle for more than 5 minutes are eligible; up to 3 act per tick.
*/

create extension if not exists pg_net;

create extension if not exists pg_cron;

do $$
begin
  if exists (select 1 from cron.job where jobname = 'agent-auto-tick') then
    perform cron.unschedule('agent-auto-tick');
  end if;
end $$;

select cron.schedule(
  'agent-auto-tick',
  '*/2 * * * *',
  $$
  select net.http_post(
    url := 'https://jthvygmsuurqvrbsbyns.supabase.co/functions/v1/auto-tick',
    headers := '{"Content-Type": "application/json", "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imp0aHZ5Z21zdXVycXZyYnNieW5zIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzEyNzEyMjEsImV4cCI6MjA4Njg0NzIyMX0.UbNkrguonO-z0K04LGI3VEoMVBq8EpD1QMrbOxKmZik"}'::jsonb,
    body := '{}'::jsonb
  ) as request_id;
  $$
);
