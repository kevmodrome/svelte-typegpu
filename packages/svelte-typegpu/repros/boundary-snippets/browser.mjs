import assert from 'node:assert/strict';
import { mkdtemp, mkdir } from 'node:fs/promises';
import { createRequire, registerHooks } from 'node:module';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';

const copy = process.env.SVELTE_PROBE_DIR;
assert(copy, 'Run through probe-async-boundary.mjs boundary-snippets --browser');
const compiler = process.env.SVELTE_PROBE_COMPILER ?? 'esm';
assert(['esm', 'cjs'].includes(compiler), 'Compiler must be esm or cjs');
const compilerUrl = compiler === 'cjs' ? new URL('./compiler-commonjs.mjs', import.meta.url).href :
  pathToFileURL(resolve(copy, 'src/compiler/index.js')).href;
let compilerResolutions = 0;
const hooks = registerHooks({ resolve(specifier, context, next) {
  if (specifier === 'svelte/compiler') { compilerResolutions++; return next(compilerUrl, context); }
  return next(specifier, context);
} });
const require = process.env.SVELTE_PROBE_BROWSER_DEPENDENCIES
  ? createRequire(resolve(process.env.SVELTE_PROBE_BROWSER_DEPENDENCIES, 'package.json'))
  : createRequire(import.meta.url);
const { chromium } = require('playwright');
const { PNG } = require('pngjs');
const { createServer } = await import('vite');
const { typegpuSvelte } = await import('../../compiler/vite.ts');
const workspace = fileURLToPath(new URL('../../../../', import.meta.url));
const app = resolve(workspace, 'apps/example');
const entry = resolve(app, 'src/__boundary-probe.js');
const viewport = resolve(app, 'src/__BoundaryProbe.typegpu.svelte');
const output = process.env.SVELTE_PROBE_OUTPUT ?? await mkdtemp(resolve(tmpdir(), 'typegpu-boundary-browser-'));
await mkdir(output, { recursive: true });

const source = `<script>
  import { onDestroy } from 'svelte';
  import { Tween } from 'svelte/motion';
  let { onready, setup } = $props();
  let broken = $state(false), label = $state('first');
  const x = new Tween(0, { duration: 500 });
  function readName() { if (broken) throw new Error('broken'); return 'ready'; }
  export function fail() { broken = true; }
  export function rename(value) { label = value; }
  export function move(value) { void x.set(value); }
  onDestroy(() => { void x.set(x.current, { duration: 0 }); });
</script>
<canvas frameloop="demand" maxDevicePixelRatio={1} {onready}
  style="display:block;width:var(--canvas-width);height:400px">
  <scene clearColor={[0.045, 0.05, 0.055, 1]}>
    <perspectiveCamera active position={[8, 6, 10]} target={[0, 0.5, 0]} />
    <ambientLight intensity={0.7} /><directionalLight position={[4, 8, 6]} intensity={1.1} />
    {#each Array.from({ length: 36 }, (_, i) => i) as id (id)}
      <mesh name={'floor-' + id} position={[id % 6 - 2.5, -0.1, Math.floor(id / 6) - 2.5]} scale={[0.96, 0.15, 0.96]}>
        <boxGeometry /><standardMaterial color={[0.2, 0.4, 0.45]} />
      </mesh>
    {/each}
    <mesh name="motion" position={[x.current, 1.25, -1.6]} scale={0.6} {@attach setup('motion')}>
      <boxGeometry /><standardMaterial color={[1, 0.8, 0.2]} />
    </mesh>
    <svelte:boundary>
      {@const prefix = label.toUpperCase()}
      <mesh name={readName()} position={[0, 0.75, 0]} scale={[0.8, 1.5, 0.8]} {@attach setup('ready')}>
        <boxGeometry /><standardMaterial color={[0.3, 0.8, 0.6]} />
      </mesh>
      {#snippet failed(error, reset)}
        <mesh name={prefix + ':' + error.message} position={[0, 0.75, 0]} scale={[0.8, 1.5, 0.8]}
          onclick={() => { broken = false; reset(); }} {@attach setup('failed')}>
          <boxGeometry /><standardMaterial color={[0.95, 0.15, 0.2]} />
        </mesh>
      {/snippet}
    </svelte:boundary>
  </scene>
</canvas>`;
const server = await createServer({
  root: app, configFile: false, logLevel: 'error', cacheDir: resolve(copy, '../vite-cache'),
  plugins: [{
    name: 'boundary-snippets-browser-probe', enforce: 'pre',
    resolveId(id) {
      if (id.endsWith('/__boundary-probe.js')) return entry;
      if (id.endsWith('/__BoundaryProbe.typegpu.svelte')) return viewport;
    },
    load(id) {
      if (id === viewport) return source;
      if (id === entry) return `import { mount, unmount } from 'svelte';
        import Viewport from './__BoundaryProbe.typegpu.svelte';
        window.lifecycle = [];
        const attachments = Object.fromEntries(['motion', 'ready', 'failed'].map(phase => [phase,
          () => { window.lifecycle.push('attach:' + phase); return () => window.lifecycle.push('detach:' + phase); }]));
        let root;
        const instance = mount(Viewport, { target: document.body, props: {
          onready: value => { root = value; window.ready = true; }, setup: phase => attachments[phase]
        } });
        window.commands = { ...instance, dispose: () => unmount(instance), nodes: () => {
          const nodes = [];
          function visit(node) { if (node.attributes.name) nodes.push({ name: node.attributes.name, uid: node.uid }); node.children.forEach(visit); }
          visit(root); return nodes;
        } };`;
    },
    configureServer(server) {
      server.middlewares.use('/boundary-probe', async (_request, response) => {
        response.setHeader('content-type', 'text/html');
        response.end(await server.transformIndexHtml('/boundary-probe', `<!doctype html><html><head>
          <style>body{margin:0;--canvas-width:700px}@media(max-width:700px){body{--canvas-width:300px}}</style>
          </head><body><script type="module" src="/src/__boundary-probe.js"></script></body></html>`));
      });
    }
  }, typegpuSvelte({ configFile: false })],
  server: { host: '127.0.0.1', port: 0, strictPort: false, watch: null, fs: { allow: [workspace] } }
});
let browser;
function difference(a, b) {
  assert.equal(a.width, b.width); assert.equal(a.height, b.height);
  let count = 0;
  for (let i = 0; i < a.data.length; i += 4) {
    if (Math.abs(a.data[i] - b.data[i]) + Math.abs(a.data[i + 1] - b.data[i + 1]) + Math.abs(a.data[i + 2] - b.data[i + 2]) > 20) count++;
  }
  return count;
}
try {
  await server.listen();
  const { port } = server.httpServer.address();
  browser = await chromium.launch({ headless: true, executablePath: process.env.SVELTE_PROBE_CHROMIUM,
    args: ['--enable-unsafe-webgpu', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  for (const width of [1440, 390]) {
    const context = await browser.newContext({ viewport: { width, height: 900 } });
    try {
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
      await page.addInitScript(() => {
        window.metrics = { submissions: 0, destroyedBuffers: 0, deviceDestroyCalls: 0,
          buffers: [], resources: { buffers: 0, bindGroups: 0, pipelines: 0 } };
        window.pending = new Set();
        const raf = window.requestAnimationFrame.bind(window), cancel = window.cancelAnimationFrame.bind(window);
        window.requestAnimationFrame = callback => {
          const id = raf(time => { window.pending.delete(id); callback.call(window, time); });
          window.pending.add(id); return id;
        };
        window.cancelAnimationFrame = id => { window.pending.delete(id); cancel(id); };
        const request = navigator.gpu.requestAdapter.bind(navigator.gpu);
        navigator.gpu.requestAdapter = async (...args) => {
          const adapter = await request(...args);
          window.metrics.adapter = { vendor: adapter.info.vendor, architecture: adapter.info.architecture };
          const requestDevice = adapter.requestDevice.bind(adapter);
          adapter.requestDevice = async (...args) => {
            const device = await requestDevice(...args);
            for (const [method, counter] of [['createBuffer', 'buffers'], ['createBindGroup', 'bindGroups'], ['createRenderPipeline', 'pipelines'], ['createRenderPipelineAsync', 'pipelines']]) {
              const original = device[method].bind(device);
              device[method] = (...args) => {
                window.metrics.resources[counter]++;
                const resource = original(...args);
                if (method === 'createBuffer') {
                  let destroyed = false;
                  const lifetime = { label: args[0].label ?? '', size: args[0].size, usage: args[0].usage, destroyed: false };
                  window.metrics.buffers.push(lifetime);
                  const destroy = resource.destroy.bind(resource);
                  resource.destroy = () => {
                    if (!destroyed) { destroyed = true; lifetime.destroyed = true; window.metrics.destroyedBuffers++; }
                    return destroy();
                  };
                }
                return resource;
              };
            }
            const submit = device.queue.submit.bind(device.queue);
            device.queue.submit = (...args) => { window.metrics.submissions++; return submit(...args); };
            const destroy = device.destroy.bind(device);
            device.destroy = () => { window.metrics.deviceDestroyCalls++; return destroy(); };
            return device;
          };
          return adapter;
        };
      });
      await page.goto(`http://127.0.0.1:${port}/boundary-probe`, { waitUntil: 'networkidle', timeout: 30000 });
      await page.waitForFunction(() => window.ready, null, { polling: 50, timeout: 20000 });
      const idle = () => page.waitForFunction(() => window.pending.size === 0, null, { polling: 50, timeout: 15000 });
      await idle();
      const canvas = page.locator('canvas');
      await page.evaluate(() => { window.originalCanvas = document.querySelector('canvas'); });
      const initial = PNG.sync.read(await canvas.screenshot());
      const resources = await page.evaluate(() => window.metrics.resources);
      assert.deepEqual(resources, { buffers: 6, bindGroups: 4, pipelines: 1 });
      const stable = await page.evaluate(() => window.commands.nodes().filter(node => node.name.startsWith('floor-') || node.name === 'motion'));
      assert.equal(stable.length, 37);
      await page.evaluate(() => window.commands.move(2)); await idle();
      const moved = PNG.sync.read(await canvas.screenshot());
      const motionPixels = difference(initial, moved);
      assert(motionPixels > 20, `Expected visible motion, got ${motionPixels} changed pixels`);
      await page.evaluate(() => window.commands.fail()); await idle();
      await page.waitForFunction(() => window.commands.nodes().some(node => node.name === 'FIRST:broken'), null, { polling: 50 });
      const failed = PNG.sync.read(await canvas.screenshot({ path: resolve(output, `${compiler}-${width}-failed.png`) }));
      const failurePixels = difference(moved, failed);
      assert(failurePixels > 20, `Expected visible failure content, got ${failurePixels} changed pixels`);
      await page.evaluate(() => window.commands.rename('second')); await idle();
      await page.waitForFunction(() => window.commands.nodes().some(node => node.name === 'SECOND:broken'), null, { polling: 50 });
      const box = await canvas.boundingBox();
      await canvas.click({ position: { x: box.width / 2, y: box.height / 2 } });
      await page.waitForFunction(() => window.commands.nodes().some(node => node.name === 'ready'), null, { polling: 50 });
      await idle();
      const recovered = PNG.sync.read(await canvas.screenshot({ path: resolve(output, `${compiler}-${width}-ready.png`) }));
      assert.equal(difference(moved, recovered), 0, 'Clicked reset must restore the same scene pixels');
      assert.deepEqual(await page.evaluate(() => window.commands.nodes().filter(node => node.name.startsWith('floor-') || node.name === 'motion')), stable);
      assert(await page.evaluate(() => document.querySelector('canvas') === window.originalCanvas));
      assert.deepEqual(await page.evaluate(() => window.metrics.resources), resources);
      const settled = await page.evaluate(() => window.metrics.submissions);
      await page.waitForTimeout(200);
      assert.equal(await page.evaluate(() => window.metrics.submissions), settled);
      assert.deepEqual(await page.evaluate(() => window.lifecycle.filter(entry => !entry.endsWith(':motion'))),
        ['attach:ready', 'detach:ready', 'attach:failed', 'detach:failed', 'attach:ready']);
      await page.evaluate(() => window.commands.move(-2));
      await page.waitForTimeout(50);
      await page.evaluate(() => window.commands.dispose()); await idle();
      assert.equal(await canvas.count(), 0);
      assert.deepEqual(await page.evaluate(() => window.commands.nodes()), []);
      assert.equal(await page.evaluate(() => window.metrics.deviceDestroyCalls), 1);
      const lifetimes = await page.evaluate(() => window.metrics.buffers);
      assert.deepEqual(lifetimes.filter(buffer => !buffer.destroyed), []);
      assert.equal(await page.evaluate(() => window.metrics.destroyedBuffers), resources.buffers);
      const final = await page.evaluate(() => window.metrics.submissions);
      await page.waitForTimeout(200);
      assert.equal(await page.evaluate(() => window.metrics.submissions), final);
      assert.deepEqual(errors, []);
      assert(compilerResolutions > 0, 'Vite must load the candidate compiler');
      console.log(JSON.stringify({ compiler, width, motionPixels, failurePixels, errors, output,
        metrics: await page.evaluate(() => window.metrics) }));
    } finally { await context.close(); }
  }
} finally { await browser?.close(); await server.close(); hooks.deregister(); }
