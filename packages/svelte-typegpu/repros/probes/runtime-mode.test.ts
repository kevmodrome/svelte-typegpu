import { DEV } from 'esm-env';
import { expect, it } from 'vitest';
import { compilerModes } from '../compiler-modes';

it('uses the requested Svelte runtime mode', () => {
  expect(DEV).toBe(process.env.NODE_ENV !== 'production');
  expect(compilerModes).toEqual(DEV ? [false, true] : [false]);
});
