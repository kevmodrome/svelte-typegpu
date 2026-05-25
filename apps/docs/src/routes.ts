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
