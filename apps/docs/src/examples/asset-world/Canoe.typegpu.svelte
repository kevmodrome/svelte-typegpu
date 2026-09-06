<script lang="ts">
  import type { TypeGpuFrameContext, TypeGpuLoadedModel } from 'svelte-typegpu';
  import { canoePosition } from './world';
  let { asset, paused = false, onselect = () => {} }: {
    asset: TypeGpuLoadedModel; paused?: boolean; onselect?: () => void;
  } = $props();
  let phase = $state(0);
  function update({ delta }: TypeGpuFrameContext) { phase = (phase + delta) % (Math.PI * 20); }
</script>

<frameTask {update} active={!paused} />
<model name="canoe" {asset} scale={2.6} castShadow receiveShadow
  position={[canoePosition[0], canoePosition[1] + Math.sin(phase * 1.5) * 0.045, canoePosition[2]]}
  rotation={[Math.sin(phase) * 0.025, -0.2, Math.sin(phase * 1.3) * 0.025]}
  onclick={onselect} />
