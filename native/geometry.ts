// three.js's Shape + ExtrudeGeometry, which starhermit:scene does not have
// (from the arrow-exodus port), for the blade's bevelled profile. The outline
// is extruded as three.js does it (bevel rings at cos/sin of the bevel's
// quarter turn, the outline grown by the bevel size, caps on the inset
// outline at the bevel's thickness), as a non-indexed geometry with face
// normals, which is what three's ExtrudeGeometry gives.
import { BufferAttribute, BufferGeometry } from "starhermit:scene";

type P = [number, number];
export interface Bevel { thickness: number; size: number; segments: number }

// -- outlines ---------------------------------------------------------------------------
function area(pts: P[]): number {
  let s = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i]!, b = pts[(i + 1) % pts.length]!;
    s += a[0] * b[1] - b[0] * a[1];
  }
  return s / 2;
}
/** The outline moved outward by `d` (miter joins, as three's bevel offsets it). */
function offset(pts: P[], d: number): P[] {
  if (!d) return pts.map((p) => [p[0], p[1]] as P);
  const ccw = area(pts) > 0 ? 1 : -1;
  const n = pts.length;
  const normal = (a: P, b: P): P => {
    const dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy) || 1;
    return [(dy / l) * ccw, (-dx / l) * ccw];
  };
  return pts.map((p, i) => {
    const n1 = normal(pts[(i + n - 1) % n]!, p), n2 = normal(p, pts[(i + 1) % n]!);
    const k = d / Math.max(0.2, 1 + n1[0] * n2[0] + n1[1] * n2[1]);
    return [p[0] + (n1[0] + n2[0]) * k, p[1] + (n1[1] + n2[1]) * k] as P;
  });
}
/** Ear-clipping triangulation of a simple polygon: index triples, counter-clockwise. */
function triangulate(pts: P[]): number[] {
  const idx = pts.map((_, i) => i);
  if (area(pts) < 0) idx.reverse();
  const tris: number[] = [];
  const cross = (a: P, b: P, c: P): number => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  const inside = (p: P, a: P, b: P, c: P): boolean => cross(a, b, p) >= 0 && cross(b, c, p) >= 0 && cross(c, a, p) >= 0;
  let guard = 0;
  while (idx.length > 3 && guard++ < 10000) {
    let clipped = false;
    for (let i = 0; i < idx.length; i++) {
      const ia = idx[(i + idx.length - 1) % idx.length]!, ib = idx[i]!, ic = idx[(i + 1) % idx.length]!;
      const a = pts[ia]!, b = pts[ib]!, c = pts[ic]!;
      if (cross(a, b, c) <= 1e-12) continue;
      let ear = true;
      for (const j of idx) {
        if (j === ia || j === ib || j === ic) continue;
        if (inside(pts[j]!, a, b, c)) { ear = false; break; }
      }
      if (!ear) continue;
      tris.push(ia, ib, ic);
      idx.splice(i, 1);
      clipped = true;
      break;
    }
    if (!clipped) break;
  }
  if (idx.length === 3) tris.push(idx[0]!, idx[1]!, idx[2]!);
  return tris;
}

// -- extrusion ----------------------------------------------------------------------------
/**
 * Extrudes `outline` (shape space: x, s) along y from 0 to `depth`, three.js
 * style: with a bevel the caps lie at −thickness and depth + thickness on
 * the outline, and the sides on the outline grown by the bevel size. Shape
 * s maps to world z through `sz` (−1: three's rotateX(−π/2), the arrows;
 * +1: rotateX(π/2), the slabs, which are symmetric).
 */
export function extrude(outline: P[], depth: number, bevel: Bevel | null, sz = -1): BufferGeometry {
  // The profile: rings of (outward offset, y) from the bottom cap to the top cap.
  const rings: { off: number; y: number; cap?: number }[] = [];
  if (bevel && bevel.segments > 0) {
    for (let i = 0; i <= bevel.segments; i++) {
      const a = (i / bevel.segments) * Math.PI / 2;
      rings.push({ off: bevel.size * Math.sin(a), y: -bevel.thickness * Math.cos(a) });
    }
    for (let i = bevel.segments; i >= 0; i--) {
      const a = (i / bevel.segments) * Math.PI / 2;
      rings.push({ off: bevel.size * Math.sin(a), y: depth + bevel.thickness * Math.cos(a) });
    }
  } else {
    rings.push({ off: 0, y: 0 }, { off: 0, y: depth });
  }
  const outlines = rings.map((r) => offset(outline, r.off));
  const pos: number[] = [];
  const P3 = (p: P, y: number): [number, number, number] => [p[0], y, p[1] * sz];
  const tri = (a: [number, number, number], b: [number, number, number], c: [number, number, number], want: [number, number, number]): void => {
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
    const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    if (nx * want[0] + ny * want[1] + nz * want[2] < 0) pos.push(...a, ...c, ...b);
    else pos.push(...a, ...b, ...c);
  };
  // Caps.
  const tris = triangulate(outline);
  const bottom = outlines[0]!, top = outlines[outlines.length - 1]!;
  const yb = rings[0]!.y, yt = rings[rings.length - 1]!.y;
  for (let i = 0; i < tris.length; i += 3) {
    const [a, b, c] = [tris[i]!, tris[i + 1]!, tris[i + 2]!];
    tri(P3(top[a]!, yt), P3(top[b]!, yt), P3(top[c]!, yt), [0, 1, 0]);
    tri(P3(bottom[a]!, yb), P3(bottom[b]!, yb), P3(bottom[c]!, yb), [0, -1, 0]);
  }
  // Sides: a quad strip between each two rings, facing out of the edge.
  const ccw = area(outline) > 0 ? 1 : -1;
  const n = outline.length;
  const midY = depth / 2;
  for (let r = 0; r < rings.length - 1; r++) {
    const lo = outlines[r]!, hi = outlines[r + 1]!;
    const ylo = rings[r]!.y, yhi = rings[r + 1]!.y;
    const vy = (ylo + yhi) / 2 > midY + 1e-6 && ylo !== yhi ? 0.5 : (ylo + yhi) / 2 < midY - 1e-6 && ylo !== yhi ? -0.5 : 0;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const e0 = outline[i]!, e1 = outline[j]!;
      const dx = e1[0] - e0[0], ds = e1[1] - e0[1], l = Math.hypot(dx, ds) || 1;
      const want: [number, number, number] = [(ds / l) * ccw, vy, (-dx / l) * ccw * sz];
      const a = P3(lo[i]!, ylo), b = P3(lo[j]!, ylo), c = P3(hi[j]!, yhi), d = P3(hi[i]!, yhi);
      tri(a, b, c, want);
      tri(a, c, d, want);
    }
  }
  const g = new BufferGeometry();
  const arr = new Float32Array(pos);
  const uv = new Float32Array((arr.length / 3) * 2);
  for (let i = 0, k = 0; i < arr.length; i += 3, k += 2) { uv[k] = arr[i]! + 0.5; uv[k + 1] = arr[i + 2]! + 0.5; }
  g.setAttribute("position", new BufferAttribute(arr, 3));
  g.setAttribute("uv", new BufferAttribute(uv, 2));
  g.computeVertexNormals();
  g.computeBoundingSphere();
  return g;
}

/** The blade (js/render.js getBladeGeos before the port): the tapered,
 * pointed profile in the xy plane extruded 0.008 along z with a 0.004 bevel
 * of one segment, centred on z = 0 — three's ExtrudeGeometry of that Shape,
 * translated by −0.004. */
export function bladeGeometry(): BufferGeometry {
  const outline: P[] = [[-0.026, 0], [0.026, 0], [0.024, 0.24], [0, 0.34], [-0.024, 0.24]];
  // extrude() runs along y with the outline's second axis on z; turned so
  // the outline lies in xy and the depth runs along −z, then centred.
  const g = extrude(outline, 0.008, { thickness: 0.004, size: 0.004, segments: 1 }, 1);
  g.rotateX(-Math.PI / 2);
  g.translate(0, 0, 0.004);
  g.computeVertexNormals();
  return g;
}
