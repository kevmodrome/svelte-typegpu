<script lang="ts">
  import { onNodeEvent, type TypeGpuAttachment, type TypeGpuNodeEventListener } from 'svelte-typegpu';

  export const listen: TypeGpuAttachment = node => {
    const controller = new AbortController();
    const listener: TypeGpuNodeEventListener = {
      handleEvent(event) { event.currentTarget?.attributes; event.preventDefault(); }
    };
    onNodeEvent(node, 'click', listener, { once: true, signal: controller.signal });
    onNodeEvent(node, 'pointermove', function (event) {
      this.uid.toFixed(); event.currentTarget?.uid.toFixed();
      // @ts-expect-error Scene currentTarget is not an HTMLElement.
      event.currentTarget?.focus();
    }, { capture: true, passive: true, signal: controller.signal });
    // @ts-expect-error Listener flags must be booleans.
    onNodeEvent(node, 'click', listener, { once: 'yes' });
    // @ts-expect-error Cancellation requires an AbortSignal.
    onNodeEvent(node, 'click', listener, { signal: controller });
    return () => controller.abort();
  };
</script>
