import { describe, expect, it } from 'vitest';
import {
  applyCameraChange,
  DEFAULT_SCENE_CONTROLS,
  cameraControlsForCount,
  clampSceneControls,
  copySceneControls,
  formatHueColor,
  nextHue
} from './scene-controls';

describe('scene controls', () => {
  it('normalizes interactive control values into safe renderer ranges', () => {
    expect(
      clampSceneControls({
        ...DEFAULT_SCENE_CONTROLS,
        spinSpeed: 4,
        cubeScale: -1,
        cubeCount: 20_000,
        hue: 725,
        mouseSensitivity: 8,
        camera: {
          position: [-2000, 2.125, 2000],
          target: [1500, -2.125, -1500],
          fov: 150,
          near: -1,
          far: 0.2
        }
      })
    ).toEqual({
      ...DEFAULT_SCENE_CONTROLS,
      spinSpeed: 2,
      cubeScale: 0.45,
      cubeCount: 10_000,
      hue: 5,
      mouseSensitivity: 4,
      camera: {
        position: [-1000, 2.13, 1000],
        target: [1000, -2.12, -1000],
        fov: 100,
        near: 0.01,
        far: 1.01
      }
    });
  });

  it('creates camera defaults that frame each cube count preset', () => {
    expect(cameraControlsForCount(1)).toEqual({
      position: [0, 1.4, 5],
      target: [0, 0, 0],
      fov: 45,
      near: 0.1,
      far: 500
    });

    expect(cameraControlsForCount(10_000)).toEqual({
      position: [9, 7, 13],
      target: [0, 0, 0],
      fov: 45,
      near: 0.1,
      far: 500
    });
  });

  it('stores target directly in camera controls', () => {
    expect(DEFAULT_SCENE_CONTROLS.camera).toMatchObject({
      position: [0, 1.4, 5],
      target: [0, 0, 0],
      fov: 45,
      near: 0.1,
      far: 500
    });
  });

  it('applies camera change events to scene controls', () => {
    const controls = clampSceneControls(DEFAULT_SCENE_CONTROLS);

    applyCameraChange(controls, {
      camera: {
        position: [1.25, 2.5, 7.75],
        target: [0.5, 0.25, -0.5],
        fov: 55,
        near: 0.2,
        far: 300
      },
      orbit: {
        radius: 8,
        yaw: 0.25,
        pitch: 0.1
      }
    });

    expect(controls.camera).toEqual({
      position: [1.25, 2.5, 7.75],
      target: [0.5, 0.25, -0.5],
      fov: 55,
      near: 0.2,
      far: 300
    });
  });

  it('preserves renderer precision when applying camera change events', () => {
    const controls = clampSceneControls(DEFAULT_SCENE_CONTROLS);

    applyCameraChange(controls, {
      camera: {
        position: [-2.397128, 1.412345, 4.387913],
        target: [0.123456, -0.654321, 0.222222],
        fov: 45,
        near: 0.1,
        far: 500
      },
      orbit: {
        radius: 5.192302,
        yaw: 0.25,
        pitch: 0.1
      }
    });

    expect(controls.camera.position).toEqual([-2.397128, 1.412345, 4.387913]);
    expect(controls.camera.target).toEqual([0.123456, -0.654321, 0.222222]);
  });

  it('keeps clamped camera position away from target', () => {
    expect(
      clampSceneControls({
        ...DEFAULT_SCENE_CONTROLS,
        camera: {
          ...DEFAULT_SCENE_CONTROLS.camera,
          position: [0, 0, 0],
          target: [0, 0, 0]
        }
      }).camera
    ).toMatchObject({
      position: [0, 0, 1],
      target: [0, 0, 0]
    });
  });

  it('copies clamped control values without replacing the target object', () => {
    const target = clampSceneControls(DEFAULT_SCENE_CONTROLS);
    const camera = target.camera;

    copySceneControls(target, {
      ...target,
      spinSpeed: 4,
      hue: 725,
      mouseSensitivity: 0,
      camera: {
        ...target.camera,
        position: [3.333, 4.444, 5.555],
        target: [-1.111, -2.222, -3.333]
      }
    });

    expect(target.spinSpeed).toBe(2);
    expect(target.hue).toBe(5);
    expect(target.mouseSensitivity).toBe(0.1);
    expect(target.camera).toBe(camera);
    expect(target.camera.position).toEqual([3.33, 4.44, 5.56]);
    expect(target.camera.target).toEqual([-1.11, -2.22, -3.33]);
  });

  it('wraps hue changes and formats the material color', () => {
    expect(nextHue(330)).toBe(17);
    expect(formatHueColor(17)).toBe('hsl(17, 82%, 62%)');
  });
});
