export const enum Dirty {
  None = 0,
  Tree = 1 << 0,
  Transform = 1 << 1,
  InstanceData = 1 << 2,
  DrawBatches = 1 << 3,
  Geometry = 1 << 4,
  Material = 1 << 5,
  MaterialUniform = 1 << 6,
  Texture = 1 << 7,
  BindGroup = 1 << 8,
  Pipeline = 1 << 9,
  Lights = 1 << 10,
  Camera = 1 << 11,
  Interaction = 1 << 12,
  RenderSettings = 1 << 13,
  Sampler = 1 << 14,
  ShaderPass = 1 << 15,
  FrameTasks = 1 << 16,
  All = -1
}

export function hasDirty(mask: Dirty, flag: Dirty): boolean {
  return (mask & flag) !== 0;
}

export function mergeDirty(...masks: Dirty[]): Dirty {
  return masks.reduce((merged, mask) => (merged | mask) as Dirty, Dirty.None);
}
