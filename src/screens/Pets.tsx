import { useMemo, useRef, useState, type FormEvent } from 'react';
import { daysBetween, formatShortDate, todayISO, weekdayShort } from '../lib/dates';
import { firstName, memberById } from '../lib/people';
import { CATEGORIES, EMOJI_CHOICES, ROUTINE_TEMPLATES, SPECIES, defaultEmoji, speciesLabel, type Template } from '../lib/pets';
import { photoToDataUrl } from '../lib/photo';
import { describeSchedule } from '../lib/schedule';
import type { Category, Pet, PetInput, Routine, RoutineInput, ScheduleKind, Species, Weight } from '../lib/types';
import { useApp } from '../state';
import { CategoryMark, Chips, Field, Icons, PetAvatar, Sheet } from '../ui';

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
            const rs = snapshot.routines.filter((r) => r.pet_id === p.id && r.active);
            const meds = rs.filter((r) => r.category === 'medication').length;
            const parts = [speciesLabel(p.species), rs.length === 1 ? '1 routine' : `${rs.length} routines`];
            if (meds) parts.push(meds === 1 ? '1 medication' : `${meds} medications`);
            return (
              <li key={p.id}>
                <button className="row row-button" onClick={() => setOpenPetId(p.id)}>
                  <PetAvatar emoji={p.emoji} photo={p.photo} size="lg" />
                  <span className="row-text">
                    <span className="row-title row-title-lg">{p.name}</span>
                    <span className="row-meta">{parts.join(', ')}</span>
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

const SECTIONS: { title: string; categories: Category[]; add: string; preset: Category }[] = [
  { title: 'Care routines', categories: ['care'], add: 'Add routine', preset: 'care' },
  { title: 'Medications', categories: ['medication'], add: 'Add medication', preset: 'medication' },
  { title: 'Vaccines and vet visits', categories: ['vaccine', 'vet'], add: 'Add', preset: 'vaccine' },
];

function PetDetail({ pet, onBack }: { pet: Pet; onBack: () => void }) {
  const { snapshot } = useApp();
  const [editingPet, setEditingPet] = useState(false);
  const [routineSheet, setRoutineSheet] = useState<{ routine: Routine | null; preset: Category } | null>(null);
  const [weighing, setWeighing] = useState(false);
  const routines = snapshot.routines.filter((r) => r.pet_id === pet.id);
  const weights = snapshot.weights.filter((w) => w.pet_id === pet.id).sort((a, b) => a.weighed_on.localeCompare(b.weighed_on));

  return (
    <>
      <header className="screen-head">
        <button className="back-btn" onClick={onBack}>
          {Icons.back}
          <span>Pets</span>
        </button>
        <div className="pet-hero">
          <PetAvatar emoji={pet.emoji} photo={pet.photo} size="xl" />
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

      {SECTIONS.map((sec) => {
        const list = routines.filter((r) => sec.categories.includes(r.category));
        if (sec.preset !== 'care' && !list.length) {
          return (
            <section key={sec.title} className="group">
              <div className="group-head">
                <h2 className="group-label">{sec.title}</h2>
                <button className="btn-text" onClick={() => setRoutineSheet({ routine: null, preset: sec.preset })}>
                  {sec.add}
                </button>
              </div>
            </section>
          );
        }
        return (
          <section key={sec.title} className="group">
            <div className="group-head">
              <h2 className="group-label">{sec.title}</h2>
              <button className="btn-text" onClick={() => setRoutineSheet({ routine: null, preset: sec.preset })}>
                {sec.add}
              </button>
            </div>
            {list.length === 0 ? (
              <div className="empty empty-inline">
                <p>No routines for {pet.name} yet.</p>
              </div>
            ) : (
              <ul className="list">
                {list.map((r) => (
                  <RoutineRow key={r.id} routine={r} onOpen={() => setRoutineSheet({ routine: r, preset: r.category })} />
                ))}
              </ul>
            )}
          </section>
        );
      })}

      <section className="group">
        <div className="group-head">
          <h2 className="group-label">Weight</h2>
          <button className="btn-text" onClick={() => setWeighing(true)}>
            Log weight
          </button>
        </div>
        {weights.length > 0 && <WeightPanel weights={weights} />}
      </section>

      {editingPet && <PetSheet pet={pet} onClose={() => setEditingPet(false)} onDeleted={onBack} onSaved={() => setEditingPet(false)} />}
      {routineSheet && (
        <RoutineSheet pet={pet} routine={routineSheet.routine} preset={routineSheet.preset} onClose={() => setRoutineSheet(null)} />
      )}
      {weighing && <WeightSheet pet={pet} last={weights[weights.length - 1]} onClose={() => setWeighing(false)} />}
    </>
  );
}

function RoutineRow({ routine: r, onOpen }: { routine: Routine; onOpen: () => void }) {
  const { snapshot } = useApp();
  const who = memberById(snapshot.members, r.assignee);
  const past = r.kind === 'once' && daysBetween(todayISO(), r.start_date) < 0;
  return (
    <li>
      <button className={`row row-button${r.active && !past ? '' : ' row-paused'}`} onClick={onOpen}>
        <span className="row-text">
          <span className="row-title">
            <CategoryMark category={r.category} />
            {r.title}
          </span>
          <span className="row-meta">
            <span className="row-meta-text">
              {r.active ? describeSchedule(r) : 'Paused'}
              {r.dose ? `, ${r.dose}` : ''}
            </span>
            {who && <span className="turn">{firstName(who.display_name)}</span>}
          </span>
        </span>
        <span className="chev" aria-hidden="true">
          {Icons.next}
        </span>
      </button>
    </li>
  );
}

/* ---------- Weight ---------- */

function WeightPanel({ weights }: { weights: Weight[] }) {
  const { backend, run } = useApp();
  const [showAll, setShowAll] = useState(false);
  const unit = weights[weights.length - 1].unit;
  const same = weights.filter((w) => w.unit === unit);
  const last = same[same.length - 1];
  const first = same[0];
  const change = Math.round((last.weight - first.weight) * 10) / 10;
  const list = [...weights].reverse();
  return (
    <div className="panel stack">
      <div className="weight-head">
        <p className="weight-now">
          {fmt(last.weight)} <span>{unit}</span>
        </p>
        {same.length > 1 && (
          <p className="muted small">
            {change === 0 ? 'No change' : `${change > 0 ? 'Up' : 'Down'} ${fmt(Math.abs(change))} ${unit}`} since{' '}
            {formatShortDate(first.weighed_on)}
          </p>
        )}
      </div>
      {same.length > 1 && <WeightChart weights={same} />}
      <ul className="weight-list">
        {(showAll ? list : list.slice(0, 4)).map((w) => (
          <li key={w.id}>
            <span>{formatShortDate(w.weighed_on)}{w.weighed_on.slice(0, 4) !== todayISO().slice(0, 4) ? `, ${w.weighed_on.slice(0, 4)}` : ''}</span>
            <span className="weight-val">
              {fmt(w.weight)} {w.unit}
            </span>
            <button
              className="btn-text btn-text-small"
              onClick={() => run(() => backend.deleteWeight(w.id), 'Weight removed')}
              aria-label={`Remove ${fmt(w.weight)} ${w.unit} from ${formatShortDate(w.weighed_on)}`}
            >
              Remove
            </button>
          </li>
        ))}
      </ul>
      {list.length > 4 && (
        <button className="btn-text" onClick={() => setShowAll(!showAll)}>
          {showAll ? 'Show fewer' : `Show all ${list.length}`}
        </button>
      )}
    </div>
  );
}

const fmt = (n: number) => (Math.round(n * 10) / 10).toString();

/** A round step (0.5, 1, 2, 5, 10…) close to `raw`, for axis ticks. */
function niceStep(raw: number): number {
  const pow = 10 ** Math.floor(Math.log10(raw));
  const f = raw / pow;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * pow;
}

/** A small trend line: one series, faint grid, emphasized latest point, tap a point for its value. */
function WeightChart({ weights }: { weights: Weight[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const W = 320;
  const H = 120;
  const pad = { l: 34, r: 12, t: 12, b: 22 };
  const t0 = Date.parse(weights[0].weighed_on);
  const t1 = Date.parse(weights[weights.length - 1].weighed_on);
  const span = Math.max(1, t1 - t0);
  const vals = weights.map((w) => w.weight);
  const lo = Math.min(...vals);
  const hi = Math.max(...vals);
  const step = niceStep(Math.max(hi - lo, 0.5) / 2);
  const yMin = Math.floor(lo / step) * step - (lo % step === 0 ? step : 0);
  const yMax = Math.ceil(hi / step) * step + (hi % step === 0 ? step : 0);
  const x = (iso: string) => pad.l + ((Date.parse(iso) - t0) / span) * (W - pad.l - pad.r);
  const y = (v: number) => pad.t + (1 - (v - yMin) / (yMax - yMin)) * (H - pad.t - pad.b);
  const pts = weights.map((w) => [x(w.weighed_on), y(w.weight)] as const);
  const path = pts.map(([px, py], i) => `${i ? 'L' : 'M'}${px.toFixed(1)},${py.toFixed(1)}`).join(' ');
  const ticks: number[] = [];
  for (let t = yMin; t <= yMax + 1e-9; t += step) ticks.push(Math.round(t * 100) / 100);
  const active = hover ?? weights.length - 1;

  return (
    <div className="weight-chart">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Weight from ${fmt(vals[0])} to ${fmt(vals[vals.length - 1])} ${weights[0].unit}`}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={pad.l} x2={W - pad.r} y1={y(t)} y2={y(t)} className="wc-grid" />
            <text x={pad.l - 6} y={y(t) + 4} className="wc-axis" textAnchor="end">
              {fmt(t)}
            </text>
          </g>
        ))}
        <text x={pad.l} y={H - 4} className="wc-axis">
          {formatShortDate(weights[0].weighed_on)}
        </text>
        <text x={W - pad.r} y={H - 4} className="wc-axis" textAnchor="end">
          {formatShortDate(weights[weights.length - 1].weighed_on)}
        </text>
        <path d={path} className="wc-line" />
        {pts.map(([px, py], i) => (
          <g key={weights[i].id}>
            <circle cx={px} cy={py} r={i === active ? 5 : 3} className={i === active ? 'wc-point wc-point-on' : 'wc-point'} />
            <circle
              cx={px}
              cy={py}
              r={14}
              className="wc-hit"
              onMouseEnter={() => setHover(i)}
              onMouseLeave={() => setHover(null)}
              onClick={() => setHover(i)}
            />
          </g>
        ))}
      </svg>
      <div className="wc-tip" aria-live="polite">
        <strong>
          {fmt(weights[active].weight)} {weights[active].unit}
        </strong>{' '}
        {formatShortDate(weights[active].weighed_on)}
      </div>
    </div>
  );
}

function WeightSheet({ pet, last, onClose }: { pet: Pet; last?: Weight; onClose: () => void }) {
  const { backend, snapshot, run } = useApp();
  const [weight, setWeight] = useState('');
  const [unit, setUnit] = useState<'lb' | 'kg'>(last?.unit ?? 'lb');
  const [date, setDate] = useState(todayISO());
  const [note, setNote] = useState('');
  const n = Number(weight);
  const valid = weight.trim() !== '' && n > 0 && n < 5000;

  async function save(e: FormEvent) {
    e.preventDefault();
    if (!valid) return;
    const ok = await run(
      () => backend.addWeight(snapshot.household.id, { pet_id: pet.id, weight: n, unit, weighed_on: date, note: note.trim() || null }).then(() => true),
      'Weight saved',
    );
    if (ok) onClose();
  }

  return (
    <Sheet
      title={`Log ${pet.name}’s weight`}
      onClose={onClose}
      footer={
        <button className="btn btn-primary btn-block" form="weight-form" disabled={!valid}>
          Save weight
        </button>
      }
    >
      <form id="weight-form" className="stack" onSubmit={save}>
        <div className="field-pair">
          <Field label="Weight">
            <input
              id="weight-value"
              type="number"
              inputMode="decimal"
              step="0.1"
              min="0.1"
              value={weight}
              onChange={(e) => setWeight(e.target.value)}
              placeholder={last ? fmt(last.weight) : ''}
              autoFocus
            />
          </Field>
          <div className="field">
            <span className="field-label">Unit</span>
            <Chips<'lb' | 'kg'> label="Unit" value={unit} onChange={setUnit} options={[{ value: 'lb', label: 'lb' }, { value: 'kg', label: 'kg' }]} />
          </div>
        </div>
        <Field label="Date">
          <input id="weight-date" type="date" value={date} max={todayISO()} onChange={(e) => setDate(e.target.value)} required />
        </Field>
        <Field label="Note">
          <input id="weight-note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={200} placeholder="At the vet, after a bath…" />
        </Field>
      </form>
    </Sheet>
  );
}

/* ---------- Add / edit a pet ---------- */

interface CustomTask {
  title: string;
  time: string;
}

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
  const [photo, setPhoto] = useState<string | null>(pet?.photo ?? null);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const [notes, setNotes] = useState(pet?.notes ?? '');
  const [picked, setPicked] = useState<Set<number>>(() => new Set(ROUTINE_TEMPLATES.dog.map((_, i) => i)));
  const [custom, setCustom] = useState<CustomTask[]>([]);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const templates = ROUTINE_TEMPLATES[species];
  const hid = snapshot.household.id;
  const today = todayISO();

  function chooseSpecies(s: Species) {
    if (emoji === defaultEmoji(species)) setEmoji(defaultEmoji(s));
    setSpecies(s);
    setPicked(new Set(ROUTINE_TEMPLATES[s].map((_, i) => i)));
  }

  async function onFile(file: File | undefined) {
    if (!file) return;
    setPhotoError(null);
    try {
      setPhoto(await photoToDataUrl(file));
    } catch (e) {
      setPhotoError((e as Error).message);
    }
  }

  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    const input: PetInput = { name: name.trim(), species, emoji, notes: notes.trim() || null, photo };
    const id = await run(async () => {
      if (pet) {
        await backend.updatePet(pet.id, input);
        return pet.id;
      }
      const created = await backend.addPet(hid, input);
      const chosen: Template[] = [...picked].sort().map((i) => templates[i]);
      for (const c of custom) {
        if (!c.title.trim()) continue;
        chosen.push({
          title: c.title.trim().slice(0, 60),
          kind: 'daily',
          category: 'care',
          dose: null,
          times: c.time ? [c.time] : [],
          weekdays: [],
          interval_days: null,
        });
      }
      for (const t of chosen) {
        await backend.addRoutine(hid, { ...t, pet_id: created.id, start_date: today, assignee: null, notes: null });
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
        <div className="photo-pick">
          <PetAvatar emoji={emoji} photo={photo} size="xl" />
          <div className="stack-tight">
            <button type="button" className="btn btn-quiet btn-small" onClick={() => fileRef.current?.click()}>
              {Icons.camera}
              {photo ? 'Change photo' : 'Add a photo'}
            </button>
            {photo && (
              <button type="button" className="btn-text btn-text-small" onClick={() => setPhoto(null)}>
                Remove photo
              </button>
            )}
            <input
              ref={fileRef}
              id="pet-photo"
              type="file"
              accept="image/*"
              hidden
              onChange={(e) => {
                onFile(e.target.files?.[0]);
                e.target.value = '';
              }}
            />
          </div>
        </div>
        {photoError && <p className="form-error">{photoError}</p>}

        <Field label="Name">
          <input id="pet-name" value={name} onChange={(e) => setName(e.target.value)} required maxLength={40} autoFocus={!pet} />
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
        {!photo && (
          <div className="field">
            <span className="field-label">Icon</span>
            <div className="emoji-grid" role="radiogroup" aria-label="Icon">
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
        )}

        {!pet && (
          <fieldset className="field templates">
            <legend className="field-label">Start with these routines</legend>
            <span className="field-hint">
              Uncheck any you don’t need, or add your own. You can change times, assign people, and add medications later.
            </span>
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
                    {describeSchedule({ ...(t as Routine), start_date: today, active: true }).replace(/, due today$/, '')}
                  </span>
                </span>
              </label>
            ))}
            {custom.map((c, i) => (
              <div className="custom-task" key={i}>
                <input
                  id={`custom-title-${i}`}
                  value={c.title}
                  onChange={(e) => setCustom(custom.map((x, j) => (j === i ? { ...x, title: e.target.value } : x)))}
                  maxLength={60}
                  placeholder="Task name"
                  aria-label={`Your task ${i + 1}`}
                  autoFocus={!c.title}
                />
                <input
                  id={`custom-time-${i}`}
                  type="time"
                  value={c.time}
                  onChange={(e) => setCustom(custom.map((x, j) => (j === i ? { ...x, time: e.target.value } : x)))}
                  aria-label={`Time for your task ${i + 1}`}
                />
                <button type="button" className="icon-btn" onClick={() => setCustom(custom.filter((_, j) => j !== i))} aria-label="Remove this task">
                  {Icons.close}
                </button>
              </div>
            ))}
            <button type="button" className="btn-text" onClick={() => setCustom([...custom, { title: '', time: '' }])}>
              Add your own task
            </button>
            {custom.length > 0 && <span className="field-hint">Your tasks repeat every day. Leave the time empty for “any time”.</span>}
          </fieldset>
        )}

        <Field label="Notes" hint="Feeding amounts, allergies, the vet’s number. Everyone in the household and any sitter sees this.">
          <textarea id="pet-notes" value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} maxLength={1000} />
        </Field>

        {pet &&
          (confirmDelete ? (
            <div className="danger-zone">
              <p>Remove {pet.name} and all of {pet.name}’s routines, weights and history? This can’t be undone.</p>
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
  { value: 'once', label: 'One time' },
];

const PLACEHOLDERS: Record<Category, string> = {
  care: 'Breakfast, evening walk, brush teeth…',
  medication: 'Heartworm chewable, thyroid pill…',
  vaccine: 'Rabies, distemper, bordetella…',
  vet: 'Annual checkup, dental cleaning…',
};

function RoutineSheet({
  pet,
  routine,
  preset,
  onClose,
}: {
  pet: Pet;
  routine: Routine | null;
  preset: Category;
  onClose: () => void;
}) {
  const { backend, snapshot, run } = useApp();
  const today = todayISO();
  const startKind: ScheduleKind = routine?.kind ?? (preset === 'vaccine' || preset === 'vet' ? 'once' : 'daily');
  const [category, setCategory] = useState<Category>(routine?.category ?? preset);
  const [title, setTitle] = useState(routine?.title ?? '');
  const [dose, setDose] = useState(routine?.dose ?? '');
  const [kind, setKind] = useState<ScheduleKind>(startKind);
  const [times, setTimes] = useState<string[]>(
    routine?.times ?? (preset === 'vaccine' ? [] : preset === 'vet' ? ['10:00'] : ['08:00']),
  );
  const [weekdays, setWeekdays] = useState<number[]>(routine?.weekdays.length ? routine.weekdays : [1, 3, 5]);
  const [intervalDays, setIntervalDays] = useState<number>(routine?.interval_days ?? (preset === 'vaccine' ? 365 : 7));
  const [startDate, setStartDate] = useState(routine?.start_date ?? today);
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

  const noun = category === 'care' ? 'routine' : category === 'vet' ? 'vet visit' : category;

  return (
    <Sheet
      title={routine ? `Edit ${routine.title}` : `New ${noun} for ${pet.name}`}
      onClose={onClose}
      footer={
        <button
          className="btn btn-primary btn-block"
          form="routine-form"
          disabled={busy || !title.trim() || (kind === 'weekly' && weekdays.length === 0)}
        >
          {routine ? 'Save changes' : `Add ${noun}`}
        </button>
      }
    >
      <form id="routine-form" className="stack" onSubmit={save}>
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
