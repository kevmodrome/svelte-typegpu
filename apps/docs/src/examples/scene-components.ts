import type renderer from 'svelte-typegpu';
import type { ExampleSlug } from './example-definitions';
import {
  InteractiveOrbitField,
  PhongReflection,
  SimpleShadow,
  TwoBoxes
} from '../generated/typegpu-scenes';

type TypeGpuSceneComponent = Parameters<typeof renderer.render>[0];

export const sceneComponents = {
  'two-boxes': TwoBoxes,
  'phong-reflection': PhongReflection,
  'simple-shadow': SimpleShadow,
  'interactive-orbit-field': InteractiveOrbitField
} satisfies Record<ExampleSlug, TypeGpuSceneComponent>;
