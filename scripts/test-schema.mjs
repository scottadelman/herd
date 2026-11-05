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

console.log(failures ? `\n${failures} check(s) failed` : '\nAll checks passed');
process.exit(failures ? 1 : 0);
