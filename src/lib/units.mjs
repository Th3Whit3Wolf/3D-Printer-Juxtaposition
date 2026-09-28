// Metric / US formatting, shared by the build (printers.mjs, index.astro) and
// the browser (app.js), so both always produce the same text.
//
// u(kind, value) returns both versions side by side:
//   <span class="um">256 mm</span><span class="uu">10.1 in</span>
// and CSS shows one of them based on <html data-units="…">, so switching
// units never re-renders anything and there's no flash on load.
// Data stays metric everywhere; only the display changes.

const nf = (d, b) => new Intl.NumberFormat("en-US", { maximumFractionDigits: d, ...(b ? { style: "currency", currency: "USD", maximumFractionDigits: d } : {}) });
const n0 = nf(0), n1 = nf(1), n2 =nf(2);
const usd0 = nf(0, 1)
const usd2 = nf(2, 1)

const MM_PER_IN = 25.4;
const IN3_PER_L = 61.0237;
const L_PER_FT3 = 28.3168;
const LB_PER_KG = 2.20462;

const inch = (mm) => n1.format(mm / MM_PER_IN);

// [metric, US] formatters. Inputs are always metric: mm, litres, °C, mm/s, kg, $ per litre.
export const KINDS = {
  len: [(mm) => `${n1.format(mm)} mm`, (mm) => `${inch(mm)} in`],
  dims: [(a) => `${a.map((v) => n1.format(v)).join(" × ")} mm`, (a) => `${a.map(inch).join(" × ")} in`],
  vol: [(L) => `${n1.format(L)} L`, (L) => `${n0.format(L * IN3_PER_L)} in³`],
  temp: [(c) => `${n0.format(c)} °C`, (c) => `${n0.format((c * 9) / 5 + 32)} °F`],
  speed: [(v) => `${n0.format(v)} mm/s`, (v) => `${inch(v)} in/s`],
  mass: [(kg) => `${n1.format(kg)} kg`, (kg) => `${n1.format(kg * LB_PER_KG)} lb`],
  // price per unit of build volume: $/L, or $/ft³ (per in³ would be fractions of a cent)
  ppv: [(v) => usd2.format(v), (v) => usd0.format(v * L_PER_FT3)],
  // plain text that differs by system, e.g. column labels: u("text", ["Per litre", "Per ft³"])
  text: [(t) => t[0], (t) => t[1]],
};

export function u(kind, value) {
  const [m, us] = KINDS[kind];
  return `<span class="um">${m(value)}</span><span class="uu">${us(value)}</span>`;
}

/** The text for one system only (for places that can't hold markup, like <output> values read by screen readers). */
export const uText = (kind, value, system) => KINDS[kind][system === "us" ? 1 : 0](value);
