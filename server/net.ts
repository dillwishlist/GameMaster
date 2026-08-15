/**
 * Network niceties. The iPad cannot reach `localhost`, so the server binds
 * 0.0.0.0 and the terminal prints the LAN URL and a QR code — the host scans it
 * once and bookmarks it, rather than typing an IP with wet hands.
 */

import { networkInterfaces } from 'node:os';
import qrcode from 'qrcode-terminal';
import QRCode from 'qrcode';

/** Best-guess LAN address: IPv4, non-internal, preferring private ranges. */
export function lanAddress(): string | null {
  const candidates: string[] = [];
  for (const addrs of Object.values(networkInterfaces())) {
    for (const addr of addrs ?? []) {
      if (addr.family !== 'IPv4' || addr.internal) continue;
      candidates.push(addr.address);
    }
  }
  const isPrivate = (ip: string) =>
    ip.startsWith('192.168.') || ip.startsWith('10.') || /^172\.(1[6-9]|2\d|3[01])\./.test(ip);
  return candidates.find(isPrivate) ?? candidates[0] ?? null;
}

export function printBanner(port: number, opts: { contentFile: string; sessionId: string; resumed: boolean }): void {
  const ip = lanAddress();
  const lan = ip ? `http://${ip}:${port}` : null;

  const line = '─'.repeat(52);
  console.log(`\n${line}`);
  console.log('  GameMaster');
  console.log(`  content : ${opts.contentFile}`);
  console.log(`  session : ${opts.sessionId}${opts.resumed ? '  (resumed)' : '  (new)'}`);
  console.log(line);
  console.log('  DISPLAY (this laptop, drag to the TV, then fullscreen):');
  console.log(`    http://localhost:${port}/display`);
  console.log('  HOST (iPad on the same wifi):');
  console.log(`    ${lan ? `${lan}/host` : '(no LAN address found — wifi down?)'}`);
  console.log('  HOST FALLBACK (if the wifi misbehaves, use this laptop):');
  console.log(`    http://localhost:${port}/host`);
  console.log(`${line}\n`);

  if (lan) {
    qrcode.generate(`${lan}/host`, { small: true }, (qr: string) => {
      console.log(qr);
      console.log(`  ↑ scan to open the host view on the iPad\n`);
    });
  }
}

/**
 * The same QR code as the terminal one, as an SVG for a browser to render.
 * `qrcode-terminal` only draws to stdout, so this is the second QR library —
 * it never touches the network, same as the terminal one.
 */
export function qrSvg(url: string): Promise<string> {
  return QRCode.toString(url, { type: 'svg', margin: 1 });
}
