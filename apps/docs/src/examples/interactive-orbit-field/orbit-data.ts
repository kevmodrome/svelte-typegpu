import type { RgbaTuple, Vector3Tuple } from 'svelte-typegpu';

export interface OrbitItem {
  id: string;
  angle: number;
  radius: number;
  height: number;
  size: number;
  color: RgbaTuple;
  spinSpeed: number;
}

export interface InstanceTransform {
  position: Vector3Tuple;
  rotation: Vector3Tuple;
  scale: Vector3Tuple;
}

const palette: RgbaTuple[] = [
  [0.38, 0.92, 0.84, 1],
  [1, 0.66, 0.32, 1],
  [0.64, 0.78, 1, 1]
];

export function createOrbitItems(count = 21): OrbitItem[] {
  return Array.from({ length: count }, (_, index) => {
    const band = index % palette.length;
    const color = palette[band];

    if (!color) {
      throw new Error(`Missing orbit palette color for band ${band}`);
    }

    return {
      id: `orbiter-${index}`,
      angle: (index / count) * Math.PI * 2,
      radius: 1.3 + band * 0.42,
      height: (band - 1) * 0.3,
      size: 0.2 + band * 0.045,
      color,
      spinSpeed: 0.42 + (index % 5) * 0.14
    };
  });
}

export function getOrbitItemKey(item: OrbitItem): string {
  return item.id;
}

export function getOrbitItemTransform(item: OrbitItem, index: number): InstanceTransform {
  const lift = index % 2 === 0 ? 0.12 : -0.12;

  return {
    position: [
      Math.cos(item.angle) * item.radius,
      item.height + lift,
      Math.sin(item.angle) * item.radius
    ],
    rotation: [0.32 + index * 0.04, item.angle, 0.18],
    scale: [item.size, item.size, item.size]
  };
}

export function getOrbitItemColor(item: OrbitItem): RgbaTuple {
  return item.color;
}

export function getOrbitItemSpinSpeed(item: OrbitItem): number {
  return item.spinSpeed;
}
