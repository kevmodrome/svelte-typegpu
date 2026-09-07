import tgpu from 'typegpu';
import * as d from 'typegpu/data';

export const OCCLUSION_BLOCK_SIZE = 128;
export const occlusionParams = d.struct({ matrix: d.mat4x4f, viewport: d.vec4f });
const words = d.arrayOf(d.u32);
const vectors = d.arrayOf(d.vec4u);

export const depthReduceLayout = tgpu.bindGroupLayout({
  source: { texture: d.textureDepth2d() },
  target: { storageTexture: d.textureStorage2d('r32float') }
});
export const mipReduceLayout = tgpu.bindGroupLayout({
  source: { texture: d.texture2d(), sampleType: 'unfilterable-float' },
  target: { storageTexture: d.textureStorage2d('r32float') }
});

// Power-of-two padding is far depth. In particular, odd viewport edges must
// never disappear during reduction and turn an uncovered pixel into a wall.
const reduceBody = (depth: boolean) => /* wgsl */`{
  let p = id.xy;
  if (any(p >= textureDimensions(target))) { return; }
  let size = textureDimensions(source);
  var farthest = 0.0;
  for (var y = 0u; y < 2u; y++) {
    for (var x = 0u; x < 2u; x++) {
      let q = p * 2u + vec2u(x, y);
      var value = 1.0;
      ${depth ? 'if (all(q < size)) { value = textureLoad(source, q, 0); }' : 'value = textureLoad(source, min(q, size - vec2u(1u)), 0).x;'}
      farthest = max(farthest, value);
    }
  }
  textureStore(target, p, vec4f(farthest));
}`;
export const depthReduce = tgpu.computeFn({ in: { id: d.builtin.globalInvocationId }, workgroupSize: [8, 8] })(reduceBody(true))
  .$uses(depthReduceLayout.bound).$name('occlusion_depth_reduce');
export const mipReduce = tgpu.computeFn({ in: { id: d.builtin.globalInvocationId }, workgroupSize: [8, 8] })(reduceBody(false))
  .$uses(mipReduceLayout.bound).$name('occlusion_mip_reduce');

export const visibilityLayout = tgpu.bindGroupLayout({
  params: { uniform: occlusionParams },
  pyramid: { texture: d.texture2d(), sampleType: 'unfilterable-float' },
  bounds: { storage: d.arrayOf(d.vec4f) },
  clusters: { storage: d.arrayOf(d.vec4f) },
  blocks: { storage: vectors },
  prefix: { storage: words, access: 'mutable' },
  sums: { storage: words, access: 'mutable' }
});

const visible = tgpu.fn([d.vec4f, d.vec4f], d.u32)/* wgsl */`(lo: vec4f, hi: vec4f) -> u32 {
  if (lo.w == 0.0) { return 1u; }
  var nearDepth = 1.0;
  var rectMin = vec2f(1e30);
  var rectMax = vec2f(-1e30);
  for (var corner = 0u; corner < 8u; corner++) {
    let point = select(lo.xyz, hi.xyz, vec3<bool>((corner & 1u) != 0u, (corner & 2u) != 0u, (corner & 4u) != 0u));
    let clip = params.matrix * vec4f(point, 1.0);
    // Comparisons also reject NaN. Crossing the eye or near plane is visible.
    if (!(clip.w > 0.0001) || !(clip.z > 0.0) || !all(abs(clip) <= vec4f(1e30))) { return 1u; }
    let ndc = clip.xyz / clip.w;
    let pixel = (ndc.xy * vec2f(0.5, -0.5) + vec2f(0.5)) * params.viewport.xy;
    rectMin = min(rectMin, pixel);
    rectMax = max(rectMax, pixel);
    nearDepth = min(nearDepth, ndc.z);
  }
  if (any(rectMax < vec2f(0.0)) || any(rectMin >= params.viewport.xy)) { return 1u; }
  rectMin = clamp(floor(rectMin) - vec2f(1.0), vec2f(0.0), params.viewport.xy - vec2f(1.0));
  rectMax = clamp(ceil(rectMax) + vec2f(1.0), vec2f(0.0), params.viewport.xy - vec2f(1.0));
  let extent = max(rectMax.x - rectMin.x + 1.0, rectMax.y - rectMin.y + 1.0);
  let mip = min(u32(max(0.0, ceil(log2(extent)) - 1.0)), textureNumLevels(pyramid) - 1u);
  let divisor = exp2(f32(mip + 1u));
  let a = vec2u(floor(rectMin / divisor));
  let b = vec2u(floor(rectMax / divisor));
  // The chosen mip covers at most two texels on each axis.
  var farthest = textureLoad(pyramid, a, i32(mip)).x;
  farthest = max(farthest, textureLoad(pyramid, vec2u(b.x, a.y), i32(mip)).x);
  farthest = max(farthest, textureLoad(pyramid, vec2u(a.x, b.y), i32(mip)).x);
  farthest = max(farthest, textureLoad(pyramid, b, i32(mip)).x);
  return select(1u, 0u, nearDepth > farthest + 0.00002);
}`.$uses(visibilityLayout.bound).$name('occlusion_visible');

const scan = tgpu.workgroupVar(d.arrayOf(d.u32, OCCLUSION_BLOCK_SIZE)).$name('occlusion_scan');
const clusterKeep = tgpu.workgroupVar(d.u32).$name('occlusion_cluster_keep');
const visibilityBody = (clustered: boolean) => /* wgsl */`{
  let block = blocks[group.x];
  ${clustered ? `
  if (lane == 0u) { clusterKeep = visible(clusters[block.w * 2u], clusters[block.w * 2u + 1u]); }
  if (workgroupUniformLoad(&clusterKeep) == 0u) {
    if (lane < block.y) { prefix[block.x + lane] = 0u; }
    if (lane == 0u) { sums[group.x] = 0u; }
    return;
  }` : ''}
  var keep = 0u;
  if (lane < block.y) { let index = (block.x + lane) * 2u; keep = visible(bounds[index], bounds[index + 1u]); }
  scan[lane] = keep;
  workgroupBarrier();
  for (var offset = 1u; offset < 128u; offset *= 2u) {
    var value = 0u;
    if (lane >= offset) { value = scan[lane - offset]; }
    workgroupBarrier();
    scan[lane] += value;
    workgroupBarrier();
  }
  if (lane < block.y) { prefix[block.x + lane] = select(0u, scan[lane], keep != 0u); }
  if (lane == 127u) { sums[group.x] = scan[lane]; }
}`;
export const visibility = tgpu.computeFn({
  in: { group: d.builtin.workgroupId, lane: d.builtin.localInvocationIndex }, workgroupSize: [OCCLUSION_BLOCK_SIZE]
})(visibilityBody(false)).$uses({ ...visibilityLayout.bound, scan, visible }).$name('occlusion_visibility');
export const clusteredVisibility = tgpu.computeFn({
  in: { group: d.builtin.workgroupId, lane: d.builtin.localInvocationIndex }, workgroupSize: [OCCLUSION_BLOCK_SIZE]
})(visibilityBody(true)).$uses({ ...visibilityLayout.bound, scan, visible, clusterKeep }).$name('occlusion_clustered_visibility');

export const rangeLayout = tgpu.bindGroupLayout({
  ranges: { storage: vectors },
  sums: { storage: words },
  offsets: { storage: words, access: 'mutable' },
  args: { storage: words, access: 'mutable' }
});
export const rangeScan = tgpu.computeFn({ in: { id: d.builtin.globalInvocationId }, workgroupSize: [64] })/* wgsl */`{
  let index = id.x;
  // Two vec4s per range; the final word is zero for unused capacity.
  if (index * 2u >= arrayLength(&ranges)) { return; }
  let range = ranges[index * 2u];
  let draw = ranges[index * 2u + 1u];
  if (draw.w == 0u) { return; }
  var count = 0u;
  for (var i = range.x; i < range.x + range.y; i++) {
    offsets[i] = count;
    count += sums[i];
  }
  args[index * 8u] = draw.x;
  args[index * 8u + 1u] = count;
  args[index * 8u + 2u] = 0u;
  args[index * 8u + 3u] = select(range.z, 0u, draw.y != 0u);
  args[index * 8u + 4u] = select(0u, range.z, draw.y != 0u);
}`.$uses(rangeLayout.bound).$name('occlusion_range_scan');

export const compactLayout = tgpu.bindGroupLayout({
  source: { storage: d.arrayOf(d.vec4f) },
  target: { storage: d.arrayOf(d.vec4f), access: 'mutable' },
  blocks: { storage: vectors },
  prefix: { storage: words },
  offsets: { storage: words },
  ranges: { storage: vectors }
});
export const compact = tgpu.computeFn({
  in: { group: d.builtin.workgroupId, lane: d.builtin.localInvocationIndex }, workgroupSize: [OCCLUSION_BLOCK_SIZE]
})/* wgsl */`{
  let block = blocks[group.x];
  if (lane >= block.y) { return; }
  let index = block.x + lane;
  let local = prefix[index];
  if (local == 0u) { return; }
  let destination = ranges[block.z * 2u].z + offsets[group.x] + local - 1u;
  for (var word = 0u; word < 6u; word++) { target[destination * 6u + word] = source[index * 6u + word]; }
}`.$uses(compactLayout.bound).$name('occlusion_compact');
