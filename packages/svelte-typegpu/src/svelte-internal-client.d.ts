declare module 'svelte/internal/client' {
  // Test/build shim for Svelte PR internals used by renderer component tests.
  const client: any;
  export default client;
}
