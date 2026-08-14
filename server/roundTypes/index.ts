/**
 * Round type registry.
 *
 * Adding a type is: write the module, add it here. The proper extractable
 * plugin SDK is Phase 3 — this registry is the seam it will grow out of.
 *
 * Before adding one, re-read the header of ./manual.ts. Most "new games" are
 * `manual` plus content.
 */

import type { RoundType } from './contract.js';
import { boardRoundType } from './board.js';
import { manualRoundType } from './manual.js';
import { multipleChoiceRoundType } from './multipleChoice.js';

const registry = new Map<string, RoundType<never, never>>();

function register(rt: RoundType<any, any>): void {
  registry.set(rt.id, rt as RoundType<never, never>);
}

register(manualRoundType);
register(multipleChoiceRoundType);
register(boardRoundType);

export function getRoundType(id: string): RoundType<any, any> | undefined {
  return registry.get(id) as RoundType<any, any> | undefined;
}

export function knownRoundTypeIds(): string[] {
  return [...registry.keys()];
}

export type { RoundType, RoundContext } from './contract.js';
