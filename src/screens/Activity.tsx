import { useMemo, useState, type FormEvent } from 'react';
import { formatClock, formatDayLabel, todayISO } from '../lib/dates';
import { firstName, memberById } from '../lib/people';
import { QUICK_LOGS } from '../lib/pets';
import type { TaskLog } from '../lib/types';
import { HISTORY_DAYS, useApp } from '../state';
import { Chips, Field, Sheet, Stamp } from '../ui';

export function ActivityScreen() {
  const { snapshot, me } = useApp();
  const [logging, setLogging] = useState(false);

  const days = useMemo(() => {
    const sorted = [...snapshot.logs].sort((a, b) => b.done_at.localeCompare(a.done_at));
    const map = new Map<string, TaskLog[]>();
    for (const l of sorted) {
      const day = l.occurrence_date;
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
                const name = l.done_by === me.user_id ? 'You' : firstName(who?.display_name ?? 'Someone');
                return (
                  <li key={l.id} className="row">
                    <Stamp name={who?.display_name ?? '?'} color={who?.color ?? '#7B8794'} size="sm" />
                    <div className="row-text">
                      <span className="row-title">
                        {l.title} for {petName(l.pet_id)}
                      </span>
                      <span className="row-meta">
                        {name}
                        {l.slot === 'adhoc' ? ' logged this' : ''} at {formatClock(l.done_at)}
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

function LogSheet({ onClose }: { onClose: () => void }) {
  const { snapshot, complete } = useApp();
  const [petId, setPetId] = useState(snapshot.pets[0]?.id ?? '');
  const [what, setWhat] = useState('');
  const [note, setNote] = useState('');

  async function save(e: FormEvent) {
    e.preventDefault();
    if (!petId || !what.trim()) return;
    onClose();
    await complete({ petId, routineId: null, date: todayISO(), slot: 'adhoc', title: what.trim(), note: note.trim() || null });
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
          <input value={what} onChange={(e) => setWhat(e.target.value)} maxLength={60} placeholder="Or type your own" aria-label="What happened" />
        </div>
        <Field label="Note">
          <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} maxLength={500} placeholder="Optional" />
        </Field>
      </form>
    </Sheet>
  );
}
