import type { RgbaTuple, Vector3Tuple } from 'svelte-typegpu';

export type GravityPreset =
  | 'Solar System'
  | 'Asteroids'
  | 'Colliding asteroids'
  | 'Bouncy dust'
  | 'Merging dust';

export const gravityPresets: GravityPreset[] = [
  'Solar System',
  'Asteroids',
  'Colliding asteroids',
  'Bouncy dust',
  'Merging dust'
];

export interface GravityBody {
  id: string;
  position: Vector3Tuple;
  velocity: Vector3Tuple;
  mass: number;
  radius: number;
  color: RgbaTuple;
}

const presets: Record<GravityPreset, GravityBody[]> = {
  'Solar System': [
    body('sun', [0, 0, 0], [0, 0, 0], 90, 0.5, [1, 0.68, 0.18, 1]),
    body('mercury', [1.35, 0, 0], [0, 0, 2.2], 0.6, 0.08, [0.55, 0.52, 0.48, 1]),
    body('venus', [1.85, 0, 0], [0, 0, 1.85], 0.9, 0.12, [0.82, 0.66, 0.38, 1]),
    body('earth', [2.35, 0, 0], [0, 0, 1.65], 1, 0.13, [0.25, 0.48, 1, 1]),
    body('mars', [3.45, 0, 0], [0, 0, 1.35], 0.85, 0.11, [0.92, 0.34, 0.22, 1]),
    body('jupiter', [5.2, 0, 0], [0, 0, 1.02], 6.5, 0.28, [0.86, 0.62, 0.42, 1])
  ],
  Asteroids: [
    body('jupiter', [0, 0, 0], [0, 0, 0], 120, 0.5, [0.86, 0.62, 0.42, 1]),
    ...asteroidRing('asteroid', 32, 2.4, 5.4, 120, [0.6, 0.56, 0.5, 1], 1)
  ],
  'Colliding asteroids': [
    body('saturn-core', [0, 0, 0], [0, 0, 0], 65, 0.42, [0.88, 0.74, 0.46, 1]),
    body('moon-projectile', [0, 0, -6.4], [1.42, 0, 0.25], 2.4, 0.18, [0.78, 0.8, 0.82, 1]),
    ...asteroidRing('collision-asteroid', 24, 2.2, 4.6, 65, [0.68, 0.52, 0.4, 1], -1)
  ],
  'Bouncy dust': dustCloud('bouncy-dust', 40, 4.2, [0.64, 0.82, 1, 1], 0.1),
  'Merging dust': dustCloud('merging-dust', 40, 4.2, [0.9, 0.5, 0.36, 1], 0.06)
};

export function createGravityBodies(preset: GravityPreset): GravityBody[] {
  return presets[preset].map(copyBody);
}

export function stepGravity(
  bodies: readonly GravityBody[],
  deltaSeconds: number,
  speed: number
): GravityBody[] {
  const dt = Math.min(deltaSeconds, 0.05) * speed;
  const gravity = 0.8;
  const softening = 0.35;

  return bodies.map((body, index) => {
    const acceleration: Vector3Tuple = [0, 0, 0];

    bodies.forEach((other, otherIndex) => {
      if (index === otherIndex) return;

      const dx = other.position[0] - body.position[0];
      const dy = other.position[1] - body.position[1];
      const dz = other.position[2] - body.position[2];
      const distanceSquared = dx * dx + dy * dy + dz * dz + softening;
      const distance = Math.sqrt(distanceSquared);
      const force = (gravity * other.mass) / distanceSquared;

      acceleration[0] += (dx / distance) * force;
      acceleration[1] += (dy / distance) * force;
      acceleration[2] += (dz / distance) * force;
    });

    const velocity: Vector3Tuple = [
      body.velocity[0] + acceleration[0] * dt,
      body.velocity[1] + acceleration[1] * dt,
      body.velocity[2] + acceleration[2] * dt
    ];
    const position: Vector3Tuple = [
      body.position[0] + velocity[0] * dt,
      body.position[1] + velocity[1] * dt,
      body.position[2] + velocity[2] * dt
    ];

    return {
      ...body,
      position,
      velocity
    };
  });
}

function body(
  id: string,
  position: Vector3Tuple,
  velocity: Vector3Tuple,
  mass: number,
  radius: number,
  color: RgbaTuple
): GravityBody {
  return { id, position, velocity, mass, radius, color };
}

function asteroidRing(
  idPrefix: string,
  count: number,
  minRadius: number,
  maxRadius: number,
  centerMass: number,
  color: RgbaTuple,
  direction: 1 | -1
): GravityBody[] {
  return Array.from({ length: count }, (_, index) => {
    const ratio = index / count;
    const radius = minRadius + (maxRadius - minRadius) * ((index % 9) / 8);
    const angle = ratio * Math.PI * 2;
    const x = Math.cos(angle) * radius;
    const z = Math.sin(angle) * radius;
    const speed = Math.sqrt(centerMass / radius) * 0.16;

    return body(
      `${idPrefix}-${index}`,
      [x, ((index % 5) - 2) * 0.05, z],
      [-Math.sin(angle) * speed * direction, 0, Math.cos(angle) * speed * direction],
      0.08,
      0.055,
      color
    );
  });
}

function dustCloud(idPrefix: string, count: number, radius: number, color: RgbaTuple, mass: number): GravityBody[] {
  return Array.from({ length: count }, (_, index) => {
    const phi = index * 2.399963229728653;
    const y = -1 + (2 * index) / Math.max(1, count - 1);
    const ringRadius = Math.sqrt(1 - y * y) * radius;
    const x = Math.cos(phi) * ringRadius;
    const z = Math.sin(phi) * ringRadius;

    return body(
      `${idPrefix}-${index}`,
      [x, y * radius * 0.45, z],
      [z * 0.035, -x * 0.01, -x * 0.035],
      mass,
      0.052,
      color
    );
  });
}

function copyBody(source: GravityBody): GravityBody {
  return {
    ...source,
    position: [...source.position],
    velocity: [...source.velocity],
    color: [...source.color]
  };
}
