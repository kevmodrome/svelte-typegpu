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
      new URL('./two-boxes/Floor.typegpu.svelte', import.meta.url),
      new URL('./two-boxes/SceneBox.typegpu.svelte', import.meta.url),
      new URL('./two-boxes/box-geometry.ts', import.meta.url),
      new URL('./two-boxes/box-interaction.ts', import.meta.url)
    ],
    typeGpuSourceFiles: [{ path: 'index.ts', loc: 417 }]
  },
  {
    slug: 'asset-world',
    title: 'Asset World',
    category: 'worlds',
    tags: ['3d', 'GLB assets', 'components', 'interaction', 'frame tasks'],
    description: 'A lakeside campsite with shared GLB models, orbit controls, shadows and a drifting canoe.',
    notes: 'Nine locally bundled CC0 models from Kenney Nature Kit, composed with ordinary Svelte components, keyed lists and direct model events. The canoe uses a frameTask; pause it to let demand rendering idle. Asset loading includes progress, cancellation and retry.',
    exportName: 'AssetWorld',
    sourceUrl: new URL('./asset-world/AssetWorld.svelte', import.meta.url),
    sourceFiles: [
      new URL('./asset-world/AssetWorld.svelte', import.meta.url),
      new URL('./asset-world/WorldViewport.typegpu.svelte', import.meta.url),
      new URL('./asset-world/Campsite.typegpu.svelte', import.meta.url),
      new URL('./asset-world/Canoe.typegpu.svelte', import.meta.url),
      new URL('./asset-world/world.ts', import.meta.url)
    ],
    typeGpuSourceFiles: []
  },
  {
    slug: 'svelte-motion',
    title: 'Svelte Motion',
    category: 'animation',
    tags: ['3d', 'motion', 'instancing', 'interaction'],
    description: 'A moving three-part marker above a field of 2,000 stationary cubes.',
    notes: 'An original example using Svelte Tween and Spring values on ordinary mesh and group transforms.',
    exportName: 'SvelteMotion',
    sourceUrl: new URL('./svelte-motion/SvelteMotion.typegpu.svelte', import.meta.url),
    sourceFiles: [
      new URL('./svelte-motion/SvelteMotion.typegpu.svelte', import.meta.url),
      new URL('./svelte-motion/MotionMarker.typegpu.svelte', import.meta.url),
      new URL('./svelte-motion/motion-field.ts', import.meta.url),
      new URL('./svelte-motion/marker-fragment.ts', import.meta.url)
    ],
    typeGpuSourceFiles: []
  },
  {
    slug: 'native-events',
    title: 'Native Events',
    category: 'interaction',
    tags: ['3d', 'events', 'picking'],
    description: 'Object-local state and event handlers attached directly to mesh primitives.',
    notes:
      'One self-contained scene using Svelte $state and direct mesh events. No callback forwarding, IDs, or custom animation loop. Scene handlers receive TypeGpuNodeEvent, with the original DOM event available as originalEvent.',
    exportName: 'NativeEvents',
    sourceUrl: new URL('./native-events/NativeEvents.typegpu.svelte', import.meta.url),
    sourceFiles: [new URL('./native-events/NativeEvents.typegpu.svelte', import.meta.url)],
    typeGpuSourceFiles: []
  },
  {
    slug: 'shared-stores',
    title: 'Shared Stores',
    category: 'interaction',
    tags: ['3d', 'stores', 'bindings', 'interaction'],
    description: 'A cube editor with shared position, rotation, and selection state.',
    notes: 'Native DOM bindings and scene event handlers read and write the same per-instance Svelte stores. Small vector updates use the renderer\'s targeted upload path.',
    exportName: 'SharedStores',
    sourceUrl: new URL('./shared-stores/SharedStores.svelte', import.meta.url),
    sourceFiles: [
      new URL('./shared-stores/SharedStores.svelte', import.meta.url),
      new URL('./shared-stores/StoreViewport.typegpu.svelte', import.meta.url)
    ],
    typeGpuSourceFiles: []
  },
  {
    slug: 'reactive-collections',
    title: 'Reactive Collections',
    category: 'interaction',
    tags: ['3d', 'SvelteMap', 'SvelteSet', 'keyed each', 'interaction'],
    description: 'An object editor with keyed collections, shared selection, and per-object height controls.',
    notes: 'A per-instance SvelteMap owns plain object records; immutable set updates change individual meshes. A SvelteSet shares selection between DOM checkboxes and direct mesh events. Add, remove, and reset use ordinary keyed each blocks.',
    exportName: 'ReactiveCollections',
    sourceUrl: new URL('./reactive-collections/ReactiveCollections.svelte', import.meta.url),
    sourceFiles: [
      new URL('./reactive-collections/ReactiveCollections.svelte', import.meta.url),
      new URL('./reactive-collections/CollectionViewport.typegpu.svelte', import.meta.url),
      new URL('./reactive-collections/collection.ts', import.meta.url)
    ],
    typeGpuSourceFiles: []
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
    slug: 'disco-shader-pass',
    title: 'Disco Shader Pass',
    category: 'rendering',
    tags: ['animation', 'shader', 'fullscreen'],
    description:
      'The official TypeGPU Disco fullscreen fragment shader expressed as a declarative shader pass.',
    typeGpuSourceUrl:
      'https://docs.swmansion.com/TypeGPU/examples/#example=rendering--disco',
    notes:
      'Adapted from the motion-first official TypeGPU Disco example using a renderer shaderPass with time and resolution uniforms.',
    exportName: 'DiscoShaderPass',
    sourceUrl: new URL('./disco-shader-pass/DiscoShaderPass.typegpu.svelte', import.meta.url),
    sourceFiles: [
      new URL('./disco-shader-pass/DiscoShaderPass.typegpu.svelte', import.meta.url),
      new URL('./disco-shader-pass/disco-fragment.ts', import.meta.url)
    ],
    typeGpuSourceFiles: [
      { path: 'index.ts', loc: 86 },
      { path: 'consts.ts', loc: 3 },
      { path: 'utils.ts', loc: 10 },
      { path: 'shaders/fragment.ts', loc: 231 },
      { path: 'shaders/vertex.ts', loc: 23 }
    ]
  },
  {
    slug: 'smoky-triangle',
    title: 'Smoky Triangle',
    category: 'rendering',
    tags: ['ecosystem', 'noise', 'primitives'],
    description:
      'The official smoky triangle idea expressed as a single declarative fullscreen shader pass.',
    typeGpuSourceUrl:
      'https://docs.swmansion.com/TypeGPU/examples/#example=rendering--smoky-triangle',
    notes:
      'Adapted from the official TypeGPU Smoky Triangle example using the renderer shaderPass primitive and renderer-managed frame uniforms.',
    exportName: 'SmokyTriangle',
    sourceUrl: new URL('./smoky-triangle/SmokyTriangle.typegpu.svelte', import.meta.url),
    sourceFiles: [
      new URL('./smoky-triangle/SmokyTriangle.typegpu.svelte', import.meta.url),
      new URL('./smoky-triangle/smoky-triangle-fragment.ts', import.meta.url)
    ],
    typeGpuSourceFiles: [{ path: 'index.ts', loc: 142 }]
  },
  {
    slug: 'multiple-smoky-triangles',
    title: 'Multiple Smoky Triangles',
    category: 'rendering',
    tags: ['shader', 'noise', 'pattern', 'fullscreen'],
    description:
      'A declarative mesh lattice that alternates smoky shader triangles with solid white triangles.',
    notes:
      'An original svelte-typegpu example that extends the smoky triangle shader idea into reusable triangle mesh components with shaderMaterial.',
    exportName: 'MultipleSmokyTriangles',
    sourceUrl: new URL(
      './multiple-smoky-triangles/MultipleSmokyTriangles.typegpu.svelte',
      import.meta.url
    ),
    sourceFiles: [
      new URL('./multiple-smoky-triangles/MultipleSmokyTriangles.typegpu.svelte', import.meta.url),
      new URL('./multiple-smoky-triangles/Triangle.typegpu.svelte', import.meta.url),
      new URL('./multiple-smoky-triangles/triangle-geometry.ts', import.meta.url),
      new URL('./multiple-smoky-triangles/smoky-triangle-material.ts', import.meta.url)
    ],
    typeGpuSourceFiles: []
  },
  {
    slug: 'gravity',
    title: 'Gravity',
    category: 'simulation',
    tags: ['3d', 'interaction', 'particles', 'physics', 'rasterization'],
    description:
      'The official gravity simulation recast as declarative Svelte state driving repeated sphere meshes.',
    typeGpuSourceUrl: 'https://docs.swmansion.com/TypeGPU/examples/#example=simulation--gravity',
    notes:
      'Adapted from the official TypeGPU Gravity example. The official version uses compute pipelines, storage buffers, OBJ loading, and texture arrays; this renderer adaptation keeps the scene declarative with Svelte-managed simulation state until compute/storage primitives exist.',
    exportName: 'Gravity',
    sourceUrl: new URL('./gravity/Gravity.typegpu.svelte', import.meta.url),
    sourceFiles: [
      new URL('./gravity/Gravity.typegpu.svelte', import.meta.url),
      new URL('./gravity/GravityBody.typegpu.svelte', import.meta.url),
      new URL('./gravity/gravity-simulation.ts', import.meta.url),
      new URL('./gravity/GravityFrameTask.typegpu.svelte', import.meta.url)
    ],
    typeGpuSourceFiles: [
      { path: 'index.ts', loc: 246 },
      { path: 'compute.ts', loc: 116 },
      { path: 'render.ts', loc: 68 },
      { path: 'schemas.ts', loc: 85 },
      { path: 'helpers.ts', loc: 153 },
      { path: 'presets.ts', loc: 292 },
      { path: 'enums.ts', loc: 14 }
    ]
  }
] as const;

export type ExampleDefinition = (typeof exampleDefinitions)[number];
export type ExampleSlug = ExampleDefinition['slug'];
