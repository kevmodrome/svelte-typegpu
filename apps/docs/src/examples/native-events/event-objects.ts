import type { Vector3Tuple } from 'svelte-typegpu';

export interface EventObject {
  name: string;
  color: Vector3Tuple;
  x: number;
  angle: number;
  size: number;
}

export interface NativeEventsProps {
  objects: readonly Readonly<EventObject>[];
  selected: number;
  bubbleClicks: boolean;
  onselect: (index: number) => void;
  onresize: (index: number, delta: number) => void;
  onreset: (index: number) => void;
  onhover: (name: string | null) => void;
  onevent: (name: string) => void;
  onpath: (phase: string, reset?: boolean) => void;
}

export function createEventObjects(): EventObject[] {
  return [
    { name: 'Coral', color: [0.94, 0.24, 0.2], x: -2.8, angle: 0, size: 1 },
    { name: 'Jade', color: [0.15, 0.76, 0.46], x: 0, angle: 0, size: 1 },
    { name: 'Cobalt', color: [0.22, 0.48, 0.96], x: 2.8, angle: 0, size: 1 }
  ];
}

export function resizeObject(object: EventObject, delta: number) {
  object.size = Math.max(0.6, Math.min(1.6, object.size + delta));
}

export function rotateObject(object: EventObject, delta: number) {
  object.angle = ((((object.angle + delta + 180) % 360) + 360) % 360) - 180;
}
