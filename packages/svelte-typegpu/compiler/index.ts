import { createHash } from 'node:crypto';
import { parse as parseJavaScript } from 'acorn';
import MagicString from 'magic-string';
import remapping from '@jridgewell/remapping';
import { compile, parse, type CompileOptions } from 'svelte/compiler';

const hostModule = 'svelte-typegpu/internal/viewport-canvas';

export interface PreparedTypeGpuSource {
  code: string;
  map?: ReturnType<MagicString['generateMap']>;
  viewport: boolean;
}

/** Lower only a single, unconditional canvas. Scene-only files are unchanged. */
export function prepareTypeGpuSource(source: string, filename: string): PreparedTypeGpuSource {
  const ast = parse(source, { modern: true, filename });
  const canvases: any[] = [];
  visit(ast.fragment, (node) => {
    if (node.type === 'RegularElement' && node.name === 'canvas') canvases.push(node);
  });
  if (!canvases.length) return { code: source, viewport: false };
  const roots = ast.fragment.nodes.filter((node) =>
    node.type !== 'Comment' && !(node.type === 'Text' && !node.data.trim())
  );
  const canvas = canvases[0];
  if (canvases.length !== 1 || roots.length !== 1 || roots[0] !== canvas) {
    throw new Error(`${filename}: a viewport requires one unconditional top-level <canvas>. Put conditional scenes inside it, or conditionally mount the viewport from a DOM component.`);
  }
  if (ast.options?.customRenderer !== undefined) {
    throw new Error(`${filename}: viewport renderer selection is owned by the TypeGPU compiler.`);
  }
  const identifiers = new Set<string>();
  visit(ast, (node) => { if (node.type === 'Identifier') identifiers.add(node.name); });
  let host = 'TypeGpuViewportCanvas';
  while (identifiers.has(host)) host += '_';
  const result = new MagicString(source);
  const importCode = `import ${host} from ${JSON.stringify(hostModule)};`;
  if (ast.instance) result.appendLeft((ast.instance.content as any).start, importCode);
  else result.prepend(`<script>${importCode}</script>\n`);
  result.overwrite(canvas.start + 1, canvas.start + 7, host);
  const closeStart = canvas.end - '</canvas>'.length;
  const selfClosing = source.slice(canvas.start, canvas.end).endsWith('/>');
  if (!selfClosing) result.overwrite(closeStart + 2, closeStart + 8, host);

  for (const attribute of canvas.attributes) {
    if (attribute.type === 'BindDirective' && attribute.name === 'this') {
      result.overwrite(attribute.start, attribute.end,
        `bind:canvas={${source.slice(attribute.expression.start, attribute.expression.end)}}`);
    } else if (!['Attribute', 'SpreadAttribute', 'AttachTag'].includes(attribute.type)) {
      throw new Error(`${filename}: ${attribute.type} on <canvas> is not supported yet. Use native event attributes, class/style props, attachments, or bind:this.`);
    }
    if (attribute.type === 'Attribute' && ['width', 'height', 'children', 'canvas', 'scopeClass'].includes(attribute.name)) {
      throw new Error(`${filename}: <canvas ${attribute.name}> is renderer-owned. Use CSS for display size and bind:this for the native canvas.`);
    }
  }

  if (ast.css) {
    // Let Svelte scope the original native canvas selectors, then forward its
    // scope class through the internal host. Scene primitives are never DOM CSS.
    const scopeClass = `typegpu-${createHash('sha256').update(filename + source).digest('hex').slice(0, 10)}`;
    const shell = new MagicString(source);
    if (!selfClosing && canvas.fragment.nodes.length) {
      shell.remove(canvas.fragment.nodes[0].start, canvas.fragment.nodes.at(-1).end);
    }
    const css = compile(shell.toString(), {
      filename, generate: 'client', runes: true, css: 'external', cssHash: () => scopeClass
    }).css?.code ?? '';
    result.overwrite(ast.css.content.start, ast.css.content.end, `:global { ${css} }`);
    result.appendLeft(canvas.start + 7, ` scopeClass=${JSON.stringify(scopeClass)}`);
  }
  return { code: result.toString(), map: result.generateMap({ source: filename, includeContent: true, hires: true }), viewport: true };
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
  const hostCalls = statements.filter((statement: any) => {
    if (statement.type !== 'ExpressionStatement') return false;
    let expression = statement.expression;
    if (expression.type === 'CallExpression' && expression.callee.type === 'MemberExpression' &&
        expression.callee.object.name === '$' && expression.callee.property.name === 'add_svelte_meta' &&
        expression.arguments[0]?.type === 'ArrowFunctionExpression') expression = expression.arguments[0].body;
    return expression.type === 'CallExpression' && expression.callee.name === hostName;
  });
  if (scopes.length !== 1 || scope.init.arguments.length !== 1 || scope.init.arguments[0].name !== '$renderer' ||
      !rendererImport || !hostName || hostCalls.length !== 1) {
    throw new Error('Unsupported Svelte viewport output: renderer scope or static canvas host changed.');
  }
  const output = new MagicString(code);
  const argument = scope.init.arguments[0];
  output.overwrite(argument.start, argument.end, 'null');
  const map = output.generateMap({ hires: true });
  return { code: output.toString(), map: inputMap ? remapping([map as any, inputMap], () => null) : map };
}

export function compileTypeGpu(source: string, options: CompileOptions & { filename: string }) {
  const prepared = prepareTypeGpuSource(source, options.filename);
  const serverViewport = prepared.viewport && options.generate === 'server';
  const compiled = compile(prepared.code, {
    ...options,
    hmr: false,
    sourcemap: prepared.map ?? options.sourcemap,
    experimental: { ...options.experimental, customRenderer: serverViewport ? () => null :
      options.experimental?.customRenderer ?? 'svelte-typegpu/svelte-renderer' }
  });
  if (prepared.viewport && !serverViewport) {
    compiled.js = adaptViewportClient(compiled.js.code, compiled.js.map) as typeof compiled.js;
  }
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
