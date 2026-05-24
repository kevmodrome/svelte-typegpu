import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('app camera controls', () => {
  const source = readFileSync('src/App.svelte', 'utf8');
  const canvasSource = readFileSync('src/TypeGpuCanvas.svelte', 'utf8');
  const styleSource = readFileSync('src/style.css', 'utf8');

  it('clamps camera position while sliders are moving', () => {
    const marker = 'bind:value={controls.camera.position[axis]}';
    const markerIndex = source.indexOf(marker);
    const inputStart = source.lastIndexOf('<input', markerIndex);
    const inputEnd = source.indexOf('/>', markerIndex);
    const positionSlider = source.slice(inputStart, inputEnd);

    expect(positionSlider).toContain('oninput={clampControls}');
  });

  it('starts the TypeGPU root with explicit demo surface options', () => {
    expect(canvasSource).toContain('frameloop: \'always\'');
    expect(canvasSource).toContain('maxDevicePixelRatio: 1.5');
    expect(canvasSource).toContain('clearColor: [0.067, 0.078, 0.102, 1]');
    expect(canvasSource).toContain('depth: true');
    expect(canvasSource).toContain('alphaMode: \'premultiplied\'');
  });

  it('keeps keyboard focus visible on the TypeGPU canvas', () => {
    expect(styleSource).toContain('.renderer-root-canvas:focus-visible');
    expect(styleSource).toMatch(/\.renderer-root-canvas:focus-visible\s*{[^}]*outline:/s);
  });
});
