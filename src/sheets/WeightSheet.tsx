import { useState, type FormEvent } from 'react';
import { todayISO } from '../lib/dates';
import type { Pet, Weight } from '../lib/types';
import { useApp } from '../state';
import { Chips, Field, Sheet } from '../ui';

const fmt = (n: number) => (Math.round(n * 10) / 10).toString();

export function WeightSheet({ pet, last, onClose }: { pet: Pet; last?: Weight; onClose: () => void }) {
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
