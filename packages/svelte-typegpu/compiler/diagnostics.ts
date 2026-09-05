import type { AST, Warning } from 'svelte/compiler';
import { normalizePrimitiveName } from '../src/primitive-names.ts';

// Only list nodes consumed by scene/resource readers, not every name that the
// invalidation registry recognizes (notably texture and sampler).
const primitives = new Set([
  'scene', 'group', 'mesh', 'model',
  'perspectiveCamera', 'orthographicCamera', 'orbitControls',
  'cameraPose', 'cameraLens', 'controls', 'pointerControls', 'keyboardControls',
  'ambientLight', 'hemisphereLight', 'directionalLight', 'pointLight', 'spotLight',
  'boxGeometry', 'planeGeometry', 'sphereGeometry', 'bufferGeometry',
  'basicMaterial', 'phongMaterial', 'standardMaterial', 'shaderMaterial',
  'shaderPass', 'frameTask'
]);

const parents = new Map<string, readonly string[]>([
  ...['boxGeometry', 'planeGeometry', 'sphereGeometry', 'bufferGeometry'].map(
    (name): [string, string[]] => [name, ['mesh']]),
  ...['basicMaterial', 'phongMaterial', 'standardMaterial', 'shaderMaterial'].map(
    (name): [string, string[]] => [name, ['mesh', 'model']]),
  ...['cameraPose', 'cameraLens', 'controls'].map(
    (name): [string, string[]] => [name, ['perspectiveCamera']]),
  ['pointerControls', ['controls']],
  ['keyboardControls', ['controls', 'orbitControls']]
]);

/** Analyze original markup only. No validation is emitted into component code. */
export function sceneDiagnostics(ast: AST.Root, source: string, filename: string): Warning[] {
  const warnings: Warning[] = [];

  function element(name: string, range: { start: number; end: number }, fragment: AST.Fragment, parent: string | null) {
    const canonical = normalizePrimitiveName(name);
    const known = primitives.has(canonical) || canonical === 'canvas';
    if (!known) {
      const suggestion = suggestPrimitive(name);
      warnings.push(warning(source, filename, range, 'typegpu_unknown_primitive',
        `Unknown TypeGPU primitive <${name}>.${suggestion ? ` Did you mean <${suggestion}>?` : ''} ` +
        'The built-in renderer does not interpret this node.'));
    } else {
      const allowed = parents.get(canonical);
      if (parent !== null && allowed && !allowed.includes(parent)) {
        warnings.push(warning(source, filename, range, 'typegpu_invalid_parent',
          `<${name}> must be a direct child of ${allowed.map((name) => `<${name}>`).join(' or ')}; ` +
          `its parent is <${parent}>. This resource or control will be ignored.`));
      }
    }
    walk(fragment, known ? canonical : null);
  }

  function walk(fragment: AST.Fragment | null | undefined, parent: string | null) {
    for (const node of fragment?.nodes ?? []) {
      switch (node.type) {
        case 'RegularElement':
          element(node.name, { start: node.start + 1, end: node.start + 1 + node.name.length }, node.fragment, parent);
          break;
        case 'SvelteElement':
          if (node.tag.type === 'Literal' && typeof node.tag.value === 'string') {
            element(node.tag.value, node.tag as typeof node.tag & { start: number; end: number }, node.fragment, parent);
          } else {
            walk(node.fragment, null);
          }
          break;
        case 'Component':
        case 'SvelteComponent':
        case 'SvelteSelf':
          // Component children can be rendered under a host created elsewhere.
          walk(node.fragment, null);
          break;
        case 'SnippetBlock':
          walk(node.body, null);
          break;
        case 'IfBlock':
          walk(node.consequent, parent);
          walk(node.alternate, parent);
          break;
        case 'EachBlock':
          walk(node.body, parent);
          walk(node.fallback, parent);
          break;
        case 'AwaitBlock':
          walk(node.pending, parent);
          walk(node.then, parent);
          walk(node.catch, parent);
          break;
        case 'KeyBlock':
        case 'SvelteBoundary':
        case 'SvelteFragment':
          walk(node.fragment, parent);
          break;
      }
    }
  }

  walk(ast.fragment, null);
  return warnings;
}

function suggestPrimitive(name: string): string | undefined {
  const normalized = name.replaceAll('-', '').toLowerCase();
  let closest: string | undefined;
  let distance = Math.min(2, Math.floor(normalized.length / 3)) + 1;
  for (const candidate of primitives) {
    const next = editDistance(normalized, candidate.toLowerCase());
    if (next < distance) {
      closest = candidate;
      distance = next;
    }
  }
  return closest;
}

function editDistance(a: string, b: string): number {
  const row = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i++) {
    let diagonal = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const previous = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, diagonal + Number(a[i - 1] !== b[j - 1]));
      diagonal = previous;
    }
  }
  return row[b.length];
}

function warning(source: string, filename: string, range: { start: number; end: number }, code: string, message: string): Warning {
  const locate = (character: number) => {
    const lines = source.slice(0, character).split('\n');
    return { line: lines.length, column: lines.at(-1)!.length, character };
  };
  const start = locate(range.start);
  const end = locate(range.end);
  const lines = source.split(/\r?\n/);
  const first = Math.max(0, start.line - 3);
  const last = Math.min(lines.length, start.line + 2);
  const digits = String(last).length;
  const frame: string[] = [];
  for (let i = first; i < last; i++) {
    frame.push(`${String(i + 1).padStart(digits)}: ${lines[i].replaceAll('\t', '  ')}`);
    if (i === start.line - 1) {
      const indent = lines[i].slice(0, start.column).replaceAll('\t', '  ').length;
      frame.push(' '.repeat(digits + 2 + indent) + '^');
    }
  }
  return { code, message, filename, start, end, position: [range.start, range.end], frame: frame.join('\n') };
}
