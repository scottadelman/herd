import { useState, type ReactNode } from 'react';
import { atLocal, dayPhrase, formatClock, formatTime, localDayOf, todayISO } from '../lib/dates';
import { memberById } from '../lib/people';
import { ANY_TIME } from '../lib/schedule';
import type { LogPatch, TaskLog } from '../lib/types';
import { useApp, whoDid } from '../state';
import { Field, Icons, Sheet, Stamp } from '../ui';

const SITTER_GREY = '#7B8794';

const toTimeInput = (iso: string) => {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

/**
 * One check-off (or skip, or something logged by hand): who did it and when,
 * and for your own, fix the day, time and note or undo it. Opens from Today,
 * Activity, the day view, a pet's medications and a routine's recent list.
 */
export function CheckoffSheet({ log, onClose, children }: { log: TaskLog; onClose: () => void; children?: ReactNode }) {
  const { snapshot, me, editLog, undo, backend } = useApp();
  const today = todayISO();
  const routine = log.routine_id ? snapshot.routines.find((r) => r.id === log.routine_id) : undefined;
  const pet = snapshot.pets.find((p) => p.id === log.pet_id);
  const adhoc = !log.routine_id;
  const moved = log.status === 'snoozed';
  const mine = log.done_by === me.user_id && !moved;
  const pending = log.id.startsWith('temp-');
  const who = whoDid(log, snapshot.members, me.user_id, true);
  const doer = memberById(snapshot.members, log.done_by);
  const [date, setDate] = useState(localDayOf(log.done_at));
  const [time, setTime] = useState(toTimeInput(log.done_at));
  const [note, setNote] = useState(log.note ?? '');
  const [what, setWhat] = useState(log.title);
  const [confirmRemove, setConfirmRemove] = useState(false);

  const newDoneAt = /^\d{2}:\d{2}$/.test(time) && date ? atLocal(date, time) : log.done_at;
  const inFuture = Date.parse(newDoneAt) > Date.now() + 60_000;
  const changed =
    localDayOf(newDoneAt) !== localDayOf(log.done_at) ||
    toTimeInput(newDoneAt) !== toTimeInput(log.done_at) ||
    (log.note ?? '') !== note ||
    (adhoc && what.trim() !== log.title);

  const verb = moved
    ? `moved this to ${dayPhrase(log.snoozed_to ?? today, today)}`
    : log.status === 'skipped'
      ? 'skipped this'
      : adhoc
        ? 'logged this'
        : 'checked this off';
  const doneDay = localDayOf(log.done_at);
  const title = `${log.title}${pet ? ` for ${pet.name}` : ''}`;

  function save() {
    const patch: LogPatch = { note: note.trim() || null, done_at: newDoneAt };
    if (adhoc) {
      patch.occurrence_date = date;
      if (what.trim()) patch.title = what.trim().slice(0, 60);
    }
    onClose();
    editLog(log, patch);
  }

  return (
    <Sheet
      title={title}
      onClose={onClose}
      footer={
        <div className="sheet-actions">
          {mine && (
            <button className="btn btn-primary btn-block" disabled={!changed || pending || inFuture || (adhoc && !what.trim())} onClick={save}>
              Save changes
            </button>
          )}
          {(mine || !adhoc) &&
            (adhoc && confirmRemove ? (
              <button
                className="btn btn-danger btn-block"
                onClick={() => {
                  onClose();
                  undo(log);
                }}
              >
                Remove it from Activity
              </button>
            ) : (
              <button
                className="btn btn-quiet btn-block"
                disabled={pending}
                onClick={() => {
                  if (adhoc) {
                    setConfirmRemove(true);
                    return;
                  }
                  onClose();
                  undo(log);
                }}
              >
                {adhoc ? 'Remove' : moved ? `Move it back to ${dayPhrase(log.occurrence_date, today)}` : log.status === 'skipped' ? 'Undo skip' : 'Undo check-off'}
              </button>
            ))}
        </div>
      }
    >
      <div className="stack">
        <div className="done-detail">
          {log.status === 'skipped' || moved ? (
            <span className="stamp-skip stamp-skip-lg">{moved ? Icons.moved : Icons.skip}</span>
          ) : (
            <Stamp name={doer?.display_name ?? log.sitter_name ?? log.author_name ?? '?'} color={doer?.color ?? SITTER_GREY} size="lg" />
          )}
          <p>
            {who} {verb} at {formatClock(log.done_at)}
            {doneDay !== today ? `, ${dayPhrase(doneDay, today)}` : ''}.
          </p>
          {routine && !adhoc && (
            <p className="muted small">
              For {dayPhrase(log.occurrence_date, today)}
              {log.slot !== ANY_TIME ? `’s ${formatTime(log.slot)}` : ''} {routine.category === 'medication' ? 'dose' : 'task'}
              {routine.dose ? `, ${routine.dose}` : ''}.
            </p>
          )}
        </div>

        {mine ? (
          <>
            {adhoc && (
              <Field label="What happened">
                <input id="log-edit-what" value={what} onChange={(e) => setWhat(e.target.value)} maxLength={60} />
              </Field>
            )}
            <div className="field-pair">
              <Field label="Day">
                <input id="log-edit-date" type="date" value={date} max={today} onChange={(e) => setDate(e.target.value || date)} />
              </Field>
              <Field label="Time">
                <input id="log-edit-time" type="time" value={time} onChange={(e) => setTime(e.target.value)} />
              </Field>
            </div>
            {inFuture ? (
              <p className="field-hint late">That’s in the future. Pick a time that’s already happened.</p>
            ) : (
              <p className="field-hint">Forgot to tap? Set when it actually happened.</p>
            )}
            <Field label="Note">
              <textarea id="log-edit-note" value={note} onChange={(e) => setNote(e.target.value)} rows={2} maxLength={500} placeholder="Only ate half, seemed tired…" />
            </Field>
            {adhoc && confirmRemove && <p className="muted small">This takes it out of Activity for everyone.</p>}
          </>
        ) : (
          <>
            {log.note && <p className="note">“{log.note}”</p>}
            {backend.kind === 'supabase' && !moved && (
              <p className="muted small">
                {log.done_by
                  ? `Only ${who} can change the day, time or note.`
                  : log.author_name
                    ? `${log.author_name} has left Herd, so this stays as it is.`
                    : 'Sitter check-offs can be undone, but not edited.'}
              </p>
            )}
          </>
        )}
        {children}
      </div>
    </Sheet>
  );
}
