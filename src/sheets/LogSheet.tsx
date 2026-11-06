import { useState, type FormEvent } from 'react';
import { todayISO } from '../lib/dates';
import { QUICK_LOGS } from '../lib/pets';
import { useApp } from '../state';
import { Chips, Field, Sheet } from '../ui';

/** Log something that happened outside the routines: a bath, a treat, a vet visit. */
export function LogSheet({ presetPetId, presetDate, onClose }: { presetPetId?: string; presetDate?: string; onClose: () => void }) {
  const { snapshot, logAdhoc } = useApp();
  const today = todayISO();
  const [petId, setPetId] = useState(presetPetId ?? snapshot.pets[0]?.id ?? '');
  const [what, setWhat] = useState('');
  const [note, setNote] = useState('');
  const [date, setDate] = useState(presetDate && presetDate < today ? presetDate : today);

  async function save(e: FormEvent) {
    e.preventDefault();
    if (!petId || !what.trim()) return;
    onClose();
    await logAdhoc(petId, what.trim(), note.trim() || null, date);
  }

  return (
    <Sheet
      title="Log something"
      onClose={onClose}
      footer={
        <button className="btn btn-primary btn-block" form="log-form" disabled={!what.trim() || !petId}>
          Add to activity
        </button>
      }
    >
      <form id="log-form" className="stack" onSubmit={save}>
        {snapshot.pets.length > 1 && (
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
          <span className="field-label">What happened</span>
          <div className="chips">
            {QUICK_LOGS.map((q) => (
              <button type="button" key={q} className={`chip${what === q ? ' chip-on' : ''}`} onClick={() => setWhat(q)}>
                {q}
              </button>
            ))}
          </div>
          <input id="log-what" value={what} onChange={(e) => setWhat(e.target.value)} maxLength={60} placeholder="Or type your own" aria-label="What happened" />
        </div>
        <Field label="When">
          <input id="log-date" type="date" value={date} max={today} onChange={(e) => setDate(e.target.value || today)} />
        </Field>
        <Field label="Note">
          <textarea id="log-note" value={note} onChange={(e) => setNote(e.target.value)} rows={2} maxLength={500} placeholder="Optional" />
        </Field>
      </form>
    </Sheet>
  );
}
