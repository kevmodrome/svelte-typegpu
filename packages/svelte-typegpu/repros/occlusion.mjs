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
const workspace = fileURLToPath(new URL('../../../', import.meta.url));
const app = resolve(workspace, 'apps/example');
const entry = resolve(app, 'src/__occlusion-probe.js');
const viewport = resolve(app, 'src/__OcclusionProbe.typegpu.svelte');
const temporary = await mkdtemp(resolve(tmpdir(), 'typegpu-occlusion-'));
const output = process.env.SVELTE_PROBE_OUTPUT ?? '/tmp/typegpu-occlusion';
await mkdir(output, { recursive: true });
const source = `<script>
  let { onready } = $props();
  let enabled = $state(false), camera = $state(0), walls = $state(true);
  export function configure(e, c, w = true) { enabled = e; camera = c; walls = w; }
</script>
<canvas frameloop="manual" maxDevicePixelRatio={1} {onready} style="display:block;width:100vw;height:80vh">
  <scene occlusion={enabled ? 'hi-z' : 'none'} clearColor={[0.04,0.06,0.08,1]}>
    <perspectiveCamera active position={[camera,4,24]} target={[0,2,-12]} fov={55} far={180} />
    <ambientLight intensity={1} />
    {#if walls}
      <mesh position={[-9,5,3]} scale={[15,12,1]}><boxGeometry /><basicMaterial color={[0.6,0.2,0.1]} /></mesh>
      <mesh position={[9,5,3]} scale={[15,12,1]}><boxGeometry /><basicMaterial color={[0.6,0.2,0.1]} /></mesh>
    {/if}
    {#each Array(6000) as _, i}
      <mesh position={[(i%60-30)*0.65, Math.floor(i/1200)*1.1, -Math.floor(i/60)%20*1.3-2]}>
        <sphereGeometry radius={0.27} widthSegments={32} heightSegments={16} />
        <basicMaterial color={[0.1,0.7,0.5]} />
      </mesh>
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
          draw: () => { flushSync(); root.gpu.renderFrame(performance.now()); return root.gpu.getRenderStats(); },
          dispose: () => unmount(instance) };`;
    },
    configureServer(server) { server.middlewares.use('/occlusion-probe', async (_req, res) => {
      res.setHeader('content-type', 'text/html'); res.end(await server.transformIndexHtml('/occlusion-probe',
        '<!doctype html><style>body{margin:0}</style><script type="module" src="/src/__occlusion-probe.js"></script>'));
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
    window.probe = { errors: [], buffers: [], groups: 0, pipelines: 0, indirect: [], draws: [], times: [] };
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
      const counts = indirect.map((_, i) => ({ vertices: values[i * 8], instances: values[i * 8 + 1] }));
      read.unmap(); read.destroy(); window.probe.indirect = []; return counts;
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
  for (const walls of [true, false]) for (const camera of [0, 28]) {
    const images = [];
    for (const enabled of [false, true]) {
      await page.evaluate(args => window.commands.configure(...args), [enabled, camera, walls]);
      await page.evaluate(() => { window.commands.draw(); window.probe.indirect = []; });
      await page.waitForTimeout(100);
      const measurements = [];
      for (let i = 0; i < 8; i++) measurements.push(await page.evaluate(() => window.measure()));
      const counts = await page.evaluate(() => window.readCounts());
      const result = { walls, camera, enabled, gpuMs: measurements.reduce((s, m) => s + m.gpu, 0) / measurements.length,
        cpuMs: measurements.reduce((s, m) => s + m.cpu, 0) / measurements.length, stats: measurements.at(-1).stats,
        indirectInstances: counts.reduce((s, c) => s + c.instances, 0) / measurements.length };
      results.push(result); console.log(JSON.stringify(result));
      images.push(PNG.sync.read(await page.locator('canvas').screenshot({ path: resolve(output, `${walls}-${camera}-${enabled}.png`) })));
      assert.deepEqual(await page.evaluate(() => window.probe.errors), []);
      assert.deepEqual(errors, []);
      if (enabled && walls && camera === 0) {
        assert.equal(result.stats.occlusion, 'active');
        assert(result.indirectInstances > 0, 'Opening reveals some spheres');
        assert(result.indirectInstances < result.stats.occlusionCandidates / 2, 'Walls occlude most spheres');
      }
    }
    let changed = 0, colored = 0;
    for (let i = 0; i < images[0].data.length; i += 4) {
      if ([0,1,2].some(c => Math.abs(images[0].data[i+c] - images[1].data[i+c]) > 8)) changed++;
      if (Math.abs(images[0].data[i] - images[0].data[i+1]) > 30) colored++;
    }
    console.log(JSON.stringify({ walls, camera, changed, colored }));
    assert(colored > 1000); assert.equal(changed, 0, 'Occlusion preserves all visible pixels');
  }
  await writeFile(resolve(output, 'results.json'), JSON.stringify(results, null, 2));
  await page.evaluate(() => window.commands.dispose());
} finally {
  await browser?.close(); await server.close(); await rm(temporary, { recursive: true, force: true });
}
