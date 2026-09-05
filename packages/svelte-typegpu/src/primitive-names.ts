const aliases = new Map<string, string>([
  ['perspective-camera', 'perspectiveCamera'],
  ['orthographic-camera', 'orthographicCamera'],
  ['orbit-controls', 'orbitControls'],
  ['ambient-light', 'ambientLight'],
  ['hemisphere-light', 'hemisphereLight'],
  ['directional-light', 'directionalLight'],
  ['point-light', 'pointLight'],
  ['spot-light', 'spotLight'],
  ['box-geometry', 'boxGeometry'],
  ['plane-geometry', 'planeGeometry'],
  ['sphere-geometry', 'sphereGeometry'],
  ['buffer-geometry', 'bufferGeometry'],
  ['basic-material', 'basicMaterial'],
  ['phong-material', 'phongMaterial'],
  ['standard-material', 'standardMaterial'],
  ['shader-material', 'shaderMaterial'],
  ['shader-pass', 'shaderPass'],
  ['frame-task', 'frameTask']
]);

export function normalizePrimitiveName(name: string): string {
  return aliases.get(name) ?? name;
}
