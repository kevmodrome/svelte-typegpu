import type { TypeGpuNode } from './core';
import { collectCameraCandidates, readCameraStateFromCandidates, type TypeGpuCameraCandidates } from './camera';
import type { TypeGpuCameraSettings, TypeGpuCameraState, TypeGpuNormalizedCameraSettings,
  TypeGpuSceneState, Vector3Tuple } from './types';

interface CameraRecord {
  declared: TypeGpuNormalizedCameraSettings;
  live: TypeGpuCameraSettings;
}

export class SceneCameraCache {
  #root: TypeGpuNode | null = null;
  #cameras = new WeakMap<TypeGpuNode, CameraRecord>();
  #candidates: TypeGpuCameraCandidates | null = null;
  #treeRevision = -1;

  read(root: TypeGpuNode, activeCameraId?: string | null): TypeGpuCameraState {
    this.#useRoot(root);
    if (!this.#candidates || this.#treeRevision !== root.treeRevision) {
      this.#candidates = collectCameraCandidates(root);
      this.#treeRevision = root.treeRevision;
    }
    return readCameraStateFromCandidates(this.#candidates, activeCameraId);
  }

  resolve(root: TypeGpuNode, declared: TypeGpuCameraState, previous?: TypeGpuSceneState): TypeGpuCameraSettings {
    this.#useRoot(root);
    if (previous?.cameraNode) {
      // Controls replace the active scene's settings between compilations.
      const active = this.#cameras.get(previous.cameraNode);
      if (active) active.live = previous.camera;
    }
    if (!declared.node) return declared.settings;
    let record = this.#cameras.get(declared.node);
    if (!record) {
      record = { declared: snapshot(declared.settings), live: declared.settings };
      this.#cameras.set(declared.node, record);
    } else {
      const next = applyDeclarations(record.declared, declared.settings, record.live);
      if (next !== record.live) {
        record.declared = snapshot(declared.settings);
        record.live = next;
      }
    }
    return record.live;
  }

  clear(): void {
    this.#root = null;
    this.#cameras = new WeakMap();
    this.#candidates = null;
    this.#treeRevision = -1;
  }

  #useRoot(root: TypeGpuNode): void {
    if (this.#root === root) return;
    this.clear();
    this.#root = root;
  }
}

function snapshot(camera: TypeGpuNormalizedCameraSettings): TypeGpuNormalizedCameraSettings {
  return { ...camera, position: [...camera.position], target: [...camera.target] };
}

function applyDeclarations(
  previous: TypeGpuNormalizedCameraSettings,
  next: TypeGpuNormalizedCameraSettings,
  live: TypeGpuCameraSettings
): TypeGpuCameraSettings {
  if (previous.projection !== next.projection) return next;
  const positionChanged = !sameVector(previous.position, next.position);
  const targetChanged = !sameVector(previous.target, next.target);
  const lensChanged = previous.fov !== next.fov || previous.zoom !== next.zoom;
  if (!positionChanged && !targetChanged && previous.near === next.near &&
    previous.far === next.far && !lensChanged) return live;
  const position = positionChanged ? next.position : live.position;
  const target = targetChanged ? next.target : live.target;
  const near = previous.near === next.near ? live.near : next.near;
  const far = previous.far === next.far ? live.far : next.far;
  return next.projection === 'orthographic'
    ? { projection: 'orthographic', position, target, near, far,
        zoom: lensChanged || live.projection !== 'orthographic' ? next.zoom : live.zoom }
    : { projection: 'perspective', position, target, near, far,
        fov: lensChanged || live.projection === 'orthographic' ? next.fov : live.fov };
}

function sameVector(a: Vector3Tuple, b: Vector3Tuple): boolean {
  return a[0] === b[0] && a[1] === b[1] && a[2] === b[2];
}
