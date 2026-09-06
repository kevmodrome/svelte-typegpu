import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

const require = process.env.SVELTE_PROBE_BROWSER_DEPENDENCIES
  ? createRequire(resolve(process.env.SVELTE_PROBE_BROWSER_DEPENDENCIES, 'package.json')) : createRequire(import.meta.url);
const { chromium } = require('playwright');
const output = process.env.SVELTE_PROBE_OUTPUT ?? '/tmp/typegpu-asset-world-gpu';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true, executablePath: process.env.SVELTE_PROBE_CHROMIUM,
  args: ['--enable-unsafe-webgpu', '--use-angle=metal'] });
const results = [];
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.setDefaultTimeout(120000);
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => {
    const state = window.gpuProfile = { adapter: null, frames: [], callbacks: [], gpu: [], errors: [], tinyScissor: false, lastDraws: null };
    const raf = requestAnimationFrame.bind(window);
    window.requestAnimationFrame = callback => raf(timestamp => {
      const start = performance.now(); callback(timestamp);
      state.callbacks.push({ timestamp, cpu: performance.now() - start });
      if (state.callbacks.length > 2000) state.callbacks.shift();
    });
    const requestAdapter = navigator.gpu.requestAdapter.bind(navigator.gpu);
    navigator.gpu.requestAdapter = async (...args) => {
      const adapter = await requestAdapter(...args);
      if (!adapter || adapter.info.isFallbackAdapter || adapter.info.vendor !== 'apple') throw new Error('This diagnostic requires the real Apple GPU');
      state.adapter = { vendor: adapter.info.vendor, architecture: adapter.info.architecture, description: adapter.info.description };
      if (!adapter.features.has('timestamp-query')) throw new Error('GPU timestamps unavailable');
      const requestDevice = adapter.requestDevice.bind(adapter);
      adapter.requestDevice = async (descriptor = {}) => {
        const device = await requestDevice({ ...descriptor, requiredFeatures: [...new Set([...(descriptor.requiredFeatures ?? []), 'timestamp-query'])] });
        device.addEventListener('uncapturederror', event => state.errors.push(event.error.message));
        const slots = Array.from({ length: 4 }, () => ({
          query: device.createQuerySet({ type: 'timestamp', count: 2 }),
          resolve: device.createBuffer({ size: 16, usage: GPUBufferUsage.QUERY_RESOLVE | GPUBufferUsage.COPY_SRC }),
          read: device.createBuffer({ size: 16, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ }),
          status: 'free', timestamp: 0, workload: null
        }));
        const encode = device.createCommandEncoder.bind(device), submit = device.queue.submit.bind(device.queue);
        device.createCommandEncoder = (...args) => {
          const encoder = encode(...args), begin = encoder.beginRenderPass.bind(encoder);
          encoder.beginRenderPass = descriptor => {
            if (![...descriptor.colorAttachments].some(Boolean)) return begin(descriptor);
            const slot = slots.find(slot => slot.status === 'free');
            if (slot) { slot.status = 'encoding'; slot.timestamp = performance.now(); }
            const pass = begin(slot ? { ...descriptor, timestampWrites: { querySet: slot.query, beginningOfPassWriteIndex: 0, endOfPassWriteIndex: 1 } } : descriptor);
            if (state.tinyScissor) pass.setScissorRect(0, 0, 1, 1);
            const workload = { triangles: 0, nonindexedVertices: 0, indexedElements: 0, draws: 0 };
            for (const method of ['draw', 'drawIndexed']) {
              const draw = pass[method].bind(pass);
              pass[method] = (vertices, instances = 1, ...args) => {
                workload.triangles += vertices * instances / 3; workload.draws++;
                workload[method === 'draw' ? 'nonindexedVertices' : 'indexedElements'] += vertices * instances;
                return draw(vertices, instances, ...args);
              };
            }
            const end = pass.end.bind(pass);
            pass.end = () => {
              end(); state.frames.push(performance.now()); state.lastDraws = workload;
              if (state.frames.length > 2000) state.frames.shift();
              if (!slot) return;
              slot.workload = workload;
              encoder.resolveQuerySet(slot.query, 0, 2, slot.resolve, 0);
              encoder.copyBufferToBuffer(slot.resolve, 0, slot.read, 0, 16); slot.status = 'encoded';
            };
            return pass;
          };
          return encoder;
        };
        device.queue.submit = (...args) => {
          submit(...args);
          for (const slot of slots) if (slot.status === 'encoded') {
            slot.status = 'mapping';
            slot.read.mapAsync(GPUMapMode.READ).then(() => {
              const values = new BigUint64Array(slot.read.getMappedRange());
              state.gpu.push({ timestamp: slot.timestamp, ms: Number(values[1] - values[0]) / 1e6, ...slot.workload });
              if (state.gpu.length > 2000) state.gpu.shift();
              slot.read.unmap(); slot.status = 'free';
            }).catch(error => { state.errors.push(error.message); slot.status = 'failed'; });
          }
        };
        return device;
      };
      return adapter;
    };
  });
  await page.goto(process.env.SVELTE_PROBE_URL ?? 'http://127.0.0.1:3335/examples/asset-world', { waitUntil: 'networkidle' });
  await page.getByText('9 GLB assets loaded', { exact: true }).waitFor();
  const world = page.locator('.asset-world'), canvas = world.locator('canvas');
  await canvas.scrollIntoViewIfNeeded();
  await world.getByRole('combobox', { name: 'Model count' }).selectOption('50000');
  await page.waitForFunction(() => document.querySelector('[data-metric="models"]')?.textContent === '50,000');
  for (const [detail, tinyScissor] of [[0, false], [1, false], [2, false], [2, true]]) {
    await world.getByRole('combobox', { name: 'Triangle density' }).selectOption(String(detail));
    await page.evaluate(tiny => window.gpuProfile.tinyScissor = tiny, tinyScissor);
    await page.waitForTimeout(2000);
    const start = await page.evaluate(() => performance.now());
    await page.waitForTimeout(4000);
    const result = await page.evaluate(start => {
      const p = window.gpuProfile, end = performance.now();
      const gpu = p.gpu.filter(sample => sample.timestamp >= start && sample.timestamp <= end);
      const callbacks = p.callbacks.filter(sample => sample.timestamp >= start && sample.timestamp <= end);
      const frames = p.frames.filter(time => time >= start && time <= end);
      const average = values => values.reduce((a, b) => a + b, 0) / Math.max(1, values.length);
      return { adapter: p.adapter, samples: gpu.length, elapsed: end - start, frames: frames.length, callbacks: callbacks.length,
        fps: frames.length * 1000 / (end - start), gpuMs: average(gpu.map(s => s.ms)), gpuMaxMs: Math.max(...gpu.map(s => s.ms)),
        callbackCpuMs: average(callbacks.map(s => s.cpu)), callbackMaxCpuMs: Math.max(...callbacks.map(s => s.cpu)),
        canvas: { width: document.querySelector('.asset-world canvas').width, height: document.querySelector('.asset-world canvas').height },
        workload: p.lastDraws, errors: p.errors };
    }, start);
    assert(result.samples > 5); assert.deepEqual(result.errors, []);
    results.push({ detail, tinyScissor, ...result }); console.log(JSON.stringify(results.at(-1)));
  }
  assert.deepEqual(errors, []);
  await world.getByRole('checkbox', { name: 'Pause motion' }).check();
  await writeFile(resolve(output, 'results.json'), JSON.stringify(results, null, 2));
} finally { await browser.close(); }
