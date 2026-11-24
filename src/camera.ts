import { Box3, MathUtils, OrthographicCamera, PerspectiveCamera, Vector3 } from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

export type CameraView = 'entry' | 'iso' | 'top' | 'bottom' | 'floor' | 'services';

export function createCamera(canvas: HTMLCanvasElement, bounds: Box3) {
  const camera = new OrthographicCamera(-25, 25, 15, -15, 0.05, 240);
  const eye = new PerspectiveCamera(60, 1, 0.035, 180);
  const orbit = new OrbitControls(camera, canvas);
  orbit.enableDamping = true;
  orbit.dampingFactor = 0.13;
  orbit.minPolarAngle = 0.01;
  orbit.maxPolarAngle = Math.PI - 0.05;
  orbit.minZoom = 0.42;
  orbit.maxZoom = 24;
  orbit.zoomToCursor = false;
  orbit.screenSpacePanning = true;
  const center = bounds.getCenter(new Vector3());
  const normal = new Vector3(0.53, 0.74, 1).normalize();
  const corners: Vector3[] = [];
  for (const x of [bounds.min.x, bounds.max.x]) {
    for (const y of [bounds.min.y, bounds.max.y]) {
      for (const z of [bounds.min.z, bounds.max.z]) corners.push(new Vector3(x, y, z));
    }
  }
  let aspect = 1;
  let section=false;
  function fit() {
    camera.updateMatrixWorld();
    const viewPoints = corners.map(p => {
      const corner=p.clone();
      if(section)corner.y=p.y===bounds.min.y?-4:8;
      return corner.applyMatrix4(camera.matrixWorldInverse);
    });
    const w = Math.max(...viewPoints.map(p => Math.abs(p.x))) * 2;
    const h = Math.max(...viewPoints.map(p => Math.abs(p.y))) * 2;
    const span = Math.max(w / aspect, h) * 1.07;
    camera.left = -span * aspect / 2;
    camera.right = -camera.left;
    camera.top = span / 2;
    camera.bottom = -camera.top;
    camera.updateProjectionMatrix();
  }
  function view(mode: CameraView) {
    section=mode==='services';
    if (mode === 'floor' || mode === 'entry') {
      orbit.object = eye;
      if (mode === 'entry') {
        eye.position.set(5.35, 1.65, 22.8);
        orbit.target.set(4.7, 1.15, 18.5);
      } else {
        eye.position.set(2, 1.65, 9.4);
        orbit.target.set(15, 1.36, 7.9);
      }
      eye.zoom = 1;
      eye.aspect = aspect;
      eye.updateProjectionMatrix();
      eye.lookAt(orbit.target);
      orbit.update();
      return;
    }
    orbit.object = camera;
    const dir = mode === 'top' ? new Vector3(0, 1, 0.001)
      : mode === 'bottom' ? new Vector3(0, -1, .035).normalize()
      : section ? new Vector3(.32,.17,1).normalize() : normal;
    orbit.target.copy(center);
    camera.position.copy(center).addScaledVector(dir, 56);
    camera.zoom = 1;
    camera.lookAt(center);
    orbit.update();
    fit();
  }
  function resize(width: number, height: number) {
    const nextAspect = width / Math.max(1, height);
    // Fit against the default scene bounds at any display shape without resetting the user's orbit.
    const wasOverview = camera.zoom === 1 && orbit.target.distanceToSquared(center) < .01;
    aspect = nextAspect;
    eye.aspect = aspect;
    eye.updateProjectionMatrix();
    if (wasOverview) fit();
    else {
      camera.left = -camera.top * aspect;
      camera.right = -camera.left;
      camera.updateProjectionMatrix();
    }
  }
  function zoom(factor: number) {
    const active = orbit.object === eye ? eye : camera;
    active.zoom = MathUtils.clamp(active.zoom * factor, orbit.minZoom, orbit.maxZoom);
    active.updateProjectionMatrix();
  }
  function focus(position: Vector3, span = 7) {
    if (orbit.object === eye) {
      const dir = eye.position.clone().sub(orbit.target).normalize();
      orbit.target.copy(position);
      eye.position.copy(position).addScaledVector(dir, span * .75);
      eye.position.y = 1.65;
      eye.lookAt(position);
      orbit.update();
      return;
    }
    const dir = camera.position.clone().sub(orbit.target).normalize();
    orbit.target.copy(position);
    camera.position.copy(position).addScaledVector(dir, 55);
    const available = Math.min(camera.top - camera.bottom, camera.right - camera.left);
    camera.zoom = MathUtils.clamp(available / span, orbit.minZoom, orbit.maxZoom);
    orbit.update();
    camera.updateProjectionMatrix();
  }
  function follow(position: Vector3) {
    const active = orbit.object === eye ? eye : camera;
    active.position.add(position.clone().sub(orbit.target));
    orbit.target.copy(position);
    orbit.update();
  }
  view('iso');
  return { get camera() { return orbit.object === eye ? eye : camera; }, orbit, resize, view, zoom, focus, follow };
}
