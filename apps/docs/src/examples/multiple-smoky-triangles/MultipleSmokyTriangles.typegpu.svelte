<script lang="ts">
  import Triangle from './Triangle.typegpu.svelte';
  import type { RgbaTuple, Vector3Tuple } from 'svelte-typegpu';

  interface TriangleCell {
    id: string;
    position: Vector3Tuple;
    rotation: Vector3Tuple;
    scale: Vector3Tuple;
    color: RgbaTuple;
    smoky: boolean;
  }

  const triangles: TriangleCell[] = createTriangleLattice();

  function createTriangleLattice(): TriangleCell[] {
    const cells: TriangleCell[] = [];
    const columns = 8;
    const rows = 6;
    const width = 0.96;
    const height = 1.17;
    const originX = -3.35;
    const originY = 1.75;

    for (let row = 0; row < rows; row += 1) {
      const rowOffset = row % 2 === 0 ? 0 : width * 0.5;
      for (let column = 0; column < columns; column += 1) {
        const x = originX + column * width + rowOffset;
        const y = originY - row * height;
        const firstTriangleIndex = column * 2;

        cells.push({
          id: `${row}:${column}:up`,
          position: [x, y, 0],
          rotation: [0, 0, 0],
          scale: [width, height, 1],
          color: randomColorForTriangle(row, column, 0),
          smoky: firstTriangleIndex % 2 === 1
        });
        cells.push({
          id: `${row}:${column}:down`,
          position: [x + width * 0.5, y, 0],
          rotation: [0, 0, Math.PI],
          scale: [width, height, 1],
          color: randomColorForTriangle(row, column, 1),
          smoky: (firstTriangleIndex + 1) % 2 === 1
        });
      }
    }

    return cells;
  }

  function randomColorForTriangle(row: number, column: number, orientation: number): RgbaTuple {
    const phase = hashTriangleSeed(row, column, orientation);
    const seedX = hashTriangleSeed(row + 7, column + 3, orientation + 11);
    const seedY = hashTriangleSeed(row + 13, column + 17, orientation + 5);

    return [phase, seedX, seedY, 1];
  }

  function hashTriangleSeed(row: number, column: number, orientation: number): number {
    const value = Math.sin(row * 127.1 + column * 311.7 + orientation * 74.7) * 43758.5453;

    return value - Math.floor(value);
  }
</script>

<scene clearColor={[0, 0, 0, 1]}>
  <perspectiveCamera
    id="main"
    active={true}
    position={[0, 0, 4]}
    target={[0, 0, 0]}
    fov={45}
    near={0.1}
    far={20}
  ></perspectiveCamera>

  {#each triangles as triangle (triangle.id)}
    <Triangle
      id={triangle.id}
      position={triangle.position}
      rotation={triangle.rotation}
      scale={triangle.scale}
      color={triangle.color}
      smoky={triangle.smoky}
    />
  {/each}
</scene>
