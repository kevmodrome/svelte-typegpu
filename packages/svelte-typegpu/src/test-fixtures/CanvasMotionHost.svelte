<script lang="ts">
  import Canvas from '../Canvas.svelte';
  import { createAttachmentKey } from 'svelte/attachments';

  let { Scene, motion, setup, domSetup, onready, onerror, frameloop, maxDevicePixelRatio = 1 } = $props();
  const attachment = createAttachmentKey();
  let label = $state('Moving scene');
  export function rename(value: string) { label = value; }
  export function configure(mode: 'always' | 'demand' | 'manual', ratio: number) {
    frameloop = mode; maxDevicePixelRatio = ratio;
  }
</script>

<Canvas
  scene={Scene}
  sceneProps={{ motion, setup }}
  options={{ frameloop, maxDevicePixelRatio }}
  canvasProps={{
    'data-motion': motion.current,
    'aria-label': label,
    class: { moving: motion.current > 0 },
    [attachment]: domSetup
  }}
  {onready}
  {onerror}
/>
