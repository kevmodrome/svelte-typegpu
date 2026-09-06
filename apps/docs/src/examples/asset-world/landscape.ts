import { details, landmarks, trees, type Placement } from './world';

export const campsiteModelCount = landmarks.length + trees.length + details.length + 1;
export const worldCounts = [campsiteModelCount, 1000, 5000, 20000, 50000] as const;
export const cellSize = 4.4;
export interface Landscape {
  placements: Placement[];
  halfWidth: number;
  halfDepth: number;
}
export const compactLandscape: Landscape = { placements: [], halfWidth: 10, halfDepth: 8 };

function hash(x: number, z: number) {
  let value = Math.imul(x, 374761393) ^ Math.imul(z, 668265263);
  value = Math.imul(value ^ (value >>> 13), 1274126177);
  return (value ^ (value >>> 16)) >>> 0;
}

export function createLandscape(count: number): Landscape {
  if (!Number.isInteger(count) || count < campsiteModelCount || count > 50000) throw new RangeError('World count must be between 29 and 50000');
  if (count === campsiteModelCount) return compactLandscape;
  const placements: Placement[] = [];
  const required = count - campsiteModelCount;
  let radius = 0;
  function place(cx: number, cz: number) {
    if (placements.length === required) return;
    const seed = hash(cx, cz), x = cx * cellSize + (seed % 101 / 100 - 0.5) * 1.8;
    const z = cz * cellSize + ((seed >>> 8) % 101 / 100 - 0.5) * 1.8;
    if ((Math.abs(x) < 16 && Math.abs(z) < 13) || (x > 0.4 && x < 6.6)) return;
    // Open trails between groves, independent of requested count.
    if (Math.abs(cx) % 16 === 15 || Math.abs(cz) % 16 === 15) return;
    const kind = seed % 10, asset = kind < 6 ? 'pine' : kind < 8 ? 'oak' : kind === 8 ? 'rock' : 'log';
    const scale = asset === 'rock' || asset === 'log' ? 1.5 + (seed % 100) / 100 : 2 + (seed % 150) / 100;
    placements.push({ key: `land:${cx}:${cz}`, asset, position: [x, scale * 0.05, z], scale,
      rotation: [0, (seed % 628) / 100, 0] });
  }
  while (placements.length < required) {
    radius++;
    for (let x = -radius; x <= radius; x++) { place(x, -radius); place(x, radius); }
    for (let z = -radius + 1; z < radius; z++) { place(-radius, z); place(radius, z); }
  }
  return { placements, halfWidth: (radius + 2) * cellSize, halfDepth: (radius + 2) * cellSize };
}
