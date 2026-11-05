import { useState, type FormEvent } from 'react';
import { isPreviewBuild } from '../lib/config';
import { MEMBER_COLORS } from '../lib/people';
import type { Backend } from '../lib/types';
import { Chips, Field, PetAvatar, Stamp } from '../ui';

type Mode = 'signin' | 'signup';

export function AuthScreen({
  backend,
  configured,
  onTryDemo,
}: {
  backend: Backend | null;
  configured: boolean;
  onTryDemo: () => void;
}) {
  const [mode, setMode] = useState<Mode>('signup');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!backend) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      if (mode === 'signup') {
        const { needsConfirmation } = await backend.signUp(email.trim(), password, name.trim());
        if (needsConfirmation) {
          setNotice(`Check ${email.trim()} for a confirmation link, then come back and sign in.`);
          setMode('signin');
        }
      } else {
        await backend.signIn(email.trim(), password);
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function forgot() {
    if (!backend) return;
    if (!email.trim()) {
      setError('Enter your email above first.');
      return;
    }
    try {
      await backend.sendPasswordReset(email.trim());
      setNotice(`A password reset link is on its way to ${email.trim()}.`);
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <div className="auth">
      <header className="auth-hero">
        <h1 className="wordmark">Herd</h1>
        <p className="auth-tagline">Who fed the dog? Everyone in your house will know.</p>
        <ExampleChart />
      </header>

      <section className="auth-panel">
        {backend ? (
          <form onSubmit={submit} className="stack">
            <Chips<Mode>
              label="Account"
              value={mode}
              onChange={(m) => {
                setMode(m);
                setError(null);
              }}
              options={[
                { value: 'signup', label: 'Create account' },
                { value: 'signin', label: 'Sign in' },
              ]}
            />
            {mode === 'signup' && (
              <Field label="Your name" hint="Shown to your household next to what you check off.">
                <input value={name} onChange={(e) => setName(e.target.value)} required maxLength={40} autoComplete="given-name" />
              </Field>
            )}
            <Field label="Email">
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" inputMode="email" />
            </Field>
            <Field label="Password" hint={mode === 'signup' ? 'At least 6 characters.' : undefined}>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={6}
                autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
              />
            </Field>
            {error && <p className="form-error">{error}</p>}
            {notice && <p className="form-notice">{notice}</p>}
            <button className="btn btn-primary btn-block" disabled={busy}>
              {busy ? 'One moment…' : mode === 'signup' ? 'Create account' : 'Sign in'}
            </button>
            {mode === 'signin' && (
              <button type="button" className="btn-text" onClick={forgot}>
                Forgot your password?
              </button>
            )}
          </form>
        ) : (
          <p className="muted">
            {isPreviewBuild
              ? 'This preview runs a demo household on your device. Accounts work in the deployed app.'
              : configured
                ? ''
                : 'Accounts aren’t connected yet. Add your Supabase project to config.js to turn them on (the README walks through it).'}
          </p>
        )}
        <div className="auth-demo">
          <button className={`btn ${backend ? 'btn-quiet' : 'btn-primary'} btn-block`} onClick={onTryDemo}>
            Try the demo household
          </button>
        </div>
      </section>
    </div>
  );
}

/** A tiny, static version of the Today list so the product explains itself. */
function ExampleChart() {
  const rows = [
    { emoji: '🐕', task: 'Breakfast', pet: 'Luna', who: 'Alex', color: MEMBER_COLORS[1] },
    { emoji: '🐈', task: 'Scoop litter box', pet: 'Miso', who: 'Sam', color: MEMBER_COLORS[0] },
    { emoji: '🐠', task: 'Feed', pet: 'Bubbles', who: null, color: '' },
  ];
  return (
    <ul className="example-chart" aria-label="Example: today’s pet care, checked off by different people">
      {rows.map((r) => (
        <li key={r.task}>
          <PetAvatar emoji={r.emoji} size="sm" />
          <span className="example-text">
            <strong>{r.task}</strong>
            <span>{r.pet}</span>
          </span>
          {r.who ? <Stamp name={r.who} color={r.color} size="sm" /> : <span className="stamp-empty stamp-sm" />}
        </li>
      ))}
    </ul>
  );
}
