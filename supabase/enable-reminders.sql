-- Turns on Herd's reminders: every 5 minutes, call the reminder function
-- (deployed in Supabase as "clever-api"), which sends any late-task and
-- morning-summary notifications.
--
-- Run this in Supabase > SQL Editor AFTER the function is deployed
-- (README: "Turn on reminders"). Running it again is safe: it replaces the
-- existing schedule.
--
-- If the function's name or the Supabase project ever changes, update the URL
-- below to match the one on the function's Settings page.

create extension if not exists pg_net with schema extensions;
create extension if not exists pg_cron;

select cron.schedule(
  'herd-reminders',
  '*/5 * * * *',
  $$
  select net.http_post(
    url := 'https://wruemcfxvqjpfusryykc.supabase.co/functions/v1/clever-api',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-herd-cron', (select value from public.app_secrets where key = 'cron_secret')
    ),
    body := '{}'::jsonb
  );
  $$
);

-- To turn reminders off again:
--   select cron.unschedule('herd-reminders');
