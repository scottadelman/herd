import { addDays, todayISO } from './dates';
import { MEMBER_COLORS } from './people';
import { occurrencesForDate, slotKey } from './schedule';
import type {
  Backend,
  ChangeEvent,
  CompleteInput,
  Household,
  Member,
  Pet,
  Routine,
  Session,
  Snapshot,
  TaskLog,
} from './types';

// A self-contained backend that runs entirely in the browser. It powers
// "Try the demo" and the preview build, and simulates a second household
// member (Alex) checking something off a few seconds after you arrive, so the
// live-sync behaviour is visible without a server.

const STORE_KEY = 'herd-demo-v1';
const ME = 'demo-you';
const ALEX = 'demo-alex';

interface DemoState {
  household: Household;
  members: Member[];
  pets: Pet[];
  routines: Routine[];
  logs: TaskLog[];
}

let counter = 0;
const newId = (prefix: string) => `${prefix}-${Date.now().toString(36)}-${(counter++).toString(36)}`;

function stampAt(date: string, hhmm: string, jitterMin: number): string {
  const [y, m, d] = date.split('-').map(Number);
  const [h, min] = hhmm === 'any' ? [12, 0] : hhmm.split(':').map(Number);
  return new Date(y, m - 1, d, h, min + jitterMin).toISOString();
}

function seed(): DemoState {
  const today = todayISO();
  const hid = 'demo-household';
  const pet = (id: string, name: string, species: Pet['species'], emoji: string, notes: string | null): Pet => ({
    id,
    household_id: hid,
    name,
    species,
    emoji,
    notes,
    created_at: new Date().toISOString(),
  });
  const routine = (
    id: string,
    pet_id: string,
    title: string,
    kind: Routine['kind'],
    times: string[],
    extra: Partial<Routine> = {},
  ): Routine => ({
    id,
    household_id: hid,
    pet_id,
    title,
    kind,
    times,
    weekdays: [],
    interval_days: null,
    start_date: addDays(today, -14),
    assignee: null,
    notes: null,
    active: true,
    created_at: new Date().toISOString(),
    ...extra,
  });

  const pets = [
    pet('pet-luna', 'Luna', 'dog', '🐕', 'Allergic to chicken. Two cups of kibble per meal.'),
    pet('pet-miso', 'Miso', 'cat', '🐈', null),
    pet('pet-bubbles', 'Bubbles', 'fish', '🐠', 'A pinch of flakes, no more.'),
  ];
  const routines = [
    routine('r-luna-bfast', 'pet-luna', 'Breakfast', 'daily', ['07:00']),
    routine('r-luna-walk-am', 'pet-luna', 'Morning walk', 'daily', ['07:30'], { assignee: ALEX }),
    routine('r-luna-dinner', 'pet-luna', 'Dinner', 'daily', ['18:00']),
    routine('r-luna-walk-pm', 'pet-luna', 'Evening walk', 'daily', ['20:00'], { assignee: ME }),
    routine('r-luna-flea', 'pet-luna', 'Flea and tick prevention', 'interval', [], {
      interval_days: 30,
      start_date: addDays(today, -28),
    }),
    routine('r-miso-bfast', 'pet-miso', 'Breakfast', 'daily', ['07:00']),
    routine('r-miso-dinner', 'pet-miso', 'Dinner', 'daily', ['18:00']),
    routine('r-miso-litter', 'pet-miso', 'Scoop litter box', 'daily', []),
    routine('r-bubbles-feed', 'pet-bubbles', 'Feed', 'daily', ['08:00']),
    routine('r-bubbles-water', 'pet-bubbles', 'Water change', 'interval', [], {
      interval_days: 7,
      start_date: addDays(today, -14),
    }),
  ];

  // Fill in the last few days as fully done, alternating who did what, and
  // today's morning tasks if the morning has passed.
  const logs: TaskLog[] = [];
  const nowMin = new Date().getHours() * 60 + new Date().getMinutes();
  let n = 0;
  for (let back = 4; back >= 0; back--) {
    const date = addDays(today, -back);
    let i = 0;
    for (const r of routines) {
      for (const slot of occurrencesForDate(r, date)) {
        i++;
        if (back === 0) {
          const due = slot === 'any' ? 24 * 60 : Number(slot.slice(0, 2)) * 60 + Number(slot.slice(3));
          if (due > nowMin - 20 || due > 9 * 60) continue;
        }
        const who = r.assignee ?? (n++ % 2 === 0 ? ALEX : ME);
        logs.push({
          id: newId('log'),
          household_id: hid,
          pet_id: r.pet_id,
          routine_id: r.id,
          occurrence_date: date,
          slot,
          title: r.title,
          note: null,
          done_by: who,
          done_at: stampAt(date, slot, 3 + (i % 9)),
        });
      }
    }
  }
  logs.push({
    id: newId('log'),
    household_id: hid,
    pet_id: 'pet-luna',
    routine_id: null,
    occurrence_date: addDays(today, -1),
    slot: 'adhoc',
    title: 'Bath',
    note: 'Rolled in something at the park.',
    done_by: ALEX,
    done_at: stampAt(addDays(today, -1), '16:10', 0),
  });

  return {
    household: { id: hid, name: 'Demo household', invite_code: 'DEMO4PET', created_by: ME },
    members: [
      { user_id: ME, role: 'owner', color: MEMBER_COLORS[0], display_name: 'Sam' },
      { user_id: ALEX, role: 'member', color: MEMBER_COLORS[1], display_name: 'Alex' },
    ],
    pets,
    routines,
    logs: logs.sort((a, b) => b.done_at.localeCompare(a.done_at)),
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
    /* storage can be unavailable in private windows; the demo still works in memory */
  }
}

export function resetDemo() {
  try {
    localStorage.removeItem(STORE_KEY);
  } catch {
    /* ignore */
  }
}

export function createDemoBackend(): Backend {
  let state: DemoState = load() ?? seed();
  save(state);
  let session: Session | null = { userId: ME, email: 'sam@example.com' };
  const authListeners = new Set<(s: Session | null) => void>();
  const changeListeners = new Set<(e: ChangeEvent) => void>();
  let alexTimer: number | undefined;

  const commit = (e: ChangeEvent) => {
    save(state);
    changeListeners.forEach((cb) => cb(e));
  };
  const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v));
  const pause = () => new Promise((r) => setTimeout(r, 120));

  function scheduleAlex() {
    window.clearTimeout(alexTimer);
    alexTimer = window.setTimeout(() => {
      // Alex checks off the earliest open task today.
      const today = todayISO();
      const done = new Set(state.logs.map((l) => (l.routine_id ? slotKey(l.routine_id, l.occurrence_date, l.slot) : '')));
      const open = state.routines
        .flatMap((r) => occurrencesForDate(r, today).map((slot) => ({ r, slot })))
        .filter(({ r, slot }) => !done.has(slotKey(r.id, today, slot)) && r.assignee !== ME)
        .sort((a, b) => (a.slot === 'any' ? '' : a.slot).localeCompare(b.slot === 'any' ? '' : b.slot));
      const pick = open[0];
      if (!pick) return;
      state.logs.unshift({
        id: newId('log'),
        household_id: state.household.id,
        pet_id: pick.r.pet_id,
        routine_id: pick.r.id,
        occurrence_date: today,
        slot: pick.slot,
        title: pick.r.title,
        note: null,
        done_by: ALEX,
        done_at: new Date().toISOString(),
      });
      commit({ table: 'task_logs', type: 'INSERT' });
    }, 7000);
  }

  return {
    kind: 'demo',
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
      window.clearTimeout(alexTimer);
      session = null;
      authListeners.forEach((cb) => cb(null));
    },
    async getMyHousehold() {
      return clone(state.household);
    },
    async createHousehold() {
      return clone(state.household);
    },
    async joinHousehold() {
      return clone(state.household);
    },
    async loadSnapshot(): Promise<Snapshot> {
      await pause();
      return clone(state);
    },
    subscribe(_hid, onChange) {
      changeListeners.add(onChange);
      scheduleAlex();
      return () => {
        changeListeners.delete(onChange);
        window.clearTimeout(alexTimer);
      };
    },
    async renameHousehold(_hid, name) {
      state.household.name = name;
      commit({ table: 'households', type: 'UPDATE' });
    },
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
    async completeTask(input: CompleteInput) {
      if (input.routineId) {
        const existing = state.logs.find(
          (l) => l.routine_id === input.routineId && l.occurrence_date === input.date && l.slot === input.slot,
        );
        if (existing) return { ok: false, existing: clone(existing) };
      }
      const log: TaskLog = {
        id: newId('log'),
        household_id: input.householdId,
        pet_id: input.petId,
        routine_id: input.routineId,
        occurrence_date: input.date,
        slot: input.slot,
        title: input.title,
        note: input.note ?? null,
        done_by: ME,
        done_at: new Date().toISOString(),
      };
      state.logs.unshift(log);
      commit({ table: 'task_logs', type: 'INSERT' });
      return { ok: true, log: clone(log) };
    },
    async undoTask(logId) {
      state.logs = state.logs.filter((l) => l.id !== logId);
      commit({ table: 'task_logs', type: 'DELETE' });
    },
  };
}
