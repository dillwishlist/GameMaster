/**
 * The small, dense controls this screen is made of.
 *
 * Every field writes on each keystroke rather than on blur: the operation queue
 * collapses consecutive edits to the same field into one, so the cost is
 * nothing, and it means what is on screen — and what the Preview button sends
 * to the television — is always the text the host has actually typed.
 */

import type { ReactNode } from 'react';

export function TextField({
  label,
  value,
  onChange,
  multiline,
  placeholder,
  required,
  disabled,
  hint,
}: {
  label: string;
  value: string | undefined;
  onChange: (value: string) => void;
  multiline?: boolean;
  placeholder?: string;
  /** Marked when empty: the file will not load without it, and a 422 at save time is a worse way to find out. */
  required?: boolean;
  disabled?: boolean;
  hint?: string;
}) {
  const missing = Boolean(required) && !String(value ?? '').trim();
  const common = {
    className: `field-input ${missing ? 'missing' : ''}`,
    value: value ?? '',
    placeholder,
    disabled,
    onChange: (e: { target: { value: string } }) => onChange(e.target.value),
  };

  return (
    <label className="field">
      <span className="field-label">
        {label}
        {required && <em className="req"> required</em>}
      </span>
      {multiline ? <textarea rows={2} {...common} /> : <input type="text" {...common} />}
      {hint && <span className="field-hint">{hint}</span>}
    </label>
  );
}

/**
 * Numbers are optional almost everywhere in the content file, and an empty box
 * has to mean "remove the key" rather than "zero" — `points: 0` is a real
 * setting and not what anyone means by clearing a field.
 */
export function NumberField({
  label,
  value,
  onChange,
  placeholder,
  disabled,
  min,
}: {
  label: string;
  value: number | null | undefined;
  /** `''` clears the field. */
  onChange: (value: number | '') => void;
  placeholder?: string;
  disabled?: boolean;
  min?: number;
}) {
  return (
    <label className="field narrow">
      <span className="field-label">{label}</span>
      <input
        className="field-input"
        type="number"
        min={min}
        value={value ?? ''}
        placeholder={placeholder}
        disabled={disabled}
        onChange={(e) => {
          const raw = e.target.value;
          onChange(raw === '' ? '' : Number(raw));
        }}
      />
    </label>
  );
}

/** Up / down / delete, the three buttons every list of things here needs. */
export function RowTools({
  onUp,
  onDown,
  onDelete,
  disabled,
  deleteTitle,
  children,
}: {
  onUp?: () => void;
  onDown?: () => void;
  onDelete?: () => void;
  disabled?: boolean;
  deleteTitle?: string;
  children?: ReactNode;
}) {
  return (
    <span className="row-tools">
      {children}
      {onUp && (
        <button className="mini" disabled={disabled} onClick={onUp} title="Move up">
          ↑
        </button>
      )}
      {onDown && (
        <button className="mini" disabled={disabled} onClick={onDown} title="Move down">
          ↓
        </button>
      )}
      {onDelete && (
        <button className="mini danger" disabled={disabled} onClick={onDelete} title={deleteTitle ?? 'Delete'}>
          ✕
        </button>
      )}
    </span>
  );
}
