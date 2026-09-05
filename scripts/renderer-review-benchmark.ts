import { pathToFileURL } from 'node:url';

// Run with Bun. An optional source directory allows comparison with a saved revision.
const sourceRoot = process.argv[2]
  ? pathToFileURL(`${process.argv[2]}/`)
  : new URL('../packages/svelte-typegpu/src/', import.meta.url);
const { createElement, createFragment, insert, setAttribute } = await import(
  new URL('core.ts', sourceRoot).href
);
const { createSceneState, createTypeGpuSceneCache } = await import(
  new URL('scene-compiler.ts', sourceRoot).href
);
const { Dirty } = await import(new URL('dirty.ts', sourceRoot).href);
const { readInlineGeometry } = await import(new URL('resources.ts', sourceRoot).href);

const meshCount = 2000;
const root = createFragment();
let movingMesh;
for (let index = 0; index < meshCount; index++) {
  const mesh = createElement('mesh');
  insert(mesh, createElement('boxGeometry'), null);
  insert(mesh, createElement('standardMaterial'), null);
  insert(root, mesh, null);
  movingMesh ??= mesh;
}

const cache = createTypeGpuSceneCache();
const initial = createSceneState(root, cache);
const samples: number[] = [];
let scene = initial;
let instanceArrayAllocations = 0;
let previousInstances = scene.drawBatches[0].instances;
for (let iteration = 0; iteration < 80; iteration++) {
  setAttribute(movingMesh, 'position', [iteration + 1, 0, 0]);
  const start = performance.now();
  scene = createSceneState(root, cache, {
    dirty: Dirty.Transform,
    dirtyNodes: new Map([[movingMesh, Dirty.Transform]])
  });
  if (iteration >= 20) samples.push(performance.now() - start);
  if (scene.drawBatches[0].instances !== previousInstances) instanceArrayAllocations++;
  previousInstances = scene.drawBatches[0].instances;
}
samples.sort((a, b) => a - b);
const geometryReused = initial.drawBatches[0].geometry === scene.drawBatches[0].geometry;
const transformWork = cache.transforms?.stats;
const transformUploadBytes = scene.drawBatches.reduce(
  (sum, batch) =>
    sum +
    batch.dirtyRanges.reduce(
      (total, range) => total + range.count * batch.floatsPerInstance * 4,
      0
    ),
  0
);
const fullSamples: number[] = [];
for (let iteration = 0; iteration < 80; iteration++) {
  setAttribute(movingMesh, 'position', [iteration + 100, 0, 0]);
  const start = performance.now();
  createSceneState(root, cache, { dirty: Dirty.Transform });
  if (iteration >= 20) fullSamples.push(performance.now() - start);
}
fullSamples.sort((a, b) => a - b);

const materialSamples: number[] = [];
const animatedMaterial = movingMesh.lastChild!;
let materialScene = scene;
for (let iteration = 0; iteration < 80; iteration++) {
  setAttribute(animatedMaterial, 'roughness', iteration / 100);
  const start = performance.now();
  materialScene = createSceneState(root, cache, {
    dirty: Dirty.MaterialUniform,
    dirtyNodes: new Map([[animatedMaterial, Dirty.MaterialUniform]])
  });
  if (iteration >= 20) materialSamples.push(performance.now() - start);
}
materialSamples.sort((a, b) => a - b);
const materialUploadBytes = materialScene.instanceUpdates?.reduce(
  (sum, batch) => sum + batch.dirtyRanges.reduce((total, range) => total + range.count * 96, 0),
  0
);

insert(root, createElement('pointLight'), null);
const afterInsertion = createSceneState(root, cache);
const touchedInstances = afterInsertion.drawBatches.reduce(
  (total: number, batch: { dirtyRanges: { count: number }[] }) =>
    total + batch.dirtyRanges.reduce((sum, range) => sum + range.count, 0),
  0
);

const bufferGeometry = createElement('bufferGeometry');
setAttribute(bufferGeometry, 'vertices', new Float32Array(36));
setAttribute(bufferGeometry, 'bounds', { min: [0, 0, 0], max: [1, 1, 1] });
setAttribute(bufferGeometry, 'indices', new Uint16Array([0, 1, 2]));
const beforeIndicesChange = readInlineGeometry(bufferGeometry);
setAttribute(bufferGeometry, 'indices', new Uint16Array([2, 1, 0]));
const afterIndicesChange = readInlineGeometry(bufferGeometry);

const hiddenGroup = createElement('group');
setAttribute(hiddenGroup, 'visible', false);
const hiddenMesh = createElement('mesh');
insert(hiddenMesh, createElement('boxGeometry'), null);
insert(hiddenGroup, hiddenMesh, null);

console.log(
  JSON.stringify(
    {
      meshCount,
      transformSyncMedianMs: Number(samples[Math.floor(samples.length / 2)].toFixed(3)),
      fullTransformSyncMedianMs: Number(fullSamples[Math.floor(fullSamples.length / 2)].toFixed(3)),
      transformWork,
      instanceArrayAllocations,
      transformUploadBytes,
      materialSyncMedianMs: Number(
        materialSamples[Math.floor(materialSamples.length / 2)].toFixed(3)
      ),
      materialUploadBytes,
      geometryReused,
      unchangedInstancesRepackedAfterLightInsertion: touchedInstances,
      instanceUploadBytesAfterLightInsertion:
        touchedInstances * 24 * Float32Array.BYTES_PER_ELEMENT,
      reviewDiagnostics: {
        bufferKeyChangesWithIndices: beforeIndicesChange?.key !== afterIndicesChange?.key,
        drawBatchesInsideHiddenGroup: createSceneState(hiddenGroup).drawBatches.length
      }
    },
    null,
    2
  )
);
