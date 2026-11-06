import { describe, expect, it } from 'vitest';
import { describeSupply, openNewPatch, restockGaps, supplyFor, supplyStatus } from './supplies';
import type { Supply } from './types';

const s = (over: Partial<Supply> = {}): Supply => ({
  id: 's1',
  household_id: 'h1',
  name: 'Salmon kibble',
  kind: 'food',
  pet_ids: [],
  opened_on: '2026-10-13',
  lasts_days: 28,
  lead_days: 5,
  ordered_on: null,
  restocks: [],
  order_url: null,
  notes: null,
  created_by: null,
  created_at: '',
  ...over,
});

describe('supplyStatus', () => {
  it('works out when it runs out and when to order', () => {
    const st = supplyStatus(s(), '2026-10-30');
    expect(st).toMatchObject({ runOut: '2026-11-10', orderBy: '2026-11-05', daysLeft: 11, state: 'ok' });
    expect(supplyStatus(s(), '2026-11-02').state).toBe('soon');
    expect(supplyStatus(s(), '2026-11-05').state).toBe('order');
    expect(supplyStatus(s(), '2026-11-10').state).toBe('out');
  });
  it('knows when someone already ordered', () => {
    expect(supplyStatus(s({ ordered_on: '2026-11-04' }), '2026-11-06').state).toBe('ordered');
    // An order from before this bag was opened doesn't count.
    expect(supplyStatus(s({ ordered_on: '2026-10-01' }), '2026-11-06').state).toBe('order');
  });
  it('describes itself', () => {
    const fmt = (d: string) => d.slice(5);
    expect(describeSupply(s(), '2026-10-30', fmt)).toBe('About 11 days left. Order by 11-05');
    expect(describeSupply(s(), '2026-11-06', fmt)).toBe('About 4 days left. Time to order more');
  });
});

describe('opening a new one', () => {
  it('keeps the old date, clears the order, and learns how long it really lasts', () => {
    const first = openNewPatch(s({ ordered_on: '2026-11-04' }), '2026-11-07');
    expect(first.patch).toEqual({ restocks: ['2026-10-13'], opened_on: '2026-11-07', ordered_on: null, lasts_days: 25 });
    expect(first.learned).toBe(25);
  });
  it('ignores a gap that looks like a forgotten tap', () => {
    const res = openNewPatch(s({ restocks: ['2026-09-15'] }), '2026-12-20');
    expect(res.patch.lasts_days).toBe(28);
    expect(res.learned).toBeNull();
  });
  it('averages the last few gaps', () => {
    expect(restockGaps(s({ restocks: ['2026-08-23', '2026-09-18'] }))).toEqual([26, 25]);
    expect(openNewPatch(s({ restocks: ['2026-08-23', '2026-09-18'] }), '2026-11-07').learned).toBe(25);
    // Close enough to the current guess: leave it alone.
    expect(openNewPatch(s({ restocks: ['2026-08-20', '2026-09-16'] }), '2026-11-09').learned).toBeNull();
  });
});

it('says who a supply is for', () => {
  const pets = [{ id: 'a', name: 'Biscuit' }, { id: 'b', name: 'Olive' }, { id: 'c', name: 'Kiwi' }];
  expect(supplyFor(s(), pets)).toBe('everyone');
  expect(supplyFor(s({ pet_ids: ['a', 'b'] }), pets)).toBe('Biscuit and Olive');
  expect(supplyFor(s({ pet_ids: ['a', 'b', 'c'] }), pets)).toBe('Biscuit, Olive and Kiwi');
});
