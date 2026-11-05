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
}

export interface Member {
  user_id: string;
  role: 'owner' | 'member';
  color: string;
  display_name: string;
}

export interface Pet {
  id: string;
  household_id: string;
  name: string;
  species: Species;
  emoji: string;
  notes: string | null;
  created_at: string;
}

export type ScheduleKind = 'daily' | 'weekly' | 'interval';

export interface Routine {
  id: string;
  household_id: string;
  pet_id: string;
  title: string;
  kind: ScheduleKind;
  /** "HH:MM" 24h strings. Empty means "any time of day". */
  times: string[];
  /** 0 = Sunday ... 6 = Saturday. Used when kind = 'weekly'. */
  weekdays: number[];
  /** Used when kind = 'interval'. */
  interval_days: number | null;
  /** "YYYY-MM-DD". First day the routine applies; anchor for intervals. */
  start_date: string;
  assignee: string | null;
  notes: string | null;
  active: boolean;
  created_at: string;
}

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
  done_by: string;
  done_at: string;
}

export interface Snapshot {
  household: Household;
  members: Member[];
  pets: Pet[];
  routines: Routine[];
  logs: TaskLog[];
}

export type PetInput = Pick<Pet, 'name' | 'species' | 'emoji' | 'notes'>;

export type RoutineInput = Pick<
  Routine,
  'pet_id' | 'title' | 'kind' | 'times' | 'weekdays' | 'interval_days' | 'start_date' | 'assignee' | 'notes'
>;

export interface CompleteInput {
  householdId: string;
  petId: string;
  routineId: string | null;
  date: string;
  slot: string;
  title: string;
  note?: string | null;
}

export type CompleteResult = { ok: true; log: TaskLog } | { ok: false; existing: TaskLog | null };

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

  getMyHousehold(): Promise<Household | null>;
  createHousehold(name: string): Promise<Household>;
  joinHousehold(code: string): Promise<Household>;
  loadSnapshot(householdId: string, sinceDate: string): Promise<Snapshot>;
  subscribe(householdId: string, onChange: (e: ChangeEvent) => void): () => void;

  renameHousehold(householdId: string, name: string): Promise<void>;
  regenerateInvite(householdId: string): Promise<string>;
  removeMember(householdId: string, userId: string): Promise<void>;
  leaveHousehold(householdId: string): Promise<void>;
  deleteHousehold(householdId: string): Promise<void>;
  updateMyProfile(householdId: string, displayName: string, color: string): Promise<void>;

  addPet(householdId: string, input: PetInput): Promise<Pet>;
  updatePet(id: string, input: PetInput): Promise<void>;
  deletePet(id: string): Promise<void>;

  addRoutine(householdId: string, input: RoutineInput): Promise<Routine>;
  updateRoutine(id: string, input: RoutineInput): Promise<void>;
  deleteRoutine(id: string): Promise<void>;

  completeTask(input: CompleteInput): Promise<CompleteResult>;
  undoTask(logId: string): Promise<void>;
}
