# Mochi Docs Site Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a new `apps/docs` Mochi documentation site for `svelte-typegpu` with Overview, Quickstart, and Examples pages plus three live TypeGPU example previews.

**Architecture:** `apps/docs` is a separate pnpm workspace app. Mochi renders static docs content server-side and hydrates only the live WebGPU preview island. Mochi cannot apply Svelte compiler options per `.typegpu.svelte` file like the current Vite example app, so a Bun generator precompiles curated `.typegpu.svelte` scenes with `svelte-typegpu/svelte-renderer` into generated client modules and source-code strings.

**Tech Stack:** pnpm workspace, Bun runtime, Mochi `0.3.2`, Svelte PR preview, `svelte-typegpu`, TypeScript, Vitest.

---

## File Structure

- `apps/docs/package.json`: app scripts and dependencies.
- `apps/docs/tsconfig.json`: app, test, script, and generated declaration types.
- `apps/docs/svelte.config.js`: normal DOM Svelte compiler settings for Mochi.
- `apps/docs/src/index.ts`: Bun server entry calling `Mochi.serve`.
- `apps/docs/src/routes.ts`: programmatic Mochi routes.
- `apps/docs/src/app-source.test.ts`: source-level smoke tests.
- `apps/docs/src/examples/example-definitions.ts`: source of truth for example metadata and scene source files.
- `apps/docs/src/examples/registry.ts`: metadata plus generated code samples.
- `apps/docs/src/examples/registry.test.ts`: registry tests.
- `apps/docs/src/examples/scene-components.ts`: client-only slug-to-component map.
- `apps/docs/src/examples/**/**/*.typegpu.svelte`: three curated scene sources.
- `apps/docs/scripts/compile-typegpu-scenes.ts`: generator for compiled scene JS, declarations, and source-code samples.
- `apps/docs/src/generated/**`: generated artifacts committed so root Vitest can run without invoking Bun first.
- `apps/docs/src/components/*.svelte`: shell, nav, code panel, example workbench, and WebGPU preview island.
- `apps/docs/src/routes/*.svelte`: Overview, Quickstart, and Examples route components.
- `apps/docs/src/style.css`: responsive docs/workbench visual system.

## Preflight

- [ ] **Step 1: Check Bun**

Run:

```bash
command -v bun && bun --version
```

Expected: prints a Bun executable path and a version `>=1.3.13`.

If Bun is missing, install it before continuing:

```bash
curl -fsSL https://bun.sh/install | bash
exec "$SHELL" -l
bun --version
```

Expected: `bun --version` prints `1.3.13` or newer.

### Task 1: Docs Workspace Package

**Files:**
- Create: `apps/docs/package.json`
- Create: `apps/docs/tsconfig.json`
- Create: `apps/docs/svelte.config.js`

- [ ] **Step 1: Create package scaffolding**

Create `apps/docs/package.json`:

```json
{
  "name": "docs",
  "version": "0.0.1",
  "private": true,
  "type": "module",
  "scripts": {
    "generate:typegpu": "bun scripts/compile-typegpu-scenes.ts",
    "predev": "bun run generate:typegpu",
    "dev": "MODE=development bun src/index.ts",
    "prebuild": "bun run generate:typegpu",
    "build": "mochi-framework build --routes ./src/routes.ts",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "dependencies": {
    "mochi-framework": "^0.3.2",
    "svelte": "https://pkg.pr.new/svelte@18042",
    "svelte-typegpu": "workspace:*"
  },
  "devDependencies": {
    "@types/bun": "^1.3.14",
    "@types/node": "^24.10.1",
    "@webgpu/types": "^0.1.70",
    "typescript": "^5.9.3",
    "vitest": "^4.0.14"
  }
}
```

Create `apps/docs/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.json",
  "compilerOptions": {
    "types": ["bun", "node", "@webgpu/types"],
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "target": "ES2022",
    "strict": true,
    "verbatimModuleSyntax": true,
    "skipLibCheck": true
  },
  "include": ["scripts/**/*.ts", "src/**/*.ts", "src/**/*.svelte", "src/**/*.d.ts", "src/**/*.test.ts"]
}
```

Create `apps/docs/svelte.config.js`:

```js
export default {
  compilerOptions: {
    runes: true
  }
};
```

- [ ] **Step 2: Install dependencies**

Run:

```bash
pnpm install
```

Expected: exits `0` and updates `pnpm-lock.yaml`.

- [ ] **Step 3: Commit workspace package**

Run:

```bash
git add apps/docs/package.json apps/docs/tsconfig.json apps/docs/svelte.config.js pnpm-lock.yaml
git commit -m "feat: scaffold docs workspace"
```

### Task 2: Routes And Source-Level Tests

**Files:**
- Create: `apps/docs/src/app-source.test.ts`
- Create: `apps/docs/src/index.ts`
- Create: `apps/docs/src/routes.ts`

- [ ] **Step 1: Write failing source tests**

Create `apps/docs/src/app-source.test.ts`:

```ts
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');

describe('docs app source wiring', () => {
  it('defines the expected Mochi documentation routes', () => {
    const source = read('./routes.ts');

    expect(source).toContain("'/': Mochi.page('./src/routes/Overview.svelte'");
    expect(source).toContain("'/quickstart': Mochi.page('./src/routes/Quickstart.svelte'");
    expect(source).toContain("'/examples': Mochi.page('./src/routes/Examples.svelte'");
    expect(source).toContain("'/examples/:slug': Mochi.page('./src/routes/Examples.svelte'");
  });

  it('uses svelte-typegpu as the product name in the shell', () => {
    const source = read('./components/SiteShell.svelte');

    expect(source).toContain('svelte-typegpu');
    expect(source).toContain('<SiteNav');
  });

  it('keeps WebGPU preview failures local', () => {
    const source = read('./components/ExamplePreview.svelte');

    expect(source).toContain('createTypeGpuRoot');
    expect(source).toContain('WebGPU is not available');
    expect(source).toContain('Unable to start this preview');
  });

  it('renders code as text instead of HTML', () => {
    const source = read('./components/CodePanel.svelte');

    expect(source).toContain('{code}');
    expect(source).not.toContain('@html');
  });

  it('precompiles typegpu scenes with the custom renderer', () => {
    const source = read('../scripts/compile-typegpu-scenes.ts');

    expect(source).toContain("import { compile } from 'svelte/compiler'");
    expect(source).toContain("import.meta.resolve('svelte-typegpu/svelte-renderer')");
    expect(source).toContain('customRenderer: rendererPath');
    expect(source).toContain('exampleCode');
  });

  it('hydrates only the live example preview on the examples route', () => {
    const source = read('./routes/Examples.svelte');

    expect(source).toContain('<ExamplePreview');
    expect(source).toContain('mochi:hydrate');
    expect(source).toContain('<CodePanel');
  });

  it('defines stable preview and responsive example layouts', () => {
    const source = read('./style.css');

    expect(source).toContain('.preview-panel');
    expect(source).toContain('aspect-ratio: 16 / 10');
    expect(source).toContain('.preview-code-grid');
    expect(source).toContain('@media (max-width: 820px)');
  });
});
```

- [ ] **Step 2: Run test to verify failure**

Run:

```bash
pnpm --filter docs --fail-if-no-match test -- src/app-source.test.ts
```

Expected: FAIL because route, component, generator, and style files are not present.

- [ ] **Step 3: Create server entry and route table**

Create `apps/docs/src/index.ts`:

```ts
import { Mochi } from 'mochi-framework';
import { routes } from './routes';

const port = Number(Bun.env.PORT ?? 3333);
const development = Bun.env.MODE === 'development' || Bun.env.NODE_ENV !== 'production';

await Mochi.serve({
  hostname: '127.0.0.1',
  port,
  development,
  routes,
  svelteConfigPath: './svelte.config.js'
});

console.log(`svelte-typegpu docs listening on http://127.0.0.1:${port}`);
```

Create `apps/docs/src/routes.ts`:

```ts
import { Mochi, type MochiRouteValue } from 'mochi-framework';

export interface DocsPageProps {
  activePath: '/' | '/quickstart' | '/examples';
}

export interface ExamplesPageProps extends DocsPageProps {
  selectedSlug: string;
}

export const routes: Record<string, MochiRouteValue> = {
  '/': Mochi.page('./src/routes/Overview.svelte', {
    serverProps: { activePath: '/' } satisfies DocsPageProps
  }),
  '/quickstart': Mochi.page('./src/routes/Quickstart.svelte', {
    serverProps: { activePath: '/quickstart' } satisfies DocsPageProps
  }),
  '/examples': Mochi.page('./src/routes/Examples.svelte', {
    serverProps: { activePath: '/examples', selectedSlug: 'two-boxes' } satisfies ExamplesPageProps
  }),
  '/examples/:slug': Mochi.page('./src/routes/Examples.svelte', {
    serverProps: (_request, params) =>
      ({ activePath: '/examples', selectedSlug: params.slug }) satisfies ExamplesPageProps
  })
};
```

- [ ] **Step 4: Run test and keep expected component failures**

Run:

```bash
pnpm --filter docs --fail-if-no-match test -- src/app-source.test.ts
```

Expected: FAIL only for files created in later tasks.

- [ ] **Step 5: Commit routes**

Run:

```bash
git add apps/docs/src/index.ts apps/docs/src/routes.ts apps/docs/src/app-source.test.ts
git commit -m "feat: add mochi docs routes"
```

### Task 3: Example Sources And Registry

**Files:**
- Create: `apps/docs/src/examples/example-definitions.ts`
- Create: `apps/docs/src/examples/registry.test.ts`
- Create: `apps/docs/src/examples/registry.ts`
- Create: `apps/docs/src/examples/two-boxes/TwoBoxes.typegpu.svelte`
- Create: `apps/docs/src/examples/phong-reflection/PhongReflection.typegpu.svelte`
- Create: `apps/docs/src/examples/simple-shadow/SimpleShadow.typegpu.svelte`

- [ ] **Step 1: Write failing registry tests**

Create `apps/docs/src/examples/registry.test.ts`:

```ts
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { exampleDefinitions } from './example-definitions';
import { examples, getExampleBySlug } from './registry';

describe('docs example registry', () => {
  it('contains the curated TypeGPU adaptations in display order', () => {
    expect(examples.map((example) => example.slug)).toEqual(['two-boxes', 'phong-reflection', 'simple-shadow']);
  });

  it('keeps metadata complete for every example', () => {
    for (const example of examples) {
      expect(example.title).toMatch(/\S/);
      expect(example.description).toMatch(/\S/);
      expect(example.category).toMatch(/\S/);
      expect(example.tags.length).toBeGreaterThan(0);
      expect(example.typeGpuSourceUrl).toMatch(/^https:\/\/github\.com\/software-mansion\/TypeGPU/);
      expect(example.notes).toContain('adapted');
      expect(example.code).toContain('<scene');
    }
  });

  it('falls back to the first example for unknown slugs', () => {
    expect(getExampleBySlug('unknown').slug).toBe('two-boxes');
  });

  it('points every definition at a real typegpu scene source', () => {
    for (const definition of exampleDefinitions) {
      const source = readFileSync(definition.sourceUrl, 'utf8');

      expect(source).toContain('<scene');
      expect(source).toContain('<perspectiveCamera');
    }
  });
});
```

- [ ] **Step 2: Run test to verify failure**

Run:

```bash
pnpm --filter docs --fail-if-no-match test -- src/examples/registry.test.ts
```

Expected: FAIL because the example registry and generated code samples do not exist.

- [ ] **Step 3: Create example definitions**

Create `apps/docs/src/examples/example-definitions.ts`:

```ts
export const exampleDefinitions = [
  {
    slug: 'two-boxes',
    title: 'Two Boxes',
    category: 'rendering',
    tags: ['3d', 'rasterization', 'scene graph'],
    description: 'A compact scene that turns the imperative TypeGPU two-boxes setup into declarative Svelte scene markup.',
    typeGpuSourceUrl: 'https://github.com/software-mansion/TypeGPU/tree/main/apps/typegpu-docs/src/examples/rendering/two-boxes',
    notes: 'Adapted from the official TypeGPU Two Boxes example for the svelte-typegpu custom renderer.',
    exportName: 'TwoBoxes',
    sourceUrl: new URL('./two-boxes/TwoBoxes.typegpu.svelte', import.meta.url)
  },
  {
    slug: 'phong-reflection',
    title: 'Phong Reflection Model',
    category: 'rendering',
    tags: ['3d', 'lighting', 'materials'],
    description: 'A lighting study that highlights Phong-style material response through Svelte material and light nodes.',
    typeGpuSourceUrl: 'https://github.com/software-mansion/TypeGPU/tree/main/apps/typegpu-docs/src/examples/rendering/phong-reflection',
    notes: 'Adapted from the official TypeGPU Phong Reflection Model example using renderer-supported materials and primitives.',
    exportName: 'PhongReflection',
    sourceUrl: new URL('./phong-reflection/PhongReflection.typegpu.svelte', import.meta.url)
  },
  {
    slug: 'simple-shadow',
    title: 'Simple shadow',
    category: 'rendering',
    tags: ['3d', 'depth', 'composition'],
    description: 'A floor-and-subject composition that mirrors the original shadow example with renderer features available today.',
    typeGpuSourceUrl: 'https://github.com/software-mansion/TypeGPU/tree/main/apps/typegpu-docs/src/examples/rendering/simple-shadow',
    notes: 'Adapted from the official TypeGPU Simple shadow example; full shadow-map parity is outside this first docs release.',
    exportName: 'SimpleShadow',
    sourceUrl: new URL('./simple-shadow/SimpleShadow.typegpu.svelte', import.meta.url)
  }
] as const;

export type ExampleDefinition = (typeof exampleDefinitions)[number];
export type ExampleSlug = ExampleDefinition['slug'];
```

- [ ] **Step 4: Create scene sources**

Create `apps/docs/src/examples/two-boxes/TwoBoxes.typegpu.svelte`:

```svelte
<script lang="ts">
  import type { RgbaTuple, Vector3Tuple } from 'svelte-typegpu';

  const boxes: {
    id: string;
    position: Vector3Tuple;
    rotation: Vector3Tuple;
    scale: Vector3Tuple;
    color: RgbaTuple;
  }[] = [
    { id: 'left-box', position: [-0.72, 0, 0], rotation: [-0.18, 0.42, 0], scale: [0.92, 0.92, 0.92], color: [0.38, 0.92, 0.84, 1] },
    { id: 'right-box', position: [0.82, 0.08, 0.18], rotation: [0.24, -0.36, 0.08], scale: [0.74, 1.12, 0.74], color: [1, 0.63, 0.32, 1] }
  ];
</script>

<scene clearColor={[0.045, 0.055, 0.07, 1]} animationSpeed={0.42}>
  <perspectiveCamera id="main" active={true} position={[3.2, 2.2, 4.6]} target={[0.08, 0.04, 0]} fov={42} near={0.1} far={100}></perspectiveCamera>
  <resources>
    <boxGeometry id="box" width={1} height={1} depth={1}></boxGeometry>
    {#each boxes as box (box.id)}
      <standardMaterial id={`${box.id}-material`} color={box.color} roughness={0.34} metalness={0.1}></standardMaterial>
    {/each}
  </resources>
  <ambientLight color={[1, 1, 1]} intensity={0.24}></ambientLight>
  <directionalLight rotation={[-0.8, 0.34, 0]} color={[1, 0.96, 0.88]} intensity={1.6}></directionalLight>
  <pointLight position={[1.8, 1.1, 1.4]} color={[0.65, 0.96, 1]} intensity={2.8} range={10}></pointLight>
  {#each boxes as box (box.id)}
    <mesh geometry="box" material={`${box.id}-material`} position={box.position} rotation={box.rotation} scale={box.scale}></mesh>
  {/each}
</scene>
```

Create `apps/docs/src/examples/phong-reflection/PhongReflection.typegpu.svelte`:

```svelte
<script lang="ts">
  import type { Vector3Tuple } from 'svelte-typegpu';

  const orbs: {
    id: string;
    position: Vector3Tuple;
    scale: Vector3Tuple;
    color: [number, number, number, number];
    metalness: number;
    roughness: number;
  }[] = [
    { id: 'matte', position: [-1.2, 0.06, 0], scale: [0.78, 0.78, 0.78], color: [0.28, 0.78, 0.95, 1], metalness: 0.04, roughness: 0.72 },
    { id: 'polished', position: [0, 0.18, 0.08], scale: [0.96, 0.96, 0.96], color: [0.95, 0.92, 0.82, 1], metalness: 0.22, roughness: 0.22 },
    { id: 'warm', position: [1.26, -0.02, -0.04], scale: [0.72, 0.72, 0.72], color: [1, 0.55, 0.28, 1], metalness: 0.12, roughness: 0.38 }
  ];
</script>

<scene clearColor={[0.052, 0.047, 0.058, 1]} animationSpeed={0.28}>
  <perspectiveCamera id="main" active={true} position={[3.8, 2.15, 4.9]} target={[0, 0.1, 0]} fov={38} near={0.1} far={100}></perspectiveCamera>
  <resources>
    <sphereGeometry id="orb" radius={1} widthSegments={32} heightSegments={18}></sphereGeometry>
    <planeGeometry id="floor" width={5.2} height={3.4}></planeGeometry>
    <phongMaterial id="floorMaterial" color={[0.16, 0.18, 0.2, 1]} roughness={0.5}></phongMaterial>
    {#each orbs as orb (orb.id)}
      <phongMaterial id={`${orb.id}-material`} color={orb.color} metalness={orb.metalness} roughness={orb.roughness}></phongMaterial>
    {/each}
  </resources>
  <ambientLight color={[0.8, 0.9, 1]} intensity={0.16}></ambientLight>
  <hemisphereLight skyColor={[0.48, 0.68, 1]} groundColor={[0.14, 0.1, 0.08]} intensity={0.34}></hemisphereLight>
  <directionalLight rotation={[-0.72, 0.38, 0]} color={[1, 0.96, 0.86]} intensity={1.28}></directionalLight>
  <pointLight position={[-1.8, 1.6, 1.6]} color={[0.55, 0.9, 1]} intensity={4.4} range={10}></pointLight>
  <pointLight position={[1.8, 1.1, 1.2]} color={[1, 0.48, 0.28]} intensity={2.8} range={8}></pointLight>
  <mesh geometry="floor" material="floorMaterial" position={[0, -0.8, 0]}></mesh>
  {#each orbs as orb (orb.id)}
    <mesh geometry="orb" material={`${orb.id}-material`} position={orb.position} scale={orb.scale} rotation={[0, 0.28, 0]}></mesh>
  {/each}
</scene>
```

Create `apps/docs/src/examples/simple-shadow/SimpleShadow.typegpu.svelte`:

```svelte
<script lang="ts">
  import type { Vector3Tuple } from 'svelte-typegpu';

  const steps: {
    id: string;
    position: Vector3Tuple;
    scale: Vector3Tuple;
    color: [number, number, number, number];
  }[] = [
    { id: 'short', position: [-0.72, -0.34, 0.18], scale: [0.68, 0.32, 0.68], color: [0.34, 0.7, 0.94, 1] },
    { id: 'tall', position: [0.18, -0.08, -0.06], scale: [0.66, 0.86, 0.66], color: [0.96, 0.74, 0.42, 1] },
    { id: 'thin', position: [1.02, -0.18, 0.08], scale: [0.42, 0.62, 0.42], color: [0.82, 0.92, 0.72, 1] }
  ];
</script>

<scene clearColor={[0.05, 0.055, 0.055, 1]} animationSpeed={0.18}>
  <perspectiveCamera id="main" active={true} position={[3.4, 2.6, 4.4]} target={[0.08, -0.16, 0]} fov={40} near={0.1} far={100}></perspectiveCamera>
  <resources>
    <boxGeometry id="box" width={1} height={1} depth={1}></boxGeometry>
    <planeGeometry id="floor" width={5.5} height={4.2}></planeGeometry>
    <standardMaterial id="floorMaterial" color={[0.16, 0.17, 0.15, 1]} roughness={0.82} metalness={0}></standardMaterial>
    {#each steps as step (step.id)}
      <standardMaterial id={`${step.id}-material`} color={step.color} roughness={0.42} metalness={0.06}></standardMaterial>
    {/each}
  </resources>
  <ambientLight color={[0.92, 0.96, 1]} intensity={0.2}></ambientLight>
  <directionalLight rotation={[-0.92, 0.46, 0]} color={[1, 0.95, 0.84]} intensity={1.55}></directionalLight>
  <spotLight position={[-2.1, 2.6, 2.2]} lookAt={[0, -0.32, 0]} color={[1, 0.8, 0.48]} intensity={4.2} range={9} angle={0.66} penumbra={0.34}></spotLight>
  <mesh geometry="floor" material="floorMaterial" position={[0, -0.72, 0]}></mesh>
  {#each steps as step (step.id)}
    <mesh geometry="box" material={`${step.id}-material`} position={step.position} scale={step.scale} rotation={[0, 0.28, 0]}></mesh>
  {/each}
</scene>
```

- [ ] **Step 5: Create registry**

Create `apps/docs/src/examples/registry.ts`:

```ts
import { exampleCode } from '../generated/code-samples';
import { exampleDefinitions, type ExampleSlug } from './example-definitions';

export interface DocsExample {
  slug: ExampleSlug;
  title: string;
  category: string;
  tags: readonly string[];
  description: string;
  typeGpuSourceUrl: string;
  notes: string;
  code: string;
}

export const examples = exampleDefinitions.map(
  ({ slug, title, category, tags, description, typeGpuSourceUrl, notes }) =>
    ({
      slug,
      title,
      category,
      tags,
      description,
      typeGpuSourceUrl,
      notes,
      code: exampleCode[slug]
    }) satisfies DocsExample
);

export function getExampleBySlug(slug: string): DocsExample {
  const fallback = examples[0];
  if (!fallback) {
    throw new Error('Docs example registry is empty.');
  }

  return examples.find((example) => example.slug === slug) ?? fallback;
}
```

- [ ] **Step 6: Run registry test and keep generated failure**

Run:

```bash
pnpm --filter docs --fail-if-no-match test -- src/examples/registry.test.ts
```

Expected: FAIL because generated `code-samples.ts` does not exist.

- [ ] **Step 7: Commit example source files**

Run:

```bash
git add apps/docs/src/examples
git commit -m "feat: add docs example sources"
```

### Task 4: Generated Scene Compilation

**Files:**
- Create: `apps/docs/scripts/compile-typegpu-scenes.ts`
- Create: `apps/docs/src/examples/scene-components.ts`
- Generate: `apps/docs/src/generated/code-samples.ts`
- Generate: `apps/docs/src/generated/typegpu-scenes/*.js`
- Generate: `apps/docs/src/generated/typegpu-scenes/*.d.ts`
- Generate: `apps/docs/src/generated/typegpu-scenes/index.ts`

- [ ] **Step 1: Create generator**

Create `apps/docs/scripts/compile-typegpu-scenes.ts`:

```ts
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { compile } from 'svelte/compiler';
import { exampleDefinitions } from '../src/examples/example-definitions';

const appRoot = path.resolve(import.meta.dir, '..');
const generatedRoot = path.join(appRoot, 'src/generated');
const sceneOutDir = path.join(generatedRoot, 'typegpu-scenes');
const rendererPath = fileURLToPath(import.meta.resolve('svelte-typegpu/svelte-renderer'));

mkdirSync(sceneOutDir, { recursive: true });

const codeEntries: string[] = [];
const sceneExports: string[] = [];

for (const definition of exampleDefinitions) {
  const sourcePath = fileURLToPath(definition.sourceUrl);
  const source = readFileSync(sourcePath, 'utf8');
  const compiled = compile(source, {
    filename: sourcePath,
    generate: 'client',
    runes: true,
    experimental: {
      customRenderer: rendererPath
    }
  });

  const jsPath = path.join(sceneOutDir, `${definition.exportName}.js`);
  const dtsPath = path.join(sceneOutDir, `${definition.exportName}.d.ts`);

  writeFileSync(jsPath, `${header(sourcePath)}\n${compiled.js.code}`);
  writeFileSync(dtsPath, `${header(sourcePath)}\ndeclare const component: unknown;\nexport default component;\n`);

  codeEntries.push(`  ${JSON.stringify(definition.slug)}: ${JSON.stringify(source)}`);
  sceneExports.push(`export { default as ${definition.exportName} } from './${definition.exportName}.js';`);
}

writeFileSync(
  path.join(generatedRoot, 'code-samples.ts'),
  [
    header('example scene sources'),
    'import type { ExampleSlug } from \'../examples/example-definitions\';',
    '',
    'export const exampleCode = {',
    codeEntries.join(',\n'),
    '} satisfies Record<ExampleSlug, string>;',
    ''
  ].join('\n')
);

writeFileSync(path.join(sceneOutDir, 'index.ts'), [header('compiled typegpu scenes'), ...sceneExports, ''].join('\n'));

function header(sourcePath: string): string {
  const sourceLabel = path.isAbsolute(sourcePath) ? path.relative(appRoot, sourcePath) : sourcePath;

  return [
    '// This file is generated by scripts/compile-typegpu-scenes.ts.',
    `// Source: ${sourceLabel}`,
    '// Do not edit this file directly.'
  ].join('\n');
}
```

- [ ] **Step 2: Create scene map**

Create `apps/docs/src/examples/scene-components.ts`:

```ts
import type { ExampleSlug } from './example-definitions';
import { PhongReflection, SimpleShadow, TwoBoxes } from '../generated/typegpu-scenes';

export const sceneComponents = {
  'two-boxes': TwoBoxes,
  'phong-reflection': PhongReflection,
  'simple-shadow': SimpleShadow
} satisfies Record<ExampleSlug, unknown>;
```

- [ ] **Step 3: Generate artifacts**

Run:

```bash
pnpm --filter docs --fail-if-no-match run generate:typegpu
```

Expected: exits `0` and creates `apps/docs/src/generated/code-samples.ts` plus generated scene files.

- [ ] **Step 4: Run registry and source tests**

Run:

```bash
pnpm --filter docs --fail-if-no-match test -- src/examples/registry.test.ts src/app-source.test.ts
```

Expected: registry tests PASS and source tests FAIL only for missing Svelte components and CSS.

- [ ] **Step 5: Commit generator and generated files**

Run:

```bash
git add apps/docs/scripts/compile-typegpu-scenes.ts apps/docs/src/examples/scene-components.ts apps/docs/src/generated
git commit -m "feat: compile docs typegpu scenes"
```

### Task 5: Docs Components And Routes

**Files:**
- Create: `apps/docs/src/components/SiteShell.svelte`
- Create: `apps/docs/src/components/SiteNav.svelte`
- Create: `apps/docs/src/components/CodePanel.svelte`
- Create: `apps/docs/src/components/ExamplePreview.svelte`
- Create: `apps/docs/src/components/ExampleWorkbench.svelte`
- Create: `apps/docs/src/routes/Overview.svelte`
- Create: `apps/docs/src/routes/Quickstart.svelte`
- Create: `apps/docs/src/routes/Examples.svelte`

- [ ] **Step 1: Create shell and nav**

Create `apps/docs/src/components/SiteShell.svelte`:

```svelte
<script lang="ts">
  import type { Snippet } from 'svelte';
  import SiteNav from './SiteNav.svelte';
  import '../style.css';

  let {
    activePath,
    title = 'svelte-typegpu',
    description = 'A Svelte custom renderer for TypeGPU and WebGPU scenes.',
    children
  }: {
    activePath: '/' | '/quickstart' | '/examples';
    title?: string;
    description?: string;
    children: Snippet;
  } = $props();
</script>

<svelte:head>
  <title>{title}</title>
  <meta name="description" content={description} />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
</svelte:head>

<div class="site-frame">
  <SiteNav {activePath} />
  <main class="site-main">
    {@render children()}
  </main>
</div>
```

Create `apps/docs/src/components/SiteNav.svelte`:

```svelte
<script lang="ts">
  let { activePath }: { activePath: '/' | '/quickstart' | '/examples' } = $props();

  const navItems = [
    { href: '/', label: 'Overview' },
    { href: '/quickstart', label: 'Quickstart' },
    { href: '/examples', label: 'Examples' }
  ] as const;
</script>

<header class="site-nav">
  <a class="brand" href="/" aria-label="svelte-typegpu home">
    <span class="brand-mark" aria-hidden="true"></span>
    <span>svelte-typegpu</span>
  </a>
  <nav class="nav-links" aria-label="Primary navigation">
    {#each navItems as item (item.href)}
      <a href={item.href} aria-current={activePath === item.href ? 'page' : undefined}>{item.label}</a>
    {/each}
  </nav>
</header>
```

- [ ] **Step 2: Create code and preview components**

Create `apps/docs/src/components/CodePanel.svelte`:

```svelte
<script lang="ts">
  let { filename, code }: { filename: string; code: string } = $props();
</script>

<section class="code-panel" aria-label={`Source for ${filename}`}>
  <header>
    <span>{filename}</span>
    <span>Svelte custom renderer</span>
  </header>
  <pre><code>{code}</code></pre>
</section>
```

Create `apps/docs/src/components/ExamplePreview.svelte`:

```svelte
<script lang="ts">
  import { onMount } from 'svelte';
  import renderer, { createTypeGpuRoot, type TypeGpuRoot } from 'svelte-typegpu';
  import type { ExampleSlug } from '../examples/example-definitions';
  import { sceneComponents } from '../examples/scene-components';

  let { slug, label }: { slug: ExampleSlug; label: string } = $props();
  let host: HTMLDivElement;
  let error = $state<string | null>(null);
  let ready = $state(false);

  onMount(() => {
    let cancelled = false;
    let root: TypeGpuRoot | null = null;
    let instance: { unmount(): void } | null = null;

    if (!('gpu' in navigator)) {
      error = 'WebGPU is not available in this browser.';
      return;
    }

    createTypeGpuRoot({
      target: host,
      frameloop: 'always',
      maxDevicePixelRatio: 1.5,
      clearColor: [0.045, 0.05, 0.055, 1],
      depth: true,
      alphaMode: 'premultiplied'
    })
      .then((nextRoot) => {
        if (cancelled) {
          nextRoot.dispose();
          return;
        }

        root = nextRoot;
        instance = renderer.render(sceneComponents[slug] as never, { target: root });
        ready = true;
        error = null;
      })
      .catch((unknownError: unknown) => {
        if (cancelled) return;
        error =
          unknownError instanceof Error
            ? `Unable to start this preview: ${unknownError.message}`
            : 'Unable to start this preview.';
      });

    return () => {
      cancelled = true;
      instance?.unmount();
      root?.dispose();
    };
  });
</script>

<section class="preview-panel" aria-label={`${label} live preview`}>
  <div class="preview-host" bind:this={host} data-ready={ready}></div>
  {#if error}
    <div class="preview-status" role="status">{error}</div>
  {:else if !ready}
    <div class="preview-status" role="status">Preparing WebGPU preview...</div>
  {/if}
</section>
```

- [ ] **Step 3: Create workbench**

Create `apps/docs/src/components/ExampleWorkbench.svelte`:

```svelte
<script lang="ts">
  import CodePanel from './CodePanel.svelte';
  import ExamplePreview from './ExamplePreview.svelte';
  import type { DocsExample } from '../examples/registry';

  let { examples, selected }: { examples: readonly DocsExample[]; selected: DocsExample } = $props();
</script>

<section class="examples-layout">
  <aside class="example-rail" aria-label="Example list">
    {#each examples as example (example.slug)}
      <a class:active={example.slug === selected.slug} href={`/examples/${example.slug}`} aria-current={example.slug === selected.slug ? 'page' : undefined}>
        <span>{example.title}</span>
        <small>{example.category}</small>
      </a>
    {/each}
  </aside>
  <article class="example-workbench">
    <header class="example-header">
      <div>
        <p class="eyebrow">{selected.category}</p>
        <h1>{selected.title}</h1>
      </div>
      <a class="source-link" href={selected.typeGpuSourceUrl}>Original TypeGPU source</a>
    </header>
    <p class="example-description">{selected.description}</p>
    <div class="tag-row" aria-label="Example tags">
      {#each selected.tags as tag (tag)}
        <span>{tag}</span>
      {/each}
    </div>
    <div class="preview-code-grid">
      <ExamplePreview mochi:hydrate slug={selected.slug} label={selected.title} />
      <CodePanel filename={`${selected.slug}.typegpu.svelte`} code={selected.code} />
    </div>
    <p class="example-note">{selected.notes}</p>
  </article>
</section>
```

- [ ] **Step 4: Create route pages**

Create `apps/docs/src/routes/Overview.svelte`:

```svelte
<script lang="ts">
  import CodePanel from '../components/CodePanel.svelte';
  import SiteShell from '../components/SiteShell.svelte';

  let { activePath }: { activePath: '/' } = $props();
  const introCode = [
    '<script lang="ts">',
    "  import type { RgbaTuple } from 'svelte-typegpu';",
    '  let color: RgbaTuple = [0.94, 0.9, 0.82, 1];',
    '<\/script>',
    '',
    '<scene clearColor={[0.067, 0.078, 0.102, 1]}>',
    '  <perspectiveCamera id="main" active={true} position={[4, 3, 6]} target={[0, 0, 0]} fov={45}></perspectiveCamera>',
    '  <resources>',
    '    <boxGeometry id="box" width={1} height={1} depth={1}></boxGeometry>',
    '    <standardMaterial id="warm" {color}></standardMaterial>',
    '  </resources>',
    '  <ambientLight color={[1, 1, 1]} intensity={0.25}></ambientLight>',
    '  <directionalLight rotation={[-0.8, 0.4, 0]} intensity={1.4}></directionalLight>',
    '  <mesh geometry="box" material="warm" position={[0, 1, 0]}></mesh>',
    '</scene>'
  ].join('\n');
</script>

<SiteShell {activePath}>
  <section class="hero-grid">
    <div class="hero-copy">
      <p class="eyebrow">Svelte custom renderer</p>
      <h1>svelte-typegpu</h1>
      <p class="lede">Write TypeGPU and WebGPU scenes as Svelte component trees. Scene nodes, resources, materials, lights, cameras, and interaction state stay declarative.</p>
      <div class="hero-actions">
        <a class="button primary" href="/examples">View examples</a>
        <a class="button secondary" href="/quickstart">Read quickstart</a>
      </div>
    </div>
    <div class="hero-sample">
      <CodePanel filename="Scene.typegpu.svelte" code={introCode} />
    </div>
  </section>
  <section class="feature-grid" aria-label="Renderer model">
    <article><h2>Svelte describes the scene</h2><p>Components and props describe the graph instead of manually wiring render passes and buffers.</p></article>
    <article><h2>TypeGPU owns the GPU work</h2><p>The renderer bridges Svelte nodes into TypeGPU-managed resources, pipelines, batches, and draws.</p></article>
    <article><h2>DOM and WebGPU stay separated</h2><p>Normal Svelte components host controls and docs while `.typegpu.svelte` files render into a custom root.</p></article>
  </section>
</SiteShell>
```

Create `apps/docs/src/routes/Quickstart.svelte` with the same shell and three `CodePanel` sections:

```svelte
<script lang="ts">
  import CodePanel from '../components/CodePanel.svelte';
  import SiteShell from '../components/SiteShell.svelte';

  let { activePath }: { activePath: '/quickstart' } = $props();
  const installCode = 'pnpm add svelte@https://pkg.pr.new/svelte@18042 svelte-typegpu';
  const viteCode = `import { fileURLToPath } from 'node:url';
import { svelte } from '@sveltejs/vite-plugin-svelte';

const typeGpuRenderer = fileURLToPath(import.meta.resolve('svelte-typegpu/svelte-renderer'));

export default {
  plugins: [
    svelte({
      compilerOptions: { runes: true },
      dynamicCompileOptions({ filename }) {
        if (filename.endsWith('.typegpu.svelte')) {
          return { experimental: { customRenderer: typeGpuRenderer } };
        }
      }
    })
  ]
};`;
  const mountCode = [
    '<script lang="ts">',
    "  import { onMount } from 'svelte';",
    "  import renderer, { createTypeGpuRoot } from 'svelte-typegpu';",
    "  import Scene from './Scene.typegpu.svelte';",
    '  let host: HTMLDivElement;',
    '  onMount(() => {',
    '    let cleanup = () => {};',
    "    createTypeGpuRoot({ target: host, frameloop: 'always' }).then((root) => {",
    '      const instance = renderer.render(Scene, { target: root });',
    '      cleanup = () => { instance.unmount(); root.dispose(); };',
    '    });',
    '    return () => cleanup();',
    '  });',
    '<\/script>',
    '<div bind:this={host}></div>'
  ].join('\n');
</script>

<SiteShell {activePath} title="Quickstart - svelte-typegpu" description="Install and configure svelte-typegpu with the Svelte custom renderer preview.">
  <section class="doc-header">
    <p class="eyebrow">Quickstart</p>
    <h1>Configure Svelte for TypeGPU scene files.</h1>
    <p>Until the Svelte custom renderer API lands upstream, projects using `svelte-typegpu` need the Svelte PR preview build and a compiler rule for `.typegpu.svelte` files.</p>
  </section>
  <div class="doc-stack">
    <section><h2>Install</h2><CodePanel filename="terminal" code={installCode} /></section>
    <section><h2>Configure the custom renderer</h2><p>DOM `.svelte` components compile normally. Only `.typegpu.svelte` files use the custom renderer.</p><CodePanel filename="vite.config.ts" code={viteCode} /></section>
    <section><h2>Mount a scene</h2><p>Create a TypeGPU root from a DOM component, render a custom-renderer scene into it, and dispose both on unmount.</p><CodePanel filename="TypeGpuCanvas.svelte" code={mountCode} /></section>
  </div>
</SiteShell>
```

Create `apps/docs/src/routes/Examples.svelte`:

```svelte
<script lang="ts">
  import ExampleWorkbench from '../components/ExampleWorkbench.svelte';
  import SiteShell from '../components/SiteShell.svelte';
  import { examples, getExampleBySlug } from '../examples/registry';
  import type { ExamplesPageProps } from '../routes';

  let { activePath, selectedSlug }: ExamplesPageProps = $props();
  const selected = getExampleBySlug(selectedSlug);
</script>

<SiteShell {activePath} title={`${selected.title} - svelte-typegpu examples`} description="Live TypeGPU examples rewritten with the svelte-typegpu custom renderer.">
  <section class="doc-header compact">
    <p class="eyebrow">Examples</p>
    <h1>TypeGPU examples, written as Svelte scene components.</h1>
    <p>Each preview is a hydrated WebGPU island. The surrounding documentation and code stay server-rendered HTML.</p>
  </section>
  <ExampleWorkbench {examples} {selected} />
</SiteShell>
```

- [ ] **Step 5: Run source tests**

Run:

```bash
pnpm --filter docs --fail-if-no-match test -- src/app-source.test.ts src/examples/registry.test.ts
```

Expected: FAIL only for missing CSS.

- [ ] **Step 6: Commit components and pages**

Run:

```bash
git add apps/docs/src/components apps/docs/src/routes apps/docs/src/app-source.test.ts
git commit -m "feat: add docs pages and preview island"
```

### Task 6: Styling

**Files:**
- Create: `apps/docs/src/style.css`

- [ ] **Step 1: Create CSS**

Create `apps/docs/src/style.css`:

```css
:root {
  color-scheme: dark;
  --bg: #111513;
  --surface: #171d1a;
  --line: rgb(232 242 230 / 15%);
  --line-strong: rgb(232 242 230 / 28%);
  --text: #e8f2e6;
  --muted: #aab8ad;
  --subtle: #77857d;
  --cyan: #7dd3c7;
  --gold: #ffb45c;
  --code: #0b0f0d;
  font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
}

* { box-sizing: border-box; }
html, body { margin: 0; min-height: 100%; background: var(--bg); color: var(--text); }
body { font-size: 16px; line-height: 1.55; }
a { color: inherit; }
button, input, textarea { font: inherit; }

.site-frame { min-height: 100vh; background: var(--bg); }
.site-nav {
  position: sticky;
  top: 0;
  z-index: 5;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 24px;
  padding: 18px clamp(18px, 4vw, 46px);
  border-bottom: 1px solid var(--line);
  background: rgb(17 21 19 / 88%);
  backdrop-filter: blur(18px);
}
.brand, .nav-links, .hero-actions, .tag-row { display: flex; align-items: center; }
.brand { gap: 10px; color: var(--text); font-weight: 800; text-decoration: none; }
.brand-mark { width: 18px; aspect-ratio: 1; border: 2px solid var(--cyan); border-radius: 4px; }
.nav-links { gap: 6px; }
.nav-links a, .button, .source-link, .example-rail a { border-radius: 8px; text-decoration: none; }
.nav-links a { padding: 8px 11px; color: var(--muted); font-size: 0.92rem; }
.nav-links a:hover, .nav-links a[aria-current='page'] { color: var(--text); background: rgb(232 242 230 / 8%); }
.site-main { width: min(1180px, calc(100vw - 36px)); margin: 0 auto; padding: 48px 0 76px; }

.hero-grid {
  display: grid;
  grid-template-columns: minmax(0, 0.82fr) minmax(420px, 1fr);
  align-items: center;
  gap: clamp(28px, 5vw, 64px);
  min-height: min(760px, calc(100vh - 86px));
}
.hero-copy h1, .doc-header h1, .example-header h1 { margin: 0; letter-spacing: 0; }
.hero-copy h1 { max-width: 10ch; font-size: clamp(4.2rem, 10vw, 8.8rem); line-height: 0.82; }
.eyebrow { margin: 0 0 12px; color: var(--cyan); font-size: 0.76rem; font-weight: 900; text-transform: uppercase; }
.lede, .doc-header p, .example-description, .example-note, .feature-grid p, .doc-stack p { color: var(--muted); }
.lede { max-width: 56ch; margin: 24px 0 0; font-size: 1.18rem; }
.hero-actions { flex-wrap: wrap; gap: 10px; margin-top: 28px; }
.button, .source-link { display: inline-flex; min-height: 42px; align-items: center; justify-content: center; padding: 10px 14px; border: 1px solid var(--line-strong); font-weight: 800; }
.button.primary { border-color: rgb(125 211 199 / 62%); background: rgb(125 211 199 / 18%); }
.button.secondary, .source-link { background: rgb(232 242 230 / 7%); }

.feature-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 1px; overflow: hidden; border: 1px solid var(--line); border-radius: 8px; background: var(--line); }
.feature-grid article { min-height: 178px; padding: 24px; background: rgb(23 29 26 / 82%); }
.feature-grid h2, .doc-stack h2 { margin: 0 0 10px; font-size: 1.05rem; }
.doc-header { max-width: 760px; margin-bottom: 34px; }
.doc-header.compact { margin-bottom: 24px; }
.doc-header h1 { font-size: clamp(2.5rem, 6vw, 5.5rem); line-height: 0.92; }
.doc-header p { margin: 18px 0 0; font-size: 1.08rem; }
.doc-stack { display: grid; gap: 28px; }
.doc-stack section { display: grid; gap: 12px; }

.code-panel { overflow: hidden; border: 1px solid var(--line); border-radius: 8px; background: var(--code); }
.code-panel header { display: flex; justify-content: space-between; gap: 16px; padding: 10px 12px; border-bottom: 1px solid var(--line); color: var(--subtle); font-size: 0.78rem; font-weight: 800; }
.code-panel pre { max-height: 620px; margin: 0; overflow: auto; padding: 18px; }
.code-panel code { color: #f0f4ed; font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace; font-size: 0.84rem; line-height: 1.55; white-space: pre; }

.examples-layout { display: grid; grid-template-columns: 240px minmax(0, 1fr); gap: 22px; align-items: start; }
.example-rail { position: sticky; top: 92px; display: grid; gap: 8px; }
.example-rail a { display: grid; gap: 3px; padding: 13px 14px; border: 1px solid transparent; color: var(--muted); background: rgb(232 242 230 / 5%); }
.example-rail a:hover, .example-rail a.active { border-color: var(--line-strong); color: var(--text); background: rgb(232 242 230 / 9%); }
.example-rail small { color: var(--subtle); font-size: 0.76rem; text-transform: uppercase; }
.example-workbench { display: grid; min-width: 0; gap: 16px; }
.example-header { display: flex; align-items: flex-start; justify-content: space-between; gap: 20px; }
.example-header h1 { font-size: clamp(2rem, 4vw, 4.1rem); line-height: 0.95; }
.example-description { max-width: 72ch; margin: 0; }
.tag-row { flex-wrap: wrap; gap: 8px; }
.tag-row span { padding: 6px 9px; border: 1px solid var(--line); border-radius: 999px; color: var(--muted); font-size: 0.78rem; font-weight: 800; }
.preview-code-grid { display: grid; grid-template-columns: minmax(320px, 0.95fr) minmax(380px, 1.05fr); gap: 14px; align-items: stretch; }
.preview-panel { position: relative; min-height: 320px; aspect-ratio: 16 / 10; overflow: hidden; border: 1px solid var(--line); border-radius: 8px; background: #0b0f0d; }
.preview-host, .preview-host canvas { width: 100%; height: 100%; }
.preview-host canvas { display: block; outline: none; touch-action: none; }
.preview-status { position: absolute; inset: auto 14px 14px 14px; padding: 11px 12px; border: 1px solid rgb(232 242 230 / 18%); border-radius: 8px; background: rgb(11 15 13 / 86%); color: var(--muted); font-size: 0.9rem; }
.example-note { margin: 0; padding-top: 4px; font-size: 0.92rem; }

@media (max-width: 980px) {
  .hero-grid, .preview-code-grid { grid-template-columns: 1fr; }
  .hero-grid { min-height: auto; }
  .feature-grid { grid-template-columns: 1fr; }
}

@media (max-width: 820px) {
  .site-nav { align-items: flex-start; flex-direction: column; }
  .site-main { width: min(100% - 28px, 1180px); padding-top: 30px; }
  .nav-links { width: 100%; display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); }
  .nav-links a { text-align: center; }
  .hero-copy h1 { font-size: clamp(3.3rem, 18vw, 5.2rem); }
  .examples-layout { grid-template-columns: 1fr; }
  .example-rail { position: static; grid-template-columns: repeat(3, minmax(0, 1fr)); }
  .example-rail a { min-height: 72px; }
  .example-header { display: grid; }
}
```

- [ ] **Step 2: Run focused tests**

Run:

```bash
pnpm --filter docs --fail-if-no-match test -- src/app-source.test.ts src/examples/registry.test.ts
```

Expected: PASS.

- [ ] **Step 3: Commit styling**

Run:

```bash
git add apps/docs/src/style.css apps/docs/src/app-source.test.ts
git commit -m "style: add docs site visual system"
```

### Task 7: Verification

**Files:**
- Generated files may update after the final generator run.

- [ ] **Step 1: Regenerate artifacts**

Run:

```bash
pnpm --filter docs --fail-if-no-match run generate:typegpu
git diff -- apps/docs/src/generated
```

Expected: generator exits `0`; generated diff is empty after committed artifacts are current.

- [ ] **Step 2: Run docs verification**

Run:

```bash
pnpm --filter docs --fail-if-no-match test
pnpm --filter docs --fail-if-no-match build
```

Expected: both commands PASS.

- [ ] **Step 3: Run monorepo verification**

Run:

```bash
pnpm test
pnpm build
```

Expected: both commands PASS.

- [ ] **Step 4: Start docs server**

Run:

```bash
pnpm --filter docs --fail-if-no-match dev
```

Expected: server starts on `http://127.0.0.1:3333` and logs `svelte-typegpu docs listening on http://127.0.0.1:3333`.

- [ ] **Step 5: Browser smoke**

Open `http://127.0.0.1:3333/examples` in the in-app browser.

Verify:

- The page loads with `svelte-typegpu` branding.
- Navigation shows `Overview`, `Quickstart`, and `Examples`.
- The selected example is `Two Boxes`.
- The preview region keeps its size before and after hydration.
- The code panel shows `.typegpu.svelte` markup as text.
- `/examples/phong-reflection` selects `Phong Reflection Model`.
- `/examples/simple-shadow` selects `Simple shadow`.
- WebGPU errors stay inside the preview panel.

- [ ] **Step 6: Stop server**

Stop the dev server with `Ctrl-C`.

Expected: terminal returns to the shell prompt and no docs server session remains running.
