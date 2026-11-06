import { describe, expect, it } from 'vitest';
import {
  computeReminders,
  localNow,
  needsOrder as serverNeedsOrder,
  occurrences,
  openItems,
  supplyDates,
  type ReminderInput,
  type RRoutine,
  type RSupply,
} from '../../supabase/functions/send-reminders/src/logic.ts';
import { addDays } from './dates';
import { buildDay } from './day';
import { occurrencesForDate } from './schedule';
import { needsOrder, supplyStatus } from './supplies';
import { EMPTY_PROFILE, type Routine, type Supply, type TaskLog } from './types';

const routine = (over: Partial<RRoutine>): RRoutine => ({
  id: 'r1',
  household_id: 'h1',
  pet_id: 'p1',
  title: 'Dinner',
  kind: 'daily',
  category: 'care',
  dose: null,
  times: ['18:00'],
  weekdays: [],
  interval_days: null,
  start_date: '2026-10-01',
  assignee: null,
  active: true,
  ...over,
});

const base = (over: Partial<ReminderInput> = {}): ReminderInput => ({
  households: [{ id: 'h1', name: 'The Parkers', timezone: 'America/New_York' }],
  members: [
    { household_id: 'h1', user_id: 'jamie', notify_late: true, notify_daily: '07:30' },
    { household_id: 'h1', user_id: 'priya', notify_late: true, notify_daily: null },
  ],
  pets: [{ id: 'p1', household_id: 'h1', name: 'Biscuit' }],
  routines: [routine({})],
  logs: [],
  alreadySent: new Set(),
  ...over,
});

// 6:35 PM in New York on Nov 5, 2026 (EST, UTC-5)
const at = (hh: number, mm: number) => new Date(Date.UTC(2026, 10, 5, hh + 5, mm));

describe('localNow', () => {
  it('converts to the household time zone', () => {
    expect(localNow(at(18, 35), 'America/New_York')).toEqual({ date: '2026-11-05', minutes: 18 * 60 + 35 });
    expect(localNow(at(18, 35), 'Not/AZone').date).toBe('2026-11-05');
  });
});

describe('late reminders', () => {
  it('fire 30 minutes after the task time, to everyone who wants them', () => {
    expect(computeReminders(base(), at(18, 29))).toEqual([]);
    const out = computeReminders(base(), at(18, 35));
    expect(out.map((r) => r.userId)).toEqual(['jamie', 'priya']);
    expect(out[0].title).toBe('Dinner for Biscuit is late');
    expect(out[0].body).toBe('Due at 6:00 PM. Open Herd to check it off or snooze it.');
  });
  it('go only to the assigned person when there is one', () => {
    const out = computeReminders(base({ routines: [routine({ assignee: 'priya' })] }), at(18, 40));
    expect(out.map((r) => r.userId)).toEqual(['priya']);
  });
  it('mention the dose for medications', () => {
    const out = computeReminders(
      base({ routines: [routine({ title: 'Thyroid pill', category: 'medication', dose: '½ tablet' })] }),
      at(18, 40),
    );
    expect(out[0].body).toBe('½ tablet, due at 6:00 PM. Open Herd to check it off or snooze it.');
  });
  it('stop once the task is checked off, skipped or snoozed', () => {
    for (const status of ['done', 'skipped'] as const) {
      const logs = [{ routine_id: 'r1', occurrence_date: '2026-11-05', slot: '18:00', status, snoozed_to: null }];
      expect(computeReminders(base({ logs }), at(18, 40))).toEqual([]);
    }
    const snoozed = [{ routine_id: 'r1', occurrence_date: '2026-11-05', slot: '18:00', status: 'snoozed' as const, snoozed_to: '2026-11-06' }];
    expect(computeReminders(base({ logs: snoozed }), at(18, 40))).toEqual([]);
  });
  it('are not sent twice, and respect people who turned them off', () => {
    const first = computeReminders(base(), at(18, 35));
    const again = computeReminders(base({ alreadySent: new Set(first.map((r) => r.key)) }), at(18, 40));
    expect(again).toEqual([]);
    const off = base({ members: [{ household_id: 'h1', user_id: 'jamie', notify_late: false, notify_daily: null }] });
    expect(computeReminders(off, at(18, 40))).toEqual([]);
  });
  it('give up after a few hours', () => {
    expect(computeReminders(base(), at(21, 5))).toEqual([]);
  });
});

describe('morning summary', () => {
  it('lists today and tomorrow’s health tasks at the chosen time', () => {
    const input = base({
      routines: [
        routine({}),
        routine({ id: 'r2', title: 'Heartworm chewable', category: 'medication', kind: 'once', start_date: '2026-11-05', times: [] }),
        routine({ id: 'r3', title: 'Annual checkup', category: 'vet', kind: 'once', start_date: '2026-11-06', times: ['10:30'] }),
      ],
    });
    const out = computeReminders(input, at(7, 32)).filter((r) => r.key.startsWith('daily'));
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      userId: 'jamie',
      title: 'Today at The Parkers',
      body: '2 tasks for Biscuit. Due today: Heartworm chewable. Tomorrow: Annual checkup at 10:30 AM.',
    });
    expect(computeReminders(input, at(7, 50)).filter((r) => r.key.startsWith('daily'))).toEqual([]);
  });
});

const supply = (over: Partial<RSupply> = {}): RSupply => ({
  id: 's1',
  household_id: 'h1',
  name: 'Salmon kibble',
  pet_ids: ['p1'],
  // Runs out Nov 10; order by Nov 5.
  opened_on: '2026-10-13',
  lasts_days: 28,
  lead_days: 5,
  ordered_on: null,
  ...over,
});

describe('reorder reminders', () => {
  it('go out at 9 AM on the order-by day', () => {
    const input = base({ routines: [], supplies: [supply()] });
    expect(computeReminders(input, at(8, 55))).toEqual([]);
    const out = computeReminders(input, at(9, 2));
    expect(out.map((r) => r.userId)).toEqual(['jamie', 'priya']);
    expect(out[0].title).toBe('Time to order more Salmon kibble');
    expect(out[0].body).toBe('About 5 days left for Biscuit. Tap “I ordered it” in Herd so nobody orders twice.');
  });
  it('remind again on the last day, and not in between', () => {
    expect(computeReminders(base({ routines: [], supplies: [supply({ opened_on: '2026-10-11' })] }), at(9, 2))).toEqual([]);
    const last = computeReminders(base({ routines: [], supplies: [supply({ opened_on: '2026-10-09' })] }), at(9, 2));
    expect(last[0].title).toBe('Salmon kibble runs out tomorrow');
  });
  it('stop once someone orders, and respect people who turned them off', () => {
    expect(computeReminders(base({ routines: [], supplies: [supply({ ordered_on: '2026-11-04' })] }), at(9, 2))).toEqual([]);
    const members = [
      { household_id: 'h1', user_id: 'jamie', notify_late: true, notify_daily: null, notify_supplies: false },
      { household_id: 'h1', user_id: 'priya', notify_late: true, notify_daily: null },
    ];
    expect(computeReminders(base({ routines: [], members, supplies: [supply()] }), at(9, 2)).map((r) => r.userId)).toEqual(['priya']);
  });
  it('show up in the morning summary', () => {
    const out = computeReminders(base({ routines: [], supplies: [supply({ opened_on: '2026-10-11' })] }), at(7, 31));
    expect(out).toHaveLength(1);
    expect(out[0].body).toBe('Order soon: Salmon kibble.');
  });
});

describe('server rules match the app', () => {
  it('agree on when to order supplies', () => {
    for (const lasts of [7, 14, 30, 45]) {
      for (const lead of [0, 3, 5, 10]) {
        for (const ordered of [null, '2026-10-01', '2026-10-25']) {
          const s = supply({ lasts_days: lasts, lead_days: lead, opened_on: '2026-10-20', ordered_on: ordered });
          const app: Supply = { ...s, kind: 'food', restocks: [], order_url: null, notes: null, created_by: null, created_at: '' };
          for (let i = 0; i < 60; i++) {
            const d = addDays('2026-10-20', i);
            const st = supplyStatus(app, d);
            expect(supplyDates(s)).toEqual({ runOut: st.runOut, orderBy: st.orderBy });
            expect(serverNeedsOrder(s, d), `${lasts}/${lead}/${ordered} on ${d}`).toBe(needsOrder(app, d));
          }
        }
      }
    }
  });

  const kinds: Partial<RRoutine>[] = [
    { kind: 'daily', times: ['07:00', '18:00'] },
    { kind: 'daily', times: [] },
    { kind: 'weekly', weekdays: [1, 3, 5] },
    { kind: 'weekly', weekdays: [0, 6], times: [] },
    { kind: 'interval', interval_days: 3 },
    { kind: 'interval', interval_days: 30, start_date: '2026-10-20' },
    { kind: 'once', start_date: '2026-11-12' },
    { kind: 'daily', active: false },
  ];
  it('agree on which days every kind of routine is due', () => {
    for (const k of kinds) {
      const r = routine(k);
      for (let i = 0; i < 70; i++) {
        const d = addDays('2026-10-15', i);
        expect(occurrences(r, d), `${JSON.stringify(k)} on ${d}`).toEqual(occurrencesForDate(r as unknown as Routine, d));
      }
    }
  });

  it('agree on what is still open after skips and snoozes', () => {
    const routines = kinds.map((k, i) => routine({ ...k, id: `r${i}` }));
    const logs: TaskLog[] = [
      { id: 'a', household_id: 'h1', pet_id: 'p1', routine_id: 'r0', occurrence_date: '2026-11-05', slot: '07:00', title: 'x', note: null, status: 'done', snoozed_to: null, done_by: 'u', sitter_link_id: null, sitter_name: null, done_at: '' },
      { id: 'b', household_id: 'h1', pet_id: 'p1', routine_id: 'r0', occurrence_date: '2026-11-05', slot: '18:00', title: 'x', note: null, status: 'snoozed', snoozed_to: '2026-11-06', done_by: 'u', sitter_link_id: null, sitter_name: null, done_at: '' },
      { id: 'c', household_id: 'h1', pet_id: 'p1', routine_id: 'r1', occurrence_date: '2026-11-04', slot: 'any', title: 'x', note: null, status: 'snoozed', snoozed_to: '2026-11-05', done_by: 'u', sitter_link_id: null, sitter_name: null, done_at: '' },
      { id: 'd', household_id: 'h1', pet_id: 'p1', routine_id: 'r1', occurrence_date: '2026-11-05', slot: 'any', title: 'x', note: null, status: 'skipped', snoozed_to: null, done_by: 'u', sitter_link_id: null, sitter_name: null, done_at: '' },
    ];
    const pets = [{ id: 'p1', household_id: 'h1', name: 'Biscuit', species: 'dog' as const, emoji: '', notes: null, photo: null, created_at: '', ...EMPTY_PROFILE }];
    for (const d of ['2026-11-04', '2026-11-05', '2026-11-06']) {
      const app = buildDay({ pets, routines: routines as unknown as Routine[], logs }, d)
        .filter((i) => i.state === 'open')
        .map((i) => `${i.routine.id}|${i.origDate}|${i.slot}`)
        .sort();
      const server = openItems(routines, logs, d)
        .map((i) => `${i.routine.id}|${i.origDate}|${i.slot}`)
        .sort();
      expect(server, d).toEqual(app);
    }
  });
});
