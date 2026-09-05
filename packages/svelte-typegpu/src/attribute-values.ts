type Schema = 'tuple' | 'vector' | 'bounds' | 'uniforms' | 'map' | 'sampler';

const schemas = new Map<string, Schema>([
  ...['position', 'rotation', 'scale', 'target', 'lookAt'].map((name): [string, Schema] => [name, 'vector']),
  ...['color', 'clearColor', 'background', 'skyColor', 'groundColor', 'quaternion', 'matrix'].map(
    (name): [string, Schema] => [name, 'tuple']),
  ['bounds', 'bounds'], ['uniforms', 'uniforms'], ['map', 'map'], ['texture', 'map'], ['sampler', 'sampler']
]);
const fields = {
  vector: ['x', 'y', 'z'],
  bounds: ['min', 'max'],
  uniforms: ['time', 'resolution', 'value0', 'value1', 'value2', 'value3', 'value4', 'value5', 'value6', 'value7'],
  map: ['kind', 'key', 'src', 'data', 'width', 'height', 'format', 'mimeType'],
  sampler: ['key', 'magFilter', 'minFilter', 'mipmapFilter', 'addressModeU', 'addressModeV', 'addressModeW']
} as const;
const snapshots = new WeakMap<object, Map<string, unknown>>();

export function attributeSchema(name: string): Schema | undefined {
  return schemas.get(name);
}

/** Called inside Svelte's existing attribute effect, before its identity cache. */
export function value(name: string, input: unknown): unknown {
  const schema = schemas.get(name);
  return schema ? snapshot(input, schema) : input;
}

export function props(input: unknown): unknown {
  if (!input || typeof input !== 'object') return input;
  const source = input as Record<PropertyKey, unknown>;
  // Do not retain spread callbacks/assets in a cache keyed by a potentially
  // long-lived external props object. Svelte already owns the spread's lifetime.
  const result = Object.create(null) as Record<PropertyKey, unknown>;
  for (const key of Reflect.ownKeys(source)) {
    if (!Object.prototype.propertyIsEnumerable.call(source, key)) continue;
    result[key] = typeof key === 'string' ? value(key, source[key]) : source[key];
  }
  return result;
}

function snapshot(input: unknown, schema: Schema): unknown {
  if (!input || typeof input !== 'object') return input;
  if (Array.isArray(input)) return schema === 'tuple' || schema === 'vector' ? tuple(input) : input;
  if (schema === 'tuple' || ArrayBuffer.isView(input)) return input;
  return record(input as Record<string, unknown>, schema);
}

function cacheFor(input: object): Map<string, unknown> {
  let cache = snapshots.get(input);
  if (!cache) snapshots.set(input, cache = new Map());
  return cache;
}

function tuple(input: unknown[]): unknown[] {
  const length = input.length;
  if (length > 32) return input;
  const cache = cacheFor(input);
  const previous = cache.get('tuple') as unknown[] | undefined;
  let next = previous?.length === length ? previous : new Array<unknown>(length);
  for (let index = 0; index < length; index++) {
    const item = input[index];
    if (next === previous && !Object.is(item, previous[index])) next = previous.slice();
    if (next !== previous) next[index] = item;
  }
  if (next !== previous) cache.set('tuple', next);
  return next;
}

function record(
  input: Record<string, unknown>, schema: Exclude<Schema, 'tuple'>
): Record<PropertyKey, unknown> {
  // Keep texture identity stable while consumed, without retaining large byte
  // arrays solely through a long-lived external descriptor after unmount.
  const cache = cacheFor(input);
  const cached = cache.get(schema);
  const previous = (schema === 'map'
    ? (cached as WeakRef<Record<PropertyKey, unknown>> | undefined)?.deref()
    : cached) as Record<PropertyKey, unknown> | undefined;
  let next = previous ?? Object.create(null) as Record<PropertyKey, unknown>;
  for (const key of fields[schema]) {
    const present = key in input;
    const field = input[key];
    const item = schema === 'bounds' ? snapshot(field, 'vector') :
      schema === 'uniforms' && Array.isArray(field) ? tuple(field) : field;
    if (next === previous && (present !== Object.hasOwn(previous!, key) || !Object.is(item, previous![key]))) {
      next = Object.assign(Object.create(null), previous);
    }
    if (next !== previous) {
      if (present) next[key] = item;
      else delete next[key];
    }
  }
  if (next !== previous) cache.set(schema, schema === 'map' ? new WeakRef(next) : next);
  return next;
}
