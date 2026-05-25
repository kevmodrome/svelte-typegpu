type DocsTransitionType = 'docs-forward' | 'docs-back' | 'docs-example';

const routeOrder = ['/', '/quickstart', '/examples'] as const;

export function getDocsTransitionType(
  fromPath: string | null | undefined,
  toPath: string | null | undefined
): DocsTransitionType | null {
  const from = normalizeDocsPath(fromPath);
  const to = normalizeDocsPath(toPath);

  if (!from || !to || from === to) {
    return null;
  }

  if (isExamplesPath(from) && isExamplesPath(to)) {
    return 'docs-example';
  }

  const fromIndex = routeIndex(from);
  const toIndex = routeIndex(to);

  if (fromIndex === -1 || toIndex === -1 || fromIndex === toIndex) {
    return null;
  }

  return fromIndex < toIndex ? 'docs-forward' : 'docs-back';
}

export const viewTransitionHeadScript = `(() => {
  const routeOrder = ['/', '/quickstart', '/examples'];

  function normalizeDocsPath(path) {
    if (!path) return null;
    let pathname = path;
    try {
      pathname = new URL(path, location.origin).pathname;
    } catch {
      pathname = path;
    }
    if (pathname.length > 1 && pathname.endsWith('/')) {
      pathname = pathname.slice(0, -1);
    }
    if (pathname === '/' || pathname === '/quickstart' || pathname === '/examples' || pathname.startsWith('/examples/')) {
      return pathname;
    }
    return null;
  }

  function isExamplesPath(path) {
    return path === '/examples' || path.startsWith('/examples/');
  }

  function routeIndex(path) {
    return routeOrder.indexOf(isExamplesPath(path) ? '/examples' : path);
  }

  function getDocsTransitionType(fromPath, toPath) {
    const from = normalizeDocsPath(fromPath);
    const to = normalizeDocsPath(toPath);
    if (!from || !to || from === to) return null;
    if (isExamplesPath(from) && isExamplesPath(to)) return 'docs-example';
    const fromIndex = routeIndex(from);
    const toIndex = routeIndex(to);
    if (fromIndex === -1 || toIndex === -1 || fromIndex === toIndex) return null;
    return fromIndex < toIndex ? 'docs-forward' : 'docs-back';
  }

  function skipTransition(viewTransition) {
    viewTransition?.skipTransition?.();
  }

  function addTransitionType(viewTransition, type) {
    if (!viewTransition || !type) return;
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) {
      skipTransition(viewTransition);
      return;
    }
    viewTransition.types.add(type);
  }

  window.addEventListener('pageswap', (event) => {
    const nextUrl = event.activation?.entry?.url;
    const to = nextUrl ? new URL(nextUrl).pathname : null;
    addTransitionType(event.viewTransition, getDocsTransitionType(location.pathname, to));
  });

  window.addEventListener('pagereveal', (event) => {
    const fromUrl = navigation.activation?.from?.url;
    const from = fromUrl ? new URL(fromUrl).pathname : null;
    addTransitionType(event.viewTransition, getDocsTransitionType(from, location.pathname));
  });
})();`;

function normalizeDocsPath(path: string | null | undefined): string | null {
  if (!path) {
    return null;
  }

  let pathname = path;

  try {
    pathname = new URL(path, 'https://docs.local').pathname;
  } catch {
    pathname = path;
  }

  if (pathname.length > 1 && pathname.endsWith('/')) {
    pathname = pathname.slice(0, -1);
  }

  if (
    pathname === '/' ||
    pathname === '/quickstart' ||
    pathname === '/examples' ||
    pathname.startsWith('/examples/')
  ) {
    return pathname;
  }

  return null;
}

function isExamplesPath(path: string): boolean {
  return path === '/examples' || path.startsWith('/examples/');
}

function routeIndex(path: string): number {
  return routeOrder.indexOf(isExamplesPath(path) ? '/examples' : (path as (typeof routeOrder)[number]));
}
