import { useEffect, useState } from 'react';
import { addDays, dayPhrase, daysBetween, formatClock, formatShortDate, localDayOf, todayISO } from '../lib/dates';
import { firstName, memberById } from '../lib/people';
import { ageText, petSubtitle, sexText, telHref } from '../lib/profile';
import { describeSchedule } from '../lib/schedule';
import type { Category, Pet, Routine, TaskLog, Weight } from '../lib/types';
import { CareSheetButton } from '../parts/CareSheetButton';
import { PetDropdown, PetQuickInfo, type PetSection } from '../parts/PetInfo';
import { SupplySection } from '../parts/Supplies';
import { foodOrderUrl } from '../lib/supplies';
import { PetSheet } from '../sheets/PetSheet';
import { RoutineSheet } from '../sheets/RoutineSheet';
import { WeightSheet } from '../sheets/WeightSheet';
import { CheckoffSheet } from '../sheets/CheckoffSheet';
import { useApp, whoDid } from '../state';
import { CategoryMark, Icons, PetAvatar } from '../ui';

export function PetsScreen({ openPetId, setOpenPetId }: { openPetId: string | null; setOpenPetId: (id: string | null) => void }) {
  const { snapshot, openAdd, openMap } = useApp();
  const openPet = snapshot.pets.find((p) => p.id === openPetId);

  if (openPet) return <PetDetail pet={openPet} onBack={() => setOpenPetId(null)} />;

  const routes = snapshot.places.filter((p) => p.kind === 'route');
  const spots = snapshot.places.length - routes.length;

  return (
    <>
      <header className="screen-head screen-head-row">
        <h1 className="screen-title">Pets</h1>
        <button className="btn btn-primary btn-small" onClick={() => openAdd({ kind: 'pet' })}>
          Add pet
        </button>
      </header>
      {snapshot.pets.length === 0 ? (
        <div className="empty">
          <p>No pets yet. Add one and you’ll get suggested routines to start from.</p>
          <button className="btn btn-primary" onClick={() => openAdd({ kind: 'pet' })}>
            Add your first pet
          </button>
        </div>
      ) : (
        <>
          <section className="group">
            <div className="list">
              {snapshot.pets.map((p) => (
                <PetDropdown
                  key={p.id}
                  pet={p}
                  routines={snapshot.routines}
                  orderHref={foodOrderUrl(p, snapshot.supplies)}
                  onOpen={() => setOpenPetId(p.id)}
                >
                  <button className="btn btn-quiet btn-small" onClick={() => setOpenPetId(p.id)}>
                    Full profile
                  </button>
                  <CareSheetButton pets={[p]} />
                </PetDropdown>
              ))}
            </div>
            <p className="footnote">Tap the arrow for feeding, allergies and the vet. Tap a name for everything else.</p>
          </section>

          <SupplySection />

          <section className="group">
            <h2 className="group-label">Walks</h2>
            <ul className="list">
              <li>
                <button className="row row-button" onClick={openMap}>
                  <span className="add-mark">{Icons.map}</span>
                  <span className="row-text">
                    <span className="row-title">Walk map</span>
                    <span className="row-meta">
                      {snapshot.places.length
                        ? [
                            routes.length ? `${routes.length} ${routes.length === 1 ? 'route' : 'routes'}` : '',
                            spots ? `${spots} saved ${spots === 1 ? 'spot' : 'spots'}` : '',
                          ]
                            .filter(Boolean)
                            .join(' and ') + ', plus public poop bag spots'
                        : 'Save your usual routes and parks, and find public poop bag spots'}
                    </span>
                  </span>
                  <span className="chev" aria-hidden="true">
                    {Icons.next}
                  </span>
                </button>
              </li>
            </ul>
          </section>

          <section className="group">
            <h2 className="group-label">Care sheets</h2>
            <div className="panel stack-tight">
              <p className="muted small">
                A printable PDF with feeding, allergies, routines, medications and the vet, for a sitter, boarding or the fridge.
              </p>
              <CareSheetButton pets={snapshot.pets}>{snapshot.pets.length === 1 ? 'Make the care sheet' : 'All pets in one PDF'}</CareSheetButton>
            </div>
          </section>
        </>
      )}
    </>
  );
}

const SECTIONS: { title: string; categories: Category[]; add: string; preset: Category }[] = [
  { title: 'Care routines', categories: ['care'], add: 'Add routine', preset: 'care' },
  { title: 'Medications', categories: ['medication'], add: 'Add medication', preset: 'medication' },
  { title: 'Vaccines and vet visits', categories: ['vaccine', 'vet'], add: 'Add', preset: 'vaccine' },
];

/** How many days apart a routine comes up, roughly. */
const cadenceDays = (r: Routine) =>
  r.kind === 'interval' ? r.interval_days ?? 1 : r.kind === 'monthly' ? 31 * (r.repeat_every ?? 1) : r.kind === 'weekly' ? 7 * (r.repeat_every ?? 1) : 1;

function PetDetail({ pet, onBack }: { pet: Pet; onBack: () => void }) {
  const { snapshot, openMap, loadHistory } = useApp();
  // Monthly and every-few-weeks medications need older history to show when they were last given.
  const longest = Math.max(0, ...snapshot.routines.filter((r) => r.pet_id === pet.id && r.category === 'medication' && r.active).map(cadenceDays));
  useEffect(() => {
    if (longest > 10) loadHistory(addDays(todayISO(), -Math.min(400, longest + 7)));
  }, [longest, loadHistory]);
  const [editing, setEditing] = useState<{ focus?: PetSection } | null>(null);
  const [routineSheet, setRoutineSheet] = useState<{ routine: Routine | null; preset: Category } | null>(null);
  const [weighing, setWeighing] = useState(false);
  const routines = snapshot.routines.filter((r) => r.pet_id === pet.id);
  const weights = snapshot.weights.filter((w) => w.pet_id === pet.id).sort((a, b) => a.weighed_on.localeCompare(b.weighed_on));
  const today = todayISO();
  const age = ageText(pet.birthday, today);
  const sex = sexText(pet);

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
            <p className="muted">{petSubtitle(pet, today)}</p>
          </div>
          <button className="btn btn-quiet btn-small" onClick={() => setEditing({})}>
            Edit
          </button>
        </div>
        <div className="quick-actions">
          <CareSheetButton pets={[pet]} />
          <button className="btn btn-quiet btn-small" onClick={openMap}>
            {Icons.map}
            Walk map
          </button>
          {pet.vet_phone && (
            <a className="btn btn-quiet btn-small" href={telHref(pet.vet_phone)}>
              {Icons.phone}
              Call the vet
            </a>
          )}
        </div>
      </header>

      <section className="group">
        <div className="group-head">
          <h2 className="group-label">Profile</h2>
          <button className="btn-text" onClick={() => setEditing({ focus: 'feeding' })}>
            Edit profile
          </button>
        </div>
        <div className="panel">
          <PetQuickInfo
            pet={pet}
            routines={snapshot.routines}
            onEdit={(focus) => setEditing({ focus })}
            orderHref={foodOrderUrl(pet, snapshot.supplies)}
          />
        </div>
        {(pet.breed || age || sex || pet.microchip) && (
          <dl className="facts facts-gap">
            {pet.breed && (
              <div>
                <dt>Breed</dt>
                <dd>{pet.breed}</dd>
              </div>
            )}
            {age && (
              <div>
                <dt>Age</dt>
                <dd>
                  {age}
                  {pet.birthday ? <span className="muted">, born {formatShortDate(pet.birthday)}, {pet.birthday.slice(0, 4)}</span> : null}
                </dd>
              </div>
            )}
            {sex && (
              <div>
                <dt>Sex</dt>
                <dd>{sex}</dd>
              </div>
            )}
            {pet.microchip && (
              <div>
                <dt>Microchip</dt>
                <dd className="mono-num">{pet.microchip}</dd>
              </div>
            )}
          </dl>
        )}
      </section>

      {SECTIONS.map((sec) => {
        const list = routines.filter((r) => sec.categories.includes(r.category));
        return (
          <section key={sec.title} className="group">
            <div className="group-head">
              <h2 className="group-label">{sec.title}</h2>
              <button className="btn-text" onClick={() => setRoutineSheet({ routine: null, preset: sec.preset })}>
                {sec.add}
              </button>
            </div>
            {list.length === 0 ? (
              sec.preset === 'care' ? (
                <div className="empty empty-inline">
                  <p>No routines for {pet.name} yet.</p>
                </div>
              ) : null
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

      <SupplySection petId={pet.id} title={`${pet.name}’s food and supplies`} />

      <section className="group">
        <div className="group-head">
          <h2 className="group-label">Weight</h2>
          <button className="btn-text" onClick={() => setWeighing(true)}>
            Log weight
          </button>
        </div>
        {weights.length > 0 && <WeightPanel weights={weights} />}
      </section>

      {editing && (
        <PetSheet pet={pet} focus={editing.focus} onClose={() => setEditing(null)} onDeleted={onBack} onSaved={() => setEditing(null)} />
      )}
      {routineSheet && (
        <RoutineSheet pet={pet} routine={routineSheet.routine} preset={routineSheet.preset} onClose={() => setRoutineSheet(null)} />
      )}
      {weighing && <WeightSheet pet={pet} last={weights[weights.length - 1]} onClose={() => setWeighing(false)} />}
    </>
  );
}

function RoutineRow({ routine: r, onOpen }: { routine: Routine; onOpen: () => void }) {
  const { snapshot, logs, me } = useApp();
  const [editing, setEditing] = useState<TaskLog | null>(null);
  const who = memberById(snapshot.members, r.assignee);
  const past = r.kind === 'once' && daysBetween(todayISO(), r.start_date) < 0;
  // Medications show when they were last given, and that time can be fixed right here.
  const last =
    r.category === 'medication'
      ? logs.filter((l) => l.routine_id === r.id && l.status === 'done').sort((a, b) => b.done_at.localeCompare(a.done_at))[0]
      : undefined;
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
      {last && (
        <button className="last-given" onClick={() => setEditing(last)}>
          <span>
            Last given {dayPhrase(localDayOf(last.done_at))} at {formatClock(last.done_at)} by {whoDid(last, snapshot.members, me.user_id)}
          </span>
          <span className="row-edit">{last.done_by === me.user_id ? 'Change' : 'Details'}</span>
        </button>
      )}
      {editing && <CheckoffSheet log={editing} onClose={() => setEditing(null)} />}
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
