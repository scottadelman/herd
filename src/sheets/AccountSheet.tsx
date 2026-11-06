import { useRef, useState, type FormEvent } from 'react';
import { MEMBER_COLORS } from '../lib/people';
import { photoToDataUrl } from '../lib/photo';
import { useApp } from '../state';
import { Field, Icons, Sheet, Stamp } from '../ui';

/** Your photo, or your stamp if you haven't added one. */
export function Avatar({ name, color, photo, size = 'md' }: { name: string; color: string; photo: string | null; size?: 'sm' | 'md' | 'lg' }) {
  if (photo) {
    return (
      <span className={`person-photo person-photo-${size}`} aria-hidden="true">
        <img src={photo} alt="" />
      </span>
    );
  }
  return <Stamp name={name} color={color} size={size} />;
}

/**
 * Your account, separate from any one household: photo, name, phone, the
 * email you sign in with, signing out, and deleting the account.
 */
export function AccountSheet({ onClose }: { onClose: () => void }) {
  const { backend, session, snapshot, me, households, run, exitDemo } = useApp();
  const isDemo = backend.kind === 'demo';
  const [name, setName] = useState(me.display_name);
  const [phone, setPhone] = useState(me.phone ?? '');
  const [photo, setPhoto] = useState<string | null>(me.avatar);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const [color, setColor] = useState(me.color);
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const accountChanged = name.trim() !== me.display_name || (phone.trim() || null) !== (me.phone ?? null) || photo !== me.avatar;
  const colorChanged = color !== me.color;
  const owned = households.filter((h) => h.created_by === session.userId);

  async function onFile(file: File | undefined) {
    if (!file) return;
    setPhotoError(null);
    try {
      setPhoto(await photoToDataUrl(file));
    } catch (e) {
      setPhotoError((e as Error).message);
    }
  }

  async function save(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    const ok = await run(async () => {
      if (accountChanged) await backend.updateMyAccount({ display_name: name.trim(), phone: phone.trim() || null, avatar: photo });
      if (colorChanged) await backend.updateMyColor(snapshot.household.id, color);
      return true;
    }, 'Saved');
    setBusy(false);
    if (ok) onClose();
  }

  async function remove() {
    setBusy(true);
    await run(() => backend.deleteMyAccount());
    setBusy(false);
  }

  return (
    <Sheet
      title="Your account"
      onClose={onClose}
      footer={
        <button className="btn btn-primary btn-block" form="account-form" disabled={busy || !name.trim() || (!accountChanged && !colorChanged)}>
          Save changes
        </button>
      }
    >
      <form id="account-form" className="stack" onSubmit={save}>
        <div className="photo-pick">
          <Avatar name={name || '?'} color={color} photo={photo} size="lg" />
          <div className="stack-tight">
            <button type="button" className="btn btn-quiet btn-small" onClick={() => fileRef.current?.click()}>
              {Icons.camera}
              {photo ? 'Change photo' : 'Add a photo'}
            </button>
            {photo && (
              <button type="button" className="btn-text btn-text-small" onClick={() => setPhoto(null)}>
                Remove photo
              </button>
            )}
            <input
              ref={fileRef}
              id="account-photo"
              type="file"
              accept="image/*"
              hidden
              onChange={(e) => {
                onFile(e.target.files?.[0]);
                e.target.value = '';
              }}
            />
          </div>
        </div>
        {photoError && <p className="form-error">{photoError}</p>}

        <Field label="Your name">
          <input id="account-name" value={name} onChange={(e) => setName(e.target.value)} required maxLength={40} autoComplete="name" />
        </Field>
        <Field label="Phone" hint="People in your households can see it and call you from Herd. It goes on care sheets too.">
          <input id="account-phone" type="tel" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} maxLength={30} autoComplete="tel" />
        </Field>
        <div className="field">
          <span className="field-label">Email</span>
          <p className="account-email">{isDemo ? 'jamie@example.com (demo)' : session.email}</p>
          <span className="field-hint">The email you sign in with.</span>
        </div>

        <div className="field">
          <span className="field-label">Your stamp color in {snapshot.household.name}</span>
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
          <span className="field-hint">It marks your check-offs.</span>
        </div>

        <div className="account-actions">
          {isDemo ? (
            <button type="button" className="btn btn-quiet" onClick={exitDemo}>
              Exit demo
            </button>
          ) : (
            <button type="button" className="btn btn-quiet" onClick={() => backend.signOut()}>
              Sign out
            </button>
          )}
        </div>

        {confirmDelete ? (
          <div className="danger-zone">
            <p>
              <strong>Delete your account?</strong> You’ll be signed out everywhere and can’t get it back.
            </p>
            <ul className="danger-list">
              <li>Your check-offs stay in each household’s history, under your name.</li>
              {owned.map((h) => (
                <li key={h.id}>
                  {h.id === snapshot.household.id && snapshot.members.length > 1
                    ? `${h.name} passes to ${snapshot.members.find((m) => m.user_id !== me.user_id)?.display_name ?? 'the next person'}, the next person who joined.`
                    : `${h.name} passes to the next person who joined, or is deleted with its pets if nobody else is in it.`}
                </li>
              ))}
            </ul>
            <div className="btn-pair">
              <button type="button" className="btn btn-quiet" onClick={() => setConfirmDelete(false)}>
                Keep my account
              </button>
              <button type="button" className="btn btn-danger" onClick={remove} disabled={busy || isDemo}>
                Delete it
              </button>
            </div>
            {isDemo && <p className="muted small">The demo account can’t be deleted.</p>}
          </div>
        ) : (
          <button type="button" className="btn-text btn-text-danger" onClick={() => setConfirmDelete(true)}>
            Delete my account
          </button>
        )}
      </form>
    </Sheet>
  );
}
