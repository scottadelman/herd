import { useMemo, useState } from 'react';
import { addDays, formatClock, formatDayLabel, formatTime, todayISO } from '../lib/dates';
import { firstName, memberById } from '../lib/people';
import { ANY_TIME, PERIODS, isOverdue, occurrencesForDate, periodOf, slotKey, type Period } from '../lib/schedule';
import type { Pet, Routine, TaskLog } from '../lib/types';
import { useApp } from '../state';
import { Icons, PetAvatar, Sheet, Stamp } from '../ui';

interface Item {
  key: string;
  routine: Routine;
  pet: Pet;
  slot: string;
  log: TaskLog | undefined;
}

export function TodayScreen({ onGoToPets }: { onGoToPets: () => void }) {
  const { snapshot, me, complete, undo, freshLogIds } = useApp();
  const today = todayISO();
  const [date, setDate] = useState(today);
  const [petFilter, setPetFilter] = useState<string>('all');
  const [detail, setDetail] = useState<Item | null>(null);

  const items = useMemo(() => {
    const byKey = new Map<string, TaskLog>();
    for (const l of snapshot.logs) if (l.routine_id) byKey.set(slotKey(l.routine_id, l.occurrence_date, l.slot), l);
    const petsById = new Map(snapshot.pets.map((p) => [p.id, p]));
    const out: Item[] = [];
    for (const r of snapshot.routines) {
      const pet = petsById.get(r.pet_id);
      if (!pet || (petFilter !== 'all' && pet.id !== petFilter)) continue;
      for (const slot of occurrencesForDate(r, date)) {
        const key = slotKey(r.id, date, slot);
        out.push({ key, routine: r, pet, slot, log: byKey.get(key) });
      }
    }
    return out.sort(
      (a, b) =>
        (a.slot === ANY_TIME ? '99' : a.slot).localeCompare(b.slot === ANY_TIME ? '99' : b.slot) ||
        a.pet.name.localeCompare(b.pet.name) ||
        a.routine.title.localeCompare(b.routine.title),
    );
  }, [snapshot, date, petFilter]);

  const done = items.filter((i) => i.log).length;
  const grouped = PERIODS.map((p) => ({ ...p, items: items.filter((i) => periodOf(i.slot) === p.key) })).filter(
    (g) => g.items.length,
  );
  const canGoForward = date < today;
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
            disabled={!canGoForward}
          >
            {Icons.next}
          </button>
        </div>
        {items.length > 0 && (
          <div className="progress" aria-label={`${done} of ${items.length} done`}>
            <span className="progress-text">
              {done === items.length ? 'All done' : `${done} of ${items.length} done`}
            </span>
            <span className="progress-track">
              <span className="progress-fill" style={{ width: `${(done / items.length) * 100}%` }} />
            </span>
          </div>
        )}
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
          <p>Nothing scheduled {date === today ? 'today' : 'this day'}{petFilter !== 'all' ? ' for this pet' : ''}.</p>
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
                  date={date}
                  period={g.key}
                  fresh={!!item.log && freshLogIds.has(item.log.id)}
                  onCheck={() =>
                    complete({
                      petId: item.pet.id,
                      routineId: item.routine.id,
                      date,
                      slot: item.slot,
                      title: item.routine.title,
                    })
                  }
                  onOpen={() => setDetail(item)}
                />
              ))}
            </ul>
          </section>
        ))
      )}

      {detail && detail.log && (
        <DoneSheet
          item={detail}
          log={detail.log}
          onClose={() => setDetail(null)}
          onUndo={() => {
            undo(detail.log!);
            setDetail(null);
          }}
          isMine={detail.log.done_by === me.user_id}
        />
      )}
    </>
  );
}

function TaskRow({
  item,
  date,
  period,
  fresh,
  onCheck,
  onOpen,
}: {
  item: Item;
  date: string;
  period: Period;
  fresh: boolean;
  onCheck: () => void;
  onOpen: () => void;
}) {
  const { snapshot, me } = useApp();
  const { routine, pet, slot, log } = item;
  const doneBy = log ? memberById(snapshot.members, log.done_by) : undefined;
  const doneName = log?.done_by === me.user_id ? 'you' : firstName(doneBy?.display_name ?? 'someone');
  const assignee = memberById(snapshot.members, routine.assignee);
  const late = !log && isOverdue(date, slot);
  const when = slot === ANY_TIME ? '' : ` at ${formatTime(slot)}`;

  let meta: JSX.Element;
  if (log) {
    meta = (
      <>
        {pet.name}, by {doneName} at {formatClock(log.done_at)}
      </>
    );
  } else {
    meta = (
      <>
        {pet.name}
        {when}
        {late && <span className="late">{period === 'anytime' ? ', missed' : ', overdue'}</span>}
        {assignee && (
          <span className="turn">{assignee.user_id === me.user_id ? 'Your turn' : `${firstName(assignee.display_name)}’s turn`}</span>
        )}
      </>
    );
  }

  const label = `${routine.title} for ${pet.name}`;
  return (
    <li className={`row${log ? ' row-done' : ''}`}>
      <PetAvatar emoji={pet.emoji} />
      <div className="row-text">
        <span className="row-title">{routine.title}</span>
        <span className="row-meta">{meta}</span>
      </div>
      {log ? (
        <button className="stamp-btn" onClick={onOpen} aria-label={`${label}, done by ${doneBy?.display_name ?? 'someone'}. Details`}>
          <Stamp name={doneBy?.display_name ?? '?'} color={doneBy?.color ?? '#7B8794'} fresh={fresh || log.id.startsWith('temp-')} />
        </button>
      ) : (
        <button className="stamp-btn" onClick={onCheck} aria-label={`Check off ${label}`}>
          <span className="stamp-empty" />
        </button>
      )}
    </li>
  );
}

function DoneSheet({
  item,
  log,
  isMine,
  onClose,
  onUndo,
}: {
  item: Item;
  log: TaskLog;
  isMine: boolean;
  onClose: () => void;
  onUndo: () => void;
}) {
  const { snapshot } = useApp();
  const who = memberById(snapshot.members, log.done_by);
  return (
    <Sheet
      title={`${item.routine.title} for ${item.pet.name}`}
      onClose={onClose}
      footer={
        <button className="btn btn-quiet btn-block" onClick={onUndo} disabled={log.id.startsWith('temp-')}>
          Undo check-off
        </button>
      }
    >
      <div className="done-detail">
        <Stamp name={who?.display_name ?? '?'} color={who?.color ?? '#7B8794'} size="lg" />
        <p>
          {isMine ? 'You' : who?.display_name ?? 'Someone'} checked this off at {formatClock(log.done_at)}
          {log.occurrence_date !== todayISO() ? `, ${formatDayLabel(log.occurrence_date)}` : ''}.
        </p>
        {log.note && <p className="note">“{log.note}”</p>}
        {item.routine.notes && <p className="muted">Routine notes: {item.routine.notes}</p>}
      </div>
    </Sheet>
  );
}
