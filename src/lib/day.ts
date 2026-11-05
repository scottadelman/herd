import { addDays, daysBetween, todayISO } from './dates';
import { ANY_TIME, isOverdue, occurrencesForDate, slotKey } from './schedule';
import type { Pet, Routine, TaskLog } from './types';

/**
 * One task on one day, after skips and snoozes are applied.
 *
 * - open:    still to do (including a task someone moved to this day)
 * - done / skipped: resolved
 * - moved:   was due this day but someone snoozed it to `movedTo`
 */
export type ItemState = 'open' | 'done' | 'skipped' | 'moved';

export interface DayItem {
  key: string;
  routine: Routine;
  pet: Pet;
  /** The day this item is shown on. */
  date: string;
  /** The day the routine originally scheduled it for (the log's key). */
  origDate: string;
  slot: string;
  log: TaskLog | undefined;
  state: ItemState;
  movedFrom?: string;
  movedTo?: string;
}

interface Source {
  pets: Pet[];
  routines: Routine[];
  logs: TaskLog[];
}

const slotSort = (s: string) => (s === ANY_TIME ? '99' : s);

export function indexLogs(logs: TaskLog[]): Map<string, TaskLog> {
  const map = new Map<string, TaskLog>();
  for (const l of logs) if (l.routine_id) map.set(slotKey(l.routine_id, l.occurrence_date, l.slot), l);
  return map;
}

function stateOf(log: TaskLog | undefined): ItemState {
  if (!log || log.status === 'snoozed') return 'open';
  return log.status;
}

/** Every task for `date`, sorted by time, with moved tasks in their new place. */
export function buildDay(src: Source, date: string, opts: { petId?: string; index?: Map<string, TaskLog> } = {}): DayItem[] {
  const index = opts.index ?? indexLogs(src.logs);
  const pets = new Map(src.pets.map((p) => [p.id, p]));
  const routines = new Map(src.routines.map((r) => [r.id, r]));
  const out: DayItem[] = [];

  for (const r of src.routines) {
    const pet = pets.get(r.pet_id);
    if (!pet || (opts.petId && pet.id !== opts.petId)) continue;
    for (const slot of occurrencesForDate(r, date)) {
      const key = slotKey(r.id, date, slot);
      const log = index.get(key);
      if (log?.snoozed_to && log.snoozed_to !== date) {
        out.push({ key, routine: r, pet, date, origDate: date, slot, log, state: 'moved', movedTo: log.snoozed_to });
      } else {
        out.push({ key, routine: r, pet, date, origDate: date, slot, log, state: stateOf(log) });
      }
    }
  }

  for (const log of src.logs) {
    if (log.snoozed_to !== date || log.occurrence_date === date || !log.routine_id) continue;
    const r = routines.get(log.routine_id);
    const pet = r && pets.get(r.pet_id);
    if (!r || !r.active || !pet || (opts.petId && pet.id !== opts.petId)) continue;
    out.push({
      key: slotKey(r.id, log.occurrence_date, log.slot),
      routine: r,
      pet,
      date,
      origDate: log.occurrence_date,
      slot: log.slot,
      log,
      state: stateOf(log),
      movedFrom: log.occurrence_date,
    });
  }

  return out.sort(
    (a, b) =>
      slotSort(a.slot).localeCompare(slotSort(b.slot)) ||
      a.pet.name.localeCompare(b.pet.name) ||
      a.routine.title.localeCompare(b.routine.title),
  );
}

export function isLate(item: DayItem, now: Date = new Date()): boolean {
  return item.state === 'open' && isOverdue(item.date, item.slot, now);
}

/** Where "snooze a day" sends a task shown on `date`: the next day, but never into the past. */
export function snoozeTarget(date: string, today: string = todayISO()): string {
  const next = addDays(date, 1);
  return daysBetween(today, next) < 0 ? today : next;
}

export function countsTowardProgress(item: DayItem): boolean {
  return item.state !== 'moved';
}

export function isResolved(item: DayItem): boolean {
  return item.state === 'done' || item.state === 'skipped';
}
