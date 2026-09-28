// The public dataset at data/printers.json: cleaned links, derived values,
// brand colors and photo URLs. The live page (/live/) renders from this.
import { printers, toPublic } from "../../lib/printers.mjs";
import { withPhotos } from "../../lib/photos.mjs";

// Photo paths are relative to this file (data/), so "../assets/…"
const fromHere = (url) => (url && !/^https?:/i.test(url) ? `../${url}` : url);

export async function GET() {
  const list = (await withPhotos(printers)).map((p) => toPublic({ ...p, thumb: fromHere(p.thumb), hero: fromHere(p.hero) }));
  return new Response(JSON.stringify(list), { headers: { "Content-Type": "application/json" } });
}
