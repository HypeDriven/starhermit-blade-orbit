/**
 * Blade Orbit — render module.
 * Three.js scene: theatrical carved-wood target stage, procedural geometry and
 * materials, seeded VFX pools, authored camera, quality tiers, reduced motion.
 *
 * Rendering consumes immutable rules snapshots + interpolation alpha; it never
 * mutates simulation state. The wheel's rotation derives from
 * rotationAt(profile, tick + alpha), so visuals are a pure function of sim state.
 */

import * as THREE from '../vendor/three.module.js';
import { rotationAt, makeRng, TAU, SLOT_HALF } from './rules.js';
import { themeById } from './content.js';

// Authored framing constants (no magic offsets scattered through code)
const FRAMING = {
  cameraPos: new THREE.Vector3(0, 0.55, 6.4),
  cameraLook: new THREE.Vector3(0, 0.1, 0),
  fov: 34,
  wheelRadius: 1.5,
  bladeOrbitRadius: 1.08,
  throwOrigin: new THREE.Vector3(0, -2.6, 2.2),
  contactWorldAngle: -Math.PI / 2, // 6 o'clock
  introSwoopSeconds: 1.1,
};

const QUALITY_TIERS = {
  low: { dpr: 1, shadows: false, particles: 80, envDetail: 0.4, shake: 0.5 },
  medium: { dpr: 1.5, shadows: true, particles: 160, envDetail: 0.7, shake: 0.8 },
  high: { dpr: 2, shadows: true, particles: 260, envDetail: 1, shake: 1 },
};

export function pickAutoTier() {
  const mobile = /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent || '');
  const mem = navigator.deviceMemory || 4;
  if (mobile || mem <= 3) return 'low';
  if (mem <= 6) return 'medium';
  return 'high';
}

export function createRenderer(canvas, opts = {}) {
  return new BladeRenderer(canvas, opts);
}

class BladeRenderer {
  constructor(canvas, { onContextLost = () => {}, onFps = () => {} } = {}) {
    this.canvas = canvas;
    this.onContextLost = onContextLost;
    this.onFps = onFps;
    this.quality = QUALITY_TIERS.medium;
    this.reducedMotion = false;
    this.disposed = false;

    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(FRAMING.fov, 1, 0.1, 60);
    this.camera.position.copy(FRAMING.cameraPos);
    this.camera.lookAt(FRAMING.cameraLook);

    this.layers = { env: 0, gameplay: 1, ghost: 2, fx: 3 }; // explicit layer ownership

    // scene graph roots
    this.envGroup = new THREE.Group();
    this.wheelGroup = new THREE.Group(); // rotates with sim rotation
    this.stageGroup = new THREE.Group(); // static gameplay dressing
    this.fxGroup = new THREE.Group();
    this.scene.add(this.envGroup, this.stageGroup, this.wheelGroup, this.fxGroup);
    this.wheelGroup.position.set(0, 0.1, 0);

    this.embeddedViews = new Map(); // slot key -> mesh
    this.flyingBlades = [];
    this.particles = null;
    this.shake = { amp: 0, t: 0 };
    this.swoop = { active: false, t: 1 };
    this.reticle = null;
    this.reticleMode = 'hidden';
    this.time = 0;
    this.fpsAccum = { frames: 0, ms: 0 };

    canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); this.onContextLost(); });
  }

  // --- content & theme ------------------------------------------------------

  /** Build (or rebuild) the stage for a content definition + theme. */
  loadContent(content, themeId) {
    this.content = content;
    this.theme = themeById(themeId || content.theme);
    this.clearGroup(this.envGroup);
    this.clearGroup(this.stageGroup);
    this.clearGroup(this.wheelGroup);
    this.clearGroup(this.fxGroup);
    this.embeddedViews.clear();
    this.flyingBlades = [];
    this.particles = null;

    const t = this.theme;
    this.scene.background = new THREE.Color(t.sky);
    this.scene.fog = new THREE.Fog(new THREE.Color(t.fog), 8, 26);

    this.buildLights();
    this.buildEnvironment();
    this.buildWheel(content);
    this.buildReticle();
    this.particles = new ParticlePool(this.fxGroup, this.quality.particles, `${content.seed}:fx`);
    this.swoop = { active: !this.reducedMotion, t: 0 };
    this.resize();
  }

  buildLights() {
    const t = this.theme;
    const key = new THREE.DirectionalLight(new THREE.Color(t.key), 2.4);
    key.position.set(2.5, 4, 4);
    key.castShadow = this.quality.shadows;
    key.shadow.mapSize.set(1024, 1024);
    key.shadow.camera.left = -4; key.shadow.camera.right = 4;
    key.shadow.camera.top = 4; key.shadow.camera.bottom = -4;
    const fill = new THREE.HemisphereLight(new THREE.Color(t.fill), new THREE.Color(t.floor), 0.9);
    const accent = new THREE.PointLight(new THREE.Color(t.accent), 6, 12, 1.6);
    accent.position.set(0, 0.3, 2.5);
    this.envGroup.add(key, fill, accent);
    this.keyLight = key;
  }

  buildEnvironment() {
    const t = this.theme;
    // floor
    const floor = new THREE.Mesh(
      new THREE.CircleGeometry(14, 40),
      new THREE.MeshStandardMaterial({ color: new THREE.Color(t.floor), roughness: 0.95 })
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -2.2;
    floor.receiveShadow = this.quality.shadows;
    this.envGroup.add(floor);

    // backdrop curtain: vertical gradient canvas
    const bgCanvas = document.createElement('canvas');
    bgCanvas.width = 4; bgCanvas.height = 256;
    const g = bgCanvas.getContext('2d');
    const grad = g.createLinearGradient(0, 0, 0, 256);
    grad.addColorStop(0, t.sky);
    grad.addColorStop(0.7, t.fog);
    grad.addColorStop(1, t.floor);
    g.fillStyle = grad; g.fillRect(0, 0, 4, 256);
    const bgTex = new THREE.CanvasTexture(bgCanvas);
    bgTex.colorSpace = THREE.SRGBColorSpace;
    const backdrop = new THREE.Mesh(
      new THREE.PlaneGeometry(40, 20),
      new THREE.MeshBasicMaterial({ map: bgTex, fog: false })
    );
    backdrop.position.set(0, 3, -10);
    this.envGroup.add(backdrop);

    // stage props: carved posts flanking the wheel; density follows envDetail
    const detail = this.quality.envDetail;
    const postMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(t.woodDark), roughness: 0.9 });
    const postGeo = new THREE.CylinderGeometry(0.16, 0.22, 4.4, 10);
    const capGeo = new THREE.SphereGeometry(0.24, 10, 8);
    for (const sx of [-2.6, 2.6]) {
      const post = new THREE.Mesh(postGeo, postMat);
      post.position.set(sx, 0, -0.6);
      post.castShadow = this.quality.shadows;
      const cap = new THREE.Mesh(capGeo, new THREE.MeshStandardMaterial({ color: new THREE.Color(t.rim), roughness: 0.5, metalness: 0.6 }));
      cap.position.set(sx, 2.3, -0.6);
      this.envGroup.add(post, cap);
    }
    if (detail > 0.5) {
      // scattered planks & crates for environmental storytelling
      const rng = makeRng(`${this.content.seed}:decor`);
      const crateGeo = new THREE.BoxGeometry(0.5, 0.5, 0.5);
      const crateMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(t.wood), roughness: 0.85 });
      const crates = new THREE.InstancedMesh(crateGeo, crateMat, 6);
      const m = new THREE.Matrix4();
      for (let i = 0; i < 6; i++) {
        const x = rng.range(-5, 5);
        if (Math.abs(x) < 2.2) { m.makeScale(0, 0, 0); crates.setMatrixAt(i, m); continue; }
        m.makeRotationY(rng.range(0, TAU));
        m.setPosition(x, -1.95, rng.range(-2.5, 0.5));
        crates.setMatrixAt(i, m);
      }
      crates.instanceMatrix.needsUpdate = true;
      this.envGroup.add(crates);
    }
  }

  buildWheel(content) {
    const t = this.theme;
    const R = FRAMING.wheelRadius;

    // carved wooden face (procedural canvas texture, seeded)
    const faceTex = makeWoodTexture(this.theme, `${content.seed}:wood`, 512);
    const face = new THREE.Mesh(
      new THREE.CircleGeometry(R, 72),
      new THREE.MeshStandardMaterial({ map: faceTex, roughness: 0.8, metalness: 0.02 })
    );
    face.receiveShadow = this.quality.shadows;
    this.wheelGroup.add(face);

    // thickness / edge
    const edge = new THREE.Mesh(
      new THREE.CylinderGeometry(R, R, 0.18, 72, 1, true),
      new THREE.MeshStandardMaterial({ color: new THREE.Color(t.woodDark), roughness: 0.9 })
    );
    edge.rotation.x = Math.PI / 2;
    edge.position.z = -0.09;
    this.wheelGroup.add(edge);

    // metal rim + rivets (instanced)
    const rim = new THREE.Mesh(
      new THREE.TorusGeometry(R, 0.05, 12, 72),
      new THREE.MeshStandardMaterial({ color: new THREE.Color(t.rim), roughness: 0.35, metalness: 0.8 })
    );
    this.wheelGroup.add(rim);
    const rivetGeo = new THREE.SphereGeometry(0.035, 8, 6);
    const rivetMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(t.metal), roughness: 0.3, metalness: 0.9 });
    const rivets = new THREE.InstancedMesh(rivetGeo, rivetMat, 12);
    const rm = new THREE.Matrix4();
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * TAU;
      rm.setPosition(Math.cos(a) * R, Math.sin(a) * R, 0.06);
      rivets.setMatrixAt(i, rm);
    }
    rivets.instanceMatrix.needsUpdate = true;
    this.wheelGroup.add(rivets);

    // hub
    const hub = new THREE.Mesh(
      new THREE.CylinderGeometry(0.22, 0.22, 0.22, 24),
      new THREE.MeshStandardMaterial({ color: new THREE.Color(t.rim), roughness: 0.4, metalness: 0.7 })
    );
    hub.rotation.x = Math.PI / 2;
    this.wheelGroup.add(hub);

    // preplaced slots: blades & protected markers (shape + color redundancy)
    for (const slot of content.preplaced || []) {
      if (slot.type === 'marker') this.wheelGroup.add(makeMarkerMesh(this.theme, localAngle(slot.deg)));
      else this.wheelGroup.add(makeBladeMesh(this.theme, localAngle(slot.deg), false));
    }

    // stand holding the wheel
    const standMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(t.woodDark), roughness: 0.9 });
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.24, 2.4, 0.3), standMat);
    leg.position.set(0, -2.15, -0.25);
    const base = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.18, 0.8), standMat);
    base.position.set(0, -2.2, -0.25);
    leg.castShadow = base.castShadow = this.quality.shadows;
    this.stageGroup.add(leg, base);

    // standby blade visible at the throw origin (the "next" blade)
    this.standbyBlade = makeBladeMesh(this.theme, 0, true);
    this.standbyBlade.position.copy(FRAMING.throwOrigin);
    this.standbyBlade.rotation.set(0, 0, 0);
    this.stageGroup.add(this.standbyBlade);
  }

  buildReticle() {
    // grounded target marker at the contact point — shape + color, not bloom
    const geo = new THREE.RingGeometry(0.09, 0.14, 24);
    const mat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.0, depthTest: false });
    this.reticle = new THREE.Mesh(geo, mat);
    const r = FRAMING.bladeOrbitRadius;
    this.reticle.position.set(Math.cos(FRAMING.contactWorldAngle) * r, 0.1 + Math.sin(FRAMING.contactWorldAngle) * r, 0.35);
    this.fxGroup.add(this.reticle);
  }

  setReticleMode(mode) {
    this.reticleMode = mode;
    if (!this.reticle) return;
    const colors = { good: 0x51ff9a, bad: 0xff5151, idle: 0xffffff, hidden: 0xffffff };
    this.reticle.material.color.setHex(colors[mode] ?? 0xffffff);
    this.reticle.userData.baseOpacity = mode === 'hidden' ? 0 : mode === 'idle' ? 0.35 : 0.8;
  }

  // --- state sync -----------------------------------------------------------

  /** Diff-sync embedded blade views from a rules snapshot. */
  syncState(state) {
    let i = 0;
    for (const slot of state.slots) {
      if (!slot.embedded) continue;
      const key = `e${i++}`;
      if (!this.embeddedViews.has(key)) {
        const deg = (slot.angle * 180) / Math.PI;
        const mesh = makeBladeMesh(this.theme, localAngle(deg), false);
        this.wheelGroup.add(mesh);
        this.embeddedViews.set(key, mesh);
      }
    }
  }

  /** Trigger VFX for logical events; tiered event hierarchy. */
  pushEvents(events) {
    if (!events) return;
    for (const ev of events) {
      switch (ev.type) {
        case 'embed': {
          this.spawnFlyingBlade(ev.angle, true);
          const p = this.contactPoint();
          this.particles?.burst(p, { count: 14, color: this.theme.ring, speed: 1.2, life: 0.5, tag: 'wood' });
          this.addShake(0.012); // lowest tier
          break;
        }
        case 'miss': {
          this.spawnFlyingBlade(ev.angle, false);
          const p = this.contactPoint();
          this.particles?.burst(p, {
            count: ev.blockedBy === 'hit-marker' ? 30 : 22,
            color: ev.blockedBy === 'hit-marker' ? this.theme.marker : this.theme.accent,
            speed: 2.2, life: 0.7, tag: 'spark',
          });
          this.addShake(0.03);
          break;
        }
        case 'win': {
          // highest tier: dense celebratory burst + strong accent
          for (let i = 0; i < 5; i++) {
            const a = (i / 5) * TAU;
            this.particles?.burst(
              new THREE.Vector3(Math.cos(a) * 1.1, 0.1 + Math.sin(a) * 1.1, 0.3),
              { count: 26, color: this.theme.accent, speed: 1.8, life: 1.1, tag: 'spark' }
            );
          }
          this.addShake(0.02);
          break;
        }
        case 'lose':
          this.addShake(0.045);
          break;
        default:
          break;
      }
    }
  }

  contactPoint() {
    const r = FRAMING.bladeOrbitRadius;
    return new THREE.Vector3(
      Math.cos(FRAMING.contactWorldAngle) * r,
      0.1 + Math.sin(FRAMING.contactWorldAngle) * r,
      0.25
    );
  }

  spawnFlyingBlade(contactAngleRad, willEmbed) {
    const blade = makeBladeMesh(this.theme, 0, true);
    blade.position.copy(FRAMING.throwOrigin);
    this.fxGroup.add(blade);
    if (this.standbyBlade) this.standbyBlade.visible = false;
    this.flyingBlades.push({
      mesh: blade, t: 0, duration: this.reducedMotion ? 0.02 : 0.12,
      willEmbed, contactAngleRad, deflect: null,
    });
    setTimeout(() => { if (this.standbyBlade && !this.disposed) this.standbyBlade.visible = true; }, 350);
  }

  addShake(amp) {
    if (this.reducedMotion) return;
    this.shake.amp = Math.min(0.06, this.shake.amp + amp * this.quality.shake);
    this.shake.t = 0;
  }

  // --- per-frame ------------------------------------------------------------

  /**
   * state: current rules snapshot; alpha: interpolation toward tick+1.
   * dtMs: real elapsed milliseconds (clamped by caller).
   */
  update(dtMs, state, alpha) {
    if (this.disposed || !this.content) return;
    const dt = Math.min(dtMs, 100) / 1000;
    this.time += dt;

    // rotation is a pure function of sim tick + interpolation alpha
    const renderTick = state.tick + alpha;
    this.wheelGroup.rotation.z = rotationAt(state.rotation, renderTick);

    // gentle decorative breathing on the hub light — paused when hidden by caller
    // flying blades
    for (const fb of this.flyingBlades) {
      fb.t += dt;
      const k = Math.min(1, fb.t / fb.duration);
      if (!fb.deflect) {
        const target = this.contactPoint();
        fb.mesh.position.lerpVectors(FRAMING.throwOrigin, target, k * k);
        if (k >= 1) {
          if (fb.willEmbed) {
            fb.done = true; // permanent view appears via syncState
          } else {
            fb.deflect = { vx: (Math.random() - 0.5) * 2, vy: 2.5, vz: 2.5, spin: 8 };
            fb.duration = 0.8; fb.t = 0;
          }
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
    for (const fb of this.flyingBlades) {
      if (fb.done) { this.fxGroup.remove(fb.mesh); disposeObject(fb.mesh); }
    }
    this.flyingBlades = this.flyingBlades.filter((f) => !f.done);

    this.particles?.update(dt, this.reducedMotion);

    // reticle pulse (event-tier: minimal)
    if (this.reticle && this.reticle.userData.baseOpacity > 0) {
      const pulse = this.reducedMotion ? 1 : 0.85 + 0.15 * Math.sin(this.time * 5);
      this.reticle.material.opacity = this.reticle.userData.baseOpacity * pulse;
    }

    // camera: intro swoop (interruptible ease, not cumulative lerp) + decaying shake
    const camPos = FRAMING.cameraPos.clone();
    if (this.swoop.active && this.swoop.t < 1) {
      this.swoop.t = Math.min(1, this.swoop.t + dt / FRAMING.introSwoopSeconds);
      const e = 1 - Math.pow(1 - this.swoop.t, 3);
      camPos.z += (1 - e) * 3.2;
      camPos.y += (1 - e) * 1.1;
    }
    if (this.shake.amp > 0.0005) {
      this.shake.t += dt;
      const decay = Math.exp(-this.shake.t * 9);
      camPos.x += Math.sin(this.shake.t * 61) * this.shake.amp * decay;
      camPos.y += Math.cos(this.shake.t * 53) * this.shake.amp * decay;
    } else this.shake.amp = 0;
    this.camera.position.copy(camPos);
    this.camera.lookAt(FRAMING.cameraLook);

    this.renderer.render(this.scene, this.camera);

    // fps probe
    this.fpsAccum.frames++;
    this.fpsAccum.ms += dtMs;
    if (this.fpsAccum.ms >= 2000) {
      this.onFps((this.fpsAccum.frames * 1000) / this.fpsAccum.ms);
      this.fpsAccum.frames = 0; this.fpsAccum.ms = 0;
    }
  }

  interruptSwoop() { this.swoop.t = 1; }

  // --- quality / accessibility / lifecycle -----------------------------------

  setQuality(tierName) {
    const tier = QUALITY_TIERS[tierName] || QUALITY_TIERS.medium;
    this.quality = tier;
    if (this.keyLight) this.keyLight.castShadow = tier.shadows;
    this.renderer.shadowMap.enabled = tier.shadows;
    this.particles?.setCapacity(tier.particles);
    this.resize();
  }

  setReducedMotion(on) {
    this.reducedMotion = on;
    if (on) { this.shake.amp = 0; this.swoop.t = 1; }
  }

  resize() {
    const w = Math.max(2, this.canvas.clientWidth || this.canvas.parentElement?.clientWidth || 2);
    const h = Math.max(2, this.canvas.clientHeight || this.canvas.parentElement?.clientHeight || 2);
    const dpr = Math.min(window.devicePixelRatio || 1, this.quality.dpr);
    this.renderer.setPixelRatio(dpr);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  /** Project a world position to CSS pixels (shared layout model for DOM labels). */
  worldToScreen(v) {
    const p = v.clone().project(this.camera);
    const rect = this.canvas.getBoundingClientRect();
    return { x: ((p.x + 1) / 2) * rect.width, y: ((1 - p.y) / 2) * rect.height, visible: p.z < 1 };
  }

  clearGroup(group) {
    while (group.children.length) {
      const child = group.children.pop();
      disposeObject(child);
    }
  }

  dispose() {
    this.disposed = true;
    this.clearGroup(this.envGroup);
    this.clearGroup(this.stageGroup);
    this.clearGroup(this.wheelGroup);
    this.clearGroup(this.fxGroup);
    this.renderer.dispose();
  }
}

// ---------------------------------------------------------------------------
// Procedural meshes & textures
// ---------------------------------------------------------------------------

/** local angle on the wheel face, so world angle = contact point at 6 o'clock. */
function localAngle(deg) {
  return ((deg * Math.PI) / 180) + FRAMING.contactWorldAngle;
}

let bladeGeos = null;
function getBladeGeos() {
  if (bladeGeos) return bladeGeos;
  // tapered blade: flattened, stretched diamond-ish box
  const blade = new THREE.BoxGeometry(0.055, 0.34, 0.016);
  blade.translate(0, 0.17, 0);
  const handle = new THREE.CylinderGeometry(0.028, 0.034, 0.2, 8);
  handle.translate(0, -0.1, 0);
  const guard = new THREE.BoxGeometry(0.11, 0.03, 0.04);
  bladeGeos = { blade, handle, guard };
  return bladeGeos;
}

/**
 * A blade mesh. If `flight` it points along +Y for the throw arc;
 * otherwise it is placed on the wheel face at `angle` (local), tip inward.
 */
function makeBladeMesh(theme, angle, flight) {
  const g = getBladeGeos();
  const group = new THREE.Group();
  const bladeMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(theme.metal), roughness: 0.25, metalness: 0.9 });
  const handleMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(theme.handle), roughness: 0.75 });
  const guardMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(theme.rim), roughness: 0.4, metalness: 0.7 });
  const blade = new THREE.Mesh(g.blade, bladeMat);
  const handle = new THREE.Mesh(g.handle, handleMat);
  const guard = new THREE.Mesh(g.guard, guardMat);
  group.add(blade, handle, guard);
  if (!flight) {
    // on the wheel: blade sticks out of the face toward the camera, handle outward
    const r = FRAMING.bladeOrbitRadius;
    group.position.set(Math.cos(angle) * r, Math.sin(angle) * r, 0.12);
    group.rotation.z = angle - Math.PI / 2; // tip points toward hub
    group.rotation.x = -0.12; // slight tilt for silhouette readability
  }
  return group;
}

/** Protected marker: glowing sigil disc with a distinct shape (not color alone). */
function makeMarkerMesh(theme, angle) {
  const group = new THREE.Group();
  const disc = new THREE.Mesh(
    new THREE.CircleGeometry(0.14, 6), // hexagon — shape coding distinct from blades
    new THREE.MeshStandardMaterial({
      color: new THREE.Color(theme.marker), roughness: 0.4, metalness: 0.2,
      emissive: new THREE.Color(theme.marker), emissiveIntensity: 0.55,
    })
  );
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(0.16, 0.19, 24),
    new THREE.MeshBasicMaterial({ color: new THREE.Color(theme.marker), transparent: true, opacity: 0.7 })
  );
  group.add(disc, ring);
  const r = FRAMING.bladeOrbitRadius;
  group.position.set(Math.cos(angle) * r, Math.sin(angle) * r, 0.02);
  return group;
}

/** Seeded carved-wood face texture: growth rings, grain streaks, carve notches. */
function makeWoodTexture(theme, seed, size = 512) {
  const rng = makeRng(seed);
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  const cx = size / 2, cy = size / 2;
  g.fillStyle = theme.wood;
  g.fillRect(0, 0, size, size);

  // concentric growth rings
  for (let r = 12; r < size / 2; r += 8 + rng.next() * 14) {
    g.beginPath();
    g.arc(cx, cy, r + rng.range(-2, 2), 0, TAU);
    g.strokeStyle = rgba(theme.woodDark, 0.25 + rng.next() * 0.3);
    g.lineWidth = 1 + rng.next() * 3;
    g.stroke();
  }
  // radial grain streaks
  for (let i = 0; i < 90; i++) {
    const a = rng.range(0, TAU);
    const r0 = rng.range(10, size * 0.2);
    const r1 = r0 + rng.range(30, size * 0.28);
    g.beginPath();
    g.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0);
    g.lineTo(cx + Math.cos(a + rng.range(-0.05, 0.05)) * r1, cy + Math.sin(a) * r1);
    g.strokeStyle = rgba(rng.next() < 0.5 ? theme.woodDark : theme.ring, 0.10 + rng.next() * 0.12);
    g.lineWidth = 1 + rng.next() * 2;
    g.stroke();
  }
  // carved notch accents near rim
  for (let i = 0; i < 18; i++) {
    const a = (i / 18) * TAU + rng.range(-0.05, 0.05);
    const r = size * 0.44;
    g.beginPath();
    g.arc(cx + Math.cos(a) * r, cy + Math.sin(a) * r, 3 + rng.next() * 3, 0, TAU);
    g.fillStyle = rgba(theme.woodDark, 0.5);
    g.fill();
  }
  // subtle vignette toward center
  const grad = g.createRadialGradient(cx, cy, size * 0.05, cx, cy, size * 0.5);
  grad.addColorStop(0, rgba('#000000', 0.18));
  grad.addColorStop(0.5, rgba('#000000', 0));
  grad.addColorStop(1, rgba('#000000', 0.22));
  g.fillStyle = grad;
  g.fillRect(0, 0, size, size);

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

function rgba(hex, a) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

// ---------------------------------------------------------------------------
// Particle pool — bounded, pooled, cosmetic; never raycastable
// ---------------------------------------------------------------------------

class ParticlePool {
  constructor(parent, capacity, seed) {
    this.parent = parent;
    this.capacity = capacity;
    this.rng = makeRng(seed);
    this.slots = [];
    const geo = new THREE.PlaneGeometry(0.035, 0.035);
    for (let i = 0; i < capacity; i++) {
      const mat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, depthWrite: false });
      const m = new THREE.Mesh(geo, mat);
      m.visible = false;
      m.raycast = () => {}; // cosmetics never intercept picking
      parent.add(m);
      this.slots.push({ mesh: m, alive: false, vx: 0, vy: 0, vz: 0, life: 0, age: 0 });
    }
    this.cursor = 0;
  }

  setCapacity(n) { this.capacity = Math.min(n, this.slots.length); }

  burst(pos, { count, color, speed, life, tag }) {
    const col = new THREE.Color(color);
    const n = Math.min(count, this.capacity);
    for (let i = 0; i < n; i++) {
      const s = this.slots[this.cursor];
      this.cursor = (this.cursor + 1) % this.capacity;
      s.alive = true;
      s.age = 0;
      s.life = life * (0.6 + this.rng.next() * 0.8);
      const a = this.rng.range(0, TAU);
      const up = tag === 'spark' ? 1.4 : 0.8;
      s.vx = Math.cos(a) * speed * (0.3 + this.rng.next());
      s.vy = Math.sin(a) * speed * 0.6 + up;
      s.vz = 0.5 + this.rng.next() * 1.2;
      s.mesh.visible = true;
      s.mesh.position.copy(pos);
      s.mesh.material.color.copy(col);
      s.mesh.material.opacity = 1;
      const sc = tag === 'spark' ? 0.8 : 1.4;
      s.mesh.scale.setScalar(sc * (0.6 + this.rng.next() * 0.8));
    }
  }

  update(dt, reducedMotion) {
    const speedScale = reducedMotion ? 0.4 : 1; // reduced motion: fewer, slower particles
    for (const s of this.slots) {
      if (!s.alive) continue;
      s.age += dt;
      if (s.age >= s.life) { s.alive = false; s.mesh.visible = false; continue; }
      s.vy -= 5.5 * dt * speedScale;
      s.mesh.position.x += s.vx * dt * speedScale;
      s.mesh.position.y += s.vy * dt * speedScale;
      s.mesh.position.z += s.vz * dt * speedScale;
      s.mesh.material.opacity = 1 - s.age / s.life;
    }
  }
}

function disposeObject(obj) {
  obj.traverse?.((o) => {
    if (o.geometry && !Object.values(getBladeGeos()).includes(o.geometry)) o.geometry.dispose();
    if (o.material) {
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      for (const m of mats) { m.map?.dispose(); m.dispose(); }
    }
  });
}
