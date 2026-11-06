import { describe, expect, it } from 'vitest';
import { addDays, daysBetween, formatDayLabel, formatTime } from './dates';
import { describeSchedule, isOverdue, nextDueDate, occurrencesForDate, periodOf } from './schedule';
import type { Routine } from './types';

const base: Routine = {
  id: 'r1',
  household_id: 'h1',
  pet_id: 'p1',
  title: 'Breakfast',
  kind: 'daily',
  category: 'care',
  dose: null,
  times: ['07:00'],
  weekdays: [],
  interval_days: null,
  repeat_every: 1,
  start_date: '2026-11-01',
  assignee: null,
  notes: null,
  active: true,
  created_at: '2026-11-01T00:00:00Z',
};

describe('dates', () => {
  it('counts days across a daylight saving change', () => {
    expect(daysBetween('2026-10-31', '2026-11-02')).toBe(2);
    expect(daysBetween('2026-03-07', '2026-03-09')).toBe(2);
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
  });
  it('formats times and day labels', () => {
    expect(formatTime('00:05')).toBe('12:05 AM');
    expect(formatTime('12:30')).toBe('12:30 PM');
    expect(formatTime('18:00')).toBe('6:00 PM');
    expect(formatDayLabel('2026-11-03', '2026-11-04')).toBe('Yesterday');
    expect(formatDayLabel('2026-11-01', '2026-11-04')).toBe('Sun, Nov 1');
  });
});

describe('occurrencesForDate', () => {
  it('daily routines repeat every day with sorted times', () => {
    const r = { ...base, times: ['18:00', '07:00'] };
    expect(occurrencesForDate(r, '2026-11-04')).toEqual(['07:00', '18:00']);
  });
  it('untimed routines get a single any-time slot', () => {
    expect(occurrencesForDate({ ...base, times: [] }, '2026-11-04')).toEqual(['any']);
  });
  it('nothing before the start date or when paused', () => {
    expect(occurrencesForDate(base, '2026-10-31')).toEqual([]);
    expect(occurrencesForDate({ ...base, active: false }, '2026-11-04')).toEqual([]);
  });
  it('weekly routines only on chosen days', () => {
    const r: Routine = { ...base, kind: 'weekly', weekdays: [1, 3, 5] }; // Mon Wed Fri
    expect(occurrencesForDate(r, '2026-11-02')).toEqual(['07:00']); // Monday
    expect(occurrencesForDate(r, '2026-11-03')).toEqual([]); // Tuesday
  });
  it('interval routines count from the start date', () => {
    const r: Routine = { ...base, kind: 'interval', interval_days: 30, times: [] };
    expect(occurrencesForDate(r, '2026-11-01')).toEqual(['any']);
    expect(occurrencesForDate(r, '2026-11-15')).toEqual([]);
    expect(occurrencesForDate(r, '2026-12-01')).toEqual(['any']);
    expect(nextDueDate(r, '2026-11-04')).toBe('2026-12-01');
  });
});

describe('describeSchedule', () => {
  it('reads like a person would say it', () => {
    expect(describeSchedule({ ...base, times: ['07:00', '18:00'] })).toBe('Every day at 7:00 AM and 6:00 PM');
    expect(describeSchedule({ ...base, kind: 'weekly', weekdays: [5, 1, 2, 3, 4] })).toBe('Weekdays at 7:00 AM');
    expect(describeSchedule({ ...base, kind: 'weekly', weekdays: [1, 4] })).toBe('Mon and Thu at 7:00 AM');
    expect(
      describeSchedule({ ...base, kind: 'interval', interval_days: 7, times: [] }, '2026-11-04'),
    ).toBe('Every week, next Nov 8');
    expect(
      describeSchedule({ ...base, kind: 'interval', interval_days: 3, times: [] }, '2026-11-04'),
    ).toBe('Every 3 days, due today');
  });
});

describe('periods and overdue', () => {
  it('groups slots into parts of the day', () => {
    expect(periodOf('07:00')).toBe('morning');
    expect(periodOf('12:30')).toBe('midday');
    expect(periodOf('18:00')).toBe('evening');
    expect(periodOf('any')).toBe('anytime');
  });
  it('flags tasks an hour past their time', () => {
    const now = new Date(2026, 10, 4, 8, 30);
    expect(isOverdue('2026-11-04', '07:00', now)).toBe(true);
    expect(isOverdue('2026-11-04', '08:00', now)).toBe(false);
    expect(isOverdue('2026-11-04', 'any', now)).toBe(false);
    expect(isOverdue('2026-11-03', 'any', now)).toBe(true);
    expect(isOverdue('2026-11-05', '07:00', now)).toBe(false);
  });
});

describe('monthly and every-few schedules', () => {
  it('every month lands on the same day, or the last day of a short month', () => {
    const r: Routine = { ...base, kind: 'monthly', start_date: '2026-01-31', times: [] };
    expect(occurrencesForDate(r, '2026-01-31')).toEqual(['any']);
    expect(occurrencesForDate(r, '2026-02-28')).toEqual(['any']);
    expect(occurrencesForDate(r, '2026-02-27')).toEqual([]);
    expect(occurrencesForDate(r, '2026-04-30')).toEqual(['any']);
    expect(occurrencesForDate(r, '2026-05-31')).toEqual(['any']);
    expect(occurrencesForDate(r, '2025-12-31')).toEqual([]);
  });
  it('every 3 months skips the months in between', () => {
    const r: Routine = { ...base, kind: 'monthly', repeat_every: 3, start_date: '2026-11-15', times: ['08:00'] };
    expect(occurrencesForDate(r, '2026-11-15')).toEqual(['08:00']);
    expect(occurrencesForDate(r, '2026-12-15')).toEqual([]);
    expect(occurrencesForDate(r, '2027-02-15')).toEqual(['08:00']);
    expect(nextDueDate(r, '2026-11-16')).toBe('2027-02-15');
    expect(describeSchedule(r, '2026-11-16')).toBe('Every 3 months on the 15th at 8:00 AM, next Feb 15');
  });
  it('every 2 weeks on Monday', () => {
    // Nov 2, 2026 is a Monday
    const r: Routine = { ...base, kind: 'weekly', weekdays: [1], repeat_every: 2, start_date: '2026-11-02', times: [] };
    expect(occurrencesForDate(r, '2026-11-02')).toEqual(['any']);
    expect(occurrencesForDate(r, '2026-11-09')).toEqual([]);
    expect(occurrencesForDate(r, '2026-11-16')).toEqual(['any']);
    expect(describeSchedule(r, '2026-11-03')).toBe('Every 2 weeks on Mon, next Nov 16');
  });
  it('describes simple weekly and monthly schedules', () => {
    expect(describeSchedule({ ...base, kind: 'weekly', weekdays: [6] }, '2026-11-03')).toBe('Every Saturday at 7:00 AM');
    expect(describeSchedule({ ...base, kind: 'monthly', start_date: '2026-11-01', times: [] }, '2026-11-03')).toBe(
      'Every month on the 1st, next Dec 1',
    );
  });
});
