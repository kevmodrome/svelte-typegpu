import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

const require = process.env.SVELTE_PROBE_BROWSER_DEPENDENCIES
  ? createRequire(resolve(process.env.SVELTE_PROBE_BROWSER_DEPENDENCIES, 'package.json')) : createRequire(import.meta.url);
const { chromium } = require('playwright');
const output = process.env.SVELTE_PROBE_OUTPUT ?? '/tmp/typegpu-asset-world-input';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true, executablePath: process.env.SVELTE_PROBE_CHROMIUM,
  args: ['--enable-unsafe-webgpu', '--use-angle=metal'] });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
  page.setDefaultTimeout(120000);
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => {
    window.inputProfile = { view: [], frames: 0, pending: new Set(), buffers: 0, groups: 0, pipelines: 0,
      instanceBytes: 0, callbackCpu: [], gpuErrors: [] };
    const p = window.inputProfile, raf = requestAnimationFrame.bind(window), cancel = cancelAnimationFrame.bind(window);
    window.requestAnimationFrame = callback => {
      const id = raf(time => {
        p.pending.delete(id); const start = performance.now(); callback(time);
        p.callbackCpu.push(performance.now() - start); if (p.callbackCpu.length > 2000) p.callbackCpu.shift();
      }); p.pending.add(id); return id;
    };
    window.cancelAnimationFrame = id => { p.pending.delete(id); cancel(id); };
    const requestAdapter = navigator.gpu.requestAdapter.bind(navigator.gpu);
    navigator.gpu.requestAdapter = async (...args) => {
      const adapter = await requestAdapter(...args), requestDevice = adapter.requestDevice.bind(adapter);
      adapter.requestDevice = async (...args) => {
        const device = await requestDevice(...args);
        device.addEventListener('uncapturederror', event => p.gpuErrors.push(event.error.message));
        for (const [method, metric] of [['createBuffer', 'buffers'], ['createBindGroup', 'groups'], ['createRenderPipeline', 'pipelines']]) {
          const original = device[method].bind(device);
          device[method] = (...args) => { p[metric]++; return original(...args); };
        }
        const write = device.queue.writeBuffer.bind(device.queue);
        device.queue.writeBuffer = (buffer, offset, data, ...args) => {
          if (buffer.label.endsWith('instances')) {
            const bytesPerElement = data.BYTES_PER_ELEMENT ?? 1;
            p.instanceBytes += args[1] === undefined ? data.byteLength - (args[0] ?? 0) * bytesPerElement : args[1] * bytesPerElement;
          }
          if (buffer.label === 'TypeGPU scene uniforms') {
            p.view = [...new Float32Array(ArrayBuffer.isView(data) ? data.buffer : data, ArrayBuffer.isView(data) ? data.byteOffset : 0, 16)]; p.frames++;
          }
          return write(buffer, offset, data, ...args);
        };
        return device;
      }; return adapter;
    };
  });
  await page.goto(process.env.SVELTE_PROBE_URL ?? 'http://127.0.0.1:3335/examples/asset-world', { waitUntil: 'networkidle' });
  await page.getByText('9 GLB assets loaded', { exact: true }).waitFor();
  const world = page.locator('.asset-world'), canvas = world.locator('canvas');
  const idle = () => page.waitForFunction(() => window.inputProfile.pending.size === 0, null, { polling: 50 });
  const lod = process.env.SVELTE_PROBE_LOD === '1';
  await world.getByRole('combobox', { name: 'Triangle density' }).selectOption(lod ? '2' : '0');
  if (lod) await world.getByRole('checkbox', { name: 'LOD', exact: true }).check();
  await world.getByRole('combobox', { name: 'Model count' }).selectOption('50000');
  await world.getByRole('button', { name: 'Follow camper' }).click();
  if (process.env.SVELTE_PROBE_CULLING === '1') await world.getByRole('checkbox', { name: 'Frustum culling', exact: true }).check();
  if (process.env.SVELTE_PROBE_OCCLUSION === '1') await world.getByRole('checkbox', { name: 'Hi-Z occlusion', exact: true }).check();
  if (process.env.SVELTE_PROBE_GPU_TIMING === '1') await world.getByRole('checkbox', { name: 'GPU timing', exact: true }).check();
  await page.waitForFunction(() => document.querySelector('[data-metric="models"]')?.textContent === '50,000');
  await idle(); await canvas.scrollIntoViewIfNeeded(); await canvas.focus();
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  const metrics = () => page.evaluate(() => structuredClone(window.inputProfile));
  const before = await metrics(), timings = [];
  for (let i = 0; i < 3; i++) {
    for (const type of ['keydown', 'keyup']) {
      const ms = await page.evaluate(async type => {
        const start = performance.now();
        document.querySelector('.asset-world canvas').dispatchEvent(new KeyboardEvent(type, { code: 'KeyW', key: 'w', bubbles: true, cancelable: true }));
        await new Promise(resolve => setTimeout(resolve, 0));
        return performance.now() - start;
      }, type);
      timings.push({ type, ms }); await page.waitForTimeout(200);
    }
  }
  await page.emulateMedia({ reducedMotion: 'reduce' }); await idle();
  await world.getByRole('button', { name: 'Reset camper', exact: true }).click(); await idle();
  await canvas.focus();
  const rect = await canvas.boundingBox();
  await page.mouse.move(rect.x + rect.width * 0.7, rect.y + rect.height * 0.5);
  await page.mouse.down(); await page.keyboard.down('w');
  await page.waitForTimeout(200);
  const initial = (await metrics()).view;
  await page.mouse.move(rect.x + rect.width * 0.7 + 45, rect.y + rect.height * 0.5, { steps: 10 });
  await page.waitForTimeout(250);
  const first = (await metrics()).view;
  await page.mouse.move(rect.x + rect.width * 0.7 + 90, rect.y + rect.height * 0.5, { steps: 10 });
  await page.waitForTimeout(250);
  const second = (await metrics()).view;
  await page.keyboard.up('w'); await page.mouse.up(); await idle();
  const after = await metrics();
  const distance = (a, b, indices) => indices.reduce((sum, i) => sum + Math.abs(a[i] - b[i]), 0);
  const orientation = [0, 1, 2, 4, 5, 6, 8, 9, 10];
  const result = { timings, occlusion: process.env.SVELTE_PROBE_OCCLUSION === '1' ? await world.locator('[data-metric="occlusion"]').textContent() : 'disabled',
    gpuPassMs: process.env.SVELTE_PROBE_GPU_TIMING === '1' ? Number.parseFloat(await world.locator('[data-gpu-metric="GPU passes"]').innerText()) : null,
    firstRotation: distance(initial, first, orientation), secondRotation: distance(first, second, orientation),
    translation: distance(initial, second, [12, 13, 14]), frames: after.frames - before.frames,
    instanceBytes: after.instanceBytes - before.instanceBytes,
    callbackCpuMean: after.callbackCpu.reduce((sum, ms) => sum + ms, 0) / after.callbackCpu.length };
  await world.screenshot({ path: resolve(output, 'move-and-orbit.png') });
  console.log(JSON.stringify(result)); await writeFile(resolve(output, 'results.json'), JSON.stringify(result, null, 2));
  if (!process.env.SVELTE_PROBE_EXPECT_BROKEN) {
    assert(result.firstRotation > 0.05 && result.secondRotation > 0.05, 'Both parts of the held orbit gesture rotate while walking');
    assert(result.translation > 0.05, 'Camera follows movement at the same time');
    // A generous guard against the old hundreds-of-ms scene rebuild, not a frame budget claim.
    assert(timings.every(value => value.ms < 100), 'Movement toggles do not rebuild the large scene');
  }
  for (const resource of ['buffers', 'groups', 'pipelines']) assert.equal(after[resource], before[resource]);
  if (process.env.SVELTE_PROBE_GPU_TIMING === '1') assert(result.gpuPassMs > 0, 'Declarative profiling delivers actual GPU timings');
  assert(result.instanceBytes < (result.frames + 50) * 13 * 96, 'Movement uploads only camper/canoe instances, not the forest');
  await page.waitForTimeout(200); assert.equal((await metrics()).frames, after.frames);
  assert.deepEqual(errors, []); assert.deepEqual(after.gpuErrors, []);
} finally { await browser.close(); }
