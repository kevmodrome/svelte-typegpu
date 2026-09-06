import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

const require = process.env.SVELTE_PROBE_BROWSER_DEPENDENCIES
  ? createRequire(resolve(process.env.SVELTE_PROBE_BROWSER_DEPENDENCIES, 'package.json')) : createRequire(import.meta.url);
const { chromium } = require('playwright'), { PNG } = require('pngjs');
const output = process.env.SVELTE_PROBE_OUTPUT ?? '/tmp/typegpu-asset-world-stress';
const url = process.env.SVELTE_PROBE_URL ?? 'http://127.0.0.1:3335/examples/asset-world';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true, executablePath: process.env.SVELTE_PROBE_CHROMIUM,
  args: ['--enable-unsafe-webgpu', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
try {
  for (const width of [1440, 390]) {
    const context = await browser.newContext({ viewport: { width, height: 1000 }, reducedMotion: 'reduce' });
    try {
      const page = await context.newPage(), errors = [], requests = [];
      page.setDefaultTimeout(120000);
      page.on('pageerror', error => errors.push(error.message));
      page.on('request', request => { if (request.url().endsWith('.glb')) requests.push(request.url()); });
      await page.addInitScript(() => {
        window.metrics = { buffers: 0, groups: 0, pipelines: 0, frames: 0, callbacks: 0, gpuErrors: [], last: null };
        window.pending = new Set();
        const raf = window.requestAnimationFrame.bind(window), cancel = window.cancelAnimationFrame.bind(window);
        window.requestAnimationFrame = callback => {
          const id = raf(time => { window.pending.delete(id); window.metrics.callbacks++; callback(time); });
          window.pending.add(id); return id;
        };
        window.cancelAnimationFrame = id => { window.pending.delete(id); cancel(id); };
        const requestAdapter = navigator.gpu.requestAdapter.bind(navigator.gpu);
        navigator.gpu.requestAdapter = async (...args) => {
          const adapter = await requestAdapter(...args), requestDevice = adapter.requestDevice.bind(adapter);
          adapter.requestDevice = async (...args) => {
            const device = await requestDevice(...args);
            device.addEventListener('uncapturederror', event => window.metrics.gpuErrors.push(event.error.message));
            for (const [method, metric] of [['createBuffer', 'buffers'], ['createBindGroup', 'groups'], ['createRenderPipeline', 'pipelines']]) {
              const original = device[method].bind(device);
              device[method] = (...args) => { window.metrics[metric]++; return original(...args); };
            }
            const createEncoder = device.createCommandEncoder.bind(device);
            device.createCommandEncoder = (...args) => {
              const encoder = createEncoder(...args), begin = encoder.beginRenderPass.bind(encoder);
              encoder.beginRenderPass = descriptor => {
                const pass = begin(descriptor);
                if ([...descriptor.colorAttachments].some(Boolean)) {
                  const workload = { triangles: 0, instances: 0, draws: 0 };
                  for (const method of ['draw', 'drawIndexed']) {
                    const original = pass[method].bind(pass);
                    pass[method] = (vertices, instances = 1, ...rest) => {
                      workload.triangles += vertices / 3 * instances; workload.instances += instances; workload.draws++;
                      return original(vertices, instances, ...rest);
                    };
                  }
                  const end = pass.end.bind(pass);
                  pass.end = () => { window.metrics.last = workload; window.metrics.frames++; return end(); };
                }
                return pass;
              };
              return encoder;
            };
            return device;
          };
          return adapter;
        };
      });
      const started = performance.now();
      await page.goto(url, { waitUntil: 'networkidle', timeout: 120000 });
      const world = page.locator('.asset-world'), canvas = world.locator('canvas');
      const metrics = () => page.evaluate(() => structuredClone(window.metrics));
      const idle = () => page.waitForFunction(() => window.pending.size === 0, null, { polling: 100 });
      const metric = name => world.locator(`[data-metric="${name}"]`).innerText().then(value => Number(value.replaceAll(',', '')));
      await page.getByText('9 GLB assets loaded', { exact: true }).waitFor();
      await page.waitForFunction(() => document.querySelector('[data-metric="models"]')?.textContent === '20,000');
      await idle(); await canvas.scrollIntoViewIfNeeded();
      const loadMs = performance.now() - started;
      async function checkWorkload() {
        const current = await metrics();
        assert.equal(current.last.triangles, await metric('triangles'), 'UI triangle count matches actual GPU draw calls');
        assert.equal(current.last.instances, await metric('instances'));
        assert.equal(current.last.draws, await metric('draws'));
        assert(current.last.draws < 100, 'Shared geometry remains instanced');
        return current.last;
      }
      const dense = await checkWorkload();
      await world.screenshot({ path: resolve(output, `${width}-overview.png`) });
      const png = PNG.sync.read(await canvas.screenshot()), colors = new Set();
      for (let i = 0; i < png.data.length; i += 16) colors.add(png.data.subarray(i, i + 3).toString('hex'));
      assert(colors.size > 100, 'Overview contains a rendered world');
      await world.getByRole('combobox', { name: 'Triangle density' }).selectOption('0');
      await page.waitForFunction(previous => window.metrics.last.triangles < previous, dense.triangles); await idle();
      const original = await checkWorkload();
      await world.getByRole('combobox', { name: 'Triangle density' }).selectOption('2');
      await page.waitForFunction(previous => window.metrics.last.triangles > previous, dense.triangles); await idle();
      const veryDense = await checkWorkload();
      assert.equal(veryDense.triangles - original.triangles, (dense.triangles - original.triangles) * 5);
      assert.equal(veryDense.instances, original.instances);
      await world.screenshot({ path: resolve(output, `${width}-16x.png`) });
      await world.getByRole('combobox', { name: 'Triangle density' }).selectOption('1');
      await page.waitForFunction(expected => window.metrics.last.triangles === expected, dense.triangles); await idle();
      await world.getByRole('button', { name: 'Follow camper', exact: true }).click(); await idle();
      await canvas.focus();
      const beforePixels = PNG.sync.read(await canvas.screenshot()), before = await metrics();
      const walkStart = performance.now();
      await page.keyboard.down('w'); await page.waitForTimeout(1800); await page.keyboard.up('w'); await idle();
      const elapsed = performance.now() - walkStart, after = await metrics();
      assert(after.frames - before.frames > 1, 'Large world moves continuously');
      assert(after.frames - before.frames >= (after.callbacks - before.callbacks) * 0.9, 'Renderer does not introduce half-rate delivery');
      for (const resource of ['buffers', 'groups', 'pipelines']) assert.equal(after[resource], before[resource], `Walking reuses ${resource}`);
      const afterPixels = PNG.sync.read(await canvas.screenshot());
      let changed = 0;
      for (let i = 0; i < beforePixels.data.length; i += 4) if (Math.abs(beforePixels.data[i] - afterPixels.data[i]) > 10) changed++;
      assert(changed > 100, 'Follow camera visibly moves through the world');
      await world.screenshot({ path: resolve(output, `${width}-follow.png`) });
      await page.waitForTimeout(300); assert.equal((await metrics()).frames, after.frames, 'Large world idles after walking');
      await world.getByRole('button', { name: 'Campsite view', exact: true }).click(); await idle();
      await world.screenshot({ path: resolve(output, `${width}-camp.png`) });
      if (width === 1440) {
        await world.getByRole('combobox', { name: 'Triangle density' }).selectOption('0');
        await page.waitForFunction(expected => window.metrics.last.triangles === expected, original.triangles); await idle();
        await world.getByRole('combobox', { name: 'Model count' }).selectOption('50000');
        await page.waitForFunction(() => document.querySelector('[data-metric="models"]')?.textContent === '50,000'); await idle();
        const larger = await checkWorkload();
        assert(larger.instances > 100000); assert.equal(larger.draws, original.draws);
        await world.getByRole('combobox', { name: 'Model count' }).selectOption('20000');
        await page.waitForFunction(() => document.querySelector('[data-metric="models"]')?.textContent === '20,000'); await idle();
        assert.deepEqual(await checkWorkload(), original, 'Shrinking restores the exact workload');
      }
      assert(await world.evaluate(node => node.scrollWidth <= node.clientWidth), 'Controls fit without horizontal overflow');
      const canvasRect = await canvas.boundingBox(); assert(canvasRect.height > 240, 'Scene retains usable vertical space');
      assert.equal(requests.length, 9, 'Count/detail controls reuse the nine loaded GLBs');
      assert.deepEqual(errors, []); assert.deepEqual((await metrics()).gpuErrors, []);
      console.log(JSON.stringify({ width, loadMs, original, dense, veryDense, changed,
        walking: { frames: after.frames - before.frames, callbacks: after.callbacks - before.callbacks, elapsedMs: elapsed }, resources: before }));
      await page.goto('about:blank');
    } finally { await context.close(); }
  }
} finally { await browser.close(); }
