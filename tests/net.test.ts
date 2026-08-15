import { describe, expect, it } from 'vitest';
import { qrSvg } from '../server/net.js';

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
