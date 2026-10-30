// Tripo GLB → InstancedMesh：按 main.js 生成的 SLOTS 摆放（每个 GLB 子网格一个 InstancedMesh，低 draw call）
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';

// 每类：GLB 文件 -> 归一化（fit 哪个尺寸）+ 朝向修正
const KIND = {
  car_convertible_cream: { fit: 'len', size: 5.4, long: true },
  car_sedan_red:         { fit: 'len', size: 5.3, long: true },
  car_sedan_white:       { fit: 'len', size: 5.4, long: true },
  palm_a:                { fit: 'h', size: 1 },      // 单位高度，实例按 t.h 缩放
  palm_b:                { fit: 'h', size: 1 },
  flamingo_sign:         { fit: 'h', size: 1, long: true, glow: true },
  cafe_set:              { fit: 'w', size: 2.3 },
  awning_striped:        { fit: 'w', size: 1, long: true },
  deco_facade:           { fit: 'box' },
};
export async function loadSlots(world, SLOTS, { reveal, matOf, lite }) {
  const man = await (await fetch('./assets/manifest.json')).json();
  const loader = new GLTFLoader();
  const draco = new DRACOLoader().setDecoderPath('./vendor/three/jsm/libs/draco/gltf/');
  loader.setDRACOLoader(draco); loader.setMeshoptDecoder(MeshoptDecoder);
  const jobs = Object.entries(KIND).map(async ([key, k]) => {
    let list = SLOTS[key] || []; if (lite) list = list.filter(t => Math.abs(t.z) < 220);
    if (!list.length) return;
    const cfg = man[key] || {};
    let parts = null;
    if (cfg.file) try { parts = prep((await loader.loadAsync('./' + cfg.file)).scene, k, cfg); } catch (e) { console.warn('[slot] fail', key, e); }
    if (!parts) parts = fallback(key);
    for (const { geo, mat } of parts) {
      const m = new THREE.InstancedMesh(geo, mat, list.length);
      list.forEach((t, i) => m.setMatrixAt(i, instMat(t, k, matOf)));
      if (key === 'deco_facade') list.forEach((t, i) => t.c != null && m.setColorAt(i, new THREE.Color(t.c).lerp(new THREE.Color(1, 1, 1), 0.5)));
      m.castShadow = !k.glow; m.receiveShadow = true; m.frustumCulled = false; m.name = 'tripo:' + key;
      world.add(m);
    }
    console.log('[slot]', key, list.length, cfg.file ? 'GLB' : 'fallback');
  });
  function prep(root, k, cfg) {
    root.updateMatrixWorld(true);
    const meshes = []; root.traverse(o => o.isMesh && meshes.push(o));
    const box = new THREE.Box3(); meshes.forEach(o => box.expandByObject(o));
    const sz = box.getSize(new THREE.Vector3()), c = box.getCenter(new THREE.Vector3());
    const N = new THREE.Matrix4().makeTranslation(-c.x, -box.min.y, -c.z);
    let rot = THREE.MathUtils.degToRad(cfg.rotY || 0);
    let L = sz.z, W = sz.x;
    if (k.long && sz.x > sz.z) { rot += Math.PI / 2; L = sz.x; W = sz.z; }
    const R = new THREE.Matrix4().makeRotationY(rot);
    let s = new THREE.Vector3(1, 1, 1);
    if (k.fit === 'len') s.setScalar(k.size / L);
    else if (k.fit === 'h') s.setScalar(k.size / sz.y);
    else if (k.fit === 'w') s.setScalar(k.size / Math.max(L, W));
    else if (k.fit === 'box') s.set(1 / W, 1 / sz.y, 1 / L);   // 单位盒：x=深, y=高, z=宽
    const F = new THREE.Matrix4().makeScale(s.x, s.y, s.z).multiply(R).multiply(N);
    return meshes.map(o => {
      const geo = o.geometry.clone().applyMatrix4(new THREE.Matrix4().multiplyMatrices(F, o.matrixWorld));
      const mat = o.material.clone();
      if (k.glow) { mat.emissiveMap = mat.map; mat.emissive = new THREE.Color(1, 1, 1); mat.emissiveIntensity = 3.5; }
      mat.envMapIntensity = 1;
      return { geo, mat: reveal(mat) };
    });
  }
  function fallback(key) {
    const std = o => reveal(new THREE.MeshStandardMaterial(o));
    const g = new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0);
    if (key.startsWith('car')) return [{ geo: new THREE.BoxGeometry(2, 1.2, 5.3).translate(0, 0.6, 0), mat: std({ color: 0xd0c0b0, roughness: 0.3, metalness: 0.5 }) }];
    if (key.startsWith('palm')) return [{ geo: new THREE.CylinderGeometry(0.02, 0.03, 1, 6).translate(0, 0.5, 0), mat: std({ color: 0x8a6e58 }) }];
    return [{ geo: g, mat: std({ color: 0xcccccc }) }];
  }
  await Promise.all(jobs);
}
function instMat(t, k, matOf) {
  const o = { x: t.x, y: t.y || 0, z: t.z, ry: t.ry || 0 };
  if (k.fit === 'h') o.s = t.h;
  if (k.fit === 'w' && t.w) { o.s = t.w; }
  if (k.fit === 'box') { o.x = t.x - t.d / 2; o.sx = t.d; o.sy = t.h; o.sz = t.w; }
  return matOf(o);
}
