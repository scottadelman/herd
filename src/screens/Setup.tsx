import { useState, type FormEvent } from 'react';
import type { Backend, Household } from '../lib/types';
import { Field } from '../ui';

/** Start a household or join one with a code. Used on first run and from the Household tab. */
export function SetupForms({
  backend,
  pendingJoin,
  onReady,
}: {
  backend: Backend;
  pendingJoin: string | null;
  onReady: (h: Household) => void;
}) {
  const [name, setName] = useState('');
  const [code, setCode] = useState(pendingJoin ?? '');
  const [busy, setBusy] = useState<'create' | 'join' | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function act(kind: 'create' | 'join', e: FormEvent) {
    e.preventDefault();
    setBusy(kind);
    setError(null);
    try {
      onReady(kind === 'create' ? await backend.createHousehold(name.trim()) : await backend.joinHousehold(code.trim()));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  }

  const join = (
    <form className="setup-card stack" onSubmit={(e) => act('join', e)}>
      <h2>Join a household</h2>
      <p className="muted">Someone already set things up? Enter the code from their invite.</p>
      <Field label="Invite code">
        <input
          id="join-code"
          value={code}
          onChange={(e) => setCode(e.target.value.toUpperCase())}
          required
          autoCapitalize="characters"
          autoComplete="off"
          spellCheck={false}
          className="input-code"
          placeholder="ABCD2345"
        />
      </Field>
      <button className={`btn ${pendingJoin ? 'btn-primary' : 'btn-quiet'} btn-block`} disabled={!!busy}>
        {busy === 'join' ? 'Joining…' : 'Join household'}
      </button>
    </form>
  );

  const create = (
    <form className="setup-card stack" onSubmit={(e) => act('create', e)}>
      <h2>Start a household</h2>
      <p className="muted">You’ll add your pets next, then invite the people who help care for them.</p>
      <Field label="Household name">
        <input id="household-name" value={name} onChange={(e) => setName(e.target.value)} required maxLength={60} placeholder="The Rivera house" />
      </Field>
      <button className={`btn ${pendingJoin ? 'btn-quiet' : 'btn-primary'} btn-block`} disabled={!!busy}>
        {busy === 'create' ? 'Creating…' : 'Create household'}
      </button>
    </form>
  );

  return (
    <div className="stack">
      {error && <p className="form-error">{error}</p>}
      {pendingJoin ? (
        <>
          {join}
          {create}
        </>
      ) : (
        <>
          {create}
          {join}
        </>
      )}
    </div>
  );
}

export function SetupScreen({
  backend,
  pendingJoin,
  onReady,
}: {
  backend: Backend;
  pendingJoin: string | null;
  onReady: (h: Household) => void;
}) {
  return (
    <div className="setup">
      <h1 className="screen-title">Set up your household</h1>
      <SetupForms backend={backend} pendingJoin={pendingJoin} onReady={onReady} />
      <button className="btn-text" onClick={() => backend.signOut()}>
        Sign out
      </button>
    </div>
  );
}
