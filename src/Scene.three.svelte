<script lang="ts">
  import { formatHueColor, type SceneControls } from './lib/scene-controls';

  interface Props {
    controls: SceneControls;
    onCubeClick?: () => void;
  }

  let { controls, onCubeClick = () => {} }: Props = $props();
  let spin = $state(0);
  let color = $derived(formatHueColor(controls.hue));

  function activateFromKeyboard(event: KeyboardEvent) {
    if (event.key === 'Enter' || event.key === ' ') {
      onCubeClick();
    }
  }

  $effect(() => {
    if (!controls.spinEnabled || controls.spinSpeed <= 0) return;

    let frame = 0;
    let previous = performance.now();

    function tick(now: number) {
      const delta = Math.min(48, now - previous);
      previous = now;
      spin += (delta / 16.67) * 0.018 * controls.spinSpeed;
      frame = window.requestAnimationFrame(tick);
    }

    frame = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(frame);
  });
</script>

<scene background="#11141a">
  <perspectiveCamera position={[0, 1.4, 5]} fov={45} lookAt={[0, 0, 0]}></perspectiveCamera>
  <ambientLight args={['#ffffff', 0.65]}></ambientLight>
  <directionalLight args={['#ffffff', 2.25]} position={[3, 4, 4]}></directionalLight>

  <mesh
    role="button"
    tabindex="0"
    aria-label="Change cube color"
    rotation={[spin, spin * 0.8, 0]}
    scale={controls.cubeScale}
    onclick={onCubeClick}
    onkeydown={activateFromKeyboard}
  >
    <boxGeometry args={[1.5, 1.5, 1.5]}></boxGeometry>
    <meshStandardMaterial color={color} roughness={0.34} metalness={0.28}></meshStandardMaterial>
  </mesh>

  <mesh position={[0, -1.35, 0]} rotation={[-Math.PI / 2, 0, 0]}>
    <planeGeometry args={[6, 6]}></planeGeometry>
    <meshStandardMaterial color="#252a34" roughness={0.8} metalness={0.08}></meshStandardMaterial>
  </mesh>
</scene>
