import { useEffect, useMemo, useState } from 'react';
import { addDays, daysBetween, formatClock, formatDayLabel, formatTime, todayISO, dayPhrase } from '../lib/dates';
import { buildDay, countsTowardProgress, indexLogs, isLate, isResolved, snoozeTarget, type DayItem } from '../lib/day';
import { firstName, memberById } from '../lib/people';
import { mealRoutines, petSubtitle } from '../lib/profile';
import { ANY_TIME, PERIODS, periodOf, type Period } from '../lib/schedule';
import type { Pet } from '../lib/types';
import { PetQuickInfo, petSummary } from '../parts/PetInfo';
import { SupplyBanner } from '../parts/Supplies';
import { foodOrderUrl } from '../lib/supplies';
import { CheckoffSheet } from '../sheets/CheckoffSheet';
import { ComingUp, LoggedRow, MonthCalendar, useSwipe } from './Calendar';
import { useApp, whoDid } from '../state';
import { CategoryMark, Icons, PetAvatar, Sheet, Spinner, Stamp, Tags } from '../ui';

const MAX_AHEAD = 60;
const SITTER_GREY = '#7B8794';

export function TodayScreen() {
  const { snapshot, logs, date, setDate, checkOff, freshLogIds, historyFrom, historyLoading, loadHistory, openAdd, openMap, me, viewPet } = useApp();
  const today = todayISO();
  const [petFilter, setPetFilter] = useState<string>('all');
  const [openKey, setOpenKey] = useState<string | null>(null);
  const pets = snapshot.pets;
  const onePet = pets.length === 1 ? pets[0] : null;
  const focusPet = onePet ?? pets.find((p) => p.id === petFilter) ?? null;

  // Looking further back than what's loaded: fetch that history.
  const needHistory = date < historyFrom;
  useEffect(() => {
    if (needHistory) loadHistory(addDays(date, -7));
  }, [needHistory, date, loadHistory]);

  const src = useMemo(() => ({ ...snapshot, logs }), [snapshot, logs]);
  const index = useMemo(() => indexLogs(logs), [logs]);
  const items = useMemo(
    () => buildDay(src, date, { petId: petFilter === 'all' ? undefined : petFilter, index }),
    [src, date, petFilter, index],
  );
  const opened = items.find((i) => i.key === openKey) ?? null;

  const counted = items.filter(countsTowardProgress);
  const done = counted.filter(isResolved).length;
  const ahead = daysBetween(today, date);
  const isFuture = ahead > 0;
  const grouped = PERIODS.map((p) => ({ ...p, items: items.filter((i) => periodOf(i.slot) === p.key) })).filter(
    (g) => g.items.length,
  );
  const logged = useMemo(
    () =>
      logs
        .filter((l) => !l.routine_id && l.occurrence_date === date && (petFilter === 'all' || l.pet_id === petFilter))
        .sort((a, b) => a.done_at.localeCompare(b.done_at)),
    [logs, date, petFilter],
  );

  // Swipe the day view sideways to go back or forward a day.
  const [slide, setSlide] = useState<'next' | 'prev' | null>(null);
  const go = (delta: number) => {
    if (delta > 0 && ahead >= MAX_AHEAD) return;
    setSlide(delta > 0 ? 'next' : 'prev');
    setDate(addDays(date, delta));
  };
  const swipe = useSwipe(() => go(1), () => go(-1));
  const pickDay = (d: string) => {
    setSlide(null);
    setDate(d);
    window.scrollTo({ top: 0, behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  };

  return (
    <>
      <div className="day-swipe" {...swipe}>
      <header className="screen-head">
        <div className="day-nav">
          <button className="icon-btn" onClick={() => go(-1)} aria-label="Previous day">
            {Icons.prev}
          </button>
          <h1 className="screen-title">{formatDayLabel(date, today)}</h1>
          <button
            className="icon-btn"
            onClick={() => go(1)}
            aria-label="Next day"
            disabled={ahead >= MAX_AHEAD}
          >
            {Icons.next}
          </button>
          {date !== today && (
            <button className="btn-text day-nav-today" onClick={() => pickDay(today)}>
              Back to today
            </button>
          )}
          {pets.length > 0 && (
            <button
              className="add-btn"
              onClick={() => openAdd({ kind: 'menu', date: date === today ? undefined : date })}
              aria-label={date === today ? 'Add a task, event, log or supply' : `Add something on ${formatDayLabel(date, today)}`}
            >
              {Icons.plus}
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

      {snapshot.behind && me.role === 'owner' && date === today && (
        <p className="form-notice behind-note">
          Herd has a database update waiting (update 003) for food reminders and the walk map. The README’s “Updating an existing setup” has the steps.
        </p>
      )}

      {date === today && <SupplyBanner />}

      {pets.length > 1 && (
        <div className="filter-row pet-strip" role="radiogroup" aria-label="Show tasks for">
          <button role="radio" aria-checked={petFilter === 'all'} className={`chip${petFilter === 'all' ? ' chip-on' : ''}`} onClick={() => setPetFilter('all')}>
            All pets
          </button>
          {pets.map((p) => (
            <button
              key={p.id}
              role="radio"
              aria-checked={petFilter === p.id}
              className={`chip chip-pet${petFilter === p.id ? ' chip-on' : ''}`}
              onClick={() => setPetFilter(petFilter === p.id ? 'all' : p.id)}
            >
              <PetAvatar emoji={p.emoji} photo={p.photo} size="sm" />
              {p.name}
            </button>
          ))}
        </div>
      )}

      {focusPet && <PetCard key={focusPet.id} pet={focusPet} onProfile={() => viewPet(focusPet.id)} />}

      <div key={date} className={`day-body${slide ? ` day-slide-${slide}` : ''}`}>
      {pets.length === 0 ? (
        <div className="empty">
          <p>Add your pets and their routines, and today’s list builds itself.</p>
          <button className="btn btn-primary" onClick={() => openAdd({ kind: 'pet' })}>
            Add your first pet
          </button>
        </div>
      ) : needHistory && historyLoading ? (
        <div className="empty empty-inline">
          <Spinner label="Loading that day" />
        </div>
      ) : items.length === 0 ? (
        <div className="empty">
          <p>
            Nothing scheduled {date === today ? 'today' : 'this day'}
            {petFilter !== 'all' ? ' for this pet' : ''}.
          </p>
          <button className="btn btn-quiet" onClick={() => openAdd({ kind: date < today ? 'log' : 'menu', date, petId: focusPet?.id })}>
            {date < today ? 'Log something for this day' : 'Add something'}
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

      {logged.length > 0 && (
        <section className="group" aria-label="Also logged">
          <h2 className="group-label">Also logged</h2>
          <ul className="list">
            {logged.map((l) => (
              <LoggedRow key={l.id} log={l} />
            ))}
          </ul>
        </section>
      )}
      </div>
      </div>

      {pets.length > 0 && (
        <section className="group shortcuts" aria-label="Shortcuts">
          <button className="btn btn-quiet btn-small" onClick={openMap}>
            {Icons.map}
            Walk map
          </button>
          <button className="btn btn-quiet btn-small" onClick={() => openAdd({ kind: 'log', date, petId: focusPet?.id })}>
            {Icons.activity}
            Log something
          </button>
          {date > today && (
            <button className="btn btn-quiet btn-small" onClick={() => openAdd({ kind: 'event', date, petId: focusPet?.id })}>
              {Icons.calendar}
              Add to this day
            </button>
          )}
        </section>
      )}

      {pets.length > 0 && (
        <>
          <MonthCalendar selected={date} onSelect={pickDay} />
          <ComingUp onPick={pickDay} />
        </>
      )}

      {opened && <TaskSheet item={opened} onClose={() => setOpenKey(null)} />}
    </>
  );
}

/** The chosen pet on Today, with a dropdown for feeding, allergies and the vet. */
function PetCard({ pet, onProfile }: { pet: Pet; onProfile: () => void }) {
  const { snapshot } = useApp();
  const [open, setOpen] = useState(false);
  const id = `today-pet-${pet.id}`;
  return (
    <section className={`pet-card${open ? ' pet-card-open' : ''}`} aria-label={pet.name}>
      <button className="pet-card-head" aria-expanded={open} aria-controls={id} onClick={() => setOpen(!open)}>
        <PetAvatar emoji={pet.emoji} photo={pet.photo} />
        <span className="row-text">
          <span className="row-title">{pet.name}’s info</span>
          <span className="row-meta">{open ? petSubtitle(pet, todayISO()) : petSummary(pet, snapshot.routines)}</span>
        </span>
        <span className="pet-card-chev" aria-hidden="true">
          {Icons.down}
        </span>
      </button>
      {open && (
        <div className="pet-card-body" id={id}>
          <PetQuickInfo pet={pet} routines={snapshot.routines} orderHref={foodOrderUrl(pet, snapshot.supplies)} />
          <button className="btn-text" onClick={onProfile}>
            Full profile
          </button>
        </div>
      )}
    </section>
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
    const name = doer?.display_name ?? log.sitter_name ?? log.author_name ?? '?';
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
  const { snapshot, me, checkOff, skip, snooze, undo } = useApp();
  const { routine, pet, log, state, slot } = item;
  const today = todayISO();
  const future = daysBetween(today, item.date) > 0;
  const [note, setNote] = useState(log?.note ?? '');
  const [showNote, setShowNote] = useState(false);
  const target = snoozeTarget(item.date, today);
  const targetLabel = dayPhrase(target, today);
  const who = log ? whoDid(log, snapshot.members, me.user_id, true) : '';
  const assignee = memberById(snapshot.members, routine.assignee);
  const pending = !!log?.id.startsWith('temp-');
  const isMeal = mealRoutines(pet, [routine]).length > 0;

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
      {isMeal && (pet.food || pet.food_amount) && (
        <div>
          <dt>Feed</dt>
          <dd>{[pet.food_amount, pet.food].filter(Boolean).join(', ')}</dd>
        </div>
      )}
      {isMeal && pet.feeding_notes && (
        <div>
          <dt>How</dt>
          <dd>{pet.feeding_notes}</dd>
        </div>
      )}
      {(isMeal || routine.category === 'medication') && pet.allergies.length > 0 && (
        <div>
          <dt>Allergies</dt>
          <dd>
            <Tags values={pet.allergies} tone="alert" />
          </dd>
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
  if (!log) return null;
  return (
    <CheckoffSheet log={log} onClose={onClose}>
      {details}
    </CheckoffSheet>
  );
}
