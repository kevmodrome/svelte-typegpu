<script lang="ts">
  import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Footprints } from '@lucide/svelte';
  import { createMovementInput, idleMovement, type MoveAction, type Movement } from './player-input';
  let { disabled = false, onmove }: { disabled?: boolean; onmove: (movement: Movement) => void } = $props();
  let movement = $state(idleMovement);
  const input = createMovementInput(value => { movement = value; onmove(value); });
  const directions = [
    { action: 'forward', label: 'Move forward', icon: ArrowUp, column: 2, row: 1 },
    { action: 'left', label: 'Move left', icon: ArrowLeft, column: 1, row: 2 },
    { action: 'right', label: 'Move right', icon: ArrowRight, column: 3, row: 2 },
    { action: 'back', label: 'Move backward', icon: ArrowDown, column: 2, row: 3 }
  ] as const;
  $effect(() => { if (disabled) input.clear(); });
  function press(event: PointerEvent, action: MoveAction) {
    if (disabled || event.button !== 0) return;
    event.preventDefault();
    (event.currentTarget as HTMLButtonElement).setPointerCapture(event.pointerId);
    input.press(`pointer-${event.pointerId}`, action);
  }
  function release(event: PointerEvent) { input.release(`pointer-${event.pointerId}`); }
</script>

<div class="movement-pad" role="group" aria-label="Camper movement" {@attach input.attach}
  onfocusout={() => input.clear()}>
  {#each directions as direction (direction.action)}
    <button type="button" {disabled} aria-label={direction.label} title={direction.label}
      style:grid-column={direction.column} style:grid-row={direction.row}
      onpointerdown={event => press(event, direction.action)} onpointerup={release}
      onpointercancel={release} onlostpointercapture={release}
      onkeydown={event => {
        if (event.code === 'Space' || event.code === 'Enter') {
          event.preventDefault(); input.press(`button-${event.code}`, direction.action);
        }
      }}
      onkeyup={event => { event.preventDefault(); input.release(`button-${event.code}`); }}>
      <direction.icon size={19} aria-hidden="true" />
    </button>
  {/each}
  <button type="button" class="run" {disabled} aria-label="Run" title="Run" aria-pressed={movement.run}
    onclick={() => movement.run ? input.release('run') : input.press('run', 'run')}>
    <Footprints size={19} aria-hidden="true" />
  </button>
</div>

<style>
  .movement-pad { display: grid; grid-template-columns: repeat(3, 38px); grid-template-rows: repeat(3, 38px); gap: 4px; width: max-content; touch-action: none; }
  button { display: grid; place-items: center; padding: 0; border: 1px solid #74877f; border-radius: 4px; background: #1c302be8; color: #f0f5f2; cursor: pointer; touch-action: none; user-select: none; }
  button:hover, button:active, button[aria-pressed="true"] { background: #f1d264; border-color: #f1d264; color: #172d2e; }
  button:disabled { opacity: 0.4; cursor: default; }
  button:focus-visible { outline: 2px solid #f1d264; outline-offset: 2px; }
  .run { grid-column: 2; grid-row: 2; }
  @media (pointer: coarse) { .movement-pad { grid-template-columns: repeat(3, 44px); grid-template-rows: repeat(3, 44px); } }
</style>
