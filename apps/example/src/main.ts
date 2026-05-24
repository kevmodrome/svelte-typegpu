import { mount, unmount } from 'svelte';
import App from './App.svelte';
import './style.css';

const target = document.querySelector<HTMLElement>('#app');

if (!target) {
  throw new Error('Missing #app target');
}

const app = mount(App, { target });

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    unmount(app);
  });
}
