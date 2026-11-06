import { useState, type FormEvent } from 'react';
import { dayPhrase, formatShortDate, todayISO } from '../lib/dates';
import {
  LASTS_CHOICES,
  SUPPLY_KINDS,
  describeSupply,
  isOrdered,
  needsOrder,
  openNewPatch,
  supplyEmoji,
  supplyFor,
  supplyStatus,
} from '../lib/supplies';
import type { Supply, SupplyInput, SupplyKind } from '../lib/types';
import { useApp } from '../state';
import { Chips, Field, Icons, Sheet, useToast } from '../ui';

const fmtDay = (iso: string) => dayPhrase(iso);

/** How much is left, as a bar. Always paired with the words in the row. */
export function SupplyMeter({ supply }: { supply: Supply }) {
  const st = supplyStatus(supply, todayISO());
  const tone = st.state === 'out' || st.state === 'order' ? 'alert' : st.state === 'soon' ? 'warn' : st.state === 'ordered' ? 'ordered' : 'ok';
  return (
    <span className={`meter meter-${tone}`} aria-hidden="true">
      <span style={{ width: `${Math.max(4, st.left * 100)}%` }} />
    </span>
  );
}

export function SupplyRow({ supply, onOpen, showWho = true }: { supply: Supply; onOpen: () => void; showWho?: boolean }) {
  const { snapshot } = useApp();
  const today = todayISO();
  const st = supplyStatus(supply, today);
  const urgent = st.state === 'order' || st.state === 'out';
  return (
    <li>
      <button className="row row-button supply-row" onClick={onOpen}>
        <span className="supply-emoji" aria-hidden="true">
          {supplyEmoji(supply.kind)}
        </span>
        <span className="row-text">
          <span className="row-title">{supply.name}</span>
          <SupplyMeter supply={supply} />
          <span className="row-meta">
            <span className="row-meta-text">
              {describeSupply(supply, today, fmtDay)}
              {showWho && supply.pet_ids.length > 0 ? `. For ${supplyFor(supply, snapshot.pets)}` : ''}
            </span>
            {urgent && <span className="turn turn-alert">Order now</span>}
            {st.state === 'ordered' && <span className="turn">Ordered</span>}
          </span>
        </span>
        <span className="chev" aria-hidden="true">
          {Icons.next}
        </span>
      </button>
    </li>
  );
}

/** The food and supplies list, for everyone or for one pet. */
export function SupplySection({ petId, title = 'Food and supplies' }: { petId?: string; title?: string }) {
  const { snapshot, openAdd } = useApp();
  const [open, setOpen] = useState<string | null>(null);
  const list = snapshot.supplies.filter((s) => !petId || !s.pet_ids.length || s.pet_ids.includes(petId));
  const opened = snapshot.supplies.find((s) => s.id === open);
  const today = todayISO();
  const sorted = [...list].sort((a, b) => supplyStatus(a, today).orderBy.localeCompare(supplyStatus(b, today).orderBy));

  return (
    <section className="group">
      <div className="group-head">
        <h2 className="group-label">{title}</h2>
        <button className="btn-text" onClick={() => openAdd({ kind: 'supply', petId })} disabled={snapshot.behind}>
          Add
        </button>
      </div>
      {snapshot.behind ? (
        <div className="empty empty-inline">
          <p>Food reminders need the latest database update. Whoever set up Herd can run update 003 from the README.</p>
        </div>
      ) : sorted.length === 0 ? (
        <div className="empty empty-inline">
          <p>Add a bag of food or box of litter and Herd tells everyone when it’s time to order more, before it runs out.</p>
        </div>
      ) : (
        <ul className="list">
          {sorted.map((s) => (
            <SupplyRow key={s.id} supply={s} onOpen={() => setOpen(s.id)} showWho={!petId} />
          ))}
        </ul>
      )}
      {opened && <SupplySheet supply={opened} onClose={() => setOpen(null)} />}
    </section>
  );
}

/** On Today: anything that needs ordering now, with a one-tap "I ordered it". */
export function SupplyBanner() {
  const { snapshot } = useApp();
  const [open, setOpen] = useState<string | null>(null);
  const today = todayISO();
  const due = snapshot.supplies.filter((s) => needsOrder(s, today));
  const opened = snapshot.supplies.find((s) => s.id === open);
  if (!due.length) return null;
  return (
    <section className="group" aria-label="Time to order">
      <ul className="list list-alert">
        {due.map((s) => (
          <SupplyRow key={s.id} supply={s} onOpen={() => setOpen(s.id)} />
        ))}
      </ul>
      {opened && <SupplySheet supply={opened} onClose={() => setOpen(null)} />}
    </section>
  );
}

/** A supply's details and the two things people do: order more, open a new one. */
export function SupplySheet({ supply, presetPetId, onClose }: { supply?: Supply; presetPetId?: string; onClose: () => void }) {
  const { backend, snapshot, run, me } = useApp();
  const toast = useToast();
  const [editing, setEditing] = useState(!supply);
  const today = todayISO();

  if (supply && !editing) {
    const st = supplyStatus(supply, today);
    const ordered = isOrdered(supply);
    const who = supply.pet_ids.length ? supplyFor(supply, snapshot.pets) : 'Everyone';
    return (
      <Sheet
        title={supply.name}
        onClose={onClose}
        footer={
          <div className="sheet-actions">
            {!ordered ? (
              <button
                className="btn btn-primary btn-block"
                onClick={async () => {
                  onClose();
                  await run(() => backend.updateSupply(supply.id, { ordered_on: today }), `Marked as ordered. Everyone will see it.`);
                }}
              >
                I ordered it
              </button>
            ) : null}
            <button
              className={`btn ${ordered ? 'btn-primary' : 'btn-quiet'} btn-block`}
              onClick={async () => {
                const { patch, learned } = openNewPatch(supply, today);
                onClose();
                await run(() => backend.updateSupply(supply.id, patch));
                toast(learned ? `New one opened. They’ve been lasting about ${learned} days, so Herd will plan for that.` : 'New one opened.');
              }}
            >
              We opened a new one
            </button>
          </div>
        }
      >
        <div className="stack">
          <div className="supply-hero">
            <SupplyMeter supply={supply} />
            <p className="muted">{describeSupply(supply, today, fmtDay)}.</p>
          </div>
          <dl className="facts">
            <div>
              <dt>For</dt>
              <dd>{who}</dd>
            </div>
            <div>
              <dt>Opened</dt>
              <dd>{fmtDay(supply.opened_on).replace(/^./, (c) => c.toUpperCase())}</dd>
            </div>
            <div>
              <dt>Lasts about</dt>
              <dd>{supply.lasts_days} days</dd>
            </div>
            <div>
              <dt>Runs out</dt>
              <dd>
                {st.daysLeft <= 0 ? 'Probably already out' : `Around ${formatShortDate(st.runOut)}`}
              </dd>
            </div>
            <div>
              <dt>Order by</dt>
              <dd>
                {formatShortDate(st.orderBy)} ({supply.lead_days} {supply.lead_days === 1 ? 'day' : 'days'} ahead)
              </dd>
            </div>
            {ordered && supply.ordered_on && (
              <div>
                <dt>Ordered</dt>
                <dd>{fmtDay(supply.ordered_on).replace(/^./, (c) => c.toUpperCase())}</dd>
              </div>
            )}
            {supply.notes && (
              <div>
                <dt>Notes</dt>
                <dd>{supply.notes}</dd>
              </div>
            )}
          </dl>
          <div className="text-actions">
            {supply.order_url && (
              <a className="btn-text" href={supply.order_url} target="_blank" rel="noreferrer">
                Open the order page
              </a>
            )}
            {ordered && (
              <button className="btn-text" onClick={() => run(() => backend.updateSupply(supply.id, { ordered_on: null }), 'Order cleared')}>
                Not ordered after all
              </button>
            )}
            <button className="btn-text" onClick={() => setEditing(true)}>
              Edit
            </button>
          </div>
          <p className="muted small">
            {me.notify_supplies
              ? 'With reminders on, everyone gets a nudge at 9 AM on the order-by day.'
              : 'You’ve turned off reorder reminders in Household.'}{' '}
            Tapping “We opened a new one” helps Herd learn how long one really lasts.
          </p>
        </div>
      </Sheet>
    );
  }

  return <SupplyForm supply={supply} presetPetId={presetPetId} onClose={onClose} />;
}

function SupplyForm({ supply, presetPetId, onClose }: { supply?: Supply; presetPetId?: string; onClose: () => void }) {
  const { backend, snapshot, run } = useApp();
  const today = todayISO();
  const pets = snapshot.pets;
  const [name, setName] = useState(supply?.name ?? '');
  const [kind, setKind] = useState<SupplyKind>(supply?.kind ?? 'food');
  const [petIds, setPetIds] = useState<string[]>(supply?.pet_ids ?? (presetPetId ? [presetPetId] : pets.length === 1 ? [pets[0].id] : []));
  const [opened, setOpened] = useState(supply?.opened_on ?? today);
  const [lasts, setLasts] = useState<number>(supply?.lasts_days ?? 30);
  const [lead, setLead] = useState<number>(supply?.lead_days ?? 5);
  const [url, setUrl] = useState(supply?.order_url ?? '');
  const [notes, setNotes] = useState(supply?.notes ?? '');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState(false);
  const cleanUrl = url.trim() ? (/^https?:\/\//i.test(url.trim()) ? url.trim() : `https://${url.trim()}`) : null;
  const valid = name.trim() && lasts >= 1 && lasts <= 365 && lead >= 0 && lead <= 60 && opened;

  async function save(e: FormEvent) {
    e.preventDefault();
    if (!valid) return;
    setBusy(true);
    const input: SupplyInput = {
      name: name.trim().slice(0, 60),
      kind,
      pet_ids: petIds,
      opened_on: opened,
      lasts_days: Math.round(lasts),
      lead_days: Math.round(lead),
      order_url: cleanUrl,
      notes: notes.trim() || null,
    };
    const ok = await run(async () => {
      if (supply) await backend.updateSupply(supply.id, input);
      else await backend.addSupply(snapshot.household.id, input);
      return true;
    }, supply ? 'Saved' : `Added ${input.name}`);
    setBusy(false);
    if (ok) onClose();
  }

  async function remove() {
    if (!supply) return;
    setBusy(true);
    const ok = await run(() => backend.deleteSupply(supply.id).then(() => true), `Removed ${supply.name}`);
    setBusy(false);
    if (ok) onClose();
  }

  const runOut = (() => {
    const st = supplyStatus({ ...(supply ?? ({} as Supply)), opened_on: opened, lasts_days: lasts || 1, lead_days: lead || 0, ordered_on: null }, today);
    return st;
  })();

  return (
    <Sheet
      title={supply ? `Edit ${supply.name}` : 'Add food or supplies'}
      onClose={onClose}
      footer={
        <button className="btn btn-primary btn-block" form="supply-form" disabled={busy || !valid}>
          {supply ? 'Save changes' : 'Add it'}
        </button>
      }
    >
      <form id="supply-form" className="stack" onSubmit={save}>
        <div className="field">
          <span className="field-label">What is it</span>
          <Chips<SupplyKind>
            label="What is it"
            value={kind}
            onChange={setKind}
            options={SUPPLY_KINDS.map((k) => ({ value: k.key, label: `${k.emoji} ${k.label}` }))}
          />
        </div>
        <Field label="Name">
          <input
            id="supply-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            maxLength={60}
            placeholder={kind === 'litter' ? 'Clumping litter, 40 lb' : kind === 'medication' ? 'Thyroid pills, 30 count' : 'Salmon kibble, 30 lb bag'}
            autoFocus={!supply}
          />
        </Field>
        {pets.length > 1 && (
          <div className="field">
            <span className="field-label">Who it’s for</span>
            <div className="chips" role="group" aria-label="Who it’s for">
              {pets.map((p) => (
                <button
                  type="button"
                  key={p.id}
                  aria-pressed={petIds.includes(p.id)}
                  className={`chip${petIds.includes(p.id) ? ' chip-on' : ''}`}
                  onClick={() => setPetIds(petIds.includes(p.id) ? petIds.filter((x) => x !== p.id) : [...petIds, p.id])}
                >
                  {p.emoji} {p.name}
                </button>
              ))}
            </div>
            <span className="field-hint">Leave them all off if everyone shares it.</span>
          </div>
        )}
        <Field label={supply ? 'Current one was opened' : 'When did you open the current one'}>
          <input id="supply-opened" type="date" value={opened} max={today} onChange={(e) => setOpened(e.target.value)} required />
        </Field>
        <div className="field">
          <span className="field-label">About how long does one last</span>
          <div className="chips">
            {LASTS_CHOICES.map((d) => (
              <button type="button" key={d} className={`chip${lasts === d ? ' chip-on' : ''}`} onClick={() => setLasts(d)}>
                {d % 30 === 0 && d >= 60 ? `${d / 30} months` : d % 7 === 0 ? `${d / 7} ${d === 7 ? 'week' : 'weeks'}` : `${d} days`}
              </button>
            ))}
          </div>
          <div className="inline-number">
            <input
              id="supply-lasts"
              type="number"
              inputMode="numeric"
              min={1}
              max={365}
              value={Number.isFinite(lasts) ? lasts : ''}
              onChange={(e) => setLasts(Number(e.target.value))}
              aria-label="Days one lasts"
            />
            <span>days</span>
          </div>
          <span className="field-hint">A guess is fine. Herd learns from the real dates each time you open a new one.</span>
        </div>
        <div className="field">
          <span className="field-label">Remind us to order</span>
          <div className="inline-number">
            <input
              id="supply-lead"
              type="number"
              inputMode="numeric"
              min={0}
              max={60}
              value={Number.isFinite(lead) ? lead : ''}
              onChange={(e) => setLead(Number(e.target.value))}
              aria-label="Days ahead to order"
            />
            <span>days before it runs out</span>
          </div>
          {valid && (
            <span className="field-hint">
              Runs out around {formatShortDate(runOut.runOut)}, so order by {formatShortDate(runOut.orderBy)}.
            </span>
          )}
        </div>
        <Field label="Where you order it" hint="Optional. A link to reorder in one tap.">
          <input id="supply-url" type="url" inputMode="url" value={url} onChange={(e) => setUrl(e.target.value)} maxLength={500} placeholder="chewy.com/..." />
        </Field>
        <Field label="Notes">
          <input id="supply-notes" value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={500} placeholder="The grain-free one, not the puppy formula" />
        </Field>
        {supply &&
          (confirmDelete ? (
            <div className="danger-zone">
              <p>Remove {supply.name}? Reminders for it stop.</p>
              <div className="btn-pair">
                <button type="button" className="btn btn-quiet" onClick={() => setConfirmDelete(false)}>
                  Keep it
                </button>
                <button type="button" className="btn btn-danger" onClick={remove} disabled={busy}>
                  Remove
                </button>
              </div>
            </div>
          ) : (
            <button type="button" className="btn-text btn-text-danger" onClick={() => setConfirmDelete(true)}>
              Remove this
            </button>
          ))}
      </form>
    </Sheet>
  );
}
