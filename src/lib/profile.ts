import { daysBetween, formatTime } from './dates';
import { speciesLabel } from './pets';
import type { Pet, Routine } from './types';

/** "Dog", or what the owner typed for an "other" pet ("Hedgehog"). */
export function kindOf(pet: Pick<Pet, 'species' | 'species_label'>): string {
  if (pet.species === 'other' && pet.species_label?.trim()) return pet.species_label.trim();
  return speciesLabel(pet.species);
}

/** "6 years", "8 months", "3 weeks". */
export function ageText(birthday: string | null, today: string): string | null {
  if (!birthday) return null;
  const days = daysBetween(birthday, today);
  if (days < 0) return null;
  const [by, bm, bd] = birthday.split('-').map(Number);
  const [ty, tm, td] = today.split('-').map(Number);
  const months = (ty - by) * 12 + (tm - bm) - (td < bd ? 1 : 0);
  if (months >= 24) return `${Math.floor(months / 12)} years`;
  if (months >= 12) return months === 12 ? '1 year' : `1 year, ${months - 12} ${months - 12 === 1 ? 'month' : 'months'}`;
  if (months >= 1) return `${months} ${months === 1 ? 'month' : 'months'}`;
  const weeks = Math.floor(days / 7);
  return weeks >= 1 ? `${weeks} ${weeks === 1 ? 'week' : 'weeks'}` : `${days} ${days === 1 ? 'day' : 'days'}`;
}

/** "Male, neutered", "Female, spayed", "Spayed or neutered". */
export function sexText(pet: Pick<Pet, 'sex' | 'fixed'>): string | null {
  const fixedWord = pet.sex === 'female' ? 'spayed' : pet.sex === 'male' ? 'neutered' : 'spayed or neutered';
  const sex = pet.sex === 'female' ? 'Female' : pet.sex === 'male' ? 'Male' : '';
  if (sex && pet.fixed) return `${sex}, ${fixedWord}`;
  if (sex && pet.fixed === false) return `${sex}, not ${fixedWord}`;
  if (sex) return sex;
  if (pet.fixed) return fixedWord.replace(/^./, (c) => c.toUpperCase());
  return null;
}

/** One line under a pet's name: "Lab mix, 6 years, male". */
export function petSubtitle(pet: Pet, today: string): string {
  const parts = [pet.breed?.trim() || kindOf(pet)];
  const age = ageText(pet.birthday, today);
  if (age) parts.push(age);
  if (pet.sex) parts.push(pet.sex);
  return parts.join(', ');
}

const MEAL = /breakfast|dinner|supper|lunch|feed|meal|food|kibble|hay/i;

/** Care routines that look like meals, for "when do they eat". */
export function mealRoutines(pet: Pick<Pet, 'id'>, routines: Routine[]): Routine[] {
  return routines.filter((r) => r.pet_id === pet.id && r.active && r.category === 'care' && MEAL.test(r.title));
}

function listWords(items: string[]): string {
  if (items.length <= 1) return items.join('');
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

/** "7:00 AM and 6:00 PM", or null if no meal has a time. */
export function mealTimes(pet: Pick<Pet, 'id'>, routines: Routine[]): string | null {
  const times = [...new Set(mealRoutines(pet, routines).flatMap((r) => (r.kind === 'daily' ? r.times : [])))].sort();
  return times.length ? listWords(times.map(formatTime)) : null;
}

/** The short feeding line on a pet card: "2 cups at 7:00 AM and 6:00 PM". */
export function feedingLine(pet: Pet, routines: Routine[]): string | null {
  const times = mealTimes(pet, routines);
  const amount = pet.food_amount?.trim();
  if (amount && times) return `${amount} at ${times}`;
  if (amount) return `${amount} per meal`;
  if (times) return `Meals at ${times}`;
  return null;
}

export const hasVet = (p: Pet) => !!(p.vet_clinic || p.vet_name || p.vet_phone || p.vet_address);
export const hasFeeding = (p: Pet) => !!(p.food || p.food_amount || p.feeding_notes);

/** Turns "chicken, beef\nwheat" into ["chicken", "beef", "wheat"]. */
export function parseList(text: string): string[] {
  const out: string[] = [];
  for (const raw of text.split(/[,\n;]/)) {
    const v = raw.trim().slice(0, 60);
    if (v && !out.some((x) => x.toLowerCase() === v.toLowerCase())) out.push(v);
  }
  return out.slice(0, 20);
}

/** A tel: link that works from a typed number like "(718) 555-0142". */
export const telHref = (phone: string) => `tel:${phone.replace(/[^\d+]/g, '')}`;

/** Opens the address in Apple Maps on iPhone (Google Maps elsewhere via redirect). */
export const mapsHref = (address: string) => `https://maps.apple.com/?q=${encodeURIComponent(address)}`;

/** The last emoji typed into a box, or null if there isn't one. */
export function lastEmoji(text: string): string | null {
  const parts: string[] = [];
  try {
    type Seg = { segment: (t: string) => Iterable<{ segment: string }> };
    const Segmenter = (Intl as unknown as { Segmenter: new (l?: string, o?: { granularity: string }) => Seg }).Segmenter;
    for (const s of new Segmenter(undefined, { granularity: 'grapheme' }).segment(text)) parts.push(s.segment);
  } catch {
    parts.push(...Array.from(text));
  }
  for (let i = parts.length - 1; i >= 0; i--) {
    if (/\p{Extended_Pictographic}|\p{Regional_Indicator}/u.test(parts[i])) return parts[i];
  }
  return null;
}
