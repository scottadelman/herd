import { useEffect, useState, type FormEvent } from 'react';
import { dayPhrase, formatTime, toISODate } from '../lib/dates';
import { MEMBER_COLORS } from '../lib/people';
import { currentSubscription, disablePush, enablePush, pushSupport } from '../lib/push';
import type { Member, SitterLink } from '../lib/types';
import { useApp } from '../state';
import { Chips, Field, PetAvatar, Sheet, Stamp, useToast } from '../ui';

function linkWith(param: string, value: string): string {
  const url = new URL(window.location.href);
  url.search = `?${param}=${value}`;
  url.hash = '';
  return url.toString();
}

async function shareOrCopy(title: string, text: string, url: string, toast: (t: string) => void) {
  if (navigator.share) {
    try {
      await navigator.share({ title, text, url });
      return;
    } catch (e) {
      if ((e as Error).name === 'AbortError') return;
    }
  }
  try {
    await navigator.clipboard.writeText(url);
    toast('Link copied');
  } catch {
    toast(`Copy this link: ${url}`);
  }
}

export function HouseholdScreen() {
  const { backend, session, snapshot, me, run, onLeftHousehold, exitDemo, households, switchHousehold, addHousehold } = useApp();
  const toast = useToast();
  const { household, members } = snapshot;
  const isOwner = me.role === 'owner';
  const isDemo = backend.kind === 'demo';
  const [renaming, setRenaming] = useState(false);
  const [removing, setRemoving] = useState<Member | null>(null);
  const [leaving, setLeaving] = useState(false);
  const [name, setName] = useState(me.display_name);
  const [color, setColor] = useState(me.color);
  const code = household.invite_code;
  const prettyCode = `${code.slice(0, 4)} ${code.slice(4)}`;

  async function copy(text: string, done: string) {
    try {
      await navigator.clipboard.writeText(text);
      toast(done);
    } catch {
      toast(`Copy this: ${text}`);
    }
  }

  async function saveProfile(e: FormEvent) {
    e.preventDefault();
    await run(() => backend.updateMyProfile(household.id, name.trim(), color), 'Saved');
  }

  const profileChanged = name.trim() !== me.display_name || color !== me.color;

  return (
    <>
      <header className="screen-head">
        <h1 className="screen-title">{household.name}</h1>
        {isOwner && (
          <button className="btn-text" onClick={() => setRenaming(true)}>
            Rename household
          </button>
        )}
      </header>

      {(households.length > 1 || !isDemo) && (
        <section className="group">
          <h2 className="group-label">Your households</h2>
          <ul className="list">
            {households.map((h) => (
              <li key={h.id}>
                <button
                  className="row row-button"
                  onClick={() => h.id !== household.id && switchHousehold(h.id)}
                  aria-current={h.id === household.id ? 'true' : undefined}
                >
                  <span className="row-text">
                    <span className="row-title">{h.name}</span>
                    <span className="row-meta">{h.id === household.id ? 'Showing now' : 'Tap to switch'}</span>
                  </span>
                  {h.id === household.id && <span className="turn">Current</span>}
                </button>
              </li>
            ))}
          </ul>
          <button className="btn-text" onClick={addHousehold}>
            Add or join another household
          </button>
        </section>
      )}

      <section className="group">
        <h2 className="group-label">People</h2>
        <ul className="list">
          {members.map((m) => (
            <li key={m.user_id} className="row">
              <Stamp name={m.display_name} color={m.color} size="sm" />
              <div className="row-text">
                <span className="row-title">
                  {m.display_name}
                  {m.user_id === me.user_id ? ' (you)' : ''}
                </span>
                <span className="row-meta">{m.role === 'owner' ? 'Owner' : 'Member'}</span>
              </div>
              {isOwner && m.user_id !== me.user_id && (
                <button className="btn-text" onClick={() => setRemoving(m)}>
                  Remove
                </button>
              )}
            </li>
          ))}
        </ul>
      </section>

      <section className="group">
        <h2 className="group-label">Invite someone</h2>
        <div className="panel stack">
          <p className="muted">
            For people who help every day: a partner, roommate or kid. They make an account and see everything, including the
            calendar and all the history from before they joined. For a walker or sitter, use a sitter link below instead.
          </p>
          <p className="invite-code" aria-label={`Invite code ${code.split('').join(' ')}`}>
            {prettyCode}
          </p>
          <button
            className="btn btn-primary btn-block"
            onClick={() =>
              shareOrCopy(
                'Join our household on Herd',
                `Join ${household.name} on Herd so we can keep track of the pets together.`,
                linkWith('join', code),
                toast,
              )
            }
          >
            Share invite link
          </button>
          <div className="text-actions">
            <button className="btn-text" onClick={() => copy(code, 'Code copied')}>
              Copy code
            </button>
            {isOwner && (
              <button
                className="btn-text"
                onClick={() => run(() => backend.regenerateInvite(household.id), 'New code made. The old one no longer works.')}
              >
                Make a new code
              </button>
            )}
          </div>
        </div>
      </section>

      <SitterLinks />

      <RemindersPanel />

      <section className="group">
        <h2 className="group-label">You</h2>
        <form className="panel stack" onSubmit={saveProfile}>
          <Field label="Your name">
            <input id="profile-name" value={name} onChange={(e) => setName(e.target.value)} required maxLength={40} />
          </Field>
          <div className="field">
            <span className="field-label">Your stamp color</span>
            <div className="swatches" role="radiogroup" aria-label="Your stamp color">
              {MEMBER_COLORS.map((c) => (
                <button
                  type="button"
                  key={c}
                  role="radio"
                  aria-checked={color === c}
                  aria-label={c}
                  className={`swatch${color === c ? ' swatch-on' : ''}`}
                  onClick={() => setColor(c)}
                >
                  <Stamp name={name || '?'} color={c} size="sm" />
                </button>
              ))}
            </div>
          </div>
          <button className="btn btn-quiet" disabled={!profileChanged || !name.trim()}>
            Save
          </button>
        </form>
      </section>

      <section className="group">
        <h2 className="group-label">Account</h2>
        <div className="panel stack">
          {isDemo ? (
            <>
              <p className="muted">You’re in the demo household. Nothing here is saved to an account.</p>
              <button className="btn btn-quiet" onClick={exitDemo}>
                Exit demo
              </button>
            </>
          ) : (
            <>
              <p className="muted">Signed in as {session.email}</p>
              <button className="btn btn-quiet" onClick={() => backend.signOut()}>
                Sign out
              </button>
              <button className="btn-text btn-text-danger" onClick={() => setLeaving(true)}>
                {isOwner ? 'Delete household' : 'Leave household'}
              </button>
            </>
          )}
        </div>
      </section>

      {renaming && <RenameSheet onClose={() => setRenaming(false)} />}

      {removing && (
        <Sheet
          title={`Remove ${removing.display_name}?`}
          onClose={() => setRemoving(null)}
          footer={
            <button
              className="btn btn-danger btn-block"
              onClick={async () => {
                const who = removing;
                setRemoving(null);
                await run(() => backend.removeMember(household.id, who.user_id), `Removed ${who.display_name}`);
              }}
            >
              Remove {removing.display_name}
            </button>
          }
        >
          <p>
            They’ll lose access to {household.name}. Their past check-offs stay in Activity. Make a new invite code too if
            they still have the old link.
          </p>
        </Sheet>
      )}

      {leaving && (
        <Sheet
          title={isOwner ? `Delete ${household.name}?` : `Leave ${household.name}?`}
          onClose={() => setLeaving(false)}
          footer={
            <button
              className="btn btn-danger btn-block"
              onClick={async () => {
                setLeaving(false);
                const ok = await run(async () => {
                  if (isOwner) await backend.deleteHousehold(household.id);
                  else await backend.leaveHousehold(household.id);
                  return true;
                });
                if (ok) onLeftHousehold();
              }}
            >
              {isOwner ? 'Delete household' : 'Leave household'}
            </button>
          }
        >
          <p>
            {isOwner
              ? 'This removes every pet, routine and check-off for everyone in the household. It can’t be undone.'
              : 'You’ll stop seeing these pets. Someone can invite you back later.'}
          </p>
        </Sheet>
      )}
    </>
  );
}

/* ---------- Sitter links ---------- */

function SitterLinks() {
  const { backend, snapshot, run, openSitterPreview } = useApp();
  const toast = useToast();
  const [creating, setCreating] = useState(false);
  const links = snapshot.sitterLinks;
  const petNames = (l: SitterLink) =>
    l.pet_ids.length === 0 || l.pet_ids.length === snapshot.pets.length
      ? 'All pets'
      : snapshot.pets
          .filter((p) => l.pet_ids.includes(p.id))
          .map((p) => p.name)
          .join(', ') || 'No pets';

  const share = (l: SitterLink) =>
    shareOrCopy(
      `Pet care for ${snapshot.household.name}`,
      `Hi ${l.label}, here’s today’s pet care checklist. Tap things off as you do them.`,
      linkWith('sit', l.token),
      toast,
    );

  return (
    <section className="group">
      <div className="group-head">
        <h2 className="group-label">Sitter links</h2>
        <button className="btn-text" onClick={() => setCreating(true)}>
          New sitter link
        </button>
      </div>
      {links.length === 0 ? (
        <div className="panel">
          <p className="muted">
            Give a dog walker or sitter a link that works without an account. They see only today’s tasks and the pet notes,
            check things off, and the link stops working on the date you pick.
          </p>
        </div>
      ) : (
        <ul className="list">
          {links.map((l) => (
            <li key={l.id} className="row sitter-row">
              <div className="row-text">
                <span className="row-title">{l.label}</span>
                <span className="row-meta">
                  <span className="row-meta-text">
                    {petNames(l)}, works until {dayPhrase(toISODate(new Date(l.expires_at)))}
                  </span>
                </span>
                <span className="text-actions">
                  <button className="btn-text" onClick={() => share(l)}>
                    Share link
                  </button>
                  <button className="btn-text" onClick={() => openSitterPreview(l.token)}>
                    See what they see
                  </button>
                  <button className="btn-text btn-text-danger" onClick={() => run(() => backend.revokeSitterLink(l.id), `${l.label}’s link turned off`)}>
                    Turn off
                  </button>
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}
      {creating && (
        <SitterLinkSheet
          onClose={() => setCreating(false)}
          onCreated={(l) => {
            setCreating(false);
            share(l);
          }}
        />
      )}
    </section>
  );
}

const DURATIONS: { value: string; label: string; days: number }[] = [
  { value: '1', label: 'Today only', days: 1 },
  { value: '3', label: '3 days', days: 3 },
  { value: '7', label: '1 week', days: 7 },
  { value: '14', label: '2 weeks', days: 14 },
  { value: '30', label: '1 month', days: 30 },
];

function SitterLinkSheet({ onClose, onCreated }: { onClose: () => void; onCreated: (l: SitterLink) => void }) {
  const { backend, snapshot, run } = useApp();
  const [label, setLabel] = useState('');
  const [petIds, setPetIds] = useState<string[]>(snapshot.pets.map((p) => p.id));
  const [duration, setDuration] = useState('7');
  const [busy, setBusy] = useState(false);

  async function create(e: FormEvent) {
    e.preventDefault();
    if (!label.trim() || !petIds.length) return;
    setBusy(true);
    const days = DURATIONS.find((d) => d.value === duration)?.days ?? 7;
    const end = new Date();
    end.setDate(end.getDate() + days - 1);
    end.setHours(23, 59, 0, 0);
    const link = await run(
      () =>
        backend.createSitterLink(snapshot.household.id, {
          label: label.trim(),
          pet_ids: petIds.length === snapshot.pets.length ? [] : petIds,
          expires_at: end.toISOString(),
        }),
      'Sitter link ready',
    );
    setBusy(false);
    if (link) onCreated(link);
  }

  return (
    <Sheet
      title="New sitter link"
      onClose={onClose}
      footer={
        <button className="btn btn-primary btn-block" form="sitter-form" disabled={busy || !label.trim() || !petIds.length}>
          Create and share link
        </button>
      }
    >
      <form id="sitter-form" className="stack" onSubmit={create}>
        <Field label="Who it’s for" hint="Shown on their check-offs, like “Maria (sitter)”.">
          <input id="sitter-label" value={label} onChange={(e) => setLabel(e.target.value)} maxLength={40} placeholder="Maria" autoFocus required />
        </Field>
        <div className="field">
          <span className="field-label">Pets they look after</span>
          <div className="chips">
            {snapshot.pets.map((p) => {
              const on = petIds.includes(p.id);
              return (
                <button
                  type="button"
                  key={p.id}
                  aria-pressed={on}
                  className={`chip chip-pet${on ? ' chip-on' : ''}`}
                  onClick={() => setPetIds(on ? petIds.filter((x) => x !== p.id) : [...petIds, p.id])}
                >
                  <PetAvatar emoji={p.emoji} photo={p.photo} size="sm" />
                  {p.name}
                </button>
              );
            })}
          </div>
          {!petIds.length && <span className="field-hint late">Pick at least one pet.</span>}
        </div>
        <div className="field">
          <span className="field-label">Link works for</span>
          <Chips<string> label="Link works for" value={duration} onChange={setDuration} options={DURATIONS.map((d) => ({ value: d.value, label: d.label }))} />
        </div>
        <p className="muted small">
          They’ll see today’s tasks for these pets, each pet’s feeding, allergies, likes and dislikes and vet, and your walk
          map, and can check things off. They won’t see the calendar, history, other pets, or your household’s people and
          invite code.
        </p>
      </form>
    </Sheet>
  );
}

/* ---------- Reminders ---------- */

function RemindersPanel() {
  const { backend, snapshot, me, run } = useApp();
  const toast = useToast();
  const support = pushSupport();
  const [on, setOn] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [dailyTime, setDailyTime] = useState(me.notify_daily ?? '07:30');

  useEffect(() => {
    let alive = true;
    currentSubscription()
      .then((s) => alive && setOn(!!s))
      .catch(() => alive && setOn(false));
    return () => {
      alive = false;
    };
  }, []);

  const save = (prefs: Partial<Pick<Member, 'notify_late' | 'notify_daily' | 'notify_supplies'>>) =>
    run(() => backend.updateMyReminders(snapshot.household.id, prefs));

  async function toggleDevice() {
    setBusy(true);
    try {
      if (on) {
        await disablePush(backend);
        setOn(false);
        toast('Reminders turned off on this phone');
      } else {
        await enablePush(backend);
        setOn(true);
        toast('Reminders are on for this phone');
      }
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  }

  let deviceRow: JSX.Element;
  if (backend.kind === 'demo') {
    deviceRow = <p className="muted">Reminders work in the real app. You can still try the settings below.</p>;
  } else if (support === 'needs-install') {
    deviceRow = (
      <p className="muted">
        To get reminders on this iPhone, tap Share, then Add to Home Screen. Open Herd from your Home Screen and turn them on
        here.
      </p>
    );
  } else if (support === 'unsupported') {
    deviceRow = <p className="muted">This browser can’t show reminders. Try Herd on your phone.</p>;
  } else {
    deviceRow = (
      <div className="stack-tight">
        <p>{on ? 'Reminders are on for this phone.' : 'Reminders are off on this phone.'}</p>
        <button className={`btn ${on ? 'btn-quiet' : 'btn-primary'}`} onClick={toggleDevice} disabled={busy || on === null}>
          {on ? 'Turn off on this phone' : 'Turn on reminders'}
        </button>
      </div>
    );
  }

  return (
    <section className="group">
      <h2 className="group-label">Reminders</h2>
      <div className="panel stack">
        {deviceRow}
        <label className="check-row">
          <input
            id="notify-late"
            type="checkbox"
            checked={me.notify_late}
            onChange={(e) => save({ notify_late: e.target.checked })}
          />
          <span>
            When a task is 30 minutes late
            <span className="muted"> Goes to whoever it’s assigned to, or everyone if it’s anyone’s job.</span>
          </span>
        </label>
        <label className="check-row">
          <input
            id="notify-daily"
            type="checkbox"
            checked={!!me.notify_daily}
            onChange={(e) => save({ notify_daily: e.target.checked ? dailyTime : null })}
          />
          <span>
            Morning summary{me.notify_daily ? ` at ${formatTime(me.notify_daily)}` : ''}
            <span className="muted"> Today’s tasks, plus medications, vaccines and vet visits coming up tomorrow.</span>
          </span>
        </label>

        {me.notify_daily && (
          <div className="time-row">
            <input
              id="notify-daily-time"
              type="time"
              value={dailyTime}
              aria-label="Morning summary time"
              onChange={(e) => setDailyTime(e.target.value)}
            />
            <button className="btn-text" disabled={dailyTime === me.notify_daily || !dailyTime} onClick={() => save({ notify_daily: dailyTime })}>
              Save time
            </button>
          </div>
        )}
        <label className="check-row">
          <input
            id="notify-supplies"
            type="checkbox"
            checked={me.notify_supplies}
            disabled={snapshot.behind}
            onChange={(e) => save({ notify_supplies: e.target.checked })}
          />
          <span>
            When it’s time to order food or supplies
            <span className="muted"> At 9 AM on the order-by day, and again the day before it runs out if nobody has ordered.</span>
          </span>
        </label>
      </div>
    </section>
  );
}

function RenameSheet({ onClose }: { onClose: () => void }) {
  const { backend, snapshot, run } = useApp();
  const [name, setName] = useState(snapshot.household.name);
  return (
    <Sheet
      title="Rename household"
      onClose={onClose}
      footer={
        <button className="btn btn-primary btn-block" form="rename-form" disabled={!name.trim()}>
          Save name
        </button>
      }
    >
      <form
        id="rename-form"
        onSubmit={async (e) => {
          e.preventDefault();
          onClose();
          await run(() => backend.renameHousehold(snapshot.household.id, name.trim()), 'Saved');
        }}
      >
        <Field label="Household name">
          <input id="rename-input" value={name} onChange={(e) => setName(e.target.value)} maxLength={60} required autoFocus />
        </Field>
      </form>
    </Sheet>
  );
}
