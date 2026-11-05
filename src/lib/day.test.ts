import { describe, expect, it } from 'vitest';
import { buildDay, snoozeTarget } from './day';
import { describeSchedule, occurrencesForDate } from './schedule';
import type { Pet, Routine, TaskLog } from './types';

const pet: Pet = {
  id: 'p1',
  household_id: 'h',
  name: 'Biscuit',
  species: 'dog',
  emoji: '🐕',
  notes: null,
  photo: null,
  created_at: '',
};
const routine = (over: Partial<Routine>): Routine => ({
  id: 'r1',
  household_id: 'h',
  pet_id: 'p1',
  title: 'Walk',
  kind: 'daily',
  category: 'care',
  dose: null,
  times: ['18:00'],
  weekdays: [],
  interval_days: null,
  start_date: '2026-11-01',
  assignee: null,
  notes: null,
  active: true,
  created_at: '',
  ...over,
});
const log = (over: Partial<TaskLog>): TaskLog => ({
  id: 'l1',
  household_id: 'h',
  pet_id: 'p1',
  routine_id: 'r1',
  occurrence_date: '2026-11-05',
  slot: '18:00',
  title: 'Walk',
  note: null,
  status: 'done',
  snoozed_to: null,
  done_by: 'u1',
  sitter_link_id: null,
  sitter_name: null,
  done_at: '2026-11-05T23:00:00Z',
  ...over,
});

describe('one-time tasks', () => {
  const vet = routine({ kind: 'once', start_date: '2026-11-10', times: ['10:30'], category: 'vet' });
  it('only appear on their date', () => {
    expect(occurrencesForDate(vet, '2026-11-10')).toEqual(['10:30']);
    expect(occurrencesForDate(vet, '2026-11-11')).toEqual([]);
  });
  it('describe themselves by date', () => {
    expect(describeSchedule(vet, '2026-11-05')).toBe('On Tue, Nov 10 at 10:30 AM');
    expect(describeSchedule(vet, '2026-11-09')).toBe('Tomorrow at 10:30 AM');
    expect(describeSchedule(vet, '2026-11-20')).toBe('Was Nov 10 at 10:30 AM');
  });
});

describe('buildDay', () => {
  const src = (logs: TaskLog[], routines = [routine({})]) => ({ pets: [pet], routines, logs });

  it('marks done and skipped tasks', () => {
    expect(buildDay(src([log({})]), '2026-11-05')[0].state).toBe('done');
    expect(buildDay(src([log({ status: 'skipped' })]), '2026-11-05')[0].state).toBe('skipped');
    expect(buildDay(src([]), '2026-11-05')[0].state).toBe('open');
  });

  it('shows a snoozed task as moved on its own day and open on the new day', () => {
    const snoozed = log({ status: 'snoozed', snoozed_to: '2026-11-06' });
    const thu = buildDay(src([snoozed]), '2026-11-05');
    expect(thu).toHaveLength(1);
    expect(thu[0]).toMatchObject({ state: 'moved', movedTo: '2026-11-06' });

    const fri = buildDay(src([snoozed]), '2026-11-06');
    // Friday has its own walk plus the one moved from Thursday.
    expect(fri.map((i) => [i.state, i.movedFrom ?? null, i.origDate])).toEqual([
      ['open', null, '2026-11-06'],
      ['open', '2026-11-05', '2026-11-05'],
    ]);
  });

  it('a moved task that gets finished shows as done on the new day', () => {
    const finished = log({ status: 'done', snoozed_to: '2026-11-06' });
    const fri = buildDay(src([finished]), '2026-11-06');
    expect(fri.find((i) => i.movedFrom)?.state).toBe('done');
    expect(buildDay(src([finished]), '2026-11-05')[0].state).toBe('moved');
  });

  it('filters by pet', () => {
    expect(buildDay(src([]), '2026-11-05', { petId: 'other' })).toEqual([]);
  });
});

describe('snoozeTarget', () => {
  it('moves to the next day, or to today for older missed tasks', () => {
    expect(snoozeTarget('2026-11-05', '2026-11-05')).toBe('2026-11-06');
    expect(snoozeTarget('2026-11-04', '2026-11-05')).toBe('2026-11-05');
    expect(snoozeTarget('2026-11-01', '2026-11-05')).toBe('2026-11-05');
    expect(snoozeTarget('2026-11-08', '2026-11-05')).toBe('2026-11-09');
  });
});
