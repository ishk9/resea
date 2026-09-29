import { useEffect, useRef, useState } from 'react';

export interface Option { value: string; label: string }

// Styled dropdown replacing native <select> (whose open list can't be CSS-styled).
export function Dropdown({
  value, options, onChange, width, placeholder = 'Select',
}: {
  value: string | null;
  options: Option[];
  onChange: (value: string) => void;
  width?: number;
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const [dropUp, setDropUp] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const current = options.find((o) => o.value === value);

  // Flip the menu upward when there isn't room below (e.g. the model picker in the composer).
  const toggle = () => {
    if (!open) {
      const r = ref.current?.getBoundingClientRect();
      const need = Math.min(320, options.length * 34 + 12);
      setDropUp(!!r && window.innerHeight - r.bottom < need && r.top > need);
    }
    setOpen((o) => !o);
  };

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', esc); };
  }, [open]);

  return (
    <div className="dd" ref={ref} style={width ? { width } : undefined}>
      <button className="btn dd-trigger" onClick={toggle} title={current?.label} aria-haspopup="listbox" aria-expanded={open}>
        <span className="dd-value">{current?.label ?? placeholder}</span>
        <svg className={`dd-caret${open ? ' up' : ''}`} viewBox="0 0 10 10" width="8" height="8" fill="none" stroke="currentColor" strokeWidth="1.5">
          <path d="M2 3.5 5 6.5 8 3.5" />
        </svg>
      </button>
      {open && (
        <div className={`dd-menu${dropUp ? ' drop-up' : ''}`} role="listbox">
          {options.map((o) => {
            const active = o.value === value;
            return (
              <button
                key={o.value}
                className={`dd-opt${active ? ' active' : ''}`}
                role="option"
                aria-selected={active}
                onClick={() => { onChange(o.value); setOpen(false); }}
              >
                {o.label}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
