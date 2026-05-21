import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SCENE_CONTROLS,
  cameraLookAt,
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
        camera: {
          position: [-80, 2.125, 80],
          rotation: {
            yaw: 240,
            pitch: -120
          },
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
      camera: {
        position: [-40, 2.13, 40],
        rotation: {
          yaw: 180,
          pitch: -85
        },
        fov: 100,
        near: 0.01,
        far: 1.01
      }
    });
  });

  it('creates camera defaults that frame each cube count preset', () => {
    expect(cameraControlsForCount(1)).toEqual({
      position: [0, 1.4, 5],
      rotation: {
        yaw: 0,
        pitch: -15.64
      },
      fov: 45,
      near: 0.1,
      far: 500
    });

    expect(cameraControlsForCount(10_000)).toEqual({
      position: [9, 7, 13],
      rotation: {
        yaw: -34.7,
        pitch: -23.88
      },
      fov: 45,
      near: 0.1,
      far: 500
    });
  });

  it('derives a look-at point from camera position and rotation', () => {
    expect(cameraLookAt(DEFAULT_SCENE_CONTROLS.camera)).toEqual([0, 1.13, 4.04]);
  });

  it('copies clamped control values without replacing the target object', () => {
    const target = clampSceneControls(DEFAULT_SCENE_CONTROLS);
    const camera = target.camera;

    copySceneControls(target, {
      ...target,
      spinSpeed: 4,
      hue: 725,
      camera: {
        ...target.camera,
        position: [3.333, 4.444, 5.555]
      }
    });

    expect(target.spinSpeed).toBe(2);
    expect(target.hue).toBe(5);
    expect(target.camera).toBe(camera);
    expect(target.camera.position).toEqual([3.33, 4.44, 5.56]);
  });

  it('wraps hue changes and formats the material color', () => {
    expect(nextHue(330)).toBe(17);
    expect(formatHueColor(17)).toBe('hsl(17, 82%, 62%)');
  });
});
