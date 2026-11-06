import type { Category, RoutineInput, Species } from './types';

export const SPECIES: { key: Species; label: string; emoji: string }[] = [
  { key: 'dog', label: 'Dog', emoji: '🐕' },
  { key: 'cat', label: 'Cat', emoji: '🐈' },
  { key: 'bird', label: 'Bird', emoji: '🐦' },
  { key: 'fish', label: 'Fish', emoji: '🐠' },
  { key: 'reptile', label: 'Reptile', emoji: '🦎' },
  { key: 'small_mammal', label: 'Small pet', emoji: '🐹' },
  { key: 'horse', label: 'Horse', emoji: '🐴' },
  { key: 'other', label: 'Other', emoji: '🐾' },
];

export const EMOJI_CHOICES = ['🐕', '🐩', '🐈', '🐈‍⬛', '🐦', '🦜', '🐠', '🐟', '🦎', '🐢', '🐍', '🐹', '🐇', '🐭', '🐴', '🐐', '🐔', '🐾'];

export function speciesLabel(s: Species): string {
  return SPECIES.find((x) => x.key === s)?.label ?? 'Pet';
}

export function defaultEmoji(s: Species): string {
  return SPECIES.find((x) => x.key === s)?.emoji ?? '🐾';
}

export type Template = Omit<RoutineInput, 'pet_id' | 'start_date' | 'assignee' | 'notes'>;

const daily = (title: string, ...times: string[]): Template => ({
  title,
  kind: 'daily',
  category: 'care',
  dose: null,
  times,
  weekdays: [],
  interval_days: null,
  repeat_every: 1,
});

const every = (title: string, days: number, ...times: string[]): Template => ({
  title,
  kind: 'interval',
  category: 'care',
  dose: null,
  times,
  weekdays: [],
  interval_days: days,
  repeat_every: 1,
});

const medEvery = (title: string, days: number): Template => ({ ...every(title, days), category: 'medication' });

/** Starting suggestions shown when a pet is added. Every one is editable. */
export const ROUTINE_TEMPLATES: Record<Species, Template[]> = {
  dog: [
    daily('Breakfast', '07:00'),
    daily('Dinner', '18:00'),
    daily('Morning walk', '07:30'),
    daily('Evening walk', '20:00'),
    medEvery('Flea and tick prevention', 30),
  ],
  cat: [daily('Breakfast', '07:00'), daily('Dinner', '18:00'), daily('Scoop litter box'), daily('Fresh water')],
  bird: [daily('Food and water', '08:00'), every('Clean cage', 7)],
  fish: [daily('Feed', '08:00'), every('Water change', 7)],
  reptile: [daily('Fresh water'), every('Feed', 3), every('Clean enclosure', 7)],
  small_mammal: [daily('Food and water', '08:00'), every('Clean cage', 7)],
  horse: [daily('Morning feed', '07:00'), daily('Evening feed', '17:00'), daily('Muck out stall')],
  other: [daily('Feed', '08:00'), daily('Fresh water')],
};

export const QUICK_LOGS = ['Treat', 'Bath', 'Brushed', 'Nail trim', 'Medicine', 'Vet visit', 'Played'];

export const CATEGORIES: { key: Category; label: string; plural: string }[] = [
  { key: 'care', label: 'Care', plural: 'Care routines' },
  { key: 'medication', label: 'Medication', plural: 'Medications' },
  { key: 'vaccine', label: 'Vaccine', plural: 'Vaccines' },
  { key: 'vet', label: 'Vet visit', plural: 'Vet visits' },
];

export function categoryLabel(c: Category): string {
  return CATEGORIES.find((x) => x.key === c)?.label ?? 'Care';
}
