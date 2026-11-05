import { useMemo, useState } from 'react';
import { addDays, daysBetween, formatDayLabel, formatTime, parseISODate, toISODate, todayISO } from '../lib/dates';
import { buildDay, indexLogs, isResolved, type DayItem } from '../lib/day';
import { categoryLabel } from '../lib/pets';
import { ANY_TIME } from '../lib/schedule';
import type { Category } from '../lib/types';
import { useApp } from '../state';
import { CategoryMark, Icons, PetAvatar } from '../ui';

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
  return kind === 'interval' || kind === 'once' ? 'scheduled' : null;
}

const isHealth = (item: DayItem) => item.routine.category !== 'care';

const MARK_LABEL: Record<Mark, string> = {
  medication: 'Medication',
  vaccine: 'Vaccine',
  vet: 'Vet visit',
  care: 'Care',
  scheduled: 'Other scheduled',
};

export function CalendarScreen() {
  const { snapshot, goToDay } = useApp();
  const today = todayISO();
  const [month, setMonth] = useState(() => today.slice(0, 7) + '-01');
  const [selected, setSelected] = useState(today);
  const index = useMemo(() => indexLogs(snapshot.logs), [snapshot.logs]);

  const cells = useMemo(() => {
    const first = parseISODate(month);
    const start = addDays(month, -first.getDay());
    return Array.from({ length: 42 }, (_, i) => {
      const date = addDays(start, i);
      const marks = buildDay(snapshot, date, { index })
        .map((it) => ({ mark: markOf(it), done: isResolved(it) || it.state === 'moved' }))
        .filter((m): m is { mark: Mark; done: boolean } => m.mark !== null);
      return { date, inMonth: date.slice(0, 7) === month.slice(0, 7), marks };
    });
  }, [snapshot, month, index]);
  // Drop a trailing week that's entirely next month.
  const visible = cells.slice(35).some((c) => c.inMonth) ? cells : cells.slice(0, 35);

  const dayItems = useMemo(() => buildDay(snapshot, selected, { index }), [snapshot, selected, index]);
  const dayHealth = dayItems.filter((i) => isHealth(i) || markOf(i) !== null);
  const dayCare = dayItems.filter((i) => !isHealth(i) && markOf(i) === null && i.state !== 'moved');

  const upcoming = useMemo(() => {
    const out: { date: string; items: DayItem[] }[] = [];
    for (let i = 1; i <= UPCOMING_DAYS; i++) {
      const d = addDays(today, i);
      const items = buildDay(snapshot, d, { index }).filter((it) => {
        const m = markOf(it);
        return m && m !== 'scheduled' && it.state === 'open';
      });
      if (items.length) out.push({ date: d, items });
    }
    return out.slice(0, 12);
  }, [snapshot, today, index]);

  const m = parseISODate(month);
  const shiftMonth = (delta: number) => {
    const d = new Date(m.getFullYear(), m.getMonth() + delta, 1);
    setMonth(toISODate(d));
  };
  const usedMarks = new Set(cells.flatMap((c) => c.marks.map((x) => x.mark)));

  return (
    <>
      <header className="screen-head">
        <div className="day-nav">
          <button className="icon-btn" onClick={() => shiftMonth(-1)} aria-label="Previous month">
            {Icons.prev}
          </button>
          <h1 className="screen-title">
            {MONTHS[m.getMonth()]}
            {m.getFullYear() !== new Date().getFullYear() ? ` ${m.getFullYear()}` : ''}
          </h1>
          <button className="icon-btn" onClick={() => shiftMonth(1)} aria-label="Next month">
            {Icons.next}
          </button>
        </div>
      </header>

      <section className="cal" aria-label="Month">
        <div className="cal-head" aria-hidden="true">
          {WEEKDAYS.map((w) => (
            <span key={w}>{w.slice(0, 1)}</span>
          ))}
        </div>
        <div className="cal-grid">
          {visible.map((c) => {
            const isToday = c.date === today;
            const isSel = c.date === selected;
            const label = `${formatDayLabel(c.date, today)}${c.marks.length ? `, ${c.marks.length} scheduled` : ''}`;
            return (
              <button
                key={c.date}
                className={`cal-day${c.inMonth ? '' : ' cal-out'}${isToday ? ' cal-today' : ''}${isSel ? ' cal-sel' : ''}`}
                aria-label={label}
                aria-pressed={isSel}
                onClick={() => {
                  setSelected(c.date);
                  if (!c.inMonth) setMonth(c.date.slice(0, 7) + '-01');
                }}
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
        {usedMarks.size > 0 && (
          <ul className="cal-legend" aria-label="Key">
            {(['medication', 'vaccine', 'vet', 'scheduled'] as Mark[])
              .filter((k) => usedMarks.has(k))
              .map((k) => (
                <li key={k}>
                  <span className={`cal-dot dot-${k}`} aria-hidden="true" />
                  {MARK_LABEL[k]}
                </li>
              ))}
            <li>
              <span className="cal-dot dot-scheduled dot-done" aria-hidden="true" />
              Done
            </li>
          </ul>
        )}
      </section>

      <section className="group">
        <div className="group-head">
          <h2 className="group-label">{formatDayLabel(selected, today)}</h2>
          <button className="btn-text" onClick={() => goToDay(selected)}>
            Open {selected === today ? 'Today' : 'this day'}
          </button>
        </div>
        {dayHealth.length === 0 && dayCare.length === 0 ? (
          <div className="empty empty-inline">
            <p>Nothing scheduled.</p>
          </div>
        ) : (
          <ul className="list">
            {dayHealth.map((i) => (
              <AgendaRow key={i.key} item={i} />
            ))}
            {dayCare.length > 0 && (
              <li className="row agenda-care">
                <span className="row-text">
                  <span className="row-meta">
                    {dayHealth.length ? 'Plus ' : ''}
                    {dayCare.length} care {dayCare.length === 1 ? 'task' : 'tasks'}
                    {daysBetween(today, selected) <= 0 ? `, ${dayCare.filter(isResolved).length} done` : ''}
                  </span>
                </span>
              </li>
            )}
          </ul>
        )}
      </section>

      <section className="group">
        <h2 className="group-label">Coming up</h2>
        {upcoming.length === 0 ? (
          <div className="empty empty-inline">
            <p>No medications, vaccines or vet visits in the next {UPCOMING_DAYS} days.</p>
          </div>
        ) : (
          <ul className="list">
            {upcoming.flatMap(({ date, items }) =>
              items.map((i) => <AgendaRow key={`${date}-${i.key}`} item={i} showDate onPick={() => setSelected(date)} />),
            )}
          </ul>
        )}
      </section>
    </>
  );
}

function AgendaRow({ item, showDate = false, onPick }: { item: DayItem; showDate?: boolean; onPick?: () => void }) {
  const today = todayISO();
  const { routine, pet, slot, state } = item;
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
          </span>
          {(mark ?? routine.category) !== 'scheduled' && routine.category !== 'care' && (
            <span className="turn">{categoryLabel(routine.category)}</span>
          )}
          {status && <span className={`turn${status === 'Missed' ? ' turn-alert' : ''}`}>{status}</span>}
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
