import { describe, expect, it } from 'vitest';
import { pdfText } from './careSheet';
import { formatDistance, routeLength } from './geo';
import { ageText, feedingLine, kindOf, lastEmoji, parseList, sexText } from './profile';
import { parseOverpass } from './publicSpots';
import { EMPTY_PROFILE, type Pet, type Routine } from './types';

const pet = (over: Partial<Pet> = {}): Pet => ({
  ...EMPTY_PROFILE,
  id: 'p1',
  household_id: 'h',
  name: 'Loki',
  species: 'dog',
  emoji: '🐕',
  notes: null,
  photo: null,
  created_at: '',
  ...over,
});

const meal = (title: string, times: string[]): Routine => ({
  id: title,
  household_id: 'h',
  pet_id: 'p1',
  title,
  kind: 'daily',
  category: 'care',
  dose: null,
  times,
  weekdays: [],
  interval_days: null,
  start_date: '2026-01-01',
  assignee: null,
  notes: null,
  active: true,
  created_at: '',
});

describe('pet profiles', () => {
  it('say what kind of pet, in the owner’s words for "other"', () => {
    expect(kindOf(pet())).toBe('Dog');
    expect(kindOf(pet({ species: 'other', species_label: 'Hedgehog' }))).toBe('Hedgehog');
    expect(kindOf(pet({ species: 'other', species_label: '  ' }))).toBe('Other');
  });
  it('work out an age', () => {
    expect(ageText('2020-04-02', '2026-11-05')).toBe('6 years');
    expect(ageText('2025-08-20', '2026-11-05')).toBe('1 year, 2 months');
    expect(ageText('2026-03-10', '2026-11-05')).toBe('7 months');
    expect(ageText('2026-10-20', '2026-11-05')).toBe('2 weeks');
    expect(ageText(null, '2026-11-05')).toBeNull();
  });
  it('describe sex and spay/neuter', () => {
    expect(sexText(pet({ sex: 'male', fixed: true }))).toBe('Male, neutered');
    expect(sexText(pet({ sex: 'female', fixed: false }))).toBe('Female, not spayed');
    expect(sexText(pet({ fixed: true }))).toBe('Spayed or neutered');
  });
  it('sum up feeding from the amount and meal times', () => {
    const routines = [meal('Breakfast', ['07:00']), meal('Dinner', ['18:00']), meal('Evening walk', ['20:00'])];
    expect(feedingLine(pet({ food_amount: '2 cups' }), routines)).toBe('2 cups at 7:00 AM and 6:00 PM');
    expect(feedingLine(pet({ food_amount: '2 cups' }), [])).toBe('2 cups per meal');
    expect(feedingLine(pet(), routines)).toBe('Meals at 7:00 AM and 6:00 PM');
  });
  it('split typed lists', () => {
    expect(parseList('Golden retrievers, baths\nskateboards, Baths')).toEqual(['Golden retrievers', 'baths', 'skateboards']);
  });
  it('take the last emoji typed, including multi-part ones', () => {
    expect(lastEmoji('🐕🦔')).toBe('🦔');
    expect(lastEmoji('hi 🐈‍⬛')).toBe('🐈‍⬛');
    expect(lastEmoji('🇺🇸')).toBe('🇺🇸');
    expect(lastEmoji('abc')).toBeNull();
  });
});

describe('walk map', () => {
  it('measures routes', () => {
    // About 1.1 km north
    const r = routeLength([
      [40.66, -73.97],
      [40.67, -73.97],
    ]);
    expect(Math.round(r)).toBe(1112);
    expect(formatDistance(r, true)).toBe('0.7 mi');
    expect(formatDistance(r, false)).toBe('1.1 km');
    expect(formatDistance(30, true)).toBe('100 ft');
  });
  it('reads public bag spots and dog parks from OpenStreetMap', () => {
    const spots = parseOverpass({
      elements: [
        { type: 'node', id: 1, lat: 40.1, lon: -73.1, tags: { amenity: 'vending_machine', vending: 'excrement_bags' } },
        { type: 'way', id: 2, center: { lat: 40.2, lon: -73.2 }, tags: { leisure: 'dog_park', name: 'Pup Park' } },
        { type: 'node', id: 3, lat: 40.3, lon: -73.3, tags: { amenity: 'waste_basket', waste: 'dog_excrement' } },
        { type: 'node', id: 4, tags: {} },
      ],
    });
    expect(spots.map((s) => [s.kind, s.name])).toEqual([
      ['bags', null],
      ['dog_park', 'Pup Park'],
      ['bin', null],
    ]);
  });
});

it('keeps PDF text to what the standard fonts can draw', () => {
  expect(pdfText('Loki 🐕 hates “golden” retrievers ½')).toBe('Loki hates “golden” retrievers ½');
});
