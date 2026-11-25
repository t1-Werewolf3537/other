import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { SplatMesh } from '@sparkjsdev/spark';

const data = window.APP_DATA || {};
const container = document.getElementById('exterior-canvas');
const loaderEl = document.getElementById('ext-loader');
const titleEl = document.getElementById('extTitle');

if (titleEl && data.title) titleEl.textContent = data.title;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0b0d10);

const initCam = data.initialCamera || {};
const cPos = initCam.position || { x: 0, y: 1.5, z: 4.5 };
const cTgt = initCam.target || { x: 0, y: 0, z: 0 };

const camera = new THREE.PerspectiveCamera(
  initCam.fov || 45,
  window.innerWidth / window.innerHeight,
  0.1,
  500
);
camera.position.set(cPos.x, cPos.y, cPos.z);

const renderer = new THREE.WebGLRenderer({
  antialias: false,
  powerPreference: 'high-performance'
});
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
renderer.setSize(window.innerWidth, window.innerHeight);
container.appendChild(renderer.domElement);

renderer.domElement.addEventListener('touchstart', (e) => {
  if (e.cancelable) e.preventDefault();
}, { passive: false });

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.06;
controls.target.set(cTgt.x, cTgt.y, cTgt.z);

const lim = data.cameraLimits || {};
controls.minDistance = lim.minDistance ?? 1.2;
controls.maxDistance = lim.maxDistance ?? 20.0;
controls.minPolarAngle = lim.minPolarAngle ?? 0.1;
controls.maxPolarAngle = lim.maxPolarAngle ?? Math.PI * 0.48;
controls.enablePan = lim.enablePan !== false;

const maxPanR = lim.maxPanRadius ?? 8.0;
controls.addEventListener('change', () => {
  controls.target.y = Math.max(-0.2, Math.min(3.0, controls.target.y));
  const distXZ = Math.hypot(controls.target.x, controls.target.z);
  if (distXZ > maxPanR) {
    const scale = maxPanR / distXZ;
    controls.target.x *= scale;
    controls.target.z *= scale;
  }
});

const splat = new SplatMesh({
  url: data.modelUrl,
  onLoad: () => {
    if (loaderEl) loaderEl.classList.add('is-hidden');
  }
});
const rot = data.modelRotation || { x: Math.PI, y: 0, z: 0 };
const pos = data.modelPosition || { x: 0, y: 0, z: 0 };
splat.rotation.set(rot.x, rot.y, rot.z);
splat.position.set(pos.x, pos.y, pos.z);
scene.add(splat);

let flyAnim = null;
function flyToPreset(preset) {
  const startPos = camera.position.clone();
  const startTarget = controls.target.clone();
  const endPos = new THREE.Vector3(preset.position.x, preset.position.y, preset.position.z);
  const endTarget = new THREE.Vector3(preset.target.x, preset.target.y, preset.target.z);
  flyAnim = { startPos, startTarget, endPos, endTarget, t: 0 };
}

const presetsBar = document.getElementById('camera-presets-bar');
if (presetsBar && Array.isArray(data.presets)) {
  data.presets.forEach((p, idx) => {
    const btn = document.createElement('button');
    btn.className = 'preset-cam-btn' + (idx === 0 ? ' active' : '');
    btn.textContent = p.name;
    btn.addEventListener('click', () => {
      document.querySelectorAll('.preset-cam-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      flyToPreset(p);
    });
    presetsBar.appendChild(btn);
  });
}

const hotspotNodes = (data.hotspots3D || []).map(hs => {
  const el = document.createElement('div');
  el.className = 'ext-hotspot-3d';
  el.innerHTML = `<div class="ext-hs-title">${hs.title}</div>` +
    (hs.subtitle ? `<div class="ext-hs-sub">${hs.subtitle}</div>` : '');
  el.addEventListener('click', (e) => {
    e.stopPropagation();
    if (hs.tourUrl) window.open(hs.tourUrl, '_blank');
  });
  document.body.appendChild(el);
  return { el, pos3d: new THREE.Vector3(hs.position.x, hs.position.y, hs.position.z) };
});

const projVec = new THREE.Vector3();
function updateHotspots() {
  for (const item of hotspotNodes) {
    projVec.copy(item.pos3d).project(camera);
    if (projVec.z > 1) {
      item.el.style.display = 'none';
    } else {
      item.el.style.display = 'block';
      const x = (projVec.x * 0.5 + 0.5) * window.innerWidth;
      const y = (-projVec.y * 0.5 + 0.5) * window.innerHeight;
      item.el.style.left = `${x.toFixed(1)}px`;
      item.el.style.top = `${y.toFixed(1)}px`;
    }
  }
}

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

let lastTime = performance.now();
function animate(now) {
  requestAnimationFrame(animate);
  const dt = Math.min((now - lastTime) / 1000, 0.1);
  lastTime = now;

  if (flyAnim) {
    flyAnim.t = Math.min(1, flyAnim.t + dt * 1.4);
    const ease = 1 - Math.pow(1 - flyAnim.t, 3);
    camera.position.lerpVectors(flyAnim.startPos, flyAnim.endPos, ease);
    controls.target.lerpVectors(flyAnim.startTarget, flyAnim.endTarget, ease);
    if (flyAnim.t >= 1) flyAnim = null;
  }

  controls.update();
  updateHotspots();
  renderer.render(scene, camera);
}
animate(performance.now());
