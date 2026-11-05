import type { Routine } from './types';
import { addDays, daysBetween, formatShortDate, formatTime, minutesOf, todayISO, weekdayOf, weekdayShort } from './dates';

export const ANY_TIME = 'any';

/** The time slots a routine is due on a given day ([] if not due). */
export function occurrencesForDate(r: Routine, date: string): string[] {
  if (!r.active) return [];
  if (daysBetween(r.start_date, date) < 0) return [];
  const slots = r.times.length ? [...r.times].sort() : [ANY_TIME];
  switch (r.kind) {
    case 'daily':
      return slots;
    case 'weekly':
      return r.weekdays.includes(weekdayOf(date)) ? slots : [];
    case 'interval': {
      const n = r.interval_days ?? 0;
      if (n < 1) return [];
      return daysBetween(r.start_date, date) % n === 0 ? slots : [];
    }
  }
}

/** Next day (from `from`, inclusive) the routine is due, or null. */
export function nextDueDate(r: Routine, from: string = todayISO()): string | null {
  for (let i = 0; i < 400; i++) {
    const d = addDays(from, i);
    if (occurrencesForDate(r, d).length) return d;
  }
  return null;
}

function joinWords(items: string[]): string {
  if (items.length <= 1) return items.join('');
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

export function describeSchedule(r: Routine, today: string = todayISO()): string {
  const at = r.times.length ? ` at ${joinWords([...r.times].sort().map(formatTime))}` : '';
  switch (r.kind) {
    case 'daily':
      return `Every day${at}`;
    case 'weekly': {
      const days = [...r.weekdays].sort((a, b) => a - b);
      if (days.length === 7) return `Every day${at}`;
      if (days.join() === '1,2,3,4,5') return `Weekdays${at}`;
      if (days.join() === '0,6') return `Weekends${at}`;
      return `${joinWords(days.map(weekdayShort))}${at}`;
    }
    case 'interval': {
      const n = r.interval_days ?? 1;
      const every = n === 1 ? 'Every day' : n === 7 ? 'Every week' : `Every ${n} days`;
      const next = nextDueDate(r, today);
      const when = next === null ? '' : next === today ? ', due today' : `, next ${formatShortDate(next)}`;
      return `${every}${at}${when}`;
    }
  }
}

export type Period = 'morning' | 'midday' | 'evening' | 'anytime';

export const PERIODS: { key: Period; label: string }[] = [
  { key: 'morning', label: 'Morning' },
  { key: 'midday', label: 'Midday' },
  { key: 'evening', label: 'Evening' },
  { key: 'anytime', label: 'Any time today' },
];

export function periodOf(slot: string): Period {
  if (slot === ANY_TIME) return 'anytime';
  const m = minutesOf(slot);
  if (m < 11 * 60) return 'morning';
  if (m < 16 * 60) return 'midday';
  return 'evening';
}

/** A task is overdue an hour after its time, or any time after its day ends. */
export function isOverdue(date: string, slot: string, now: Date = new Date()): boolean {
  const today = todayISO(now);
  const diff = daysBetween(today, date);
  if (diff < 0) return true;
  if (diff > 0 || slot === ANY_TIME) return false;
  return now.getHours() * 60 + now.getMinutes() > minutesOf(slot) + 60;
}

export function slotKey(routineId: string, date: string, slot: string): string {
  return `${routineId}|${date}|${slot}`;
}
