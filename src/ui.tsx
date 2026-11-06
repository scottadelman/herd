import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { initials } from './lib/people';

/* ---------- Stamp: a member's initials, like marker on a fridge chart ---------- */

export function Stamp({
  name,
  color,
  size = 'md',
  fresh = false,
}: {
  name: string;
  color: string;
  size?: 'sm' | 'md' | 'lg';
  fresh?: boolean;
}) {
  return (
    <span className={`stamp stamp-${size}${fresh ? ' stamp-fresh' : ''}`} style={{ background: color }} aria-hidden="true">
      {initials(name)}
    </span>
  );
}

export function PetAvatar({
  emoji,
  photo,
  size = 'md',
}: {
  emoji: string;
  photo?: string | null;
  size?: 'sm' | 'md' | 'lg' | 'xl';
}) {
  return (
    <span className={`pet-avatar pet-avatar-${size}${photo ? ' pet-avatar-photo' : ''}`} aria-hidden="true">
      {photo ? <img src={photo} alt="" /> : emoji}
    </span>
  );
}

/** A small mark for health tasks, colored by category, always paired with text. */
export function CategoryMark({ category }: { category: 'care' | 'medication' | 'vaccine' | 'vet' }) {
  if (category === 'care') return null;
  return <span className={`cat-mark cat-${category}`} aria-hidden="true">{CATEGORY_ICONS[category]}</span>;
}

const small = (d: ReactNode) => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {d}
  </svg>
);

const CATEGORY_ICONS = {
  medication: small(
    <>
      <g transform="rotate(-45 12 12)">
        <rect x="3.5" y="8" width="17" height="8" rx="4" />
        <path d="M3.5 12a4 4 0 0 1 4-4H12v8H7.5a4 4 0 0 1-4-4z" fill="currentColor" />
      </g>
    </>,
  ),
  vaccine: small(
    <>
      <path d="M15 4l5 5M17.5 6.5l-9 9-3.5.5.5-3.5 9-9M11 9l4 4M4.5 19.5L7 17" />
    </>,
  ),
  vet: small(<path d="M12 5v14M5 12h14" />),
};

/* ---------- Bottom sheet ---------- */

export function Sheet({
  title,
  onClose,
  children,
  footer,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    ref.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && closeRef.current();
    window.addEventListener('keydown', onKey);
    document.body.classList.add('sheet-open');
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.classList.remove('sheet-open');
      prev?.focus?.();
    };
  }, []);
  return (
    <div className="sheet-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="sheet" role="dialog" aria-modal="true" aria-label={title} tabIndex={-1} ref={ref}>
        <div className="sheet-head">
          <h2>{title}</h2>
          <button className="btn-text" onClick={onClose}>
            Close
          </button>
        </div>
        <div className="sheet-body">{children}</div>
        {footer && <div className="sheet-foot">{footer}</div>}
      </div>
    </div>
  );
}

/* ---------- Toasts ---------- */

interface Toast {
  id: number;
  text: string;
  tone: 'info' | 'error';
}
const ToastCtx = createContext<(text: string, tone?: Toast['tone']) => void>(() => {});
export const useToast = () => useContext(ToastCtx);

export function ToastHost({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const push = useCallback((text: string, tone: Toast['tone'] = 'info') => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t.slice(-2), { id, text, tone }]);
    window.setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), tone === 'error' ? 6000 : 3800);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast toast-${t.tone}`}>
            {t.text}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

/* ---------- Small pieces ---------- */

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      {children}
      {hint && <span className="field-hint">{hint}</span>}
    </label>
  );
}

export function Chips<T extends string>({
  options,
  value,
  onChange,
  label,
}: {
  options: { value: T; label: ReactNode }[];
  value: T;
  onChange: (v: T) => void;
  label: string;
}) {
  return (
    <div className="chips" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          className={`chip${value === o.value ? ' chip-on' : ''}`}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** Type a word and press return (or a comma) to add it as a tag. */
export function TagInput({
  id,
  values,
  onChange,
  placeholder,
  tone,
  label,
}: {
  id: string;
  values: string[];
  onChange: (v: string[]) => void;
  placeholder?: string;
  tone?: 'alert';
  label: string;
}) {
  const [draft, setDraft] = useState('');
  const add = (raw: string) => {
    const parts = raw
      .split(/[,\n;]/)
      .map((x) => x.trim().slice(0, 60))
      .filter(Boolean);
    if (!parts.length) return;
    const next = [...values];
    for (const p of parts) if (!next.some((x) => x.toLowerCase() === p.toLowerCase())) next.push(p);
    onChange(next.slice(0, 20));
    setDraft('');
  };
  return (
    <div className="tag-input">
      {values.length > 0 && (
        <ul className="tags" aria-label={label}>
          {values.map((v) => (
            <li key={v} className={`tag${tone ? ` tag-${tone}` : ''}`}>
              {v}
              <button type="button" onClick={() => onChange(values.filter((x) => x !== v))} aria-label={`Remove ${v}`}>
                {Icons.closeSmall}
              </button>
            </li>
          ))}
        </ul>
      )}
      <input
        id={id}
        value={draft}
        aria-label={label}
        placeholder={placeholder}
        maxLength={80}
        enterKeyHint="done"
        onChange={(e) => {
          const v = e.target.value;
          if (/[,;]/.test(v)) add(v);
          else setDraft(v);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            add(draft);
          } else if (e.key === 'Backspace' && !draft && values.length) {
            onChange(values.slice(0, -1));
          }
        }}
        onBlur={() => add(draft)}
      />
    </div>
  );
}

/** A row of plain tags (allergies, likes) for reading. */
export function Tags({ values, tone }: { values: string[]; tone?: 'alert' | 'quiet' }) {
  return (
    <ul className="tags">
      {values.map((v) => (
        <li key={v} className={`tag${tone ? ` tag-${tone}` : ''}`}>
          {v}
        </li>
      ))}
    </ul>
  );
}

export function Spinner({ label = 'Loading' }: { label?: string }) {
  return (
    <div className="spinner-wrap" role="status">
      <span className="spinner" aria-hidden="true" />
      <span className="sr-only">{label}</span>
    </div>
  );
}

/* ---------- Icons (24px, stroke = currentColor) ---------- */

const icon = (d: ReactNode) => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {d}
  </svg>
);

export const Icons = {
  today: icon(
    <>
      <rect x="4" y="3.5" width="16" height="17" rx="3" />
      <path d="M8.5 12.2l2.4 2.4 4.6-5" />
    </>,
  ),
  paw: icon(
    <>
      <ellipse cx="7" cy="9.5" rx="1.7" ry="2.2" />
      <ellipse cx="17" cy="9.5" rx="1.7" ry="2.2" />
      <ellipse cx="10" cy="5.8" rx="1.6" ry="2.1" />
      <ellipse cx="14" cy="5.8" rx="1.6" ry="2.1" />
      <path d="M12 11.5c-2.6 0-5 3.4-5 5.6 0 1.6 1.2 2.4 2.6 2.4 1 0 1.6-.5 2.4-.5s1.4.5 2.4.5c1.4 0 2.6-.8 2.6-2.4 0-2.2-2.4-5.6-5-5.6z" />
    </>,
  ),
  activity: icon(
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5V12l3 2" />
    </>,
  ),
  home: icon(
    <>
      <path d="M4 11l8-6.5 8 6.5" />
      <path d="M6 9.5V19a1 1 0 0 0 1 1h3.5v-5h3v5H17a1 1 0 0 0 1-1V9.5" />
    </>,
  ),
  plus: icon(<path d="M12 5v14M5 12h14" />),
  back: icon(<path d="M14.5 5.5L8 12l6.5 6.5" />),
  prev: icon(<path d="M14.5 6L8.5 12l6 6" />),
  next: icon(<path d="M9.5 6l6 6-6 6" />),
  close: icon(<path d="M6 6l12 12M18 6L6 18" />),
  calendar: icon(
    <>
      <rect x="3.5" y="5" width="17" height="15.5" rx="3" />
      <path d="M3.5 10h17M8 3v4M16 3v4" />
    </>,
  ),
  skip: icon(<path d="M5 12h11M12 7l5 5-5 5M19 6v12" />),
  moved: icon(<path d="M4 12h14M13 6l6 6-6 6" />),
  camera: icon(
    <>
      <path d="M4 8.5A2.5 2.5 0 0 1 6.5 6H8l1.5-2h5L16 6h1.5A2.5 2.5 0 0 1 20 8.5v8A2.5 2.5 0 0 1 17.5 19h-11A2.5 2.5 0 0 1 4 16.5z" />
      <circle cx="12" cy="12.5" r="3.5" />
    </>,
  ),
  people: icon(
    <>
      <circle cx="9" cy="8.5" r="3.2" />
      <path d="M3.5 19.5c.6-3.2 2.8-5 5.5-5s4.9 1.8 5.5 5" />
      <circle cx="16.8" cy="9.3" r="2.5" />
      <path d="M15.6 14.6c2.4-.2 4.4 1.4 4.9 4.4" />
    </>,
  ),
  map: icon(
    <>
      <path d="M9 4.5L3.5 6.5v13l5.5-2 6 2 5.5-2v-13l-5.5 2z" />
      <path d="M9 4.5v13M15 6.5v13" />
    </>,
  ),
  phone: icon(
    <path d="M6.5 3.5h3l1.5 4-2 1.3a10.5 10.5 0 0 0 6.2 6.2l1.3-2 4 1.5v3a2 2 0 0 1-2.2 2A16.5 16.5 0 0 1 4.5 5.7a2 2 0 0 1 2-2.2z" />,
  ),
  file: icon(
    <>
      <path d="M13.5 3.5H7a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V9z" />
      <path d="M13.5 3.5V9H19M9 13h6M9 16.5h4" />
    </>,
  ),
  down: icon(<path d="M6 9.5l6 6 6-6" />),
  locate: icon(
    <>
      <circle cx="12" cy="12" r="3.5" />
      <path d="M12 3v3M12 18v3M3 12h3M18 12h3" />
      <circle cx="12" cy="12" r="7.5" />
    </>,
  ),
  undo: icon(<path d="M9 7L4.5 11.5 9 16M5 11.5h9.5a5 5 0 0 1 0 10H12" />),
  closeSmall: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" aria-hidden="true">
      <path d="M7 7l10 10M17 7L7 17" />
    </svg>
  ),
};
