import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

const require = process.env.SVELTE_PROBE_BROWSER_DEPENDENCIES
  ? createRequire(resolve(process.env.SVELTE_PROBE_BROWSER_DEPENDENCIES, 'package.json')) : createRequire(import.meta.url);
const { chromium } = require('playwright'), { PNG } = require('pngjs');
const output = process.env.SVELTE_PROBE_OUTPUT ?? '/tmp/typegpu-asset-world';
const url = process.env.SVELTE_PROBE_URL ?? 'http://127.0.0.1:3335/examples/asset-world';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true, executablePath: process.env.SVELTE_PROBE_CHROMIUM,
  args: ['--enable-unsafe-webgpu', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
try {
  for (const width of [1440, 390]) {
    const context = await browser.newContext({ viewport: { width, height: 1000 } });
    try {
      const page = await context.newPage(), errors = [], requests = [];
      page.on('pageerror', error => errors.push(error.message));
      page.on('request', request => { if (request.url().endsWith('.glb')) requests.push(request.url()); });
      await page.addInitScript(() => {
        window.metrics = { buffers: 0, groups: 0, pipelines: 0, submissions: 0, callbacks: 0, writes: 0, gpuErrors: [] };
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
            const submit = device.queue.submit.bind(device.queue), write = device.queue.writeBuffer.bind(device.queue);
            device.queue.submit = (...args) => { window.metrics.submissions++; return submit(...args); };
            device.queue.writeBuffer = (...args) => { window.metrics.writes++; return write(...args); };
            return device;
          }; return adapter;
        };
      });
      await page.goto(url, { waitUntil: 'networkidle' });
      await page.getByText('9 GLB assets loaded', { exact: true }).waitFor({ timeout: 30000 });
      await page.locator('canvas[data-typegpu-status="ready"]').waitFor({ timeout: 30000 });
      const world = page.locator('.asset-world'), canvas = world.locator('canvas');
      await canvas.scrollIntoViewIfNeeded();
      const metrics = () => page.evaluate(() => structuredClone(window.metrics));
      const idle = () => page.waitForFunction(() => window.pending.size === 0, null, { polling: 50 });
      await page.waitForFunction(() => window.metrics.callbacks > 15, null, { polling: 50 });
      const before = await metrics();
      await page.waitForTimeout(1100);
      const moving = await metrics();
      await world.screenshot({ path: resolve(output, `${width}-initial.png`) });
      assert(moving.submissions - before.submissions > 15, 'Canoe delivers continuous frames');
      // One shadow submission and one color submission per rendered frame.
      assert((moving.submissions - before.submissions) / 2 >= (moving.callbacks - before.callbacks) * 0.9, 'No half-rate rendering');
      assert.equal(moving.buffers, before.buffers); assert.equal(moving.groups, before.groups);
      assert.equal(moving.pipelines, before.pipelines);
      await world.getByRole('checkbox', { name: 'Pause motion', exact: true }).check();
      await idle();
      const settled = await metrics(); await page.waitForTimeout(300);
      assert.equal((await metrics()).submissions, settled.submissions, 'Paused world idles');
      const day = PNG.sync.read(await canvas.screenshot());
      const colors = new Set();
      for (let i = 0; i < day.data.length; i += 16) colors.add(day.data.subarray(i, i + 3).toString('hex'));
      assert(colors.size > 100, 'Canvas contains a rendered world');
      await world.screenshot({ path: resolve(output, `${width}-day.png`) });
      await world.getByRole('combobox', { name: 'Selected', exact: true }).selectOption('canoe'); await idle();
      await world.getByRole('checkbox', { name: 'Dusk', exact: true }).check(); await idle();
      const dusk = PNG.sync.read(await canvas.screenshot());
      let changed = 0;
      for (let i = 0; i < day.data.length; i += 4) if (Math.abs(day.data[i] - dusk.data[i]) > 15) changed++;
      assert(changed > day.width * day.height * 0.2, 'Dusk visibly changes the scene');
      await world.screenshot({ path: resolve(output, `${width}-dusk.png`) });
      await world.getByRole('checkbox', { name: 'Forest', exact: true }).uncheck(); await idle();
      await world.getByRole('checkbox', { name: 'Forest', exact: true }).check(); await idle();
      await world.getByRole('button', { name: 'Reset view', exact: true }).click(); await idle();
      await world.getByRole('combobox', { name: 'Selected', exact: true }).selectOption(''); await idle();
      const rect = await canvas.boundingBox();
      // The canoe is near the foreground river center in the reset camera view.
      await canvas.click({ position: { x: rect.width * 0.53, y: rect.height * 0.58 } }); await idle();
      assert.equal(await world.getByRole('combobox', { name: 'Selected', exact: true }).inputValue(), 'canoe');
      assert.equal(requests.length, 9, 'Controls reuse loaded models');
      assert.deepEqual(errors, []); assert.deepEqual((await metrics()).gpuErrors, []);
      assert(await world.evaluate(element => element.scrollWidth <= element.clientWidth), 'Controls fit at this width');
      console.log(JSON.stringify({ width, colors: colors.size, changed, renderedFrames: (moving.submissions - before.submissions) / 2,
        callbacks: moving.callbacks - before.callbacks, resources: settled, requests: requests.length }));
    } finally { await context.close(); }
  }
  const context = await browser.newContext({ viewport: { width: 1000, height: 900 }, reducedMotion: 'reduce' });
  try {
    const page = await context.newPage(), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/canoe.glb', route => route.fulfill({ status: 503, body: 'Unavailable' }));
    await page.goto(url, { waitUntil: 'networkidle' });
    await page.getByText('Asset loading failed', { exact: true }).waitFor();
    const canvas = await page.locator('.asset-world canvas').elementHandle();
    await page.unroute('**/canoe.glb');
    await page.getByRole('button', { name: 'Retry assets', exact: true }).click();
    await page.getByText('9 GLB assets loaded', { exact: true }).waitFor();
    await page.locator('canvas[data-typegpu-status="ready"]').waitFor();
    assert(await canvas.evaluate(node => node === document.querySelector('.asset-world canvas')), 'Retry retains canvas');
    assert(await page.getByRole('checkbox', { name: 'Reduced motion', exact: true }).isDisabled());
    await page.getByText('Idle', { exact: true }).waitFor();
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.getByRole('checkbox', { name: 'Pause motion', exact: true }).check();
    await page.getByText('Idle', { exact: true }).waitFor();
    assert.deepEqual(errors, []);
    console.log('Asset failure/retry, retained canvas and reduced-motion checks passed');
  } finally { await context.close(); }
} finally { await browser.close(); }
