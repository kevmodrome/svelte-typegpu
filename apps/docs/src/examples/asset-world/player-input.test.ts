import { describe, expect, it, vi } from 'vitest';
import { createMovementInput, idleMovement } from './player-input';

function key(code: string, extra = {}) {
  return { code, preventDefault: vi.fn(), ...extra } as unknown as KeyboardEvent;
}
describe('campsite input ownership', () => {
  it('retains aliases, cancels opposites and avoids repeat notifications', () => {
    const changed = vi.fn(), input = createMovementInput(changed);
    input.keydown(key('KeyW')); input.keydown(key('KeyW')); input.keydown(key('ArrowUp'));
    expect(changed).toHaveBeenCalledTimes(1);
    input.keyup(key('KeyW')); expect(changed).toHaveBeenCalledTimes(1);
    input.keydown(key('KeyS')); expect(changed).toHaveBeenLastCalledWith(idleMovement);
    input.keyup(key('ArrowUp')); expect(changed).toHaveBeenLastCalledWith({ x: 0, z: 1, run: false });
    input.keydown(key('ShiftLeft')); expect(changed).toHaveBeenLastCalledWith({ x: 0, z: 1, run: true });
    input.keydown(key('Escape')); expect(changed).toHaveBeenLastCalledWith(idleMovement);
  });
  it('tracks multiple touch pointers independently and clears cancelled input', () => {
    const changed = vi.fn(), input = createMovementInput(changed);
    input.press('pointer-1', 'forward'); input.press('pointer-2', 'right');
    expect(changed).toHaveBeenLastCalledWith({ x: 1, z: -1, run: false });
    input.release('pointer-1'); expect(changed).toHaveBeenLastCalledWith({ x: 1, z: 0, run: false });
    input.clear(); expect(changed).toHaveBeenLastCalledWith(idleMovement);
    const count = changed.mock.calls.length; input.clear(); expect(changed).toHaveBeenCalledTimes(count);
  });
  it('leaves browser shortcuts and unrelated keys alone', () => {
    const changed = vi.fn(), input = createMovementInput(changed);
    for (const event of [key('KeyW', { metaKey: true }), key('KeyA', { ctrlKey: true }), key('Tab'), key('KeyW', { isComposing: true })]) {
      input.keydown(event); expect(event.preventDefault).not.toHaveBeenCalled();
    }
    expect(changed).not.toHaveBeenCalled();
  });
  it('clears held keys on blur, hide and attachment disposal without leaking listeners', () => {
    const window = new EventTarget(), document = Object.assign(new EventTarget(), { hidden: false, defaultView: window });
    const element = Object.assign(new EventTarget(), { ownerDocument: document });
    const changed = vi.fn(), input = createMovementInput(changed);
    const cleanup = input.attach(element as unknown as HTMLElement);
    for (const [target, event] of [[element, 'blur'], [window, 'blur'], [document, 'visibilitychange']] as const) {
      input.keydown(key('KeyW')); document.hidden = true; target.dispatchEvent(new Event(event));
      expect(changed).toHaveBeenLastCalledWith(idleMovement);
    }
    input.keydown(key('KeyW')); cleanup(); expect(changed).toHaveBeenLastCalledWith(idleMovement);
    input.keydown(key('KeyW')); window.dispatchEvent(new Event('blur'));
    expect(changed).toHaveBeenLastCalledWith({ x: 0, z: -1, run: false });
  });
});
