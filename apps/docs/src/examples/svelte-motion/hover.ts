import { onNodeEvent, type TypeGpuAttachment } from 'svelte-typegpu';

export function trackHover(onChange: (hovered: boolean) => void): TypeGpuAttachment {
  return (node) => {
    const enter = onNodeEvent(node, 'pointerenter', () => onChange(true));
    const leave = onNodeEvent(node, 'pointerleave', () => onChange(false));
    return () => {
      enter();
      leave();
      onChange(false);
    };
  };
}
