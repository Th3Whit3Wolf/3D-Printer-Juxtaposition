// Emits the cleaned printer data (tracking-free links, derived values) as
// data/printers.json in the build. The page itself doesn't fetch it: the data
// is already baked into the HTML.
import { publicData } from "../../lib/printers.mjs";

export const GET = () =>
  new Response(JSON.stringify(publicData), { headers: { "Content-Type": "application/json" } });
