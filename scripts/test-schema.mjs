// Runs supabase/schema.sql against a real Postgres (PGlite, in-process) with a
// minimal stand-in for Supabase's auth schema, then checks that household
// isolation and the "only once per slot" rule actually hold.
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';

const db = new PGlite();
const schema = readFileSync(new URL('../supabase/schema.sql', import.meta.url), 'utf8');

await db.exec(`
  create role anon nologin;
  create role authenticated nologin;
  create schema auth;
  create table auth.users (id uuid primary key, email text, raw_user_meta_data jsonb);
  create function auth.uid() returns uuid language sql stable as
    $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  grant usage on schema auth to anon, authenticated;
  grant execute on function auth.uid() to anon, authenticated;
  grant usage on schema public to anon, authenticated;
  create publication supabase_realtime;
`);

await db.exec(schema);
console.log('schema applied');

const users = {
  scott: '11111111-1111-4111-8111-111111111111',
  partner: '22222222-2222-4222-8222-222222222222',
  stranger: '33333333-3333-4333-8333-333333333333',
};
for (const [name, id] of Object.entries(users)) {
  await db.query(`insert into auth.users (id, email, raw_user_meta_data) values ($1, $2, $3)`, [
    id,
    `${name}@example.com`,
    name === 'stranger' ? {} : { display_name: name[0].toUpperCase() + name.slice(1) },
  ]);
}

async function as(user, sql, params = []) {
  await db.exec(`reset role; select set_config('request.jwt.claim.sub', '${user}', false); set role authenticated;`);
  try {
    return await db.query(sql, params);
  } finally {
    await db.exec('reset role;');
  }
}

let failures = 0;
function check(label, cond) {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}`);
  if (!cond) failures++;
}
async function expectError(label, fn, pattern) {
  try {
    await fn();
    check(`${label} (expected an error)`, false);
  } catch (e) {
    check(label, pattern ? pattern.test(e.message) : true);
    if (pattern && !pattern.test(e.message)) console.log('      got:', e.message);
  }
}

const profiles = await db.query('select display_name from public.profiles order by display_name');
check('profiles created on signup with names', profiles.rows.map((r) => r.display_name).join() === 'Partner,Scott,stranger');

const h = (await as(users.scott, `select * from public.create_household('The Den')`)).rows[0];
check('create_household returns the household', h.name === 'The Den' && /^[A-HJ-NP-Z2-9]{8}$/.test(h.invite_code));

const joined = (await as(users.partner, `select * from public.join_household($1)`, [h.invite_code.toLowerCase().replace(/(....)/, '$1-')])).rows[0];
check('partner joins with a lowercase, dashed code', joined.id === h.id);
await as(users.partner, `select * from public.join_household($1)`, [h.invite_code]);
const members = (await as(users.scott, `select user_id, role, color from public.household_members order by joined_at`)).rows;
check('two members, owner first, distinct colors', members.length === 2 && members[0].role === 'owner' && members[0].color !== members[1].color);

await expectError('wrong invite code is rejected', () => as(users.stranger, `select * from public.join_household('ZZZZZZZZ')`), /doesn't match/);

const pet = (await as(users.scott, `insert into public.pets (household_id, name, species, emoji) values ($1, 'Luna', 'dog', '🐕') returning *`, [h.id])).rows[0];
const routine = (await as(users.partner, `insert into public.routines (household_id, pet_id, title, kind, times) values ($1, $2, 'Breakfast', 'daily', '{07:00}') returning *`, [h.id, pet.id])).rows[0];
check('partner can add a routine to a shared pet', !!routine.id);

const log = (await as(users.partner, `insert into public.task_logs (household_id, pet_id, routine_id, occurrence_date, slot, title, done_by) values ($1, $2, $3, '2026-11-04', '07:00', 'Breakfast', $4) returning *`, [h.id, pet.id, routine.id, users.partner])).rows[0];
check('partner checks off breakfast', !!log.id);
await expectError('second check-off of the same slot is blocked', () =>
  as(users.scott, `insert into public.task_logs (household_id, pet_id, routine_id, occurrence_date, slot, title, done_by) values ($1, $2, $3, '2026-11-04', '07:00', 'Breakfast', $4)`, [h.id, pet.id, routine.id, users.scott]),
  /task_logs_once_per_slot/,
);
await expectError('cannot check things off as someone else', () =>
  as(users.scott, `insert into public.task_logs (household_id, pet_id, routine_id, occurrence_date, slot, title, done_by) values ($1, $2, $3, '2026-11-05', '07:00', 'Breakfast', $4)`, [h.id, pet.id, routine.id, users.partner]),
  /row-level security/,
);

// Isolation from a stranger in their own household
const h2 = (await as(users.stranger, `select * from public.create_household('Elsewhere')`)).rows[0];
check('stranger sees no pets from The Den', (await as(users.stranger, `select * from public.pets`)).rows.length === 0);
check('stranger sees only their own household', (await as(users.stranger, `select id from public.households`)).rows.every((r) => r.id === h2.id));
check('stranger cannot see Den members’ profiles', (await as(users.stranger, `select * from public.profiles`)).rows.length === 1);
await expectError('stranger cannot add a pet to The Den', () =>
  as(users.stranger, `insert into public.pets (household_id, name) values ($1, 'Intruder')`, [h.id]),
  /row-level security/,
);
await expectError('a routine cannot point at another household’s pet', () =>
  as(users.stranger, `insert into public.routines (household_id, pet_id, title, kind) values ($1, $2, 'Hijack', 'daily')`, [h2.id, pet.id]),
  /foreign key/,
);
const del = await as(users.stranger, `delete from public.task_logs where id = $1`, [log.id]);
check('stranger cannot undo Den check-offs', del.affectedRows === 0);
await expectError('stranger cannot assign a Den routine to themselves', () =>
  as(users.stranger, `insert into public.routines (household_id, pet_id, title, kind, assignee) values ($1, $2, 'x', 'daily', $3)`, [h2.id, pet.id, users.scott]),
);

// Roles and ownership
await expectError('members cannot promote themselves', () =>
  as(users.partner, `update public.household_members set role = 'owner' where user_id = $1`, [users.partner]),
  /permission denied/,
);
await as(users.partner, `update public.household_members set color = '#1F8A70' where user_id = $1 and household_id = $2`, [users.partner, h.id]);
check('members can change their own stamp color', (await as(users.scott, `select color from public.household_members where user_id = $1`, [users.partner])).rows[0].color === '#1F8A70');
await expectError('only the owner can make a new invite code', () => as(users.partner, `select public.regenerate_invite($1)`, [h.id]), /Only the household owner/);
const newCode = (await as(users.scott, `select public.regenerate_invite($1) as code`, [h.id])).rows[0].code;
check('owner gets a new invite code', newCode !== h.invite_code);
const ownerLeave = await as(users.scott, `delete from public.household_members where user_id = $1 and household_id = $2`, [users.scott, h.id]);
check('owner cannot leave (must delete instead)', ownerLeave.affectedRows === 0);
const removed = await as(users.scott, `delete from public.household_members where user_id = $1 and household_id = $2`, [users.partner, h.id]);
check('owner can remove a member', removed.affectedRows === 1);
check('removed member loses access to pets', (await as(users.partner, `select * from public.pets`)).rows.length === 0);

await expectError('signed-out visitors see nothing', async () => {
  await db.exec('set role anon;');
  try {
    await db.query('select * from public.pets');
  } finally {
    await db.exec('reset role;');
  }
}, /permission denied/);

// ---------------------------------------------------------------------------
// Upgrade 002: snooze, edits, health, photos, sitters, reminders
// ---------------------------------------------------------------------------
console.log('\n-- upgrade 002 --');

async function asAnon(sql, params = []) {
  await db.exec(`reset role; select set_config('request.jwt.claim.sub', '', false); set role anon;`);
  try {
    return await db.query(sql, params);
  } finally {
    await db.exec('reset role;');
  }
}
const day = async (offset) =>
  (await db.query(`select ((now() at time zone 'UTC')::date + $1::int)::text as d`, [offset])).rows[0].d;
const today = await day(0);
const yesterday = await day(-1);
const tomorrow = await day(1);

await as(users.partner, `select * from public.join_household($1)`, [newCode]);
check('partner rejoins with the new invite code', (await as(users.partner, `select * from public.pets`)).rows.length === 1);

const cabin = (await as(users.scott, `select * from public.create_household('Cabin', 'America/New_York')`)).rows[0];
check('create_household stores the time zone', cabin.timezone === 'America/New_York');
check(
  'one person can belong to two households',
  (await as(users.scott, `select household_id from public.household_members where user_id = $1`, [users.scott])).rows.length === 2,
);
await as(users.scott, `update public.households set timezone = 'UTC' where id = $1`, [h.id]);
check('owner sets the household time zone', (await as(users.scott, `select timezone from public.households where id = $1`, [h.id])).rows[0].timezone === 'UTC');

const med = (
  await as(users.scott,
    `insert into public.routines (household_id, pet_id, title, kind, times, category, dose, start_date)
     values ($1, $2, 'Heartworm chewable', 'once', '{}', 'medication', '1 chewable', $3) returning *`,
    [h.id, pet.id, today])
).rows[0];
check('one-time medication with a dose', med.kind === 'once' && med.category === 'medication' && med.dose === '1 chewable');
await expectError('unknown task category is rejected', () =>
  as(users.scott, `insert into public.routines (household_id, pet_id, title, kind, category) values ($1, $2, 'x', 'daily', 'bogus')`, [h.id, pet.id]),
  /check constraint/,
);

const walk = (
  await as(users.scott, `insert into public.routines (household_id, pet_id, title, kind, times) values ($1, $2, 'Walk', 'daily', '{18:00}') returning *`, [h.id, pet.id])
).rows[0];
const snoozed = (
  await as(users.scott,
    `insert into public.task_logs (household_id, pet_id, routine_id, occurrence_date, slot, title, done_by, status, snoozed_to)
     values ($1, $2, $3, $4, '18:00', 'Walk', $5, 'snoozed', $6) returning *`,
    [h.id, pet.id, walk.id, today, users.scott, tomorrow])
).rows[0];
check('snooze a task to tomorrow', snoozed.status === 'snoozed');
await expectError('a snooze needs a new date', () =>
  as(users.scott,
    `insert into public.task_logs (household_id, pet_id, routine_id, occurrence_date, slot, title, done_by, status)
     values ($1, $2, $3, $4, '18:00', 'Walk', $5, 'snoozed')`,
    [h.id, pet.id, walk.id, yesterday, users.scott]),
  /task_logs_snooze_has_date/,
);
const finish = await as(users.partner, `update public.task_logs set status = 'done', done_by = $1, done_at = now() where id = $2 and status = 'snoozed' returning id`, [users.partner, snoozed.id]);
check('partner finishes the moved task', finish.rows.length === 1);
const finishAgain = await as(users.scott, `update public.task_logs set status = 'done', done_by = $1, done_at = now() where id = $2 and status = 'snoozed' returning id`, [users.scott, snoozed.id]);
check('a moved task can only be finished once', finishAgain.rows.length === 0);

await as(users.partner, `update public.task_logs set done_at = done_at - interval '1 hour', note = 'only ate half' where id = $1`, [snoozed.id]);
check('edit the time and note on your own check-off', (await as(users.scott, `select note from public.task_logs where id = $1`, [snoozed.id])).rows[0].note === 'only ate half');
await expectError('cannot edit someone else’s check-off', () =>
  as(users.scott, `update public.task_logs set note = 'mine now' where id = $1`, [snoozed.id]),
  /row-level security/,
);
await expectError('cannot move a log to a different task', () =>
  as(users.scott, `update public.task_logs set routine_id = $1 where id = $2`, [med.id, snoozed.id]),
  /permission denied/,
);
await expectError('members cannot pose as a sitter', () =>
  as(users.scott,
    `insert into public.task_logs (household_id, pet_id, routine_id, occurrence_date, slot, title, done_by, sitter_name)
     values ($1, $2, $3, $4, '18:00', 'Walk', $5, 'Fake sitter')`,
    [h.id, pet.id, walk.id, yesterday, users.scott]),
  /row-level security/,
);
const skipped = await as(users.scott,
  `insert into public.task_logs (household_id, pet_id, routine_id, occurrence_date, slot, title, done_by, status)
   values ($1, $2, $3, $4, '18:00', 'Walk', $5, 'skipped') returning status`,
  [h.id, pet.id, walk.id, tomorrow, users.scott]);
check('skip a task', skipped.rows[0].status === 'skipped');

await as(users.partner, `insert into public.pet_weights (household_id, pet_id, weight, unit) values ($1, $2, 62.4, 'lb')`, [h.id, pet.id]);
check('members log a weight', (await as(users.scott, `select weight from public.pet_weights`)).rows.length === 1);
check('strangers can’t see weights', (await as(users.stranger, `select * from public.pet_weights`)).rows.length === 0);

await as(users.scott, `update public.pets set photo = 'data:image/jpeg;base64,AAAA' where id = $1`, [pet.id]);
check('members add a pet photo', (await as(users.partner, `select photo from public.pets where id = $1`, [pet.id])).rows[0].photo.startsWith('data:image/'));
await expectError('photos must be image data', () => as(users.scott, `update public.pets set photo = 'https://evil.example/x.js' where id = $1`, [pet.id]), /check constraint/);

await as(users.partner, `update public.household_members set notify_late = false, notify_daily = '08:00' where user_id = $1 and household_id = $2`, [users.partner, h.id]);
check('members set their reminder preferences', (await as(users.partner, `select notify_daily from public.household_members where user_id = $1 and household_id = $2`, [users.partner, h.id])).rows[0].notify_daily === '08:00');

await as(users.scott, `select public.save_push_subscription('https://push.example.com/abc', 'p256', 'authkey')`);
check('save a push subscription', (await db.query(`select user_id from public.push_subscriptions`)).rows[0].user_id === users.scott);
check('no push key until the reminder job first runs', (await as(users.scott, `select public.get_push_public_key() as k`)).rows[0].k === null);
await expectError('push subscriptions are private', () => as(users.scott, `select * from public.push_subscriptions`), /permission denied/);
await expectError('server secrets are private', () => as(users.scott, `select * from public.app_secrets`), /permission denied/);
check('a reminder job password was generated', (await db.query(`select length(value) as n from public.app_secrets where key = 'cron_secret'`)).rows[0].n === 64);

const olive = (await as(users.scott, `insert into public.pets (household_id, name, species) values ($1, 'Olive', 'cat') returning *`, [h.id])).rows[0];
const oliveDinner = (await as(users.scott, `insert into public.routines (household_id, pet_id, title, kind, times) values ($1, $2, 'Dinner', 'daily', '{18:00}') returning *`, [h.id, olive.id])).rows[0];
const link = (
  await as(users.scott,
    `insert into public.sitter_links (household_id, label, pet_ids, expires_at) values ($1, 'Maria', array[$2]::uuid[], now() + interval '3 days') returning *`,
    [h.id, pet.id])
).rows[0];
check('sitter link gets a long random token', /^[0-9a-f]{32}$/.test(link.token));
check('strangers can’t see sitter links', (await as(users.stranger, `select * from public.sitter_links`)).rows.length === 0);

const view = (await asAnon(`select public.sitter_view($1) as v`, [link.token])).rows[0].v;
check('sitter sees only the pets on the link', view.pets.length === 1 && view.pets[0].name === 'Luna');
check('sitter sees routines without assignments', view.routines.length > 0 && view.routines.every((r) => !('assignee' in r)));
check('sitter view leaves out the invite code', !JSON.stringify(view).includes(newCode));

const sat = (await asAnon(`select public.sitter_complete($1, $2, $3, '07:00') as r`, [link.token, routine.id, today])).rows[0].r;
check('sitter checks off breakfast without an account', sat.ok && sat.log.sitter_name === 'Maria' && sat.log.done_by === null);
const satAgain = (await asAnon(`select public.sitter_complete($1, $2, $3, '07:00') as r`, [link.token, routine.id, today])).rows[0].r;
check('a second check-off returns the first one', satAgain.ok === false && satAgain.log.id === sat.log.id);
await expectError('sitters can’t check off tomorrow', () => asAnon(`select public.sitter_complete($1, $2, $3, '07:00')`, [link.token, routine.id, tomorrow]), /only check off today/);
await expectError('sitters can’t touch pets left off the link', () => asAnon(`select public.sitter_complete($1, $2, $3, '18:00')`, [link.token, oliveDinner.id, today]), /isn't part of this sitter link/);

await as(users.scott,
  `insert into public.task_logs (household_id, pet_id, routine_id, occurrence_date, slot, title, done_by, status, snoozed_to)
   values ($1, $2, $3, $4, '18:00', 'Walk', $5, 'snoozed', $6)`,
  [h.id, pet.id, walk.id, yesterday, users.scott, today]);
const movedDone = (await asAnon(`select public.sitter_complete($1, $2, $3, '18:00') as r`, [link.token, walk.id, yesterday])).rows[0].r;
check('sitter finishes a task moved to today', movedDone.ok && movedDone.log.status === 'done' && movedDone.log.snoozed_to === today);

await asAnon(`select public.sitter_undo($1, $2)`, [link.token, sat.log.id]);
check('sitter undoes their own check-off', (await db.query(`select * from public.task_logs where id = $1`, [sat.log.id])).rows.length === 0);
await asAnon(`select public.sitter_undo($1, $2)`, [link.token, movedDone.log.id]);
check('undoing a moved task puts it back', (await db.query(`select status from public.task_logs where id = $1`, [movedDone.log.id])).rows[0].status === 'snoozed');
await expectError('sitters can’t undo other people’s check-offs', () => asAnon(`select public.sitter_undo($1, $2)`, [link.token, snoozed.id]), /Only your own/);
await expectError('the sitter link can’t read tables directly', () => asAnon(`select * from public.task_logs`), /permission denied/);

await as(users.scott, `update public.sitter_links set revoked = true where id = $1`, [link.id]);
await expectError('a turned-off link stops working', () => asAnon(`select public.sitter_view($1)`, [link.token]), /expired or was turned off/);
const old = (await as(users.scott, `insert into public.sitter_links (household_id, label, expires_at) values ($1, 'Old', now() - interval '1 minute') returning token`, [h.id])).rows[0];
await expectError('an expired link stops working', () => asAnon(`select public.sitter_view($1)`, [old.token]), /expired or was turned off/);
await expectError('a made-up token gets nothing', () => asAnon(`select public.sitter_view('0000')`), /expired or was turned off/);

// ---------------------------------------------------------------------------
// Upgrade 003: pet profiles, supplies, walk places
// ---------------------------------------------------------------------------
console.log('\n-- upgrade 003 --');

await as(users.partner,
  `update public.pets set breed = 'Lab mix', birthday = '2019-04-02', sex = 'female', fixed = true,
     allergies = array['chicken'], likes = array['tennis balls'], dislikes = array['golden retrievers', 'baths'],
     food = 'Salmon kibble', food_amount = '1 cup', feeding_notes = 'Soak for 5 minutes',
     vet_clinic = 'Park Slope Vet', vet_phone = '(718) 555-0100'
   where id = $1`, [pet.id]);
const prof = (await as(users.scott, `select * from public.pets where id = $1`, [pet.id])).rows[0];
check('members fill in a pet profile', prof.breed === 'Lab mix' && prof.dislikes.includes('golden retrievers') && prof.food_amount === '1 cup');
const hog = (await as(users.scott, `insert into public.pets (household_id, name, species, species_label, emoji) values ($1, 'Quill', 'other', 'Hedgehog', '🦔') returning *`, [h.id])).rows[0];
check('an "other" pet says what kind it is', hog.species_label === 'Hedgehog' && hog.allergies.length === 0);
await expectError('sex must be female or male', () => as(users.scott, `update public.pets set sex = 'x' where id = $1`, [pet.id]), /check constraint/);

const food = (
  await as(users.scott,
    `insert into public.supplies (household_id, name, kind, pet_ids, opened_on, lasts_days) values ($1, 'Salmon kibble 30 lb', 'food', array[$2]::uuid[], $3, 28) returning *`,
    [h.id, pet.id, today])
).rows[0];
check('add a food bag with how long it lasts', food.lasts_days === 28 && food.lead_days === 5);
await as(users.partner, `update public.supplies set ordered_on = $1 where id = $2`, [today, food.id]);
check('anyone in the household marks it ordered', (await as(users.scott, `select ordered_on from public.supplies where id = $1`, [food.id])).rows[0].ordered_on !== null);
await as(users.partner, `update public.supplies set restocks = restocks || opened_on, opened_on = $1, ordered_on = null where id = $2`, [tomorrow, food.id]);
check('opening a new bag keeps the old date', (await as(users.scott, `select restocks from public.supplies where id = $1`, [food.id])).rows[0].restocks.length === 1);
await expectError('order links must be web links', () => as(users.scott, `update public.supplies set order_url = 'javascript:alert(1)' where id = $1`, [food.id]), /check constraint/);
await as(users.partner, `update public.household_members set notify_supplies = false where user_id = $1 and household_id = $2`, [users.partner, h.id]);
check('members turn reorder reminders off', (await as(users.partner, `select notify_supplies from public.household_members where user_id = $1 and household_id = $2`, [users.partner, h.id])).rows[0].notify_supplies === false);
check('strangers can’t see supplies',(await as(users.stranger, `select * from public.supplies`)).rows.length === 0);
await expectError('strangers can’t add supplies to The Den', () =>
  as(users.stranger, `insert into public.supplies (household_id, name, lasts_days) values ($1, 'x', 10)`, [h.id]), /row-level security/);
await expectError('supplies can’t move to another household', () =>
  as(users.scott, `update public.supplies set household_id = $1 where id = $2`, [h2.id, food.id]), /permission denied/);

const route = (
  await as(users.partner,
    `insert into public.places (household_id, kind, name, points) values ($1, 'route', 'Morning loop', '[[40.67,-73.97],[40.671,-73.968],[40.672,-73.97]]') returning *`,
    [h.id])
).rows[0];
check('save a walk route', route.points.length === 3);
await as(users.scott, `insert into public.places (household_id, kind, name, points) values ($1, 'bag_spot', 'Bags by the gate', '[[40.67,-73.97]]')`, [h.id]);
await expectError('a place needs at least one point', () =>
  as(users.scott, `insert into public.places (household_id, kind, name, points) values ($1, 'park', 'Nowhere', '[]')`, [h.id]), /check constraint/);
check('strangers can’t see places', (await as(users.stranger, `select * from public.places`)).rows.length === 0);

const link3 = (
  await as(users.scott,
    `insert into public.sitter_links (household_id, label, pet_ids, expires_at) values ($1, 'Sam', array[$2]::uuid[], now() + interval '1 day') returning token`,
    [h.id, pet.id])
).rows[0];
const view3 = (await asAnon(`select public.sitter_view($1) as v`, [link3.token])).rows[0].v;
check('sitter sees the pet profile', view3.pets[0].food_amount === '1 cup' && view3.pets[0].dislikes.includes('golden retrievers'));
check('sitter sees the walk places', view3.places.length === 2 && view3.places.some((p) => p.name === 'Morning loop'));
check('sitter still sees only the pets on the link', view3.pets.length === 1);
await expectError('the sitter link can’t read supplies', () => asAnon(`select * from public.supplies`), /permission denied/);

console.log(failures ? `\n${failures} check(s) failed` : '\nAll checks passed');
process.exit(failures ? 1 : 0);
