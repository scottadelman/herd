import { useMemo, useState } from 'react';
import { addDays, daysBetween, formatClock, formatDayLabel, formatTime, toISODate, todayISO, dayPhrase } from '../lib/dates';
import { buildDay, countsTowardProgress, indexLogs, isLate, isResolved, snoozeTarget, type DayItem } from '../lib/day';
import { firstName, memberById } from '../lib/people';
import { ANY_TIME, PERIODS, periodOf, type Period } from '../lib/schedule';
import { useApp, whoDid } from '../state';
import { CategoryMark, Icons, PetAvatar, Sheet, Stamp } from '../ui';

const MAX_AHEAD = 60;
const SITTER_GREY = '#7B8794';

export function TodayScreen({ onGoToPets }: { onGoToPets: () => void }) {
  const { snapshot, date, setDate, checkOff, freshLogIds } = useApp();
  const today = todayISO();
  const [petFilter, setPetFilter] = useState<string>('all');
  const [openKey, setOpenKey] = useState<string | null>(null);

  const index = useMemo(() => indexLogs(snapshot.logs), [snapshot.logs]);
  const items = useMemo(
    () => buildDay(snapshot, date, { petId: petFilter === 'all' ? undefined : petFilter, index }),
    [snapshot, date, petFilter, index],
  );
  const opened = items.find((i) => i.key === openKey) ?? null;

  const counted = items.filter(countsTowardProgress);
  const done = counted.filter(isResolved).length;
  const ahead = daysBetween(today, date);
  const isFuture = ahead > 0;
  const grouped = PERIODS.map((p) => ({ ...p, items: items.filter((i) => periodOf(i.slot) === p.key) })).filter(
    (g) => g.items.length,
  );
  const pets = snapshot.pets;

  return (
    <>
      <header className="screen-head">
        <div className="day-nav">
          <button className="icon-btn" onClick={() => setDate(addDays(date, -1))} aria-label="Previous day">
            {Icons.prev}
          </button>
          <h1 className="screen-title">{formatDayLabel(date, today)}</h1>
          <button
            className="icon-btn"
            onClick={() => setDate(addDays(date, 1))}
            aria-label="Next day"
            disabled={ahead >= MAX_AHEAD}
          >
            {Icons.next}
          </button>
          {date !== today && (
            <button className="btn-text day-nav-today" onClick={() => setDate(today)}>
              Back to today
            </button>
          )}
        </div>
        {counted.length > 0 &&
          (isFuture ? (
            <p className="progress-text">
              {counted.length} {counted.length === 1 ? 'task' : 'tasks'} planned
            </p>
          ) : (
            <div className="progress" aria-label={`${done} of ${counted.length} done`}>
              <span className="progress-text">{done === counted.length ? 'All done' : `${done} of ${counted.length} done`}</span>
              <span className="progress-track">
                <span className="progress-fill" style={{ width: `${(done / counted.length) * 100}%` }} />
              </span>
            </div>
          ))}
      </header>

      {pets.length > 1 && (
        <div className="filter-row" role="radiogroup" aria-label="Show tasks for">
          {[{ id: 'all', name: 'All pets', emoji: '' }, ...pets].map((p) => (
            <button
              key={p.id}
              role="radio"
              aria-checked={petFilter === p.id}
              className={`chip${petFilter === p.id ? ' chip-on' : ''}`}
              onClick={() => setPetFilter(p.id)}
            >
              {p.emoji && <span aria-hidden="true">{p.emoji} </span>}
              {p.name}
            </button>
          ))}
        </div>
      )}

      {pets.length === 0 ? (
        <div className="empty">
          <p>Add your pets and their routines, and today’s list builds itself.</p>
          <button className="btn btn-primary" onClick={onGoToPets}>
            Add your first pet
          </button>
        </div>
      ) : items.length === 0 ? (
        <div className="empty">
          <p>
            Nothing scheduled {date === today ? 'today' : 'this day'}
            {petFilter !== 'all' ? ' for this pet' : ''}.
          </p>
          <button className="btn btn-quiet" onClick={onGoToPets}>
            Add a routine
          </button>
        </div>
      ) : (
        grouped.map((g) => (
          <section key={g.key} className="group" aria-label={g.label}>
            <h2 className="group-label">{g.label}</h2>
            <ul className="list">
              {g.items.map((item) => (
                <TaskRow
                  key={item.key}
                  item={item}
                  period={g.key}
                  future={isFuture}
                  fresh={!!item.log && freshLogIds.has(item.log.id)}
                  onCheck={() => checkOff(item)}
                  onOpen={() => setOpenKey(item.key)}
                />
              ))}
            </ul>
          </section>
        ))
      )}

      {opened && <TaskSheet item={opened} onClose={() => setOpenKey(null)} />}
    </>
  );
}

function rowMeta(item: DayItem, period: Period, ctx: ReturnType<typeof useApp>): JSX.Element {
  const { snapshot, me } = ctx;
  const today = todayISO();
  const { routine, pet, slot, log, state } = item;
  const who = log ? whoDid(log, snapshot.members, me.user_id) : '';
  const parts: JSX.Element[] = [<span key="pet">{pet.name}</span>];
  if (routine.category === 'medication' && routine.dose) parts.push(<span key="dose">{routine.dose}</span>);

  if (state === 'done' && log) {
    parts.push(<span key="w">by {who} at {formatClock(log.done_at)}</span>);
  } else if (state === 'skipped') {
    parts.push(<span key="w">skipped by {who}</span>);
  } else if (state === 'moved' && item.movedTo) {
    parts.push(<span key="w">moved to {dayPhrase(item.movedTo, today)} by {who}</span>);
  } else {
    if (slot !== ANY_TIME) parts.push(<span key="t">{formatTime(slot)}</span>);
    if (isLate(item)) {
      parts.push(
        <span key="late" className="late">
          {period === 'anytime' || daysBetween(today, item.date) < 0 ? 'missed' : 'overdue'}
        </span>,
      );
    }
  }
  const out: JSX.Element[] = [];
  parts.forEach((p, i) => {
    if (i > 0) out.push(<span key={`sep${i}`}>, </span>);
    out.push(p);
  });
  const assignee = memberById(snapshot.members, routine.assignee);
  return (
    <>
      <span className="row-meta-text">{out}</span>
      {item.movedFrom && state !== 'done' && state !== 'skipped' && (
        <span className="turn">from {dayPhrase(item.movedFrom, today)}</span>
      )}
      {state === 'open' && assignee && (
        <span className="turn">{assignee.user_id === me.user_id ? 'Your turn' : `${firstName(assignee.display_name)}’s turn`}</span>
      )}
    </>
  );
}

function TaskRow({
  item,
  period,
  future,
  fresh,
  onCheck,
  onOpen,
}: {
  item: DayItem;
  period: Period;
  future: boolean;
  fresh: boolean;
  onCheck: () => void;
  onOpen: () => void;
}) {
  const ctx = useApp();
  const { snapshot } = ctx;
  const { routine, pet, log, state } = item;
  const doer = log ? memberById(snapshot.members, log.done_by) : undefined;
  const label = `${routine.title} for ${pet.name}`;

  let action: JSX.Element;
  if (state === 'done' && log) {
    const name = doer?.display_name ?? log.sitter_name ?? '?';
    action = (
      <button className="stamp-btn" onClick={onOpen} aria-label={`${label}, done. Details`}>
        <Stamp name={name} color={doer?.color ?? SITTER_GREY} fresh={fresh || log.id.startsWith('temp-')} />
      </button>
    );
  } else if (state === 'skipped') {
    action = (
      <button className="stamp-btn" onClick={onOpen} aria-label={`${label}, skipped. Details`}>
        <span className="stamp-skip">{Icons.skip}</span>
      </button>
    );
  } else if (state === 'moved') {
    action = (
      <button className="stamp-btn" onClick={onOpen} aria-label={`${label}, moved. Details`}>
        <span className="stamp-skip">{Icons.moved}</span>
      </button>
    );
  } else if (future) {
    action = (
      <button className="stamp-btn" onClick={onOpen} aria-label={`${label}, coming up. Options`}>
        <span className="stamp-empty stamp-future" />
      </button>
    );
  } else {
    action = (
      <button className="stamp-btn" onClick={onCheck} aria-label={`Check off ${label}`}>
        <span className="stamp-empty" />
      </button>
    );
  }

  return (
    <li className={`row row-task row-${state}`}>
      <button className="row-main" onClick={onOpen} aria-label={`${label}. Options`}>
        <PetAvatar emoji={pet.emoji} photo={pet.photo} />
        <span className="row-text">
          <span className="row-title">
            <CategoryMark category={routine.category} />
            {routine.title}
          </span>
          <span className="row-meta">{rowMeta(item, period, ctx)}</span>
        </span>
      </button>
      {action}
    </li>
  );
}

function TaskSheet({ item, onClose }: { item: DayItem; onClose: () => void }) {
  const { snapshot, me, checkOff, skip, snooze, undo, editLog, backend } = useApp();
  const { routine, pet, log, state, slot } = item;
  const today = todayISO();
  const future = daysBetween(today, item.date) > 0;
  const [note, setNote] = useState(log?.note ?? '');
  const [showNote, setShowNote] = useState(false);
  const mine = !!log && log.done_by === me.user_id;
  const [time, setTime] = useState(() => (log ? toTimeInput(log.done_at) : ''));
  const target = snoozeTarget(item.date, today);
  const targetLabel = dayPhrase(target, today);
  const who = log ? whoDid(log, snapshot.members, me.user_id, true) : '';
  const doer = log ? memberById(snapshot.members, log.done_by) : undefined;
  const assignee = memberById(snapshot.members, routine.assignee);
  const pending = !!log?.id.startsWith('temp-');

  const when = slot === ANY_TIME ? 'Any time' : formatTime(slot);
  const details = (
    <dl className="facts">
      <div>
        <dt>When</dt>
        <dd>
          {formatDayLabel(item.date, today)}, {when.toLowerCase() === 'any time' ? 'any time' : when}
          {item.movedFrom ? ` (moved from ${dayPhrase(item.movedFrom, today)})` : ''}
        </dd>
      </div>
      {routine.category === 'medication' && routine.dose && (
        <div>
          <dt>Dose</dt>
          <dd>{routine.dose}</dd>
        </div>
      )}
      {assignee && (
        <div>
          <dt>Whose job</dt>
          <dd>{assignee.user_id === me.user_id ? 'Yours' : assignee.display_name}</dd>
        </div>
      )}
      {routine.notes && (
        <div>
          <dt>Notes</dt>
          <dd>{routine.notes}</dd>
        </div>
      )}
    </dl>
  );

  if (state === 'open') {
    return (
      <Sheet
        title={`${routine.title} for ${pet.name}`}
        onClose={onClose}
        footer={
          <div className="sheet-actions">
            <button
              className="btn btn-primary btn-block"
              disabled={future}
              onClick={() => {
                onClose();
                checkOff(item, note.trim() || null);
              }}
            >
              {future ? 'Check off on the day' : note.trim() ? 'Check off with note' : 'Check off'}
            </button>
            <div className="btn-pair">
              <button
                className="btn btn-quiet"
                onClick={() => {
                  onClose();
                  snooze(item);
                }}
              >
                {daysBetween(today, target) === 0 && item.date !== today ? 'Move to today' : 'Snooze a day'}
              </button>
              <button
                className="btn btn-quiet"
                onClick={() => {
                  onClose();
                  skip(item);
                }}
              >
                Skip {future ? 'that day' : item.date === today ? 'today' : 'it'}
              </button>
            </div>
          </div>
        }
      >
        <div className="stack">
          {details}
          {!future &&
            (showNote ? (
              <label className="field">
                <span className="field-label">Note</span>
                <textarea
                  id="checkoff-note"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  rows={2}
                  maxLength={500}
                  placeholder="Only ate half, seemed tired…"
                  autoFocus
                />
              </label>
            ) : (
              <button className="btn-text" onClick={() => setShowNote(true)}>
                Add a note
              </button>
            ))}
          <p className="muted small">
            Snoozing moves it to {targetLabel}. Skipping marks it as not needed{future ? ' that day' : ''}.
          </p>
        </div>
      </Sheet>
    );
  }

  if (state === 'moved' && log) {
    return (
      <Sheet
        title={`${routine.title} for ${pet.name}`}
        onClose={onClose}
        footer={
          <button
            className="btn btn-quiet btn-block"
            disabled={pending}
            onClick={() => {
              onClose();
              undo(log);
            }}
          >
            Move it back to {dayPhrase(item.date, today)}
          </button>
        }
      >
        <div className="stack">
          <p>
            {who} moved this to {dayPhrase(item.movedTo!, today)}.
          </p>
          {details}
        </div>
      </Sheet>
    );
  }

  // done or skipped
  const changed = (log?.note ?? '') !== note || (log && toTimeInput(log.done_at) !== time);
  return (
    <Sheet
      title={`${routine.title} for ${pet.name}`}
      onClose={onClose}
      footer={
        <div className="sheet-actions">
          {mine && (
            <button
              className="btn btn-primary btn-block"
              disabled={!changed || pending}
              onClick={() => {
                if (!log) return;
                onClose();
                editLog(log, { note: note.trim() || null, done_at: withTime(log.done_at, time) });
              }}
            >
              Save changes
            </button>
          )}
          <button
            className="btn btn-quiet btn-block"
            disabled={pending}
            onClick={() => {
              if (!log) return;
              onClose();
              undo(log);
            }}
          >
            {state === 'skipped' ? 'Undo skip' : 'Undo check-off'}
          </button>
        </div>
      }
    >
      <div className="stack">
        <div className="done-detail">
          {state === 'done' ? (
            <Stamp name={doer?.display_name ?? log?.sitter_name ?? '?'} color={doer?.color ?? SITTER_GREY} size="lg" />
          ) : (
            <span className="stamp-skip stamp-skip-lg">{Icons.skip}</span>
          )}
          <p>
            {who} {state === 'skipped' ? 'skipped this' : 'checked this off'} at {log ? formatClock(log.done_at) : ''}
            {log && toISODate(new Date(log.done_at)) !== today
              ? `, ${dayPhrase(toISODate(new Date(log.done_at)), today)}`
              : ''}
            .
          </p>
        </div>
        {mine ? (
          <>
            <label className="field">
              <span className="field-label">{state === 'skipped' ? 'Time' : 'Time it was done'}</span>
              <input id="done-time" type="time" value={time} onChange={(e) => setTime(e.target.value)} />
              <span className="field-hint">Forgot to tap? Set the time it actually happened.</span>
            </label>
            <label className="field">
              <span className="field-label">Note</span>
              <textarea
                id="done-note"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                rows={2}
                maxLength={500}
                placeholder="Only ate half, seemed tired…"
              />
            </label>
          </>
        ) : (
          log?.note && <p className="note">“{log.note}”</p>
        )}
        {!mine && backend.kind === 'supabase' && <p className="muted small">Only {who} can change the time or note.</p>}
        {details}
      </div>
    </Sheet>
  );
}

function toTimeInput(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function withTime(iso: string, hhmm: string): string {
  if (!/^\d{2}:\d{2}$/.test(hhmm)) return iso;
  const d = new Date(iso);
  const [h, m] = hhmm.split(':').map(Number);
  d.setHours(h, m, 0, 0);
  return d.toISOString();
}
