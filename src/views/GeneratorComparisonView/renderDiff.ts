import * as THREE from 'three';
import type { MeshData } from '../../types';

export const DEFAULT_RENDER_SIZE = 512;

export function buildGeometry(mesh: MeshData): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();
  const vertices = mesh.vertices.flat();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  geometry.setIndex(mesh.indices);
  geometry.computeVertexNormals();
  return geometry;
}

function addLights(scene: THREE.Scene, center: THREE.Vector3, size: number): void {
  const ambient = new THREE.AmbientLight(0x404040, 0.6);
  scene.add(ambient);
  const directional = new THREE.DirectionalLight(0xffffff, 0.8);
  directional.position.set(center.x + size, center.y + size * 0.5, center.z + size);
  directional.target.position.copy(center);
  directional.target.updateMatrixWorld();
  scene.add(directional);
  scene.add(directional.target);
}

function addMeshToScene(scene: THREE.Scene, meshData: MeshData, color: number): THREE.Mesh {
  const geometry = buildGeometry(meshData);
  const material = new THREE.MeshPhongMaterial({
    color,
    side: THREE.DoubleSide,
    shininess: 40,
    specular: 0x444444,
  });
  const mesh = new THREE.Mesh(geometry, material);
  scene.add(mesh);
  return mesh;
}

export function setupCameraFromMesh(camera: THREE.PerspectiveCamera, meshData: MeshData): void {
  const geometry = buildGeometry(meshData);
  const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial());
  const box = new THREE.Box3().setFromObject(mesh);
  geometry.dispose();
  const center = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3());
  const maxDim = Math.max(size.x, size.y, size.z, 1e-6);
  camera.up.set(0, 1, 0);
  camera.position.set(center.x + maxDim, center.y + maxDim * 0.5, center.z + maxDim);
  camera.lookAt(center);
  camera.updateProjectionMatrix();
}

/** Returns bounding box center and max dimension for lighting. */
function getMeshBounds(meshData: MeshData): { center: THREE.Vector3; maxDim: number } {
  const geometry = buildGeometry(meshData);
  const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial());
  const box = new THREE.Box3().setFromObject(mesh);
  geometry.dispose();
  const center = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3());
  const maxDim = Math.max(size.x, size.y, size.z, 1e-6);
  return { center, maxDim };
}

export function renderMeshToTarget(
  scene: THREE.Scene,
  camera: THREE.PerspectiveCamera,
  renderer: THREE.WebGLRenderer,
  meshData: MeshData,
  target: THREE.WebGLRenderTarget,
  color: number,
  lightCenter: THREE.Vector3,
  lightSize: number
): void {
  scene.clear();
  const mesh = addMeshToScene(scene, meshData, color);
  addLights(scene, lightCenter, lightSize);
  renderer.setRenderTarget(target);
  renderer.clear();
  renderer.render(scene, camera);
  renderer.setRenderTarget(null);
  mesh.geometry.dispose();
  (mesh.material as THREE.Material).dispose();
  scene.remove(mesh);
  // Remove lights (ambient + directional + target)
  while (scene.children.length > 0) scene.remove(scene.children[0]);
}

function readPixelsFromTarget(
  renderer: THREE.WebGLRenderer,
  target: THREE.WebGLRenderTarget,
  buffer: Uint8Array
): void {
  const w = target.width;
  const h = target.height;
  renderer.setRenderTarget(target);
  renderer.readRenderTargetPixels(target, 0, 0, w, h, buffer);
  renderer.setRenderTarget(null);
}

export function diffRenderTargets(
  refPixels: Uint8Array,
  libPixels: Uint8Array,
  width: number,
  height: number,
  outputCanvas: HTMLCanvasElement
): void {
  outputCanvas.width = width;
  outputCanvas.height = height;
  const ctx = outputCanvas.getContext('2d');
  if (!ctx) return;

  const imageData = ctx.createImageData(width, height);
  for (let y = 0; y < height; y++) {
    const srcY = height - 1 - y;
    for (let x = 0; x < width; x++) {
      const srcIdx = (srcY * width + x) * 4;
      const dstIdx = (y * width + x) * 4;
      const dr = Math.abs(libPixels[srcIdx] - refPixels[srcIdx]);
      const dg = Math.abs(libPixels[srcIdx + 1] - refPixels[srcIdx + 1]);
      const db = Math.abs(libPixels[srcIdx + 2] - refPixels[srcIdx + 2]);
      const diff = Math.min(255, (dr + dg + db) * 2);
      imageData.data[dstIdx] = diff;
      imageData.data[dstIdx + 1] = 0;
      imageData.data[dstIdx + 2] = 0;
      imageData.data[dstIdx + 3] = 255;
    }
  }
  ctx.putImageData(imageData, 0, 0);
}

export interface RenderComparisonOptions {
  showDiff?: boolean;
  size?: number;
}

export function renderComparison(
  meshRef: MeshData,
  mesh1: MeshData,
  mesh2: MeshData,
  canvasLeft: HTMLCanvasElement,
  canvasRight: HTMLCanvasElement,
  options: RenderComparisonOptions = {}
): void {
  const { showDiff = true, size = DEFAULT_RENDER_SIZE } = options;
  const pixelCount = size * size * 4;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x111111);
  const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 10000);
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
  renderer.setSize(size, size);
  renderer.setClearColor(0x111111, 1);

  setupCameraFromMesh(camera, meshRef);
  const { center: lightCenter, maxDim: lightSize } = getMeshBounds(meshRef);

  const targetRef = new THREE.WebGLRenderTarget(size, size);
  const target1 = new THREE.WebGLRenderTarget(size, size);
  const target2 = new THREE.WebGLRenderTarget(size, size);

  // Render each mesh and read pixels immediately so content is not lost when switching targets
  renderMeshToTarget(scene, camera, renderer, meshRef, targetRef, 0x888888, lightCenter, lightSize);
  const refPixels = new Uint8Array(pixelCount);
  readPixelsFromTarget(renderer, targetRef, refPixels);

  renderMeshToTarget(scene, camera, renderer, mesh1, target1, 0xcccccc, lightCenter, lightSize);
  const pixels1 = new Uint8Array(pixelCount);
  readPixelsFromTarget(renderer, target1, pixels1);

  renderMeshToTarget(scene, camera, renderer, mesh2, target2, 0xcccccc, lightCenter, lightSize);
  const pixels2 = new Uint8Array(pixelCount);
  readPixelsFromTarget(renderer, target2, pixels2);

  if (showDiff) {
    diffRenderTargets(refPixels, pixels1, size, size, canvasLeft);
    diffRenderTargets(refPixels, pixels2, size, size, canvasRight);
  } else {
    const ctxLeft = canvasLeft.getContext('2d');
    const ctxRight = canvasRight.getContext('2d');
    if (ctxLeft && ctxRight) {
      canvasLeft.width = size;
      canvasLeft.height = size;
      canvasRight.width = size;
      canvasRight.height = size;
      const imageData1 = ctxLeft.createImageData(size, size);
      const imageData2 = ctxRight.createImageData(size, size);
      for (let y = 0; y < size; y++) {
        const srcY = size - 1 - y;
        for (let x = 0; x < size; x++) {
          const srcIdx = (srcY * size + x) * 4;
          const dstIdx = (y * size + x) * 4;
          imageData1.data[dstIdx] = pixels1[srcIdx];
          imageData1.data[dstIdx + 1] = pixels1[srcIdx + 1];
          imageData1.data[dstIdx + 2] = pixels1[srcIdx + 2];
          imageData1.data[dstIdx + 3] = pixels1[srcIdx + 3];
          imageData2.data[dstIdx] = pixels2[srcIdx];
          imageData2.data[dstIdx + 1] = pixels2[srcIdx + 1];
          imageData2.data[dstIdx + 2] = pixels2[srcIdx + 2];
          imageData2.data[dstIdx + 3] = pixels2[srcIdx + 3];
        }
      }
      ctxLeft.putImageData(imageData1, 0, 0);
      ctxRight.putImageData(imageData2, 0, 0);
    }
  }

  targetRef.dispose();
  target1.dispose();
  target2.dispose();
  renderer.dispose();
}
