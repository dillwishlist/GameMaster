import { useEffect, useState } from 'react';

const STORAGE_KEY = 'gamemaster.passphrase';

/**
 * The only auth in the project, and it is optional: set GM_PASSPHRASE if you
 * don't want a curious nephew opening /host on his own phone. Everything else
 * is protected by the fact that this thing only exists on your LAN.
 */
export function usePassphrase() {
  const [passphrase, setPassphrase] = useState<string | undefined>(
    () => localStorage.getItem(STORAGE_KEY) ?? undefined,
  );
  const [required, setRequired] = useState(false);

  useEffect(() => {
    fetch('/api/config')
      .then((r) => r.json())
      .then((cfg: { passphraseRequired: boolean }) => setRequired(Boolean(cfg.passphraseRequired)))
      .catch(() => setRequired(false));
  }, []);

  const save = (value: string) => {
    localStorage.setItem(STORAGE_KEY, value);
    setPassphrase(value);
  };

  return { passphrase, save, required };
}

export function PassphraseGate({ error, onSubmit }: { error: string | null; onSubmit: (value: string) => void }) {
  const [value, setValue] = useState('');
  return (
    <form
      className="gate"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit(value);
      }}
    >
      <h1>GameMaster</h1>
      <label htmlFor="passphrase">Host passphrase</label>
      <input id="passphrase" type="password" value={value} onChange={(e) => setValue(e.target.value)} autoFocus />
      {error && <p className="gate-error">{error}</p>}
      <button className="btn btn-primary" type="submit">
        Open host view
      </button>
    </form>
  );
}
