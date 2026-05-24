import { MESH_VERTEX_FLOATS } from './instance-data';
import type { TypeGpuGeometryData } from './types';

export const SPHERE_SEGMENTS = 16;
export const SPHERE_RINGS = 8;
export const SPHERE_VERTEX_COUNT = SPHERE_SEGMENTS * 6 * (SPHERE_RINGS - 1);

export function createSphereVertexData(
  segments = SPHERE_SEGMENTS,
  rings = SPHERE_RINGS
): Float32Array {
  const data: number[] = [];

  for (let ring = 0; ring < rings; ring += 1) {
    const thetaA = (ring / rings) * Math.PI;
    const thetaB = ((ring + 1) / rings) * Math.PI;

    for (let segment = 0; segment < segments; segment += 1) {
      const phiA = (segment / segments) * Math.PI * 2;
      const phiB = ((segment + 1) / segments) * Math.PI * 2;

      if (ring > 0) {
        pushSphereVertex(data, thetaA, phiA, segment / segments, ring / rings);
        pushSphereVertex(data, thetaB, phiA, segment / segments, (ring + 1) / rings);
        pushSphereVertex(data, thetaA, phiB, (segment + 1) / segments, ring / rings);
      }

      if (ring < rings - 1) {
        pushSphereVertex(data, thetaB, phiA, segment / segments, (ring + 1) / rings);
        pushSphereVertex(data, thetaB, phiB, (segment + 1) / segments, (ring + 1) / rings);
        pushSphereVertex(data, thetaA, phiB, (segment + 1) / segments, ring / rings);
      }
    }
  }

  return new Float32Array(data);
}

export function createSphereGeometryData(): TypeGpuGeometryData {
  return {
    key: 'sphere',
    vertexData: createSphereVertexData(),
    vertexCount: SPHERE_VERTEX_COUNT,
    vertexFloats: MESH_VERTEX_FLOATS
  };
}

function pushSphereVertex(data: number[], theta: number, phi: number, u: number, v: number): void {
  const sinTheta = Math.sin(theta);
  const x = sinTheta * Math.cos(phi);
  const y = Math.cos(theta);
  const z = sinTheta * Math.sin(phi);

  data.push(x * 0.5, y * 0.5, z * 0.5, x, y, z, u, v);
}
