import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { typegpuSvelte } from '../compiler/vite.ts';

const require = process.env.SVELTE_PROBE_BROWSER_DEPENDENCIES
  ? createRequire(resolve(process.env.SVELTE_PROBE_BROWSER_DEPENDENCIES, 'package.json')) : createRequire(import.meta.url);
const { chromium } = require('playwright'), { PNG } = require('pngjs');
const wallCount = process.env.SVELTE_PROBE_SHARED_OCCLUDERS ? 64 : 2;
const texture = new PNG({ width: 2, height: 2 }); texture.data.fill(255);
// Opaque blending writes depth even for a sampled zero alpha; the built-in
// material has no discard. Check that enabling Hi-Z does not change that.
texture.data[3] = 0;
const textureUrl = process.env.SVELTE_PROBE_TEXTURES ? `data:image/png;base64,${PNG.sync.write(texture).toString('base64')}` : null;
const workspace = fileURLToPath(new URL('../../../', import.meta.url));
const app = resolve(workspace, 'apps/example');
const entry = resolve(app, 'src/__occlusion-probe.js');
const viewport = resolve(app, 'src/__OcclusionProbe.typegpu.svelte');
const temporary = await mkdtemp(resolve(tmpdir(), 'typegpu-occlusion-'));
const output = process.env.SVELTE_PROBE_OUTPUT ?? '/tmp/typegpu-occlusion';
await mkdir(output, { recursive: true });
const source = `<script>
  import { createModelLod } from 'svelte-typegpu';
  import { createSphereGeometryData } from '../../../packages/svelte-typegpu/src/geometries';
  import { createMaterialDescriptor } from '../../../packages/svelte-typegpu/src/material-descriptors';
  let { onready } = $props();
  let enabled = $state(false), camera = $state(0), walls = $state(true), lod = $state(false);
  let gpuTiming = $state(false);
  const texture = ${JSON.stringify(textureUrl)};
  const material = createMaterialDescriptor('basic', { color: [0.1,0.7,0.5], map: texture });
  const high = createSphereGeometryData(0.27, 32, 16), low = createSphereGeometryData(0.27, 16, 8);
  low.indexData = Uint32Array.from({ length: low.vertexCount }, (_, i) => i);
  low.indexCount = low.vertexCount; low.indexFormat = 'uint32'; low.key += ':indexed';
  const model = geometry => ({ key: geometry.key, meshes: [{ geometry, material,
    transform: { position: [0,0,0], rotation: [0,0,0], scale: [1,1,1] } }] });
  const asset = model(high), levels = createModelLod(asset, [{ maxScreenHeight: 14, asset: model(low) }]);
  export function configure(e, c, w = true, l = false) { enabled = e; camera = c; walls = w; lod = l; }
  export function timing(value) { gpuTiming = value; }
</script>
<canvas frameloop="manual" maxDevicePixelRatio={1} {gpuTiming} {onready} style="display:block;width:100vw;height:80vh">
  <scene occlusion={enabled ? 'hi-z' : 'none'} clearColor={[0.04,0.06,0.08,1]}>
    <perspectiveCamera active position={[camera,4,24]} target={[0,2,-12]} fov={55} far={180} />
    <ambientLight intensity={1} />
    {#if walls}
      {#each Array(${wallCount}) as _, i}
        <mesh position={[i === 0 ? -9 : i === 1 ? 9 : 1000 + i * 20,5,3]} scale={[15,12,1]}>
          <boxGeometry /><basicMaterial color={[0.6,0.2,0.1]} map={texture} />
        </mesh>
      {/each}
    {/if}
    {#each Array(6000) as _, i}
      <model asset={lod ? levels : asset} position={[(i%60-30)*0.65, Math.floor(i/1200)*1.1, -Math.floor(i/60)%20*1.3-2]} />
    {/each}
  </scene>
</canvas>`;
const server = await createServer({ root: app, configFile: false, logLevel: 'error', cacheDir: resolve(temporary, 'vite'),
  plugins: [{ name: 'occlusion-probe', enforce: 'pre',
    resolveId(id) { if (id.endsWith('/__occlusion-probe.js')) return entry; if (id.endsWith('/__OcclusionProbe.typegpu.svelte')) return viewport; },
    load(id) {
      if (id === viewport) return source;
      if (id === entry) return `import { mount, unmount, flushSync } from 'svelte';
        import Viewport from './__OcclusionProbe.typegpu.svelte';
        let root;
        const instance = mount(Viewport, { target: document.body, props: { onready: value => { root = value; window.ready = true; } } });
        window.commands = { configure: (...args) => flushSync(() => instance.configure(...args)),
          timing: value => flushSync(() => instance.timing(value)), stats: () => root.gpu.getRenderStats(),
          draw: () => { flushSync(); root.gpu.renderFrame(performance.now()); return root.gpu.getRenderStats(); },
          loop: value => root.gpu.setOptions({ frameloop: value ? 'always' : 'demand' }),
          dispose: () => unmount(instance) };`;
    },
    configureServer(server) { server.middlewares.use('/occlusion-probe', async (_req, res) => {
      res.setHeader('content-type', 'text/html'); res.end(await server.transformIndexHtml('/occlusion-probe',
        '<!doctype html><link rel="icon" href="data:,"><style>body{margin:0}</style><script type="module" src="/src/__occlusion-probe.js"></script>'));
    }); }
  }, typegpuSvelte({ configFile: false })], server: { host: '127.0.0.1', port: 0, watch: null, fs: { allow: [workspace] } } });
let browser;
try {
  await server.listen();
  browser = await chromium.launch({ headless: true, executablePath: process.env.SVELTE_PROBE_CHROMIUM,
    args: ['--enable-unsafe-webgpu', '--use-angle=metal'] });
  const page = await browser.newPage({ viewport: { width: 1001, height: 751 } });
  page.setDefaultTimeout(90000);
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.addInitScript(() => {
    window.probe = { errors: [], buffers: [], groups: 0, pipelines: 0, indirect: [], draws: [], times: [], frames: 0, callbacks: 0 };
    const requestFrame = requestAnimationFrame.bind(window);
    window.requestAnimationFrame = callback => requestFrame(time => { window.probe.callbacks++; callback(time); });
    const requestAdapter = navigator.gpu.requestAdapter.bind(navigator.gpu);
    navigator.gpu.requestAdapter = async (...args) => {
      const adapter = await requestAdapter(...args);
      window.probe.adapter = { vendor: adapter.info.vendor, architecture: adapter.info.architecture };
      const requestDevice = adapter.requestDevice.bind(adapter);
      adapter.requestDevice = async (descriptor = {}) => {
        const device = await requestDevice({ ...descriptor, requiredFeatures: [...new Set([...(descriptor.requiredFeatures ?? []), 'timestamp-query'])] });
        window.probe.device = device;
        device.addEventListener('uncapturederror', e => window.probe.errors.push(e.error.message));
        const buffer = device.createBuffer.bind(device);
        device.createBuffer = descriptor => {
          const result = buffer(descriptor); window.probe.buffers.push({ label: descriptor.label, buffer: result, size: descriptor.size }); return result;
        };
        for (const [name, metric] of [['createBindGroup', 'groups'], ['createRenderPipeline', 'pipelines'], ['createComputePipeline', 'pipelines']]) {
          const original = device[name].bind(device);
          device[name] = (...args) => { window.probe[metric]++; return original(...args); };
        }
        const encoder = device.createCommandEncoder.bind(device);
        device.createCommandEncoder = (...args) => {
          const result = encoder(...args);
          for (const method of ['beginRenderPass', 'beginComputePass']) {
            const begin = result[method].bind(result);
            result[method] = descriptor => {
              const slot = window.probe.timing;
              let index;
              if (slot) { index = slot.count; slot.count += 2; }
              const pass = begin(slot ? { ...descriptor, timestampWrites: { querySet: slot.query, beginningOfPassWriteIndex: index, endOfPassWriteIndex: index + 1 } } : descriptor);
              if (method === 'beginRenderPass' && [...descriptor.colorAttachments].some(Boolean)) {
                window.probe.frames++;
                for (const draw of ['drawIndirect', 'drawIndexedIndirect']) {
                  const original = pass[draw].bind(pass);
                  pass[draw] = (buffer, offset) => { window.probe.indirect.push({ buffer, offset, indexed: draw === 'drawIndexedIndirect' }); return original(buffer, offset); };
                }
              }
              return pass;
            };
          }
          return result;
        };
        return device;
      };
      return adapter;
    };
    window.readCounts = async () => {
      const { device, indirect } = window.probe;
      const read = device.createBuffer({ size: Math.max(4, indirect.length * 32), usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
      const encoder = device.createCommandEncoder();
      indirect.forEach(({ buffer, offset }, i) => encoder.copyBufferToBuffer(buffer, offset, read, i * 32, 20));
      device.queue.submit([encoder.finish()]); await read.mapAsync(GPUMapMode.READ);
      const values = new Uint32Array(read.getMappedRange());
      const counts = indirect.map((draw, i) => ({ vertices: values[i * 8], instances: values[i * 8 + 1],
        first: values[i * 8 + (draw.indexed ? 4 : 3)], indexed: draw.indexed }));
      read.unmap(); read.destroy();
      for (const args of new Set(indirect.map(draw => draw.buffer))) {
        const key = args.label.slice('Occlusion indirect '.length);
        const lookup = label => window.probe.buffers.findLast(entry => entry.label === label).buffer;
        const source = lookup('TypeGPU ' + key + ' instances'), target = lookup('Occlusion instances ' + key), ranges = lookup('Occlusion ranges ' + key);
        const read = device.createBuffer({ size: source.size + target.size + ranges.size, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
        const encoder = device.createCommandEncoder();
        encoder.copyBufferToBuffer(source, 0, read, 0, source.size);
        encoder.copyBufferToBuffer(target, 0, read, source.size, target.size);
        encoder.copyBufferToBuffer(ranges, 0, read, source.size + target.size, ranges.size);
        device.queue.submit([encoder.finish()]); await read.mapAsync(GPUMapMode.READ);
        const mapped = read.getMappedRange();
        const original = new Uint32Array(mapped, 0, source.size / 4);
        const compacted = new Uint32Array(mapped, source.size, target.size / 4);
        const metadata = new Uint32Array(mapped, source.size + target.size, ranges.size / 4);
        const seen = new Set();
        for (let i = 0; i < indirect.length; i++) {
          const draw = indirect[i]; if (draw.buffer !== args || seen.has(draw.offset)) continue; seen.add(draw.offset);
          const range = draw.offset / 4, end = metadata[range + 2] + metadata[range + 3];
          let cursor = metadata[range + 2];
          for (let out = counts[i].first; out < counts[i].first + counts[i].instances; out++) {
            const same = () => { for (let word = 0; word < 24; word++) if (original[cursor*24+word] !== compacted[out*24+word]) return false; return true; };
            while (cursor < end && !same()) cursor++;
            if (cursor >= end) throw new Error('GPU compaction must preserve complete records and canonical range order');
            cursor++;
          }
        }
        read.unmap(); read.destroy();
      }
      window.probe.indirect = []; return counts;
    };
    window.measure = async () => {
      const device = window.probe.device;
      const query = device.createQuerySet({ type: 'timestamp', count: 256 });
      const resolve = device.createBuffer({ size: 2048, usage: GPUBufferUsage.QUERY_RESOLVE | GPUBufferUsage.COPY_SRC });
      const read = device.createBuffer({ size: 2048, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
      window.probe.timing = { query, count: 0 };
      const start = performance.now(); const stats = window.commands.draw(); const cpu = performance.now() - start;
      const count = window.probe.timing.count; window.probe.timing = null;
      const encoder = device.createCommandEncoder(); encoder.resolveQuerySet(query, 0, count, resolve, 0);
      encoder.copyBufferToBuffer(resolve, 0, read, 0, count * 8); device.queue.submit([encoder.finish()]);
      await read.mapAsync(GPUMapMode.READ); const values = new BigUint64Array(read.getMappedRange());
      let gpu = 0; for (let i = 0; i < count; i += 2) gpu += Number(values[i + 1] - values[i]) / 1e6;
      read.unmap(); read.destroy(); resolve.destroy(); query.destroy(); return { cpu, gpu, stats };
    };
  });
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/occlusion-probe`);
  await page.waitForFunction(() => window.ready || window.probe.errors.length);
  assert.deepEqual(await page.evaluate(() => window.probe.errors), []);
  const results = [];
  for (const lod of [false, true]) for (const walls of [true, false]) for (const camera of [0, 28]) {
    const images = [];
    for (const enabled of [false, true]) {
      await page.evaluate(args => window.commands.configure(...args), [enabled, camera, walls, lod]);
      await page.evaluate(() => { window.commands.draw(); window.probe.indirect = []; });
      await page.waitForTimeout(100);
      const measurements = [];
      for (let i = 0; i < 8; i++) measurements.push(await page.evaluate(() => window.measure()));
      const counts = await page.evaluate(() => window.readCounts());
      const result = { walls, camera, enabled, lod, gpuMs: measurements.reduce((s, m) => s + m.gpu, 0) / measurements.length,
        cpuMs: measurements.reduce((s, m) => s + m.cpu, 0) / measurements.length, stats: measurements.at(-1).stats,
        indirectInstances: counts.reduce((s, c) => s + c.instances, 0) / measurements.length };
      results.push(result); console.log(JSON.stringify(result));
      images.push(PNG.sync.read(await page.locator('canvas').screenshot({ path: resolve(output, `${walls}-${camera}-${enabled}-${lod}.png`) })));
      assert.deepEqual(await page.evaluate(() => window.probe.errors), []);
      assert.deepEqual(errors, []);
      if (enabled && walls && camera === 0) {
        assert.equal(result.stats.occlusion, 'active');
        assert(result.indirectInstances > 0, 'Opening reveals some spheres');
        assert(result.indirectInstances < result.stats.occlusionCandidates / 2, 'Walls occlude most spheres');
        if (lod) {
          assert(counts.some(c => c.indexed), 'Indexed authored LOD is drawn indirectly');
          assert(counts.some(c => c.first > 0), 'Disjoint ranges use nonzero indirect firstInstance');
        }
      }
    }
    let changed = 0, colored = 0;
    for (let i = 0; i < images[0].data.length; i += 4) {
      if ([0,1,2,3].some(c => Math.abs(images[0].data[i+c] - images[1].data[i+c]) > 8)) changed++;
      if (Math.abs(images[0].data[i] - images[0].data[i+1]) > 30) colored++;
    }
    console.log(JSON.stringify({ walls, camera, lod, changed, colored }));
    assert(colored > 1000); assert.equal(changed, 0, 'Occlusion preserves all visible pixels');
  }
  for (const width of [390,1440]) {
    await page.setViewportSize({ width, height: 751 });
    const images = [];
    for (const enabled of [false,true]) {
      await page.evaluate(enabled => { window.commands.configure(enabled, 0, true, true); window.commands.draw(); }, enabled);
      images.push(PNG.sync.read(await page.locator('canvas').screenshot()));
    }
    assert.equal(images[0].data.some((value, i) => Math.abs(value - images[1].data[i]) > 8), false,
      'Resizing an existing viewport preserves visible pixels on the next frame');
    assert.deepEqual(await page.evaluate(() => window.probe.errors), []);
  }
  await page.evaluate(() => { window.commands.configure(true, 0, true, true); window.commands.timing(true); window.commands.draw(); window.commands.loop(true); });
  await page.waitForTimeout(300);
  const snapshot = () => page.evaluate(() => ({ frames: window.probe.frames, callbacks: window.probe.callbacks,
    buffers: window.probe.buffers.length, groups: window.probe.groups, pipelines: window.probe.pipelines, time: performance.now() }));
  const before = await snapshot(); await page.waitForTimeout(2500); const after = await snapshot();
  console.log(JSON.stringify({ adapter: await page.evaluate(() => window.probe.adapter), liveFps: (after.frames-before.frames)*1000/(after.time-before.time),
    frames: after.frames-before.frames, callbacks: after.callbacks-before.callbacks }));
  assert(Math.abs((after.frames-before.frames) - (after.callbacks-before.callbacks)) <= 2);
  for (const key of ['buffers','groups','pipelines']) assert.equal(after[key], before[key], `Steady frames reuse ${key}`);
  const timing = await page.evaluate(() => window.commands.stats());
  assert.equal(timing.gpuTiming, 'ready'); assert.equal(timing.gpuTime.occlusion, 'active');
  assert(timing.gpuTime.totalMs > 0 && timing.gpuTime.colorMs > 0 && timing.gpuTime.depthMs > 0 &&
    timing.gpuTime.pyramidMs > 0 && timing.gpuTime.selectionMs > 0, 'Declarative GPU timing measures the whole active path');
  console.log(JSON.stringify({ declarativeGpuTiming: timing.gpuTime }));
  await page.evaluate(() => window.commands.loop(false)); await page.waitForTimeout(150);
  const settled = await snapshot(); await page.waitForTimeout(150); assert.equal((await snapshot()).frames, settled.frames);
  await page.evaluate(() => window.commands.timing(false));
  assert.equal((await page.evaluate(() => window.commands.stats())).gpuTiming, 'disabled');
  assert.deepEqual(await page.evaluate(() => window.probe.errors), []);
  await writeFile(resolve(output, 'results.json'), JSON.stringify(results, null, 2));
  await page.evaluate(() => window.commands.dispose());
} finally {
  await browser?.close(); await server.close(); await rm(temporary, { recursive: true, force: true });
}
