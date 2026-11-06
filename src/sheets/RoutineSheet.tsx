import { useMemo, useState, type FormEvent } from 'react';
import { todayISO, weekdayShort } from '../lib/dates';
import { firstName } from '../lib/people';
import { CATEGORIES } from '../lib/pets';
import type { Category, Pet, Routine, RoutineInput, ScheduleKind } from '../lib/types';
import { useApp } from '../state';
import { Chips, Field, Sheet } from '../ui';

/* ---------- Add / edit a routine ---------- */

const KIND_OPTIONS: { value: ScheduleKind; label: string }[] = [
  { value: 'daily', label: 'Every day' },
  { value: 'weekly', label: 'Some days' },
  { value: 'interval', label: 'Every few days' },
  { value: 'once', label: 'One time' },
];

const PLACEHOLDERS: Record<Category, string> = {
  care: 'Breakfast, evening walk, grooming appointment…',
  medication: 'Heartworm chewable, thyroid pill…',
  vaccine: 'Rabies, distemper, bordetella…',
  vet: 'Annual checkup, dental cleaning…',
};

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
  const { backend, snapshot, run } = useApp();
  const today = todayISO();
  const [petId, setPetId] = useState(fixedPet?.id ?? routine?.pet_id ?? snapshot.pets[0]?.id ?? '');
  const pet = fixedPet ?? snapshot.pets.find((p) => p.id === petId);
  const startKind: ScheduleKind =
    routine?.kind ?? presetKind ?? (preset === 'vaccine' || preset === 'vet' || presetDate ? 'once' : 'daily');
  const [category, setCategory] = useState<Category>(routine?.category ?? preset);
  const [title, setTitle] = useState(routine?.title ?? '');
  const [dose, setDose] = useState(routine?.dose ?? '');
  const [kind, setKind] = useState<ScheduleKind>(startKind);
  const [times, setTimes] = useState<string[]>(
    routine?.times ?? (preset === 'vaccine' ? [] : preset === 'vet' ? ['10:00'] : ['08:00']),
  );
  const [weekdays, setWeekdays] = useState<number[]>(routine?.weekdays.length ? routine.weekdays : [1, 3, 5]);
  const [intervalDays, setIntervalDays] = useState<number>(routine?.interval_days ?? (preset === 'vaccine' ? 365 : 7));
  const [startDate, setStartDate] = useState(routine?.start_date ?? presetDate ?? today);
  const [assignee, setAssignee] = useState<string>(routine?.assignee ?? '');
  const [notes, setNotes] = useState(routine?.notes ?? '');
  const [active, setActive] = useState(routine?.active ?? true);
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const dateLabel = useMemo(() => {
    if (kind === 'interval') return 'Next one is due';
    if (category === 'vet') return 'Appointment date';
    if (category === 'vaccine') return 'Due date';
    return 'Date';
  }, [kind, category]);

  async function save(e: FormEvent) {
    e.preventDefault();
    if (kind === 'weekly' && weekdays.length === 0) return;
    if (!pet) return;
    setBusy(true);
    const input: RoutineInput = {
      pet_id: pet.id,
      title: title.trim(),
      kind,
      category,
      dose: category === 'medication' ? dose.trim() || null : null,
      times: [...new Set(times.filter(Boolean))].sort(),
      weekdays: kind === 'weekly' ? [...weekdays].sort() : [],
      interval_days: kind === 'interval' ? Math.max(1, Math.min(365, intervalDays || 1)) : null,
      // Editing a daily or weekly routine keeps its start date; for one-time
      // and "every few days", the date is what you pick.
      start_date: kind === 'interval' || kind === 'once' ? startDate : routine?.start_date ?? today,
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

  const noun = category === 'care' ? (kind === 'once' ? 'task' : 'routine') : category === 'vet' ? 'vet visit' : category;

  return (
    <Sheet
      title={routine ? `Edit ${routine.title}` : fixedPet ? `New ${noun} for ${fixedPet.name}` : `New ${noun}`}
      onClose={onClose}
      footer={
        <button
          className="btn btn-primary btn-block"
          form="routine-form"
          disabled={busy || !pet || !title.trim() || (kind === 'weekly' && weekdays.length === 0)}
        >
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
              if (!routine && (c === 'vaccine' || c === 'vet') && kind === 'daily') {
                setKind('once');
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
          <Chips<ScheduleKind> label="How often" value={kind} onChange={setKind} options={KIND_OPTIONS} />
        </div>

        {kind === 'weekly' && (
          <div className="field">
            <span className="field-label">On these days</span>
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
            {weekdays.length === 0 && <span className="field-hint late">Pick at least one day.</span>}
          </div>
        )}

        {kind === 'interval' && (
          <div className="field-pair">
            <Field label="Every how many days">
              <input
                id="routine-interval"
                type="number"
                inputMode="numeric"
                min={1}
                max={365}
                value={intervalDays}
                onChange={(e) => setIntervalDays(Number(e.target.value))}
              />
            </Field>
            <Field label={dateLabel}>
              <input id="routine-start" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} required />
            </Field>
          </div>
        )}

        {kind === 'once' && (
          <Field label={dateLabel}>
            <input id="routine-once" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} required />
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
    </Sheet>
  );
}
