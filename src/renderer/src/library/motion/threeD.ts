import type { MotionPresetDef } from '../motionPresets';

const presets: MotionPresetDef[] = [
  {
    id: '3d-logo-card',
    name: '3D logo reveal',
    category: '3d',
    about: 'Your logo on a glossy card spins in under moving lights, with a soft glow.',
    duration: 5,
    params: [
      { id: 'logo', type: 'image', label: 'Logo', default: '', brand: 'logo' },
      { id: 'text', type: 'text', label: 'Text', default: 'YOUR BRAND', brand: 'name' },
      { id: 'card', type: 'color', label: 'Card colour', default: '#15171f', brand: 'background' },
      { id: 'face', type: 'color', label: 'Text colour', default: '#ffffff', brand: 'text' },
      { id: 'light', type: 'color', label: 'Light colour', default: '#7c5cff', brand: 'primary' },
      { id: 'rim', type: 'color', label: 'Rim light', default: '#22d3ee', brand: 'secondary' },
      { id: 'font', type: 'font', label: 'Font', default: 'Montserrat Variable', brand: 'heading' },
      { id: 'glow', type: 'toggle', label: 'Glow', default: true },
    ],
    code: String.raw`import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

export default async function setup(k) {
  const p = k.params;
  await k.font('800 120px "' + p.font + '"');
  const renderer = k.three(THREE);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(32, k.width / k.height, 0.1, 100);
  camera.position.set(0, 0, 7);
  // Fit the card in narrow frames too.
  const visibleW = 2 * Math.tan(THREE.MathUtils.degToRad(16)) * 7 * camera.aspect;
  const fit = Math.min(1, (visibleW * 0.78) / 3.2);
  const group = new THREE.Group();
  group.scale.setScalar(fit);
  scene.add(group);
  const body = new THREE.Mesh(new RoundedBoxGeometry(3.2, 2, 0.22, 6, 0.12), new THREE.MeshStandardMaterial({ color: p.card, metalness: 0.55, roughness: 0.28 }));
  group.add(body);

  // Face: the logo (or the text) drawn on a canvas texture.
  const face = document.createElement('canvas');
  face.width = 1024;
  face.height = 640;
  const g = face.getContext('2d');
  if (p.logo) {
    const img = p.logo;
    const sc = Math.min((face.width * 0.7) / img.width, (face.height * 0.62) / img.height);
    g.drawImage(img, (face.width - img.width * sc) / 2, (face.height - img.height * sc) / 2, img.width * sc, img.height * sc);
  } else {
    g.fillStyle = p.face;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    const size = k.fitText(g, p.text, face.width * 0.8, (px) => '800 ' + px + 'px "' + p.font + '"', { max: 150 });
    g.font = '800 ' + size + 'px "' + p.font + '"';
    g.fillText(p.text, face.width / 2, face.height / 2);
  }
  const tex = new THREE.CanvasTexture(face);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  const front = new THREE.Mesh(new THREE.PlaneGeometry(3.0, 1.875), new THREE.MeshStandardMaterial({ map: tex, transparent: true, metalness: 0.1, roughness: 0.4, emissive: new THREE.Color('#ffffff'), emissiveMap: tex, emissiveIntensity: 0.12 }));
  front.position.z = 0.115;
  group.add(front);

  scene.add(new THREE.AmbientLight('#ffffff', 0.35));
  const key = new THREE.PointLight(p.light, 40);
  scene.add(key);
  const rim = new THREE.PointLight(p.rim, 50);
  rim.position.set(-3, 2, -2);
  scene.add(rim);
  const fill = new THREE.DirectionalLight('#ffffff', 1.2);
  fill.position.set(0, 1, 5);
  scene.add(fill);

  const composer = new EffectComposer(renderer);
  composer.setSize(k.width, k.height);
  composer.addPass(new RenderPass(scene, camera));
  if (p.glow) composer.addPass(new UnrealBloomPass(new THREE.Vector2(k.width, k.height), 0.35, 0.25, 0.62));
  composer.addPass(new OutputPass());

  return (t) => {
    const spin = k.ease.outCubic(k.progress(t, 0, 1.8));
    const out = k.ease.inBack(k.progress(t, k.duration - 0.6, k.duration));
    group.rotation.y = (1 - spin) * -Math.PI * 1.5 + Math.sin(t * 1.3) * 0.12 * spin + out * Math.PI * 0.5;
    group.rotation.x = Math.sin(t * 0.9) * 0.06 * spin;
    group.position.y = Math.sin(t * 1.6) * 0.06;
    group.scale.setScalar(fit * Math.max(0.0001, (0.6 + 0.4 * k.ease.outBack(k.progress(t, 0, 0.9))) * (1 - out)));
    key.position.set(-4 + 8 * k.progress(t, 0.6, k.duration), 1.5, 3);
    composer.render();
  };
}
`,
  },
  {
    id: '3d-floating-shapes',
    name: 'Floating shapes',
    category: '3d',
    about: 'Glossy 3D shapes drift and turn slowly: a background or a backdrop for titles.',
    duration: 8,
    params: [
      { id: 'a', type: 'color', label: 'Colour 1', default: '#7c5cff', brand: 'primary' },
      { id: 'b', type: 'color', label: 'Colour 2', default: '#22d3ee', brand: 'secondary' },
      { id: 'c', type: 'color', label: 'Colour 3', default: '#ffb020', brand: 'accent' },
      { id: 'count', type: 'number', label: 'Shapes', default: 14, min: 4, max: 40, step: 1 },
      { id: 'background', type: 'toggle', label: 'Background', default: true },
      { id: 'bg', type: 'color', label: 'Fill colour', default: '#0f1117', brand: 'background' },
    ],
    code: String.raw`import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

export default function setup(k) {
  const p = k.params;
  const renderer = k.three(THREE);
  const scene = new THREE.Scene();
  if (p.background) scene.background = new THREE.Color(p.bg);
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  const camera = new THREE.PerspectiveCamera(40, k.width / k.height, 0.1, 100);
  camera.position.set(0, 0, 12);
  const geos = [new THREE.TorusGeometry(0.7, 0.28, 32, 96), new THREE.SphereGeometry(0.8, 48, 32), new THREE.IcosahedronGeometry(0.85, 0), new THREE.TorusKnotGeometry(0.55, 0.2, 128, 24), new THREE.CapsuleGeometry(0.45, 0.8, 8, 24)];
  const colors = [p.a, p.b, p.c];
  const spreadX = 7 * Math.max(1, camera.aspect);
  const spreadY = 7 / Math.min(1, camera.aspect);
  const items = Array.from({ length: p.count }, (_, i) => {
    const mesh = new THREE.Mesh(geos[i % geos.length], new THREE.MeshPhysicalMaterial({ color: colors[i % 3], roughness: 0.18, metalness: 0.1, clearcoat: 1, clearcoatRoughness: 0.1 }));
    const it = {
      mesh,
      x: (k.rand(i, 1) - 0.5) * spreadX * 1.6,
      y: (k.rand(i, 2) - 0.5) * spreadY * 1.4,
      z: -k.rand(i, 3) * 6,
      rx: k.rand(i, 4) * 6,
      ry: k.rand(i, 5) * 6,
      sp: 0.2 + k.rand(i, 6) * 0.5,
      ph: k.rand(i, 7) * Math.PI * 2,
      sc: 0.6 + k.rand(i, 8) * 0.8,
    };
    scene.add(mesh);
    return it;
  });
  scene.add(new THREE.AmbientLight('#ffffff', 0.4));
  const dir = new THREE.DirectionalLight('#ffffff', 2);
  dir.position.set(3, 5, 6);
  scene.add(dir);

  // Drift and turn in whole cycles over the clip, so it loops (after the shapes grow in).
  const cyc = (t) => (t / k.duration) * Math.PI * 2;
  return (t) => {
    const a = cyc(t);
    for (const it of items) {
      it.mesh.position.set(it.x + Math.sin(a + it.ph) * 0.4, it.y + Math.sin(a * 2 + it.ph) * 0.5, it.z);
      it.mesh.rotation.set(it.rx + a, it.ry + a * (it.sp > 0.45 ? 2 : 1), 0);
      it.mesh.scale.setScalar(it.sc * k.ease.outBack(k.progress(t, 0, 0.6 + it.sp)));
    }
    renderer.render(scene, camera);
  };
}
`,
  },
];

export default presets;
