import { afterEach, describe, expect, it } from 'vitest';
import { hostBaseUrl, qrSvg } from '../server/net.js';

describe('qrSvg', () => {
  it('renders an SVG QR code for a URL', async () => {
    const svg = await qrSvg('http://192.168.1.23:4000/host');
    expect(svg).toContain('<svg');
    expect(svg).toContain('viewBox');
  });

  it('encodes different URLs differently', async () => {
    const a = await qrSvg('http://192.168.1.23:4000/host');
    const b = await qrSvg('http://10.0.0.5:4000/host');
    expect(a).not.toBe(b);
  });
});

describe('hostBaseUrl', () => {
  afterEach(() => {
    delete process.env.GM_PUBLIC_URL;
  });

  it('prefers GM_PUBLIC_URL over LAN auto-detection', () => {
    process.env.GM_PUBLIC_URL = 'http://example.com:4000';
    expect(hostBaseUrl(4000)).toBe('http://example.com:4000');
  });

  it('strips a trailing slash so the caller can always append a path', () => {
    process.env.GM_PUBLIC_URL = 'http://example.com:4000/';
    expect(hostBaseUrl(4000)).toBe('http://example.com:4000');
  });

  it('ignores a blank override and falls back to auto-detection', () => {
    process.env.GM_PUBLIC_URL = '   ';
    // Whatever this machine's LAN detection returns, it must not be the
    // literal blank string — the override must not win by accident.
    expect(hostBaseUrl(4000)).not.toBe('   ');
  });
});
