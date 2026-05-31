import twoBoxes from '../src/examples/two-boxes/TwoBoxes.typegpu.svelte' with { type: 'text' };
import sceneBox from '../src/examples/two-boxes/SceneBox.typegpu.svelte' with { type: 'text' };
import boxGeometry from '../src/examples/two-boxes/box-geometry.ts' with { type: 'text' };
import boxInteraction from '../src/examples/two-boxes/box-interaction.ts' with { type: 'text' };
import phongReflection from '../src/examples/phong-reflection/PhongReflection.typegpu.svelte' with { type: 'text' };
import phongLights from '../src/examples/phong-reflection/PhongLights.typegpu.svelte' with { type: 'text' };
import simpleShadow from '../src/examples/simple-shadow/SimpleShadow.typegpu.svelte' with { type: 'text' };
import shadowLights from '../src/examples/simple-shadow/ShadowLights.typegpu.svelte' with { type: 'text' };
import shadowSubject from '../src/examples/simple-shadow/ShadowSubject.typegpu.svelte' with { type: 'text' };
import interactiveOrbitField from '../src/examples/interactive-orbit-field/InteractiveOrbitField.typegpu.svelte' with { type: 'text' };
import discoFragment from '../src/examples/interactive-orbit-field/disco-fragment.ts' with { type: 'text' };
import type { ExampleSlug } from '../src/examples/example-definitions';

export const exampleSourceTexts = {
  'two-boxes': [twoBoxes, sceneBox, boxGeometry, boxInteraction],
  'phong-reflection': [phongReflection, phongLights],
  'simple-shadow': [simpleShadow, shadowLights, shadowSubject],
  'interactive-orbit-field': [interactiveOrbitField, discoFragment]
} satisfies Record<ExampleSlug, string[]>;
