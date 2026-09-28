// Isometric drawing helpers: row glyphs and the build plate.
// Pure functions, used by the build and in the browser.
// No dependencies, so Vite can bundle it into the page script.

export const COS30 = Math.cos(Math.PI / 6);
const r1 = (v) => Math.round(v * 10) / 10;

// Projects (x, y, z) in mm to an "x y" SVG coordinate
export const projector = (ox, oy, k) => (x, y, z) => `${r1(ox + (x - y) * COS30 * k)} ${r1(oy + ((x + y) / 2 - z) * k)}`;

// Paths for the three visible faces of a box (top, right = +x, left = +y)
export function faces(P, x0, y0, x1, y1, z1) {
  const q = (pts) => "M" + pts.map((p) => P(...p)).join("L") + "Z";
  return [
    q([[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]]),
    q([[x1, y0, 0], [x1, y1, 0], [x1, y1, z1], [x1, y0, z1]]),
    q([[x0, y1, 0], [x1, y1, 0], [x1, y1, z1], [x0, y1, z1]]),
  ];
}

// All 12 edges of a box as one path
function edges(P, x0, y0, x1, y1, z1) {
  const B = [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
  let d = "";
  for (let i = 0; i < 4; i++) {
    const [ax, ay] = B[i], [bx, by] = B[(i + 1) % 4];
    d += `M${P(ax, ay, 0)}L${P(bx, by, 0)}M${P(ax, ay, z1)}L${P(bx, by, z1)}M${P(ax, ay, 0)}L${P(ax, ay, z1)}`;
  }
  return d;
}

/* ---------- row glyphs ----------
   Build volume outline with the largest cube inside. Every glyph in a list
   shares one scale (from glyphScale) so sizes compare at a glance. */

const GW = 64, GH = 58, PAD = 2;

/** One shared scale for a set of build volumes ([{x, y, z}] in mm) */
export function glyphScale(volumes) {
  let w = 1, h = 1;
  for (const v of volumes) {
    w = Math.max(w, (v.x + v.y) * COS30);
    h = Math.max(h, (v.x + v.y) / 2 + v.z);
  }
  return Math.min((GW - 2 * PAD) / w, (GH - 2 * PAD) / h);
}

export function glyph(bv, k, cls = "") {
  const { x: X, y: Y, z: Z } = bv;
  const s = Math.min(X, Y, Z);
  const ox = (GW - (X + Y) * COS30 * k) / 2 + Y * COS30 * k;
  const oy = GH - PAD - ((X + Y) / 2) * k;
  const P = projector(ox, oy, k);
  const [t, r, l] = faces(P, X - s, Y - s, X, Y, s);
  return `<svg viewBox="0 0 ${GW} ${GH}" class="glyph ${cls}" aria-hidden="true"><path class="g-box" d="${faces(P, 0, 0, X, Y, Z).join("")}"/><path class="g-t" d="${t}"/><path class="g-r" d="${r}"/><path class="g-l" d="${l}"/></svg>`;
}

/* ---------- the build plate ----------
   Every build volume nested on one plate, to scale, anchored at the front
   corner, with grid lines every 50 mm. */

const PLATE_W = 440;

/** Plate size and scale for a set of build volumes ([{x, y, z}] in mm). The build uses W/H to reserve space. */
export function plateLayout(volumes) {
  const maxXY = Math.max(...volumes.map((v) => Math.max(v.x, v.y)));
  const maxZ = Math.max(...volumes.map((v) => v.z));
  const S = Math.ceil((maxXY + 60) / 50) * 50; // plate size, mm
  const k = PLATE_W / (2 * S * COS30);
  const H = Math.ceil((S + maxZ) * k + 24);
  return { S, F: S - 30, W: PLATE_W, H, k, ox: PLATE_W / 2, oy: H - S * k - 8 };
}

/**
 * @param {{ id: string, color: string, bv: { x: number, y: number, z: number } }[]} items
 * @returns {string} SVG markup
 */
export function plateSvg(items) {
  const { S, F, W, H, k, ox, oy } = plateLayout(items.map((p) => p.bv));
  const P = projector(ox, oy, k);

  let grid = "";
  for (let g = 0; g <= S; g += 50) grid += `M${P(g, 0, 0)}L${P(g, S, 0)}M${P(0, g, 0)}L${P(S, g, 0)}`;
  const face = `M${P(0, 0, 0)}L${P(S, 0, 0)}L${P(S, S, 0)}L${P(0, S, 0)}Z`;

  // Largest volumes first so smaller ones sit in front
  const order = [...items].sort((a, b) => b.bv.x * b.bv.y * b.bv.z - a.bv.x * a.bv.y * a.bv.z);
  const vols = order.map(({ id, color, bv: { x, y, z } }, i) => {
    const s = Math.min(x, y, z);
    const [t, r, l] = faces(P, F - s, F - s, F, F, s);
    return `<g class="vol" data-id="${id}" style="--c:${color};--i:${i}"><path class="v-fill" d="${faces(P, F - x, F - y, F, F, z).join("")}"/><path class="v-edge" pathLength="1" d="${edges(P, F - x, F - y, F, F, z)}"/><g class="v-cube"><path class="g-t" d="${t}"/><path class="g-r" d="${r}"/><path class="g-l" d="${l}"/></g></g>`;
  });

  return `<svg viewBox="0 0 ${W} ${H}" class="plate block w-full" role="img" aria-label="Build volumes of all printers drawn to the same scale"><path class="p-face" d="${face}"/><path class="p-grid" d="${grid}"/>${vols.join("")}</svg>`;
}
