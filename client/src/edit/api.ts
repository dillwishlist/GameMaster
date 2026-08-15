/**
 * The editor's half of `server/editor/routes.ts`.
 *
 * Every failure mode there is a thing the host has to be told about, so nothing
 * here swallows a status code: the caller gets the status and the server's own
 * sentence, because the server's sentence is the one with the line number in it.
 */

import type { ContentModel, EditOp } from './types.js';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    /** The server's supplementary line, e.g. "The edit was not saved." */
    readonly detail?: string,
  ) {
    super(message);
  }
}

function headers(passphrase: string | undefined, extra: Record<string, string> = {}): Record<string, string> {
  return passphrase ? { ...extra, 'x-gm-passphrase': passphrase } : extra;
}

async function unwrap(res: Response): Promise<never> {
  // A 500 from behind a proxy may not be JSON at all; a blank error message is
  // worse than an ugly one.
  const body = await res.json().catch(() => ({}));
  const payload = body as { error?: string; detail?: string };
  throw new ApiError(res.status, payload.error ?? `${res.status} ${res.statusText}`, payload.detail);
}

export async function fetchContent(passphrase?: string): Promise<ContentModel> {
  const res = await fetch('/api/content', { headers: headers(passphrase) });
  if (!res.ok) await unwrap(res);
  return (await res.json()) as ContentModel;
}

/**
 * Save. The hash is the file the editor was looking at — a mismatch is a 409
 * rather than a silent overwrite of whoever edited the file in vim.
 */
export async function saveContent(hash: string, ops: EditOp[], passphrase?: string): Promise<ContentModel> {
  const res = await fetch('/api/content', {
    method: 'PUT',
    headers: headers(passphrase, { 'content-type': 'application/json' }),
    body: JSON.stringify({ hash, ops }),
  });
  if (!res.ok) await unwrap(res);
  return (await res.json()) as ContentModel;
}

/**
 * Upload one file as a raw body. The server generates the stored filename from
 * the bytes' real type and a hash, so `name` is a hint for the slug and nothing
 * more — it never becomes a path.
 */
export async function uploadAsset(file: File, passphrase?: string): Promise<string> {
  const res = await fetch(`/api/assets?name=${encodeURIComponent(file.name)}`, {
    method: 'POST',
    // An explicit type matters: with no Content-Type the body parser skips the
    // request entirely and the upload arrives as "Empty upload".
    headers: headers(passphrase, { 'content-type': file.type || 'application/octet-stream' }),
    body: file,
  });
  if (!res.ok) await unwrap(res);
  const body = (await res.json()) as { ref: string };
  return body.ref;
}
