import type { GpuTimingState, TypeGpuRoot, TypeGpuTimingSample } from 'svelte-typegpu';

type SceneState = Parameters<TypeGpuRoot['gpu']['setScene']>[0];

export interface WorldProfile {
  models: number; instances: number; colorDraws: number; colorTriangles: number;
  shadowTriangles: number; renderCpuMs: number; maxRenderCpuMs: number;
  shadowInstances: number; shadowDraws: number; shadowCpuMs: number;
  shadowLodTrianglesSaved: number; shadowRangeFallbacks: number;
  culledInstances: number; cullingCpuMs: number; rangeFallbacks: number;
  lodInstances: number; lodTrianglesSaved: number; lodCpuMs: number; lodRangeFallbacks: number;
  colorCountsExact: boolean; occlusion: string;
  occlusionDepthDraws: number; occlusionDepthTriangles: number;
  gpuTiming: GpuTimingState; gpuTime?: TypeGpuTimingSample;
}
export const emptyProfile: WorldProfile = { models: 0, instances: 0, colorDraws: 0,
  colorTriangles: 0, shadowTriangles: 0, renderCpuMs: 0, maxRenderCpuMs: 0,
  shadowInstances: 0, shadowDraws: 0, shadowCpuMs: 0, shadowLodTrianglesSaved: 0, shadowRangeFallbacks: 0,
  culledInstances: 0, cullingCpuMs: 0, rangeFallbacks: 0,
  lodInstances: 0, lodTrianglesSaved: 0, lodCpuMs: 0, lodRangeFallbacks: 0,
  colorCountsExact: true, occlusion: 'disabled', occlusionDepthDraws: 0, occlusionDepthTriangles: 0, gpuTiming: 'disabled' };

export function sceneWorkload(scene: SceneState) {
  let instances = 0, colorTriangles = 0, shadowTriangles = 0;
  const shadows = scene.lights.some(light => light.kind === 'directional' && light.castsShadow);
  const models = new Set((scene.resourceItems ?? []).filter(item => item.node.name === 'model').map(item => item.node));
  for (const batch of scene.drawBatches) {
    const triangles = (batch.geometry.indexCount ?? batch.geometry.vertexCount) / 3 * batch.instanceCount;
    instances += batch.instanceCount; colorTriangles += triangles;
    if (shadows && batch.castShadow) shadowTriangles += triangles;
  }
  return { models: models.size, instances, colorDraws: scene.drawBatches.length, colorTriangles, shadowTriangles };
}

export function profileWorld(root: TypeGpuRoot, publish: (profile: WorldProfile) => void, now = () => performance.now()) {
  const gpu = root.gpu, renderFrame = gpu.renderFrame, setScene = gpu.setScene;
  let latest = { ...emptyProfile }, frames = 0, cpu = 0, maxCpu = 0, disposed = false;
  function render(timestamp?: number) {
    const start = now();
    try { renderFrame.call(gpu, timestamp); }
    finally { const elapsed = now() - start; frames++; cpu += elapsed; maxCpu = Math.max(maxCpu, elapsed); }
  }
  function scene(value: SceneState) {
    setScene.call(gpu, value);
    if (value.drawBatchesChanged || value.lightsChanged) {
      latest = { ...latest, ...sceneWorkload(value) }; publish(latest);
    }
  }
  gpu.renderFrame = render; gpu.setScene = scene;
  return {
    sample() {
      if (disposed) return;
      const stats = gpu.getRenderStats?.();
      if (stats) latest = { ...latest, instances: stats.submittedInstances, colorDraws: stats.colorDraws,
        colorTriangles: stats.colorTriangles, shadowTriangles: stats.shadowTriangles,
        shadowInstances: stats.shadowInstances ?? 0, shadowDraws: stats.shadowDraws ?? 0, shadowCpuMs: stats.shadowCpuMs ?? 0,
        shadowLodTrianglesSaved: stats.shadowLodTrianglesSaved ?? 0, shadowRangeFallbacks: stats.shadowRangeFallbacks ?? 0,
        culledInstances: stats.culledInstances, cullingCpuMs: stats.cullingCpuMs, rangeFallbacks: stats.rangeFallbacks,
        lodInstances: stats.lodInstances, lodTrianglesSaved: stats.lodTrianglesSaved,
        lodCpuMs: stats.lodCpuMs, lodRangeFallbacks: stats.lodRangeFallbacks,
        colorCountsExact: stats.colorCountsExact !== false, occlusion: stats.occlusion ?? 'disabled',
        occlusionDepthDraws: stats.occlusionDepthDraws ?? 0, occlusionDepthTriangles: stats.occlusionDepthTriangles ?? 0,
        gpuTiming: stats.gpuTiming ?? 'disabled', gpuTime: stats.gpuTime };
      latest = { ...latest, renderCpuMs: frames ? cpu / frames : 0, maxRenderCpuMs: maxCpu };
      publish(latest); frames = cpu = maxCpu = 0;
    },
    dispose() {
      disposed = true;
      if (gpu.renderFrame === render) gpu.renderFrame = renderFrame;
      if (gpu.setScene === scene) gpu.setScene = setScene;
    }
  };
}
