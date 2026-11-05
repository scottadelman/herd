// Supabase Edge Function: sends Herd's push reminders. A scheduled job calls
// it every 5 minutes (see supabase/enable-reminders.sql).
//
// It needs no setup of its own: it creates its push keys the first time it
// runs and keeps them in the app_secrets table, which only it can read.

import { createClient } from 'npm:@supabase/supabase-js@2';
import webpush from 'npm:web-push@3.6.7';
import { addDays, computeReminders, localNow, type RLog } from './logic.ts';

type Sub = { id: string; user_id: string; endpoint: string; p256dh: string; auth: string };

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

Deno.serve(async (req) => {
  const url = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !serviceKey) return json({ error: 'Missing Supabase settings' }, 500);
  const db = createClient(url, serviceKey, { auth: { persistSession: false } });

  const { data: secretRows, error: secretError } = await db.from('app_secrets').select('key, value');
  if (secretError) return json({ error: secretError.message }, 500);
  const secrets = Object.fromEntries((secretRows ?? []).map((r) => [r.key, r.value]));
  if (!secrets.cron_secret || req.headers.get('x-herd-cron') !== secrets.cron_secret) {
    return json({ error: 'Not allowed' }, 401);
  }

  // Push keys: made once, then reused. The app reads the public half.
  let publicKey = secrets.vapid_public;
  let privateKey = secrets.vapid_private;
  if (!publicKey || !privateKey) {
    const keys = webpush.generateVAPIDKeys();
    const { error } = await db.from('app_secrets').upsert([
      { key: 'vapid_public', value: keys.publicKey },
      { key: 'vapid_private', value: keys.privateKey },
    ]);
    if (error) return json({ error: error.message }, 500);
    publicKey = keys.publicKey;
    privateKey = keys.privateKey;
  }
  webpush.setVapidDetails(secrets.vapid_subject || url, publicKey, privateKey);

  const { data: subs } = await db.from('push_subscriptions').select('id, user_id, endpoint, p256dh, auth');
  const subscriptions = (subs ?? []) as Sub[];
  if (!subscriptions.length) return json({ ok: true, sent: 0, note: 'No phones have reminders turned on yet.' });
  const userIds = [...new Set(subscriptions.map((s) => s.user_id))];

  const { data: memberRows } = await db
    .from('household_members')
    .select('household_id, user_id, notify_late, notify_daily')
    .in('user_id', userIds);
  const members = memberRows ?? [];
  const householdIds = [...new Set(members.map((m) => m.household_id))];
  if (!householdIds.length) return json({ ok: true, sent: 0 });

  const since = addDays(localNow(new Date(), 'UTC').date, -2);
  const [h, p, r, l, sent] = await Promise.all([
    db.from('households').select('id, name, timezone').in('id', householdIds),
    db.from('pets').select('id, household_id, name').in('household_id', householdIds),
    db.from('routines').select('*').in('household_id', householdIds).eq('active', true),
    db
      .from('task_logs')
      .select('routine_id, occurrence_date, slot, status, snoozed_to')
      .in('household_id', householdIds)
      .not('routine_id', 'is', null)
      .or(`occurrence_date.gte.${since},snoozed_to.gte.${since}`),
    db.from('notifications_sent').select('key').gte('sent_at', new Date(Date.now() - 2 * 86_400_000).toISOString()),
  ]);
  for (const res of [h, p, r, l, sent]) if (res.error) return json({ error: res.error.message }, 500);

  const reminders = computeReminders(
    {
      households: h.data ?? [],
      members,
      pets: p.data ?? [],
      routines: r.data ?? [],
      logs: (l.data ?? []) as RLog[],
      alreadySent: new Set((sent.data ?? []).map((x) => x.key)),
    },
    new Date(),
  );

  let delivered = 0;
  const gone: string[] = [];
  for (const reminder of reminders) {
    const payload = JSON.stringify({ title: reminder.title, body: reminder.body, tag: reminder.tag, url: './' });
    for (const s of subscriptions.filter((x) => x.user_id === reminder.userId)) {
      try {
        await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload, {
          TTL: 60 * 60,
          urgency: 'high',
        });
        delivered++;
      } catch (e) {
        const code = (e as { statusCode?: number }).statusCode;
        // The phone turned reminders off or the app was removed.
        if (code === 404 || code === 410) gone.push(s.id);
        else console.error('push failed', code, (e as Error).message);
      }
    }
  }

  if (reminders.length) {
    await db.from('notifications_sent').upsert(reminders.map((x) => ({ key: x.key })), { onConflict: 'key', ignoreDuplicates: true });
  }
  if (gone.length) await db.from('push_subscriptions').delete().in('id', gone);
  await db.from('notifications_sent').delete().lt('sent_at', new Date(Date.now() - 3 * 86_400_000).toISOString());

  return json({ ok: true, reminders: reminders.length, delivered, removedPhones: gone.length });
});
