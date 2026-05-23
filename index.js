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
      ["media:content", "media:content", { keepArray: false }],
      ["media:thumbnail", "media:thumbnail", { keepArray: false }],
      ["enclosure", "enclosure", { keepArray: false }],
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

// Words that mean we should skip this deal entirely
const SKIP_KEYWORDS = [
  "book", "kindle", "audible", "novel", "paperback", "hardcover",
  "ebook", "audiobook", "manga", "comic book", "textbook",
];

function shouldSkip(title = "") {
  const t = title.toLowerCase();
  return SKIP_KEYWORDS.some(k => t.includes(k));
}

// ── Extract the REAL retailer URL from redirect/tracking links ─────────────
function extractDirectUrl(rawUrl = "", title = "") {
  try {
    // Many deal sites use ?url= or ?u= or ?link= params
    const u = new URL(rawUrl);
    for (const param of ["url", "u", "link", "dest", "redirect", "target", "ref"]) {
      const val = u.searchParams.get(param);
      if (val && val.startsWith("http")) return decodeURIComponent(val);
    }
    // Slickdeals wraps links — extract from URL path
    if (rawUrl.includes("slickdeals.net/click") || rawUrl.includes("slickdeals.net/e/")) {
      // Can't resolve server-side, return as-is; we mark source
      return rawUrl;
    }
    return rawUrl;
  } catch {
    return rawUrl;
  }
}

// ── Detect direct retailer URL from title keywords ─────────────────────────
function guessRetailerUrl(title = "", existingUrl = "") {
  const t = title.toLowerCase();
  // If URL already goes to a retailer directly, keep it
  const direct = ["amazon.com","walmart.com","target.com","homedepot.com",
    "lowes.com","bestbuy.com","kohls.com","gap.com","oldnavy.com",
    "macys.com","costco.com","ebay.com","newegg.com"];
  if (direct.some(d => existingUrl.includes(d))) return existingUrl;

  // Otherwise try to build a search URL for the likely retailer
  const encoded = encodeURIComponent(title.slice(0, 80));
  if (t.includes("home depot") || t.includes("homedepot"))
    return `https://www.homedepot.com/s/${encoded}`;
  if (t.includes("menards"))
    return `https://www.menards.com/main/search.html?search=${encoded}`;
  if (t.includes("lowe"))
    return `https://www.lowes.com/search?searchTerm=${encoded}`;
  if (t.includes("walmart"))
    return `https://www.walmart.com/search?q=${encoded}`;
  if (t.includes("target"))
    return `https://www.target.com/s?searchTerm=${encoded}`;
  if (t.includes("amazon") || existingUrl.includes("camelcamelcamel"))
    return `https://www.amazon.com/s?k=${encoded}&tag=saveyourdollar-20`;
  if (t.includes("best buy") || t.includes("bestbuy"))
    return `https://www.bestbuy.com/site/searchpage.jsp?st=${encoded}`;
  if (t.includes("old navy"))
    return `https://oldnavy.gap.com/browse/search.do?searchText=${encoded}`;
  if (t.includes("gap"))
    return `https://www.gap.com/browse/search.do?searchText=${encoded}`;
  if (t.includes("kohl"))
    return `https://www.kohls.com/search/results.jsp?keyword=${encoded}`;
  if (t.includes("starbucks"))
    return `https://www.starbucks.com/menu`;
  if (t.includes("chick-fil") || t.includes("chickfila"))
    return `https://www.chick-fil-a.com/menu`;
  if (t.includes("mcdonald"))
    return `https://www.mcdonalds.com/us/en-us/offers.html`;

  return existingUrl; // fallback to original
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

// Hot score: higher % off = higher score; free = top score
function calcHotScore(title = "", discount = "") {
  if (/\bfree\b/i.test(title)) return 100;
  const m = (discount || title).match(/(\d+)%/);
  if (m) return parseInt(m[1]);
  if (/penny|\.01|0\.01/.test(title)) return 95;
  return 0;
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

// Best-effort image extraction from every possible RSS field
function extractImage(item) {
  // 1. Direct enclosure image
  if (item.enclosure?.url?.match(/\.(jpg|jpeg|png|webp|gif)/i)) return item.enclosure.url;
  // 2. Media content
  if (item["media:content"]?.["$"]?.url) return item["media:content"]["$"].url;
  if (item["media:content"]?.url) return item["media:content"].url;
  // 3. Media thumbnail
  if (item["media:thumbnail"]?.["$"]?.url) return item["media:thumbnail"]["$"].url;
  // 4. First <img> in content
  const html = item["content:encoded"] || item.content || item.summary || "";
  const m = html.match(/<img[^>]+src=["']([^"']+)["']/i);
  if (m && m[1].startsWith("http")) return m[1];
  // 5. og:image or similar in content
  const og = html.match(/property=["']og:image["'][^>]+content=["']([^"']+)["']/i);
  if (og) return og[1];
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
    image_url:   deal.image_url   || null,
    source:      deal.source,
    category:    deal.category,
    store:       deal.store,
    price:       deal.price       || null,
    discount:    deal.discount    || null,
    hot_score:   deal.hot_score   || 0,
    posted_at:   deal.posted_at   || new Date().toISOString(),
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
        if (shouldSkip(title)) continue; // skip books etc.

        const rawUrl           = item.link || item.guid || "";
        const cleanUrl         = extractDirectUrl(rawUrl, title);
        const finalUrl         = guessRetailerUrl(title, cleanUrl);
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

  console.log(`  ✅ Done — ${total} new deals saved\n`);
}

fetchAndSave();
// Run once per day at 6 AM
cron.schedule("0 6 * * *", fetchAndSave);
