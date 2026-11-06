import { addDays, daysBetween } from './dates';
import type { Pet, Supply, SupplyKind, SupplyPatch } from './types';

// When to order more food (or litter, or meds). A bag opened on `opened_on`
// lasts about `lasts_days`; order `lead_days` before it runs out. Each time
// someone opens a new one, the old date goes into `restocks`, and Herd uses
// the real gaps to get better at guessing how long one lasts.
//
// The dates here mirror supplyDates() in the reminder function; a test checks
// the two agree.

export const SUPPLY_KINDS: { key: SupplyKind; label: string; emoji: string }[] = [
  { key: 'food', label: 'Food', emoji: '🥣' },
  { key: 'treats', label: 'Treats', emoji: '🦴' },
  { key: 'litter', label: 'Litter', emoji: '🪣' },
  { key: 'medication', label: 'Medication', emoji: '💊' },
  { key: 'other', label: 'Other', emoji: '📦' },
];

export const supplyEmoji = (k: SupplyKind) => SUPPLY_KINDS.find((x) => x.key === k)?.emoji ?? '📦';

/** Starting guesses for "how long does one last", in days. */
export const LASTS_CHOICES = [7, 14, 21, 30, 45, 60, 90];

export type SupplyState =
  /** Plenty left. */
  | 'ok'
  /** Order-by date is within 3 days. */
  | 'soon'
  /** Past the order-by date and nobody has ordered. */
  | 'order'
  /** Someone ordered more and it hasn't been opened yet. */
  | 'ordered'
  /** Should have run out by now. */
  | 'out';

export interface SupplyStatus {
  runOut: string;
  orderBy: string;
  /** Days until it runs out (negative once past). */
  daysLeft: number;
  /** About how much is left, 0 to 1. */
  left: number;
  state: SupplyState;
}

export const isOrdered = (s: Pick<Supply, 'ordered_on' | 'opened_on'>) => !!s.ordered_on && s.ordered_on >= s.opened_on;

export function supplyStatus(s: Supply, today: string): SupplyStatus {
  const runOut = addDays(s.opened_on, s.lasts_days);
  const orderBy = addDays(runOut, -s.lead_days);
  const daysLeft = daysBetween(today, runOut);
  const left = Math.max(0, Math.min(1, daysLeft / Math.max(1, s.lasts_days)));
  let state: SupplyState;
  if (isOrdered(s)) state = 'ordered';
  else if (daysLeft <= 0) state = 'out';
  else if (today >= orderBy) state = 'order';
  else if (daysBetween(today, orderBy) <= 3) state = 'soon';
  else state = 'ok';
  return { runOut, orderBy, daysLeft, left, state };
}

/** Supplies someone should act on now: past the order-by date and not ordered. */
export const needsOrder = (s: Supply, today: string) => {
  const st = supplyStatus(s, today).state;
  return st === 'order' || st === 'out';
};

/** In words, for a list row: "About 4 days left, order by Nov 9". */
export function describeSupply(s: Supply, today: string, fmtDay: (iso: string) => string): string {
  const st = supplyStatus(s, today);
  const left =
    st.daysLeft <= 0 ? 'Probably out by now' : st.daysLeft === 1 ? 'About 1 day left' : `About ${st.daysLeft} days left`;
  switch (st.state) {
    case 'ordered':
      return `${left}. Ordered ${fmtDay(s.ordered_on!)}`;
    case 'out':
    case 'order':
      return `${left}. Time to order more`;
    default:
      return `${left}. Order by ${fmtDay(st.orderBy)}`;
  }
}

/** Gaps in days between the opened dates we know about, newest last. */
export function restockGaps(s: Pick<Supply, 'restocks' | 'opened_on'>): number[] {
  const dates = [...s.restocks, s.opened_on].sort();
  const gaps: number[] = [];
  for (let i = 1; i < dates.length; i++) gaps.push(daysBetween(dates[i - 1], dates[i]));
  return gaps.filter((g) => g > 0);
}

/**
 * What changes when someone opens a new one today: the old date is kept,
 * the order is cleared, and "how long it lasts" follows the real gaps
 * (average of the last three, ignoring any that look like a forgotten tap).
 */
export function openNewPatch(s: Supply, today: string): { patch: SupplyPatch; learned: number | null } {
  const restocks = [...s.restocks, s.opened_on].filter((d) => d < today).slice(-20);
  const gaps = restockGaps({ restocks, opened_on: today })
    .filter((g) => g >= s.lasts_days / 2 && g <= s.lasts_days * 2)
    .slice(-3);
  const learned = gaps.length ? Math.round(gaps.reduce((a, b) => a + b, 0) / gaps.length) : null;
  const lasts = learned && Math.abs(learned - s.lasts_days) >= 2 ? Math.max(1, Math.min(365, learned)) : s.lasts_days;
  return {
    patch: { restocks, opened_on: today, ordered_on: null, lasts_days: lasts },
    learned: lasts !== s.lasts_days ? lasts : null,
  };
}

/** "Biscuit", "Biscuit and Olive", or "everyone". */
export function supplyFor(s: Supply, pets: Pick<Pet, 'id' | 'name'>[]): string {
  if (!s.pet_ids.length) return 'everyone';
  const names = s.pet_ids.map((id) => pets.find((p) => p.id === id)?.name).filter(Boolean) as string[];
  if (!names.length) return 'everyone';
  return names.length <= 2 ? names.join(' and ') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}
