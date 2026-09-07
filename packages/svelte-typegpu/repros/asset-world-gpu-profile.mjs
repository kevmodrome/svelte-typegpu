import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

const require = process.env.SVELTE_PROBE_BROWSER_DEPENDENCIES
  ? createRequire(resolve(process.env.SVELTE_PROBE_BROWSER_DEPENDENCIES, 'package.json')) : createRequire(import.meta.url);
const { chromium } = require('playwright');
const { PNG } = require('pngjs');
const cullingSweep = process.env.SVELTE_PROBE_CULLING === '1';
const lodSweep = process.env.SVELTE_PROBE_LOD === '1';
const distantSweep = process.env.SVELTE_PROBE_DISTANT === '1';
const views = process.env.SVELTE_PROBE_VIEW ? [process.env.SVELTE_PROBE_VIEW] : ['World overview', 'Follow camper'];
assert(views.every(view => ['World overview', 'Follow camper'].includes(view)), 'Unknown probe camera view');
const width = Number(process.env.SVELTE_PROBE_WIDTH ?? 1440);
const output = process.env.SVELTE_PROBE_OUTPUT ?? '/tmp/typegpu-asset-world-gpu';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true, executablePath: process.env.SVELTE_PROBE_CHROMIUM,
  args: ['--enable-unsafe-webgpu', '--use-angle=metal'] });
const results = [];
try {
  const page = await browser.newPage({ viewport: { width, height: 1000 } });
  page.setDefaultTimeout(120000);
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => {
    const state = window.gpuProfile = { adapter: null, frames: [], callbacks: [], gpu: [], errors: [], tinyScissor: false, lastDraws: null,
      resources: { buffers: 0, groups: 0, pipelines: 0 } };
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
        for (const [method, metric] of [['createBuffer', 'buffers'], ['createBindGroup', 'groups'], ['createRenderPipeline', 'pipelines']]) {
          const original = device[method].bind(device);
          device[method] = (...args) => { state.resources[metric]++; return original(...args); };
        }
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
            const workload = { triangles: 0, nonindexedVertices: 0, indexedElements: 0, draws: 0, instances: 0 };
            for (const method of ['draw', 'drawIndexed']) {
              const draw = pass[method].bind(pass);
              pass[method] = (vertices, instances = 1, ...args) => {
                workload.triangles += vertices * instances / 3; workload.draws++; workload.instances += instances;
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
  const cases = distantSweep
    ? views.flatMap(view => [false, true, true, false].map(distant => ({ view, detail: 2, culling: true, lod: true, distant, tinyScissor: false })))
    : lodSweep
    ? views.flatMap(view => [false, true].flatMap(culling => [false, true].map(lod => ({ view, detail: 2, culling, lod, tinyScissor: false }))))
    : cullingSweep
    ? ['World overview', 'Follow camper'].flatMap(view => [0, 2].flatMap(detail => [false, true].map(culling => ({ view, detail, culling, tinyScissor: false }))))
    : [[0, false], [1, false], [2, false], [2, true]].map(([detail, tinyScissor]) => ({ view: 'World overview', detail, tinyScissor, culling: false }));
  for (const { detail, tinyScissor, view, culling, lod = false, distant = false } of cases) {
    await world.getByRole('combobox', { name: 'Triangle density' }).selectOption(String(detail));
    if (cullingSweep || lodSweep || distantSweep) {
      await world.getByRole('button', { name: view, exact: true }).click();
      await world.getByRole('checkbox', { name: 'Frustum culling', exact: true }).setChecked(culling);
      await world.getByRole('checkbox', { name: 'LOD', exact: true }).setChecked(lod);
      if (distantSweep) await world.getByRole('checkbox', { name: 'Distant meshes', exact: true }).setChecked(distant);
    }
    if (distantSweep) {
      await page.waitForTimeout(1000);
      // Give both families the same camera history; LOD intentionally retains hysteresis.
      await world.getByRole('button', { name: view === 'World overview' ? 'Follow camper' : 'World overview', exact: true }).click();
      await page.waitForTimeout(300);
      await world.getByRole('button', { name: view, exact: true }).click();
    }
    await page.evaluate(tiny => window.gpuProfile.tinyScissor = tiny, tinyScissor);
    await page.waitForTimeout(2000);
    const resources = await page.evaluate(() => ({ ...window.gpuProfile.resources }));
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
        workload: p.lastDraws, resources: p.resources,
        metrics: Object.fromEntries([...document.querySelectorAll('[data-metric]')].map(element => [element.dataset.metric, element.textContent])), errors: p.errors };
    }, start);
    results.push({ detail, tinyScissor, view, culling, lod, distant, ...result }); console.log(JSON.stringify(results.at(-1)));
    await writeFile(resolve(output, 'results.json'), JSON.stringify(results, null, 2));
    if (cullingSweep || lodSweep || distantSweep) await world.screenshot({ path: resolve(output, `${width}-${view.replaceAll(' ', '-')}-${detail}-${culling ? 'culled' : 'raw'}${lod ? '-lod' : ''}${distant ? '-distant' : ''}.png`) });
    assert(result.samples > 5); assert.deepEqual(result.errors, []);
    assert.deepEqual(result.resources, resources, 'Steady frames reuse GPU resources');
    assert(Math.abs(result.frames - result.callbacks) <= 2, 'Renderer delivers browser callbacks without alternate-frame skips');
    if (cullingSweep || lodSweep || distantSweep) {
      assert.equal(Number(result.metrics.triangles.replaceAll(',', '')), result.workload.triangles);
      assert.equal(Number(result.metrics.instances.replaceAll(',', '')), result.workload.instances);
      assert.equal(Number(result.metrics.draws), result.workload.draws);
      if (culling || view === 'World overview') assert.equal(Number(result.metrics['lod-fallbacks']), 0, 'Visible world LOD stays within its draw-range budget');
      if (lod) assert(Number(result.metrics['lod-instances'].replaceAll(',', '')) > 0, 'Visible geometry uses lower levels');
    }
  }
  if (distantSweep) {
    for (const view of views) {
      const baseline = results.find(r => r.view === view && !r.distant), reduced = results.find(r => r.view === view && r.distant);
      assert(reduced.workload.triangles < baseline.workload.triangles, 'Distant levels reduce original visible geometry');
      assert.equal(reduced.workload.instances, baseline.workload.instances, 'Distant levels retain canonical membership');
    }
    await world.getByRole('checkbox', { name: 'Pause motion' }).check();
    for (const view of views) {
      await world.getByRole('button', { name: view, exact: true }).click();
      const images = [];
      for (const distant of [false, true]) {
        await world.getByRole('checkbox', { name: 'Distant meshes', exact: true }).setChecked(distant);
        await page.waitForTimeout(700);
        await world.getByRole('button', { name: view === 'World overview' ? 'Follow camper' : 'World overview', exact: true }).click();
        await page.waitForTimeout(300);
        await world.getByRole('button', { name: view, exact: true }).click();
        await page.waitForTimeout(1000);
        images.push(PNG.sync.read(await canvas.screenshot({ path: resolve(output, `${width}-${view.replaceAll(' ', '-')}-distant-frozen-${distant}.png`) })));
      }
      const [base, reduced] = images;
      let changed = 0, colored = 0;
      for (let i = 0; i < base.data.length; i += 4) {
        if (Math.max(...[0, 1, 2].map(c => Math.abs(base.data[i + c] - reduced.data[i + c]))) > 10) changed++;
        if (Math.abs(reduced.data[i] - reduced.data[i + 1]) > 20) colored++;
      }
      const changedFraction = changed / (base.width * base.height);
      console.log(JSON.stringify({ view, width, changedFraction, coloredPixels: colored }));
      assert(colored > 100, 'Reduced canvas is nonblank');
      assert(changedFraction < 0.04, 'Distant approximation remains visually bounded');
    }
    assert(await world.evaluate(el => el.scrollWidth <= el.clientWidth), 'Controls do not overflow');
  } else if (lodSweep) {
    for (const view of views) for (const culling of [false, true]) {
      const raw = results.find(r => r.view === view && r.culling === culling && !r.lod);
      const lod = results.find(r => r.view === view && r.culling === culling && r.lod);
      // Behind-camera/near-plane clusters retain high detail; LOD does not replace frustum rejection.
      const ratio = view === 'World overview' ? 0.5 : 1;
      assert(lod.workload.triangles < raw.workload.triangles * ratio, 'LOD reduces dense geometry in the applicable view');
      assert.equal(lod.workload.instances, raw.workload.instances, 'LOD preserves submitted instance membership');
      assert.equal(Number(lod.metrics['lod-saved'].replaceAll(',', '')), raw.workload.triangles - lod.workload.triangles);
    }
    await world.getByRole('checkbox', { name: 'Pause motion' }).check();
    await world.getByRole('checkbox', { name: 'Frustum culling', exact: true }).check();
    for (const view of views) {
      await world.getByRole('button', { name: view, exact: true }).click();
      const images = [];
      for (const lod of [false, true]) {
        await world.getByRole('checkbox', { name: 'LOD', exact: true }).setChecked(lod);
        await page.waitForTimeout(1000);
        images.push(PNG.sync.read(await canvas.screenshot({ path: resolve(output, `${width}-${view.replaceAll(' ', '-')}-lod-frozen-${lod}.png`) })));
      }
      const [raw, lod] = images; assert.equal(raw.data.length, lod.data.length);
      let changed = 0, colored = 0;
      for (let i = 0; i < raw.data.length; i += 4) {
        if (Math.max(...[0, 1, 2].map(c => Math.abs(raw.data[i + c] - lod.data[i + c]))) > 10) changed++;
        if (Math.abs(raw.data[i] - raw.data[i + 1]) > 20) colored++;
      }
      const changedFraction = changed / (raw.width * raw.height);
      console.log(JSON.stringify({ view, width, changedFraction, coloredPixels: colored }));
      assert(colored > 100, 'Canvas contains rendered scene pixels');
      assert(changedFraction < 0.005, 'Flat-subdivision LOD preserves the authored shape and appearance');
    }
  } else if (cullingSweep) {
    for (const detail of [0, 2]) {
      const raw = results.find(r => r.view === 'Follow camper' && r.detail === detail && !r.culling);
      const culled = results.find(r => r.view === 'Follow camper' && r.detail === detail && r.culling);
      assert(culled.workload.triangles < raw.workload.triangles * 0.5, 'Follow view removes most out-of-view geometry');
    }
    await world.getByRole('checkbox', { name: 'Pause motion' }).check();
    await world.getByRole('combobox', { name: 'Triangle density' }).selectOption('0');
    for (const view of ['World overview', 'Follow camper']) {
      await world.getByRole('button', { name: view, exact: true }).click();
      const images = [];
      for (const culling of [false, true]) {
        await world.getByRole('checkbox', { name: 'Frustum culling', exact: true }).setChecked(culling);
        await page.waitForTimeout(700);
        images.push(PNG.sync.read(await canvas.screenshot({ path: resolve(output, `${width}-${view.replaceAll(' ', '-')}-frozen-${culling}.png`) })));
      }
      const [raw, culled] = images; assert.equal(raw.data.length, culled.data.length);
      let changed = 0, colored = 0;
      for (let i = 0; i < raw.data.length; i += 4) {
        if (Math.max(...[0, 1, 2].map(c => Math.abs(raw.data[i + c] - culled.data[i + c]))) > 10) changed++;
        if (Math.abs(raw.data[i] - raw.data[i + 1]) > 20) colored++;
      }
      const changedFraction = changed / (raw.width * raw.height);
      console.log(JSON.stringify({ view, width, changedFraction, coloredPixels: colored }));
      assert(colored > 100, 'Canvas contains rendered scene pixels');
      assert(changedFraction < 0.005, 'Culling preserves the rendered view');
    }
  }
  assert.deepEqual(errors, []);
  await world.getByRole('checkbox', { name: 'Pause motion' }).check();
  await writeFile(resolve(output, 'results.json'), JSON.stringify(results, null, 2));
} finally { await browser.close(); }
