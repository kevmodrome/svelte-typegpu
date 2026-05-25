import { describe, expect, it } from 'vitest';
import { getDocsTransitionType } from './view-transitions';

describe('docs view transition routing', () => {
  it('classifies top-level docs navigation by route order', () => {
    expect(getDocsTransitionType('/', '/quickstart')).toBe('docs-forward');
    expect(getDocsTransitionType('/quickstart', '/examples')).toBe('docs-forward');
    expect(getDocsTransitionType('/examples', '/quickstart')).toBe('docs-back');
    expect(getDocsTransitionType('/quickstart', '/')).toBe('docs-back');
  });

  it('uses a dedicated transition for switching examples', () => {
    expect(getDocsTransitionType('/examples', '/examples/two-boxes')).toBe('docs-example');
    expect(getDocsTransitionType('/examples/two-boxes', '/examples/phong-reflection')).toBe(
      'docs-example'
    );
  });

  it('ignores non-docs and same-route navigation', () => {
    expect(getDocsTransitionType('/', '/')).toBeNull();
    expect(getDocsTransitionType('/examples/two-boxes', '/examples/two-boxes')).toBeNull();
    expect(getDocsTransitionType('/missing', '/examples')).toBeNull();
    expect(getDocsTransitionType('/examples', '/missing')).toBeNull();
  });
});
