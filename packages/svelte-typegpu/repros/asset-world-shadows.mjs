import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
const require = process.env.SVELTE_PROBE_BROWSER_DEPENDENCIES
  ? createRequire(resolve(process.env.SVELTE_PROBE_BROWSER_DEPENDENCIES, 'package.json')) : createRequire(import.meta.url);
const { chromium } = require('playwright');
const output = process.env.SVELTE_PROBE_OUTPUT ?? '/tmp/typegpu-shadow-profile';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true,
  executablePath: process.env.SVELTE_PROBE_CHROMIUM,
  args: ['--enable-unsafe-webgpu', '--use-angle=metal'] });
const results = [];
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
  page.setDefaultTimeout(120000);
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => {
    const p = window.shadowDiag = { frames: [], callbacks: [], bounds: [], lastScene: 0, shadow: [], errors: [] };
    const raf = requestAnimationFrame.bind(window);
    window.requestAnimationFrame = callback => raf(time => {
      const start = performance.now(); callback(time); p.callbacks.push({ time, cpu: performance.now() - start });
      if (p.callbacks.length > 2000) p.callbacks.shift();
    });
    const adapter = navigator.gpu.requestAdapter.bind(navigator.gpu);
    navigator.gpu.requestAdapter = async (...args) => {
      const a = await adapter(...args);
      if (!a || a.info.isFallbackAdapter) throw new Error('Real GPU unavailable');
      const request = a.requestDevice.bind(a);
      a.requestDevice = async (...args) => {
        const device = await request(...args), write = device.queue.writeBuffer.bind(device.queue);
        device.addEventListener('uncapturederror', event => p.errors.push(event.error.message));
        device.queue.writeBuffer = (buffer, offset, data, ...args) => {
          if (buffer.label === 'TypeGPU scene uniforms') {
            p.lastScene = performance.now(); p.frames.push(p.lastScene); if (p.frames.length > 2000) p.frames.shift();
          }
          if (buffer.label === 'TypeGPU shadow uniforms') {
            p.bounds.push({ time: p.lastScene, ms: performance.now() - p.lastScene });
            if (p.bounds.length > 2000) p.bounds.shift();
            p.shadow = [...new Float32Array(ArrayBuffer.isView(data) ? data.buffer : data,
              ArrayBuffer.isView(data) ? data.byteOffset : 0, 20)];
          }
          return write(buffer, offset, data, ...args);
        };
        return device;
      };
      return a;
    };
  });
  await page.goto(process.env.SVELTE_PROBE_URL ?? 'http://127.0.0.1:3337/examples/asset-world', { waitUntil: 'networkidle' });
  await page.getByText('9 GLB assets loaded', { exact: true }).waitFor();
  const world = page.locator('.asset-world');
  await world.getByRole('checkbox', { name: 'GPU timing', exact: true }).check();
  await world.getByRole('checkbox', { name: 'Frustum culling', exact: true }).check();
  await world.getByRole('checkbox', { name: 'LOD', exact: true }).check();
  await world.getByRole('checkbox', { name: 'Distant meshes', exact: true }).check();
  await world.getByRole('combobox', { name: 'Model count', exact: true }).selectOption('50000');
  await page.waitForFunction(() => document.querySelector('[data-metric="models"]')?.textContent === '50,000');
  await world.getByRole('button', { name: 'Follow camper', exact: true }).click();
  for (const detail of [0, 2]) for (const shadows of [false, true]) {
    await world.getByRole('combobox', { name: 'Triangle density', exact: true }).selectOption(String(detail));
    await world.getByRole('checkbox', { name: 'Shadows', exact: true }).setChecked(shadows);
    await page.waitForTimeout(2500);
    const start = await page.evaluate(() => performance.now());
    const gpu = [];
    for (let sample = 0; sample < 12; sample++) {
      await page.waitForTimeout(350);
      gpu.push(await world.locator('[data-gpu-metric]').evaluateAll(elements => Object.fromEntries(elements.map(el => [el.dataset.gpuMetric, parseFloat(el.textContent)]))));
    }
    const result = await page.evaluate(start => {
      const p = window.shadowDiag, end = performance.now(), frames = p.frames.filter(time => time >= start);
      const callbacks = p.callbacks.filter(s => s.time >= start), bounds = p.bounds.filter(s => s.time >= start);
      const average = a => a.reduce((s, n) => s + n, 0) / Math.max(1, a.length);
      const m = p.shadow;
      return { frames: frames.length, callbacks: callbacks.length, fps: frames.length * 1000 / (end - start),
        callbackCpuMs: average(callbacks.map(s => s.cpu)), shadowSetupMs: average(bounds.map(s => s.ms)),
        shadowWorldUnitsPerTexel: m[17] ? 2 / Math.hypot(m[0], m[4], m[8]) / m[18] : null,
        metrics: Object.fromEntries([...document.querySelectorAll('.world-metrics > div')].map(el => [el.querySelector('dt').textContent, el.querySelector('dd').textContent])),
        errors: p.errors };
    }, start);
    const row = { detail, shadows, ...result, gpu: Object.fromEntries(Object.keys(gpu[0]).map(key => [key, gpu.reduce((s, sample) => s + sample[key], 0) / gpu.length])) };
    results.push(row); console.log(JSON.stringify(row));
    await world.locator('canvas').screenshot({ path: `${output}/detail-${detail}-shadows-${shadows}.png` });
    assert.deepEqual(result.errors, []);
    if (shadows) {
      const number = key => Number(result.metrics[key].replaceAll(',', ''));
      assert.equal(number('Shadow fallbacks'), 0);
      assert(number('Shadow instances') > 0 && number('Shadow instances') < 10000);
      assert(number('Shadow triangles') < 5000000, 'Local shadow policy must not regress to full-world geometry');
    }
  }
  await world.getByRole('checkbox', { name: 'Pause motion', exact: true }).check();
  await page.waitForTimeout(300);
  assert.deepEqual(errors, []);
  await writeFile(`${output}/results.json`, JSON.stringify(results, null, 2));
} finally { await browser.close(); }
