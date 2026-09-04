import { describe, expect, it } from 'vitest';
import { createGravityBodies, stepGravity } from './gravity-simulation';

describe('gravity example simulation', () => {
  it('pulls bodies toward each other while keeping the source data immutable', () => {
    const bodies = createGravityBodies('Solar System');
    const before = bodies.map((body) => ({ position: [...body.position], velocity: [...body.velocity] }));

    const next = stepGravity(bodies, 0.016, 1);

    expect(next).not.toBe(bodies);
    expect(bodies.map((body) => body.position)).toEqual(before.map((body) => body.position));
    expect(next[1].position[0]).toBeLessThan(before[1].position[0]);
  });

  it('provides the official gravity presets as reduced declarative scenes', () => {
    expect(createGravityBodies('Solar System').length).toBeGreaterThan(4);
    expect(createGravityBodies('Asteroids').length).toBeGreaterThan(10);
    expect(createGravityBodies('Colliding asteroids').some((body) => body.id.includes('moon'))).toBe(true);
    expect(createGravityBodies('Bouncy dust').length).toBeGreaterThan(10);
    expect(createGravityBodies('Merging dust').length).toBeGreaterThan(10);
  });
});
