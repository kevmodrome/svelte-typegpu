import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
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
const entry = resolve(app, 'src/__listener-probe.js'), viewport = resolve(app, 'src/__ListenerProbe.typegpu.svelte');
const temporary = await mkdtemp(resolve(tmpdir(), 'typegpu-listener-probe-'));
const output = process.env.SVELTE_PROBE_OUTPUT ?? resolve(tmpdir(), 'typegpu-listener-screenshots');
await mkdir(output, { recursive: true });
const source = `<script>
  import { onDestroy } from 'svelte';
  import { Tween } from 'svelte/motion';
  import { onNodeEvent } from 'svelte-typegpu';
  let { onready } = $props();
  const x = new Tween(0, { duration: 500 });
  let picked = $state(0), generation = $state(0), wheels = 0, prevented, active;
  function subscribe(key) { return node => {
    const controller = new AbortController(); active = controller;
    onNodeEvent(node, 'click', () => { picked++; void x.set(picked % 2 ? 0.4 : 0); }, { once: true, signal: controller.signal });
    onNodeEvent(node, 'wheel', event => {
      event.preventDefault(); prevented = event.defaultPrevented; wheels++;
    }, { passive: true, signal: controller.signal });
    return () => controller.abort();
  }; }
  export function abort() { active.abort(); }
  export function rearm() { generation++; }
  export function read() { return { picked, wheels, prevented, x: x.current }; }
  onDestroy(() => { void x.set(x.current, { duration: 0 }); });
</script>
<canvas frameloop="demand" maxDevicePixelRatio={1} {onready}
  style="display:block;width:var(--canvas-width);height:400px">
  <scene clearColor={[0.045, 0.05, 0.055, 1]}>
    <perspectiveCamera active position={[0, 0, 7]} target={[0, 0, 0]} />
    <ambientLight intensity={0.8} />
    <mesh position={[x.current, 0, 0]} rotation={[0.2, 0.4, 0]} scale={2} {@attach subscribe(generation)}>
      <boxGeometry /><standardMaterial color={picked ? [1, 0.7, 0.2] : [0.2, 0.7, 0.55]} />
    </mesh>
  </scene>
</canvas>`;
const server = await createServer({
  root: app, configFile: false, logLevel: 'error', cacheDir: resolve(temporary, 'vite'),
  plugins: [{
    name: 'listener-options-browser-probe', enforce: 'pre',
    resolveId(id) {
      if (id.endsWith('/__listener-probe.js')) return entry;
      if (id.endsWith('/__ListenerProbe.typegpu.svelte')) return viewport;
    },
    load(id) {
      if (id === viewport) return source;
      if (id === entry) return `import { mount, unmount, flushSync } from 'svelte';
        import Viewport from './__ListenerProbe.typegpu.svelte';
        const instance = mount(Viewport, { target: document.body, props: { onready: () => window.ready = true } });
        window.commands = { ...instance, dispose: () => unmount(instance),
          rearm: () => flushSync(() => instance.rearm()) };`;
    },
    configureServer(server) {
      server.middlewares.use('/listener-probe', async (_request, response) => {
        response.setHeader('content-type', 'text/html');
        response.end(await server.transformIndexHtml('/listener-probe', `<!doctype html><html><head>
          <style>body{margin:0;--canvas-width:700px}@media(max-width:700px){body{--canvas-width:300px}}</style>
          </head><body><script type="module" src="/src/__listener-probe.js"></script></body></html>`));
      });
    }
  }, typegpuSvelte({ configFile: false })],
  server: { host: '127.0.0.1', port: 0, watch: null, fs: { allow: [workspace] } }
});
let browser;
try {
  await server.listen(); const { port } = server.httpServer.address();
  browser = await chromium.launch({ headless: true, executablePath: process.env.SVELTE_PROBE_CHROMIUM,
    args: ['--enable-unsafe-webgpu', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  for (const width of [1440, 390]) {
    const context = await browser.newContext({ viewport: { width, height: 900 } });
    try {
      const page = await context.newPage(), errors = [];
      page.on('pageerror', error => errors.push(error.message));
      page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
      await page.addInitScript(() => {
        window.metrics = { buffers: 0, groups: 0, pipelines: 0, submissions: 0 }; window.pending = new Set();
        const raf = window.requestAnimationFrame.bind(window), cancel = window.cancelAnimationFrame.bind(window);
        window.requestAnimationFrame = callback => {
          const id = raf(time => { window.pending.delete(id); callback(time); }); window.pending.add(id); return id;
        };
        window.cancelAnimationFrame = id => { window.pending.delete(id); cancel(id); };
        const requestAdapter = navigator.gpu.requestAdapter.bind(navigator.gpu);
        navigator.gpu.requestAdapter = async (...args) => {
          const adapter = await requestAdapter(...args), requestDevice = adapter.requestDevice.bind(adapter);
          adapter.requestDevice = async (...args) => {
            const device = await requestDevice(...args);
            device.addEventListener('uncapturederror', event => window.metrics.gpuError = event.error.message);
            for (const [method, metric] of [['createBuffer', 'buffers'], ['createBindGroup', 'groups'], ['createRenderPipeline', 'pipelines']]) {
              const original = device[method].bind(device);
              device[method] = (...args) => { window.metrics[metric]++; return original(...args); };
            }
            const submit = device.queue.submit.bind(device.queue);
            device.queue.submit = (...args) => { window.metrics.submissions++; return submit(...args); };
            return device;
          }; return adapter;
        };
      });
      await page.goto(`http://127.0.0.1:${port}/listener-probe`, { waitUntil: 'networkidle' });
      await page.waitForFunction(() => window.ready, null, { polling: 50 });
      const idle = () => page.waitForFunction(() => window.pending.size === 0, null, { polling: 50, timeout: 15000 });
      await idle();
      const canvas = page.locator('canvas'), bounds = await canvas.boundingBox();
      const click = () => canvas.click({ position: { x: bounds.width / 2, y: bounds.height / 2 } });
      const metrics = () => page.evaluate(() => window.metrics);
      const resources = await metrics();
      const before = PNG.sync.read(await canvas.screenshot());
      await click(); await idle(); await click(); await idle();
      assert.equal((await page.evaluate(() => window.commands.read())).picked, 1);
      const after = PNG.sync.read(await canvas.screenshot({ path: resolve(output, `${width}-selected.png`) }));
      let pixels = 0;
      for (let i = 0; i < before.data.length; i += 4) if (Math.abs(before.data[i] - after.data[i]) > 20) pixels++;
      assert(pixels > 1000, `Click and Tween must visibly update the mesh: ${pixels}`);
      const wheel = () => page.evaluate(() => {
        const canvas = document.querySelector('canvas'), bounds = canvas.getBoundingClientRect();
        const event = new WheelEvent('wheel', { clientX: bounds.x + bounds.width / 2, clientY: bounds.y + bounds.height / 2,
          deltaY: 10, bubbles: true, cancelable: true });
        canvas.dispatchEvent(event); return event.defaultPrevented;
      });
      assert.equal(await wheel(), false);
      assert.deepEqual(await page.evaluate(() => window.commands.read()), { picked: 1, wheels: 1, prevented: false, x: 0.4 });
      await page.evaluate(() => window.commands.abort()); await idle();
      await wheel(); await click(); await idle();
      assert.equal((await page.evaluate(() => window.commands.read())).wheels, 1);
      assert.equal((await page.evaluate(() => window.commands.read())).picked, 1);
      await page.evaluate(() => window.commands.rearm()); await idle(); await click();
      await page.waitForFunction(() => window.commands.read().picked === 2, null, { polling: 20 });
      for (const key of ['buffers', 'groups', 'pipelines']) assert.equal((await metrics())[key], resources[key]);
      await page.evaluate(() => window.commands.dispose()); await idle();
      assert.equal(await canvas.count(), 0);
      const final = await metrics(); await page.waitForTimeout(200);
      assert.equal((await metrics()).submissions, final.submissions);
      assert.equal(final.gpuError, undefined); assert.deepEqual(errors, []);
      console.log(JSON.stringify({ width, pixels, resources, final, output }));
    } finally { await context.close(); }
  }
} finally { await browser?.close(); await server.close(); await rm(temporary, { recursive: true, force: true }); }
