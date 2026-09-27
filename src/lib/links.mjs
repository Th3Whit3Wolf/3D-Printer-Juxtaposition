// Store-link cleaning, shared by the site build and the issue bot.
// Amazon links become https://www.amazon.<tld>/dp/<ASIN>; other links lose
// tracking parameters. No dependencies, so plain Node can import it too.

const AMAZON_HOST = /(^|\.)amazon\.(com|ca|com\.mx|com\.br|co\.uk|de|fr|it|es|nl|se|pl|com\.be|com\.tr|ae|sa|eg|in|sg|co\.jp|com\.au)$/i;
const AMAZON_SHORT_HOST = /^(amzn\.to|amzn\.eu|amzn\.asia|a\.co)$/i;
const ASIN_PATH = /\/(?:dp|gp\/product|gp\/aw\/d|exec\/obidos\/ASIN|o\/ASIN|d)\/([A-Z0-9]{10})(?=[/?#]|$)/i;
const TRACKING_PARAM = /^(utm_\w+|fbclid|gclid|gbraid|wbraid|msclkid|dclid|mc_cid|mc_eid|_ga|_gl|igshid|srsltid|spm|scm|ref|ref_src|aff_platform|sk|algo_pvid|gatewayadapt|pdp_\w+)$/i;

export const isAmazonHost = (host) => AMAZON_HOST.test(host);
export const isAmazonShortHost = (host) => AMAZON_SHORT_HOST.test(host);

function amazonBase(host) {
  const tld = host.toLowerCase().match(AMAZON_HOST)[2];
  return `https://www.amazon.${tld}`;
}

/**
 * Returns a cleaned URL string, or null if the input isn't an http(s) URL.
 * @param {string} input
 * @param {{ amazonTag?: string }} [opts] amazonTag: your Associates tag, added to every Amazon link
 */
export function cleanUrl(input, { amazonTag = "" } = {}) {
  let u;
  try {
    u = new URL(String(input).trim());
  } catch {
    return null;
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") return null;
  u.hash = "";
  u.username = "";
  u.password = "";

  if (isAmazonHost(u.hostname)) {
    const base = amazonBase(u.hostname);
    const asin = u.pathname.match(ASIN_PATH)?.[1];
    let out;
    if (asin) out = new URL(`${base}/dp/${asin.toUpperCase()}`);
    else if (u.pathname === "/s" && u.searchParams.get("k")) {
      out = new URL(`${base}/s`);
      out.searchParams.set("k", u.searchParams.get("k"));
    } else {
      // Brand stores and other pages: keep the path, drop /ref=… and every query param
      out = new URL(base + u.pathname.replace(/\/ref=[^/]*$/, ""));
    }
    if (amazonTag) out.searchParams.set("tag", amazonTag);
    return out.toString();
  }

  for (const key of [...u.searchParams.keys()]) {
    if (TRACKING_PARAM.test(key)) u.searchParams.delete(key);
  }
  return u.toString();
}

/** A readable default label for a store link. */
export function labelFor(url) {
  const host = new URL(url).hostname.replace(/^www\./, "");
  if (isAmazonHost(host) || isAmazonShortHost(host)) return "Amazon";
  if (/(^|\.)aliexpress\./.test(host)) return "AliExpress";
  if (/(^|\.)ebay\./.test(host)) return "eBay";
  if (/(^|\.)bestbuy\./.test(host)) return "Best Buy";
  if (/(^|\.)microcenter\./.test(host)) return "Micro Center";
  return host;
}
