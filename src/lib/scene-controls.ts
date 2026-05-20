export interface SceneControls {
  spinEnabled: boolean;
  spinSpeed: number;
  cubeScale: number;
  hue: number;
}

export const DEFAULT_SCENE_CONTROLS: SceneControls = {
  spinEnabled: true,
  spinSpeed: 1,
  cubeScale: 1,
  hue: 330
};

export function clampSceneControls(controls: SceneControls): SceneControls {
  return {
    spinEnabled: controls.spinEnabled,
    spinSpeed: clamp(controls.spinSpeed, 0, 2),
    cubeScale: clamp(controls.cubeScale, 0.45, 2.2),
    hue: normalizeHue(controls.hue)
  };
}

export function nextHue(hue: number, step = 47): number {
  return normalizeHue(hue + step);
}

export function formatHueColor(hue: number): string {
  return `hsl(${normalizeHue(hue)}, 82%, 62%)`;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function normalizeHue(hue: number): number {
  return ((Math.round(hue) % 360) + 360) % 360;
}
