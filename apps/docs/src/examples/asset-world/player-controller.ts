import SAT from 'sat';
import { details, landmarks, trees, type Placement } from './world';
import type { Movement } from './player-input';

export interface PlayerState { x: number; y: number; z: number; heading: number; stride: number }
export interface CameraDirection { x: number; z: number }
export const initialCameraDirection: CameraDirection = { x: 17, z: 21 };
export const playerRadius = 0.28;
export const walkSpeed = 2.6;
export const runSpeed = 4.8;
export function createPlayerState(): PlayerState { return { x: -0.9, y: 0.03, z: 7, heading: 0, stride: 0 }; }

function box(x: number, z: number, width: number, depth: number, angle = 0) {
  const shape = new SAT.Box(new SAT.Vector(), width, depth).toPolygon();
  shape.translate(-width / 2, -depth / 2).setAngle(-angle);
  shape.pos.x = x; shape.pos.y = z;
  return shape;
}
function scale(item: Placement) { return typeof item.scale === 'number' ? item.scale : item.scale[0]; }
function circle(item: Placement, radius: number) {
  return new SAT.Circle(new SAT.Vector(item.position[0], item.position[2]), radius);
}

// Gameplay footprints in the XZ plane, intentionally simpler than visual meshes.
const solid = [
  box(-10.5, 0, 1, 30), box(10.5, 0, 1, 30), box(0, -8.5, 30, 1), box(0, 8.5, 30, 1),
  box(3.5, -6.7, 3, 6.6), box(3.5, 4.2, 3, 11.6),
  ...landmarks.filter(item => item.asset !== 'bridge').map(item => item.asset === 'tent'
    ? box(item.position[0], item.position[2], scale(item) * 0.8, scale(item) * 0.62, item.rotation?.[1])
    : circle(item, item.asset === 'firepit' ? 0.7 : 0.22)),
  ...details.map(item => item.asset === 'log'
    ? box(item.position[0], item.position[2], scale(item) * 0.8, scale(item) * 0.24, item.rotation?.[1])
    : circle(item, scale(item) * 0.28))
];
const trunks = trees.map(item => circle(item, scale(item) * 0.12));

export function createPlayerController() {
  const body = new SAT.Circle(new SAT.Vector(), playerRadius), response = new SAT.Response();
  let phase = 0;
  function resolve(shapes: (SAT.Circle | SAT.Polygon)[]) {
    for (const shape of shapes) {
      response.clear();
      const hit = shape instanceof SAT.Circle
        ? SAT.testCircleCircle(body, shape, response) : SAT.testCirclePolygon(body, shape, response);
      if (hit) body.pos.sub(response.overlapV);
    }
  }
  function penetrates(shape: SAT.Circle | SAT.Polygon) {
    response.clear();
    return (shape instanceof SAT.Circle ? SAT.testCircleCircle(body, shape, response)
      : SAT.testCirclePolygon(body, shape, response)) && response.overlap > 1e-7;
  }
  function step(state: PlayerState, input: Movement, delta: number, camera: CameraDirection, forest: boolean) {
    const magnitude = Math.hypot(input.x, input.z);
    if (!magnitude || !Number.isFinite(delta) || delta <= 0) return;
    const length = Math.hypot(camera.x, camera.z) || 1;
    const cx = camera.x / length, cz = camera.z / length;
    const dx = (input.x * cz + input.z * cx) / magnitude;
    const dz = (-input.x * cx + input.z * cz) / magnitude;
    const distance = (input.run ? runSpeed : walkSpeed) * Math.min(delta, 0.05);
    const steps = Math.max(1, Math.ceil(distance / 0.12));
    body.pos.x = state.x; body.pos.y = state.z;
    for (let i = 0; i < steps; i++) {
      const x = body.pos.x, z = body.pos.y;
      body.pos.x += dx * distance / steps; body.pos.y += dz * distance / steps;
      // Short substeps prevent tunnelling; repeat projection at obstacle corners.
      for (let pass = 0; pass < 3; pass++) { resolve(solid); if (forest) resolve(trunks); }
      // Conflicting footprints must not push the camper through a neighbouring wall.
      if (solid.some(penetrates) || (forest && trunks.some(penetrates))) { body.pos.x = x; body.pos.y = z; }
    }
    const travelled = Math.hypot(body.pos.x - state.x, body.pos.y - state.z);
    state.x = body.pos.x; state.z = body.pos.y;
    state.heading = Math.atan2(dx, dz);
    phase = (phase + travelled * 8) % (Math.PI * 2);
    state.stride = travelled > 1e-6 ? Math.sin(phase) * 0.55 : 0;
    const bridge = state.z > -3.4 && state.z < -1.6 && state.x > 1.6 && state.x < 5.4;
    state.y = bridge ? 0.03 + 0.37 * Math.min(1, (state.x - 1.6) / 0.4, (5.4 - state.x) / 0.4) : 0.03;
  }
  return { step };
}
