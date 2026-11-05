import { useState, type FormEvent } from 'react';
import { MEMBER_COLORS } from '../lib/people';
import type { Member } from '../lib/types';
import { useApp } from '../state';
import { Field, Sheet, Stamp, useToast } from '../ui';

function inviteLink(code: string): string {
  const url = new URL(window.location.href);
  url.search = `?join=${code}`;
  url.hash = '';
  return url.toString();
}

export function HouseholdScreen() {
  const { backend, session, snapshot, me, run, onLeftHousehold, exitDemo } = useApp();
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

  async function share() {
    const link = inviteLink(code);
    const text = `Join ${household.name} on Herd so we can keep track of the pets together.`;
    if (navigator.share) {
      try {
        await navigator.share({ title: 'Join our household on Herd', text, url: link });
        return;
      } catch (e) {
        if ((e as Error).name === 'AbortError') return;
      }
    }
    await copy(link, 'Invite link copied');
  }

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
            Send this link to anyone who helps with the pets: a partner, roommate, kid, or sitter. They sign in and land in
            your household.
          </p>
          <p className="invite-code" aria-label={`Invite code ${code.split('').join(' ')}`}>
            {prettyCode}
          </p>
          <button className="btn btn-primary btn-block" onClick={share}>
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

      <section className="group">
        <h2 className="group-label">You</h2>
        <form className="panel stack" onSubmit={saveProfile}>
          <Field label="Your name">
            <input value={name} onChange={(e) => setName(e.target.value)} required maxLength={40} />
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
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={60} required autoFocus />
        </Field>
      </form>
    </Sheet>
  );
}
