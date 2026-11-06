import { useMemo, useState, type FormEvent } from 'react';
import { dayPhrase, daysBetween, formatClock, formatDayLabel, localDayOf, todayISO, weekdayOf, weekdayShort } from '../lib/dates';
import { firstName } from '../lib/people';
import { CATEGORIES } from '../lib/pets';
import { describeSchedule, ordinal } from '../lib/schedule';
import type { Category, Pet, Routine, RoutineInput, ScheduleKind, TaskLog } from '../lib/types';
import { useApp, whoDid } from '../state';
import { Chips, Field, Sheet } from '../ui';
import { CheckoffSheet } from './CheckoffSheet';

/** How often, in plain words. "Every few…" covers every 3 days, 2 weeks, 3 months and so on. */
type Freq = 'once' | 'daily' | 'weekly' | 'monthly' | 'custom';
type Unit = 'days' | 'weeks' | 'months';

const FREQ_OPTIONS: { value: Freq; label: string }[] = [
  { value: 'once', label: 'One time' },
  { value: 'daily', label: 'Every day' },
  { value: 'weekly', label: 'Every week' },
  { value: 'monthly', label: 'Every month' },
  { value: 'custom', label: 'Every few…' },
];

const UNIT_MAX: Record<Unit, number> = { days: 365, weeks: 52, months: 12 };

const PLACEHOLDERS: Record<Category, string> = {
  care: 'Breakfast, evening walk, grooming appointment…',
  medication: 'Heartworm chewable, flea and tick chew…',
  vaccine: 'Rabies, distemper, bordetella…',
  vet: 'Annual checkup, dental cleaning…',
};

function freqOf(r: Routine): { freq: Freq; unit: Unit; n: number } {
  const every = Math.max(1, r.repeat_every ?? 1);
  switch (r.kind) {
    case 'once':
      return { freq: 'once', unit: 'days', n: 2 };
    case 'daily':
      return { freq: 'daily', unit: 'days', n: 2 };
    case 'weekly':
      return every > 1 ? { freq: 'custom', unit: 'weeks', n: every } : { freq: 'weekly', unit: 'weeks', n: 2 };
    case 'monthly':
      return every > 1 ? { freq: 'custom', unit: 'months', n: every } : { freq: 'monthly', unit: 'months', n: 3 };
    case 'interval':
      return { freq: 'custom', unit: 'days', n: r.interval_days ?? 2 };
    default:
      return { freq: 'daily', unit: 'days', n: 2 };
  }
}

/**
 * Add or edit a routine, medication, vaccine, vet visit or one-time task.
 * Opened from a pet's profile, the calendar ("add on this day"), and the
 * Add button on Today.
 */
export function RoutineSheet({
  pet: fixedPet,
  routine,
  preset,
  presetDate,
  presetKind,
  onClose,
}: {
  /** Leave out to let people choose the pet. */
  pet?: Pet;
  routine: Routine | null;
  preset: Category;
  /** Start on this day (one-time tasks). */
  presetDate?: string;
  presetKind?: ScheduleKind;
  onClose: () => void;
}) {
  const { backend, snapshot, logs, run, me } = useApp();
  const today = todayISO();
  const [petId, setPetId] = useState(fixedPet?.id ?? routine?.pet_id ?? snapshot.pets[0]?.id ?? '');
  const pet = fixedPet ?? snapshot.pets.find((p) => p.id === petId);
  const start = routine
    ? freqOf(routine)
    : {
        freq: (presetKind === 'once' || presetKind === 'daily'
          ? presetKind
          : preset === 'vaccine' || preset === 'vet' || presetDate
            ? 'once'
            : 'daily') as Freq,
        unit: (preset === 'vaccine' ? 'months' : 'weeks') as Unit,
        n: preset === 'vaccine' ? 12 : 2,
      };
  const [category, setCategory] = useState<Category>(routine?.category ?? preset);
  const [title, setTitle] = useState(routine?.title ?? '');
  const [dose, setDose] = useState(routine?.dose ?? '');
  const [freq, setFreq] = useState<Freq>(start.freq);
  const [unit, setUnit] = useState<Unit>(start.unit);
  const [n, setN] = useState<number>(start.n);
  const [times, setTimes] = useState<string[]>(
    routine?.times ?? (preset === 'vaccine' ? [] : preset === 'vet' ? ['10:00'] : ['08:00']),
  );
  const [startDate, setStartDate] = useState(routine?.start_date ?? presetDate ?? today);
  const [weekdays, setWeekdays] = useState<number[]>(
    routine?.weekdays.length ? routine.weekdays : [weekdayOf(routine?.start_date ?? presetDate ?? today)],
  );
  const [assignee, setAssignee] = useState<string>(routine?.assignee ?? '');
  const [notes, setNotes] = useState(routine?.notes ?? '');
  const [active, setActive] = useState(routine?.active ?? true);
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [editingLog, setEditingLog] = useState<TaskLog | null>(null);

  const usesWeekdays = freq === 'weekly' || (freq === 'custom' && unit === 'weeks');
  const usesDate = freq === 'once' || freq === 'monthly' || freq === 'custom';
  const count = Math.max(1, Math.min(UNIT_MAX[unit], Math.round(n) || 1));

  /** The schedule part of the routine, from what's picked above. */
  const schedule = useMemo((): Pick<RoutineInput, 'kind' | 'weekdays' | 'interval_days' | 'repeat_every' | 'start_date'> => {
    // Every day and every week keep the routine's original start, so past days still show it.
    const keepStart = routine && routine.start_date <= today ? routine.start_date : today;
    const days = [...weekdays].sort();
    switch (freq) {
      case 'once':
        return { kind: 'once', weekdays: [], interval_days: null, repeat_every: 1, start_date: startDate };
      case 'daily':
        return { kind: 'daily', weekdays: [], interval_days: null, repeat_every: 1, start_date: keepStart };
      case 'weekly':
        return { kind: 'weekly', weekdays: days, interval_days: null, repeat_every: 1, start_date: keepStart };
      case 'monthly':
        return { kind: 'monthly', weekdays: [], interval_days: null, repeat_every: 1, start_date: startDate };
      case 'custom':
        if (unit === 'days') return { kind: 'interval', weekdays: [], interval_days: count, repeat_every: 1, start_date: startDate };
        if (unit === 'weeks') return { kind: 'weekly', weekdays: days, interval_days: null, repeat_every: count, start_date: startDate };
        return { kind: 'monthly', weekdays: [], interval_days: null, repeat_every: count, start_date: startDate };
    }
  }, [freq, unit, count, weekdays, startDate, routine, today]);

  const sortedTimes = [...new Set(times.filter(Boolean))].sort();
  const preview = describeSchedule({ ...(routine ?? ({} as Routine)), ...schedule, times: sortedTimes, active: true } as Routine, today);
  const invalid = usesWeekdays && weekdays.length === 0;

  const dateLabel =
    freq === 'once'
      ? category === 'vet'
        ? 'Appointment date'
        : category === 'vaccine'
          ? 'Due date'
          : 'Date'
      : startDate < today && routine
        ? 'Started'
        : 'First one is on';

  // Recent check-offs of this routine, so a wrong time can be fixed right here.
  const recent = useMemo(
    () =>
      routine
        ? logs
            .filter((l) => l.routine_id === routine.id && l.status !== 'snoozed')
            .sort((a, b) => b.done_at.localeCompare(a.done_at))
            .slice(0, 5)
        : [],
    [logs, routine],
  );

  async function save(e: FormEvent) {
    e.preventDefault();
    if (invalid || !pet) return;
    setBusy(true);
    const input: RoutineInput = {
      pet_id: pet.id,
      title: title.trim(),
      category,
      dose: category === 'medication' ? dose.trim() || null : null,
      times: sortedTimes,
      ...schedule,
      assignee: assignee || null,
      notes: notes.trim() || null,
    };
    const ok = await run(async () => {
      if (routine) await backend.updateRoutine(routine.id, { ...input, active });
      else await backend.addRoutine(snapshot.household.id, input);
      return true;
    }, routine ? 'Saved' : `Added ${input.title}`);
    setBusy(false);
    if (ok) onClose();
  }

  async function remove() {
    if (!routine) return;
    setBusy(true);
    const ok = await run(() => backend.deleteRoutine(routine.id).then(() => true), `Deleted ${routine.title}`);
    setBusy(false);
    if (ok) onClose();
  }

  const noun = category === 'care' ? (freq === 'once' ? 'task' : 'routine') : category === 'vet' ? 'vet visit' : category;

  return (
    <Sheet
      title={routine ? `Edit ${routine.title}` : fixedPet ? `New ${noun} for ${fixedPet.name}` : `New ${noun}`}
      onClose={onClose}
      footer={
        <button className="btn btn-primary btn-block" form="routine-form" disabled={busy || !pet || !title.trim() || invalid}>
          {routine ? 'Save changes' : `Add ${noun}`}
        </button>
      }
    >
      <form id="routine-form" className="stack" onSubmit={save}>
        {!fixedPet && !routine && snapshot.pets.length > 1 && (
          <div className="field">
            <span className="field-label">Which pet</span>
            <Chips<string>
              label="Which pet"
              value={petId}
              onChange={setPetId}
              options={snapshot.pets.map((p) => ({ value: p.id, label: `${p.emoji} ${p.name}` }))}
            />
          </div>
        )}
        <div className="field">
          <span className="field-label">Type</span>
          <Chips<Category>
            label="Type"
            value={category}
            onChange={(c) => {
              setCategory(c);
              if (!routine && (c === 'vaccine' || c === 'vet') && freq === 'daily') {
                setFreq('once');
                setTimes(c === 'vet' ? ['10:00'] : []);
              }
            }}
            options={CATEGORIES.map((c) => ({ value: c.key, label: c.label }))}
          />
        </div>

        <Field label={category === 'vet' ? 'What’s the visit for' : 'What needs doing'}>
          <input id="routine-title" value={title} onChange={(e) => setTitle(e.target.value)} required maxLength={60} placeholder={PLACEHOLDERS[category]} autoFocus={!routine} />
        </Field>

        {category === 'medication' && (
          <Field label="Dose" hint="Shown on Today so whoever gives it gets it right.">
            <input id="routine-dose" value={dose} onChange={(e) => setDose(e.target.value)} maxLength={80} placeholder="1 tablet, 25 mg, with food…" />
          </Field>
        )}

        <div className="field">
          <span className="field-label">How often</span>
          <Chips<Freq> label="How often" value={freq} onChange={setFreq} options={FREQ_OPTIONS} />
        </div>

        {freq === 'custom' && (
          <div className="field">
            <span className="field-label">Repeat every</span>
            <div className="every-row">
              <input
                id="routine-every"
                type="number"
                inputMode="numeric"
                min={1}
                max={UNIT_MAX[unit]}
                value={Number.isFinite(n) ? n : ''}
                onChange={(e) => setN(Number(e.target.value))}
                aria-label="How many"
              />
              <Chips<Unit>
                label="Days, weeks or months"
                value={unit}
                onChange={setUnit}
                options={[
                  { value: 'days', label: 'days' },
                  { value: 'weeks', label: 'weeks' },
                  { value: 'months', label: 'months' },
                ]}
              />
            </div>
          </div>
        )}

        {usesWeekdays && (
          <div className="field">
            <span className="field-label">{freq === 'weekly' ? 'On' : 'On these days'}</span>
            <div className="weekday-row" role="group" aria-label="Days of the week">
              {[0, 1, 2, 3, 4, 5, 6].map((d) => (
                <button
                  type="button"
                  key={d}
                  aria-pressed={weekdays.includes(d)}
                  className={`weekday${weekdays.includes(d) ? ' weekday-on' : ''}`}
                  onClick={() => setWeekdays(weekdays.includes(d) ? weekdays.filter((x) => x !== d) : [...weekdays, d])}
                >
                  {weekdayShort(d).slice(0, 2)}
                </button>
              ))}
            </div>
            {weekdays.length === 0 ? (
              <span className="field-hint late">Pick at least one day.</span>
            ) : (
              <span className="field-hint">Pick more than one for things like weekday walks.</span>
            )}
          </div>
        )}

        {usesDate && (
          <Field
            label={dateLabel}
            hint={
              freq === 'monthly' || (freq === 'custom' && unit === 'months')
                ? `Repeats on the ${ordinal(Number(startDate.slice(8, 10)))}${Number(startDate.slice(8, 10)) > 28 ? ', or the last day of shorter months' : ''}.`
                : undefined
            }
          >
            <input id="routine-date" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value || today)} required />
          </Field>
        )}

        <div className="field">
          <span className="field-label">Time of day</span>
          {times.length === 0 ? (
            <p className="muted small">Any time of day</p>
          ) : (
            times.map((t, i) => (
              <div className="time-row" key={i}>
                <input
                  id={`routine-time-${i}`}
                  type="time"
                  value={t}
                  aria-label={`Time ${i + 1}`}
                  onChange={(e) => setTimes(times.map((x, j) => (j === i ? e.target.value : x)))}
                  required
                />
                <button type="button" className="btn-text" onClick={() => setTimes(times.filter((_, j) => j !== i))}>
                  Remove
                </button>
              </div>
            ))
          )}
          <button
            type="button"
            className="btn-text"
            onClick={() => setTimes([...times, times.length ? '18:00' : '08:00'])}
            disabled={times.length >= 12}
          >
            {times.length ? 'Add another time' : 'Set a time'}
          </button>
        </div>

        {!invalid && <p className="schedule-preview">{preview}</p>}

        <div className="field">
          <span className="field-label">Whose job is it</span>
          <Chips<string>
            label="Whose job is it"
            value={assignee}
            onChange={setAssignee}
            options={[{ value: '', label: 'Anyone' }, ...snapshot.members.map((m) => ({ value: m.user_id, label: firstName(m.display_name) }))]}
          />
        </div>

        <Field label="Notes">
          <textarea
            id="routine-notes"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={2}
            maxLength={500}
            placeholder={category === 'vet' ? 'Clinic, what to bring, questions to ask' : 'Half a cup, mixed with water'}
          />
        </Field>

        {recent.length > 0 && (
          <div className="field">
            <span className="field-label">{category === 'medication' ? 'Recent doses' : 'Recent check-offs'}</span>
            <ul className="list list-inset">
              {recent.map((l) => (
                <li key={l.id}>
                  <button type="button" className="row row-button row-compact" onClick={() => setEditingLog(l)}>
                    <span className="row-text">
                      <span className="row-title">
                        {formatDayLabel(localDayOf(l.done_at), today)} at {formatClock(l.done_at)}
                      </span>
                      <span className="row-meta">
                        {l.status === 'skipped' ? 'Skipped' : 'Done'} by {whoDid(l, snapshot.members, me.user_id)}
                        {daysBetween(l.occurrence_date, localDayOf(l.done_at)) !== 0 ? `, for ${dayPhrase(l.occurrence_date, today)}` : ''}
                      </span>
                    </span>
                    <span className="row-edit">Change</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}

        {routine && (
          <label className="check-row">
            <input type="checkbox" checked={!active} onChange={(e) => setActive(!e.target.checked)} />
            <span>
              Pause this {noun}
              <span className="muted"> It won’t show up on Today until you turn it back on.</span>
            </span>
          </label>
        )}

        {routine &&
          (confirmDelete ? (
            <div className="danger-zone">
              <p>Delete {routine.title}? Past check-offs stay in Activity.</p>
              <div className="btn-pair">
                <button type="button" className="btn btn-quiet" onClick={() => setConfirmDelete(false)}>
                  Keep it
                </button>
                <button type="button" className="btn btn-danger" onClick={remove} disabled={busy}>
                  Delete
                </button>
              </div>
            </div>
          ) : (
            <button type="button" className="btn-text btn-text-danger" onClick={() => setConfirmDelete(true)}>
              Delete {noun}
            </button>
          ))}
      </form>
      {editingLog && <CheckoffSheet log={editingLog} onClose={() => setEditingLog(null)} />}
    </Sheet>
  );
}
