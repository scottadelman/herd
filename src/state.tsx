import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { addDays, todayISO } from './lib/dates';
import { snoozeTarget, type DayItem } from './lib/day';
import { firstName, memberById } from './lib/people';
import type { Backend, Category, CompleteResult, Household, LogPatch, Member, Session, Snapshot, TaskLog } from './lib/types';
import { useToast } from './ui';

export const HISTORY_DAYS = 14;

/** What the Add button can start with. */
export type AddPreset =
  | { kind: 'menu'; date?: string; petId?: string }
  | { kind: 'event'; date?: string; petId?: string }
  | { kind: 'routine'; petId?: string; category?: Category }
  | { kind: 'log'; date?: string; petId?: string }
  | { kind: 'supply'; petId?: string }
  | { kind: 'pet' };

export interface AppState {
  backend: Backend;
  session: Session;
  snapshot: Snapshot;
  /** Every check-off loaded so far: the recent ones plus any older history. */
  logs: TaskLog[];
  /** The earliest day whose check-offs are loaded. */
  historyFrom: string;
  historyLoading: boolean;
  /** Load check-offs back to this day (the calendar and history call this). */
  loadHistory: (from: string) => void;
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
  logAdhoc: (petId: string, title: string, note: string | null, date?: string) => Promise<void>;
  /** Run a backend call, reload afterwards, and show any error as a toast. */
  run: <T>(fn: () => Promise<T>, success?: string) => Promise<T | undefined>;
  onLeftHousehold: () => void;
  exitDemo: () => void;
  /** The day Today and Calendar are looking at. */
  date: string;
  setDate: (d: string) => void;
  goToDay: (d: string) => void;
  openSitterPreview: (token: string) => void;
  /** Open a pet's full profile on the Pets tab. */
  viewPet: (petId: string) => void;
  openAdd: (preset?: AddPreset) => void;
  openMap: () => void;
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
  // Older check-offs, loaded when someone looks further back than HISTORY_DAYS.
  const [older, setOlder] = useState<{ from: string; logs: TaskLog[] } | null>(null);
  const olderRef = useRef(older);
  olderRef.current = older;
  const [historyLoading, setHistoryLoading] = useState(false);
  const historyQueue = useRef<Promise<void>>(Promise.resolve());

  const reload = useCallback(async () => {
    try {
      const since = addDays(todayISO(), -HISTORY_DAYS);
      const snap = await backend.loadSnapshot(household.id, since);
      const old = olderRef.current;
      if (old && old.from < since) {
        const logs = await backend.loadLogs(household.id, old.from, addDays(since, -1));
        setOlder({ from: old.from, logs });
        for (const l of logs) known.current.add(l.id);
      }
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
        ...snap.supplies.map((s) => s.id),
        ...snap.places.map((p) => p.id),
        ...(olderRef.current?.logs ?? []).map((l) => l.id),
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
  /** For edits and undos, which can touch older history too. */
  const patchAll = (fn: (logs: TaskLog[]) => TaskLog[]) => {
    patchLogs(fn);
    setOlder((o) => (o ? { ...o, logs: fn(o.logs) } : o));
  };

  const loadHistory = useCallback(
    (from: string) => {
      historyQueue.current = historyQueue.current.then(async () => {
        const since = addDays(todayISO(), -HISTORY_DAYS);
        const have = olderRef.current?.from ?? since;
        if (from >= have) return;
        setHistoryLoading(true);
        try {
          const logs = await backend.loadLogs(household.id, from, addDays(have, -1));
          for (const l of logs) known.current.add(l.id);
          const next = { from, logs: [...(olderRef.current?.logs ?? []), ...logs] };
          olderRef.current = next;
          setOlder(next);
        } catch (e) {
          toast(`Couldn’t load older history. ${(e as Error).message}`, 'error');
        } finally {
          setHistoryLoading(false);
        }
      });
    },
    [backend, household.id, toast],
  );

  const logs = useMemo(() => {
    if (!snapshot) return [];
    if (!older?.logs.length) return snapshot.logs;
    const since = addDays(todayISO(), -HISTORY_DAYS);
    const ids = new Set(snapshot.logs.map((l) => l.id));
    // Recent days always come from the snapshot, so deletes there stick.
    const extra = older.logs.filter((l) => !ids.has(l.id) && l.occurrence_date < since && (!l.snoozed_to || l.snoozed_to < since));
    return [...snapshot.logs, ...extra];
  }, [snapshot, older]);
  const historyFrom = older?.from ?? addDays(todayISO(), -HISTORY_DAYS);

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
            patchAll((logs) => logs.map((l) => (l.id === log.id ? { ...l, snoozed_to: snoozedTo, done_by: session.userId } : l)));
            await backend.updateLog(log.id, { snoozed_to: snoozedTo, done_by: session.userId, done_at: new Date().toISOString() });
            return;
          }
          patchAll((logs) =>
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
          patchAll((logs) => logs.map((l) => (l.id === log.id ? { ...l, ...patch } : l)));
          await backend.updateLog(log.id, patch);
        } else {
          patchAll((logs) => logs.filter((l) => l.id !== log.id));
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
      patchAll((logs) => logs.map((l) => (l.id === log.id ? { ...l, ...patch } : l)));
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
    async (petId: string, title: string, note: string | null, date?: string) => {
      const today = todayISO();
      const day = date && date < today ? date : today;
      // Something logged for an earlier day is stamped at noon that day.
      const doneAt = day === today ? undefined : (() => {
        const [y, m, d] = day.split('-').map(Number);
        return new Date(y, m - 1, d, 12, 0).toISOString();
      })();
      try {
        const res = await backend.completeTask({
          householdId: household.id,
          petId,
          routineId: null,
          date: day,
          slot: 'adhoc',
          title,
          note,
          doneAt,
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

  return {
    snapshot,
    logs,
    historyFrom,
    historyLoading,
    loadHistory,
    error,
    freshLogIds,
    reload,
    checkOff,
    skip,
    snooze,
    undo,
    editLog,
    logAdhoc,
    run,
  };
}
