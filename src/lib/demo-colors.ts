import type { RgbaTuple } from './typegpu-renderer/types';

export function demoColorForIndex(index: number, hue: number): RgbaTuple {
  const baseColor = hslToRgb(hue, 0.82, 0.62);
  const shade = 0.72 + (index % 17) * 0.018;

  return [
    Math.min(1, baseColor[0] * shade),
    Math.min(1, baseColor[1] * shade),
    Math.min(1, baseColor[2] * shade),
    1
  ];
}

export function hslToRgb(hue: number, saturation: number, lightness: number): [number, number, number] {
  const normalizedHue = (((hue % 360) + 360) % 360) / 360;

  if (saturation === 0) {
    return [lightness, lightness, lightness];
  }

  const q =
    lightness < 0.5
      ? lightness * (1 + saturation)
      : lightness + saturation - lightness * saturation;
  const p = 2 * lightness - q;

  return [
    hueChannel(p, q, normalizedHue + 1 / 3),
    hueChannel(p, q, normalizedHue),
    hueChannel(p, q, normalizedHue - 1 / 3)
  ].map((value) => Math.round(value * 1_000_000) / 1_000_000) as [number, number, number];
}

function hueChannel(p: number, q: number, t: number): number {
  let value = t;
  if (value < 0) value += 1;
  if (value > 1) value -= 1;
  if (value < 1 / 6) return p + (q - p) * 6 * value;
  if (value < 1 / 2) return q;
  if (value < 2 / 3) return p + (q - p) * (2 / 3 - value) * 6;
  return p;
}
