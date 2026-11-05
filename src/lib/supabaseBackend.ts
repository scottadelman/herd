import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { AppConfig } from './config';
import type {
  Backend,
  ChangeEvent,
  CompleteInput,
  CompleteResult,
  Household,
  Member,
  Pet,
  PetInput,
  Routine,
  RoutineInput,
  Session,
  Snapshot,
  TaskLog,
} from './types';

function fail(error: { message: string } | null): void {
  if (error) throw new Error(friendly(error.message));
}

function friendly(message: string): string {
  if (/invalid login credentials/i.test(message)) return 'That email and password don’t match an account.';
  if (/email not confirmed/i.test(message)) return 'Confirm your email first. Check your inbox for the link.';
  if (/user already registered/i.test(message)) return 'An account with that email already exists. Sign in instead.';
  if (/password should be at least/i.test(message)) return 'Use a password with at least 6 characters.';
  return message;
}

const toSession = (u: { id: string; email?: string | null } | null | undefined): Session | null =>
  u ? { userId: u.id, email: u.email ?? '' } : null;

export function createSupabaseBackend(config: AppConfig): Backend {
  const sb: SupabaseClient = createClient(config.supabaseUrl, config.supabaseAnonKey, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
  });

  const uid = async (): Promise<string> => {
    const { data } = await sb.auth.getSession();
    const id = data.session?.user.id;
    if (!id) throw new Error('You’re signed out. Sign in again.');
    return id;
  };

  return {
    kind: 'supabase',

    async getSession() {
      const { data } = await sb.auth.getSession();
      return toSession(data.session?.user);
    },

    onAuthChange(cb) {
      const { data } = sb.auth.onAuthStateChange((_event, session) => cb(toSession(session?.user)));
      return () => data.subscription.unsubscribe();
    },

    async signUp(email, password, displayName) {
      const { data, error } = await sb.auth.signUp({
        email,
        password,
        options: {
          data: { display_name: displayName },
          emailRedirectTo: window.location.origin + window.location.pathname,
        },
      });
      fail(error);
      return { needsConfirmation: !data.session };
    },

    async signIn(email, password) {
      const { error } = await sb.auth.signInWithPassword({ email, password });
      fail(error);
    },

    async sendPasswordReset(email) {
      const { error } = await sb.auth.resetPasswordForEmail(email, {
        redirectTo: window.location.origin + window.location.pathname,
      });
      fail(error);
    },

    async signOut() {
      await sb.auth.signOut();
    },

    async getMyHousehold() {
      const me = await uid();
      const { data, error } = await sb
        .from('household_members')
        .select('joined_at, household:households(*)')
        .eq('user_id', me)
        .order('joined_at', { ascending: true })
        .limit(1);
      fail(error);
      const row = data?.[0] as unknown as { household: Household } | undefined;
      return row?.household ?? null;
    },

    async createHousehold(name) {
      const { data, error } = await sb.rpc('create_household', { p_name: name });
      fail(error);
      return data as Household;
    },

    async joinHousehold(code) {
      const { data, error } = await sb.rpc('join_household', { p_code: code });
      fail(error);
      return data as Household;
    },

    async loadSnapshot(householdId, sinceDate) {
      const [h, m, p, r, l] = await Promise.all([
        sb.from('households').select('*').eq('id', householdId).single(),
        sb
          .from('household_members')
          .select('user_id, role, color, joined_at, profile:profiles(display_name)')
          .eq('household_id', householdId)
          .order('joined_at'),
        sb.from('pets').select('*').eq('household_id', householdId).order('created_at'),
        sb.from('routines').select('*').eq('household_id', householdId).order('created_at'),
        sb
          .from('task_logs')
          .select('*')
          .eq('household_id', householdId)
          .gte('occurrence_date', sinceDate)
          .order('done_at', { ascending: false })
          .limit(1000),
      ]);
      for (const res of [h, m, p, r, l]) fail(res.error);
      const members: Member[] = (m.data ?? []).map((row: any) => ({
        user_id: row.user_id,
        role: row.role,
        color: row.color,
        display_name: row.profile?.display_name ?? 'Someone',
      }));
      return {
        household: h.data as Household,
        members,
        pets: (p.data ?? []) as Pet[],
        routines: (r.data ?? []) as Routine[],
        logs: (l.data ?? []) as TaskLog[],
      } satisfies Snapshot;
    },

    subscribe(householdId, onChange) {
      const channel = sb.channel(`household-${householdId}`);
      const tables = ['task_logs', 'pets', 'routines', 'household_members', 'households'];
      for (const table of tables) {
        const filter = table === 'households' ? `id=eq.${householdId}` : `household_id=eq.${householdId}`;
        for (const event of ['INSERT', 'UPDATE'] as const) {
          channel.on('postgres_changes' as any, { event, schema: 'public', table, filter }, () =>
            onChange({ table, type: event }),
          );
        }
        // Delete events can't be filtered by household, so they carry only the
        // row id. The app checks whether that id is one of ours before reloading.
        channel.on('postgres_changes' as any, { event: 'DELETE', schema: 'public', table }, (payload: any) =>
          onChange({ table, type: 'DELETE', id: payload?.old?.id ?? payload?.old?.user_id }),
        );
      }
      channel.subscribe();
      return () => {
        sb.removeChannel(channel);
      };
    },

    async renameHousehold(householdId, name) {
      const { error } = await sb.from('households').update({ name }).eq('id', householdId);
      fail(error);
    },

    async regenerateInvite(householdId) {
      const { data, error } = await sb.rpc('regenerate_invite', { p_household: householdId });
      fail(error);
      return data as string;
    },

    async removeMember(householdId, userId) {
      const { error } = await sb.from('household_members').delete().match({ household_id: householdId, user_id: userId });
      fail(error);
    },

    async leaveHousehold(householdId) {
      const me = await uid();
      const { error } = await sb.from('household_members').delete().match({ household_id: householdId, user_id: me });
      fail(error);
    },

    async deleteHousehold(householdId) {
      const { error } = await sb.from('households').delete().eq('id', householdId);
      fail(error);
    },

    async updateMyProfile(householdId, displayName, color) {
      const me = await uid();
      const a = await sb.from('profiles').update({ display_name: displayName }).eq('id', me);
      fail(a.error);
      const b = await sb.from('household_members').update({ color }).match({ household_id: householdId, user_id: me });
      fail(b.error);
    },

    async addPet(householdId, input: PetInput) {
      const { data, error } = await sb.from('pets').insert({ ...input, household_id: householdId }).select().single();
      fail(error);
      return data as Pet;
    },

    async updatePet(id, input) {
      const { error } = await sb.from('pets').update(input).eq('id', id);
      fail(error);
    },

    async deletePet(id) {
      const { error } = await sb.from('pets').delete().eq('id', id);
      fail(error);
    },

    async addRoutine(householdId, input: RoutineInput) {
      const { data, error } = await sb
        .from('routines')
        .insert({ ...input, household_id: householdId })
        .select()
        .single();
      fail(error);
      return data as Routine;
    },

    async updateRoutine(id, input) {
      const { error } = await sb.from('routines').update(input).eq('id', id);
      fail(error);
    },

    async deleteRoutine(id) {
      const { error } = await sb.from('routines').delete().eq('id', id);
      fail(error);
    },

    async completeTask(input: CompleteInput): Promise<CompleteResult> {
      const me = await uid();
      const row = {
        household_id: input.householdId,
        pet_id: input.petId,
        routine_id: input.routineId,
        occurrence_date: input.date,
        slot: input.slot,
        title: input.title,
        note: input.note ?? null,
        done_by: me,
      };
      const { data, error } = await sb.from('task_logs').insert(row).select().single();
      if (!error) return { ok: true, log: data as TaskLog };
      // 23505 = unique violation: someone else already checked this off.
      if ((error as { code?: string }).code === '23505' && input.routineId) {
        const { data: existing } = await sb
          .from('task_logs')
          .select('*')
          .match({ routine_id: input.routineId, occurrence_date: input.date, slot: input.slot })
          .maybeSingle();
        return { ok: false, existing: (existing as TaskLog) ?? null };
      }
      throw new Error(friendly(error.message));
    },

    async undoTask(logId) {
      const { error } = await sb.from('task_logs').delete().eq('id', logId);
      fail(error);
    },
  };
}

export type { ChangeEvent };
