import twoBoxes from '../src/examples/two-boxes/TwoBoxes.typegpu.svelte' with { type: 'text' };
import floor from '../src/examples/two-boxes/Floor.typegpu.svelte' with { type: 'text' };
import sceneBox from '../src/examples/two-boxes/SceneBox.typegpu.svelte' with { type: 'text' };
import boxGeometry from '../src/examples/two-boxes/box-geometry.ts' with { type: 'text' };
import boxInteraction from '../src/examples/two-boxes/box-interaction.ts' with { type: 'text' };
import phongReflection from '../src/examples/phong-reflection/PhongReflection.typegpu.svelte' with { type: 'text' };
import phongLights from '../src/examples/phong-reflection/PhongLights.typegpu.svelte' with { type: 'text' };
import simpleShadow from '../src/examples/simple-shadow/SimpleShadow.typegpu.svelte' with { type: 'text' };
import shadowLights from '../src/examples/simple-shadow/ShadowLights.typegpu.svelte' with { type: 'text' };
import shadowSubject from '../src/examples/simple-shadow/ShadowSubject.typegpu.svelte' with { type: 'text' };
import discoShaderPass from '../src/examples/disco-shader-pass/DiscoShaderPass.typegpu.svelte' with { type: 'text' };
import discoFragment from '../src/examples/disco-shader-pass/disco-fragment.ts' with { type: 'text' };
import smokyTriangle from '../src/examples/smoky-triangle/SmokyTriangle.typegpu.svelte' with { type: 'text' };
import smokyTriangleFragment from '../src/examples/smoky-triangle/smoky-triangle-fragment.ts' with { type: 'text' };
import multipleSmokyTriangles from '../src/examples/multiple-smoky-triangles/MultipleSmokyTriangles.typegpu.svelte' with { type: 'text' };
import multipleSmokyTriangle from '../src/examples/multiple-smoky-triangles/Triangle.typegpu.svelte' with { type: 'text' };
import multipleSmokyTriangleGeometry from '../src/examples/multiple-smoky-triangles/triangle-geometry.ts' with { type: 'text' };
import multipleSmokyTriangleMaterial from '../src/examples/multiple-smoky-triangles/smoky-triangle-material.ts' with { type: 'text' };
import gravity from '../src/examples/gravity/Gravity.typegpu.svelte' with { type: 'text' };
import gravityBody from '../src/examples/gravity/GravityBody.typegpu.svelte' with { type: 'text' };
import gravitySimulation from '../src/examples/gravity/gravity-simulation.ts' with { type: 'text' };
import type { ExampleSlug } from '../src/examples/example-definitions';

export const exampleSourceTexts = {
  'two-boxes': [twoBoxes, floor, sceneBox, boxGeometry, boxInteraction],
  'phong-reflection': [phongReflection, phongLights],
  'simple-shadow': [simpleShadow, shadowLights, shadowSubject],
  'disco-shader-pass': [discoShaderPass, discoFragment],
  'smoky-triangle': [smokyTriangle, smokyTriangleFragment],
  'multiple-smoky-triangles': [
    multipleSmokyTriangles,
    multipleSmokyTriangle,
    multipleSmokyTriangleGeometry,
    multipleSmokyTriangleMaterial
  ],
  gravity: [gravity, gravityBody, gravitySimulation]
} satisfies Record<ExampleSlug, string[]>;
