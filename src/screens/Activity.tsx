import { useMemo, useState } from 'react';
import { addDays, daysBetween, formatClock, formatDayLabel, formatShortDate, todayISO, dayPhrase } from '../lib/dates';
import { memberById } from '../lib/people';
import type { TaskLog } from '../lib/types';
import { CheckoffSheet } from '../sheets/CheckoffSheet';
import { useApp, whoDid } from '../state';
import { Icons, Spinner, Stamp } from '../ui';

const SITTER_GREY = '#7B8794';

export function ActivityScreen() {
  const { snapshot, logs, me, openAdd, historyFrom, historyLoading, loadHistory } = useApp();
  const [openId, setOpenId] = useState<string | null>(null);
  const opened = logs.find((l) => l.id === openId) ?? null;

  const days = useMemo(() => {
    const sorted = [...logs].sort((a, b) => b.done_at.localeCompare(a.done_at));
    const map = new Map<string, TaskLog[]>();
    for (const l of sorted) {
      // Entries go under the day they happened.
      const day = l.done_at ? localDay(l.done_at) : l.occurrence_date;
      if (!map.has(day)) map.set(day, []);
      map.get(day)!.push(l);
    }
    return [...map.entries()].sort((a, b) => b[0].localeCompare(a[0]));
  }, [logs]);

  const petName = (id: string) => snapshot.pets.find((p) => p.id === id)?.name ?? 'a pet';

  return (
    <>
      <header className="screen-head screen-head-row">
        <h1 className="screen-title">Activity</h1>
        {snapshot.pets.length > 0 && (
          <button className="btn btn-primary btn-small" onClick={() => openAdd({ kind: 'log' })}>
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
                  <li key={l.id}>
                    <button className={`row row-button${l.status !== 'done' ? ' row-done' : ''}`} onClick={() => setOpenId(l.id)}>
                    <Stamp name={who?.display_name ?? l.sitter_name ?? l.author_name ?? '?'} color={who?.color ?? SITTER_GREY} size="sm" />
                    <span className="row-text">
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
                    </span>
                    <span className="chev" aria-hidden="true">
                      {Icons.next}
                    </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        ))
      )}
      {opened && <CheckoffSheet log={opened} onClose={() => setOpenId(null)} />}
      <div className="history-more">
        <p className="footnote">
          Showing everything since {formatShortDate(historyFrom)} ({daysBetween(historyFrom, todayISO())} days). Everyone in the household sees the same history.
        </p>
        {historyLoading ? (
          <Spinner label="Loading earlier history" />
        ) : (
          <button className="btn btn-quiet btn-small" onClick={() => loadHistory(addDays(historyFrom, -30))}>
            Show the month before
          </button>
        )}
      </div>
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
