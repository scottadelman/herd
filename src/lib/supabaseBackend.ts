import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { AppConfig } from './config';
import type {
  Backend,
  CompleteInput,
  CompleteResult,
  Household,
  Member,
  Pet,
  PetInput,
  Place,
  Routine,
  RoutineInput,
  Session,
  SitterLink,
  SitterSnapshot,
  Snapshot,
  Supply,
  TaskLog,
  Weight,
} from './types';
import { EMPTY_PROFILE } from './types';

function fail(error: { message: string } | null): void {
  if (error) throw new Error(friendly(error.message));
}

function friendly(message: string): string {
  if (/invalid login credentials/i.test(message)) return 'That email and password don’t match an account.';
  if (/email not confirmed/i.test(message)) return 'Confirm your email first. Check your inbox for the link.';
  if (/user already registered/i.test(message)) return 'An account with that email already exists. Sign in instead.';
  if (/password should be at least/i.test(message)) return 'Use a password with at least 6 characters.';
  if (/pets_photo_check|value too long/i.test(message)) return 'That photo is too large. Try a different one.';
  if (/row-level security/i.test(message)) return 'You can only change your own check-offs.';
  if (/could not find the function|column .* does not exist|schema cache|relation .* does not exist/i.test(message))
    return 'The database needs the latest update. Whoever set up Herd should run the newest file in supabase/migrations in the Supabase SQL Editor (see the README).';
  return message;
}

/** Fills in profile fields a database without update 003 doesn't have. */
const normalizePet = (p: Partial<Pet>): Pet =>
  ({
    ...EMPTY_PROFILE,
    ...Object.fromEntries(Object.entries(p).filter(([, v]) => v !== undefined)),
    allergies: p.allergies ?? [],
    likes: p.likes ?? [],
    dislikes: p.dislikes ?? [],
  }) as Pet;

/** True when a query failed only because a table from a newer update is missing. */
const missingTable = (error: { message?: string; code?: string } | null) =>
  !!error && (error.code === '42P01' || error.code === 'PGRST205' || /does not exist|schema cache/i.test(error.message ?? ''));

const toSession = (u: { id: string; email?: string | null } | null | undefined): Session | null =>
  u ? { userId: u.id, email: u.email ?? '' } : null;

const localTimezone = () => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || null;
  } catch {
    return null;
  }
};

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

  const redirect = () => window.location.origin + window.location.pathname;

  return {
    kind: 'supabase',
    supportsPush: true,

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
        options: { data: { display_name: displayName }, emailRedirectTo: redirect() },
      });
      fail(error);
      return { needsConfirmation: !data.session };
    },

    async signIn(email, password) {
      const { error } = await sb.auth.signInWithPassword({ email, password });
      fail(error);
    },

    async sendPasswordReset(email) {
      const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: redirect() });
      fail(error);
    },

    async signOut() {
      await sb.auth.signOut();
    },

    async listMyHouseholds() {
      const me = await uid();
      const { data, error } = await sb
        .from('household_members')
        .select('joined_at, household:households(*)')
        .eq('user_id', me)
        .order('joined_at', { ascending: true });
      fail(error);
      return ((data ?? []) as unknown as { household: Household | null }[])
        .map((row) => row.household)
        .filter((h): h is Household => !!h);
    },

    async createHousehold(name) {
      const { data, error } = await sb.rpc('create_household', { p_name: name, p_timezone: localTimezone() });
      fail(error);
      return data as Household;
    },

    async joinHousehold(code) {
      const { data, error } = await sb.rpc('join_household', { p_code: code });
      fail(error);
      return data as Household;
    },

    async loadSnapshot(householdId, sinceDate) {
      const [h, m, p, r, l, w, s] = await Promise.all([
        sb.from('households').select('*').eq('id', householdId).single(),
        sb
          .from('household_members')
          .select('user_id, role, color, notify_late, notify_daily, joined_at, profile:profiles(display_name)')
          .eq('household_id', householdId)
          .order('joined_at'),
        sb.from('pets').select('*').eq('household_id', householdId).order('created_at'),
        sb.from('routines').select('*').eq('household_id', householdId).order('created_at'),
        sb
          .from('task_logs')
          .select('*')
          .eq('household_id', householdId)
          .or(`occurrence_date.gte.${sinceDate},snoozed_to.gte.${sinceDate}`)
          .order('done_at', { ascending: false })
          .limit(2000),
        sb.from('pet_weights').select('*').eq('household_id', householdId).order('weighed_on'),
        sb
          .from('sitter_links')
          .select('*')
          .eq('household_id', householdId)
          .eq('revoked', false)
          .gt('expires_at', new Date().toISOString())
          .order('created_at'),
      ]);
      for (const res of [h, m, p, r, l, w, s]) fail(res.error);
      // Supplies and places came with update 003. Until it's run, the rest of
      // the app keeps working and those parts say the database needs updating.
      const [sup, pl] = await Promise.all([
        sb.from('supplies').select('*').eq('household_id', householdId).order('created_at'),
        sb.from('places').select('*').eq('household_id', householdId).order('created_at'),
      ]);
      const behind = missingTable(sup.error) || missingTable(pl.error);
      if (!behind) for (const res of [sup, pl]) fail(res.error);
      const members: Member[] = (m.data ?? []).map((row: any) => ({
        user_id: row.user_id,
        role: row.role,
        color: row.color,
        notify_late: row.notify_late ?? true,
        notify_daily: row.notify_daily ?? null,
        notify_supplies: row.notify_supplies ?? true,
        display_name: row.profile?.display_name ?? 'Someone',
      }));
      return {
        household: h.data as Household,
        members,
        pets: ((p.data ?? []) as Pet[]).map(normalizePet),
        routines: (r.data ?? []) as Routine[],
        logs: (l.data ?? []) as TaskLog[],
        weights: ((w.data ?? []) as Weight[]).map((x) => ({ ...x, weight: Number(x.weight) })),
        sitterLinks: (s.data ?? []) as SitterLink[],
        supplies: behind ? [] : ((sup.data ?? []) as Supply[]),
        places: behind ? [] : ((pl.data ?? []) as Place[]),
        behind,
      } satisfies Snapshot;
    },

    async loadLogs(householdId, fromDate, toDate) {
      const { data, error } = await sb
        .from('task_logs')
        .select('*')
        .eq('household_id', householdId)
        .or(`and(occurrence_date.gte.${fromDate},occurrence_date.lte.${toDate}),and(snoozed_to.gte.${fromDate},snoozed_to.lte.${toDate})`)
        .order('done_at', { ascending: false })
        .limit(5000);
      fail(error);
      return (data ?? []) as TaskLog[];
    },

    subscribe(householdId, onChange) {
      const channel = sb.channel(`household-${householdId}`);
      const tables = ['task_logs', 'pets', 'routines', 'household_members', 'households', 'pet_weights', 'sitter_links'];
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
      // Tables from update 003 get their own channel, so a database that
      // hasn't run it yet still gets live updates for everything else.
      const extra = sb.channel(`household-${householdId}-extra`);
      for (const table of ['supplies', 'places']) {
        for (const event of ['INSERT', 'UPDATE'] as const) {
          extra.on('postgres_changes' as any, { event, schema: 'public', table, filter: `household_id=eq.${householdId}` }, () =>
            onChange({ table, type: event }),
          );
        }
        extra.on('postgres_changes' as any, { event: 'DELETE', schema: 'public', table }, (payload: any) =>
          onChange({ table, type: 'DELETE', id: payload?.old?.id }),
        );
      }
      extra.subscribe();
      return () => {
        sb.removeChannel(channel);
        sb.removeChannel(extra);
      };
    },

    async renameHousehold(householdId, name) {
      const { error } = await sb.from('households').update({ name }).eq('id', householdId);
      fail(error);
    },

    async setHouseholdTimezone(householdId, timezone) {
      const { error } = await sb.from('households').update({ timezone }).eq('id', householdId);
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

    async updateMyReminders(householdId, prefs) {
      const me = await uid();
      const { error } = await sb.from('household_members').update(prefs).match({ household_id: householdId, user_id: me });
      fail(error);
    },

    async addPet(householdId, input: PetInput) {
      const { data, error } = await sb.from('pets').insert({ ...input, household_id: householdId }).select().single();
      fail(error);
      return normalizePet(data as Pet);
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
        status: input.status ?? 'done',
        snoozed_to: input.snoozedTo ?? null,
        done_by: me,
        ...(input.doneAt ? { done_at: input.doneAt } : {}),
      };
      const { data, error } = await sb.from('task_logs').insert(row).select().single();
      if (!error) return { ok: true, log: data as TaskLog };
      // 23505 = unique violation: someone else already resolved this one.
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

    async finishMoved(logId, status, note) {
      const me = await uid();
      const { data, error } = await sb
        .from('task_logs')
        .update({ status, done_by: me, done_at: new Date().toISOString(), note: note ?? null })
        .eq('id', logId)
        .eq('status', 'snoozed')
        .select();
      fail(error);
      if (data && data.length) return { ok: true, log: data[0] as TaskLog };
      const { data: existing } = await sb.from('task_logs').select('*').eq('id', logId).maybeSingle();
      return { ok: false, existing: (existing as TaskLog) ?? null };
    },

    async updateLog(logId, patch) {
      const { error } = await sb.from('task_logs').update(patch).eq('id', logId);
      fail(error);
    },

    async undoTask(logId) {
      const { error } = await sb.from('task_logs').delete().eq('id', logId);
      fail(error);
    },

    async addWeight(householdId, input) {
      const { data, error } = await sb.from('pet_weights').insert({ ...input, household_id: householdId }).select().single();
      fail(error);
      return { ...(data as Weight), weight: Number((data as Weight).weight) };
    },

    async deleteWeight(id) {
      const { error } = await sb.from('pet_weights').delete().eq('id', id);
      fail(error);
    },

    async addSupply(householdId, input) {
      const { data, error } = await sb.from('supplies').insert({ ...input, household_id: householdId }).select().single();
      fail(error);
      return data as Supply;
    },

    async updateSupply(id, patch) {
      const { error } = await sb.from('supplies').update(patch).eq('id', id);
      fail(error);
    },

    async deleteSupply(id) {
      const { error } = await sb.from('supplies').delete().eq('id', id);
      fail(error);
    },

    async addPlace(householdId, input) {
      const { data, error } = await sb.from('places').insert({ ...input, household_id: householdId }).select().single();
      fail(error);
      return data as Place;
    },

    async updatePlace(id, input) {
      const { error } = await sb.from('places').update(input).eq('id', id);
      fail(error);
    },

    async deletePlace(id) {
      const { error } = await sb.from('places').delete().eq('id', id);
      fail(error);
    },

    async createSitterLink(householdId, input) {
      const { data, error } = await sb.from('sitter_links').insert({ ...input, household_id: householdId }).select().single();
      fail(error);
      return data as SitterLink;
    },

    async revokeSitterLink(id) {
      const { error } = await sb.from('sitter_links').update({ revoked: true }).eq('id', id);
      fail(error);
    },

    async sitterView(token) {
      const { data, error } = await sb.rpc('sitter_view', { p_token: token });
      fail(error);
      const snap = data as SitterSnapshot;
      return { ...snap, pets: snap.pets.map(normalizePet), places: snap.places ?? [] };
    },

    async sitterComplete(token, routineId, date, slot, note) {
      const { data, error } = await sb.rpc('sitter_complete', {
        p_token: token,
        p_routine: routineId,
        p_date: date,
        p_slot: slot,
        p_note: note ?? null,
      });
      fail(error);
      const res = data as { ok: boolean; log: TaskLog };
      return res.ok ? { ok: true, log: res.log } : { ok: false, existing: res.log ?? null };
    },

    async sitterUndo(token, logId) {
      const { error } = await sb.rpc('sitter_undo', { p_token: token, p_log: logId });
      fail(error);
    },

    async getPushPublicKey() {
      const { data, error } = await sb.rpc('get_push_public_key');
      fail(error);
      return (data as string | null) ?? null;
    },

    async savePushSubscription(keys) {
      const { error } = await sb.rpc('save_push_subscription', {
        p_endpoint: keys.endpoint,
        p_p256dh: keys.p256dh,
        p_auth: keys.auth,
      });
      fail(error);
    },

    async deletePushSubscription(endpoint) {
      const { error } = await sb.rpc('delete_push_subscription', { p_endpoint: endpoint });
      fail(error);
    },
  };
}
