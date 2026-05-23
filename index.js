const Parser = require("rss-parser");
const { createClient } = require("@supabase/supabase-js");
const cron = require("node-cron");

const parser = new Parser({
  headers: {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Accept": "application/rss+xml, application/xml, text/xml, */*",
  },
  timeout: 15000,
});

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

// ─────────────────────────────────────────────────────────────────────────────
// RSS FEEDS ONLY
// Reddit removed — Railway's server IP is blocked by Reddit (HTTP 403).
// DealNews category/clearance URLs removed — they return 404.
// All feeds below are confirmed working.
// ─────────────────────────────────────────────────────────────────────────────
const RSS_FEEDS = [

  // ── General deal aggregators ──────────────────────────────────────────────
  { url: "https://www.dealnews.com/all.rss",
    source: "dealnews",     label: "DealNews"            },

  { url: "https://slickdeals.net/newsearch.php?mode=frontpage&searcharea=deals&searchin=first&rss=1",
    source: "slickdeals",   label: "Slickdeals"          },

  { url: "https://bensbargains.net/rss.xml/0",
    source: "bensbargains", label: "Ben's Bargains"      },

  { url: "https://www.spoofee.com/rss.php",
    source: "spoofee",      label: "Spoofee"             },

  // ── Amazon price drops ────────────────────────────────────────────────────
  { url: "https://camelcamelcamel.com/top_drops/feed",
    source: "amazon",       label: "CamelCamelCamel Drops"   },

  { url: "https://camelcamelcamel.com/popular/feed",
    source: "amazon",       label: "CamelCamelCamel Popular" },

  // ── Human-curated deal blogs ──────────────────────────────────────────────
  { url: "https://hip2save.com/feed/",
    source: "hip2save",     label: "Hip2Save"            },

  { url: "https://thekrazycouponlady.com/feed/",
    source: "couponlady",   label: "Krazy Coupon Lady"   },

  { url: "https://www.bradsdeals.com/feed",
    source: "bradsdeals",   label: "Brad's Deals"        },

  { url: "https://freebieshark.com/feed/",
    source: "freebieshark", label: "Freebie Shark"       },

  { url: "https://www.gottadeal.com/feed",
    source: "gottadeal",    label: "Gotta Deal"          },

  { url: "https://www.retailmenot.com/blog/feed/",
    source: "retailmenot",  label: "RetailMeNot"         },
];

// ─────────────────────────────────────────────────────────────────────────────
// STORE DETECTION
// ─────────────────────────────────────────────────────────────────────────────
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
  if (t.includes("amazon"))                                return "Amazon";
  if (t.includes("best buy") || t.includes("bestbuy"))     return "Best Buy";
  if (t.includes("target"))                                return "Target";
  if (t.includes("walmart"))                               return "Walmart";
  if (t.includes("costco"))                                return "Costco";
  if (t.includes("ebay"))                                  return "eBay";
  if (t.includes("newegg"))                                return "Newegg";
  if (t.includes("dollar tree"))                           return "Dollar Tree";
  if (t.includes("aldi"))                                  return "Aldi";
  if (t.includes("kroger"))                                return "Kroger";
  if (t.includes("nike"))                                  return "Nike";
  if (t.includes("adidas"))                                return "Adidas";
  return "Other";
}

// ─────────────────────────────────────────────────────────────────────────────
// CATEGORY DETECTION
// ─────────────────────────────────────────────────────────────────────────────
function detectCategory(title = "") {
  const t = title.toLowerCase();
  if (/home depot|menard|lowe'?s|lowes|tool|drill|lumber|hardware|garden|appliance|plumbing|flooring|power saw|leaf blower/.test(t))
    return "home";
  if (/old navy|\bgap\b|kohl'?s|shirt|pants|jeans|jacket|hoodie|dress|shoes|sneaker|apparel|clothing|fashion|shorts|sweater/.test(t))
    return "clothing";
  if (/chick.fil|starbucks|mcdonald|dunkin|subway|domino|pizza|coffee|burger|fast.?food|free (sandwich|drink|meal|coffee)/.test(t))
    return "food";
  if (/amazon|best buy|laptop|phone|\btv\b|monitor|headphone|tablet|ipad|iphone|samsung|gpu|console|gaming|airpod|router/.test(t))
    return "electronics";
  return "general";
}

// ─────────────────────────────────────────────────────────────────────────────
// PRICE & DISCOUNT EXTRACTION
// ─────────────────────────────────────────────────────────────────────────────
function extractPrice(title = "") {
  const isFree   = /\bfree\b/i.test(title);
  const prices   = title.replace(/,/g, "").match(/\$[\d]+(?:\.\d{2})?/g);
  const discount = title.match(/(\d+)%\s*off/i);
  return {
    price:    isFree ? "FREE" : (prices ? prices[prices.length - 1] : null),
    discount: discount ? discount[1] + "% off" : (isFree ? "100% off" : null),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// IMAGE EXTRACTION
// ─────────────────────────────────────────────────────────────────────────────
function extractImage(item) {
  if (item.enclosure?.url?.match(/\.(jpg|jpeg|png|webp|gif)/i)) return item.enclosure.url;
  if (item["media:content"]?.["$"]?.url) return item["media:content"]["$"].url;
  const m = (item.content || item["content:encoded"] || "").match(/<img[^>]+src="([^"]+)"/i);
  return m ? m[1] : null;
}

// ─────────────────────────────────────────────────────────────────────────────
// SAVE TO SUPABASE — deduplicates by URL
// ─────────────────────────────────────────────────────────────────────────────
async function saveDeal(deal) {
  if (!deal.url || !deal.title || deal.title.length < 5) return false;

  const { data: existing } = await supabase
    .from("deals").select("id").eq("url", deal.url).limit(1);
  if (existing?.length > 0) return false;

  const { error } = await supabase.from("deals").insert({
    title:       deal.title.slice(0, 250),
    description: (deal.description || "").slice(0, 600),
    url:         deal.url,
    image_url:   deal.image_url || null,
    source:      deal.source,
    category:    deal.category,
    store:       deal.store,
    price:       deal.price  || null,
    discount:    deal.discount || null,
    posted_at:   deal.posted_at || new Date().toISOString(),
    is_approved: true,
  });

  if (error) { console.error("    DB error:", error.message); return false; }
  return true;
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN FETCH LOOP
// ─────────────────────────────────────────────────────────────────────────────
async function fetchAndSave() {
  console.log(`\n[${new Date().toISOString()}] ── Starting fetch ──`);
  let totalSaved = 0;

  for (const feed of RSS_FEEDS) {
    try {
      const result = await parser.parseURL(feed.url);
      let newCount = 0;

      for (const item of result.items.slice(0, 25)) {
        const title = (item.title || "").trim();
        const url   = item.link || item.guid || "";
        const { price, discount } = extractPrice(title);

        const ok = await saveDeal({
          title, url,
          description: item.contentSnippet || "",
          image_url:   extractImage(item),
          source:      feed.source,
          category:    detectCategory(title),
          store:       detectStore(title, url),
          price, discount,
          posted_at:   item.pubDate
            ? new Date(item.pubDate).toISOString()
            : new Date().toISOString(),
        });
        if (ok) { totalSaved++; newCount++; }
      }

      console.log(`  ✓ ${feed.label}: ${result.items.length} fetched, ${newCount} new`);
    } catch (err) {
      console.error(`  ✗ ${feed.label}: ${err.message}`);
    }
  }

  console.log(`\n  ✅ Done — ${totalSaved} new deals saved\n`);
}

// Run immediately on start, then every hour
fetchAndSave();
cron.schedule("0 * * * *", fetchAndSave);
