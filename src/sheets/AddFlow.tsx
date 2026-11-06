import { useState, type ReactNode } from 'react';
import { formatDayLabel, todayISO } from '../lib/dates';
import type { Category, ScheduleKind } from '../lib/types';
import { SupplySheet } from '../parts/Supplies';
import { useApp, type AddPreset } from '../state';
import { CategoryMark, Icons, Sheet } from '../ui';
import { LogSheet } from './LogSheet';
import { PetSheet } from './PetSheet';
import { RoutineSheet } from './RoutineSheet';

type Step =
  | { kind: 'menu' }
  | { kind: 'routine'; category: Category; schedule?: ScheduleKind }
  | { kind: 'log' }
  | { kind: 'supply' }
  | { kind: 'pet' };

/**
 * The one Add button, used from Today, the calendar and the Pets tab:
 * pick what to add, then fill in that form.
 */
export function AddFlow({ preset, onClose }: { preset: AddPreset; onClose: () => void }) {
  const { snapshot, viewPet } = useApp();
  const date = 'date' in preset ? preset.date : undefined;
  const petId = 'petId' in preset ? preset.petId : undefined;
  const [step, setStep] = useState<Step>(() => {
    switch (preset.kind) {
      case 'event':
        return { kind: 'routine', category: 'care', schedule: 'once' };
      case 'routine':
        return { kind: 'routine', category: preset.category ?? 'care' };
      case 'log':
        return { kind: 'log' };
      case 'supply':
        return { kind: 'supply' };
      case 'pet':
        return { kind: 'pet' };
      default:
        return snapshot.pets.length ? { kind: 'menu' } : { kind: 'pet' };
    }
  });
  const pet = snapshot.pets.find((p) => p.id === petId);
  const today = todayISO();
  const past = !!date && date < today;

  if (step.kind === 'routine') {
    return (
      <RoutineSheet
        pet={pet}
        routine={null}
        preset={step.category}
        presetKind={step.schedule}
        presetDate={step.schedule === 'once' || step.category === 'vet' || step.category === 'vaccine' ? date : undefined}
        onClose={onClose}
      />
    );
  }
  if (step.kind === 'log') return <LogSheet presetPetId={petId} presetDate={date} onClose={onClose} />;
  if (step.kind === 'supply') return <SupplySheet presetPetId={petId} onClose={onClose} />;
  if (step.kind === 'pet') {
    return (
      <PetSheet
        onClose={onClose}
        onSaved={(id) => {
          onClose();
          viewPet(id);
        }}
      />
    );
  }

  const day = date && date !== today ? formatDayLabel(date, today) : null;
  const options: { key: string; title: string; hint: string; mark: ReactNode; go: () => void; hide?: boolean }[] = [
    {
      key: 'event',
      title: 'Appointment or one-time task',
      hint: day ? `On ${day}. Grooming, a playdate, a pickup.` : 'Grooming, a playdate, a pickup. Shows on the calendar.',
      mark: <span className="add-mark">{Icons.calendar}</span>,
      go: () => setStep({ kind: 'routine', category: 'care', schedule: 'once' }),
      hide: past,
    },
    {
      key: 'vet',
      title: 'Vet visit',
      hint: 'Checkups, dental cleanings, follow-ups.',
      mark: <CategoryMark category="vet" />,
      go: () => setStep({ kind: 'routine', category: 'vet' }),
      hide: past,
    },
    {
      key: 'vaccine',
      title: 'Vaccine due',
      hint: 'Rabies, distemper, bordetella. Set it to repeat yearly if you like.',
      mark: <CategoryMark category="vaccine" />,
      go: () => setStep({ kind: 'routine', category: 'vaccine' }),
      hide: past,
    },
    {
      key: 'med',
      title: 'Medication',
      hint: 'With a dose, every day or every few weeks.',
      mark: <CategoryMark category="medication" />,
      go: () => setStep({ kind: 'routine', category: 'medication' }),
      hide: past,
    },
    {
      key: 'routine',
      title: 'Everyday routine',
      hint: 'A walk, a meal, brushing. Shows on Today.',
      mark: <span className="add-mark">{Icons.today}</span>,
      go: () => setStep({ kind: 'routine', category: 'care', schedule: 'daily' }),
      hide: past,
    },
    {
      key: 'log',
      title: past ? `Something that happened on ${day}` : 'Something that happened',
      hint: 'A bath, a treat, a nail trim. Goes in Activity.',
      mark: <span className="add-mark">{Icons.activity}</span>,
      go: () => setStep({ kind: 'log' }),
    },
    {
      key: 'supply',
      title: 'Food or supplies',
      hint: 'Herd says when it’s time to order more.',
      mark: <span className="add-mark" aria-hidden="true">🥣</span>,
      go: () => setStep({ kind: 'supply' }),
      hide: snapshot.behind,
    },
    {
      key: 'pet',
      title: 'A pet',
      hint: 'With a photo, feeding, allergies and the vet.',
      mark: <span className="add-mark">{Icons.paw}</span>,
      go: () => setStep({ kind: 'pet' }),
      hide: !!date,
    },
  ];

  return (
    <Sheet title={day ? `Add to ${day}` : 'Add'} onClose={onClose}>
      <ul className="list add-list">
        {options
          .filter((o) => !o.hide)
          .map((o) => (
            <li key={o.key}>
              <button className="row row-button" onClick={o.go}>
                {o.mark}
                <span className="row-text">
                  <span className="row-title">{o.title}</span>
                  <span className="row-meta">{o.hint}</span>
                </span>
                <span className="chev" aria-hidden="true">
                  {Icons.next}
                </span>
              </button>
            </li>
          ))}
      </ul>
    </Sheet>
  );
}
