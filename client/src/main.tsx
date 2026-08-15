import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { HostView } from './host/HostView.js';
import { DisplayView } from './display/DisplayView.js';
import { PlayView } from './play/PlayView.js';
import { EditView } from './edit/EditView.js';
import './styles/base.css';

/**
 * Four views, one bundle, routed off the path. No router library: there are
 * exactly four routes and none of them navigate to each other during play.
 */
function App() {
  const path = window.location.pathname;
  if (path.startsWith('/display')) return <DisplayView />;
  if (path.startsWith('/play')) return <PlayView />;
  if (path.startsWith('/host')) return <HostView />;
  if (path.startsWith('/edit')) return <EditView />;
  return <Chooser />;
}

function Chooser() {
  const [lanHostUrl, setLanHostUrl] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/config')
      .then((res) => res.json())
      .then((config: { lanHostUrl: string | null }) => setLanHostUrl(config.lanHostUrl))
      .catch(() => setLanHostUrl(null));
  }, []);

  return (
    <div className="chooser">
      <h1>GameMaster</h1>
      <a href="/host">Host</a>
      <a href="/display">Display</a>
      <a href="/edit">Edit</a>

      {/* Absent off the LAN (wifi down) — same case the terminal banner handles. */}
      {lanHostUrl && (
        <div className="chooser-qr">
          <img src="/api/qr" alt="Scan to open the host view" width={200} height={200} />
          <p>Scan to open the host view — {lanHostUrl}</p>
        </div>
      )}
    </div>
  );
}

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
