import { createHash } from 'node:crypto';
import { parse as parseJavaScript } from 'acorn';
import MagicString from 'magic-string';
import remapping from '@jridgewell/remapping';
import { compile, parse, type CompileOptions, type Warning } from 'svelte/compiler';
import { sceneDiagnostics } from './diagnostics.ts';
import { prepareAttributeValues } from './attributes.ts';

const hostModule = 'svelte-typegpu/internal/viewport-canvas';
const elementSizes = new Set(['clientWidth', 'clientHeight', 'offsetWidth', 'offsetHeight']);
const observerSizes = new Set(['contentRect', 'contentBoxSize', 'borderBoxSize', 'devicePixelContentBoxSize']);

export interface PreparedTypeGpuSource {
  code: string;
  map?: ReturnType<MagicString['generateMap']>;
  viewport: boolean;
  warnings: Warning[];
}

/** Adapt structured scene values and, when present, a single unconditional canvas. */
export function prepareTypeGpuSource(source: string, filename: string): PreparedTypeGpuSource {
  const ast = parse(source, { modern: true, filename });
  const warnings = sceneDiagnostics(ast, source, filename);
  const canvases: any[] = [];
  visit(ast.fragment, (node) => {
    if (node.type === 'RegularElement' && node.name === 'canvas') canvases.push(node);
  });
  const identifiers = new Set<string>();
  visit(ast, (node) => { if (node.type === 'Identifier') identifiers.add(node.name); });
  const fresh = (name: string) => {
    while (identifiers.has(name)) name += '_';
    identifiers.add(name);
    return name;
  };
  const result = new MagicString(source);
  const values = prepareAttributeValues(ast, source, result, fresh);
  const valueImport = values ? `import * as ${values} from 'svelte-typegpu/internal/attribute-values';` : '';
  const addImports = (code: string) => {
    if (ast.instance) result.appendLeft((ast.instance.content as any).start, code);
    else result.prepend(`<script>${code}</script>\n`);
  };
  if (!canvases.length) {
    if (!values) return { code: source, viewport: false, warnings };
    addImports(valueImport);
    return { code: result.toString(), map: result.generateMap({ source: filename, includeContent: true, hires: true }), viewport: false, warnings };
  }
  const roots = ast.fragment.nodes.filter((node) =>
    node.type !== 'Comment' && node.type !== 'SnippetBlock' && !(node.type === 'Text' && !node.data.trim())
  );
  const canvas = canvases[0];
  if (canvases.length !== 1 || roots.length !== 1 || roots[0] !== canvas) {
    throw new Error(`${filename}: a viewport requires one unconditional top-level <canvas>. Put conditional scenes inside it, or conditionally mount the viewport from a DOM component.`);
  }
  if (ast.options?.customRenderer !== undefined) {
    throw new Error(`${filename}: viewport renderer selection is owned by the TypeGPU compiler.`);
  }
  const host = fresh('TypeGpuViewportCanvas');
  const hasSizeBindings = canvas.attributes.some((attribute: any) => attribute.type === 'BindDirective' &&
    (elementSizes.has(attribute.name) || observerSizes.has(attribute.name)));
  const bindings = hasSizeBindings ? fresh('TypeGpuCanvasBindings') : null;
  const importCode = valueImport + `import ${host} from ${JSON.stringify(hostModule)};` +
    (bindings ? `import * as ${bindings} from 'svelte-typegpu/internal/canvas-bindings';` : '');
  addImports(importCode);
  result.overwrite(canvas.start + 1, canvas.start + 7, host);
  const closeStart = canvas.end - '</canvas>'.length;
  const selfClosing = source.slice(canvas.start, canvas.end).endsWith('/>');
  if (!selfClosing) result.overwrite(closeStart + 2, closeStart + 8, host);

  for (const attribute of canvas.attributes) {
    if (attribute.type === 'BindDirective' && (elementSizes.has(attribute.name) || observerSizes.has(attribute.name))) {
      const node = fresh('TypeGpuCanvasNode');
      const value = fresh('TypeGpuCanvasValue');
      const expression = attribute.expression;
      const setter = expression.type === 'SequenceExpression'
        ? source.slice(expression.expressions[1].start, expression.expressions[1].end)
        : `(${value}) => (${source.slice(expression.start, expression.end)} = ${value})`;
      const helper = elementSizes.has(attribute.name) ? 'bind_element_size' : 'bind_resize_observer';
      // Function setters are captured once, as with native bindings. Their reads
      // must not turn the attachment into a reactive observer subscription.
      result.overwrite(attribute.start, attribute.end,
        `{@attach (${node}) => { ${bindings}.untrack(() => ${bindings}.${helper}(${node}, ${JSON.stringify(attribute.name)}, (${setter}))); }}`);
    } else if (attribute.type === 'BindDirective' && attribute.name === 'this') {
      result.overwrite(attribute.start, attribute.end,
        `bind:canvas={${source.slice(attribute.expression.start, attribute.expression.end)}}`);
    } else if (!['Attribute', 'SpreadAttribute', 'AttachTag'].includes(attribute.type)) {
      throw new Error(`${filename}: ${attribute.type} on <canvas> is not supported. Use native event attributes, class/style props, attachments, bind:this, or size bindings.`);
    }
    if (attribute.type === 'Attribute' && ['width', 'height', 'children', 'canvas', 'scopeClass'].includes(attribute.name)) {
      throw new Error(`${filename}: <canvas ${attribute.name}> is renderer-owned. Use CSS for display size and bind:this for the native canvas.`);
    }
  }

  if (ast.css || hasSizeBindings) {
    // Let Svelte scope the original native canvas selectors, then forward its
    // scope class through the internal host. Scene primitives are never DOM CSS.
    const scopeClass = `typegpu-${createHash('sha256').update(filename + source).digest('hex').slice(0, 10)}`;
    const shell = new MagicString(source);
    if (!selfClosing) omitNodes(shell, canvas.fragment.nodes);
    for (const node of ast.fragment.nodes) {
      if (node.type === 'SnippetBlock') omitNodes(shell, node.body.nodes);
    }
    const css = compile(shell.toString(), {
      filename, generate: 'client', runes: true, css: 'external', cssHash: () => scopeClass
    }).css?.code ?? '';
    if (ast.css) {
      result.overwrite(ast.css.content.start, ast.css.content.end, `:global { ${css} }`);
      result.appendLeft(canvas.start + 7, ` scopeClass=${JSON.stringify(scopeClass)}`);
    }
  }
  return { code: result.toString(), map: result.generateMap({ source: filename, includeContent: true, hires: true }), viewport: true, warnings };
}

/** Fail closed if the pinned compiler stops emitting the proven static host shape. */
export function adaptViewportClient(code: string, inputMap?: any) {
  const ast = parseJavaScript(code, { ecmaVersion: 'latest', sourceType: 'module' });
  const entry: any = ast.body.find((node) => node.type === 'ExportDefaultDeclaration');
  if (entry?.declaration.type !== 'FunctionDeclaration') {
    throw new Error('Unsupported Svelte viewport output: expected a static component function (HMR must be disabled).');
  }
  const flatten = (statements: any[]): any[] => statements.flatMap((statement) =>
    statement.type === 'BlockStatement' ? flatten(statement.body) : [statement]);
  const statements = flatten(entry.declaration.body.body);
  const scopes = statements.flatMap((statement: any) => statement.type === 'VariableDeclaration'
    ? statement.declarations.filter((item: any) =>
      item.init?.type === 'CallExpression' && item.init.callee.type === 'MemberExpression' &&
      item.init.callee.object.name === '$' && item.init.callee.property.name === 'push_renderer'
    ) : []);
  const scope = scopes[0];
  const imports: any[] = ast.body.filter((node) => node.type === 'ImportDeclaration');
  const rendererImport = imports.find((node) => node.specifiers.some((s: any) => s.local.name === '$renderer'));
  const hostImport = imports.find((node) => node.source.value === hostModule);
  const hostName = hostImport?.specifiers[0]?.local.name;
  const factories = new Set<string>();
  for (const statement of ast.body) {
    if (statement.type !== 'VariableDeclaration') continue;
    for (const declaration of statement.declarations as any[]) {
      if (declaration.init?.callee?.object?.name === '$' && declaration.init.callee.property?.name === 'from_tree') {
        factories.add(declaration.id.name);
      }
    }
  }
  let foreignAnchor = false;
  const inspectEntry = (node: any): void => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) { node.forEach(inspectEntry); return; }
    if (['FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression'].includes(node.type)) return;
    if (node.type === 'CallExpression' && (factories.has(node.callee.name) ||
      (node.callee.object?.name === '$' && ['from_tree', 'comment', 'append', 'first_child'].includes(node.callee.property?.name)))) {
      foreignAnchor = true;
    }
    Object.values(node).forEach(inspectEntry);
  };
  inspectEntry(statements);
  const hostCalls = statements.filter((statement: any) => {
    if (statement.type !== 'ExpressionStatement') return false;
    let expression = statement.expression;
    if (expression.type === 'CallExpression' && expression.callee.type === 'MemberExpression' &&
        expression.callee.object.name === '$' && expression.callee.property.name === 'add_svelte_meta' &&
        expression.arguments[0]?.type === 'ArrowFunctionExpression') expression = expression.arguments[0].body;
    return expression.type === 'CallExpression' && expression.callee.name === hostName;
  });
  if (scopes.length !== 1 || scope.init.arguments.length !== 1 || scope.init.arguments[0].name !== '$renderer' ||
      !rendererImport || !hostName || hostCalls.length !== 1 || foreignAnchor) {
    throw new Error('Unsupported Svelte viewport output: renderer scope or static canvas host changed.');
  }
  const output = new MagicString(code);
  const argument = scope.init.arguments[0];
  output.overwrite(argument.start, argument.end, 'null');
  const map = output.generateMap({ hires: true });
  return { code: output.toString(), map: inputMap ? remapping([map as any, inputMap], () => null) : map };
}

/** Scene snippets are never executed by the server host; do not compile them as HTML. */
export function omitViewportScene(source: string, filename: string) {
  const ast = parse(source, { modern: true, filename });
  const host = ast.fragment.nodes.find((node) => node.type === 'Component');
  if (!host || host.type !== 'Component') throw new Error('Missing lowered viewport host.');
  const output = new MagicString(source);
  omitNodes(output, host.fragment.nodes);
  for (const node of ast.fragment.nodes) {
    // Keep declarations so module exports and references remain valid on SSR.
    if (node.type === 'SnippetBlock') omitNodes(output, node.body.nodes);
  }
  return { code: output.toString(), map: output.generateMap({ source: filename, includeContent: true, hires: true }) };
}

function omitNodes(output: MagicString, nodes: readonly { start: number; end: number }[]) {
  if (nodes.length) output.remove(nodes[0].start, nodes.at(-1)!.end);
}

export function compileTypeGpu(source: string, options: CompileOptions & { filename: string }) {
  const prepared = prepareTypeGpuSource(source, options.filename);
  const serverViewport = prepared.viewport && options.generate === 'server';
  const server = serverViewport ? omitViewportScene(prepared.code, options.filename) : undefined;
  const compiled = compile(server?.code ?? prepared.code, {
    ...options,
    hmr: false,
    sourcemap: undefined,
    experimental: { ...options.experimental, customRenderer: serverViewport ? () => null :
      options.experimental?.customRenderer ?? 'svelte-typegpu/svelte-renderer' }
  });
  // Compose here: the pinned compiler discards preprocessor sourcesContent but
  // retains its transformed input, which makes debugger source text misleading.
  const maps = [server?.map, prepared.map, options.sourcemap].filter((map) => map != null);
  if (maps.length) {
    Object.assign(compiled.js.map, remapping([compiled.js.map, ...maps] as any, () => null));
    if (compiled.css?.map) {
      Object.assign(compiled.css.map, remapping([compiled.css.map, ...maps] as any, () => null));
    }
  }
  if (prepared.viewport && !serverViewport) {
    compiled.js = adaptViewportClient(compiled.js.code, compiled.js.map) as typeof compiled.js;
  }
  compiled.warnings.push(...prepared.warnings.filter((warning) => options.warningFilter?.(warning) ?? true));
  return compiled;
}

function visit(value: unknown, callback: (node: any) => void): void {
  if (!value || typeof value !== 'object') return;
  if (Array.isArray(value)) { for (const child of value) visit(child, callback); return; }
  const node = value as Record<string, unknown>;
  if (typeof node.type === 'string') callback(node);
  for (const [key, child] of Object.entries(node)) {
    if (key !== 'loc' && key !== 'metadata') visit(child, callback);
  }
}
