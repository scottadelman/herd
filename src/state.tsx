import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { addDays, todayISO } from './lib/dates';
import { firstName, memberById } from './lib/people';
import type { Backend, CompleteInput, Household, Member, Session, Snapshot, TaskLog } from './lib/types';
import { useToast } from './ui';

export const HISTORY_DAYS = 14;

export interface AppState {
  backend: Backend;
  session: Session;
  snapshot: Snapshot;
  me: Member;
  /** Ids of logs that just arrived from someone else, for the stamp animation. */
  freshLogIds: Set<string>;
  reload: () => Promise<void>;
  complete: (input: Omit<CompleteInput, 'householdId'>) => Promise<void>;
  undo: (log: TaskLog) => Promise<void>;
  /** Run a backend call, reload afterwards, and show any error as a toast. */
  run: <T>(fn: () => Promise<T>, success?: string) => Promise<T | undefined>;
  onLeftHousehold: () => void;
  exitDemo: () => void;
}

const Ctx = createContext<AppState | null>(null);
export const AppProvider = Ctx.Provider;
export function useApp(): AppState {
  const v = useContext(Ctx);
  if (!v) throw new Error('useApp outside provider');
  return v;
}

/** Loads a household, keeps it in sync, and exposes optimistic actions. */
export function useHouseholdData(backend: Backend, session: Session, household: Household) {
  const toast = useToast();
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [freshLogIds, setFresh] = useState<Set<string>>(new Set());
  const known = useRef<Set<string>>(new Set());
  const seenLogs = useRef<Set<string> | null>(null);
  const pending = useRef<number | undefined>(undefined);

  const reload = useCallback(async () => {
    try {
      const snap = await backend.loadSnapshot(household.id, addDays(todayISO(), -HISTORY_DAYS));
      // Announce check-offs made by other people since the last load.
      if (seenLogs.current) {
        const arrivals = snap.logs.filter((l) => !seenLogs.current!.has(l.id) && l.done_by !== session.userId);
        if (arrivals.length) {
          setFresh(new Set(arrivals.map((l) => l.id)));
          for (const l of arrivals.slice(0, 2)) {
            const who = memberById(snap.members, l.done_by);
            const pet = snap.pets.find((p) => p.id === l.pet_id);
            toast(`${firstName(who?.display_name ?? 'Someone')} checked off ${l.title.toLowerCase()} for ${pet?.name ?? 'a pet'}`);
          }
        }
      }
      seenLogs.current = new Set(snap.logs.map((l) => l.id));
      known.current = new Set([
        snap.household.id,
        ...snap.members.map((m) => m.user_id),
        ...snap.pets.map((p) => p.id),
        ...snap.routines.map((r) => r.id),
        ...snap.logs.map((l) => l.id),
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

  const complete = useCallback(
    async (input: Omit<CompleteInput, 'householdId'>) => {
      const temp: TaskLog = {
        id: `temp-${Date.now()}`,
        household_id: household.id,
        pet_id: input.petId,
        routine_id: input.routineId,
        occurrence_date: input.date,
        slot: input.slot,
        title: input.title,
        note: input.note ?? null,
        done_by: session.userId,
        done_at: new Date().toISOString(),
      };
      setSnapshot((s) => (s ? { ...s, logs: [temp, ...s.logs] } : s));
      try {
        const res = await backend.completeTask({ ...input, householdId: household.id });
        if (res.ok) {
          seenLogs.current?.add(res.log.id);
          known.current.add(res.log.id);
          setSnapshot((s) => (s ? { ...s, logs: s.logs.map((l) => (l.id === temp.id ? res.log : l)) } : s));
        } else {
          setSnapshot((s) => (s ? { ...s, logs: s.logs.filter((l) => l.id !== temp.id) } : s));
          const who = res.existing && snapshot ? memberById(snapshot.members, res.existing.done_by) : undefined;
          toast(who ? `${firstName(who.display_name)} already did this one.` : 'Someone already did this one.');
          reload();
        }
      } catch (e) {
        setSnapshot((s) => (s ? { ...s, logs: s.logs.filter((l) => l.id !== temp.id) } : s));
        toast(`Couldn’t save that. ${(e as Error).message}`, 'error');
      }
    },
    [backend, household.id, session.userId, snapshot, toast, reload],
  );

  const undo = useCallback(
    async (log: TaskLog) => {
      setSnapshot((s) => (s ? { ...s, logs: s.logs.filter((l) => l.id !== log.id) } : s));
      try {
        await backend.undoTask(log.id);
      } catch (e) {
        toast(`Couldn’t undo that. ${(e as Error).message}`, 'error');
        reload();
      }
    },
    [backend, toast, reload],
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

  return { snapshot, error, freshLogIds, reload, complete, undo, run };
}
