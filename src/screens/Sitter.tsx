import { useCallback, useEffect, useMemo, useState } from 'react';
import { formatClock, formatDayLabel, formatTime, toISODate, dayPhrase } from '../lib/dates';
import { buildDay, isLate, isResolved, type DayItem } from '../lib/day';
import { firstName } from '../lib/people';
import { PERIODS, periodOf, ANY_TIME } from '../lib/schedule';
import type { Backend, SitterSnapshot, TaskLog } from '../lib/types';
import { PetDropdown } from '../parts/PetInfo';
import { CategoryMark, Icons, PetAvatar, Spinner, Stamp, useToast } from '../ui';
import { WalkMap } from './WalkMap';

const SITTER_GREY = '#7B8794';
const REFRESH_MS = 30_000;

const isIOS = () => /iPhone|iPad|iPod/.test(navigator.userAgent);
const isStandalone = () =>
  window.matchMedia?.('(display-mode: standalone)').matches || (navigator as unknown as { standalone?: boolean }).standalone === true;

/**
 * What someone with a sitter link sees: today's tasks for the pets on the
 * link, the pet notes, and a check button. Nothing else from the household.
 */
export function SitterView({ backend, token, preview = false }: { backend: Backend; token: string; preview?: boolean }) {
  const toast = useToast();
  const [snap, setSnap] = useState<SitterSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mapOpen, setMapOpen] = useState(false);

  const load = useCallback(async () => {
    try {
      setSnap(await backend.sitterView(token));
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [backend, token]);

  useEffect(() => {
    load();
    const t = window.setInterval(load, REFRESH_MS);
    const onVisible = () => document.visibilityState === 'visible' && load();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.clearInterval(t);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [load]);

  const items = useMemo(
    () => (snap ? buildDay({ pets: snap.pets, routines: snap.routines, logs: snap.logs }, snap.today).filter((i) => i.state !== 'moved') : []),
    [snap],
  );

  if (error && !snap) {
    return (
      <div className="sitter">
        <div className="sitter-ended">
          <h1 className="wordmark wordmark-sm">Herd</h1>
          <p>{error}</p>
        </div>
      </div>
    );
  }
  if (!snap) {
    return (
      <div className="full-center">
        <Spinner />
      </div>
    );
  }

  const done = items.filter(isResolved).length;
  const name = (log: TaskLog) => {
    if (!log.done_by) return log.sitter_name === snap.link.label ? 'you' : `${log.sitter_name ?? 'a sitter'}`;
    return firstName(snap.members.find((m) => m.user_id === log.done_by)?.display_name ?? 'someone');
  };
  const colorOf = (log: TaskLog) => (log.done_by ? snap.members.find((m) => m.user_id === log.done_by)?.color ?? SITTER_GREY : SITTER_GREY);

  async function check(item: DayItem) {
    if (preview) {
      toast('This is a preview. The sitter checks things off from their link.');
      return;
    }
    const temp: TaskLog = {
      id: `temp-${Date.now()}`,
      household_id: snap!.household.id,
      pet_id: item.pet.id,
      routine_id: item.routine.id,
      occurrence_date: item.origDate,
      slot: item.slot,
      title: item.routine.title,
      note: null,
      status: 'done',
      snoozed_to: item.log?.snoozed_to ?? null,
      done_by: null,
      sitter_link_id: snap!.link.id,
      sitter_name: snap!.link.label,
      done_at: new Date().toISOString(),
    };
    setSnap((s) => (s ? { ...s, logs: [temp, ...s.logs.filter((l) => l.id !== item.log?.id)] } : s));
    try {
      const res = await backend.sitterComplete(token, item.routine.id, item.origDate, item.slot);
      if (!res.ok) toast(`${res.existing ? name(res.existing).replace(/^./, (c) => c.toUpperCase()) : 'Someone'} already did this one.`);
    } catch (e) {
      toast((e as Error).message, 'error');
    }
    load();
  }

  async function undo(log: TaskLog) {
    if (preview) return;
    try {
      await backend.sitterUndo(token, log.id);
    } catch (e) {
      toast((e as Error).message, 'error');
    }
    load();
  }

  const groups = PERIODS.map((p) => ({ ...p, items: items.filter((i) => periodOf(i.slot) === p.key) })).filter((g) => g.items.length);
  const ends = toISODate(new Date(snap.link.expires_at));

  return (
    <div className="sitter">
      <header className="sitter-head">
        <p className="sitter-house">{snap.household.name}</p>
        <h1 className="screen-title">Hi {snap.link.label}</h1>
        <p className="muted">
          {formatDayLabel(snap.today, snap.today) === 'Today' ? 'Today’s pet care' : formatDayLabel(snap.today)}.{' '}
          {items.length ? (done === items.length ? 'Everything’s done.' : `${done} of ${items.length} done.`) : ''}
        </p>
      </header>

      <section className="group">
        <h2 className="group-label">{snap.pets.length === 1 ? 'The pet' : 'The pets'}</h2>
        <div className="list">
          {snap.pets.map((p) => (
            <PetDropdown key={p.id} pet={p} routines={snap.routines} defaultOpen={snap.pets.length === 1} />
          ))}
        </div>
        <p className="footnote">Tap the arrow for feeding, allergies, likes and dislikes, and the vet.</p>
      </section>

      {(snap.places ?? []).length > 0 && (
        <section className="group">
          <ul className="list">
            <li>
              <button className="row row-button" onClick={() => setMapOpen(true)}>
                <span className="add-mark">{Icons.map}</span>
                <span className="row-text">
                  <span className="row-title">Walk map</span>
                  <span className="row-meta">Usual routes, parks and poop bag spots</span>
                </span>
                <span className="chev" aria-hidden="true">
                  {Icons.next}
                </span>
              </button>
            </li>
          </ul>
        </section>
      )}

      {items.length === 0 ? (
        <div className="empty">
          <p>Nothing on the list for today.</p>
        </div>
      ) : (
        groups.map((g) => (
          <section key={g.key} className="group">
            <h2 className="group-label">{g.label}</h2>
            <ul className="list">
              {g.items.map((item) => {
                const label = `${item.routine.title} for ${item.pet.name}`;
                const log = item.log && item.state !== 'open' ? item.log : undefined;
                const mineToUndo = !!log && log.sitter_link_id === snap.link.id && !preview;
                return (
                  <li key={item.key} className={`row row-task${log ? ' row-done' : ''}`}>
                    <span className="row-main">
                      <PetAvatar emoji={item.pet.emoji} photo={item.pet.photo} />
                      <span className="row-text">
                        <span className="row-title">
                          <CategoryMark category={item.routine.category} />
                          {item.routine.title}
                        </span>
                        <span className="row-meta">
                          <span className="row-meta-text">
                            {item.pet.name}
                            {item.routine.dose ? `, ${item.routine.dose}` : ''}
                            {log
                              ? `, ${item.state === 'skipped' ? 'skipped' : 'done'} by ${name(log)} at ${formatClock(log.done_at)}`
                              : item.slot !== ANY_TIME
                                ? `, ${formatTime(item.slot)}`
                                : ''}
                          </span>
                          {!log && isLate(item) && <span className="late">overdue</span>}
                        </span>
                        {item.routine.notes && !log && <span className="note">{item.routine.notes}</span>}
                      </span>
                    </span>
                    {log && mineToUndo ? (
                      <button className="stamp-btn" onClick={() => undo(log)} aria-label={`Undo ${label}`}>
                        <Stamp name={log.sitter_name ?? '?'} color={colorOf(log)} />
                      </button>
                    ) : log ? (
                      <span className="stamp-btn" aria-label={`${label}, done`}>
                        <Stamp name={log.done_by ? name(log) : log.sitter_name ?? '?'} color={colorOf(log)} />
                      </span>
                    ) : (
                      <button className="stamp-btn" onClick={() => check(item)} aria-label={`Check off ${label}`}>
                        <span className="stamp-empty" />
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          </section>
        ))
      )}

      {mapOpen && <WalkMap title="Walk map" places={snap.places ?? []} onClose={() => setMapOpen(false)} />}

      <footer className="sitter-foot">
        <p className="muted small">
          This link works until {dayPhrase(ends, snap.today)}. Tap your own check-off to undo it.
        </p>
        {!preview && isIOS() && !isStandalone() && (
          <p className="muted small">To keep it handy, tap Share, then Add to Home Screen.</p>
        )}
      </footer>
    </div>
  );
}
