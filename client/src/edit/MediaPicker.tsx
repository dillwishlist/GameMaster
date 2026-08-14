import { useRef, useState } from 'react';
import { uploadAsset } from './api.js';
import { assetUrl } from './types.js';

/**
 * One media slot on one question: drop a file on it, pick one off the disk, or
 * choose something already in `content/assets`.
 *
 * The picture is shown at the size it will be, because the point of putting it
 * here is to notice that the scan is crooked or that the 400px thumbnail off a
 * website is a blurry mess on a television.
 */
export function MediaPicker({
  label,
  kind,
  value,
  assets,
  passphrase,
  disabled,
  onChange,
}: {
  label: string;
  kind: 'image' | 'audio';
  value: string | undefined;
  assets: string[];
  passphrase: string | undefined;
  disabled?: boolean;
  /** `''` clears the field, which is how the server removes the key. */
  onChange: (ref: string) => void;
}) {
  const fileInput = useRef<HTMLInputElement | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);

  const known = assets.filter((a) =>
    kind === 'image' ? /\.(png|jpe?g|gif|webp|svg)$/i.test(a) : /\.(wav|mp3|m4a)$/i.test(a),
  );

  const upload = async (file: File | undefined) => {
    if (!file || disabled) return;
    setBusy(true);
    setError(null);
    try {
      onChange(await uploadAsset(file, passphrase));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className={`media-slot ${dragging ? 'dragging' : ''}`}
      onDragOver={(e) => {
        if (disabled) return;
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        void upload(e.dataTransfer.files[0]);
      }}
    >
      <div className="media-head">
        <span className="field-label">{label}</span>
        {value ? (
          <button className="mini danger" disabled={disabled} onClick={() => onChange('')}>
            Clear
          </button>
        ) : null}
      </div>

      {value && kind === 'image' && (
        <img className="media-thumb" src={assetUrl(value)} alt="" onError={(e) => e.currentTarget.classList.add('broken')} />
      )}
      {value && kind === 'audio' && <audio className="media-audio" src={assetUrl(value)} controls preload="none" />}

      <div className="media-controls">
        <button className="mini" disabled={disabled || busy} onClick={() => fileInput.current?.click()}>
          {busy ? 'Uploading…' : value ? 'Replace…' : `Add ${kind}…`}
        </button>
        <select
          className="mini-select"
          value={known.includes(value ?? '') ? value : ''}
          disabled={disabled || known.length === 0}
          onChange={(e) => onChange(e.target.value)}
        >
          <option value="">{known.length ? `or pick from ${known.length} in assets/…` : 'nothing in assets/ yet'}</option>
          {known.map((ref) => (
            <option key={ref} value={ref}>
              {ref.replace(/^assets\//, '')}
            </option>
          ))}
        </select>
        <input
          ref={fileInput}
          className="hidden-input"
          type="file"
          accept={kind === 'image' ? 'image/*' : 'audio/*'}
          onChange={(e) => {
            void upload(e.target.files?.[0]);
            // Clear it, or picking the same file twice after a failed upload
            // fires no change event at all.
            e.target.value = '';
          }}
        />
      </div>

      {value && <code className="media-ref">{value}</code>}
      {error && <p className="field-error">{error}</p>}
    </div>
  );
}
