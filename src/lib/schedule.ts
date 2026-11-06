import type { Routine } from './types';
import { addDays, daysBetween, formatDayLabel, formatShortDate, formatTime, minutesOf, todayISO, weekdayOf, weekdayShort } from './dates';

const WEEKDAY_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const weekdayLong = (d: number) => WEEKDAY_LONG[d];

export const ANY_TIME = 'any';

const daysInMonth = (y: number, m1: number) => new Date(y, m1, 0).getDate();
const sundayOf = (iso: string) => addDays(iso, -weekdayOf(iso));

/** The time slots a routine is due on a given day ([] if not due). */
export function occurrencesForDate(r: Routine, date: string): string[] {
  if (!r.active) return [];
  if (daysBetween(r.start_date, date) < 0) return [];
  const slots = r.times.length ? [...r.times].sort() : [ANY_TIME];
  const every = Math.max(1, r.repeat_every ?? 1);
  switch (r.kind) {
    case 'daily':
      return slots;
    case 'weekly': {
      if (!r.weekdays.includes(weekdayOf(date))) return [];
      if (every === 1) return slots;
      const weeks = Math.round(daysBetween(sundayOf(r.start_date), sundayOf(date)) / 7);
      return weeks % every === 0 ? slots : [];
    }
    case 'monthly': {
      // Same day of the month as the start date, or the month's last day if it's shorter.
      const [sy, sm, sd] = r.start_date.split('-').map(Number);
      const [y, m, d] = date.split('-').map(Number);
      const months = (y - sy) * 12 + (m - sm);
      if (months < 0 || months % every !== 0) return [];
      return d === Math.min(sd, daysInMonth(y, m)) ? slots : [];
    }
    case 'interval': {
      const n = r.interval_days ?? 0;
      if (n < 1) return [];
      return daysBetween(r.start_date, date) % n === 0 ? slots : [];
    }
    case 'once':
      return date === r.start_date ? slots : [];
    default:
      return [];
  }
}

/** "1st", "2nd", "23rd", "31st" */
export function ordinal(n: number): string {
  const s = n % 100 >= 11 && n % 100 <= 13 ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[n % 10] ?? 'th';
  return `${n}${s}`;
}

/** Next day (from `from`, inclusive) the routine is due, or null. */
export function nextDueDate(r: Routine, from: string = todayISO()): string | null {
  if (r.kind === 'once') return daysBetween(from, r.start_date) >= 0 ? r.start_date : null;
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
  const every = Math.max(1, r.repeat_every ?? 1);
  const next = () => {
    const n = nextDueDate(r, today);
    return n === null ? '' : n === today ? ', due today' : `, next ${formatShortDate(n)}`;
  };
  switch (r.kind) {
    case 'daily':
      return `Every day${at}`;
    case 'weekly': {
      const days = [...r.weekdays].sort((a, b) => a - b);
      if (every > 1) return `Every ${every} weeks on ${joinWords(days.map(weekdayShort))}${at}${next()}`;
      if (days.length === 7) return `Every day${at}`;
      if (days.join() === '1,2,3,4,5') return `Weekdays${at}`;
      if (days.join() === '0,6') return `Weekends${at}`;
      if (days.length === 1) return `Every ${weekdayLong(days[0])}${at}`;
      return `${joinWords(days.map(weekdayShort))}${at}`;
    }
    case 'monthly': {
      const day = ordinal(Number(r.start_date.slice(8, 10)));
      return `${every === 1 ? 'Every month' : `Every ${every} months`} on the ${day}${at}${next()}`;
    }
    case 'interval': {
      const n = r.interval_days ?? 1;
      const every = n === 1 ? 'Every day' : n === 7 ? 'Every week' : `Every ${n} days`;
      const next = nextDueDate(r, today);
      const when = next === null ? '' : next === today ? ', due today' : `, next ${formatShortDate(next)}`;
      return `${every}${at}${when}`;
    }
    case 'once': {
      const diff = daysBetween(today, r.start_date);
      if (diff < -1) return `Was ${formatShortDate(r.start_date)}${at}`;
      const label = formatDayLabel(r.start_date, today);
      return `${diff >= -1 && diff <= 1 ? label : `On ${label}`}${at}`;
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
