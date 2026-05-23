import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('app camera controls', () => {
  const source = readFileSync('src/App.svelte', 'utf8');

  it('clamps camera position while sliders are moving', () => {
    const marker = 'bind:value={controls.camera.position[axis]}';
    const markerIndex = source.indexOf(marker);
    const inputStart = source.lastIndexOf('<input', markerIndex);
    const inputEnd = source.indexOf('/>', markerIndex);
    const positionSlider = source.slice(inputStart, inputEnd);

    expect(positionSlider).toContain('oninput={clampControls}');
  });
});
