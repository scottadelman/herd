import { useMemo, useState, type FormEvent } from 'react';
import { addDays, formatClock, formatDayLabel, todayISO, dayPhrase } from '../lib/dates';
import { memberById } from '../lib/people';
import { QUICK_LOGS } from '../lib/pets';
import type { TaskLog } from '../lib/types';
import { HISTORY_DAYS, useApp, whoDid } from '../state';
import { Chips, Field, Sheet, Stamp } from '../ui';

const SITTER_GREY = '#7B8794';

export function ActivityScreen() {
  const { snapshot, me } = useApp();
  const [logging, setLogging] = useState(false);

  const days = useMemo(() => {
    const sorted = [...snapshot.logs].sort((a, b) => b.done_at.localeCompare(a.done_at));
    const map = new Map<string, TaskLog[]>();
    for (const l of sorted) {
      // Entries go under the day they happened.
      const day = l.done_at ? localDay(l.done_at) : l.occurrence_date;
      if (!map.has(day)) map.set(day, []);
      map.get(day)!.push(l);
    }
    return [...map.entries()].sort((a, b) => b[0].localeCompare(a[0]));
  }, [snapshot.logs]);

  const petName = (id: string) => snapshot.pets.find((p) => p.id === id)?.name ?? 'a pet';

  return (
    <>
      <header className="screen-head screen-head-row">
        <h1 className="screen-title">Activity</h1>
        {snapshot.pets.length > 0 && (
          <button className="btn btn-primary btn-small" onClick={() => setLogging(true)}>
            Log something
          </button>
        )}
      </header>

      <ThisWeek />

      {days.length === 0 ? (
        <div className="empty">
          <p>Everything your household checks off shows up here, newest first.</p>
        </div>
      ) : (
        days.map(([day, logs]) => (
          <section key={day} className="group">
            <h2 className="group-label">{formatDayLabel(day)}</h2>
            <ul className="list">
              {logs.map((l) => {
                const who = memberById(snapshot.members, l.done_by);
                const name = whoDid(l, snapshot.members, me.user_id, true);
                const verb =
                  l.status === 'skipped'
                    ? 'skipped this'
                    : l.status === 'snoozed'
                      ? `moved it to ${dayPhrase(l.snoozed_to!)}`
                      : l.slot === 'adhoc'
                        ? 'logged this'
                        : '';
                return (
                  <li key={l.id} className={`row${l.status !== 'done' ? ' row-done' : ''}`}>
                    <Stamp name={who?.display_name ?? l.sitter_name ?? '?'} color={who?.color ?? SITTER_GREY} size="sm" />
                    <div className="row-text">
                      <span className="row-title">
                        {l.title} for {petName(l.pet_id)}
                      </span>
                      <span className="row-meta">
                        <span className="row-meta-text">
                          {name}
                          {verb ? ` ${verb}` : ''} at {formatClock(l.done_at)}
                        </span>
                      </span>
                      {l.note && <span className="note">“{l.note}”</span>}
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>
        ))
      )}
      <p className="footnote">Showing the last {HISTORY_DAYS} days.</p>
      {logging && <LogSheet onClose={() => setLogging(false)} />}
    </>
  );
}

function localDay(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Who checked off how much in the last 7 days. One bar per person, labeled. */
function ThisWeek() {
  const { snapshot, me } = useApp();
  const since = addDays(todayISO(), -6);
  const rows = useMemo(() => {
    const counts = new Map<string, { name: string; color: string; n: number; you: boolean }>();
    for (const m of snapshot.members) {
      counts.set(m.user_id, { name: m.display_name, color: m.color, n: 0, you: m.user_id === me.user_id });
    }
    for (const l of snapshot.logs) {
      if (l.status !== 'done' || localDay(l.done_at) < since) continue;
      const key = l.done_by ?? `sitter:${l.sitter_name ?? 'Sitter'}`;
      if (!counts.has(key)) counts.set(key, { name: `${l.sitter_name ?? 'Sitter'} (sitter)`, color: SITTER_GREY, n: 0, you: false });
      counts.get(key)!.n++;
    }
    return [...counts.values()].sort((a, b) => b.n - a.n);
  }, [snapshot.logs, snapshot.members, me.user_id, since]);

  const total = rows.reduce((s, r) => s + r.n, 0);
  const max = Math.max(1, ...rows.map((r) => r.n));
  if (!total) return null;

  return (
    <section className="group">
      <h2 className="group-label">Last 7 days</h2>
      <div className="panel">
        <ul className="bars" aria-label={`${total} check-offs in the last 7 days`}>
          {rows.map((r) => (
            <li key={r.name} className="bar-row">
              <span className="bar-name">
                <Stamp name={r.name} color={r.color} size="sm" />
                <span>{r.you ? 'You' : r.name}</span>
              </span>
              <span className="bar-track" aria-hidden="true">
                <span className="bar-fill" style={{ width: `${(r.n / max) * 100}%`, background: r.color }} />
              </span>
              <span className="bar-val">
                {r.n}
                <span className="sr-only"> check-offs, {Math.round((r.n / total) * 100)} percent</span>
              </span>
            </li>
          ))}
        </ul>
        <p className="muted small bars-foot">
          {total} check-offs. {rows[0].n > 0 && rows.length > 1 && rows[0].n !== rows[1].n ? `${rows[0].you ? 'You' : rows[0].name.split(' ')[0]} did the most.` : 'Evenly split.'}
        </p>
      </div>
    </section>
  );
}

function LogSheet({ onClose }: { onClose: () => void }) {
  const { snapshot, logAdhoc } = useApp();
  const [petId, setPetId] = useState(snapshot.pets[0]?.id ?? '');
  const [what, setWhat] = useState('');
  const [note, setNote] = useState('');

  async function save(e: FormEvent) {
    e.preventDefault();
    if (!petId || !what.trim()) return;
    onClose();
    await logAdhoc(petId, what.trim(), note.trim() || null);
  }

  return (
    <Sheet
      title="Log something"
      onClose={onClose}
      footer={
        <button className="btn btn-primary btn-block" form="log-form" disabled={!what.trim() || !petId}>
          Add to activity
        </button>
      }
    >
      <form id="log-form" className="stack" onSubmit={save}>
        {snapshot.pets.length > 1 && (
          <div className="field">
            <span className="field-label">Which pet</span>
            <Chips<string>
              label="Which pet"
              value={petId}
              onChange={setPetId}
              options={snapshot.pets.map((p) => ({ value: p.id, label: `${p.emoji} ${p.name}` }))}
            />
          </div>
        )}
        <div className="field">
          <span className="field-label">What happened</span>
          <div className="chips">
            {QUICK_LOGS.map((q) => (
              <button type="button" key={q} className={`chip${what === q ? ' chip-on' : ''}`} onClick={() => setWhat(q)}>
                {q}
              </button>
            ))}
          </div>
          <input id="log-what" value={what} onChange={(e) => setWhat(e.target.value)} maxLength={60} placeholder="Or type your own" aria-label="What happened" />
        </div>
        <Field label="Note">
          <textarea id="log-note" value={note} onChange={(e) => setNote(e.target.value)} rows={2} maxLength={500} placeholder="Optional" />
        </Field>
      </form>
    </Sheet>
  );
}
