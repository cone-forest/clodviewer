import * as THREE from 'three';
import type { MeshData } from '../../types';

const RENDER_SIZE = 512;

export function buildGeometry(mesh: MeshData): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();
  const vertices = mesh.vertices.flat();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  geometry.setIndex(mesh.indices);
  geometry.computeVertexNormals();
  return geometry;
}

function addMeshToScene(scene: THREE.Scene, meshData: MeshData, color: number): THREE.Mesh {
  const geometry = buildGeometry(meshData);
  const material = new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide });
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
  camera.position.set(center.x + maxDim, center.y + maxDim * 0.5, center.z + maxDim);
  camera.lookAt(center);
  camera.updateProjectionMatrix();
}

export function renderMeshToTarget(
  scene: THREE.Scene,
  camera: THREE.PerspectiveCamera,
  renderer: THREE.WebGLRenderer,
  meshData: MeshData,
  target: THREE.WebGLRenderTarget,
  color: number
): void {
  scene.clear();
  const mesh = addMeshToScene(scene, meshData, color);
  renderer.setRenderTarget(target);
  renderer.clear();
  renderer.render(scene, camera);
  renderer.setRenderTarget(null);
  mesh.geometry.dispose();
  (mesh.material as THREE.Material).dispose();
  scene.remove(mesh);
}

export function diffRenderTargets(
  renderer: THREE.WebGLRenderer,
  refTarget: THREE.WebGLRenderTarget,
  libTarget: THREE.WebGLRenderTarget,
  outputCanvas: HTMLCanvasElement
): void {
  const w = refTarget.width;
  const h = refTarget.height;
  outputCanvas.width = w;
  outputCanvas.height = h;
  const ctx = outputCanvas.getContext('2d');
  if (!ctx) return;

  const refPixels = new Uint8Array(w * h * 4);
  const libPixels = new Uint8Array(w * h * 4);
  renderer.readRenderTargetPixels(refTarget, 0, 0, w, h, refPixels);
  renderer.readRenderTargetPixels(libTarget, 0, 0, w, h, libPixels);

  const imageData = ctx.createImageData(w, h);
  for (let i = 0; i < w * h * 4; i += 4) {
    const dr = Math.abs(libPixels[i] - refPixels[i]);
    const dg = Math.abs(libPixels[i + 1] - refPixels[i + 1]);
    const db = Math.abs(libPixels[i + 2] - refPixels[i + 2]);
    const diff = Math.min(255, (dr + dg + db) * 2);
    imageData.data[i] = diff;
    imageData.data[i + 1] = 0;
    imageData.data[i + 2] = 0;
    imageData.data[i + 3] = 255;
  }
  ctx.putImageData(imageData, 0, 0);
}

export function renderComparison(
  meshRef: MeshData,
  mesh1: MeshData,
  mesh2: MeshData,
  canvasLeft: HTMLCanvasElement,
  canvasRight: HTMLCanvasElement
): void {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x111111);
  const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 10000);
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
  renderer.setSize(RENDER_SIZE, RENDER_SIZE);

  setupCameraFromMesh(camera, meshRef);

  const targetRef = new THREE.WebGLRenderTarget(RENDER_SIZE, RENDER_SIZE);
  const target1 = new THREE.WebGLRenderTarget(RENDER_SIZE, RENDER_SIZE);
  const target2 = new THREE.WebGLRenderTarget(RENDER_SIZE, RENDER_SIZE);

  renderMeshToTarget(scene, camera, renderer, meshRef, targetRef, 0x888888);
  renderMeshToTarget(scene, camera, renderer, mesh1, target1, 0xcccccc);
  renderMeshToTarget(scene, camera, renderer, mesh2, target2, 0xcccccc);

  diffRenderTargets(renderer, targetRef, target1, canvasLeft);
  diffRenderTargets(renderer, targetRef, target2, canvasRight);

  targetRef.dispose();
  target1.dispose();
  target2.dispose();
  renderer.dispose();
}
