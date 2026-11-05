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
};
