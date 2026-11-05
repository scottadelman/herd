import { useState, type FormEvent } from 'react';
import { todayISO, weekdayShort } from '../lib/dates';
import { firstName, memberById } from '../lib/people';
import { EMOJI_CHOICES, ROUTINE_TEMPLATES, SPECIES, defaultEmoji, speciesLabel } from '../lib/pets';
import { describeSchedule } from '../lib/schedule';
import type { Pet, PetInput, Routine, RoutineInput, ScheduleKind, Species } from '../lib/types';
import { useApp } from '../state';
import { Chips, Field, Icons, PetAvatar, Sheet } from '../ui';

export function PetsScreen() {
  const { snapshot } = useApp();
  const [openPetId, setOpenPetId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const openPet = snapshot.pets.find((p) => p.id === openPetId);

  if (openPet) return <PetDetail pet={openPet} onBack={() => setOpenPetId(null)} />;

  return (
    <>
      <header className="screen-head screen-head-row">
        <h1 className="screen-title">Pets</h1>
        <button className="btn btn-primary btn-small" onClick={() => setAdding(true)}>
          Add pet
        </button>
      </header>
      {snapshot.pets.length === 0 ? (
        <div className="empty">
          <p>No pets yet. Add one and you’ll get suggested routines to start from.</p>
          <button className="btn btn-primary" onClick={() => setAdding(true)}>
            Add your first pet
          </button>
        </div>
      ) : (
        <ul className="list">
          {snapshot.pets.map((p) => {
            const count = snapshot.routines.filter((r) => r.pet_id === p.id && r.active).length;
            return (
              <li key={p.id}>
                <button className="row row-button" onClick={() => setOpenPetId(p.id)}>
                  <PetAvatar emoji={p.emoji} size="lg" />
                  <span className="row-text">
                    <span className="row-title row-title-lg">{p.name}</span>
                    <span className="row-meta">
                      {speciesLabel(p.species)}, {count === 1 ? '1 routine' : `${count} routines`}
                    </span>
                  </span>
                  <span className="chev" aria-hidden="true">
                    {Icons.next}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {adding && (
        <PetSheet
          onClose={() => setAdding(false)}
          onSaved={(id) => {
            setAdding(false);
            setOpenPetId(id);
          }}
        />
      )}
    </>
  );
}

function PetDetail({ pet, onBack }: { pet: Pet; onBack: () => void }) {
  const { snapshot } = useApp();
  const [editingPet, setEditingPet] = useState(false);
  const [routineSheet, setRoutineSheet] = useState<Routine | 'new' | null>(null);
  const routines = snapshot.routines.filter((r) => r.pet_id === pet.id);

  return (
    <>
      <header className="screen-head">
        <button className="back-btn" onClick={onBack}>
          {Icons.back}
          <span>Pets</span>
        </button>
        <div className="pet-hero">
          <PetAvatar emoji={pet.emoji} size="lg" />
          <div>
            <h1 className="screen-title">{pet.name}</h1>
            <p className="muted">{speciesLabel(pet.species)}</p>
          </div>
          <button className="btn btn-quiet btn-small" onClick={() => setEditingPet(true)}>
            Edit
          </button>
        </div>
        {pet.notes && <p className="pet-notes">{pet.notes}</p>}
      </header>

      <section className="group">
        <div className="group-head">
          <h2 className="group-label">Routines</h2>
          <button className="btn-text" onClick={() => setRoutineSheet('new')}>
            Add routine
          </button>
        </div>
        {routines.length === 0 ? (
          <div className="empty empty-inline">
            <p>No routines for {pet.name} yet.</p>
          </div>
        ) : (
          <ul className="list">
            {routines.map((r) => {
              const who = memberById(snapshot.members, r.assignee);
              return (
                <li key={r.id}>
                  <button className={`row row-button${r.active ? '' : ' row-paused'}`} onClick={() => setRoutineSheet(r)}>
                    <span className="row-text">
                      <span className="row-title">{r.title}</span>
                      <span className="row-meta">
                        {r.active ? describeSchedule(r) : 'Paused'}
                        {who && <span className="turn">{firstName(who.display_name)}</span>}
                      </span>
                    </span>
                    <span className="chev" aria-hidden="true">
                      {Icons.next}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {editingPet && <PetSheet pet={pet} onClose={() => setEditingPet(false)} onDeleted={onBack} onSaved={() => setEditingPet(false)} />}
      {routineSheet && (
        <RoutineSheet pet={pet} routine={routineSheet === 'new' ? null : routineSheet} onClose={() => setRoutineSheet(null)} />
      )}
    </>
  );
}

/* ---------- Add / edit a pet ---------- */

function PetSheet({
  pet,
  onClose,
  onSaved,
  onDeleted,
}: {
  pet?: Pet;
  onClose: () => void;
  onSaved: (id: string) => void;
  onDeleted?: () => void;
}) {
  const { backend, snapshot, run } = useApp();
  const [name, setName] = useState(pet?.name ?? '');
  const [species, setSpecies] = useState<Species>(pet?.species ?? 'dog');
  const [emoji, setEmoji] = useState(pet?.emoji ?? defaultEmoji('dog'));
  const [notes, setNotes] = useState(pet?.notes ?? '');
  const [picked, setPicked] = useState<Set<number>>(() => new Set(ROUTINE_TEMPLATES.dog.map((_, i) => i)));
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState(false);
  const templates = ROUTINE_TEMPLATES[species];
  const hid = snapshot.household.id;

  function chooseSpecies(s: Species) {
    if (emoji === defaultEmoji(species)) setEmoji(defaultEmoji(s));
    setSpecies(s);
    setPicked(new Set(ROUTINE_TEMPLATES[s].map((_, i) => i)));
  }

  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    const input: PetInput = { name: name.trim(), species, emoji, notes: notes.trim() || null };
    const id = await run(async () => {
      if (pet) {
        await backend.updatePet(pet.id, input);
        return pet.id;
      }
      const created = await backend.addPet(hid, input);
      const start = todayISO();
      for (const i of [...picked].sort()) {
        const t = templates[i];
        await backend.addRoutine(hid, { ...t, pet_id: created.id, start_date: start, assignee: null, notes: null });
      }
      return created.id;
    }, pet ? 'Saved' : `Added ${input.name}`);
    setBusy(false);
    if (id) onSaved(id);
  }

  async function remove() {
    if (!pet) return;
    setBusy(true);
    const ok = await run(() => backend.deletePet(pet.id).then(() => true), `Removed ${pet.name}`);
    setBusy(false);
    if (ok) {
      onClose();
      onDeleted?.();
    }
  }

  return (
    <Sheet
      title={pet ? `Edit ${pet.name}` : 'Add a pet'}
      onClose={onClose}
      footer={
        <button className="btn btn-primary btn-block" form="pet-form" disabled={busy || !name.trim()}>
          {pet ? 'Save changes' : name.trim() ? `Add ${name.trim()}` : 'Add pet'}
        </button>
      }
    >
      <form id="pet-form" className="stack" onSubmit={save}>
        <Field label="Name">
          <input value={name} onChange={(e) => setName(e.target.value)} required maxLength={40} autoFocus={!pet} />
        </Field>
        <div className="field">
          <span className="field-label">Kind of pet</span>
          <Chips<Species>
            label="Kind of pet"
            value={species}
            onChange={chooseSpecies}
            options={SPECIES.map((s) => ({ value: s.key, label: s.label }))}
          />
        </div>
        <div className="field">
          <span className="field-label">Picture</span>
          <div className="emoji-grid" role="radiogroup" aria-label="Picture">
            {EMOJI_CHOICES.map((e) => (
              <button
                type="button"
                key={e}
                role="radio"
                aria-checked={emoji === e}
                className={`emoji-choice${emoji === e ? ' emoji-on' : ''}`}
                onClick={() => setEmoji(e)}
              >
                {e}
              </button>
            ))}
          </div>
        </div>
        {!pet && (
          <fieldset className="field templates">
            <legend className="field-label">Start with these routines</legend>
            <span className="field-hint">Uncheck any you don’t need. You can change times later.</span>
            {templates.map((t, i) => (
              <label key={t.title} className="check-row">
                <input
                  type="checkbox"
                  checked={picked.has(i)}
                  onChange={(e) => {
                    const next = new Set(picked);
                    if (e.target.checked) next.add(i);
                    else next.delete(i);
                    setPicked(next);
                  }}
                />
                <span>
                  {t.title}
                  <span className="muted">
                    {' '}
                    {describeSchedule({ ...(t as Routine), start_date: todayISO(), active: true }).replace(/, due today$/, '')}
                  </span>
                </span>
              </label>
            ))}
          </fieldset>
        )}

        <Field label="Notes" hint="Feeding amounts, allergies, the vet’s number. Everyone in the household sees this.">
          <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} maxLength={1000} />
        </Field>


        {pet &&
          (confirmDelete ? (
            <div className="danger-zone">
              <p>Remove {pet.name} and all of {pet.name}’s routines and history? This can’t be undone.</p>
              <div className="btn-pair">
                <button type="button" className="btn btn-quiet" onClick={() => setConfirmDelete(false)}>
                  Keep {pet.name}
                </button>
                <button type="button" className="btn btn-danger" onClick={remove} disabled={busy}>
                  Remove {pet.name}
                </button>
              </div>
            </div>
          ) : (
            <button type="button" className="btn-text btn-text-danger" onClick={() => setConfirmDelete(true)}>
              Remove {pet.name}
            </button>
          ))}
      </form>
    </Sheet>
  );
}

/* ---------- Add / edit a routine ---------- */

const KIND_OPTIONS: { value: ScheduleKind; label: string }[] = [
  { value: 'daily', label: 'Every day' },
  { value: 'weekly', label: 'Some days' },
  { value: 'interval', label: 'Every few days' },
];

function RoutineSheet({ pet, routine, onClose }: { pet: Pet; routine: Routine | null; onClose: () => void }) {
  const { backend, snapshot, run } = useApp();
  const [title, setTitle] = useState(routine?.title ?? '');
  const [kind, setKind] = useState<ScheduleKind>(routine?.kind ?? 'daily');
  const [times, setTimes] = useState<string[]>(routine?.times ?? ['08:00']);
  const [weekdays, setWeekdays] = useState<number[]>(routine?.weekdays.length ? routine.weekdays : [1, 3, 5]);
  const [intervalDays, setIntervalDays] = useState<number>(routine?.interval_days ?? 7);
  const [startDate, setStartDate] = useState(routine?.start_date ?? todayISO());
  const [assignee, setAssignee] = useState<string>(routine?.assignee ?? '');
  const [notes, setNotes] = useState(routine?.notes ?? '');
  const [active, setActive] = useState(routine?.active ?? true);
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  async function save(e: FormEvent) {
    e.preventDefault();
    if (kind === 'weekly' && weekdays.length === 0) return;
    setBusy(true);
    const input: RoutineInput & { active?: boolean } = {
      pet_id: pet.id,
      title: title.trim(),
      kind,
      times: [...new Set(times.filter(Boolean))].sort(),
      weekdays: kind === 'weekly' ? [...weekdays].sort() : [],
      interval_days: kind === 'interval' ? Math.max(1, Math.min(365, intervalDays || 1)) : null,
      // Editing a routine shouldn't rewrite when it started, except for
      // "every few days", where the start date anchors the cycle.
      start_date: kind === 'interval' ? startDate : routine?.start_date ?? todayISO(),
      assignee: assignee || null,
      notes: notes.trim() || null,
    };
    const ok = await run(async () => {
      if (routine) await backend.updateRoutine(routine.id, { ...input, active } as RoutineInput);
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

  return (
    <Sheet
      title={routine ? `Edit ${routine.title}` : `New routine for ${pet.name}`}
      onClose={onClose}
      footer={
        <button
          className="btn btn-primary btn-block"
          form="routine-form"
          disabled={busy || !title.trim() || (kind === 'weekly' && weekdays.length === 0)}
        >
          {routine ? 'Save changes' : 'Add routine'}
        </button>
      }
    >
      <form id="routine-form" className="stack" onSubmit={save}>
        <Field label="What needs doing">
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            required
            maxLength={60}
            placeholder="Breakfast, evening walk, heartworm pill…"
            autoFocus={!routine}
          />
        </Field>

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
                  onClick={() =>
                    setWeekdays(weekdays.includes(d) ? weekdays.filter((x) => x !== d) : [...weekdays, d])
                  }
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
                type="number"
                inputMode="numeric"
                min={1}
                max={365}
                value={intervalDays}
                onChange={(e) => setIntervalDays(Number(e.target.value))}
              />
            </Field>
            <Field label="Next one is due">
              <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} required />
            </Field>
          </div>
        )}

        <div className="field">
          <span className="field-label">Time of day</span>
          {times.length === 0 ? (
            <p className="muted small">Any time of day</p>
          ) : (
            times.map((t, i) => (
              <div className="time-row" key={i}>
                <input
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
            options={[
              { value: '', label: 'Anyone' },
              ...snapshot.members.map((m) => ({ value: m.user_id, label: firstName(m.display_name) })),
            ]}
          />
        </div>

        <Field label="Notes">
          <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} maxLength={500} placeholder="Half a cup, mixed with water" />
        </Field>

        {routine && (
          <label className="check-row">
            <input type="checkbox" checked={!active} onChange={(e) => setActive(!e.target.checked)} />
            <span>
              Pause this routine
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
                  Delete routine
                </button>
              </div>
            </div>
          ) : (
            <button type="button" className="btn-text btn-text-danger" onClick={() => setConfirmDelete(true)}>
              Delete routine
            </button>
          ))}
      </form>
    </Sheet>
  );
}
