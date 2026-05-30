export const exampleDefinitions = [
  {
    slug: 'two-boxes',
    title: 'Two Boxes',
    category: 'rendering',
    tags: ['3d', 'rasterization', 'vertex colors', 'interaction'],
    description:
      'The official TypeGPU two-boxes scene expressed as vertex-colored geometry, orbit controls, and object drag.',
    typeGpuSourceUrl:
      'https://docs.swmansion.com/TypeGPU/examples/#example=rendering--two-boxes',
    notes: 'Adapted from the official TypeGPU Two Boxes example for the svelte-typegpu custom renderer.',
    exportName: 'TwoBoxes',
    sourceUrl: new URL('./two-boxes/TwoBoxes.typegpu.svelte', import.meta.url),
    sourceFiles: [
      new URL('./two-boxes/TwoBoxes.typegpu.svelte', import.meta.url),
      new URL('./two-boxes/SceneBox.typegpu.svelte', import.meta.url),
      new URL('./two-boxes/box-geometry.ts', import.meta.url),
      new URL('./two-boxes/box-interaction.ts', import.meta.url)
    ],
    typeGpuSourceFiles: [{ path: 'index.ts', loc: 417 }]
  },
  {
    slug: 'phong-reflection',
    title: 'Phong Reflection Model',
    category: 'rendering',
    tags: ['3d', 'lighting', 'materials'],
    description:
      'The official Phong teapot model loaded through the declarative model primitive and renderer lights.',
    typeGpuSourceUrl:
      'https://docs.swmansion.com/TypeGPU/examples/#example=rendering--phong-reflection',
    notes:
      'Adapted from the official TypeGPU Phong Reflection Model example using declarative OBJ loading and renderer-supported Phong material controls.',
    exportName: 'PhongReflection',
    sourceUrl: new URL('./phong-reflection/PhongReflection.typegpu.svelte', import.meta.url),
    sourceFiles: [
      new URL('./phong-reflection/PhongReflection.typegpu.svelte', import.meta.url),
      new URL('./phong-reflection/PhongLights.typegpu.svelte', import.meta.url)
    ],
    typeGpuSourceFiles: [
      { path: 'index.ts', loc: 163 },
      { path: 'load-model.ts', loc: 33 },
      { path: 'params.ts', loc: 10 },
      { path: 'schemas.ts', loc: 20 }
    ]
  },
  {
    slug: 'simple-shadow',
    title: 'Simple shadow',
    category: 'rendering',
    tags: ['3d', 'depth', 'shadows'],
    description:
      'The official simple shadow composition rebuilt with declarative shadow-casting lights and receivers.',
    typeGpuSourceUrl:
      'https://docs.swmansion.com/TypeGPU/examples/#example=rendering--simple-shadow',
    notes:
      'Adapted from the official TypeGPU Simple shadow example with the renderer directional shadow-map primitive.',
    exportName: 'SimpleShadow',
    sourceUrl: new URL('./simple-shadow/SimpleShadow.typegpu.svelte', import.meta.url),
    sourceFiles: [
      new URL('./simple-shadow/SimpleShadow.typegpu.svelte', import.meta.url),
      new URL('./simple-shadow/ShadowLights.typegpu.svelte', import.meta.url),
      new URL('./simple-shadow/ShadowSubject.typegpu.svelte', import.meta.url)
    ],
    typeGpuSourceFiles: [
      { path: 'index.ts', loc: 410 },
      { path: 'geometry.ts', loc: 143 },
      { path: 'schema.ts', loc: 40 }
    ]
  },
  {
    slug: 'interactive-orbit-field',
    title: 'Disco Shader Pass',
    category: 'rendering',
    tags: ['animation', 'shader', 'fullscreen'],
    description:
      'The official TypeGPU Disco fullscreen fragment shader expressed as a declarative shader pass.',
    typeGpuSourceUrl:
      'https://docs.swmansion.com/TypeGPU/examples/#example=rendering--disco',
    notes:
      'Adapted from the motion-first official TypeGPU Disco example using a renderer shaderPass with time and resolution uniforms.',
    exportName: 'InteractiveOrbitField',
    sourceUrl: new URL(
      './interactive-orbit-field/InteractiveOrbitField.typegpu.svelte',
      import.meta.url
    ),
    sourceFiles: [
      new URL('./interactive-orbit-field/InteractiveOrbitField.typegpu.svelte', import.meta.url),
      new URL('./interactive-orbit-field/disco-fragment.ts', import.meta.url)
    ],
    typeGpuSourceFiles: [
      { path: 'index.ts', loc: 86 },
      { path: 'consts.ts', loc: 3 },
      { path: 'utils.ts', loc: 10 },
      { path: 'shaders/fragment.ts', loc: 231 },
      { path: 'shaders/vertex.ts', loc: 23 }
    ]
  }
] as const;

export type ExampleDefinition = (typeof exampleDefinitions)[number];
export type ExampleSlug = ExampleDefinition['slug'];
