<script lang="ts">
  import type { TypeGpuFrameContext } from 'svelte-typegpu';
  import { stepGravity, type GravityBody } from './gravity-simulation';

  let { bodies = $bindable(), speed = 1, active = true }: {
    bodies: GravityBody[];
    speed?: number;
    active?: boolean;
  } = $props();

  function update({ delta }: TypeGpuFrameContext) {
    if (delta > 0) bodies = stepGravity(bodies, delta, speed);
  }
</script>

<frameTask {update} {active} />
