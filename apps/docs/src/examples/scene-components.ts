import type { Component } from 'svelte';
import type { ExampleSlug } from './example-definitions';
import {
  DiscoShaderPass,
  Gravity,
  NativeEvents,
  SharedStores,
  MultipleSmokyTriangles,
  PhongReflection,
  SimpleShadow,
  SmokyTriangle,
  SvelteMotion,
  TwoBoxes
} from '../generated/typegpu-scenes';

type TypeGpuSceneComponent = Component<any>;

export const sceneComponents = {
  'native-events': NativeEvents,
  'shared-stores': SharedStores,
  'svelte-motion': SvelteMotion,
  'two-boxes': TwoBoxes,
  'phong-reflection': PhongReflection,
  'simple-shadow': SimpleShadow,
  'disco-shader-pass': DiscoShaderPass,
  'smoky-triangle': SmokyTriangle,
  'multiple-smoky-triangles': MultipleSmokyTriangles,
  gravity: Gravity
} satisfies Record<ExampleSlug, TypeGpuSceneComponent>;
