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

// Domains we consider "direct" — no redirect needed
const DIRECT_DOMAINS = [
  "amazon.com","walmart.com","target.com","homedepot.com","lowes.com",
  "bestbuy.com","kohls.com","gap.com","oldnavy.com","macys.com",
  "costco.com","ebay.com","newegg.com","menards.com","chickfila.com",
  "starbucks.com","mcdonalds.com","aldi.us","nike.com","adidas.com",
];

function isDirectUrl(url = "") {
  return DIRECT_DOMAINS.some(d => url.includes(d));
}

// Follow redirects to get the real retailer URL
async function resolveUrl(rawUrl = "") {
  if (!rawUrl || isDirectUrl(rawUrl)) return rawUrl;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 6000);
    const res = await fetch(rawUrl, {
      method: "GET",
      redirect: "follow",
      signal: controller.signal,
      headers: { "User-Agent": "Mozilla/5.0 (compatible; SaveYourDollar)" },
    });
    clearTimeout(timer);
    const final = res.url;
    // Only keep if it landed on a known retailer
    if (isDirectUrl(final)) return final;
    // Try to extract from URL params as fallback
    try {
      const u = new URL(rawUrl);
      for (const p of ["url","u","link","dest","ref","to","target"]) {
        const v = u.searchParams.get(p);
        if (v && v.startsWith("http") && isDirectUrl(v)) return decodeURIComponent(v);
      }
    } catch {}
    return rawUrl; // give back original if we can't resolve
  } catch {
    return rawUrl;
  }
}

const SKIP_KEYWORDS = [
  "book","kindle","audible","novel","paperback","hardcover",
  "ebook","audiobook","manga","comic book","textbook",
];
function shouldSkip(title = "") {
  const t = title.toLowerCase();
  return SKIP_KEYWORDS.some(k => t.includes(k));
}

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
  if (/chick.fil|starbucks|mcdonald|dunkin|subway|domino|pizza|coffee|burger|fast.?food|free (sandwich|drink|meal)/.test(t)) return "food";
  if (/amazon|best buy|laptop|phone|\btv\b|monitor|headphone|tablet|ipad|iphone|samsung|gpu|console|gaming/.test(t)) return "electronics";
  return "general";
}

function calcHotScore(title = "", discount = "") {
  if (/\bfree\b/i.test(title))           return 100;
  if (/penny|\$0\.01/.test(title))        return 95;
  const m = (discount || title).match(/(\d+)%/);
  return m ? parseInt(m[1]) : 0;
}

function extractPrice(title = "") {
  const isFree   = /\bfree\b/i.test(title);
  const prices   = title.replace(/,/g, "").match(/\$[\d]+(?:\.\d{2})?/g);
  const discount = title.match(/(\d+)%\s*off/i);
  return {
    price:    isFree ? "FREE" : (prices ? prices[prices.length - 1] : null),
    discount: discount ? discount[1] + "% off" : (isFree ? "100% off" : null),
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

async function fetchAndSave() {
  console.log(`\n[${new Date().toISOString()}] Starting daily fetch...`);
  let total = 0;

  for (const feed of RSS_FEEDS) {
    try {
      const result = await parser.parseURL(feed.url);
      let saved = 0;

      for (const item of result.items.slice(0, 30)) {
        const title = (item.title || "").trim();
        if (shouldSkip(title)) continue;

        const rawUrl = item.link || item.guid || "";

        // ── Follow redirect to get direct retailer URL ──────────────────────
        const finalUrl = await resolveUrl(rawUrl);

        const { price, discount } = extractPrice(title);
        const store    = detectStore(title, finalUrl);
        const category = detectCategory(title);

        const ok = await saveDeal({
          title,
          url:         finalUrl,
          description: item.contentSnippet || "",
          image_url:   extractImage(item),
          source:      feed.source,
          category,
          store,
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

  console.log(`  ✅ Done — ${total} new deals saved\n`);
}

fetchAndSave();
cron.schedule("0 6 * * *", fetchAndSave); // once daily at 6 AM
