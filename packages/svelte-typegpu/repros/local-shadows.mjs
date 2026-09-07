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
const workspace = fileURLToPath(new URL('../../../', import.meta.url)), app = resolve(workspace, 'apps/example');
const entry = resolve(app, 'src/__shadow-probe.js'), viewport = resolve(app, 'src/__ShadowProbe.typegpu.svelte');
const temporary = await mkdtemp(resolve(tmpdir(), 'typegpu-shadows-'));
const output = process.env.SVELTE_PROBE_OUTPUT ?? '/tmp/typegpu-local-shadows';
await mkdir(output, { recursive: true });
const source = `<script>
  import { createModelLod } from 'svelte-typegpu';
  import { createSphereGeometryData } from '../../../packages/svelte-typegpu/src/geometries';
  import { createMaterialDescriptor } from '../../../packages/svelte-typegpu/src/material-descriptors';
  let { onready } = $props();
  let enabled = $state(false), lod = $state(false), distance = $state(20), x = $state(0), cameraX = $state(0);
  const high = createSphereGeometryData(1, 24, 16), low = createSphereGeometryData(1, 8, 6);
  low.indexData = Uint32Array.from({ length: low.vertexCount }, (_, i) => i);
  low.indexCount = low.vertexCount; low.indexFormat = 'uint32'; low.key += ':indexed';
  const model = geometry => ({ key: geometry.key, meshes: [{ geometry, material: createMaterialDescriptor('standard'),
    transform: { position: [0,0,0], rotation: [0,0,0], scale: [1,1,1] } }] });
  const asset = createModelLod(model(high), [{ maxScreenHeight: 80, asset: model(low) }]);
  export function configure(options) {
    if ('enabled' in options) enabled = options.enabled;
    if ('lod' in options) lod = options.lod;
    if ('distance' in options) distance = options.distance;
    if ('x' in options) x = options.x;
    if ('cameraX' in options) cameraX = options.cameraX;
  }
</script>
<canvas frameloop="manual" maxDevicePixelRatio={1} {onready} style="display:block;width:100vw;height:100vh">
  <scene clearColor={[0.03,0.04,0.05,1]}>
    <perspectiveCamera position={[cameraX,5,10]} target={[cameraX,0,0]} fov={45} far={1000} />
    <ambientLight intensity={0.2} />
    <directionalLight position={[0,40,0]} lookAt={[0,0,0]} castShadow={enabled}
      shadowDistance={distance} shadowLod={lod} shadowMapSize={512} intensity={1} />
    <mesh position={[0,-0.25,0]} scale={[30,0.5,30]} receiveShadow><boxGeometry /><standardMaterial color={[0.8,0.8,0.8]} /></mesh>
    <model {asset} position={[x,30,0]} castShadow />
    <model {asset} position={[200,30,0]} castShadow />
  </scene>
</canvas>`;
const server = await createServer({ root: app, configFile: false, logLevel: 'error', cacheDir: resolve(temporary, 'vite'),
  plugins: [{ name: 'shadow-probe', enforce: 'pre',
    resolveId(id) { if (id.endsWith('/__shadow-probe.js')) return entry; if (id.endsWith('/__ShadowProbe.typegpu.svelte')) return viewport; },
    load(id) {
      if (id === viewport) return source;
      if (id === entry) return `import { mount, unmount, flushSync } from 'svelte'; import Viewport from './__ShadowProbe.typegpu.svelte';
        let root; const instance = mount(Viewport, { target: document.body, props: { onready: value => { root = value; window.ready = true; } } });
        window.commands = { configure: value => flushSync(() => instance.configure(value)),
          draw: () => { flushSync(); root.gpu.renderFrame(performance.now()); return root.gpu.getRenderStats(); },
          dispose: () => unmount(instance) };`;
    },
    configureServer(server) { server.middlewares.use('/shadow-probe', async (_req, res) => {
      res.setHeader('content-type', 'text/html'); res.end(await server.transformIndexHtml('/shadow-probe',
        '<!doctype html><link rel="icon" href="data:,"><style>body{margin:0}</style><script type="module" src="/src/__shadow-probe.js"></script>'));
    }); }
  }, typegpuSvelte({ configFile: false })], server: { host: '127.0.0.1', port: 0, watch: null, fs: { allow: [workspace] } } });
let browser;
try {
  await server.listen();
  browser = await chromium.launch({ headless: true, executablePath: process.env.SVELTE_PROBE_CHROMIUM,
    args: ['--enable-unsafe-webgpu', '--use-angle=metal'] });
  const page = await browser.newPage({ viewport: { width: 1000, height: 700 } });
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.addInitScript(() => {
    const p = window.probe = { errors: [], buffers: 0, groups: 0, pipelines: 0, writes: 0, frames: 0, raf: 0, matrix: [] };
    const raf = requestAnimationFrame.bind(window);
    window.requestAnimationFrame = callback => { p.raf++; return raf(callback); };
    const adapter = navigator.gpu.requestAdapter.bind(navigator.gpu);
    navigator.gpu.requestAdapter = async (...args) => {
      const a = await adapter(...args); if (!a || a.info.isFallbackAdapter) throw new Error('Real GPU required');
      p.adapter = { vendor: a.info.vendor, architecture: a.info.architecture };
      const request = a.requestDevice.bind(a);
      a.requestDevice = async (...args) => {
        const d = await request(...args); d.addEventListener('uncapturederror', e => p.errors.push(e.error.message));
        for (const [method, key] of [['createBuffer','buffers'], ['createBindGroup','groups'], ['createRenderPipeline','pipelines']]) {
          const original = d[method].bind(d); d[method] = (...args) => { p[key]++; return original(...args); };
        }
        const write = d.queue.writeBuffer.bind(d.queue);
        d.queue.writeBuffer = (buffer, offset, data, ...args) => {
          if (buffer.label.endsWith('instances')) p.writes++;
          if (buffer.label === 'TypeGPU scene uniforms') p.frames++;
          if (buffer.label === 'TypeGPU shadow uniforms') p.matrix = [...new Float32Array(
            ArrayBuffer.isView(data) ? data.buffer : data, ArrayBuffer.isView(data) ? data.byteOffset : 0, 24)];
          return write(buffer, offset, data, ...args);
        }; return d;
      }; return a;
    };
  });
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/shadow-probe`);
  await page.waitForFunction(() => window.ready);
  const draw = async options => {
    await page.evaluate(options => window.commands.configure(options), options);
    return page.evaluate(() => window.commands.draw());
  };
  const shot = async name => {
    const bytes = await page.locator('canvas').screenshot({ path: `${output}/${name}.png` }); return PNG.sync.read(bytes);
  };
  const darkness = (base, shadow) => {
    let sum = 0, pixels = 0;
    for (let i = 0; i < base.data.length; i += 4) {
      const difference = base.data[i] - shadow.data[i];
      if (difference > 15) { sum += difference; pixels++; }
    } return { sum, pixels };
  };
  const results = [];
  for (const [name, size] of [['desktop', { width: 1000, height: 700 }], ['mobile', { width: 390, height: 740 }]]) {
    await page.setViewportSize(size);
    await draw({ enabled: false, lod: false, distance: 20, x: 0, cameraX: 0 });
    const baseline = await shot(`${name}-off`);
    const high = await draw({ enabled: true }), full = await shot(`${name}-high`);
    assert.equal(high.shadowInstances, 1); assert.equal(high.culledInstances, 2); assert.equal(high.shadowRangeFallbacks, 0);
    const shadow = darkness(baseline, full); assert(shadow.pixels > 100, 'offscreen caster must darken visible ground');
    const before = await page.evaluate(() => structuredClone(window.probe));
    const low = await draw({ lod: true }), reduced = await shot(`${name}-lod`);
    assert(low.shadowTriangles < high.shadowTriangles); assert(low.shadowLodTrianglesSaved > 0);
    assert(darkness(baseline, reduced).sum > shadow.sum * 0.7, 'LOD must preserve a substantial shadow silhouette');
    const after = await page.evaluate(() => structuredClone(window.probe));
    for (const key of ['buffers','groups','pipelines','writes','raf']) assert.equal(after[key], before[key], `${key} must be reused on shadow policy change`);
    await draw({ lod: false, distance: 11.5 });
    const fade = darkness(baseline, await shot(`${name}-fade`)); assert(fade.sum < shadow.sum * 0.8, 'distant shadow must fade');
    await draw({ distance: 20, x: 5 });
    const moved = await shot(`${name}-moved`);
    let restored = 0;
    for (let i = 0; i < baseline.data.length; i += 4) if (baseline.data[i] - full.data[i] > 15 && Math.abs(baseline.data[i] - moved.data[i]) < 3) restored++;
    assert(restored > shadow.pixels * 0.9, 'moving caster must clear the previous shadow');
    await draw({ x: 0, cameraX: 0 });
    const stable = await page.evaluate(() => structuredClone(window.probe));
    await draw({ cameraX: 0.00001 });
    const shifted = await page.evaluate(() => structuredClone(window.probe));
    for (const i of [0,1,4,5,8,9,12,13]) assert.equal(shifted.matrix[i] + 0, stable.matrix[i] + 0, 'sub-texel camera translation must not move shadow sampling');
    for (const key of ['buffers','groups','pipelines','writes','raf']) assert.equal(shifted[key], stable[key]);
    results.push({ name, high, low, shadow, fade, restored });
  }
  const frames = await page.evaluate(() => window.probe.frames);
  await page.waitForTimeout(200); assert.equal(await page.evaluate(() => window.probe.frames), frames, 'manual mode must remain idle');
  await page.evaluate(() => window.commands.dispose());
  await page.waitForTimeout(100);
  assert.equal(await page.evaluate(() => window.probe.frames), frames);
  assert.deepEqual(await page.evaluate(() => window.probe.errors), []); assert.deepEqual(errors, []);
  await writeFile(`${output}/results.json`, JSON.stringify(results, null, 2));
  console.log(JSON.stringify(results, null, 2));
} finally { await browser?.close(); await server.close(); await rm(temporary, { recursive: true, force: true }); }
