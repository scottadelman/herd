-- Turns on Herd's reminders: every 5 minutes, call the send-reminders
-- function, which sends any late-task and morning-summary notifications.
--
-- Run this in Supabase > SQL Editor AFTER the send-reminders function is
-- deployed (README: "Turn on reminders"). Running it again is safe.
--
-- If you ever move to a different Supabase project, change the project URL
-- below to the new one.

create extension if not exists pg_net with schema extensions;
create extension if not exists pg_cron;

select cron.schedule(
  'herd-reminders',
  '*/5 * * * *',
  $$
  select net.http_post(
    url := 'https://wruemcfxvqjpfusryykc.supabase.co/functions/v1/send-reminders',
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
