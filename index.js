const Parser = require("rss-parser");
const { createClient } = require("@supabase/supabase-js");
const cron = require("node-cron");

const parser = new Parser({
  headers: {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Accept": "application/rss+xml, application/xml, text/xml, */*",
  },
  timeout: 15000,
  customFields: {
    item: [
      ["media:content",   "media:content",   { keepArray: false }],
      ["media:thumbnail", "media:thumbnail", { keepArray: false }],
    ],
  },
});

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

// ── Best Buy API key (get free at bestbuyapis.com) ─────────────────────────
const BESTBUY_API_KEY = process.env.BESTBUY_API_KEY || "";

const RSS_FEEDS = [
  { url: "https://www.dealnews.com/all.rss",                                                          source: "dealnews",     label: "DealNews"          },
  { url: "https://slickdeals.net/newsearch.php?mode=frontpage&searcharea=deals&searchin=first&rss=1", source: "slickdeals",   label: "Slickdeals"        },
  { url: "https://bensbargains.net/rss.xml/0",                                                        source: "bensbargains", label: "Ben's Bargains"    },
  { url: "https://www.spoofee.com/rss.php",                                                           source: "spoofee",      label: "Spoofee"           },
  { url: "https://camelcamelcamel.com/top_drops/feed",                                               source: "amazon",       label: "CamelCamelCamel"   },
  { url: "https://camelcamelcamel.com/popular/feed",                                                 source: "amazon",       label: "CamelCamelCamel Popular" },
  { url: "https://hip2save.com/feed/",                                                               source: "hip2save",     label: "Hip2Save"          },
  { url: "https://thekrazycouponlady.com/feed/",                                                     source: "couponlady",   label: "Krazy Coupon Lady" },
  { url: "https://www.bradsdeals.com/feed",                                                          source: "bradsdeals",   label: "Brad's Deals"      },
  { url: "https://freebieshark.com/feed/",                                                           source: "freebieshark", label: "Freebie Shark"     },
];

// ── Skip list ──────────────────────────────────────────────────────────────
const SKIP_KEYWORDS = [
  "book", "kindle", "audible", "novel", "paperback", "hardcover",
  "ebook", "audiobook", "manga", "comic book", "textbook",
];

function shouldSkip(title = "") {
  return SKIP_KEYWORDS.some(k => title.toLowerCase().includes(k));
}

// ── True free detection — same logic as the website ──────────────────────
const SHIP_PATTERNS = [
  /free\s+(shipping|s&h|s\/h|delivery|ship|returns|return|pickup)/i,
  /\+\s*free\s+(ship|delivery)/i,
  /ships?\s+free\b/i,
  /free\s+ship(ping)?\s+(on|with|over|for)/i,
  /free\s+2[-–]day/i,
];
const TRULY_FREE_PATTERNS = [
  /\bfree\s+after\s+(mail[-\s]?in\s+)?rebate/i,
  /\bfree\s+after\s+coupon/i,
  /\bfree\s+(item|product|sample|gift|toy)\b/i,
  /\bget\s+.{1,25}\bfor\s+free\b/i,
  /100%\s*off\b/i,
  /\$0\.00\b/,
  /\bpenny\s+(deal|item|price)\b/i,
  /\bfree\s+with\s+(purchase|subscription|prime)\b/i,
  /\bcompletely\s+free\b/i,
];

function isTrulyFree(title="") {
  if (TRULY_FREE_PATTERNS.some(p => p.test(title))) return true;
  const hasShipping = SHIP_PATTERNS.some(p => p.test(title));
  if (hasShipping) return false;
  return false;
}

function isShippingOnlyDeal(title="") {
  const onlyShip   = SHIP_PATTERNS.some(p => p.test(title));
  const hasDiscount = /\d+%\s*off|\$\d+\s*off|save\s+\$|was\s+\$/i.test(title);
  return onlyShip && !hasDiscount && !isTrulyFree(title);
}

// ── Store detection ────────────────────────────────────────────────────────
function detectStore(title = "", url = "") {
  const t = (title + " " + url).toLowerCase();
  if (t.includes("home depot") || t.includes("homedepot")) return "Home Depot";
  if (t.includes("menards"))                               return "Menards";
  if (t.includes("lowe"))                                  return "Lowe's";
  if (t.includes("old navy"))                              return "Old Navy";
  if (/(^|\s)gap(\s|\.com)/.test(t))                       return "Gap";
  if (t.includes("kohl"))                                  return "Kohl's";
  if (t.includes("chick-fil") || t.includes("chickfila")) return "Chick-fil-A";
  if (t.includes("starbucks"))                             return "Starbucks";
  if (t.includes("mcdonald"))                              return "McDonald's";
  if (t.includes("dunkin"))                                return "Dunkin'";
  if (t.includes("subway"))                                return "Subway";
  if (t.includes("amazon") || t.includes("camelcamel"))   return "Amazon";
  if (t.includes("best buy") || t.includes("bestbuy"))     return "Best Buy";
  if (t.includes("target"))                                return "Target";
  if (t.includes("walmart"))                               return "Walmart";
  if (t.includes("costco"))                                return "Costco";
  if (t.includes("ebay"))                                  return "eBay";
  if (t.includes("newegg"))                                return "Newegg";
  if (t.includes("dollar tree"))                           return "Dollar Tree";
  if (t.includes("nike"))                                  return "Nike";
  return "Other";
}

function detectCategory(title = "") {
  const t = title.toLowerCase();
  if (/home depot|menard|lowe'?s|lowes|tool|drill|lumber|hardware|garden|appliance|plumbing|flooring/.test(t)) return "home";
  if (/old navy|\bgap\b|kohl'?s|shirt|pants|jeans|jacket|hoodie|dress|shoes|sneaker|apparel|clothing|fashion/.test(t)) return "clothing";
  if (/chick.fil|starbucks|mcdonald|dunkin|subway|domino|pizza|coffee|burger|fast.?food/.test(t)) return "food";
  if (/amazon|best buy|laptop|phone|\btv\b|monitor|headphone|tablet|ipad|iphone|samsung|gpu|console|gaming/.test(t)) return "electronics";
  return "general";
}

function calcHotScore(title = "", discount = "") {
  if (isTrulyFree(title))            return 100;
  if (/penny|\$0\.01/.test(title))   return 95;
  const m = (discount || title).match(/(\d+)%/);
  if (m) return parseInt(m[1]);
  return 0;
}

function extractPrice(title = "") {
  // Don't mark as FREE just because of free shipping
  const free   = isTrulyFree(title);
  const prices = title.replace(/,/g, "").match(/\$[\d]+(?:\.\d{2})?/g);
  const discount = title.match(/(\d+)%\s*off/i);
  return {
    price:    free ? "FREE" : (prices ? prices[prices.length - 1] : null),
    discount: discount ? discount[1] + "% off" : (free ? "100% off" : null),
  };
}

function extractImage(item) {
  if (item.enclosure?.url?.match(/\.(jpg|jpeg|png|webp|gif)/i)) return item.enclosure.url;
  if (item["media:content"]?.["$"]?.url) return item["media:content"]["$"].url;
  if (item["media:content"]?.url)        return item["media:content"].url;
  if (item["media:thumbnail"]?.["$"]?.url) return item["media:thumbnail"]["$"].url;
  const html = item["content:encoded"] || item.content || item.summary || "";
  const m = html.match(/<img[^>]+src=["']([^"']+)["']/i);
  if (m && m[1].startsWith("http")) return m[1];
  return null;
}

// Follow redirect to get real retailer URL
async function resolveUrl(rawUrl = "") {
  const DIRECT = ["amazon.com","walmart.com","target.com","homedepot.com","lowes.com",
    "bestbuy.com","kohls.com","gap.com","oldnavy.com","costco.com","ebay.com",
    "newegg.com","menards.com","starbucks.com","mcdonalds.com","chick-fil-a.com"];
  if (!rawUrl || DIRECT.some(d => rawUrl.includes(d))) return rawUrl;
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 6000);
    const res = await fetch(rawUrl, { redirect:"follow", signal: ctrl.signal,
      headers:{ "User-Agent":"Mozilla/5.0 (compatible; SaveYourDollar)" } });
    clearTimeout(t);
    if (DIRECT.some(d => res.url.includes(d))) return res.url;
  } catch {}
  return rawUrl;
}

async function saveDeal(deal) {
  if (!deal.url || !deal.title || deal.title.length < 5) return false;
  const { data: existing } = await supabase
    .from("deals").select("id").eq("url", deal.url).limit(1);
  if (existing?.length > 0) return false;
  const { error } = await supabase.from("deals").insert({
    title:       deal.title.slice(0, 250),
    description: (deal.description || "").slice(0, 600),
    url:         deal.url,
    image_url:   deal.image_url  || null,
    source:      deal.source,
    category:    deal.category,
    store:       deal.store,
    price:       deal.price      || null,
    discount:    deal.discount   || null,
    hot_score:   deal.hot_score  || 0,
    posted_at:   deal.posted_at  || new Date().toISOString(),
    is_approved: true,
  });
  if (error) { console.error("    DB error:", error.message); return false; }
  return true;
}

// ── Best Buy API — official deal data ─────────────────────────────────────
async function fetchBestBuyDeals() {
  if (!BESTBUY_API_KEY) {
    console.log("  ℹ Best Buy API key not set — skipping (add BESTBUY_API_KEY env var)");
    return 0;
  }
  let saved = 0;
  try {
    // Sale items sorted by discount, top 50
    const url = `https://api.bestbuy.com/v1/products(onSale=true&salePrice<200)?format=json&show=name,salePrice,regularPrice,percentSavings,url,image,shortDescription&sort=percentSavings.dsc&pageSize=50&apiKey=${BESTBUY_API_KEY}`;
    const res  = await fetch(url);
    const json = await res.json();
    const items = json.products || [];
    console.log(`  ✓ Best Buy API: ${items.length} sale items`);

    for (const p of items) {
      if (!p.url || !p.name) continue;
      const pct      = Math.round(p.percentSavings || 0);
      const title    = `${p.name}${pct >= 10 ? ` — ${pct}% off` : ""}`;
      const discount = pct >= 5 ? pct + "% off" : null;
      const ok = await saveDeal({
        title,
        url:         p.url,
        description: p.shortDescription || "",
        image_url:   p.image || null,
        source:      "bestbuy-api",
        category:    "electronics",
        store:       "Best Buy",
        price:       p.salePrice ? "$" + p.salePrice : null,
        discount,
        hot_score:   pct,
        posted_at:   new Date().toISOString(),
      });
      if (ok) saved++;
    }
  } catch (err) {
    console.error("  ✗ Best Buy API:", err.message);
  }
  return saved;
}

// ── RSS fetch ──────────────────────────────────────────────────────────────
async function fetchRSS() {
  let total = 0;
  for (const feed of RSS_FEEDS) {
    try {
      const result = await parser.parseURL(feed.url);
      let saved = 0;
      for (const item of result.items.slice(0, 30)) {
        const title = (item.title || "").trim();
        if (shouldSkip(title)) continue;

        const rawUrl = item.link || item.guid || "";
        const finalUrl = await resolveUrl(rawUrl);
        const { price, discount } = extractPrice(title);

        const ok = await saveDeal({
          title,
          url:         finalUrl,
          description: item.contentSnippet || "",
          image_url:   extractImage(item),
          source:      feed.source,
          category:    detectCategory(title),
          store:       detectStore(title, finalUrl),
          price, discount,
          hot_score:   calcHotScore(title, discount),
          posted_at:   item.pubDate ? new Date(item.pubDate).toISOString() : new Date().toISOString(),
        });
        if (ok) { total++; saved++; }
      }
      console.log(`  ✓ ${feed.label}: ${result.items.length} fetched, ${saved} new`);
    } catch (err) {
      console.error(`  ✗ ${feed.label}: ${err.message}`);
    }
  }
  return total;
}

async function fetchAndSave() {
  console.log(`\n[${new Date().toISOString()}] Starting daily fetch...`);
  const rss = await fetchRSS();
  const bb  = await fetchBestBuyDeals();
  console.log(`  ✅ Done — ${rss + bb} new deals saved\n`);
}

fetchAndSave();
cron.schedule("0 6 * * *", fetchAndSave);
