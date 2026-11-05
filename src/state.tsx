import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { addDays, todayISO } from './lib/dates';
import { snoozeTarget, type DayItem } from './lib/day';
import { firstName, memberById } from './lib/people';
import type { Backend, CompleteResult, Household, LogPatch, Member, Session, Snapshot, TaskLog } from './lib/types';
import { useToast } from './ui';

export const HISTORY_DAYS = 14;

export interface AppState {
  backend: Backend;
  session: Session;
  snapshot: Snapshot;
  me: Member;
  households: Household[];
  switchHousehold: (id: string) => void;
  addHousehold: () => void;
  /** Ids of logs that just arrived from someone else, for the stamp animation. */
  freshLogIds: Set<string>;
  reload: () => Promise<void>;
  checkOff: (item: DayItem, note?: string | null) => Promise<void>;
  skip: (item: DayItem) => Promise<void>;
  snooze: (item: DayItem) => Promise<void>;
  undo: (log: TaskLog) => Promise<void>;
  editLog: (log: TaskLog, patch: LogPatch) => Promise<void>;
  logAdhoc: (petId: string, title: string, note: string | null) => Promise<void>;
  /** Run a backend call, reload afterwards, and show any error as a toast. */
  run: <T>(fn: () => Promise<T>, success?: string) => Promise<T | undefined>;
  onLeftHousehold: () => void;
  exitDemo: () => void;
  /** The day Today and Calendar are looking at. */
  date: string;
  setDate: (d: string) => void;
  goToDay: (d: string) => void;
  openSitterPreview: (token: string) => void;
}

const Ctx = createContext<AppState | null>(null);
export const AppProvider = Ctx.Provider;
export function useApp(): AppState {
  const v = useContext(Ctx);
  if (!v) throw new Error('useApp outside provider');
  return v;
}

/** Who did a log, in words: "Priya", "you", or "Maria (sitter)". */
export function whoDid(log: TaskLog, members: Member[], me: string, capitalize = false): string {
  if (log.done_by === me) return capitalize ? 'You' : 'you';
  if (!log.done_by && log.sitter_name) return `${log.sitter_name} (sitter)`;
  return firstName(memberById(members, log.done_by)?.display_name ?? 'Someone');
}

/** Loads a household, keeps it in sync, and exposes optimistic actions. */
export function useHouseholdData(backend: Backend, session: Session, household: Household) {
  const toast = useToast();
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [freshLogIds, setFresh] = useState<Set<string>>(new Set());
  const known = useRef<Set<string>>(new Set());
  const seenDone = useRef<Map<string, string> | null>(null);
  const pending = useRef<number | undefined>(undefined);
  const snapRef = useRef<Snapshot | null>(null);
  snapRef.current = snapshot;

  const reload = useCallback(async () => {
    try {
      const snap = await backend.loadSnapshot(household.id, addDays(todayISO(), -HISTORY_DAYS));
      // Announce check-offs made by other people (or a sitter) since the last load.
      const doneNow = new Map(snap.logs.filter((l) => l.status === 'done').map((l) => [l.id, l.done_at]));
      if (seenDone.current) {
        const arrivals = snap.logs.filter(
          (l) => l.status === 'done' && seenDone.current!.get(l.id) !== l.done_at && l.done_by !== session.userId,
        );
        if (arrivals.length) {
          setFresh(new Set(arrivals.map((l) => l.id)));
          for (const l of arrivals.slice(0, 2)) {
            const pet = snap.pets.find((p) => p.id === l.pet_id);
            toast(`${whoDid(l, snap.members, session.userId, true)} checked off ${l.title.toLowerCase()} for ${pet?.name ?? 'a pet'}`);
          }
        }
      }
      seenDone.current = doneNow;
      known.current = new Set([
        snap.household.id,
        ...snap.members.map((m) => m.user_id),
        ...snap.pets.map((p) => p.id),
        ...snap.routines.map((r) => r.id),
        ...snap.logs.map((l) => l.id),
        ...snap.weights.map((w) => w.id),
        ...snap.sitterLinks.map((s) => s.id),
      ]);
      setSnapshot(snap);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [backend, household.id, session.userId, toast]);

  useEffect(() => {
    reload();
    const unsub = backend.subscribe(household.id, (e) => {
      if (e.type === 'DELETE' && e.id && !known.current.has(e.id)) return;
      window.clearTimeout(pending.current);
      pending.current = window.setTimeout(reload, 250);
    });
    // Phones pause web apps in the background, so catch up when we're back.
    const onVisible = () => document.visibilityState === 'visible' && reload();
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('online', reload);
    return () => {
      unsub();
      window.clearTimeout(pending.current);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('online', reload);
    };
  }, [backend, household.id, reload]);

  // Record the household's time zone so reminders fire at the right local time.
  useEffect(() => {
    if (!snapshot || snapshot.household.timezone) return;
    const me = snapshot.members.find((m) => m.user_id === session.userId);
    if (me?.role !== 'owner') return;
    try {
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
      if (tz) backend.setHouseholdTimezone(household.id, tz).catch(() => {});
    } catch {
      /* ignore */
    }
  }, [snapshot, backend, household.id, session.userId]);

  const patchLogs = (fn: (logs: TaskLog[]) => TaskLog[]) => setSnapshot((s) => (s ? { ...s, logs: fn(s.logs) } : s));

  const tempLog = (item: DayItem, extra: Partial<TaskLog>): TaskLog => ({
    id: `temp-${Date.now()}`,
    household_id: household.id,
    pet_id: item.pet.id,
    routine_id: item.routine.id,
    occurrence_date: item.origDate,
    slot: item.slot,
    title: item.routine.title,
    note: null,
    status: 'done',
    snoozed_to: null,
    done_by: session.userId,
    sitter_link_id: null,
    sitter_name: null,
    done_at: new Date().toISOString(),
    ...extra,
  });

  const settle = useCallback(
    (res: CompleteResult, tempId: string | null) => {
      if (res.ok) {
        seenDone.current?.set(res.log.id, res.log.done_at);
        known.current.add(res.log.id);
        patchLogs((logs) => [res.log, ...logs.filter((l) => l.id !== tempId && l.id !== res.log.id)]);
        return;
      }
      if (tempId) patchLogs((logs) => logs.filter((l) => l.id !== tempId));
      const snap = snapRef.current;
      const who = res.existing && snap ? whoDid(res.existing, snap.members, session.userId, true) : 'Someone';
      toast(`${who} already took care of this one.`);
      reload();
    },
    [session.userId, toast, reload],
  );

  const resolve = useCallback(
    async (item: DayItem, status: 'done' | 'skipped' | 'snoozed', note?: string | null) => {
      const snoozedTo = status === 'snoozed' ? snoozeTarget(item.date) : null;
      try {
        if (item.log && item.log.status === 'snoozed') {
          // A task someone moved here: finish it, or push it along another day.
          const log = item.log;
          if (status === 'snoozed') {
            patchLogs((logs) => logs.map((l) => (l.id === log.id ? { ...l, snoozed_to: snoozedTo, done_by: session.userId } : l)));
            await backend.updateLog(log.id, { snoozed_to: snoozedTo, done_by: session.userId, done_at: new Date().toISOString() });
            return;
          }
          patchLogs((logs) =>
            logs.map((l) => (l.id === log.id ? { ...l, status, note: note ?? null, done_by: session.userId, done_at: new Date().toISOString() } : l)),
          );
          settle(await backend.finishMoved(log.id, status, note), null);
          return;
        }
        const temp = tempLog(item, { status, snoozed_to: snoozedTo, note: note ?? null });
        patchLogs((logs) => [temp, ...logs]);
        const res = await backend.completeTask({
          householdId: household.id,
          petId: item.pet.id,
          routineId: item.routine.id,
          date: item.origDate,
          slot: item.slot,
          title: item.routine.title,
          note: note ?? null,
          status,
          snoozedTo,
        });
        settle(res, temp.id);
      } catch (e) {
        toast(`Couldn’t save that. ${(e as Error).message}`, 'error');
        reload();
      }
    },
    [backend, household.id, session.userId, settle, toast, reload], // eslint-disable-line react-hooks/exhaustive-deps
  );

  const checkOff = useCallback((item: DayItem, note?: string | null) => resolve(item, 'done', note), [resolve]);
  const skip = useCallback((item: DayItem) => resolve(item, 'skipped'), [resolve]);
  const snooze = useCallback(async (item: DayItem) => resolve(item, 'snoozed'), [resolve]);

  const undo = useCallback(
    async (log: TaskLog) => {
      try {
        if (log.snoozed_to && log.status !== 'snoozed') {
          // Finished a moved task: put it back on the day it was moved to.
          const patch: LogPatch = {
            status: 'snoozed',
            done_by: session.userId,
            done_at: new Date().toISOString(),
            note: null,
            sitter_link_id: null,
            sitter_name: null,
          };
          patchLogs((logs) => logs.map((l) => (l.id === log.id ? { ...l, ...patch } : l)));
          await backend.updateLog(log.id, patch);
        } else {
          patchLogs((logs) => logs.filter((l) => l.id !== log.id));
          await backend.undoTask(log.id);
        }
      } catch (e) {
        toast(`Couldn’t undo that. ${(e as Error).message}`, 'error');
        reload();
      }
    },
    [backend, session.userId, toast, reload],
  );

  const editLog = useCallback(
    async (log: TaskLog, patch: LogPatch) => {
      patchLogs((logs) => logs.map((l) => (l.id === log.id ? { ...l, ...patch } : l)));
      try {
        await backend.updateLog(log.id, patch);
        if (patch.done_at) seenDone.current?.set(log.id, patch.done_at);
      } catch (e) {
        toast((e as Error).message, 'error');
        reload();
      }
    },
    [backend, toast, reload],
  );

  const logAdhoc = useCallback(
    async (petId: string, title: string, note: string | null) => {
      try {
        const res = await backend.completeTask({
          householdId: household.id,
          petId,
          routineId: null,
          date: todayISO(),
          slot: 'adhoc',
          title,
          note,
        });
        settle(res, null);
      } catch (e) {
        toast(`Couldn’t save that. ${(e as Error).message}`, 'error');
      }
    },
    [backend, household.id, settle, toast],
  );

  const run = useCallback(
    async <T,>(fn: () => Promise<T>, success?: string): Promise<T | undefined> => {
      try {
        const out = await fn();
        if (success) toast(success);
        await reload();
        return out;
      } catch (e) {
        toast((e as Error).message, 'error');
        return undefined;
      }
    },
    [toast, reload],
  );

  return { snapshot, error, freshLogIds, reload, checkOff, skip, snooze, undo, editLog, logAdhoc, run };
}
