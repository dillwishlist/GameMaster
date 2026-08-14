/**
 * Generates stand-in avatars and round images so the sample game runs before
 * any real photos exist.
 *
 * The real assets come from five households answering a text message, which is
 * the actual critical path — see the README. Placeholders exist so you can
 * rehearse the whole game on day one and drop the real photos in later, over
 * the same filenames.
 *
 *   node scripts/make-placeholders.mjs
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const COLORS = ['#e6402f', '#2f7de6', '#22a06b', '#e0961f', '#8b5cf6', '#e0479e', '#0d9aa6', '#4f46e5'];

const avatarDir = path.resolve('content/avatars');
const assetDir = path.resolve('content/assets');
mkdirSync(avatarDir, { recursive: true });
mkdirSync(assetDir, { recursive: true });

/** A flat portrait disc: head, shoulders, initial. Reads fine at tile size. */
function avatar(letter, color) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200" width="200" height="200">
  <rect width="200" height="200" fill="${color}"/>
  <circle cx="100" cy="78" r="38" fill="rgba(255,255,255,.92)"/>
  <path d="M28 200c0-40 32-66 72-66s72 26 72 66z" fill="rgba(255,255,255,.92)"/>
  <text x="100" y="92" font-family="system-ui,sans-serif" font-size="46" font-weight="700"
        text-anchor="middle" fill="${color}">${letter}</text>
</svg>\n`;
}

function placeholderImage(label, color) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 900" width="1200" height="900">
  <rect width="1200" height="900" fill="${color}"/>
  <rect x="40" y="40" width="1120" height="820" fill="none" stroke="rgba(255,255,255,.5)" stroke-width="8"
        stroke-dasharray="24 18"/>
  <text x="600" y="430" font-family="system-ui,sans-serif" font-size="72" font-weight="800"
        text-anchor="middle" fill="#fff">${label}</text>
  <text x="600" y="510" font-family="system-ui,sans-serif" font-size="34"
        text-anchor="middle" fill="rgba(255,255,255,.85)">replace this file with the real photo</text>
</svg>\n`;
}

const letters = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];
letters.forEach((letter, i) => {
  writeFileSync(path.join(avatarDir, `avatar-${letter.toLowerCase()}.svg`), avatar(letter, COLORS[i % COLORS.length]));
});

for (let i = 1; i <= 4; i++) {
  const name = `baby-0${i}.svg`;
  writeFileSync(path.join(assetDir, name), placeholderImage(`Baby photo ${i}`, COLORS[(i + 2) % COLORS.length]));
}
writeFileSync(path.join(assetDir, 'wedding-1985.svg'), placeholderImage('Wedding, 1985', '#4f46e5'));

console.log(`Wrote ${letters.length} avatars to content/avatars and 5 images to content/assets`);
