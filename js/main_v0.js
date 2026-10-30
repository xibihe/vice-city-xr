// Vice City / Ocean Drive MR blockout v0 — 只搭主参考图 v2_02 中可见的元素
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { loadSlots } from './slots.js';

const Q = new URLSearchParams(location.search);
const SHOT = Q.has('shot');
const rnd = (() => { let s = 7; return () => (s = (s * 16807) % 2147483647) / 2147483647; })();

// ---------- renderer ----------
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: SHOT });
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.85;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.xr.enabled = true;
renderer.xr.setReferenceSpaceType('local-floor');
renderer.xr.setFoveation?.(1);
document.body.appendChild(renderer.domElement);
renderer.domElement.addEventListener('webglcontextlost', e => { e.preventDefault(); paused = true; });
renderer.domElement.addEventListener('webglcontextrestored', () => { paused = false; });
let paused = false;

const scene = new THREE.Scene();
scene.background = null;
const LOBBY = new THREE.Color(0x07060b);
renderer.setClearColor(LOBBY, 1);
scene.fog = new THREE.FogExp2(0xe39a86, 0.0018);

// 视点：抬高在人行道/街道上方，向街道尽头的日落海面看（对应参考图机位）
const VIEW = new THREE.Vector3(6.5, 11, 12);
const LOOK = new THREE.Vector3(-13, 0, -32);
const camera = new THREE.PerspectiveCamera(52, innerWidth / innerHeight, 0.1, 2000);
camera.position.copy(VIEW); camera.lookAt(LOOK);

// xrRoot(转向) -> world(平移)，让头显用户站在视点上、面朝街道
const xrRoot = new THREE.Group(); scene.add(xrRoot);
const world = new THREE.Group(); xrRoot.add(world);

// ---------- sphere-wipe reveal (所有材质共享 uniform) ----------
const R = { uC: { value: VIEW.clone() }, uR: { value: SHOT ? 1e5 : 0 } };
function reveal(mat) {
  mat.onBeforeCompile = sh => {
    sh.uniforms.uC = R.uC; sh.uniforms.uR = R.uR;
    sh.vertexShader = 'varying vec3 vRW;\n' + sh.vertexShader.replace('#include <project_vertex>',
      `#include <project_vertex>
#ifdef USE_INSTANCING
 vRW=(modelMatrix*instanceMatrix*vec4(transformed,1.)).xyz;
#else
 vRW=(modelMatrix*vec4(transformed,1.)).xyz;
#endif`);
    sh.fragmentShader = 'uniform vec3 uC;uniform float uR;varying vec3 vRW;\n' + sh.fragmentShader.replace('#include <dithering_fragment>',
      `#include <dithering_fragment>
 float dR=distance(vRW,uC); if(dR>uR) discard;
 gl_FragColor.rgb+=vec3(1.,.25,.7)*smoothstep(uR-3.,uR,dR)*step(uR,4000.)*2.;`);
  };
  return mat;
}
const std = (o) => reveal(new THREE.MeshStandardMaterial(o));
const glow = (hex, k = 4) => reveal(new THREE.MeshBasicMaterial({ color: new THREE.Color(hex).multiplyScalar(k), toneMapped: false, fog: false }));
// 世界坐标里视点（world 本身在桌面模式无偏移；XR 下 uC 会随 world 变换更新）

// ---------- sky ----------
const SUN = new THREE.Vector3(0.28, 0.07, -1).normalize();
const sky = new THREE.Mesh(new THREE.SphereGeometry(900, 32, 16), new THREE.ShaderMaterial({
  side: THREE.BackSide, depthWrite: false, fog: false,
  uniforms: { uSun: { value: SUN }, uC: R.uC, uR: R.uR },
  vertexShader: `varying vec3 vD;varying vec3 vRW;void main(){vD=normalize(position);vec4 w=modelMatrix*vec4(position,1.);vRW=w.xyz;gl_Position=projectionMatrix*viewMatrix*w;gl_Position.z=gl_Position.w;}`,
  fragmentShader: `uniform vec3 uSun,uC;uniform float uR;varying vec3 vD;varying vec3 vRW;
  void main(){ if(uR<900.){ if(distance(vRW,uC)>uR*1.2+ -0.0) discard; }
   float h=clamp(vD.y,-.1,1.);
   vec3 hor=vec3(1.0,.48,.16), mid=vec3(.92,.30,.42), top=vec3(.30,.22,.50);
   vec3 c=mix(hor,mid,smoothstep(.0,.18,h)); c=mix(c,top,smoothstep(.18,.7,h));
   float s=max(dot(vD,uSun),0.); c+=vec3(1.,.75,.4)*pow(s,6.)*.35+vec3(1.,.9,.7)*pow(s,1500.)*2.5;
   float cl=sin(vD.x*40.+sin(vD.z*23.)*2.)*sin(vD.z*31.+vD.x*7.); c=mix(c,c*vec3(1.05,.7,.75),smoothstep(.3,.9,cl)*smoothstep(.04,.2,h)*(1.-smoothstep(.3,.6,h))*.5);
   gl_FragColor=vec4(c*1.15,1.);}`
}));
world.add(sky);

// ---------- lights ----------
const hemi = new THREE.HemisphereLight(0xffb59a, 0x4a3550, 0.9); world.add(hemi);
const sun = new THREE.DirectionalLight(0xffa060, 3.2);
sun.position.copy(SUN).multiplyScalar(120).add(new THREE.Vector3(-10, 30, -40)); sun.target.position.set(-6, 0, -40);
sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -60, right: 60, top: 80, bottom: -80, near: 1, far: 400 });
sun.shadow.bias = -0.0005; world.add(sun, sun.target);

// ---------- helpers ----------
const M4 = new THREE.Matrix4(), Qt = new THREE.Quaternion(), V = new THREE.Vector3(), S = new THREE.Vector3(), E = new THREE.Euler();
function inst(geo, mat, list, { shadow = true, colors } = {}) {
  const m = new THREE.InstancedMesh(geo, mat, list.length);
  list.forEach((t, i) => {
    E.set(t.rx || 0, t.ry || 0, t.rz || 0); Qt.setFromEuler(E);
    m.setMatrixAt(i, M4.compose(V.set(t.x, t.y, t.z), Qt, S.set(t.sx ?? 1, t.sy ?? 1, t.sz ?? 1)));
    if (t.c != null) m.setColorAt(i, new THREE.Color(t.c));
  });
  m.castShadow = m.receiveShadow = shadow; world.add(m); return m;
}
function canvasTex(w, h, draw, rep) { const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 4; if (rep) t.repeat.set(...rep); return t; }

// ---------- ground: 街道 / 人行道 / 海滩 / 海 ----------
// 坐标：街道沿 -Z 伸向海；左侧(x<-10)建筑排；x -10..-2 人行道+咖啡座；x -2..9 车道；x 9..12 绿化带；x>12 海滩，再往外是海
const asphalt = std({ color: 0x2c2630, roughness: 0.38, metalness: 0.15 });
const street = new THREE.Mesh(new THREE.PlaneGeometry(11, 400), asphalt); street.rotation.x = -Math.PI / 2; street.position.set(3.5, 0, -170); street.receiveShadow = true; world.add(street);
const paveTex = canvasTex(256, 256, (g, w, h) => { g.fillStyle = '#b89c8c'; g.fillRect(0, 0, w, h); g.strokeStyle = '#8f7468'; g.lineWidth = 3; for (let i = 0; i <= 4; i++) { g.beginPath(); g.moveTo(i * 64, 0); g.lineTo(i * 64, h); g.stroke(); g.beginPath(); g.moveTo(0, i * 64); g.lineTo(w, i * 64); g.stroke(); } }, [4, 200]);
const walk = new THREE.Mesh(new THREE.BoxGeometry(8, 0.18, 400), std({ map: paveTex, roughness: 0.7 })); walk.position.set(-6, 0.09, -170); walk.receiveShadow = true; world.add(walk);
const rightWalk = new THREE.Mesh(new THREE.BoxGeometry(3, 0.25, 400), std({ color: 0x9c8a7c, roughness: 0.8 })); rightWalk.position.set(10.5, 0.12, -170); rightWalk.receiveShadow = true; world.add(rightWalk);
const sand = new THREE.Mesh(new THREE.PlaneGeometry(14, 420), std({ color: 0xe0b48e, roughness: 1 })); sand.rotation.x = -Math.PI / 2; sand.position.set(19, 0.02, -170); sand.receiveShadow = true; world.add(sand);
const sea = new THREE.Mesh(new THREE.PlaneGeometry(2000, 2000), std({ color: 0xd08a86, roughness: 0.25, metalness: 0.2, emissive: 0x6a3040 })); sea.rotation.x = -Math.PI / 2; sea.position.set(0, -0.3, 0); world.add(sea);
// 海只在右侧/尽头出现：用一块沙地/城区地面挡住左侧
const landL = new THREE.Mesh(new THREE.PlaneGeometry(300, 420), std({ color: 0x5a4a50, roughness: 1 })); landL.rotation.x = -Math.PI / 2; landL.position.set(-160, 0.01, -170); world.add(landL);
// 车道中线（白色虚线）
inst(new THREE.BoxGeometry(0.18, 0.02, 3), std({ color: 0xeeeeee, roughness: 0.6 }), Array.from({ length: 50 }, (_, i) => ({ x: 3.6, y: 0.01, z: 10 - i * 7 })), { shadow: false });

// ---------- 建筑排（左侧）：粉/薄荷/桃/淡紫/奶白 装饰艺术外立面 ----------
const facadeTex = canvasTex(256, 512, (g, w, h) => {
  g.fillStyle = '#fff'; g.fillRect(0, 0, w, h);
  for (let r = 0; r < 6; r++) for (let c = 0; c < 4; c++) { g.fillStyle = '#5b6a78'; g.fillRect(24 + c * 58, 60 + r * 72, 36, 44); g.fillStyle = '#e6e0d8'; g.fillRect(20 + c * 58, 106 + r * 72, 44, 5); }
  g.fillStyle = '#ece6e2'; g.fillRect(0, 0, w, 18); // 檐口
});
const PASTEL = [0xf5b8c8, 0xa8e0cc, 0xf6c8a8, 0xd8c0ec, 0xf3e6d2, 0xf2a9bd];
const bldg = [], neonH = [], neonV = [], awn = [], cafe = [];
let z = 12;
const signs = []; // 记录前几栋楼用于招牌
for (let i = 0; z > -260; i++) {
  const w = 14 + rnd() * 10, h = 9 + rnd() * 5 + (i < 2 ? 2 : 0), d = 18;
  const cz = z - w / 2;
  bldg.push({ x: -10 - d / 2, y: h / 2, z: cz, sx: d, sy: h, sz: w - 0.6, c: PASTEL[i % PASTEL.length] });
  const nc = [0xff3fb4, 0x22e6d6, 0xc04dff, 0xff5aa0][i % 4];
  neonH.push({ x: -10.05, y: 4.4, z: cz, sx: 0.12, sy: 0.12, sz: w - 1.5, c: nc });         // 一层顶部霓虹横条
  if (i % 2 === 0) neonV.push({ x: -10.05, y: h * 0.55, z: cz + w / 2 - 1, sx: 0.12, sy: h * 0.8, sz: 0.12, c: nc }); // 转角竖条
  awn.push({ x: -8.6, y: 3.3, z: cz, rz: -0.38, sx: 3.2, sy: 0.08, sz: w - 2, c: [0xffffff, 0xffffff, 0xffe8e8][i % 3], k: i % 3 });
  for (let t = 0; t < Math.floor(w / 4.5); t++) cafe.push({ x: -7.2 + (t % 2) * 1.6, z: cz - w / 2 + 2.2 + t * 4.2 });
  signs.push({ cz, w, h });
  z -= w;
}
inst(new THREE.BoxGeometry(1, 1, 1), std({ map: facadeTex, roughness: 0.85 }), bldg);
// 屋顶小体量（远处天际线一样的低矮楼顶构件）
inst(new THREE.BoxGeometry(1, 1, 1), std({ color: 0xf0e2da, roughness: 0.9 }), bldg.filter((_, i) => i % 2).map(b => ({ x: b.x + 2, y: b.sy + 1.2, z: b.z, sx: 6, sy: 2.4, sz: b.sz * 0.4 })));
const neonMat = reveal(new THREE.MeshBasicMaterial({ color: new THREE.Color(3.5, 3.5, 3.5), toneMapped: false, fog: false }));
inst(new THREE.BoxGeometry(1, 1, 1), neonMat, [...neonH, ...neonV], { shadow: false });

// 条纹遮阳篷（粉白 / 青 / 红三种）[Tripo 槽位: awning_striped]
const stripeTex = canvasTex(64, 64, (g) => { for (let i = 0; i < 8; i++) { g.fillStyle = i % 2 ? '#fff4f0' : '#e2566e'; g.fillRect(0, i * 8, 64, 8); } }, [1, 6]);
const awnMats = [std({ map: stripeTex, roughness: 0.8 }), std({ color: 0x1d9c94, roughness: 0.8 }), std({ color: 0xb8323e, roughness: 0.8 })];
const awnGroup = new THREE.Group(); awnGroup.name = 'slot:awning_striped'; world.add(awnGroup);
[0, 1, 2].forEach(k => { const m = inst(new THREE.BoxGeometry(1, 1, 1), awnMats[k], awn.filter(a => a.k === k)); awnGroup.add(m); });

// 咖啡桌椅组（圆桌 + 4 椅）[Tripo 槽位: cafe_set]
const cafeGroup = new THREE.Group(); cafeGroup.name = 'slot:cafe_set'; world.add(cafeGroup);
cafeGroup.add(inst(new THREE.CylinderGeometry(0.45, 0.45, 0.05, 12), std({ color: 0xd8d0c4 }), cafe.map(c => ({ x: c.x, y: 0.95, z: c.z }))));
cafeGroup.add(inst(new THREE.CylinderGeometry(0.04, 0.04, 0.8, 6), std({ color: 0x333333 }), cafe.map(c => ({ x: c.x, y: 0.55, z: c.z }))));
cafeGroup.add(inst(new THREE.BoxGeometry(0.45, 0.8, 0.45), std({ color: 0xa8784c, roughness: 0.9 }), cafe.flatMap(c => [[0.75, 0], [-0.75, 0], [0, 0.75], [0, -0.75]].map(([dx, dz]) => ({ x: c.x + dx, y: 0.58, z: c.z + dz })))));
// 暖色室内光（一层窗内的暖光条）
inst(new THREE.BoxGeometry(1, 1, 1), glow(0xffb070, 2.2), signs.map(s => ({ x: -10.02, y: 1.6, z: s.cz, sx: 0.05, sy: 1.6, sz: s.w - 4 })), { shadow: false });

// 招牌：火烈鸟霓虹（1号楼）、青色拱形霓虹（2号楼）、紫色竖招牌（4号楼）
const flamingoGroup = new THREE.Group(); flamingoGroup.name = 'slot:flamingo_sign'; world.add(flamingoGroup);
{ const s = signs[0]; const pts = [[0, 0], [1.5, 2.2], [3.8, 2.6], [5.2, 1.6], [4.4, 0.4], [2.6, 0.9], [3.6, 2], [5.6, 2.6], [6.6, 1.4]].map(([a, b]) => new THREE.Vector3(0, b, -a));
  const tube = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 80, 0.16, 6), glow(0xff4fc8, 4));
  tube.position.set(-9.6, s.h + 0.5, s.cz + s.w / 2 - 1); flamingoGroup.add(tube); }
{ const s = signs[1]; const arc = new THREE.Mesh(new THREE.TorusGeometry(1.4, 0.13, 6, 24, Math.PI * 1.3), glow(0x2ff0e0, 4)); arc.rotation.y = Math.PI / 2; arc.position.set(-9.9, s.h - 2.2, s.cz); world.add(arc); }
{ const s = signs[3]; const v = new THREE.Mesh(new THREE.BoxGeometry(0.3, 5, 1.2), glow(0xc05cff, 3.5)); v.position.set(-9.7, s.h - 3, s.cz + s.w / 2 - 2); world.add(v); }

// ---------- 棕榈树 [Tripo 槽位: palm] ----------
const palms = [];
for (let zz = 6; zz > -250; zz -= 13 + rnd() * 3) palms.push({ x: -2.8 - rnd() * 0.6, z: zz, h: 9 + rnd() * 3 });           // 左侧人行道
for (let zz = 2; zz > -250; zz -= 9 + rnd() * 3) palms.push({ x: 10.5 + rnd() * 0.6, z: zz, h: 10 + rnd() * 3 });          // 右侧绿化带
const palmGroup = new THREE.Group(); palmGroup.name = 'slot:palm'; world.add(palmGroup);
palmGroup.add(inst(new THREE.CylinderGeometry(0.18, 0.32, 1, 7).translate(0, 0.5, 0), std({ color: 0x8a6e58, roughness: 1 }),
  palms.map(p => ({ x: p.x, y: 0, z: p.z, sy: p.h, rz: (rnd() - 0.5) * 0.12, rx: (rnd() - 0.5) * 0.12 }))));
const frondGeo = new THREE.ConeGeometry(0.5, 4.2, 4, 1).translate(0, 2.1, 0).scale(1, 1, 0.12);
palmGroup.add(inst(frondGeo, std({ color: 0x6fae55, roughness: 0.8, side: THREE.DoubleSide }),
  palms.flatMap(p => Array.from({ length: 9 }, (_, k) => ({ x: p.x, y: p.h, z: p.z, ry: k * 0.7 + rnd(), rz: 1.9 + rnd() * 0.5, c: new THREE.Color(0x5f9e4a).offsetHSL(0, 0, (rnd() - 0.5) * 0.12) })))));
// 右侧灌木
inst(new THREE.IcosahedronGeometry(1, 1), std({ color: 0x3d6b3a, roughness: 1 }), Array.from({ length: 70 }, (_, i) => ({ x: 9.8 + rnd() * 2, y: 0.5, z: 8 - i * 3.6, sx: 1.2, sy: 0.9, sz: 1.4 })));

// ---------- 老爷车（奶白敞篷 / 酒红 / 白）[Tripo 槽位: car_*] ----------
const CARC = [0xefe2c4, 0x8e1f2a, 0xe8e6e0, 0x7a1822, 0xd9d2c4, 0xa8283a];
const cars = [];
for (let zz = 4; zz > -200; zz -= 7 + rnd() * 3) cars.push({ x: -0.4, z: zz });          // 左侧路边停车
for (let zz = 6; zz > -200; zz -= 8 + rnd() * 5) cars.push({ x: 7.6, z: zz });           // 右侧路边
for (let zz = -2; zz > -200; zz -= 14 + rnd() * 10) cars.push({ x: rnd() > 0.5 ? 2.2 : 5.1, z: zz }); // 行驶中
const carGroup = new THREE.Group(); carGroup.name = 'slot:cars'; world.add(carGroup);
carGroup.add(inst(new THREE.BoxGeometry(2.0, 0.75, 5.4), std({ roughness: 0.25, metalness: 0.5 }), cars.map((c, i) => ({ x: c.x, y: 0.62, z: c.z, c: CARC[i % CARC.length] }))));
carGroup.add(inst(new THREE.BoxGeometry(1.7, 0.5, 2.2), std({ color: 0x2a2a32, roughness: 0.1, metalness: 0.6 }), cars.filter((_, i) => i % 3).map(c => ({ x: c.x, y: 1.22, z: c.z + 0.3 }))));
carGroup.add(inst(new THREE.BoxGeometry(1.6, 0.12, 0.1), glow(0xfff0c0, 3), cars.map(c => ({ x: c.x, y: 0.7, z: c.z - 2.72 })), { shadow: false }));

// ---------- 远景：海岸尽头的低矮楼群 + 远处海面 ----------
inst(new THREE.BoxGeometry(1, 1, 1), std({ color: 0xe8c8bc, roughness: 1 }), Array.from({ length: 40 }, () => { const h = 6 + rnd() * 16; return { x: -40 - rnd() * 60, y: h / 2, z: -40 - rnd() * 260, sx: 10 + rnd() * 10, sy: h, sz: 10 + rnd() * 10, c: PASTEL[Math.floor(rnd() * 6)] }; }), { shadow: false });

// ---------- lobby：未揭示前头显里一个发光圆环提示 pinch ----------
const lobbyRing = new THREE.Mesh(new THREE.TorusGeometry(0.25, 0.008, 8, 64), new THREE.MeshBasicMaterial({ color: new THREE.Color(2.5, 0.8, 1.8), toneMapped: false }));
lobbyRing.visible = false; scene.add(lobbyRing);

// ---------- Tripo GLB 槽位 ----------
loadSlots(world).catch(e => console.warn('slots', e));

// ---------- 后期（仅桌面；WebXR 下直接 render，保 90fps）----------
const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
composer.addPass(new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.6, 0.4, 1.4));
composer.addPass(new OutputPass());

// ---------- reveal 动画 ----------
let anim = null;
function startReveal() { if (anim || R.uR.value > 1000) return; anim = performance.now(); lobbyRing.visible = false; }
function updateReveal(now) {
  if (!anim) return;
  const t = Math.min((now - anim) / 2600, 1); R.uR.value = 2 + Math.pow(t, 2.2) * 1400;
  if (t >= 1) { R.uR.value = 1e5; anim = null; }
}

// ---------- 进入 ----------
const btn = document.getElementById('enter');
async function enter() {
  if (navigator.xr) {
    let mode = null;
    if (await navigator.xr.isSessionSupported('immersive-ar').catch(() => false)) mode = 'immersive-ar';
    else if (await navigator.xr.isSessionSupported('immersive-vr').catch(() => false)) mode = 'immersive-vr';
    if (mode) {
      const session = await navigator.xr.requestSession(mode, { optionalFeatures: ['local-floor', 'hand-tracking'] });
      renderer.shadowMap.enabled = false; // XR 省性能
      renderer.setClearColor(LOBBY, mode === 'immersive-ar' ? 0 : 1); // AR=透视办公室，VR=暗色大厅
      // 用户站在视点上、面朝街道
      const dir = LOOK.clone().sub(VIEW); xrRoot.rotation.y = -Math.atan2(-dir.x, -dir.z);
      world.position.set(-VIEW.x, -(VIEW.y - 1.6), -VIEW.z);
      xrRoot.updateMatrixWorld(true);
      R.uC.value.set(0, 1.6, 0); R.uR.value = 0; lobbyRing.visible = true;
      session.addEventListener('select', startReveal); // Vision Pro: transient-pointer pinch
      session.addEventListener('end', () => { location.reload(); });
      await renderer.xr.setSession(session);
      document.getElementById('ui').style.display = 'none';
      return;
    }
  }
  // 桌面：直接播放揭示
  document.getElementById('ui').style.display = 'none'; startReveal();
}
btn.onclick = enter;
if (SHOT) document.getElementById('ui').style.display = 'none';
addEventListener('keydown', e => { if (e.code === 'Space') startReveal(); });

addEventListener('resize', () => { camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); renderer.setSize(innerWidth, innerHeight); composer.setSize(innerWidth, innerHeight); });

const clock = new THREE.Clock();
renderer.setAnimationLoop((now) => {
  if (paused) return;
  updateReveal(now);
  if (renderer.xr.isPresenting) {
    const xc = renderer.xr.getCamera();
    if (lobbyRing.visible) { lobbyRing.position.copy(xc.position).add(new THREE.Vector3(0, 0, -1.2).applyQuaternion(xc.quaternion)); lobbyRing.quaternion.copy(xc.quaternion); lobbyRing.rotation.z += 0; }
    renderer.setClearColor(LOBBY, renderer.xr.getSession()?.environmentBlendMode === 'opaque' || R.uR.value > 1000 ? 1 : 0);
    renderer.render(scene, camera);
  } else composer.render(clock.getDelta());
  window.__READY = true;
});
