import { Mochi } from 'mochi-framework';
import { htmlShell } from './html-shell';
import { routes } from './routes';

const port = Number(Bun.env.PORT ?? 3333);
const development = Bun.env.MODE === 'development' || Bun.env.NODE_ENV !== 'production';

await Mochi.serve({
  hostname: '127.0.0.1',
  port,
  development,
  htmlShell,
  routes,
  svelteConfigPath: './svelte.config.js'
});

console.log(`svelte-typegpu docs listening on http://127.0.0.1:${port}`);
