export type Species =
  | 'dog'
  | 'cat'
  | 'bird'
  | 'fish'
  | 'reptile'
  | 'small_mammal'
  | 'horse'
  | 'other';

export interface Session {
  userId: string;
  email: string;
}

export interface Household {
  id: string;
  name: string;
  invite_code: string;
  created_by: string;
  timezone: string | null;
}

export interface Member {
  user_id: string;
  role: 'owner' | 'member';
  color: string;
  display_name: string;
  notify_late: boolean;
  /** "HH:MM" for a morning summary, or null for none. */
  notify_daily: string | null;
  /** A reminder when it's time to order more food or supplies. */
  notify_supplies: boolean;
  /** Profile photo as a small JPEG data URL. */
  avatar: string | null;
  /** Phone number the household can see. */
  phone: string | null;
}

export interface AccountInput {
  display_name: string;
  avatar: string | null;
  phone: string | null;
}

export type Sex = 'female' | 'male';

export interface Pet {
  id: string;
  household_id: string;
  name: string;
  species: Species;
  /** What kind of pet in the owner's words, when species is 'other'. */
  species_label: string | null;
  emoji: string;
  notes: string | null;
  /** Small JPEG as a data URL, or null to show the emoji. */
  photo: string | null;
  breed: string | null;
  /** "YYYY-MM-DD" */
  birthday: string | null;
  sex: Sex | null;
  /** Spayed or neutered. */
  fixed: boolean | null;
  microchip: string | null;
  allergies: string[];
  likes: string[];
  dislikes: string[];
  /** What they eat, e.g. "Salmon kibble". */
  food: string | null;
  /** How much per meal, e.g. "1 cup". */
  food_amount: string | null;
  feeding_notes: string | null;
  vet_clinic: string | null;
  vet_name: string | null;
  vet_phone: string | null;
  vet_address: string | null;
  created_at: string;
}

/** Every profile field a pet can have beyond the basics, empty. */
export const EMPTY_PROFILE = {
  species_label: null,
  breed: null,
  birthday: null,
  sex: null,
  fixed: null,
  microchip: null,
  allergies: [] as string[],
  likes: [] as string[],
  dislikes: [] as string[],
  food: null,
  food_amount: null,
  feeding_notes: null,
  vet_clinic: null,
  vet_name: null,
  vet_phone: null,
  vet_address: null,
} satisfies Partial<Pet>;

export type ScheduleKind = 'daily' | 'weekly' | 'monthly' | 'interval' | 'once';
export type Category = 'care' | 'medication' | 'vaccine' | 'vet';

export interface Routine {
  id: string;
  household_id: string;
  pet_id: string;
  title: string;
  kind: ScheduleKind;
  category: Category;
  /** Medications only, e.g. "1 chewable" or "25 mg". */
  dose: string | null;
  /** "HH:MM" 24h strings. Empty means "any time of day". */
  times: string[];
  /** 0 = Sunday ... 6 = Saturday. Used when kind = 'weekly'. */
  weekdays: number[];
  /** Used when kind = 'interval'. */
  interval_days: number | null;
  /** Weekly and monthly: every this many weeks or months (1 = every one). */
  repeat_every: number;
  /** "YYYY-MM-DD". First day it applies; the date itself for 'once'. */
  start_date: string;
  assignee: string | null;
  notes: string | null;
  active: boolean;
  created_at: string;
}

export type LogStatus = 'done' | 'skipped' | 'snoozed';

export interface TaskLog {
  id: string;
  household_id: string;
  pet_id: string;
  /** Null for one-off entries logged from the Activity tab. */
  routine_id: string | null;
  occurrence_date: string;
  /** "HH:MM", "any" for untimed routines, or "adhoc" for one-off entries. */
  slot: string;
  title: string;
  note: string | null;
  status: LogStatus;
  /** Set when the occurrence was moved: it shows on this date instead. */
  snoozed_to: string | null;
  /** Null when a sitter checked it off. */
  done_by: string | null;
  sitter_link_id: string | null;
  sitter_name: string | null;
  /** The person's name, kept after they deleted their account. */
  author_name?: string | null;
  done_at: string;
}

export interface Weight {
  id: string;
  household_id: string;
  pet_id: string;
  weighed_on: string;
  weight: number;
  unit: 'lb' | 'kg';
  note: string | null;
  recorded_by: string | null;
  created_at: string;
}

export interface SitterLink {
  id: string;
  household_id: string;
  token: string;
  label: string;
  /** Empty means every pet. */
  pet_ids: string[];
  expires_at: string;
  revoked: boolean;
  created_by: string | null;
  created_at: string;
}

export type SupplyKind = 'food' | 'treats' | 'litter' | 'medication' | 'other';

/** Food, litter, meds: when the current one was opened and when to order more. */
export interface Supply {
  id: string;
  household_id: string;
  name: string;
  kind: SupplyKind;
  /** Empty means it's shared by every pet. */
  pet_ids: string[];
  opened_on: string;
  /** About how many days one lasts. */
  lasts_days: number;
  /** Order this many days before it runs out. */
  lead_days: number;
  /** Set when someone ordered more; cleared when a new one is opened. */
  ordered_on: string | null;
  /** Earlier opened_on dates, oldest first. */
  restocks: string[];
  order_url: string | null;
  notes: string | null;
  created_by: string | null;
  created_at: string;
}

export type PlaceKind = 'route' | 'park' | 'bag_spot' | 'other';
export type LatLng = [number, number];

/** A saved walk route, park, poop bag spot, or other place on the walk map. */
export interface Place {
  id: string;
  household_id: string;
  kind: PlaceKind;
  name: string;
  notes: string | null;
  /** [latitude, longitude] pairs; one pair for a spot. */
  points: LatLng[];
  created_by: string | null;
  created_at: string;
}

export interface Snapshot {
  household: Household;
  members: Member[];
  pets: Pet[];
  routines: Routine[];
  logs: TaskLog[];
  weights: Weight[];
  sitterLinks: SitterLink[];
  supplies: Supply[];
  places: Place[];
  /** True when the database is missing the newest update (supplies and places can't be saved). */
  behind?: boolean;
}

/** What a sitter's link shows: today's tasks for the pets on the link. */
export interface SitterSnapshot {
  link: { id: string; label: string; expires_at: string };
  today: string;
  household: { id: string; name: string };
  members: Pick<Member, 'user_id' | 'display_name' | 'color'>[];
  pets: Pet[];
  routines: Routine[];
  logs: TaskLog[];
  places: Pick<Place, 'id' | 'kind' | 'name' | 'notes' | 'points'>[];
}

export type PetInput = Omit<Pet, 'id' | 'household_id' | 'created_at'>;

export type SupplyInput = Pick<
  Supply,
  'name' | 'kind' | 'pet_ids' | 'opened_on' | 'lasts_days' | 'lead_days' | 'order_url' | 'notes'
>;
export type SupplyPatch = Partial<SupplyInput & Pick<Supply, 'ordered_on' | 'restocks'>>;

export type PlaceInput = Pick<Place, 'kind' | 'name' | 'notes' | 'points'>;

export type RoutineInput = Pick<
  Routine,
  | 'pet_id'
  | 'title'
  | 'kind'
  | 'category'
  | 'dose'
  | 'times'
  | 'weekdays'
  | 'interval_days'
  | 'repeat_every'
  | 'start_date'
  | 'assignee'
  | 'notes'
>;

export type WeightInput = Pick<Weight, 'pet_id' | 'weighed_on' | 'weight' | 'unit' | 'note'>;

export interface SitterLinkInput {
  label: string;
  pet_ids: string[];
  expires_at: string;
}

export interface CompleteInput {
  householdId: string;
  petId: string;
  routineId: string | null;
  date: string;
  slot: string;
  title: string;
  note?: string | null;
  status?: LogStatus;
  snoozedTo?: string | null;
  /** When it happened, for things logged after the fact. Defaults to now. */
  doneAt?: string;
}

export type LogPatch = Partial<
  Pick<
    TaskLog,
    'status' | 'snoozed_to' | 'done_by' | 'done_at' | 'note' | 'sitter_link_id' | 'sitter_name' | 'occurrence_date' | 'title'
  >
>;

export type CompleteResult = { ok: true; log: TaskLog } | { ok: false; existing: TaskLog | null };

export interface PushKeys {
  endpoint: string;
  p256dh: string;
  auth: string;
}

export interface ChangeEvent {
  table: string;
  type: 'INSERT' | 'UPDATE' | 'DELETE';
  id?: string;
}

export interface Backend {
  kind: 'supabase' | 'demo';
  getSession(): Promise<Session | null>;
  onAuthChange(cb: (s: Session | null) => void): () => void;
  signUp(email: string, password: string, displayName: string): Promise<{ needsConfirmation: boolean }>;
  signIn(email: string, password: string): Promise<void>;
  sendPasswordReset(email: string): Promise<void>;
  signOut(): Promise<void>;

  listMyHouseholds(): Promise<Household[]>;
  createHousehold(name: string): Promise<Household>;
  joinHousehold(code: string): Promise<Household>;
  loadSnapshot(householdId: string, sinceDate: string): Promise<Snapshot>;
  /** Check-offs for older days (from and to inclusive), for the calendar and history. */
  loadLogs(householdId: string, fromDate: string, toDate: string): Promise<TaskLog[]>;
  subscribe(householdId: string, onChange: (e: ChangeEvent) => void): () => void;

  renameHousehold(householdId: string, name: string): Promise<void>;
  setHouseholdTimezone(householdId: string, timezone: string): Promise<void>;
  regenerateInvite(householdId: string): Promise<string>;
  removeMember(householdId: string, userId: string): Promise<void>;
  leaveHousehold(householdId: string): Promise<void>;
  deleteHousehold(householdId: string): Promise<void>;
  /** Name, photo and phone: the same in every household. */
  updateMyAccount(input: AccountInput): Promise<void>;
  /** Stamp color: one per household. */
  updateMyColor(householdId: string, color: string): Promise<void>;
  /** Deletes the account. Check-offs stay under the person's name; owned households pass on. */
  deleteMyAccount(): Promise<void>;
  updateMyReminders(
    householdId: string,
    prefs: Partial<Pick<Member, 'notify_late' | 'notify_daily' | 'notify_supplies'>>,
  ): Promise<void>;

  addPet(householdId: string, input: PetInput): Promise<Pet>;
  updatePet(id: string, input: PetInput): Promise<void>;
  deletePet(id: string): Promise<void>;

  addRoutine(householdId: string, input: RoutineInput): Promise<Routine>;
  updateRoutine(id: string, input: RoutineInput & { active?: boolean }): Promise<void>;
  deleteRoutine(id: string): Promise<void>;

  completeTask(input: CompleteInput): Promise<CompleteResult>;
  /** Finish a task someone moved to another day. Fails if it's already finished. */
  finishMoved(logId: string, status: 'done' | 'skipped', note?: string | null): Promise<CompleteResult>;
  updateLog(logId: string, patch: LogPatch): Promise<void>;
  undoTask(logId: string): Promise<void>;

  addWeight(householdId: string, input: WeightInput): Promise<Weight>;
  deleteWeight(id: string): Promise<void>;

  addSupply(householdId: string, input: SupplyInput): Promise<Supply>;
  updateSupply(id: string, patch: SupplyPatch): Promise<void>;
  deleteSupply(id: string): Promise<void>;

  addPlace(householdId: string, input: PlaceInput): Promise<Place>;
  updatePlace(id: string, input: Partial<PlaceInput>): Promise<void>;
  deletePlace(id: string): Promise<void>;

  createSitterLink(householdId: string, input: SitterLinkInput): Promise<SitterLink>;
  revokeSitterLink(id: string): Promise<void>;
  sitterView(token: string): Promise<SitterSnapshot>;
  sitterComplete(token: string, routineId: string, date: string, slot: string, note?: string | null): Promise<CompleteResult>;
  sitterUndo(token: string, logId: string): Promise<void>;

  /** False in the demo: reminders need the real server. */
  supportsPush: boolean;
  getPushPublicKey(): Promise<string | null>;
  savePushSubscription(keys: PushKeys): Promise<void>;
  deletePushSubscription(endpoint: string): Promise<void>;
}
