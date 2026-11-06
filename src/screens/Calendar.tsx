import { useEffect, useMemo, useRef, useState, type TouchEvent as ReactTouchEvent } from 'react';
import { addDays, daysBetween, formatClock, formatDayLabel, formatTime, parseISODate, toISODate, todayISO } from '../lib/dates';
import { buildDay, indexLogs, isResolved, type DayItem } from '../lib/day';
import { memberById } from '../lib/people';
import { categoryLabel } from '../lib/pets';
import { ANY_TIME } from '../lib/schedule';
import type { Category, TaskLog } from '../lib/types';
import { CheckoffSheet } from '../sheets/CheckoffSheet';
import { useApp, whoDid } from '../state';
import { CategoryMark, Icons, PetAvatar, Stamp } from '../ui';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const UPCOMING_DAYS = 45;

type Mark = Category | 'scheduled';

/**
 * Dots mark what doesn't happen every day: medications on a schedule,
 * vaccines, vet visits, one-time tasks, and things like "every 7 days".
 * Daily medications still show in each day's list, just without a dot.
 */
function markOf(item: DayItem): Mark | null {
  const { kind, category } = item.routine;
  if (kind === 'daily') return null;
  if (category !== 'care') return category;
  return kind === 'interval' || kind === 'once' || kind === 'monthly' ? 'scheduled' : null;
}

const MARK_LABEL: Record<Mark, string> = {
  medication: 'Medication',
  vaccine: 'Vaccine',
  vet: 'Vet visit',
  care: 'Care',
  scheduled: 'Other scheduled',
};

/**
 * The month under the day view on Today. Tapping a day shows it up top.
 * Swipe the month sideways, or use the arrows, to change months.
 */
export function MonthCalendar({ selected, onSelect }: { selected: string; onSelect: (d: string) => void }) {
  const { snapshot, logs, historyFrom, historyLoading, loadHistory } = useApp();
  const today = todayISO();
  const [month, setMonth] = useState(() => selected.slice(0, 7) + '-01');
  // Follow the day view when it moves into another month.
  const selMonth = selected.slice(0, 7);
  useEffect(() => setMonth(selMonth + '-01'), [selMonth]);
  const src = useMemo(() => ({ ...snapshot, logs }), [snapshot, logs]);
  const index = useMemo(() => indexLogs(logs), [logs]);

  const cells = useMemo(() => {
    const first = parseISODate(month);
    const start = addDays(month, -first.getDay());
    return Array.from({ length: 42 }, (_, i) => {
      const date = addDays(start, i);
      const items = buildDay(src, date, { index });
      const marks = items
        .map((it) => ({ mark: markOf(it), done: isResolved(it) || it.state === 'moved' }))
        .filter((m): m is { mark: Mark; done: boolean } => m.mark !== null);
      // Only days whose history is loaded can say something was missed.
      const missed = date < today && date >= historyFrom && items.some((it) => it.state === 'open');
      return { date, inMonth: date.slice(0, 7) === month.slice(0, 7), marks, missed };
    });
  }, [src, month, index, today, historyFrom]);
  const visible = cells.slice(35).some((c) => c.inMonth) ? cells : cells.slice(0, 35);
  const gridStart = cells[0].date;

  useEffect(() => {
    if (gridStart < historyFrom) loadHistory(gridStart);
  }, [gridStart, historyFrom, loadHistory]);
  const loadingPast = historyLoading && gridStart < historyFrom;

  const m = parseISODate(month);
  const shiftMonth = (delta: number) => setMonth(toISODate(new Date(m.getFullYear(), m.getMonth() + delta, 1)));
  const swipe = useSwipe(() => shiftMonth(1), () => shiftMonth(-1));
  const usedMarks = new Set(cells.flatMap((c) => c.marks.map((x) => x.mark)));
  const anyMissed = cells.some((c) => c.missed && c.inMonth);

  return (
    <section className={`cal${loadingPast ? ' cal-loading' : ''}`} aria-label="Calendar" aria-busy={loadingPast} {...swipe}>
      <div className="cal-top">
        <button className="icon-btn" onClick={() => shiftMonth(-1)} aria-label="Previous month">
          {Icons.prev}
        </button>
        <h2 className="cal-month">
          {MONTHS[m.getMonth()]}
          {m.getFullYear() !== new Date().getFullYear() ? ` ${m.getFullYear()}` : ''}
        </h2>
        <button className="icon-btn" onClick={() => shiftMonth(1)} aria-label="Next month">
          {Icons.next}
        </button>
      </div>
      <div className="cal-head" aria-hidden="true">
        {WEEKDAYS.map((w) => (
          <span key={w}>{w.slice(0, 1)}</span>
        ))}
      </div>
      <div className="cal-grid">
        {visible.map((c) => {
          const isToday = c.date === today;
          const isSel = c.date === selected;
          const label = `${formatDayLabel(c.date, today)}${c.marks.length ? `, ${c.marks.length} scheduled` : ''}${c.missed ? ', something was missed' : ''}`;
          return (
            <button
              key={c.date}
              className={`cal-day${c.inMonth ? '' : ' cal-out'}${isToday ? ' cal-today' : ''}${isSel ? ' cal-sel' : ''}${c.missed ? ' cal-missed' : ''}`}
              aria-label={label}
              aria-pressed={isSel}
              onClick={() => onSelect(c.date)}
            >
              <span className="cal-num">{Number(c.date.slice(8))}</span>
              <span className="cal-dots" aria-hidden="true">
                {c.marks.slice(0, 4).map((x, i) => (
                  <span key={i} className={`cal-dot dot-${x.mark}${x.done ? ' dot-done' : ''}`} />
                ))}
              </span>
            </button>
          );
        })}
      </div>
      {(usedMarks.size > 0 || anyMissed) && (
        <ul className="cal-legend" aria-label="Key">
          {(['medication', 'vaccine', 'vet', 'scheduled'] as Mark[])
            .filter((k) => usedMarks.has(k))
            .map((k) => (
              <li key={k}>
                <span className={`cal-dot dot-${k}`} aria-hidden="true" />
                {MARK_LABEL[k]}
              </li>
            ))}
          {usedMarks.size > 0 && (
            <li>
              <span className="cal-dot dot-scheduled dot-done" aria-hidden="true" />
              Done
            </li>
          )}
          {anyMissed && (
            <li>
              <span className="cal-missed-key" aria-hidden="true" />
              Something missed
            </li>
          )}
        </ul>
      )}
    </section>
  );
}

/** Medications, vaccines and vet visits in the next few weeks. Tap one to see that day. */
export function ComingUp({ onPick }: { onPick: (d: string) => void }) {
  const { snapshot, logs } = useApp();
  const today = todayISO();
  const src = useMemo(() => ({ ...snapshot, logs }), [snapshot, logs]);
  const index = useMemo(() => indexLogs(logs), [logs]);
  const upcoming = useMemo(() => {
    const out: { date: string; items: DayItem[] }[] = [];
    for (let i = 1; i <= UPCOMING_DAYS; i++) {
      const d = addDays(today, i);
      const items = buildDay(src, d, { index }).filter((it) => {
        const m = markOf(it);
        return m && m !== 'scheduled' && it.state === 'open';
      });
      if (items.length) out.push({ date: d, items });
    }
    return out.slice(0, 12);
  }, [src, today, index]);

  return (
    <section className="group">
      <h2 className="group-label">Coming up</h2>
      {upcoming.length === 0 ? (
        <div className="empty empty-inline">
          <p>No medications, vaccines or vet visits in the next {UPCOMING_DAYS} days.</p>
        </div>
      ) : (
        <ul className="list">
          {upcoming.flatMap(({ date, items }) =>
            items.map((i) => <AgendaRow key={`${date}-${i.key}`} item={i} showDate onPick={() => onPick(date)} />),
          )}
        </ul>
      )}
    </section>
  );
}

/** Horizontal swipe handlers: left goes forward, right goes back. Ignores mostly-vertical drags. */
export function useSwipe(onLeft: () => void, onRight: () => void) {
  const start = useRef<{ x: number; y: number; t: number } | null>(null);
  return {
    onTouchStart: (e: ReactTouchEvent) => {
      const target = e.target as HTMLElement;
      if (e.touches.length !== 1 || target.closest('.filter-row, input, textarea, select, .no-swipe')) {
        start.current = null;
        return;
      }
      start.current = { x: e.touches[0].clientX, y: e.touches[0].clientY, t: Date.now() };
    },
    onTouchEnd: (e: ReactTouchEvent) => {
      const s0 = start.current;
      start.current = null;
      if (!s0) return;
      const dx = e.changedTouches[0].clientX - s0.x;
      const dy = e.changedTouches[0].clientY - s0.y;
      if (Math.abs(dx) < 60 || Math.abs(dx) < Math.abs(dy) * 1.6 || Date.now() - s0.t > 800) return;
      if (dx < 0) onLeft();
      else onRight();
    },
  };
}

/** Something logged by hand that day (a bath, a vet visit). Tap to change or remove it. */
export function LoggedRow({ log }: { log: TaskLog }) {
  const { snapshot, me } = useApp();
  const [open, setOpen] = useState(false);
  const pet = snapshot.pets.find((p) => p.id === log.pet_id);
  const who = memberById(snapshot.members, log.done_by);
  return (
    <li>
      <button className="row row-button" onClick={() => setOpen(true)}>
        <Stamp name={who?.display_name ?? log.sitter_name ?? log.author_name ?? '?'} color={who?.color ?? '#7B8794'} size="sm" />
        <span className="row-text">
          <span className="row-title">
            {log.title}
            {pet ? ` for ${pet.name}` : ''}
          </span>
          <span className="row-meta">
            <span className="row-meta-text">
              {whoDid(log, snapshot.members, me.user_id, true)} logged this at {formatClock(log.done_at)}
            </span>
          </span>
          {log.note && <span className="note">“{log.note}”</span>}
        </span>
        <span className="chev" aria-hidden="true">
          {Icons.next}
        </span>
      </button>
      {open && <CheckoffSheet log={log} onClose={() => setOpen(false)} />}
    </li>
  );
}

function AgendaRow({ item, showDate = false, onPick }: { item: DayItem; showDate?: boolean; onPick?: () => void }) {
  const { snapshot, me } = useApp();
  const today = todayISO();
  const { routine, pet, slot, state, log } = item;
  const by = log && (state === 'done' || state === 'skipped') ? whoDid(log, snapshot.members, me.user_id) : null;
  const mark = markOf(item);
  const status =
    state === 'done' ? 'Done' : state === 'skipped' ? 'Skipped' : state === 'moved' ? 'Moved' : daysBetween(today, item.date) < 0 ? 'Missed' : '';
  const when = [
    showDate ? formatDayLabel(item.date, today) : '',
    slot === ANY_TIME ? '' : formatTime(slot),
  ].filter(Boolean);
  const body = (
    <>
      <PetAvatar emoji={pet.emoji} photo={pet.photo} size="sm" />
      <span className="row-text">
        <span className="row-title">
          <CategoryMark category={routine.category} />
          {routine.title}
        </span>
        <span className="row-meta">
          <span className="row-meta-text">
            {pet.name}
            {when.length ? `, ${when.join(' at ')}` : ''}
            {routine.dose ? `, ${routine.dose}` : ''}
            {by && log ? `, ${state === 'skipped' ? 'skipped' : 'done'} by ${by} at ${formatClock(log.done_at)}` : ''}
          </span>
          {(mark ?? routine.category) !== 'scheduled' && routine.category !== 'care' && (
            <span className="turn">{categoryLabel(routine.category)}</span>
          )}
          {status && !by && <span className={`turn${status === 'Missed' ? ' turn-alert' : ''}`}>{status}</span>}
        </span>
      </span>
    </>
  );
  return (
    <li className={`row${state === 'done' || state === 'skipped' ? ' row-done' : ''}`}>
      {onPick ? (
        <button className="row-main" onClick={onPick}>
          {body}
        </button>
      ) : (
        <span className="row-main">{body}</span>
      )}
    </li>
  );
}
