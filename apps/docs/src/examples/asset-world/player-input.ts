export interface Movement { x: number; z: number; run: boolean }
export type MoveAction = 'left' | 'right' | 'forward' | 'back' | 'run';
export const idleMovement: Movement = { x: 0, z: 0, run: false };

const keyActions: Record<string, MoveAction> = {
  KeyW: 'forward', ArrowUp: 'forward', KeyS: 'back', ArrowDown: 'back',
  KeyA: 'left', ArrowLeft: 'left', KeyD: 'right', ArrowRight: 'right',
  ShiftLeft: 'run', ShiftRight: 'run'
};

export function createMovementInput(onchange: (movement: Movement) => void) {
  const held = new Map<string, MoveAction>();
  let value = idleMovement;
  function publish() {
    const actions = new Set(held.values());
    const x = Number(actions.has('right')) - Number(actions.has('left'));
    const z = Number(actions.has('back')) - Number(actions.has('forward'));
    const run = actions.has('run');
    if (x !== value.x || z !== value.z || run !== value.run) onchange(value = { x, z, run });
  }
  function press(token: string, action: MoveAction) { held.set(token, action); publish(); }
  function release(token: string) { held.delete(token); publish(); }
  function clear() { held.clear(); publish(); }
  function keydown(event: KeyboardEvent) {
    if (event.isComposing || event.altKey || event.ctrlKey || event.metaKey) { clear(); return; }
    if (event.code === 'Escape') { clear(); return; }
    const action = keyActions[event.code];
    if (!action) return;
    event.preventDefault(); press(event.code, action);
  }
  function keyup(event: KeyboardEvent) {
    if (!keyActions[event.code]) return;
    event.preventDefault(); release(event.code);
  }
  function attach(element: HTMLElement) {
    const document = element.ownerDocument, window = document.defaultView!;
    const hidden = () => { if (document.hidden) clear(); };
    element.addEventListener('blur', clear);
    window.addEventListener('blur', clear);
    document.addEventListener('visibilitychange', hidden);
    return () => {
      element.removeEventListener('blur', clear);
      window.removeEventListener('blur', clear);
      document.removeEventListener('visibilitychange', hidden);
      clear();
    };
  }
  return { press, release, clear, keydown, keyup, attach };
}
