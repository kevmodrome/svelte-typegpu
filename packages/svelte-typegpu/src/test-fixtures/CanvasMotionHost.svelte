<script lang="ts">
  import Canvas from '../Canvas.svelte';
  import { createAttachmentKey } from 'svelte/attachments';

  let { Scene, motion, setup, domSetup, onready, onerror, frameloop } = $props();
  const attachment = createAttachmentKey();
  let label = $state('Moving scene');
  export function rename(value: string) { label = value; }
</script>

<Canvas
  scene={Scene}
  sceneProps={{ motion, setup }}
  options={{ frameloop, maxDevicePixelRatio: 1 }}
  canvasProps={{
    'data-motion': motion.current,
    'aria-label': label,
    class: { moving: motion.current > 0 },
    [attachment]: domSetup
  }}
  {onready}
  {onerror}
/>
