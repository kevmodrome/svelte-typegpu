import type { AST } from 'svelte/compiler';
import type MagicString from 'magic-string';
import { attributeSchema } from '../src/attribute-values.ts';

export function prepareAttributeValues(
  ast: AST.Root, source: string, output: MagicString, fresh: (name: string) => string
): string | undefined {
  let helper: string | undefined;
  const name = () => helper ??= fresh('TypeGpuAttributeValues');
  function visit(node: any) {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) { node.forEach(visit); return; }
    if ((node.type === 'RegularElement' && node.name !== 'canvas') || node.type === 'SvelteElement') {
      for (const attribute of node.attributes) {
        if (attribute.type === 'SpreadAttribute') {
          const expression = source.slice(attribute.expression.start, attribute.expression.end);
          output.overwrite(attribute.start, attribute.end, `{...${name()}.props(${expression})}`);
        } else if (attribute.type === 'Attribute') {
          const tag = Array.isArray(attribute.value)
            ? attribute.value.length === 1 ? attribute.value[0] : null
            : attribute.value;
          if (tag?.type !== 'ExpressionTag') continue;
          const schema = attributeSchema(attribute.name);
          const expression = tag.expression;
          if (!schema || staticValue(expression)) continue;
          // Inline tuple entries already belong to the existing template effect.
          if ((schema === 'tuple' || schema === 'vector') && expression.type === 'ArrayExpression') continue;
          const value = source.slice(expression.start, expression.end);
          output.overwrite(attribute.start, attribute.end, `${attribute.name}={${name()}.value(${JSON.stringify(attribute.name)}, ${value})}`);
        }
      }
    }
    for (const [key, value] of Object.entries(node)) if (key !== 'loc' && key !== 'metadata') visit(value);
  }
  visit(ast.fragment);
  return helper;
}

function staticValue(node: any): boolean {
  if (!node) return true;
  if (node.type === 'Literal') return true;
  if (node.type === 'UnaryExpression') return staticValue(node.argument);
  if (node.type === 'ArrayExpression') return node.elements.every(staticValue);
  if (node.type === 'ObjectExpression') return node.properties.every((property: any) =>
    property.type === 'Property' && property.kind === 'init' && !property.computed && staticValue(property.value));
  return false;
}
