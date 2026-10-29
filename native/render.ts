// The theatrical carved-wood stage on starhermit:scene, ported from the
// browser build's three.js layer (js/render.js before the port): the timber
// wheel with its seeded carved face, edge, brass rim and rivets, hub and boss,
// the preplaced blades and warded sigils, the stand, the standby blade, the
// worn stage boards, gradient curtain, carved posts with brass caps and
// bands, seeded crates, drifting embers, the overhead spot, the contact
// reticle, the throw arcs and deflections, the pooled chip and spark bursts,
// the intro swoop and the camera shake, and the look per graphics level from
// quality.ts. The wheel's angle is rotationAt(profile, tick + alpha), so the
// view is a pure function of the rules snapshot; it never mutates it.
//
// What changed from three.js, and why:
// - Shape + ExtrudeGeometry (the blade's profile) is geometry.ts.
// - The EffectComposer chain (GTAO, UnrealBloom, OutputPass, the grade
//   ShaderPass, SMAA / FXAA / MSAA) is renderer.ao / bloom / grade /
//   antialias; the grade's GLSL (an S-curve blended 0.22, saturation 1.08,
//   cool shadows / warm highlights, the vignette) is the built-in
//   display-space grade with the same curve, tints and vignette.
// - Low's steel is MeshPhongMaterial as on the page (since minor 29); the per-particle opacity of
//   the spark pool (a mesh and material each) is one InstancedMesh whose
//   particles shrink as they fade.
// - The canvas sat between the top bar and the rails; the scene fills the
//   window here, and the camera's view offset (setViewOffset) puts the
//   playfield's frustum where the canvas was. The camera fit measured the
//   DOM's HUD bands; screens.ts passes the playfield and the bands it lays
//   out (setPlayfield), and fitFraming is otherwise unchanged.
// - Light intensities, shadow values and the PMREM RoomEnvironment are
//   three.js r160's as the page had them (engine minor 28). Standard
//   materials get the room as their own envMap so their envMapIntensity
//   applies as r160 did with scene.environment. The canvas textures are CanvasTextures of starhermit:canvas
//   (sRGB, as the browser build's SRGBColorSpace CanvasTextures were).
import {
  ACESFilmicToneMapping, AdditiveBlending, BoxGeometry, BufferAttribute, BufferGeometry, CanvasTexture, CircleGeometry,
  Color, CylinderGeometry, DataTexture, DirectionalLight, Fog, Group, HemisphereLight, InstancedMesh, Matrix4, Mesh,
  MeshBasicMaterial, MeshLambertMaterial, MeshPhongMaterial, MeshPhysicalMaterial, MeshStandardMaterial, PCFSoftShadowMap, PMREMGenerator,
  PerspectiveCamera, PlaneGeometry, PointLight, Points, PointsMaterial, RepeatWrapping, RingGeometry, RoomEnvironment,
  SRGBColorSpace, SphereGeometry, SpotLight, TorusGeometry, Vector3, renderer, scene,
} from "starhermit:scene";
import type { Material, Object3D, Texture } from "starhermit:scene";
import { OffscreenCanvas, type OffscreenCanvasRenderingContext2D } from "starhermit:canvas";
import { makeRng, rotationAt, TAU } from "../js/rules.js";
import { themeById } from "../js/content.js";
import { bladeGeometry } from "./geometry.ts";
import { particleCap, type Budget, type Look } from "./quality.ts";

type Theme = ReturnType<typeof themeById>;
type Rng = ReturnType<typeof makeRng>;
interface Slot { angle: number; type: string; embedded?: boolean }
export interface ViewState { rotation: Record<string, number>; tick: number; slots: Slot[] }
interface Content { seed: string; theme: string; preplaced?: { deg: number; type: string }[] }
interface RulesEvent { type: string; angle?: number; blockedBy?: string }

const PI = Math.PI;

// Authored framing constants (no magic offsets scattered through code)
const FRAMING = {
  cameraPos: new Vector3(0, 0.55, 6.4),
  cameraLook: new Vector3(0, 0.1, 0),
  fov: 34,
  wheelRadius: 1.5,
  bladeOrbitRadius: 1.08,
  throwOrigin: new Vector3(0, -2.6, 2.2),
  contactWorldAngle: -PI / 2, // 6 o'clock
  introSwoopSeconds: 1.1,
};

const camera = new PerspectiveCamera(FRAMING.fov, 16 / 9, 0.1, 60);
let look: Look | null = null;
let BUD: Budget = { material: "physical", mergedBlades: false, segments: 96, texture: 1024, particles: 1, embers: 70, bloomRes: 1 };
let reducedMotion = false;
let content: Content | null = null;
let theme: Theme = themeById("ember-oak");
let built = false;
let lastState: ViewState | null = null;
let time = 0;
const _m = new Matrix4();

// scene graph roots
const envGroup = new Group();
const wheelGroup = new Group(); // rotates with sim rotation
const stageGroup = new Group(); // static gameplay dressing
const fxGroup = new Group();
wheelGroup.position.set(0, 0.1, 0);

let keyLight: DirectionalLight | null = null;
let accentLight: PointLight | null = null;
let faceMaterial: Material | null = null;
let standbyBlade: Group | null = null;
let standbyHiddenUntil = 0;
let reticle: Mesh | null = null;
let reticleBase = 0;
let embers: Points | null = null;
let emberSeeds: { speed: number; phase: number; sway: number }[] = [];
let particles: ParticlePool | null = null;
const embeddedViews: Group[] = [];
interface Flying { mesh: Group; t: number; duration: number; willEmbed: boolean; deflect: { vx: number; vy: number; vz: number; spin: number } | null; done?: boolean }
let flyingBlades: Flying[] = [];
const shake = { amp: 0, t: 0 };
const swoop = { active: false, t: 1 };
/** HUD bands over the frame, as fractions (screens.ts lays them out). */
const bands = { top: 0, bottom: 0, left: 0, right: 0 };
let framing = { dist: 0, lookY: FRAMING.cameraLook.y, lookX: 0 };
let fitKey = "";

// ---------------------------------------------------------------- materials
// Materials are made per stage build and disposed with it (disposeGroup);
// the blade's are shared by every blade of the build.
let made: Material[] = [];
function keep<M extends Material>(m: M): M { made.push(m); return m; }
interface MatOpts { color?: number | string | Color; map?: Texture | null; roughness?: number; metalness?: number; envMapIntensity?: number; clearcoat?: number; clearcoatRoughness?: number; emissive?: number | string | Color; emissiveIntensity?: number; vertexColors?: boolean }
/** Wood/plain surfaces: Lambert on Low, Standard above. */
function surfaceMat(o: MatOpts): Material {
  if (BUD.material === "lambert") return keep(new MeshLambertMaterial({ color: o.color, map: o.map ?? null }));
  return keep(new MeshStandardMaterial({ color: o.color, map: o.map ?? null, roughness: o.roughness, metalness: o.metalness ?? 0, envMapIntensity: o.envMapIntensity }));
}
/** Metal parts: Phong on Low (as the page), Standard on Balanced, clearcoat Physical on High/Ultra when asked. */
function metalMat(o: MatOpts): Material {
  if (BUD.material === "lambert") return keep(new MeshPhongMaterial({ color: o.color, vertexColors: !!o.vertexColors, specular: 0x9a9a9a, shininess: 70 }));
  const base = { color: o.color, roughness: o.roughness, metalness: o.metalness, envMapIntensity: o.envMapIntensity, vertexColors: !!o.vertexColors };
  if (BUD.material === "standard" || !o.clearcoat) return keep(new MeshStandardMaterial(base));
  return keep(new MeshPhysicalMaterial({ ...base, clearcoat: o.clearcoat, clearcoatRoughness: o.clearcoatRoughness }));
}

// ---------------------------------------------------------------- procedural textures
function rgba(hex: string, a: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}
/** Seeded carved-wood face: growth rings, grain streaks, carve notches (drawn in a fixed 512 space). */
function paintWood(g: OffscreenCanvasRenderingContext2D, th: Theme, seed: string, px: number): void {
  const rng = makeRng(seed);
  g.scale(px / 512, px / 512);
  const size = 512;
  const cx = size / 2, cy = size / 2;
  g.fillStyle = th.wood;
  g.fillRect(0, 0, size, size);
  for (let r = 12; r < size / 2; r += 8 + rng.next() * 14) {
    g.beginPath();
    g.arc(cx, cy, r + rng.range(-2, 2), 0, TAU);
    g.strokeStyle = rgba(th.woodDark, 0.25 + rng.next() * 0.3);
    g.lineWidth = 1 + rng.next() * 3;
    g.stroke();
  }
  for (let i = 0; i < 90; i++) {
    const a = rng.range(0, TAU);
    const r0 = rng.range(10, size * 0.2);
    const r1 = r0 + rng.range(30, size * 0.28);
    g.beginPath();
    g.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0);
    g.lineTo(cx + Math.cos(a + rng.range(-0.05, 0.05)) * r1, cy + Math.sin(a) * r1);
    g.strokeStyle = rgba(rng.next() < 0.5 ? th.woodDark : th.ring, 0.1 + rng.next() * 0.12);
    g.lineWidth = 1 + rng.next() * 2;
    g.stroke();
  }
  for (let i = 0; i < 18; i++) {
    const a = (i / 18) * TAU + rng.range(-0.05, 0.05);
    const r = size * 0.44;
    g.beginPath();
    g.arc(cx + Math.cos(a) * r, cy + Math.sin(a) * r, 3 + rng.next() * 3, 0, TAU);
    g.fillStyle = rgba(th.woodDark, 0.5);
    g.fill();
  }
  const grad = g.createRadialGradient(cx, cy, size * 0.05, cx, cy, size * 0.5);
  grad.addColorStop(0, rgba("#000000", 0.18));
  grad.addColorStop(0.5, rgba("#000000", 0));
  grad.addColorStop(1, rgba("#000000", 0.22));
  g.fillStyle = grad;
  g.fillRect(0, 0, size, size);
  if (px > 512) {
    // fine fibre noise: short tangential scratches that catch the bump and clearcoat
    for (let i = 0; i < 2600; i++) {
      const a = rng.range(0, TAU);
      const r = rng.range(20, size * 0.49);
      const len = rng.range(0.03, 0.12);
      g.beginPath();
      g.arc(cx, cy, r, a, a + len);
      g.strokeStyle = rgba(rng.next() < 0.6 ? th.woodDark : th.ring, 0.08 + rng.next() * 0.1);
      g.lineWidth = 0.4 + rng.next() * 0.6;
      g.stroke();
    }
  }
}
const texCache = new Map<string, Texture>();
function cached(id: string, make: () => Texture): Texture {
  let t = texCache.get(id);
  if (!t) { t = make(); texCache.set(id, t); }
  return t;
}
/** Drops the stage textures of other stages (the title's and the round's stay). */
function trimTextures(keepPrefix: string[]): void {
  for (const [id, t] of texCache) {
    if (id.startsWith("glow") || keepPrefix.some((p) => id.startsWith(p))) continue;
    t.dispose();
    texCache.delete(id);
  }
}
function woodTexture(seed: string, px: number): Texture {
  return cached(`wood:${theme.id}:${seed}:${px}`, () => {
    const c = new OffscreenCanvas(px, px);
    paintWood(c.getContext("2d"), theme, seed, px);
    const tex = new CanvasTexture(c);
    tex.colorSpace = SRGBColorSpace;
    tex.anisotropy = 8;
    return tex;
  });
}
/** Seeded worn stage boards for the floor (tiling). */
function plankTexture(seed: string): Texture {
  return cached(`planks:${theme.id}:${seed}`, () => {
    const rng = makeRng(seed);
    const size = 512;
    const c = new OffscreenCanvas(size, size);
    const g = c.getContext("2d");
    g.fillStyle = theme.floor;
    g.fillRect(0, 0, size, size);
    const boards = 8;
    const bw = size / boards;
    for (let b = 0; b < boards; b++) {
      const x = b * bw;
      g.fillStyle = rgba(rng.next() < 0.5 ? theme.woodDark : theme.wood, 0.12 + rng.next() * 0.14);
      g.fillRect(x, 0, bw, size);
      for (let i = 0; i < 14; i++) {
        const gx = x + rng.range(3, bw - 3);
        g.beginPath();
        g.moveTo(gx, 0);
        g.bezierCurveTo(gx + rng.range(-4, 4), size * 0.33, gx + rng.range(-4, 4), size * 0.66, gx + rng.range(-2, 2), size);
        g.strokeStyle = rgba(theme.woodDark, 0.12 + rng.next() * 0.15);
        g.lineWidth = 0.6 + rng.next() * 1.2;
        g.stroke();
      }
      g.fillStyle = rgba("#000000", 0.45);
      g.fillRect(x, 0, 2, size);
      g.fillRect(x, rng.range(0, size), bw, 2);
    }
    const tex = new CanvasTexture(c);
    tex.colorSpace = SRGBColorSpace;
    tex.wrapS = tex.wrapT = RepeatWrapping;
    tex.repeat.set(6, 6);
    tex.anisotropy = 8;
    return tex;
  });
}
/** The backdrop curtain: a vertical gradient sky → fog → floor. */
function curtainTexture(): Texture {
  return cached(`curtain:${theme.id}`, () => {
    const c = new OffscreenCanvas(4, 256);
    const g = c.getContext("2d");
    const grad = g.createLinearGradient(0, 0, 0, 256);
    grad.addColorStop(0, theme.sky);
    grad.addColorStop(0.7, theme.fog);
    grad.addColorStop(1, theme.floor);
    g.fillStyle = grad;
    g.fillRect(0, 0, 4, 256);
    const tex = new CanvasTexture(c);
    tex.colorSpace = SRGBColorSpace;
    return tex;
  });
}
/** Soft round sprite shared by the ember motes. */
function glowTexture(): Texture {
  return cached("glow", () => {
    const n = 64;
    const px = new Uint8Array(n * n * 4);
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        const d = Math.min(1, Math.hypot(x + 0.5 - n / 2, y + 0.5 - n / 2) / (n / 2));
        // the browser build's radial stops: 1 at 0, 0.45 at 0.35, 0 at 1
        const a = d < 0.35 ? 1 - (d / 0.35) * 0.55 : 0.45 * (1 - (d - 0.35) / 0.65);
        const o = (y * n + x) * 4;
        px[o] = px[o + 1] = px[o + 2] = 255;
        px[o + 3] = Math.round(Math.max(0, a) * 255);
      }
    }
    const tex = new DataTexture(px, n, n);
    tex.colorSpace = SRGBColorSpace;
    return tex;
  });
}

// ---------------------------------------------------------------- blades and sigils
let bladeGeos: { blade: BufferGeometry; handle: BufferGeometry; guard: BufferGeometry; pommel: BufferGeometry } | null = null;
function getBladeGeos(): NonNullable<typeof bladeGeos> {
  if (bladeGeos) return bladeGeos;
  const handle = new CylinderGeometry(0.028, 0.034, 0.2, 12);
  handle.translate(0, -0.1, 0);
  const guard = new BoxGeometry(0.11, 0.03, 0.04);
  const pommel = new SphereGeometry(0.036, 12, 8);
  pommel.translate(0, -0.205, 0);
  bladeGeos = { blade: bladeGeometry(), handle, guard, pommel };
  return bladeGeos;
}
// Low/Balanced blade variant: blade, handle, guard and pommel merged into one
// geometry with their colours as vertex colours (one draw per blade).
const mergedBladeGeos = new Map<string, BufferGeometry>();
function mergedBladeGeometry(): BufferGeometry {
  const hit = mergedBladeGeos.get(theme.id);
  if (hit) return hit;
  const g = getBladeGeos();
  const parts: [BufferGeometry, string][] = [[g.blade, theme.metal], [g.handle, theme.handle], [g.guard, theme.rim], [g.pommel, theme.rim]];
  const flat = parts.map(([geo, color]) => [geo.getIndex() ? geo.toNonIndexed() : geo.clone(), new Color(color)] as const);
  const total = flat.reduce((n, [geo]) => n + geo.getAttribute("position")!.count, 0);
  const pos = new Float32Array(total * 3), nor = new Float32Array(total * 3), col = new Float32Array(total * 3);
  let o = 0;
  for (const [geo, c] of flat) {
    const p = geo.getAttribute("position")!, n = geo.getAttribute("normal")!;
    pos.set(p.array as Float32Array, o * 3);
    nor.set(n.array as Float32Array, o * 3);
    for (let i = 0; i < p.count; i++) col.set([c.r, c.g, c.b], (o + i) * 3);
    o += p.count;
    geo.dispose();
  }
  const out = new BufferGeometry();
  out.setAttribute("position", new BufferAttribute(pos, 3));
  out.setAttribute("normal", new BufferAttribute(nor, 3));
  out.setAttribute("color", new BufferAttribute(col, 3));
  out.computeBoundingSphere();
  mergedBladeGeos.set(theme.id, out);
  return out;
}
let bladeMats: { merged: Material; blade: Material; handle: Material; guard: Material } | null = null;
function getBladeMats(): NonNullable<typeof bladeMats> {
  if (bladeMats) return bladeMats;
  const merged = BUD.material === "lambert"
    ? keep(new MeshPhongMaterial({ vertexColors: true, specular: 0x8a8a8a, shininess: 80 }))
    : keep(new MeshStandardMaterial({ vertexColors: true, roughness: 0.3, metalness: 0.75, envMapIntensity: 0.7 }));
  const blade = keep(new MeshPhysicalMaterial({ color: theme.metal, roughness: 0.24, metalness: 0.92, clearcoat: 0.2, clearcoatRoughness: 0.2, envMapIntensity: 0.8 }));
  const handle = keep(new MeshStandardMaterial({ color: theme.handle, roughness: 0.7, envMapIntensity: 0.4 }));
  const guard = keep(new MeshStandardMaterial({ color: theme.rim, roughness: 0.32, metalness: 0.85, envMapIntensity: 0.6 }));
  bladeMats = { merged, blade, handle, guard };
  return bladeMats;
}
/** local angle on the wheel face, so world angle = contact point at 6 o'clock. */
function localAngle(deg: number): number { return (deg * PI) / 180 + FRAMING.contactWorldAngle; }
/** A blade: in flight it points along +y; on the wheel at `angle` (local), tip toward the hub. */
function makeBladeMesh(angle: number, flight: boolean): Group {
  const group = new Group();
  const mats = getBladeMats();
  if (BUD.mergedBlades) {
    const mesh = new Mesh(mergedBladeGeometry(), mats.merged);
    mesh.castShadow = true;
    group.add(mesh);
  } else {
    const g = getBladeGeos();
    const parts = [new Mesh(g.blade, mats.blade), new Mesh(g.handle, mats.handle), new Mesh(g.guard, mats.guard), new Mesh(g.pommel, mats.guard)];
    for (const m of parts) m.castShadow = true;
    group.add(...parts);
  }
  if (!flight) {
    const r = FRAMING.bladeOrbitRadius;
    group.position.set(Math.cos(angle) * r, Math.sin(angle) * r, 0.12);
    group.rotation.z = angle - PI / 2; // tip points toward hub
    group.rotation.x = -0.12; // slight tilt for silhouette readability
  }
  return group;
}
/** Protected marker: glowing sigil disc with a distinct shape (not color alone). */
function makeMarkerMesh(angle: number): Group {
  const group = new Group();
  const disc = new Mesh(new CircleGeometry(0.14, 6), keep(new MeshStandardMaterial({
    color: theme.marker, roughness: 0.4, metalness: 0.2, emissive: theme.marker, emissiveIntensity: 0.9,
  })));
  // The ward ring is over-bright so it blooms when bloom is on (glowing sigil), crisp otherwise.
  const ring = new Mesh(new RingGeometry(0.16, 0.19, 32), keep(new MeshBasicMaterial({ color: new Color(theme.marker).multiplyScalar(1.8), transparent: true, opacity: 0.8 })));
  ring.noAO = disc.noAO = true;
  group.add(disc, ring);
  const r = FRAMING.bladeOrbitRadius;
  group.position.set(Math.cos(angle) * r, Math.sin(angle) * r, 0.02);
  return group;
}

// ---------------------------------------------------------------- particle pool
// Bounded, pooled, cosmetic: one InstancedMesh (its colour per particle);
// a particle shrinks to nothing over its life.
class ParticlePool {
  mesh: InstancedMesh;
  rng: Rng;
  slots: { alive: boolean; x: number; y: number; z: number; vx: number; vy: number; vz: number; life: number; age: number; size: number }[] = [];
  capacity = 0;
  cursor = 0;
  constructor(max: number, seed: string) {
    this.rng = makeRng(seed);
    this.mesh = new InstancedMesh(new PlaneGeometry(0.035, 0.035), keep(new MeshBasicMaterial({ color: 0xffffff, depthWrite: false })), max);
    this.mesh.noAO = true;
    this.mesh.frustumCulled = false;
    for (let i = 0; i < max; i++) {
      this.slots.push({ alive: false, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, life: 0, age: 0, size: 1 });
      _m.makeScale(0, 0, 0);
      this.mesh.setMatrixAt(i, _m);
      this.mesh.setColorAt(i, new Color(0xffffff));
    }
    this.mesh.instanceMatrix.needsUpdate = true;
    fxGroup.add(this.mesh);
    this.setCapacity(max);
  }
  setCapacity(n: number): void {
    this.capacity = Math.min(n, this.slots.length);
    if (this.cursor >= this.capacity) this.cursor = 0;
  }
  burst(pos: Vector3, o: { count: number; color: string; speed: number; life: number; tag: "wood" | "spark" }): void {
    const col = new Color(o.color);
    if (o.tag === "spark") col.multiplyScalar(2.2); // hot sparks bloom
    const n = Math.min(o.count, this.capacity);
    for (let i = 0; i < n; i++) {
      const idx = this.cursor;
      const s = this.slots[idx]!;
      this.cursor = (this.cursor + 1) % this.capacity;
      s.alive = true;
      s.age = 0;
      s.life = o.life * (0.6 + this.rng.next() * 0.8);
      const a = this.rng.range(0, TAU);
      const up = o.tag === "spark" ? 1.4 : 0.8;
      s.vx = Math.cos(a) * o.speed * (0.3 + this.rng.next());
      s.vy = Math.sin(a) * o.speed * 0.6 + up;
      s.vz = 0.5 + this.rng.next() * 1.2;
      s.x = pos.x; s.y = pos.y; s.z = pos.z;
      s.size = (o.tag === "spark" ? 0.8 : 1.4) * (0.6 + this.rng.next() * 0.8);
      this.mesh.setColorAt(idx, col);
    }
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }
  update(dt: number): void {
    const speedScale = reducedMotion ? 0.4 : 1; // reduced motion: slower particles
    let any = false;
    for (let i = 0; i < this.slots.length; i++) {
      const s = this.slots[i]!;
      if (!s.alive) continue;
      any = true;
      s.age += dt;
      if (s.age >= s.life) {
        s.alive = false;
        _m.makeScale(0, 0, 0);
        this.mesh.setMatrixAt(i, _m);
        continue;
      }
      s.vy -= 5.5 * dt * speedScale;
      s.x += s.vx * dt * speedScale;
      s.y += s.vy * dt * speedScale;
      s.z += s.vz * dt * speedScale;
      const k = s.size * (1 - s.age / s.life);
      _m.makeScale(k, k, k);
      _m.setPosition(s.x, s.y, s.z);
      this.mesh.setMatrixAt(i, _m);
    }
    if (any) this.mesh.instanceMatrix.needsUpdate = true;
  }
}

// ---------------------------------------------------------------- building
function disposeGroup(g: Object3D): void {
  const shared = new Set<BufferGeometry>([...Object.values(bladeGeos ?? {}), ...mergedBladeGeos.values()]);
  g.traverse((o) => {
    const m = o as Mesh;
    if (m.geometry && !shared.has(m.geometry)) m.geometry.dispose();
  });
  g.clear();
}
function clearAll(): void {
  for (const g of [envGroup, stageGroup, wheelGroup, fxGroup]) disposeGroup(g);
  for (const m of made) m.dispose();
  made = [];
  bladeMats = null;
  embeddedViews.length = 0;
  flyingBlades = [];
  particles = null;
  embers = null;
  reticle = null;
  standbyBlade = null;
  keyLight = null;
  accentLight = null;
  faceMaterial = null;
}

function setup(): void {
  built = true;
  scene.add(envGroup, stageGroup, wheelGroup, fxGroup);
  renderer.camera = camera;
  renderer.toneMapping = ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
}

function buildLights(): void {
  const t = theme;
  const key = new DirectionalLight(t.key, 2.4);
  key.position.set(2.5, 4, 4);
  // Shadow frustum fitted tightly around the wheel, its stand and the flanking posts.
  Object.assign(key.shadow.camera, { left: -3.3, right: 3.3, top: 3.1, bottom: -3.1, near: 1.5, far: 12 });
  key.shadow.camera.updateProjectionMatrix();
  key.shadow.bias = -0.0004;
  key.shadow.normalBias = 0.015;
  const fill = new HemisphereLight(t.fill, t.floor, 0.9);
  const accent = new PointLight(t.accent, 6, 12, 1.6);
  accent.position.set(0, 0.3, 2.5);
  // Cool rim light from behind the wheel: separates steel edges from the dark stage.
  const rimLight = new DirectionalLight(new Color(t.fill).lerp(new Color("#ffffff"), 0.4), 1.1);
  rimLight.position.set(-2, 3, -4);
  envGroup.add(key, key.target, fill, accent, rimLight);
  keyLight = key;
  accentLight = accent;
  if (look!.detailed) {
    // Theatrical overhead spot: a warm pool of light on the wheel and the boards below it.
    const spot = new SpotLight(t.key, 24, 16, 0.42, 0.65, 1.6);
    spot.position.set(0, 6.5, 3.2);
    spot.target.position.set(0, -0.6, 0);
    envGroup.add(spot, spot.target);
  }
}

function buildEnvironment(): void {
  const t = theme;
  const detailed = look!.detailed;
  const seed = content!.seed;
  // floor: plain, or worn stage boards with a soft pool of light under the wheel
  const floorMat = detailed
    ? surfaceMat({ color: "#ffffff", map: plankTexture(`${seed}:floor`), roughness: 0.82, envMapIntensity: 0.25 })
    : surfaceMat({ color: t.floor, roughness: 0.95, envMapIntensity: 0.25 });
  const floor = new Mesh(new CircleGeometry(14, 40), floorMat);
  floor.rotation.x = -PI / 2;
  floor.position.y = -2.2;
  floor.receiveShadow = true;
  envGroup.add(floor);

  // backdrop curtain: vertical gradient
  const backdrop = new Mesh(new PlaneGeometry(40, 20), keep(new MeshBasicMaterial({ map: curtainTexture(), fog: false })));
  backdrop.position.set(0, 3, -10);
  backdrop.noAO = true;
  envGroup.add(backdrop);

  // stage props: carved posts flanking the wheel; scenery density follows surface detail
  const postMat = surfaceMat({ color: t.woodDark, roughness: 0.9, envMapIntensity: 0.3 });
  const postGeo = new CylinderGeometry(0.16, 0.22, 4.4, detailed ? 16 : 10);
  const capGeo = new SphereGeometry(0.24, detailed ? 20 : 10, detailed ? 14 : 8);
  const bandGeo = new TorusGeometry(0.19, 0.03, 8, 20);
  const brass = metalMat({ color: t.rim, roughness: 0.36, metalness: 0.85, envMapIntensity: 0.5 });
  for (const sx of [-2.6, 2.6]) {
    const post = new Mesh(postGeo, postMat);
    post.position.set(sx, 0, -0.6);
    post.castShadow = true;
    const cap = new Mesh(capGeo, brass);
    cap.position.set(sx, 2.3, -0.6);
    envGroup.add(post, cap);
    if (detailed) {
      // brass bands where the carved posts are bound
      for (const y of [1.8, -1.2]) {
        const band = new Mesh(bandGeo, brass);
        band.rotation.x = PI / 2;
        band.position.set(sx, y, -0.6);
        envGroup.add(band);
      }
    }
  }
  if (detailed) {
    // scattered crates for environmental storytelling
    const rng = makeRng(`${seed}:decor`);
    const crateMat = BUD.material === "lambert"
      ? keep(new MeshLambertMaterial({ color: t.wood }))
      : keep(new MeshStandardMaterial({ color: t.wood, roughness: 0.85 }));
    const crates = new InstancedMesh(new BoxGeometry(0.5, 0.5, 0.5), crateMat, 6);
    for (let i = 0; i < 6; i++) {
      const x = rng.range(-5, 5);
      if (Math.abs(x) < 2.2) { _m.makeScale(0, 0, 0); crates.setMatrixAt(i, _m); continue; }
      _m.makeRotationY(rng.range(0, TAU));
      _m.setPosition(x, -1.95, rng.range(-2.5, 0.5));
      crates.setMatrixAt(i, _m);
    }
    crates.instanceMatrix.needsUpdate = true;
    crates.castShadow = crates.receiveShadow = true;
    envGroup.add(crates);
  }
}

/** Slow drifting embers / dust motes in the stage light (particles high, full motion). */
function buildEmbers(): void {
  const n = Math.max(1, look!.budget.embers);
  const rng = makeRng(`${content!.seed}:embers`);
  const pos = new Float32Array(n * 3);
  emberSeeds = [];
  for (let i = 0; i < n; i++) {
    pos[i * 3] = rng.range(-5, 5);
    pos[i * 3 + 1] = rng.range(-2.2, 3.5);
    pos[i * 3 + 2] = rng.range(-3.5, -0.4); // behind the wheel plane: never over gameplay
    emberSeeds.push({ speed: rng.range(0.05, 0.18), phase: rng.range(0, TAU), sway: rng.range(0.05, 0.2) });
  }
  const geo = new BufferGeometry();
  geo.setAttribute("position", new BufferAttribute(pos, 3));
  const mat = keep(new PointsMaterial({
    map: glowTexture(), color: theme.accent, size: 0.07, sizeAttenuation: true,
    transparent: true, opacity: 0.55, depthWrite: false, blending: AdditiveBlending,
  }));
  embers = new Points(geo, mat);
  embers.frustumCulled = false;
  embers.noAO = true;
  fxGroup.add(embers);
}

function buildWheel(c: Content): void {
  const t = theme;
  const R = FRAMING.wheelRadius;
  const detailed = look!.detailed;
  const S = BUD.segments;
  // carved wooden face (procedural canvas texture, seeded)
  const px = detailed ? BUD.texture : Math.min(512, BUD.texture);
  const tex = woodTexture(`${c.seed}:wood`, px);
  if (BUD.material === "lambert") faceMaterial = keep(new MeshLambertMaterial({ map: tex }));
  else {
    const o = { map: tex, roughness: 0.72, metalness: 0.02, envMapIntensity: 0.18, bumpMap: detailed ? tex : null, bumpScale: 2.2 };
    faceMaterial = BUD.material === "standard"
      ? keep(new MeshStandardMaterial(o))
      : keep(new MeshPhysicalMaterial({ ...o, clearcoat: detailed ? 0.22 : 0, clearcoatRoughness: 0.4 }));
  }
  const face = new Mesh(new CircleGeometry(R, S), faceMaterial);
  face.receiveShadow = true;
  wheelGroup.add(face);

  // thickness / edge
  const edge = new Mesh(new CylinderGeometry(R, R, 0.18, S, 1, true), surfaceMat({ color: t.woodDark, roughness: 0.85, envMapIntensity: 0.3 }));
  edge.rotation.x = PI / 2;
  edge.position.z = -0.09;
  wheelGroup.add(edge);

  // metal rim + rivets (instanced)
  const rim = new Mesh(new TorusGeometry(R, 0.05, Math.max(8, S / 6), Math.round(S * 1.25)),
    metalMat({ color: t.rim, roughness: 0.34, metalness: 0.9, clearcoat: 0.2, clearcoatRoughness: 0.3, envMapIntensity: 0.45 }));
  rim.castShadow = true;
  wheelGroup.add(rim);
  const rivets = new InstancedMesh(new SphereGeometry(0.035, 12, 8), metalMat({ color: t.metal, roughness: 0.3, metalness: 0.95, envMapIntensity: 0.6 }), 12);
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * TAU;
    _m.makeTranslation(Math.cos(a) * R, Math.sin(a) * R, 0.06);
    rivets.setMatrixAt(i, _m);
  }
  rivets.instanceMatrix.needsUpdate = true;
  wheelGroup.add(rivets);

  // hub
  const hubMat = metalMat({ color: t.rim, roughness: 0.38, metalness: 0.8, clearcoat: 0.2, envMapIntensity: 0.45 });
  const hub = new Mesh(new CylinderGeometry(0.22, 0.24, 0.16, Math.max(16, S / 3)), hubMat);
  hub.rotation.x = PI / 2;
  const boss = new Mesh(new SphereGeometry(0.2, Math.max(16, S / 3), 12, 0, TAU, 0, PI / 2), hubMat);
  boss.rotation.x = PI / 2;
  boss.scale.set(1, 0.55, 1);
  boss.position.z = 0.08;
  hub.castShadow = boss.castShadow = true;
  wheelGroup.add(hub, boss);

  // preplaced slots: blades & protected markers (shape + color redundancy)
  for (const slot of c.preplaced ?? []) {
    if (slot.type === "marker") wheelGroup.add(makeMarkerMesh(localAngle(slot.deg)));
    else wheelGroup.add(makeBladeMesh(localAngle(slot.deg), false));
  }

  // stand holding the wheel
  const standMat = surfaceMat({ color: t.woodDark, roughness: 0.85, envMapIntensity: 0.3 });
  const leg = new Mesh(new BoxGeometry(0.24, 2.4, 0.3), standMat);
  leg.position.set(0, -2.15, -0.25);
  const base = new Mesh(new BoxGeometry(1.6, 0.18, 0.8), standMat);
  base.position.set(0, -2.2, -0.25);
  leg.castShadow = base.castShadow = true;
  leg.receiveShadow = base.receiveShadow = true;
  stageGroup.add(leg, base);

  // standby blade visible at the throw origin (the "next" blade)
  standbyBlade = makeBladeMesh(0, true);
  standbyBlade.position.copy(FRAMING.throwOrigin);
  stageGroup.add(standbyBlade);
}

function buildReticle(): void {
  // grounded target marker at the contact point — shape + color, not bloom
  reticle = new Mesh(new RingGeometry(0.09, 0.14, 24), keep(new MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, depthTest: false })));
  const r = FRAMING.bladeOrbitRadius;
  reticle.position.set(Math.cos(FRAMING.contactWorldAngle) * r, 0.1 + Math.sin(FRAMING.contactWorldAngle) * r, 0.35);
  reticle.noAO = true;
  reticle.renderOrder = 5;
  fxGroup.add(reticle);
  setReticleMode(reticleMode);
}

let envTex: Texture | null = null;
/** three.js's RoomEnvironment prefiltered once (the browser build's PMREM room). */
function buildEnvMap(): void {
  if (envTex) return;
  try { envTex = new PMREMGenerator().fromScene(new RoomEnvironment(), 0.04).texture; }
  catch (e) { console.warn("environment:", e instanceof Error ? e.message : String(e)); }
}

function rebuild(): void {
  if (!content || !look) return;
  clearAll();
  trimTextures([`wood:${theme.id}:${content.seed}`, `planks:${theme.id}:${content.seed}`, `curtain:${theme.id}`]);
  scene.background = new Color(theme.sky);
  scene.fog = new Fog(theme.fog, 8, 26);
  buildLights();
  buildEnvironment();
  buildWheel(content);
  buildReticle();
  particles = new ParticlePool(particleCap(look), `${content.seed}:fx`);
  buildEmbers();
  applyScene();
  if (lastState) syncState(lastState);
  fitKey = "";
}

/** Build (or rebuild) the stage for a content definition and its theme. */
export function loadContent(c: Content, opts: { swoop?: boolean } = {}): void {
  if (!built) setup();
  content = c;
  theme = themeById(c.theme);
  lastState = null;
  rebuild();
  swoop.active = opts.swoop !== false && !reducedMotion;
  swoop.t = swoop.active ? 0 : 1;
}

/** The look for the frame's graphics level; cheap when nothing changed. */
export function applyLook(next: Look): void {
  if (look && JSON.stringify(look) === JSON.stringify(next)) return;
  const prev = look;
  look = next;
  BUD = next.budget;
  if (!built) setup();
  // A different budget or detail swaps meshes, materials and textures: rebuild the stage.
  const structural = !prev || prev.detailed !== next.detailed || prev.particles !== next.particles ||
    (["material", "mergedBlades", "segments", "texture", "embers", "particles"] as const).some((k) => prev.budget[k] !== next.budget[k]);
  if (structural && content) {
    const rot = wheelGroup.rotation.z;
    rebuild();
    wheelGroup.rotation.z = rot;
  } else applyScene();
}

/** Push the look's tiers into lights, environment, the pools and the post effects. */
function applyScene(): void {
  const g = look!;
  const shadows = g.shadows > 0;
  renderer.shadowMap.enabled = shadows;
  renderer.shadowMap.type = PCFSoftShadowMap;
  if (keyLight) {
    keyLight.castShadow = shadows;
    if (shadows) keyLight.shadow.mapSize = g.shadows;
  }
  if (g.reflections) {
    buildEnvMap();
    scene.environment = envTex;
  } else scene.environment = null;
  // r160 scaled scene.environment by each material's envMapIntensity; the
  // engine (as three r163+) does that only for a material's own envMap, so
  // every standard material carries the room while reflections are on.
  const env = g.reflections ? envTex : null;
  scene.traverse((o) => {
    if (o instanceof Mesh || o instanceof InstancedMesh) {
      const m = o.material;
      if (m instanceof MeshStandardMaterial && m.envMap !== env) m.envMap = env;
    }
  });
  particles?.setCapacity(particleCap(g));
  if (embers) embers.visible = g.particles === "high" && g.budget.embers > 0;
  renderer.ao = g.ao === "off" ? null : {
    blendIntensity: 0.75, radius: 0.35, distanceExponent: 1.5, thickness: 0.6, scale: 1.0,
    samples: g.ao === "high" ? 16 : 8,
    denoise: { lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: g.ao === "high" ? 6 : 4, rings: 2, samples: g.ao === "high" ? 16 : 8, radiusExponent: 2 },
  };
  // High threshold: only sigils, sparks and bright steel highlights bloom.
  // The page's r160 UnrealBloomPass strength squared (minor 29 bloom follows r185).
  renderer.bloom = g.bloom ? { strength: 0.16, radius: 0.35, threshold: 0.9, resolution: g.budget.bloomRes } : null;
  renderer.grade = g.grade ? {
    space: "display", contrast: 0.11, saturation: 1.08,
    shadows: [0.97, 0.98, 1.04], highlights: [1.04, 1.0, 0.95], split: [0.2, 0.8],
    vignette: { amount: 0.26, inner: 0.32, outer: 0.9, scale: [1.15, 1] },
  } : null;
  renderer.antialias = g.antialias;
}

// ---------------------------------------------------------------- state sync
let reticleMode = "hidden";
export function setReticleMode(mode: string): void {
  reticleMode = mode;
  if (!reticle) return;
  const colors: Record<string, number> = { good: 0x51ff9a, bad: 0xff5151, idle: 0xffffff, hidden: 0xffffff };
  (reticle.material as MeshBasicMaterial).color.setHex(colors[mode] ?? 0xffffff);
  reticleBase = mode === "hidden" ? 0 : mode === "idle" ? 0.35 : 0.8;
}

/** Diff-sync embedded blade views from a rules snapshot (an undo removes the last ones). */
export function syncState(state: ViewState): void {
  lastState = state;
  if (!built || !content) return;
  const embedded = state.slots.filter((s) => s.embedded);
  while (embeddedViews.length > embedded.length) {
    const v = embeddedViews.pop()!;
    wheelGroup.remove(v);
    disposeGroup(v);
  }
  for (let i = embeddedViews.length; i < embedded.length; i++) {
    const deg = (embedded[i]!.angle * 180) / PI;
    const mesh = makeBladeMesh(localAngle(deg), false);
    wheelGroup.add(mesh);
    embeddedViews.push(mesh);
  }
}

function contactPoint(): Vector3 {
  const r = FRAMING.bladeOrbitRadius;
  return new Vector3(Math.cos(FRAMING.contactWorldAngle) * r, 0.1 + Math.sin(FRAMING.contactWorldAngle) * r, 0.25);
}
function addShake(amp: number): void {
  if (reducedMotion) return;
  shake.amp = Math.min(0.06, shake.amp + amp);
  shake.t = 0;
}
function spawnFlyingBlade(willEmbed: boolean): void {
  const blade = makeBladeMesh(0, true);
  blade.position.copy(FRAMING.throwOrigin);
  fxGroup.add(blade);
  if (standbyBlade) standbyBlade.visible = false;
  standbyHiddenUntil = time + 0.35;
  flyingBlades.push({ mesh: blade, t: 0, duration: reducedMotion ? 0.02 : 0.12, willEmbed, deflect: null });
}

/** Trigger VFX for logical events; tiered event hierarchy. */
export function pushEvents(events: readonly RulesEvent[]): void {
  if (!built || !content) return;
  for (const ev of events) {
    switch (ev.type) {
      case "embed":
        spawnFlyingBlade(true);
        particles?.burst(contactPoint(), { count: 14, color: theme.ring, speed: 1.2, life: 0.5, tag: "wood" });
        addShake(0.012); // lowest tier
        break;
      case "miss":
        spawnFlyingBlade(false);
        particles?.burst(contactPoint(), {
          count: ev.blockedBy === "hit-marker" ? 30 : 22,
          color: ev.blockedBy === "hit-marker" ? theme.marker : theme.accent,
          speed: 2.2, life: 0.7, tag: "spark",
        });
        addShake(0.03);
        break;
      case "win":
        // highest tier: dense celebratory burst + strong accent
        for (let i = 0; i < 5; i++) {
          const a = (i / 5) * TAU;
          particles?.burst(new Vector3(Math.cos(a) * 1.1, 0.1 + Math.sin(a) * 1.1, 0.3), { count: 26, color: theme.accent, speed: 1.8, life: 1.1, tag: "spark" });
        }
        addShake(0.02);
        break;
      case "lose":
        addShake(0.045);
        break;
    }
  }
}

export function interruptSwoop(): void { swoop.t = 1; }
export function setReducedMotion(on: boolean): void {
  reducedMotion = on;
  if (on) { shake.amp = 0; swoop.t = 1; }
}

/** The playfield (the browser build's canvas: the window less the top bar
 * and the rails) in the window W × H, logical pixels, and the HUD bands over
 * it as fractions of it (top stats, bottom controls, side columns). The
 * scene still fills the window: the camera's view offset puts the
 * playfield's frustum where the canvas was. */
export function setPlayfield(rect: { x: number; y: number; w: number; h: number; W: number; H: number }, b: { top: number; bottom: number; left: number; right: number }): void {
  pf.x = rect.x; pf.y = rect.y; pf.w = Math.max(2, rect.w); pf.h = Math.max(2, rect.h); pf.W = Math.max(2, rect.W); pf.H = Math.max(2, rect.H);
  bands.top = b.top; bands.bottom = b.bottom; bands.left = b.left; bands.right = b.right;
}
const pf = { x: 0, y: 0, w: 16, h: 9, W: 16, H: 9 };

/** Pull the camera back so the wheel (plus a margin) fits both axes inside the
 *  HUD-free band; wide viewports keep the authored distance. */
function fitFraming(): void {
  const key = [pf.x, pf.y, pf.w, pf.h, pf.W, pf.H, bands.top, bands.bottom, bands.left, bands.right].map((v) => v.toFixed(3)).join(":");
  if (key === fitKey) return;
  fitKey = key;
  const w = pf.w, h = pf.h;
  camera.aspect = w / h;
  camera.setViewOffset(w, h, -pf.x, -pf.y, pf.W, pf.H);
  camera.updateProjectionMatrix();
  const R = FRAMING.wheelRadius * 1.3;
  const halfFov = (FRAMING.fov / 2) * (PI / 180);
  const hudTop = bands.top || Math.min(0.2, 60 / h);
  const hudBottom = bands.bottom || (bands.right ? 0 : Math.min(0.3, 110 / h));
  const vFree = Math.max(0.35, 1 - hudTop - hudBottom - 0.04);
  const hFree = Math.max(0.4, 1 - bands.left - bands.right - 0.04);
  const vDist = R / (Math.tan(halfFov) * vFree);
  const hDist = R / (Math.tan(halfFov) * (w / h) * hFree);
  const authored = FRAMING.cameraPos.distanceTo(FRAMING.cameraLook);
  const dist = Math.max(authored, vDist, hDist);
  // Look point shifts so the wheel sits centred in the HUD-free band.
  framing = {
    dist,
    lookY: FRAMING.cameraLook.y - (hudBottom - hudTop) * dist * Math.tan(halfFov),
    lookX: (bands.right - bands.left) * dist * Math.tan(halfFov) * (w / h),
  };
}

// ---------------------------------------------------------------- per frame
/** Draws the frame: state is the rules snapshot (or the attract spin), alpha
 *  the interpolation toward tick + 1, dt real seconds. */
export function update(dtRaw: number, state: ViewState, alpha: number): void {
  if (!built || !content || !look) return;
  const dt = Math.min(dtRaw, 0.1);
  time += dt;
  fitFraming();

  // rotation is a pure function of sim tick + interpolation alpha
  wheelGroup.rotation.z = rotationAt(state.rotation, state.tick + alpha);

  // ambient motion: embers drift and the accent light shimmers like a lamp flame
  if (embers && embers.visible && !reducedMotion) {
    const attr = embers.geometry.getAttribute("position")!;
    const a = attr.array as Float32Array;
    for (let i = 0; i < emberSeeds.length; i++) {
      const e = emberSeeds[i]!;
      a[i * 3 + 1]! += e.speed * dt;
      a[i * 3]! += Math.sin(time * 0.6 + e.phase) * e.sway * dt;
      if (a[i * 3 + 1]! > 3.6) a[i * 3 + 1] = -2.2;
    }
    attr.needsUpdate = true;
  }
  if (accentLight) {
    const flicker = reducedMotion ? 0 : 0.06 * Math.sin(time * 7.3) + 0.04 * Math.sin(time * 12.9 + 1.7);
    accentLight.intensity = 6 * (1 + flicker);
  }
  if (standbyBlade && !standbyBlade.visible && time >= standbyHiddenUntil) standbyBlade.visible = true;

  // flying blades
  const target = contactPoint();
  for (const fb of flyingBlades) {
    fb.t += dt;
    const k = Math.min(1, fb.t / fb.duration);
    if (!fb.deflect) {
      fb.mesh.position.copy(FRAMING.throwOrigin).lerp(target, k * k);
      if (k >= 1) {
        if (fb.willEmbed) fb.done = true; // permanent view appears via syncState
        else { fb.deflect = { vx: (Math.random() - 0.5) * 2, vy: 2.5, vz: 2.5, spin: 8 }; fb.duration = 0.8; fb.t = 0; }
      }
    } else {
      fb.mesh.position.x += fb.deflect.vx * dt;
      fb.mesh.position.y += fb.deflect.vy * dt;
      fb.mesh.position.z += fb.deflect.vz * dt;
      fb.deflect.vy -= 9 * dt;
      fb.mesh.rotation.z += fb.deflect.spin * dt;
      if (fb.t >= fb.duration) fb.done = true;
    }
  }
  for (const fb of flyingBlades) if (fb.done) { fxGroup.remove(fb.mesh); disposeGroup(fb.mesh); }
  flyingBlades = flyingBlades.filter((f) => !f.done);

  particles?.update(dt);

  // reticle pulse (event-tier: minimal)
  if (reticle) {
    const pulse = reducedMotion ? 1 : 0.85 + 0.15 * Math.sin(time * 5);
    (reticle.material as MeshBasicMaterial).opacity = reticleBase * pulse;
    reticle.visible = reticleBase > 0;
  }

  // camera: intro swoop (interruptible ease, not cumulative lerp) + decaying shake
  const dir = FRAMING.cameraPos.clone().sub(FRAMING.cameraLook).normalize();
  const lookAt = new Vector3(framing.lookX, framing.lookY, FRAMING.cameraLook.z);
  const camPos = lookAt.clone().addScaledVector(dir, framing.dist);
  if (swoop.active && swoop.t < 1) {
    swoop.t = Math.min(1, swoop.t + dt / FRAMING.introSwoopSeconds);
    const e = 1 - Math.pow(1 - swoop.t, 3);
    camPos.z += (1 - e) * 3.2;
    camPos.y += (1 - e) * 1.1;
  }
  if (shake.amp > 0.0005) {
    shake.t += dt;
    const decay = Math.exp(-shake.t * 9);
    camPos.x += Math.sin(shake.t * 61) * shake.amp * decay;
    camPos.y += Math.cos(shake.t * 53) * shake.amp * decay;
  } else shake.amp = 0;
  camera.position.copy(camPos);
  camera.lookAt(lookAt);
}
