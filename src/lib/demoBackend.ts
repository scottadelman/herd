import { addDays, todayISO } from './dates';
import { buildDay } from './day';
import { MEMBER_COLORS } from './people';
import { occurrencesForDate } from './schedule';
import type {
  Backend,
  ChangeEvent,
  CompleteInput,
  CompleteResult,
  Household,
  Member,
  Pet,
  Place,
  Routine,
  Session,
  SitterLink,
  SitterSnapshot,
  Snapshot,
  Supply,
  TaskLog,
  Weight,
} from './types';
import { EMPTY_PROFILE } from './types';

// A self-contained backend that runs entirely in the browser. It powers
// "Try the demo" and the preview build, and simulates a second household
// member (Priya) checking something off a few seconds after you arrive, so
// live sync is visible without a server.

const STORE_KEY = 'herd-demo-v3';
/** Days of made-up history, so the calendar has a past to look back on. */
const HISTORY = 35;
const ME = 'demo-jamie';
const PRIYA = 'demo-priya';
const HID = 'demo-household';

interface DemoState {
  household: Household;
  members: Member[];
  pets: Pet[];
  routines: Routine[];
  logs: TaskLog[];
  weights: Weight[];
  sitterLinks: SitterLink[];
  supplies: Supply[];
  places: Place[];
}

let counter = 0;
const newId = (prefix: string) => `${prefix}-${Date.now().toString(36)}-${(counter++).toString(36)}`;
const randomToken = () =>
  Array.from({ length: 32 }, () => '0123456789abcdef'[Math.floor(Math.random() * 16)]).join('');

function stampAt(date: string, hhmm: string, jitterMin: number): string {
  const [y, m, d] = date.split('-').map(Number);
  const [h, min] = hhmm === 'any' ? [12, 0] : hhmm.split(':').map(Number);
  return new Date(y, m - 1, d, h, min + jitterMin).toISOString();
}

function seed(): DemoState {
  const today = todayISO();
  const now = new Date();
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const created = new Date().toISOString();

  const pet = (id: string, name: string, species: Pet['species'], emoji: string, notes: string | null, profile: Partial<Pet>): Pet => ({
    id,
    household_id: HID,
    name,
    species,
    emoji,
    notes,
    photo: null,
    created_at: created,
    ...EMPTY_PROFILE,
    ...profile,
  });
  const vet: Partial<Pet> = {
    vet_clinic: 'Prospect Park Animal Clinic',
    vet_name: 'Dr. Lee',
    vet_phone: '(718) 555-0142',
    vet_address: '220 7th Ave, Brooklyn, NY',
  };
  const routine = (id: string, pet_id: string, title: string, times: string[], extra: Partial<Routine> = {}): Routine => ({
    id,
    household_id: HID,
    pet_id,
    title,
    kind: 'daily',
    category: 'care',
    dose: null,
    times,
    weekdays: [],
    interval_days: null,
    start_date: addDays(today, -HISTORY),
    assignee: null,
    notes: null,
    active: true,
    created_at: created,
    ...extra,
  });

  const pets = [
    pet('pet-biscuit', 'Biscuit', 'dog', '🐕', 'Pulls toward squirrels, so keep a short leash. Spare key is with the doorman.', {
      ...vet,
      breed: 'Lab mix',
      birthday: addDays(today, -365 * 6 - 40),
      sex: 'male',
      fixed: true,
      microchip: '985 112 004 518 223',
      allergies: ['Chicken'],
      likes: ['Tennis balls', 'Belly rubs', 'Peanut butter'],
      dislikes: ['Golden retrievers', 'Skateboards', 'Baths'],
      food: 'Salmon and rice kibble',
      food_amount: '2 cups',
      feeding_notes: 'Soak in warm water for 5 minutes. Joint tablet goes in with breakfast.',
    }),
    pet('pet-olive', 'Olive', 'cat', '🐈‍⬛', 'Hides under the bed during storms. Leave her be.', {
      ...vet,
      breed: 'Bombay',
      birthday: addDays(today, -365 * 4 - 120),
      sex: 'female',
      fixed: true,
      likes: ['Feather wand', 'The sunny windowsill'],
      dislikes: ['Being picked up', 'The vacuum'],
      food: 'Tuna pâté in the morning, dry food at night',
      food_amount: '½ can wet, ¼ cup dry',
      feeding_notes: 'Thyroid pill hides best in a pill pocket.',
    }),
    pet('pet-kiwi', 'Kiwi', 'bird', '🦜', 'Cover the cage around 9 PM.', {
      breed: 'Green-cheeked conure',
      birthday: addDays(today, -365 * 2 - 15),
      likes: ['Millet', 'Whistling back and forth'],
      dislikes: ['Hats'],
      food: 'Seed mix plus fresh greens',
      food_amount: '2 tablespoons',
      feeding_notes: 'No avocado or chocolate, ever.',
      vet_clinic: 'Brooklyn Bird and Exotics',
      vet_phone: '(718) 555-0199',
    }),
  ];

  const routines = [
    routine('r-biscuit-bfast', 'pet-biscuit', 'Breakfast', ['07:00']),
    routine('r-biscuit-walk-am', 'pet-biscuit', 'Morning walk', ['07:30'], { assignee: PRIYA }),
    routine('r-biscuit-joint', 'pet-biscuit', 'Joint supplement', ['07:00'], {
      category: 'medication',
      dose: '1 tablet with breakfast',
    }),
    routine('r-biscuit-walk-mid', 'pet-biscuit', 'Midday walk', ['12:30'], { kind: 'weekly', weekdays: [1, 2, 3, 4, 5] }),
    routine('r-biscuit-dinner', 'pet-biscuit', 'Dinner', ['18:00']),
    routine('r-biscuit-walk-pm', 'pet-biscuit', 'Evening walk', ['20:00'], { assignee: ME }),
    routine('r-biscuit-heartworm', 'pet-biscuit', 'Heartworm chewable', [], {
      kind: 'interval',
      interval_days: 30,
      start_date: addDays(today, -60),
      category: 'medication',
      dose: '1 chewable',
    }),
    routine('r-biscuit-rabies', 'pet-biscuit', 'Rabies booster', [], {
      kind: 'once',
      start_date: addDays(today, 12),
      category: 'vaccine',
      notes: 'Bring the paper certificate from last year.',
    }),
    routine('r-biscuit-checkup', 'pet-biscuit', 'Annual checkup', ['10:30'], {
      kind: 'once',
      start_date: addDays(today, 5),
      category: 'vet',
      notes: 'Dr. Lee. Ask about the itchy paw.',
    }),
    routine('r-olive-bfast', 'pet-olive', 'Breakfast', ['07:00']),
    routine('r-olive-dinner', 'pet-olive', 'Dinner', ['18:00']),
    routine('r-olive-thyroid', 'pet-olive', 'Thyroid pill', ['08:00', '20:00'], {
      category: 'medication',
      dose: '½ tablet in a treat',
    }),
    routine('r-olive-litter', 'pet-olive', 'Scoop litter box', []),
    routine('r-kiwi-food', 'pet-kiwi', 'Food and water', ['08:00']),
    routine('r-kiwi-cover', 'pet-kiwi', 'Cover the cage', ['21:00']),
    routine('r-kiwi-clean', 'pet-kiwi', 'Clean cage', [], { kind: 'interval', interval_days: 7, start_date: addDays(today, -HISTORY - 1) }),
    routine('r-biscuit-groom', 'pet-biscuit', 'Grooming appointment', ['14:00'], {
      kind: 'once',
      start_date: addDays(today, -18),
      notes: 'Paws and Claws on 5th Ave.',
    }),
  ];

  const maria: SitterLink = {
    id: 'sitter-maria',
    household_id: HID,
    token: 'demo-maria',
    label: 'Maria',
    pet_ids: ['pet-biscuit'],
    expires_at: new Date(Date.now() + 6 * 86_400_000).toISOString(),
    revoked: false,
    created_by: ME,
    created_at: created,
  };

  const log = (r: Routine, date: string, slot: string, extra: Partial<TaskLog>): TaskLog => ({
    id: newId('log'),
    household_id: HID,
    pet_id: r.pet_id,
    routine_id: r.id,
    occurrence_date: date,
    slot,
    title: r.title,
    note: null,
    status: 'done',
    snoozed_to: null,
    done_by: ME,
    sitter_link_id: null,
    sitter_name: null,
    done_at: stampAt(date, slot, 4),
    ...extra,
  });

  // The last few days are fully taken care of, alternating who did what.
  // Maria the dog walker handles weekday midday walks.
  const logs: TaskLog[] = [];
  let n = 0;
  for (let back = HISTORY; back >= 0; back--) {
    const date = addDays(today, -back);
    for (const r of routines) {
      for (const slot of occurrencesForDate(r, date)) {
        if (back === 0) {
          const due = slot === 'any' ? 24 * 60 : Number(slot.slice(0, 2)) * 60 + Number(slot.slice(3));
          if (due > nowMin - 20 || due > 9 * 60) continue;
        }
        if (r.id === 'r-kiwi-clean' && back === 1) {
          logs.push(log(r, date, slot, { status: 'snoozed', snoozed_to: today, done_by: PRIYA, done_at: stampAt(date, '19:10', 0) }));
          continue;
        }
        if (r.id === 'r-olive-litter' && back === 12) continue; // a missed one, for the calendar
        if (r.id === 'r-biscuit-walk-pm' && back === 3) {
          logs.push(log(r, date, slot, { status: 'skipped', note: 'Pouring rain. Played fetch inside.', done_at: stampAt(date, '20:05', 0) }));
          continue;
        }
        if (r.id === 'r-biscuit-walk-mid') {
          logs.push(log(r, date, slot, { done_by: null, sitter_link_id: maria.id, sitter_name: 'Maria', done_at: stampAt(date, slot, 9) }));
          continue;
        }
        const who = r.assignee ?? (n++ % 2 === 0 ? PRIYA : ME);
        logs.push(log(r, date, slot, { done_by: who, done_at: stampAt(date, slot, 3 + (n % 9)) }));
      }
    }
  }
  logs.push({
    id: newId('log'),
    household_id: HID,
    pet_id: 'pet-biscuit',
    routine_id: null,
    occurrence_date: addDays(today, -2),
    slot: 'adhoc',
    title: 'Bath',
    note: 'Rolled in something at the park.',
    status: 'done',
    snoozed_to: null,
    done_by: PRIYA,
    sitter_link_id: null,
    sitter_name: null,
    done_at: stampAt(addDays(today, -2), '16:10', 0),
  });

  const weight = (pet_id: string, daysAgo: number, w: number): Weight => ({
    id: newId('w'),
    household_id: HID,
    pet_id,
    weighed_on: addDays(today, -daysAgo),
    weight: w,
    unit: 'lb',
    note: null,
    recorded_by: ME,
    created_at: created,
  });
  const supply = (id: string, name: string, kind: Supply['kind'], pet_ids: string[], openedAgo: number, lasts: number, lead: number, extra: Partial<Supply> = {}): Supply => ({
    id,
    household_id: HID,
    name,
    kind,
    pet_ids,
    opened_on: addDays(today, -openedAgo),
    lasts_days: lasts,
    lead_days: lead,
    ordered_on: null,
    restocks: [addDays(today, -openedAgo - lasts * 2 - 1), addDays(today, -openedAgo - lasts)],
    order_url: null,
    notes: null,
    created_by: ME,
    created_at: created,
    ...extra,
  });
  const supplies = [
    supply('sup-kibble', 'Salmon and rice kibble, 30 lb', 'food', ['pet-biscuit'], 24, 28, 5, {
      order_url: 'https://www.chewy.com/',
      notes: 'Autoship is off. Order the grain-inclusive one.',
    }),
    supply('sup-litter', 'Clumping litter', 'litter', ['pet-olive'], 9, 30, 5),
    supply('sup-tuna', 'Tuna pâté, case of 24', 'food', ['pet-olive'], 16, 24, 4, { ordered_on: addDays(today, -1) }),
    supply('sup-seed', 'Conure seed mix', 'food', ['pet-kiwi'], 20, 60, 7),
  ];

  // Around Prospect Park, Brooklyn.
  const place = (id: string, kind: Place['kind'], name: string, notes: string | null, points: [number, number][]): Place => ({
    id,
    household_id: HID,
    kind,
    name,
    notes,
    points,
    created_by: ME,
    created_at: created,
  });
  const places = [
    place('pl-loop', 'route', 'Morning loop', 'Biscuit’s usual. Skip 9th St when the farmers market is on.', [
      [40.6703, -73.9792], [40.6688, -73.9806], [40.6672, -73.9783], [40.6659, -73.9762], [40.6648, -73.9741],
      [40.6661, -73.9718], [40.6679, -73.9705], [40.6696, -73.9728], [40.6709, -73.9752], [40.6703, -73.9792],
    ]),
    place('pl-meadow', 'park', 'Long Meadow', 'Off leash before 9 AM. Lots of goldens on weekends.', [[40.6668, -73.9733]]),
    place('pl-bags', 'bag_spot', 'Bag dispenser at 3rd St', 'Usually stocked. The one at 9th St is often empty.', [[40.6714, -73.9718]]),
  ];

  const weights = [
    weight('pet-biscuit', 150, 66.2),
    weight('pet-biscuit', 120, 65.4),
    weight('pet-biscuit', 90, 64.8),
    weight('pet-biscuit', 60, 63.9),
    weight('pet-biscuit', 30, 63.1),
    weight('pet-biscuit', 3, 62.4),
    weight('pet-olive', 90, 10.6),
    weight('pet-olive', 45, 10.2),
    weight('pet-olive', 10, 9.9),
  ];

  return {
    household: { id: HID, name: 'The Parkers', invite_code: 'HXK4P9TQ', created_by: ME, timezone: null },
    members: [
      { user_id: ME, role: 'owner', color: MEMBER_COLORS[0], display_name: 'Jamie', notify_late: true, notify_daily: '07:30', notify_supplies: true },
      { user_id: PRIYA, role: 'member', color: MEMBER_COLORS[1], display_name: 'Priya', notify_late: true, notify_daily: null, notify_supplies: true },
    ],
    pets,
    routines,
    logs: logs.sort((a, b) => b.done_at.localeCompare(a.done_at)),
    weights,
    sitterLinks: [maria],
    supplies,
    places,
  };
}

function load(): DemoState | null {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as DemoState & { seededOn?: string };
    // Re-seed each day so the demo always has a realistic "today".
    if (parsed.seededOn !== todayISO()) return null;
    return parsed;
  } catch {
    return null;
  }
}

function save(s: DemoState) {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify({ ...s, seededOn: todayISO() }));
  } catch {
    /* storage can be unavailable or full (photos); the demo keeps working in memory */
  }
}

export function resetDemo() {
  try {
    localStorage.removeItem(STORE_KEY);
    localStorage.removeItem('herd-demo-v1');
    localStorage.removeItem('herd-demo-v2');
  } catch {
    /* ignore */
  }
}

export function createDemoBackend(): Backend {
  let state: DemoState = load() ?? seed();
  save(state);
  let session: Session | null = { userId: ME, email: 'jamie@example.com' };
  const authListeners = new Set<(s: Session | null) => void>();
  const changeListeners = new Set<(e: ChangeEvent) => void>();
  let priyaTimer: number | undefined;

  const commit = (e: ChangeEvent) => {
    save(state);
    changeListeners.forEach((cb) => cb(e));
  };
  const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v));
  const pause = () => new Promise((r) => setTimeout(r, 120));
  const findLog = (routineId: string, date: string, slot: string) =>
    state.logs.find((l) => l.routine_id === routineId && l.occurrence_date === date && l.slot === slot);

  const newLog = (input: Omit<CompleteInput, 'householdId'>, who: Partial<TaskLog>): TaskLog => ({
    id: newId('log'),
    household_id: HID,
    pet_id: input.petId,
    routine_id: input.routineId,
    occurrence_date: input.date,
    slot: input.slot,
    title: input.title,
    note: input.note ?? null,
    status: input.status ?? 'done',
    snoozed_to: input.snoozedTo ?? null,
    done_by: ME,
    sitter_link_id: null,
    sitter_name: null,
    done_at: input.doneAt ?? new Date().toISOString(),
    ...who,
  });

  function schedulePriya() {
    window.clearTimeout(priyaTimer);
    priyaTimer = window.setTimeout(() => {
      // Priya checks off the earliest open task today that isn't yours.
      const open = buildDay(state, todayISO()).filter((i) => i.state === 'open' && i.routine.assignee !== ME);
      const pick = open[0];
      if (!pick) return;
      if (pick.log) {
        state.logs = state.logs.map((l) =>
          l.id === pick.log!.id ? { ...l, status: 'done', done_by: PRIYA, done_at: new Date().toISOString() } : l,
        );
      } else {
        state.logs.unshift(
          newLog(
            { petId: pick.pet.id, routineId: pick.routine.id, date: pick.origDate, slot: pick.slot, title: pick.routine.title },
            { done_by: PRIYA },
          ),
        );
      }
      commit({ table: 'task_logs', type: 'INSERT' });
    }, 7000);
  }

  function linkFor(token: string): SitterLink {
    const l = state.sitterLinks.find((x) => x.token === token);
    if (!l || l.revoked || new Date(l.expires_at) <= new Date()) {
      throw new Error('This sitter link has expired or was turned off. Ask the owner for a new one.');
    }
    return l;
  }
  const allowedPets = (l: SitterLink) => state.pets.filter((p) => !l.pet_ids.length || l.pet_ids.includes(p.id));

  return {
    kind: 'demo',
    supportsPush: false,
    async getSession() {
      return session;
    },
    onAuthChange(cb) {
      authListeners.add(cb);
      return () => authListeners.delete(cb);
    },
    async signUp() {
      return { needsConfirmation: false };
    },
    async signIn() {},
    async sendPasswordReset() {},
    async signOut() {
      window.clearTimeout(priyaTimer);
      session = null;
      authListeners.forEach((cb) => cb(null));
    },
    async listMyHouseholds() {
      return [clone(state.household)];
    },
    async createHousehold() {
      throw new Error('The demo has one household. Create an account to make your own.');
    },
    async joinHousehold() {
      throw new Error('The demo has one household. Create an account to join a real one.');
    },
    async loadSnapshot(_hid, since): Promise<Snapshot> {
      await pause();
      return clone({
        ...state,
        // Like the real server: recent history only. Older days load on demand.
        logs: state.logs.filter((l) => l.occurrence_date >= since || (l.snoozed_to ?? '') >= since),
        sitterLinks: state.sitterLinks.filter((l) => !l.revoked && new Date(l.expires_at) > new Date()),
      });
    },
    async loadLogs(_hid, from, to) {
      await pause();
      const inRange = (d: string | null) => !!d && d >= from && d <= to;
      return clone(state.logs.filter((l) => inRange(l.occurrence_date) || inRange(l.snoozed_to)));
    },
    subscribe(_hid, onChange) {
      changeListeners.add(onChange);
      schedulePriya();
      return () => {
        changeListeners.delete(onChange);
        window.clearTimeout(priyaTimer);
      };
    },
    async renameHousehold(_hid, name) {
      state.household.name = name;
      commit({ table: 'households', type: 'UPDATE' });
    },
    async setHouseholdTimezone() {},
    async regenerateInvite() {
      const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
      state.household.invite_code = Array.from({ length: 8 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
      commit({ table: 'households', type: 'UPDATE' });
      return state.household.invite_code;
    },
    async removeMember(_hid, userId) {
      state.members = state.members.filter((m) => m.user_id !== userId);
      commit({ table: 'household_members', type: 'DELETE' });
    },
    async leaveHousehold() {
      throw new Error('The demo household can’t be left. Use Exit demo instead.');
    },
    async deleteHousehold() {
      throw new Error('The demo household can’t be deleted. Use Exit demo instead.');
    },
    async updateMyProfile(_hid, displayName, color) {
      state.members = state.members.map((m) => (m.user_id === ME ? { ...m, display_name: displayName, color } : m));
      commit({ table: 'household_members', type: 'UPDATE' });
    },
    async updateMyReminders(_hid, prefs) {
      state.members = state.members.map((m) => (m.user_id === ME ? { ...m, ...prefs } : m));
      commit({ table: 'household_members', type: 'UPDATE' });
    },
    async addPet(hid, input) {
      const pet: Pet = { ...input, id: newId('pet'), household_id: hid, created_at: new Date().toISOString() };
      state.pets.push(pet);
      commit({ table: 'pets', type: 'INSERT' });
      return clone(pet);
    },
    async updatePet(id, input) {
      state.pets = state.pets.map((p) => (p.id === id ? { ...p, ...input } : p));
      commit({ table: 'pets', type: 'UPDATE' });
    },
    async deletePet(id) {
      state.pets = state.pets.filter((p) => p.id !== id);
      state.routines = state.routines.filter((r) => r.pet_id !== id);
      state.logs = state.logs.filter((l) => l.pet_id !== id);
      state.weights = state.weights.filter((w) => w.pet_id !== id);
      state.supplies = state.supplies.map((x) => ({ ...x, pet_ids: x.pet_ids.filter((p) => p !== id) }));
      commit({ table: 'pets', type: 'DELETE' });
    },
    async addRoutine(hid, input) {
      const r: Routine = { ...input, id: newId('routine'), household_id: hid, active: true, created_at: new Date().toISOString() };
      state.routines.push(r);
      commit({ table: 'routines', type: 'INSERT' });
      return clone(r);
    },
    async updateRoutine(id, input) {
      state.routines = state.routines.map((r) => (r.id === id ? { ...r, ...input } : r));
      commit({ table: 'routines', type: 'UPDATE' });
    },
    async deleteRoutine(id) {
      state.routines = state.routines.filter((r) => r.id !== id);
      state.logs = state.logs.map((l) => (l.routine_id === id ? { ...l, routine_id: null } : l));
      commit({ table: 'routines', type: 'DELETE' });
    },
    async completeTask(input): Promise<CompleteResult> {
      if (input.routineId) {
        const existing = findLog(input.routineId, input.date, input.slot);
        if (existing) return { ok: false, existing: clone(existing) };
      }
      const log = newLog(input, {});
      state.logs.unshift(log);
      commit({ table: 'task_logs', type: 'INSERT' });
      return { ok: true, log: clone(log) };
    },
    async finishMoved(logId, status, note) {
      const existing = state.logs.find((l) => l.id === logId);
      if (!existing || existing.status !== 'snoozed') return { ok: false, existing: existing ? clone(existing) : null };
      const updated: TaskLog = { ...existing, status, done_by: ME, done_at: new Date().toISOString(), note: note ?? null };
      state.logs = state.logs.map((l) => (l.id === logId ? updated : l));
      commit({ table: 'task_logs', type: 'UPDATE' });
      return { ok: true, log: clone(updated) };
    },
    async updateLog(logId, patch) {
      const existing = state.logs.find((l) => l.id === logId);
      if (!existing) return;
      const next = { ...existing, ...patch };
      if (next.status !== 'snoozed' && next.done_by !== ME) throw new Error('You can only change your own check-offs.');
      state.logs = state.logs.map((l) => (l.id === logId ? next : l));
      commit({ table: 'task_logs', type: 'UPDATE' });
    },
    async undoTask(logId) {
      state.logs = state.logs.filter((l) => l.id !== logId);
      commit({ table: 'task_logs', type: 'DELETE' });
    },
    async addWeight(hid, input) {
      const w: Weight = { ...input, id: newId('w'), household_id: hid, recorded_by: ME, created_at: new Date().toISOString() };
      state.weights.push(w);
      commit({ table: 'pet_weights', type: 'INSERT' });
      return clone(w);
    },
    async deleteWeight(id) {
      state.weights = state.weights.filter((w) => w.id !== id);
      commit({ table: 'pet_weights', type: 'DELETE' });
    },
    async addSupply(hid, input) {
      const x: Supply = { ...input, id: newId('sup'), household_id: hid, ordered_on: null, restocks: [], created_by: ME, created_at: new Date().toISOString() };
      state.supplies.push(x);
      commit({ table: 'supplies', type: 'INSERT' });
      return clone(x);
    },
    async updateSupply(id, patch) {
      state.supplies = state.supplies.map((x) => (x.id === id ? { ...x, ...patch } : x));
      commit({ table: 'supplies', type: 'UPDATE' });
    },
    async deleteSupply(id) {
      state.supplies = state.supplies.filter((x) => x.id !== id);
      commit({ table: 'supplies', type: 'DELETE' });
    },
    async addPlace(hid, input) {
      const x: Place = { ...input, id: newId('pl'), household_id: hid, created_by: ME, created_at: new Date().toISOString() };
      state.places.push(x);
      commit({ table: 'places', type: 'INSERT' });
      return clone(x);
    },
    async updatePlace(id, input) {
      state.places = state.places.map((x) => (x.id === id ? { ...x, ...input } : x));
      commit({ table: 'places', type: 'UPDATE' });
    },
    async deletePlace(id) {
      state.places = state.places.filter((x) => x.id !== id);
      commit({ table: 'places', type: 'DELETE' });
    },
    async createSitterLink(hid, input) {
      const link: SitterLink = {
        ...input,
        id: newId('sitter'),
        household_id: hid,
        token: randomToken(),
        revoked: false,
        created_by: ME,
        created_at: new Date().toISOString(),
      };
      state.sitterLinks.push(link);
      commit({ table: 'sitter_links', type: 'INSERT' });
      return clone(link);
    },
    async revokeSitterLink(id) {
      state.sitterLinks = state.sitterLinks.map((l) => (l.id === id ? { ...l, revoked: true } : l));
      commit({ table: 'sitter_links', type: 'UPDATE' });
    },
    async sitterView(token): Promise<SitterSnapshot> {
      await pause();
      const l = linkFor(token);
      const today = todayISO();
      const pets = allowedPets(l);
      const ids = new Set(pets.map((p) => p.id));
      const near = (d: string | null) => !!d && Math.abs((Date.parse(d) - Date.parse(today)) / 86_400_000) <= 1;
      return clone({
        link: { id: l.id, label: l.label, expires_at: l.expires_at },
        today,
        household: { id: HID, name: state.household.name },
        members: state.members.map(({ user_id, display_name, color }) => ({ user_id, display_name, color })),
        pets,
        routines: state.routines.filter((r) => ids.has(r.pet_id) && r.active).map((r) => ({ ...r, assignee: null })),
        logs: state.logs.filter((x) => ids.has(x.pet_id) && x.routine_id && (near(x.occurrence_date) || near(x.snoozed_to))),
        places: state.places.map(({ id, kind, name, notes, points }) => ({ id, kind, name, notes, points })),
      });
    },
    async sitterComplete(token, routineId, date, slot, note) {
      const l = linkFor(token);
      const r = state.routines.find((x) => x.id === routineId);
      if (!r || !allowedPets(l).some((p) => p.id === r.pet_id)) throw new Error('That task isn’t part of this sitter link.');
      const existing = findLog(routineId, date, slot);
      const sitter = { done_by: null, sitter_link_id: l.id, sitter_name: l.label };
      if (existing) {
        if (existing.status !== 'snoozed') return { ok: false, existing: clone(existing) };
        const updated: TaskLog = { ...existing, ...sitter, status: 'done', note: note ?? null, done_at: new Date().toISOString() };
        state.logs = state.logs.map((x) => (x.id === existing.id ? updated : x));
        commit({ table: 'task_logs', type: 'UPDATE' });
        return { ok: true, log: clone(updated) };
      }
      const log = newLog({ petId: r.pet_id, routineId, date, slot, title: r.title, note }, sitter);
      state.logs.unshift(log);
      commit({ table: 'task_logs', type: 'INSERT' });
      return { ok: true, log: clone(log) };
    },
    async sitterUndo(token, logId) {
      const l = linkFor(token);
      const t = state.logs.find((x) => x.id === logId && x.sitter_link_id === l.id);
      if (!t) throw new Error('Only your own check-offs from today can be undone.');
      if (t.snoozed_to) state.logs = state.logs.map((x) => (x.id === logId ? { ...x, status: 'snoozed', note: null } : x));
      else state.logs = state.logs.filter((x) => x.id !== logId);
      commit({ table: 'task_logs', type: 'DELETE' });
    },
    async getPushPublicKey() {
      return null;
    },
    async savePushSubscription() {
      throw new Error('Reminders work in the real app, not the demo.');
    },
    async deletePushSubscription() {},
  };
}
