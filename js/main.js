// Vice City / Ocean Drive — v1 360° 场景：站在海滨装饰艺术酒店屋顶，四面都成立
// heading 0 = 北(-Z) 沿 Ocean Drive；90 = 东 海滩/海/日落；180 = 南 街道另一头；270 = 西 城区+天际线
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { HDRLoader } from 'three/addons/loaders/HDRLoader.js';
import { Water } from 'three/addons/objects/Water.js';
import { loadSlots } from './slots.js';

const Q = new URLSearchParams(location.search);
const SHOT = Q.has('shot'), AO = Q.get('ao') !== '0', LITE = Q.has('lite');
const rnd = (() => { let s = 11; return () => (s = (s * 16807) % 2147483647) / 2147483647; })();
const pick = a => a[Math.floor(rnd() * a.length)];

// ---------- renderer ----------
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: SHOT });
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.9;
renderer.shadowMap.enabled = !LITE;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.xr.enabled = true;
renderer.xr.setReferenceSpaceType('local-floor');
renderer.xr.setFoveation?.(1);
document.body.appendChild(renderer.domElement);
let paused = false;
renderer.domElement.addEventListener('webglcontextlost', e => { e.preventDefault(); paused = true; });
renderer.domElement.addEventListener('webglcontextrestored', () => { paused = false; });

const scene = new THREE.Scene();
const LOBBY = new THREE.Color(0x07060b);
renderer.setClearColor(LOBBY, 1);
const FOGC = new THREE.Color(0xd9927e);
scene.fog = new THREE.FogExp2(FOGC, 0.0011);

// ---------- 观景点：自家酒店屋顶 ----------
const ROOF = 21, EYE = 1.6, DECK = ROOF + 3.5;
// 悬挑观景台：从屋顶边缘伸出到人行道上空，玻璃地板
const VIEW = new THREE.Vector3(-5.5, DECK + EYE, 0);
const camera = new THREE.PerspectiveCamera(70, innerWidth / innerHeight, 0.1, 6000);
const HEAD = Q.get('h'), HERO = Q.has('hero');
function aim(hdeg, pitch = -10) {
  const h = THREE.MathUtils.degToRad(hdeg), p = THREE.MathUtils.degToRad(pitch);
  camera.position.copy(VIEW);
  camera.lookAt(VIEW.x + Math.sin(h) * Math.cos(p), VIEW.y + Math.sin(p), VIEW.z - Math.cos(h) * Math.cos(p));
}
if (HERO) { camera.fov = 50; camera.position.set(6.5, 12, 14); camera.lookAt(-11, 1, -34); }
else aim(HEAD != null ? +HEAD : 20, HEAD != null ? -24 : -24);
camera.updateProjectionMatrix();

const xrRoot = new THREE.Group(); scene.add(xrRoot);
const world = new THREE.Group(); xrRoot.add(world);

// ---------- sphere-wipe reveal ----------
const R = { uC: { value: VIEW.clone() }, uR: { value: SHOT ? 1e5 : 0 } };
function revealPatch(sh) {
  sh.uniforms.uC = R.uC; sh.uniforms.uR = R.uR;
  sh.vertexShader = 'varying vec3 vRW;varying vec3 vWN;\n' + sh.vertexShader.replace('#include <project_vertex>',
    `#include <project_vertex>
#ifdef USE_INSTANCING
 vRW=(modelMatrix*instanceMatrix*vec4(transformed,1.)).xyz; vWN=normalize(mat3(modelMatrix*instanceMatrix)*normal);
#else
 vRW=(modelMatrix*vec4(transformed,1.)).xyz; vWN=normalize(mat3(modelMatrix)*normal);
#endif`);
  sh.fragmentShader = 'uniform vec3 uC;uniform float uR;varying vec3 vRW;varying vec3 vWN;\n' + sh.fragmentShader.replace('#include <dithering_fragment>',
    `#include <dithering_fragment>
 float dR=distance(vRW,uC); if(dR>uR) discard;
 gl_FragColor.rgb+=vec3(1.,.25,.7)*smoothstep(uR-3.,uR,dR)*step(uR,4000.)*2.;`);
}
export function reveal(mat, extra) { mat.onBeforeCompile = sh => { revealPatch(sh); extra?.(sh); }; mat.customProgramCacheKey = () => 'rv' + (extra ? extra.name : ''); return mat; }
window.__reveal = reveal;
const std = o => reveal(new THREE.MeshStandardMaterial(o));
const glow = (hex, k = 4) => reveal(new THREE.MeshBasicMaterial({ color: new THREE.Color(hex).multiplyScalar(k), toneMapped: false, fog: false }));

// 程序化窗户（世界空间，适配任意缩放的实例盒子）：玻璃=低粗糙度可反射环境，随机亮灯
function windows(sh) {
  sh.fragmentShader = sh.fragmentShader
    .replace('#include <map_fragment>', `#include <map_fragment>
  float side=1.-step(.5,abs(vWN.y));
  float u=dot(vRW.xz,normalize(vec2(-vWN.z,vWN.x)+1e-4));
  vec2 g=vec2(u/2.7,(vRW.y-.4)/3.3); vec2 f=fract(g); vec2 id=floor(g);
  float win=side*step(.22,f.x)*step(f.x,.78)*step(.28,f.y)*step(f.y,.82)*step(1.,id.y)*(1.-step(.985,fract(vRW.y*.0)) );
  float topCut=step(0.,uTop(vRW));
  win*=topCut;
  float hsh=fract(sin(dot(id,vec2(12.9898,78.233))+floor(u/40.)*3.1)*43758.5453);
  diffuseColor.rgb=mix(diffuseColor.rgb,vec3(.10,.12,.16),win);
  float lit=win*step(.78,hsh);`)
    .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
  roughnessFactor=mix(roughnessFactor,.08,win);`)
    .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
  totalEmissiveRadiance+=vec3(1.,.62,.32)*lit*0.8;`)
    .replace('void main() {', 'float uTop(vec3 p){return 1.;}\nvoid main() {');
}
const bldgMat = (o = {}) => reveal(new THREE.MeshStandardMaterial({ roughness: 0.85, ...o }), windows);

// ---------- 天空（背景）+ HDRI（环境光照） ----------
const SUN = new THREE.Vector3(0.55, 0.075, -0.83).normalize();
const skyU = { uSun: { value: SUN }, uC: R.uC, uR: R.uR };
const sky = new THREE.Mesh(new THREE.SphereGeometry(4500, 48, 24), new THREE.ShaderMaterial({
  side: THREE.BackSide, depthWrite: false, fog: false, uniforms: skyU,
  vertexShader: `varying vec3 vD;varying vec3 vRW;void main(){vD=normalize(position);vec4 w=modelMatrix*vec4(position,1.);vRW=w.xyz;gl_Position=projectionMatrix*viewMatrix*w;gl_Position.z=gl_Position.w;}`,
  fragmentShader: `uniform vec3 uSun,uC;uniform float uR;varying vec3 vD;varying vec3 vRW;
  float n2(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);float a=fract(sin(dot(i,vec2(127.1,311.7)))*43758.5),b=fract(sin(dot(i+vec2(1,0),vec2(127.1,311.7)))*43758.5),c=fract(sin(dot(i+vec2(0,1),vec2(127.1,311.7)))*43758.5),d=fract(sin(dot(i+vec2(1,1),vec2(127.1,311.7)))*43758.5);return mix(mix(a,b,f.x),mix(c,d,f.x),f.y);}
  float fbm(vec2 p){float s=0.,a=.5;for(int i=0;i<5;i++){s+=a*n2(p);p*=2.03;a*=.5;}return s;}
  void main(){ if(uR<4000.&&distance(vRW,uC)>uR*1.5) discard;
   vec3 d=normalize(vD); float h=clamp(d.y,-.2,1.); float s=max(dot(d,uSun),0.);
   float az=.5+.5*dot(normalize(d.xz+1e-4),normalize(uSun.xz));       // 朝太阳一侧更暖
   vec3 hor=mix(vec3(.95,.55,.45),vec3(1.0,.52,.18),az), mid=mix(vec3(.62,.36,.55),vec3(.95,.38,.35),az), top=vec3(.16,.17,.38);
   vec3 c=mix(hor,mid,smoothstep(.0,.16,h)); c=mix(c,top,smoothstep(.14,.75,h));
   c+=vec3(1.,.6,.3)*pow(s,8.)*.6 + vec3(1.,.85,.6)*pow(s,60.)*.8 + vec3(1.,.95,.8)*smoothstep(.9992,.9996,s)*5.;
   // 云层：平面投影的 fbm 层积云，背光边缘发亮
   vec2 cp=d.xz/(d.y+.08)*1.6; float cl=fbm(cp*.9+vec2(3.,1.)); cl=smoothstep(.52,.78,cl)*smoothstep(.02,.12,h)*(1.-smoothstep(.45,.8,h));
   vec3 cc=mix(vec3(.55,.30,.42),vec3(1.,.62,.45),az)*(1.+pow(s,4.)*1.5);
   c=mix(c,cc,cl*.85);
   if(h<0.) c=mix(hor*.8,vec3(.45,.28,.3),smoothstep(0.,-.2,h));
   gl_FragColor=vec4(c,1.);
   #include <tonemapping_fragment>
   #include <colorspace_fragment>
  }`
}));
sky.renderOrder = -1; world.add(sky);

const pmrem = new THREE.PMREMGenerator(renderer);
const pending = [];
pending.push(new HDRLoader().loadAsync('./assets/sunset.hdr').then(tex => {
  // 找到 HDRI 中最亮像素的方位角，把它转到我们的太阳方向上
  const { data, width, height } = tex.image; let best = -1, bi = 0;
  for (let y = 0; y < height / 2; y += 2) for (let x = 0; x < width; x += 2) { const i = (y * width + x) * 4; const l = toF(data[i]) + toF(data[i + 1]) + toF(data[i + 2]); if (l > best) { best = l; bi = x; } }
  function toF(v) { return typeof v === 'number' && data instanceof Uint16Array ? THREE.DataUtils.fromHalfFloat(v) : v; }
  const hdrAz = (bi / width) * Math.PI * 2;  // equirect u -> 方位
  const ourAz = Math.atan2(SUN.x, -SUN.z);
  tex.mapping = THREE.EquirectangularReflectionMapping;
  const env = pmrem.fromEquirectangular(tex).texture;
  scene.environment = env; scene.environmentIntensity = 0.55;
  scene.environmentRotation.y = hdrAz - ourAz - Math.PI / 2;
  tex.dispose();
}).catch(e => console.warn('hdr', e)));

// ---------- 灯光 ----------
const hemi = new THREE.HemisphereLight(0xffb59a, 0x3a2a40, 0.35); world.add(hemi);
const sun = new THREE.DirectionalLight(0xffa868, 3.6);
sun.position.copy(SUN).multiplyScalar(260).add(new THREE.Vector3(-10, 30, 0)); sun.target.position.set(-10, 0, 0);
sun.castShadow = true; sun.shadow.mapSize.set(4096, 4096);
Object.assign(sun.shadow.camera, { left: -140, right: 140, top: 140, bottom: -140, near: 10, far: 700 });
sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.04; sun.shadow.radius = 4; world.add(sun, sun.target);

// ---------- helpers ----------
const M4 = new THREE.Matrix4(), Qt = new THREE.Quaternion(), V = new THREE.Vector3(), S = new THREE.Vector3(), E = new THREE.Euler();
export function matOf(t) { E.set(t.rx || 0, t.ry || 0, t.rz || 0); Qt.setFromEuler(E); return M4.compose(V.set(t.x, t.y || 0, t.z), Qt, S.set(t.sx ?? t.s ?? 1, t.sy ?? t.s ?? 1, t.sz ?? t.s ?? 1)).clone(); }
function inst(geo, mat, list, { shadow = true, recv = true, parent = world } = {}) {
  const m = new THREE.InstancedMesh(geo, mat, Math.max(1, list.length)); m.count = list.length;
  list.forEach((t, i) => { m.setMatrixAt(i, matOf(t)); if (t.c != null) m.setColorAt(i, new THREE.Color(t.c)); });
  m.castShadow = shadow; m.receiveShadow = recv; m.frustumCulled = false; parent.add(m); return m;
}
function canvasTex(w, h, draw, rep, srgb = true) { const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c); if (srgb) t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8; if (rep) t.repeat.set(...rep); return t; }
const BOX = new THREE.BoxGeometry(1, 1, 1);
const BOXB = new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0); // 底部对齐

// ---------- 地面 ----------
// X 截面：城区 x<-30 | 酒店排 -30..-10 | 人行道 -10..-2 | 车道 -2..9 | 绿化带/步道 9..15 | 沙滩 15..75 | 海 x>70
const ZL = 1400;
// 湿润沥青：低粗糙度 + 积水斑块（粗糙度贴图）+ clearcoat，反射环境/霓虹
const puddle = canvasTex(512, 512, (g, w, h) => { g.fillStyle = '#b0b0b0'; g.fillRect(0, 0, w, h); for (let i = 0; i < 260; i++) { const x = Math.random() * w, y = Math.random() * h, r = 4 + Math.random() * 22; const gr = g.createRadialGradient(x, y, 0, x, y, r); gr.addColorStop(0, 'rgba(10,10,10,.9)'); gr.addColorStop(1, 'rgba(10,10,10,0)'); g.fillStyle = gr; g.fillRect(x - r, y - r, 2 * r, 2 * r); } for (let i = 0; i < 4000; i++) { g.fillStyle = `rgba(255,255,255,${Math.random() * .25})`; g.fillRect(Math.random() * w, Math.random() * h, 2, 2); } }, [3, 260], false);
const asphaltC = canvasTex(256, 256, (g, w, h) => { g.fillStyle = '#3a3438'; g.fillRect(0, 0, w, h); for (let i = 0; i < 6000; i++) { const v = 40 + Math.random() * 40; g.fillStyle = `rgb(${v},${v - 4},${v})`; g.fillRect(Math.random() * w, Math.random() * h, 1.5, 1.5); } }, [4, 240]);
const asphalt = reveal(new THREE.MeshPhysicalMaterial({ map: asphaltC, color: 0x9a8f96, roughness: 1, roughnessMap: puddle, metalness: 0.0, clearcoat: 0.6, clearcoatRoughness: 0.12 }));
function plane(w, d, mat, x, y, z) { const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d), mat); m.rotation.x = -Math.PI / 2; m.position.set(x, y, z); m.receiveShadow = true; world.add(m); return m; }
plane(11, ZL, asphalt, 3.5, 0, 0);
const paveTex = canvasTex(256, 256, (g, w, h) => { g.fillStyle = '#c9a99a'; g.fillRect(0, 0, w, h); g.strokeStyle = '#9c7f72'; g.lineWidth = 2; for (let i = 0; i <= 4; i++) { g.beginPath(); g.moveTo(i * 64, 0); g.lineTo(i * 64, h); g.stroke(); g.beginPath(); g.moveTo(0, i * 64); g.lineTo(w, i * 64); g.stroke(); } }, [4, ZL / 2]);
const walk = new THREE.Mesh(new THREE.BoxGeometry(8, 0.18, ZL), std({ map: paveTex, roughness: 0.6 })); walk.position.set(-6, 0.09, 0); walk.receiveShadow = true; world.add(walk);
const curbM = std({ color: 0xd8ccc0, roughness: 0.7 });
inst(BOX, curbM, [{ x: -2.05, y: 0.1, z: 0, sx: 0.2, sy: 0.22, sz: ZL }, { x: 9.05, y: 0.12, z: 0, sx: 0.2, sy: 0.25, sz: ZL }]);
plane(6, ZL, std({ color: 0x4f7a3c, roughness: 0.95 }), 12, 0.13, 0);                   // 草地绿化带
plane(2.2, ZL, std({ map: paveTex, roughness: 0.65 }), 15.6, 0.15, 0);                    // 海滨步道
// 沙滩：带起伏和向海倾斜
const sandTex = canvasTex(256, 256, (g, w, h) => { g.fillStyle = '#e9c39c'; g.fillRect(0, 0, w, h); for (let i = 0; i < 9000; i++) { const v = Math.random(); g.fillStyle = v > .5 ? 'rgba(255,240,220,.35)' : 'rgba(170,120,90,.25)'; g.fillRect(Math.random() * w, Math.random() * h, 1.5, 1.5); } }, [20, 300]);
{ const g = new THREE.PlaneGeometry(64, ZL, 32, 200); g.rotateX(-Math.PI / 2); const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) { const x = p.getX(i), z = p.getZ(i); const t = (x + 32) / 64; p.setY(i, 0.15 - Math.pow(t, 1.6) * 1.4 + Math.sin(z * 0.05 + x * 0.3) * 0.08 * (1 - t)); }
  g.computeVertexNormals(); const m = new THREE.Mesh(g, std({ map: sandTex, roughness: 0.95 })); m.position.set(48, 0, 0); m.receiveShadow = true; world.add(m); }
// 城区地面 + 横街
plane(1400, ZL, std({ color: 0x5b5058, roughness: 0.9 }), -730, -0.02, 0);
const centerLine = std({ color: 0xf2d27a, roughness: 0.5 });
inst(BOX, centerLine, Array.from({ length: 200 }, (_, i) => ({ x: 3.5, y: 0.012, z: 700 - i * 7, sx: 0.16, sy: 0.02, sz: 3 })), { shadow: false });

// ---------- 海：three/examples Water（桌面）/ 便宜 PBR 平面（XR） ----------
const waterNormals = new THREE.TextureLoader().load('./assets/waternormals.jpg', t => { t.wrapS = t.wrapT = THREE.RepeatWrapping; });
const water = new Water(new THREE.PlaneGeometry(6000, 6000), {
  textureWidth: 1024, textureHeight: 1024, waterNormals, sunDirection: SUN.clone(), sunColor: 0xffc890,
  waterColor: 0x1f3a4a, distortionScale: 2.2, fog: true, alpha: 1,
});
water.rotation.x = -Math.PI / 2; water.position.set(3070, -0.45, 0); water.material.uniforms.size.value = 6;
world.add(water);
const seaLite = new THREE.Mesh(new THREE.PlaneGeometry(6000, 6000), std({ color: 0x24404e, roughness: 0.12, metalness: 0.1 }));
seaLite.rotation.x = -Math.PI / 2; seaLite.position.copy(water.position); seaLite.visible = false; world.add(seaLite);
// 浪花白边
inst(BOX, std({ color: 0xffffff, roughness: 0.6, transparent: true, opacity: 0.55 }), [0, 1, 2].map(k => ({ x: 72 + k * 5, y: -0.38, z: 0, sx: 1.2 - k * 0.3, sy: 0.02, sz: ZL })), { shadow: false });

// ---------- 酒店排（东临街道，两侧延伸） ----------
const PASTEL = [0xf6b9c9, 0xa9e3cf, 0xf7caa6, 0xd9c2ee, 0xf4e8d4, 0xf3a7bc, 0xbfe6f0, 0xfbe39c];
const TRIM = [0xffffff, 0x2bb5a8, 0xf27aa0, 0x8fd6e8, 0xf0c060];
const NEON = [0xff3fb4, 0x22e6d6, 0xb44dff, 0xff6a3a, 0x3fa0ff];
const bodies = [], trims = [], ledges = [], fins = [], parapets = [], neonBars = [], winGlow = [], storeGlass = [], corners = [];
export const SLOTS = { awning_striped: [], cafe_set: [], palm_a: [], palm_b: [], flamingo_sign: [], deco_facade: [],
  car_convertible_cream: [], car_sedan_red: [], car_sedan_white: [] };
window.__SLOTS = SLOTS;
const hotels = [];
function hotelRow(z0, z1) {
  let z = z0;
  while (z > z1) {
    const w = 13 + rnd() * 9;
    const cz = z - w / 2;
    const isOurs = Math.abs(cz) < w / 2 + 0.1 && !hotels.some(h => h.ours);
    if (Math.abs(cz) < 9) { /* 观景酒店单独建 */ }
    hotels.push({ cz, w });
    z -= w + (rnd() < 0.08 ? 4 : 0);
    if (Math.abs(z % 110) < 12 && Math.abs(z) > 40) z -= 14; // 横街
  }
}
// 观景酒店（脚下）z ∈ [-9, 9]
const OUR = { cz: 0, w: 14, h: ROOF, d: 20, c: 0xf6b9c9, t: 0x2bb5a8, ours: true };
const list = [OUR];
for (let side of [-1, 1]) { let z = side * 7; for (let n = 0; n < 60; n++) {
  const w = 13 + rnd() * 9; const cz = z + side * w / 2; if (Math.abs(cz) > 650) break;
  list.push({ cz, w, h: 9 + rnd() * 7 + (rnd() < 0.15 ? 8 : 0), d: 16 + rnd() * 6, c: pick(PASTEL), t: pick(TRIM), deco: n % 6 === 3 });
  z += side * (w + 0.4); if (n % 7 === 6) z += side * 14; } }
for (const b of list) {
  const fx = -10; // 立面朝 +X
  const bx = fx - b.d / 2;
  if (b.deco) { SLOTS.deco_facade.push({ x: fx, y: 0, z: b.cz, w: b.w - 0.4, h: b.h, d: b.d, c: b.c }); }
  else if (!b.ours) {
    bodies.push({ x: bx, y: 0, z: b.cz, sx: b.d, sy: b.h, sz: b.w - 0.4, c: b.c });
    // 每层眉檐（Art Deco eyebrow ledges）
    for (let fl = 1; fl * 3.3 + 0.6 < b.h - 1; fl++) ledges.push({ x: fx + 0.35, y: fl * 3.3 + 0.55 + 2.6, z: b.cz, sx: 0.7, sy: 0.12, sz: b.w - 2.2, c: 0xfaf3ea });
    // 中央竖鳍 + 女儿墙阶梯
    const finH = b.h + 2.5 + rnd() * 3;
    fins.push({ x: fx + 0.3, y: 0, z: b.cz + (rnd() - 0.5) * b.w * 0.3, sx: 1.4, sy: finH, sz: 1.1, c: b.t });
    parapets.push({ x: bx, y: b.h, z: b.cz, sx: b.d, sy: 0.9, sz: b.w - 0.4, c: b.t });
    parapets.push({ x: fx - 1.5, y: b.h + 0.9, z: b.cz, sx: 3, sy: 1.0, sz: (b.w - 0.4) * 0.5, c: b.c });
    if (rnd() < 0.35) corners.push({ x: fx - 1.6, y: 0, z: b.cz + (b.cz > 0 ? 1 : -1) * (b.w / 2 - 1.8), sx: 3.6, sy: b.h + 1.5, sz: 3.6, c: b.c });
  }
  // 一层：店面玻璃 + 暖光 + 霓虹横条 + 遮阳篷 + 咖啡座
  storeGlass.push({ x: fx + 0.06, y: 2.0, z: b.cz, sx: 0.06, sy: 2.6, sz: b.w - 3 });
  const nc = pick(NEON);
  neonBars.push({ x: fx + 0.2, y: 4.15, z: b.cz, sx: 0.1, sy: 0.1, sz: b.w - 1.6, c: nc });
  if (rnd() < 0.5) neonBars.push({ x: fx + 0.2, y: b.h - 0.6, z: b.cz, sx: 0.1, sy: 0.1, sz: b.w - 1.6, c: pick(NEON) });
  if (!b.ours) { const nA = Math.max(1, Math.floor((b.w - 2) / 5)); for (let k = 0; k < nA; k++) SLOTS.awning_striped.push({ x: fx + 0.1, y: 3.1, z: b.cz - (b.w - 2) / 2 + (k + 0.5) * (b.w - 2) / nA, w: (b.w - 2) / nA - 0.3 }); }
  if (Math.abs(b.cz) < 320) for (let t = 0; t < Math.floor((b.w - 2) / 4.2); t++) SLOTS.cafe_set.push({ x: -7.4 + (t % 2) * 2.2, y: 0.18, z: b.cz - b.w / 2 + 2.5 + t * 4.2, ry: rnd() * 6.28 });
  hotels.push(b);
}
const bodyMat = bldgMat();
inst(BOXB, bodyMat, bodies);
inst(BOXB, bldgMat(), corners);
const trimMat = std({ roughness: 0.6 });
inst(BOX, trimMat, ledges);
inst(BOXB, trimMat, fins);
inst(BOXB, std({ roughness: 0.75 }), parapets);
inst(BOX, std({ color: 0xffb070, emissive: 0xff9a50, emissiveIntensity: 1.6, roughness: 0.15 }), storeGlass, { shadow: false });
const neonMat = reveal(new THREE.MeshBasicMaterial({ color: new THREE.Color(4, 4, 4), toneMapped: false, fog: false }));
inst(new THREE.CylinderGeometry(0.5, 0.5, 1, 6).rotateX(Math.PI / 2), neonMat, neonBars, { shadow: false });
// 竖鳍上的霓虹竖条（像酒店名竖招牌，但不写字）
inst(BOXB, neonMat, fins.filter((_, i) => i % 2 === 0).map((f, i) => ({ x: f.x + 0.75, y: f.sy * 0.35, z: f.z, sx: 0.08, sy: f.sy * 0.55, sz: 0.25, c: NEON[i % NEON.length] })), { shadow: false });

// 观景酒店本体 + 屋顶平台（用户站在这里）
{
  const b = OUR, fx = -10;
  inst(BOXB, bldgMat(), [{ x: fx - b.d / 2, y: 0, z: 0, sx: b.d, sy: ROOF, sz: b.w, c: b.c }]);
  for (let fl = 1; fl * 3.3 + 3 < ROOF; fl++) ledges.push();
  inst(BOX, trimMat, Array.from({ length: 5 }, (_, i) => ({ x: fx + 0.4, y: 3.15 + (i + 1) * 3.3, z: 0, sx: 0.8, sy: 0.14, sz: b.w - 1.5, c: 0xffffff })));
  const roofTex = canvasTex(256, 256, (g, w, h) => { g.fillStyle = '#d9c3b6'; g.fillRect(0, 0, w, h); g.strokeStyle = '#b39a8c'; g.lineWidth = 2; for (let i = 0; i <= 8; i++) { g.beginPath(); g.moveTo(i * 32, 0); g.lineTo(i * 32, h); g.stroke(); g.beginPath(); g.moveTo(0, i * 32); g.lineTo(w, i * 32); g.stroke(); } }, [5, 5]);
  const roof = new THREE.Mesh(new THREE.BoxGeometry(b.d, 0.2, b.w), std({ map: roofTex, roughness: 0.55 })); roof.position.set(fx - b.d / 2, ROOF + 0.1, 0); roof.receiveShadow = true; world.add(roof);
  // 女儿墙（矮）+ 金属栏杆，不挡视线
  const pm = std({ color: 0x2bb5a8, roughness: 0.6 });
  inst(BOXB, pm, [{ x: fx - 0.15, y: ROOF, z: 0, sx: 0.3, sy: 0.3, sz: b.w }, { x: fx - b.d + 0.15, y: ROOF, z: 0, sx: 0.3, sy: 0.55, sz: b.w }, { x: fx - b.d / 2, y: ROOF, z: b.w / 2 - 0.15, sx: b.d, sy: 0.55, sz: 0.3 }, { x: fx - b.d / 2, y: ROOF, z: -b.w / 2 + 0.15, sx: b.d, sy: 0.55, sz: 0.3 }]);
  const rail = std({ color: 0xe8e8e8, metalness: 1, roughness: 0.25 });
  const rails = [];
  const ring = [[fx - 0.15, -b.w / 2, fx - 0.15, b.w / 2], [fx - b.d + 0.15, -b.w / 2, fx - b.d + 0.15, b.w / 2], [fx - b.d, b.w / 2 - 0.15, fx, b.w / 2 - 0.15], [fx - b.d, -b.w / 2 + 0.15, fx, -b.w / 2 + 0.15]];
  for (const [x0, z0, x1, z1] of ring) { const L = Math.hypot(x1 - x0, z1 - z0), ry = Math.atan2(x1 - x0, z1 - z0);
    rails.push({ x: (x0 + x1) / 2, y: ROOF + 1.1, z: (z0 + z1) / 2, sx: 0.06, sy: 0.06, sz: L, ry });
    for (let k = 0; k <= L / 1.5; k++) { const t = k * 1.5 / L; rails.push({ x: x0 + (x1 - x0) * t, y: ROOF + 0.8, z: z0 + (z1 - z0) * t, sx: 0.04, sy: 0.6, sz: 0.04 }); } }
  inst(BOX, rail, rails);
  // 屋顶道具：躺椅 + 遮阳伞 + 楼梯间（背后）
  inst(BOXB, std({ color: 0xf4e8d4, roughness: 0.8 }), [{ x: -27, y: ROOF + 0.2, z: -5, sx: 4, sy: 3, sz: 4 }]);
  inst(BOXB, std({ color: 0xffffff, roughness: 0.7 }), [-4, -1.5, 1, 3.5].map(z => ({ x: -19, y: ROOF + 0.2, z, sx: 1.9, sy: 0.35, sz: 0.7 })));
  const umb = std({ color: 0xe2566e, roughness: 0.8, side: THREE.DoubleSide });
  inst(new THREE.ConeGeometry(1.6, 0.5, 12, 1, true), umb, [-2.7, 2.2].map(z => ({ x: -20.5, y: ROOF + 2.5, z })));
  inst(new THREE.CylinderGeometry(0.03, 0.03, 2.4, 6), rail, [-2.7, 2.2].map(z => ({ x: -20.5, y: ROOF + 1.3, z })));
  // 屋顶粉色霓虹边条
  inst(new THREE.CylinderGeometry(0.5, 0.5, 1, 6).rotateX(Math.PI / 2), neonMat, [{ x: fx + 0.25, y: ROOF - 0.2, z: 0, sx: 0.09, sy: 0.09, sz: b.w - 0.5, c: 0xff3fb4 }], { shadow: false });
}

// ---------- 悬挑玻璃观景台（XR 用户站在这里） ----------
{
  const x0 = -12, x1 = -3, zw = 6;
  const glass = reveal(new THREE.MeshPhysicalMaterial({ color: 0xbfe8ff, roughness: 0.05, metalness: 0, transmission: 0, transparent: true, opacity: 0.18, depthWrite: false }));
  const g = new THREE.Mesh(new THREE.BoxGeometry(x1 - x0, 0.06, zw), glass); g.position.set((x0 + x1) / 2, DECK, 0); world.add(g);
  const steel = std({ color: 0xe8e8ec, metalness: 1, roughness: 0.3 });
  const fr = [];
  for (const z of [-zw / 2, zw / 2]) fr.push({ x: (x0 + x1) / 2, y: DECK - 0.1, z, sx: x1 - x0, sy: 0.2, sz: 0.2 });
  for (let x = x0; x <= x1 + 0.01; x += 1.5) fr.push({ x, y: DECK - 0.1, z: 0, sx: 0.12, sy: 0.15, sz: zw });
  // 斜撑：从台面外端拉回楼体立面
  for (const z of [-zw / 2, zw / 2]) { const dx = x1 - (-10.2), dy = 5; fr.push({ x: (-10.2 + x1) / 2, y: DECK - dy / 2, z, sx: Math.hypot(dx, dy), sy: 0.18, sz: 0.18, rz: Math.atan2(dy, dx) }); }
  // 栏杆（低、细，玻璃栏板）
  const rail = [];
  const edges = [[x1, -zw / 2, x1, zw / 2], [x0, zw / 2, x1, zw / 2], [x0, -zw / 2, x1, -zw / 2]];
  for (const [a, b, c, d] of edges) { const L = Math.hypot(c - a, d - b), ry = Math.atan2(c - a, d - b);
    rail.push({ x: (a + c) / 2, y: DECK + 1.05, z: (b + d) / 2, sx: 0.07, sy: 0.07, sz: L, ry });
    for (let k = 0; k <= L / 1.5; k++) { const t = Math.min(1, k * 1.5 / L); rail.push({ x: a + (c - a) * t, y: DECK + 0.52, z: b + (d - b) * t, sx: 0.05, sy: 1.05, sz: 0.05 }); } }
  inst(BOX, steel, [...fr, ...rail]);
  const pane = reveal(new THREE.MeshPhysicalMaterial({ color: 0xcfefff, roughness: 0.05, transparent: true, opacity: 0.12, depthWrite: false, side: THREE.DoubleSide }));
  inst(BOX, pane, edges.map(([a, b, c, d]) => ({ x: (a + c) / 2, y: DECK + 0.5, z: (b + d) / 2, sx: 0.02, sy: 0.9, sz: Math.hypot(c - a, d - b), ry: Math.atan2(c - a, d - b) })), { shadow: false });
  inst(new THREE.CylinderGeometry(0.5, 0.5, 1, 6).rotateX(Math.PI / 2), neonMat, [{ x: x1 + 0.05, y: DECK - 0.15, z: 0, sx: 0.08, sy: 0.08, sz: zw, c: 0x22e6d6 }], { shadow: false });
  // 屋顶到台面的小台阶
  inst(BOXB, steel, [0, 1, 2, 3].map(i => ({ x: -13 - i * 0.8, y: ROOF + 0.2, z: 0, sx: 0.8, sy: 3.3 - i * 0.8, sz: 2 })));
}
// 火烈鸟霓虹：北邻酒店屋顶，面朝街道 —— 屋顶视角 heading 0 与 hero 视角都能看到
{ const nb = list.find(b => b.cz < -20 && !b.deco) || list[1];
  SLOTS.flamingo_sign.push({ x: -9.6, y: 5.2, z: nb.cz, ry: 0, h: 5.5, glow: 0xff4fc8 });
  const pl = new THREE.PointLight(0xff4fc8, 60, 28, 2); pl.position.set(-7, 7.5, nb.cz); world.add(pl); }
const neonLight = new THREE.PointLight(0x22e6d6, 25, 20, 2); neonLight.position.set(-8, 4.5, 14); world.add(neonLight);

// ---------- 西侧城区：街区网格 + 屋顶构件；远景天际线 ----------
const city = [], roofBits = [];
for (let bx = -40; bx > -620; bx -= 70) for (let bz = -640; bz < 640; bz += 60) {
  for (let k = 0; k < 5; k++) {
    const sx = 12 + rnd() * 14, sz = 10 + rnd() * 14, x = bx - 6 - rnd() * (52 - sx) - sx / 2, z = bz + 6 + rnd() * (46 - sz) + sz / 2;
    const far = -bx / 620; const h = 7 + rnd() * (10 + far * 30) + (rnd() < 0.06 ? 30 + rnd() * 40 : 0);
    city.push({ x, y: 0, z, sx, sy: h, sz, c: new THREE.Color(pick(PASTEL)).lerp(new THREE.Color(0xe8ddd5), 0.35) });
    if (rnd() < 0.6) roofBits.push({ x: x + (rnd() - 0.5) * sx * 0.5, y: h, z: z + (rnd() - 0.5) * sz * 0.5, sx: 2 + rnd() * 3, sy: 1.2 + rnd() * 1.5, sz: 2 + rnd() * 3 });
  }
}
// 天际线：西面市中心高楼 + 北/南两端海滨高层公寓
const towers = [];
for (let i = 0; i < 70; i++) { const a = -0.9 + rnd() * 1.8; const r = 900 + rnd() * 700; towers.push({ x: -Math.cos(a) * r, y: 0, z: Math.sin(a) * r, sx: 25 + rnd() * 25, sy: 70 + rnd() * 180, sz: 25 + rnd() * 25, c: pick([0xd9d0d8, 0xc8d6e0, 0xe6c8c0, 0xb8c0d0]) }); }
for (const s of [-1, 1]) for (let i = 0; i < 22; i++) towers.push({ x: -20 - rnd() * 90, y: 0, z: s * (680 + i * 45 + rnd() * 20), sx: 20 + rnd() * 15, sy: 30 + rnd() * 90, sz: 18 + rnd() * 12, c: pick(PASTEL) });
inst(BOXB, bldgMat(), city, { shadow: true });
inst(BOXB, std({ color: 0xd8cfc8, roughness: 0.9 }), roofBits);
inst(BOXB, bldgMat({ roughness: 0.5, metalness: 0.2 }), towers, { shadow: false });
// 塔顶红色航标灯
inst(new THREE.SphereGeometry(1.2, 6, 4), glow(0xff2a2a, 6), towers.filter(t => t.sy > 150).map(t => ({ x: t.x, y: t.sy + 2, z: t.z })), { shadow: false });

// ---------- 路灯（带暖光点） ----------
const lamps = [];
for (let z = -600; z < 600; z += 24) { lamps.push({ x: -2.6, z }); lamps.push({ x: 9.6, z: z + 12 }); }
const lampM = std({ color: 0x2a2a2e, metalness: 0.8, roughness: 0.4 });
inst(new THREE.CylinderGeometry(0.08, 0.12, 6, 6).translate(0, 3, 0), lampM, lamps.map(l => ({ x: l.x, z: l.z })));
inst(new THREE.SphereGeometry(0.28, 10, 6), glow(0xffd8a0, 3), lamps.map(l => ({ x: l.x, y: 6.1, z: l.z })), { shadow: false });

// ---------- 棕榈（Tripo palm_a / palm_b） ----------
for (let z = -600; z < 600; z += 12 + rnd() * 4) SLOTS[rnd() < 0.6 ? 'palm_a' : 'palm_b'].push({ x: -3.2 - rnd() * 0.5, z, h: 9 + rnd() * 3, ry: rnd() * 6.28 });
for (let z = -600; z < 600; z += 8 + rnd() * 3) SLOTS[rnd() < 0.6 ? 'palm_a' : 'palm_b'].push({ x: 11 + rnd() * 2, y: 0.13, z, h: 10 + rnd() * 4, ry: rnd() * 6.28 });
for (let i = 0; i < 70; i++) SLOTS.palm_b.push({ x: 20 + rnd() * 25, y: 0, z: (rnd() - 0.5) * 900, h: 7 + rnd() * 5, ry: rnd() * 6.28 });
// 灌木 + 救生员小屋 + 沙滩伞
inst(new THREE.IcosahedronGeometry(1, 1), std({ color: 0x3d6b3a, roughness: 1 }), Array.from({ length: 240 }, () => ({ x: 9.8 + rnd() * 4, y: 0.5, z: (rnd() - 0.5) * 1100, sx: 1.2, sy: 0.8, sz: 1.4 })));
const huts = [-120, -30, 50, 150, 260, -240].map(z => ({ x: 52, z }));
inst(BOXB, std({ color: 0xf27aa0, roughness: 0.6 }), huts.map(h => ({ x: h.x, y: 2.2, z: h.z, sx: 3, sy: 2.4, sz: 3 })));
inst(BOXB, std({ color: 0x8fd6e8, roughness: 0.6 }), huts.map(h => ({ x: h.x, y: 4.6, z: h.z, sx: 3.6, sy: 0.3, sz: 3.6 })));
inst(new THREE.CylinderGeometry(0.1, 0.1, 2.2, 5).translate(0, 1.1, 0), lampM, huts.flatMap(h => [[-1.2, -1.2], [1.2, -1.2], [-1.2, 1.2], [1.2, 1.2]].map(([a, b]) => ({ x: h.x + a, y: -0.2, z: h.z + b }))));
const umbC = [0xe2566e, 0x2bb5a8, 0xfbe39c, 0xffffff, 0x3fa0ff];
const beachU = Array.from({ length: 90 }, () => ({ x: 25 + rnd() * 35, z: (rnd() - 0.5) * 800, c: pick(umbC) }));
inst(new THREE.ConeGeometry(1.3, 0.45, 10, 1, true), std({ roughness: 0.8, side: THREE.DoubleSide }), beachU.map(u => ({ x: u.x, y: 2.1 - (u.x - 15) * 0.02, z: u.z, c: u.c })));
inst(new THREE.CylinderGeometry(0.03, 0.03, 2.2, 4).translate(0, 1.1, 0), lampM, beachU.map(u => ({ x: u.x, y: -(u.x - 15) * 0.02, z: u.z })));

// ---------- 车（Tripo 3 款老爷车） ----------
const CARS = ['car_convertible_cream', 'car_sedan_red', 'car_sedan_white'];
for (let z = -560; z < 560; z += 6.5 + rnd() * 4) if (rnd() < 0.8) SLOTS[pick(CARS)].push({ x: -0.6, z, ry: 0 });           // 西侧路边停车
for (let z = -560; z < 560; z += 7 + rnd() * 6) if (rnd() < 0.7) SLOTS[pick(CARS)].push({ x: 7.7, z, ry: Math.PI });      // 东侧路边
for (let z = -560; z < 560; z += 18 + rnd() * 22) SLOTS[pick(CARS)].push({ x: 2.0, z, ry: 0 });                               // 北行
for (let z = -560; z < 560; z += 18 + rnd() * 22) SLOTS[pick(CARS)].push({ x: 5.1, z, ry: Math.PI });                         // 南行

// ---------- lobby 圆环 ----------
const lobbyRing = new THREE.Mesh(new THREE.TorusGeometry(0.25, 0.008, 8, 64), new THREE.MeshBasicMaterial({ color: new THREE.Color(2.5, 0.8, 1.8), toneMapped: false }));
lobbyRing.visible = false; scene.add(lobbyRing);

// ---------- Tripo GLB ----------
pending.push(loadSlots(world, SLOTS, { reveal, matOf, lite: LITE }).catch(e => console.warn('slots', e)));

// ---------- 后期（仅桌面） ----------
const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
if (AO && !LITE) { const g = new GTAOPass(scene, camera, innerWidth, innerHeight); g.updateGtaoMaterial({ radius: 1.2, distanceExponent: 1.5, thickness: 2, scale: 1 }); g.blendIntensity = 0.85; composer.addPass(g); }
composer.addPass(new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.4, 0.45, 1.1));
composer.addPass(new OutputPass());

// ---------- reveal ----------
let anim = null;
function startReveal() { if (anim || R.uR.value > 1000) return; anim = performance.now(); lobbyRing.visible = false; }
function updateReveal(now) { if (!anim) return; const t = Math.min((now - anim) / 3000, 1); R.uR.value = 2 + Math.pow(t, 2.2) * 4200; if (t >= 1) { R.uR.value = 1e5; anim = null; } }

// ---------- 进入 ----------
function setLite(on) { water.visible = !on; seaLite.visible = on; renderer.shadowMap.enabled = !on; }
if (LITE) setLite(true);
const btn = document.getElementById('enter');
async function enter() {
  if (navigator.xr) {
    let mode = null;
    if (await navigator.xr.isSessionSupported('immersive-ar').catch(() => false)) mode = 'immersive-ar';
    else if (await navigator.xr.isSessionSupported('immersive-vr').catch(() => false)) mode = 'immersive-vr';
    if (mode) {
      const session = await navigator.xr.requestSession(mode, { optionalFeatures: ['local-floor', 'hand-tracking'] });
      setLite(true);
      renderer.setClearColor(LOBBY, mode === 'immersive-ar' ? 0 : 1);
      world.position.set(-VIEW.x, -DECK - 0.05, -VIEW.z); xrRoot.updateMatrixWorld(true);  // 用户脚 = 屋顶，面朝北沿街
      R.uC.value.set(0, 1.6, 0); R.uR.value = 0; lobbyRing.visible = true;
      session.addEventListener('select', startReveal);
      session.addEventListener('end', () => location.reload());
      await renderer.xr.setSession(session);
      document.getElementById('ui').style.display = 'none';
      return;
    }
  }
  document.getElementById('ui').style.display = 'none'; startReveal();
}
btn.onclick = enter;
if (SHOT) document.getElementById('ui').style.display = 'none';
addEventListener('keydown', e => { if (e.code === 'Space') startReveal(); });
// 桌面：拖动环视（360 检查）
let drag = null, yaw = HEAD != null ? +HEAD : 20, pitch = -24;
addEventListener('pointerdown', e => drag = [e.clientX, e.clientY]); addEventListener('pointerup', () => drag = null);
addEventListener('pointermove', e => { if (!drag || HERO) return; yaw -= (e.clientX - drag[0]) * 0.15; pitch = Math.max(-60, Math.min(40, pitch + (e.clientY - drag[1]) * 0.15)); drag = [e.clientX, e.clientY]; aim(yaw, pitch); });
addEventListener('resize', () => { camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); renderer.setSize(innerWidth, innerHeight); composer.setSize(innerWidth, innerHeight); });

let frames = 0, ready = false;
Promise.all(pending).then(() => { ready = true; });
const clock = new THREE.Clock();
renderer.setAnimationLoop(now => {
  if (paused) return;
  const dt = clock.getDelta();
  updateReveal(now);
  water.material.uniforms.time.value += dt * 0.6;
  water.visible = !seaLite.visible && R.uR.value > 30;
  if (renderer.xr.isPresenting) {
    const xc = renderer.xr.getCamera();
    if (lobbyRing.visible) { lobbyRing.position.copy(xc.position).add(new THREE.Vector3(0, 0, -1.2).applyQuaternion(xc.quaternion)); lobbyRing.quaternion.copy(xc.quaternion); }
    renderer.setClearColor(LOBBY, renderer.xr.getSession()?.environmentBlendMode === 'opaque' || R.uR.value > 1000 ? 1 : 0);
    renderer.render(scene, camera);
  } else composer.render(dt);
  if (ready && ++frames > 3) window.__READY = true;
});
