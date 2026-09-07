import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
const require = process.env.SVELTE_PROBE_BROWSER_DEPENDENCIES
  ? createRequire(resolve(process.env.SVELTE_PROBE_BROWSER_DEPENDENCIES, 'package.json')) : createRequire(import.meta.url);
const { chromium } = require('playwright'), { PNG } = require('pngjs');
const output = process.env.SVELTE_PROBE_OUTPUT ?? '/tmp/typegpu-occlusion-docs'; await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true, executablePath: process.env.SVELTE_PROBE_CHROMIUM,
  args: ['--enable-unsafe-webgpu', '--use-angle=metal'] });
try {
  const page = await browser.newPage(); page.setDefaultTimeout(60000);
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.addInitScript(() => {
    window.gpuErrors = [];
    const request = GPUAdapter.prototype.requestDevice;
    GPUAdapter.prototype.requestDevice = async function (...args) {
      const device = await request.apply(this, args);
      device.addEventListener('uncapturederror', e => window.gpuErrors.push(e.error.message)); return device;
    };
  });
  for (const width of [1440,390]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.goto(`${process.env.SVELTE_PROBE_BASE_URL ?? 'http://127.0.0.1:3335'}/examples/occlusion`, { waitUntil: 'networkidle' });
    const example = page.locator('.occlusion-example'), canvas = example.locator('canvas');
    await canvas.waitFor(); await canvas.scrollIntoViewIfNeeded();
    await example.locator('[data-metric="occlusion"]').getByText('active', { exact: true }).waitFor();
    await example.locator('[data-gpu-metric="GPU passes"]').getByText(/\d+\.\d+ ms/).waitFor();
    assert(Number.parseFloat(await example.locator('[data-gpu-metric="Hi-Z depth"]').innerText()) > 0);
    const image = PNG.sync.read(await canvas.screenshot({ path: resolve(output, `${width}-canvas.png`) }));
    let colored = 0;
    for (let i = 0; i < image.data.length; i += 4) if (Math.max(image.data[i], image.data[i+1], image.data[i+2]) > 90) colored++;
    assert(colored > image.width * image.height * 0.1, 'Canvas contains a framed 3D scene');
    await example.getByRole('checkbox', { name: 'Walls', exact: true }).uncheck();
    await example.locator('[data-metric="occlusion"]').getByText('no-occluders', { exact: true }).waitFor();
    await example.getByRole('checkbox', { name: 'Walls', exact: true }).check();
    await example.getByRole('checkbox', { name: 'Camera sweep', exact: true }).check();
    await page.waitForTimeout(700);
    const moving = PNG.sync.read(await canvas.screenshot());
    assert(moving.data.some((value, i) => Math.abs(value - image.data[i]) > 8), 'Sweep changes the scene pixels');
    await example.getByRole('checkbox', { name: 'Camera sweep', exact: true }).uncheck();
    const rect = await canvas.boundingBox();
    await page.mouse.move(rect.x + rect.width / 2, rect.y + rect.height / 2); await page.mouse.down();
    await page.mouse.move(rect.x + rect.width / 2 + 40, rect.y + rect.height / 2, { steps: 8 }); await page.mouse.up();
    await example.getByRole('checkbox', { name: 'Hi-Z occlusion', exact: true }).uncheck();
    await example.locator('[data-metric="occlusion"]').getByText('disabled', { exact: true }).waitFor();
    await example.locator('[data-gpu-metric="Hi-Z depth"]').getByText('0.00 ms', { exact: true }).waitFor();
    await example.screenshot({ path: resolve(output, `${width}-controls.png`) });
    assert.deepEqual(await page.evaluate(() => window.gpuErrors), []);
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'No horizontal page overflow');
    console.log(JSON.stringify({ width, colored, errors }));
  }
  assert.deepEqual(errors, []);
} finally { await browser.close(); }
