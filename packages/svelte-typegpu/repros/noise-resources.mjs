import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { typegpuSvelte } from '../compiler/vite.ts';

const require = process.env.SVELTE_PROBE_BROWSER_DEPENDENCIES
  ? createRequire(resolve(process.env.SVELTE_PROBE_BROWSER_DEPENDENCIES, 'package.json'))
  : createRequire(import.meta.url);
const { chromium } = require('playwright'), { PNG } = require('pngjs');
const workspace = fileURLToPath(new URL('../../../', import.meta.url));
const app = resolve(workspace, 'apps/example');
const entry = resolve(app, 'src/__noise-probe.js');
const viewport = resolve(app, 'src/__NoiseProbe.typegpu.svelte');
const temporary = await mkdtemp(resolve(tmpdir(), 'typegpu-noise-probe-'));
const output = process.env.SVELTE_PROBE_OUTPUT ?? resolve(tmpdir(), 'typegpu-noise-screenshots');
await mkdir(output, { recursive: true });
const source = `<script>
  import { smokyTriangleMaterialFragment } from '../../docs/src/examples/multiple-smoky-triangles/smoky-triangle-material';
  let { onready } = $props();
  let noisy = $state(false);
  export function noise(value) { noisy = value; }
</script>
<canvas frameloop="manual" maxDevicePixelRatio={1} {onready}
  style="display:block;width:var(--canvas-width);height:400px">
  <scene clearColor={[0.045, 0.05, 0.055, 1]}>
    <perspectiveCamera active position={[5, 3, 6]} target={[0, 0, 0]} />
    <ambientLight intensity={0.8} /><directionalLight position={[4, 8, 6]} intensity={1} />
    <mesh name="subject" scale={2.5}>
      <boxGeometry />
      {#if noisy}
        <shaderMaterial fragment={smokyTriangleMaterialFragment} color={[0.3, 0.4, 0.7]} />
      {:else}
        <standardMaterial color={[0.2, 0.7, 0.55]} />
      {/if}
    </mesh>
  </scene>
</canvas>`;
const server = await createServer({
  root: app, configFile: false, logLevel: 'error', cacheDir: resolve(temporary, 'vite'),
  plugins: [{
    name: 'noise-resource-browser-probe', enforce: 'pre',
    resolveId(id) {
      if (id.endsWith('/__noise-probe.js')) return entry;
      if (id.endsWith('/__NoiseProbe.typegpu.svelte')) return viewport;
    },
    load(id) {
      if (id === viewport) return source;
      if (id === entry) return `import { mount, unmount, flushSync } from 'svelte';
        import Viewport from './__NoiseProbe.typegpu.svelte';
        let root;
        const instance = mount(Viewport, { target: document.body,
          props: { onready: value => { root = value; window.ready = true; } } });
        window.commands = {
          noise: value => flushSync(() => instance.noise(value)),
          draw: time => { flushSync(); root.gpu.renderFrame(time); },
          dispose: () => unmount(instance)
        };`;
    },
    configureServer(server) {
      server.middlewares.use('/noise-probe', async (_request, response) => {
        response.setHeader('content-type', 'text/html');
        response.end(await server.transformIndexHtml('/noise-probe', `<!doctype html><html><head>
          <style>body{margin:0;--canvas-width:700px}@media(max-width:700px){body{--canvas-width:300px}}</style>
          </head><body><script type="module" src="/src/__noise-probe.js"></script></body></html>`));
      });
    }
  }, typegpuSvelte({ configFile: false })],
  server: { host: '127.0.0.1', port: 0, watch: null, fs: { allow: [workspace] } }
});

function difference(a, b) {
  assert.equal(a.width, b.width); assert.equal(a.height, b.height);
  let count = 0;
  for (let i = 0; i < a.data.length; i += 4) {
    if (Math.abs(a.data[i] - b.data[i]) + Math.abs(a.data[i + 1] - b.data[i + 1]) + Math.abs(a.data[i + 2] - b.data[i + 2]) > 20) count++;
  }
  return count;
}

let browser;
try {
  await server.listen();
  const { port } = server.httpServer.address();
  browser = await chromium.launch({ headless: true, executablePath: process.env.SVELTE_PROBE_CHROMIUM,
    args: ['--enable-unsafe-webgpu', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  for (const width of [1440, 390]) {
    const context = await browser.newContext({ viewport: { width, height: 900 } });
    try {
      const page = await context.newPage(), errors = [];
      page.on('pageerror', error => errors.push(error.message));
      page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
      await page.addInitScript(() => {
        window.metrics = { buffers: [], bindGroups: 0, renderPipelines: 0, computePipelines: 0, submissions: 0, raf: 0, deviceDestroy: 0 };
        const requestFrame = window.requestAnimationFrame.bind(window);
        window.requestAnimationFrame = callback => { window.metrics.raf++; return requestFrame(callback); };
        const requestAdapter = navigator.gpu.requestAdapter.bind(navigator.gpu);
        navigator.gpu.requestAdapter = async (...args) => {
          const adapter = await requestAdapter(...args);
          window.metrics.adapter = { vendor: adapter.info.vendor, architecture: adapter.info.architecture };
          const requestDevice = adapter.requestDevice.bind(adapter);
          adapter.requestDevice = async (...args) => {
            const device = await requestDevice(...args);
            device.addEventListener('uncapturederror', event => { window.metrics.gpuError = event.error.message; });
            const createBuffer = device.createBuffer.bind(device);
            device.createBuffer = descriptor => {
              const buffer = createBuffer(descriptor), lifetime = { size: descriptor.size, destroyed: false };
              window.metrics.buffers.push(lifetime);
              const destroy = buffer.destroy.bind(buffer);
              buffer.destroy = () => { lifetime.destroyed = true; destroy(); };
              return buffer;
            };
            for (const [method, metric] of [['createRenderPipeline', 'renderPipelines'], ['createComputePipeline', 'computePipelines'], ['createBindGroup', 'bindGroups']]) {
              const original = device[method].bind(device);
              device[method] = (...args) => { window.metrics[metric]++; return original(...args); };
            }
            const submit = device.queue.submit.bind(device.queue), destroy = device.destroy.bind(device);
            device.queue.submit = (...args) => { window.metrics.submissions++; return submit(...args); };
            device.destroy = () => { window.metrics.deviceDestroy++; return destroy(); };
            return device;
          };
          return adapter;
        };
      });
      await page.goto(`http://127.0.0.1:${port}/noise-probe`, { waitUntil: 'networkidle' });
      await page.waitForFunction(() => window.ready, null, { polling: 50 });
      const metrics = () => page.evaluate(() => window.metrics);
      assert.equal((await metrics()).computePipelines, 0);
      assert.equal((await metrics()).submissions, 0);
      const canvas = page.locator('canvas');
      await page.evaluate(() => window.commands.draw(0));
      const plain = PNG.sync.read(await canvas.screenshot({ path: resolve(output, `${width}-plain.png`) }));
      await page.evaluate(() => { window.commands.noise(true); window.commands.draw(0); });
      const noisy = PNG.sync.read(await canvas.screenshot({ path: resolve(output, `${width}-noise.png`) }));
      const resourceState = await metrics();
      assert.equal(resourceState.computePipelines, 1);
      assert.equal(resourceState.renderPipelines, 2);
      assert.equal(resourceState.buffers.filter(buffer => buffer.size === 524288).length, 1);
      const materialPixels = difference(plain, noisy);
      assert(materialPixels > 1000, `Noise material must visibly replace the plain material: ${materialPixels}`);
      await page.evaluate(() => { for (let i = 1; i <= 60; i++) window.commands.draw(i * 1000 / 60); });
      const animated = PNG.sync.read(await canvas.screenshot({ path: resolve(output, `${width}-animated.png`) }));
      const animationPixels = difference(noisy, animated);
      assert(animationPixels > 100, `Noise must animate: ${animationPixels}`);
      const animatedState = await metrics();
      assert.deepEqual(animatedState.buffers, resourceState.buffers);
      assert.equal(animatedState.computePipelines, 1); assert.equal(animatedState.renderPipelines, 2);
      assert.equal(animatedState.bindGroups, resourceState.bindGroups);
      assert.equal(animatedState.submissions - resourceState.submissions, 60);
      await page.evaluate(() => { window.commands.noise(false); window.commands.draw(1000); });
      assert.equal(difference(plain, PNG.sync.read(await canvas.screenshot())), 0);
      await page.evaluate(() => { window.commands.noise(true); window.commands.draw(1000); });
      assert.equal((await metrics()).computePipelines, 1);
      assert.equal((await metrics()).buffers.filter(buffer => buffer.size === 524288).length, 1);
      const idle = (await metrics()).submissions;
      await page.waitForTimeout(200);
      assert.equal((await metrics()).submissions, idle);
      assert.equal((await metrics()).raf, 0, 'Manual renderer must never schedule RAF');
      await page.evaluate(() => window.commands.dispose());
      assert.equal(await canvas.count(), 0);
      const final = await metrics();
      assert.equal(final.deviceDestroy, 1);
      assert(final.buffers.filter(buffer => buffer.size === 524288).every(buffer => buffer.destroyed));
      assert.deepEqual(final.buffers.filter(buffer => !buffer.destroyed), [{ size: 12, destroyed: false }]);
      await page.waitForTimeout(100);
      assert.equal((await metrics()).submissions, final.submissions);
      assert.equal(final.gpuError, undefined); assert.deepEqual(errors, []);
      console.log(JSON.stringify({ width, materialPixels, animationPixels, output, metrics: final }));
    } finally { await context.close(); }
  }
} finally { await browser?.close(); await server.close(); await rm(temporary, { recursive: true, force: true }); }
