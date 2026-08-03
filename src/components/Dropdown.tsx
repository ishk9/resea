import { useEffect, useRef, useState, type ReactNode } from 'react';

export interface Option { value: string; label: string; hint?: string }

// Styled dropdown replacing native <select> (whose open list can't be CSS-styled).
export function Dropdown({
  value, options, onChange, width, placeholder = 'Select', renderRow,
}: {
  value: string | null;
  options: Option[];
  onChange: (value: string) => void;
  width?: number;
  placeholder?: string;
  renderRow?: (o: Option, active: boolean) => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [dropUp, setDropUp] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const current = options.find((o) => o.value === value);

  // Flip the menu upward when there isn't room below (e.g. dropdowns near the panel bottom).
  const toggle = () => {
    if (!open) {
      const r = ref.current?.getBoundingClientRect();
      const need = Math.min(340, options.length * 38 + 12);
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
      <button className="control dd-trigger" onClick={toggle} title={current?.label}>
        <span className="dd-value">{current?.label ?? placeholder}</span>
        <span className={`dd-caret${open ? ' up' : ''}`}>▾</span>
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
                {renderRow ? renderRow(o, active) : (
                  <>
                    <span className="dd-check">{active ? '✓' : ''}</span>
                    <span className="dd-label">{o.label}</span>
                    {o.hint && <span className="dd-hint">{o.hint}</span>}
                  </>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
