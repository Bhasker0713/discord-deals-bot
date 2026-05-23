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
// RSS FEEDS
// Only confirmed-working URLs. DealNews category URLs (404) and Reddit RSS
// (403) have been replaced — Reddit is handled separately via JSON API below.
// ─────────────────────────────────────────────────────────────────────────────
const RSS_FEEDS = [

  // General deal aggregators
  { url: "https://www.dealnews.com/all.rss",                                                          source: "dealnews",     label: "DealNews"           },
  { url: "https://slickdeals.net/newsearch.php?mode=frontpage&searcharea=deals&searchin=first&rss=1", source: "slickdeals",   label: "Slickdeals"         },
  { url: "https://bensbargains.net/rss.xml/0",                                                        source: "bensbargains", label: "Ben's Bargains"     },
  { url: "https://www.spoofee.com/rss.php",                                                           source: "spoofee",      label: "Spoofee"            },

  // Amazon price drops (CamelCamelCamel — tracks every Amazon price cut)
  { url: "https://camelcamelcamel.com/top_drops/feed",                                               source: "amazon",       label: "CamelCamelCamel Drops"   },
  { url: "https://camelcamelcamel.com/popular/feed",                                                 source: "amazon",       label: "CamelCamelCamel Popular" },

  // Human-curated deal blogs
  { url: "https://hip2save.com/feed/",                                                               source: "hip2save",     label: "Hip2Save"           },
  { url: "https://thekrazycouponlady.com/feed/",                                                     source: "couponlady",   label: "Krazy Coupon Lady"  },
  { url: "https://www.bradsdeals.com/feed",                                                          source: "bradsdeals",   label: "Brad's Deals"       },
  { url: "https://freebieshark.com/feed/",                                                           source: "freebieshark", label: "Freebie Shark"      },

  // Penny & clearance
  { url: "https://www.dealnews.com/c104/Clearance/deals.rss",                                        source: "clearance",    label: "DealNews Clearance" },
];

// ─────────────────────────────────────────────────────────────────────────────
// REDDIT — JSON API only (RSS returns 403 from servers, JSON works fine)
// ─────────────────────────────────────────────────────────────────────────────
const REDDIT_SUBS = [

  // General & penny deals
  { sub: "deals",               category: "general",     label: "r/deals"               },
  { sub: "frugal",              category: "general",     label: "r/frugal"              },
  { sub: "extremecouponing",    category: "general",     label: "r/extremecouponing"    },
  { sub: "WalmartClearance",    category: "general",     label: "r/WalmartClearance"    },
  { sub: "TargetDeals",         category: "general",     label: "r/TargetDeals"         },
  { sub: "pennyshopper",        category: "general",     label: "r/pennyshopper"        },

  // Amazon
  { sub: "amazondeals",         category: "electronics", label: "r/amazondeals"         },
  { sub: "buildapcsales",       category: "electronics", label: "r/buildapcsales"       },
  { sub: "GameDeals",           category: "electronics", label: "r/GameDeals"           },

  // Home & Hardware
  { sub: "HomeImprovement",     category: "home",        label: "r/HomeImprovement"     },
  { sub: "DIY",                 category: "home",        label: "r/DIY"                 },

  // Clothing
  { sub: "frugalmalefashion",   category: "clothing",    label: "r/frugalmalefashion"   },
  { sub: "femalefashionadvice", category: "clothing",    label: "r/femalefashionadvice" },

  // Food & Drinks
  { sub: "FastFood",            category: "food",        label: "r/FastFood"            },
  { sub: "starbucks",           category: "food",        label: "r/starbucks"           },
  { sub: "McDonald_s",          category: "food",        label: "r/McDonalds"           },
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
// For RSS feeds: inferred from title keywords.
// For Reddit: already preset per subreddit in the array above.
// ─────────────────────────────────────────────────────────────────────────────
function detectCategory(title = "") {
  const t = title.toLowerCase();
  if (/home depot|menard|lowe'?s|lowes|tool|drill|lumber|hardware|garden|appliance|plumbing|flooring|power saw|leaf blower/.test(t)) return "home";
  if (/old navy|\bgap\b|kohl'?s|shirt|pants|jeans|jacket|hoodie|dress|shoes|sneaker|apparel|clothing|fashion|shorts|sweater/.test(t))  return "clothing";
  if (/chick.fil|starbucks|mcdonald|dunkin|subway|domino|pizza|coffee|burger|fast.?food|free (sandwich|drink|meal|coffee)/.test(t))    return "food";
  if (/amazon|best buy|laptop|phone|\btv\b|monitor|headphone|tablet|ipad|iphone|samsung|gpu|console|gaming|airpod|router/.test(t))     return "electronics";
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
// IMAGE EXTRACTION FROM RSS ITEM
// ─────────────────────────────────────────────────────────────────────────────
function extractImage(item) {
  if (item.enclosure?.url?.match(/\.(jpg|jpeg|png|webp|gif)/i)) return item.enclosure.url;
  if (item["media:content"]?.["$"]?.url) return item["media:content"]["$"].url;
  const m = (item.content || item["content:encoded"] || "").match(/<img[^>]+src="([^"]+)"/i);
  return m ? m[1] : null;
}

// ─────────────────────────────────────────────────────────────────────────────
// SAVE TO SUPABASE — skips duplicates by URL
// ─────────────────────────────────────────────────────────────────────────────
async function saveDeal(deal) {
  if (!deal.url || !deal.title || deal.title.length < 5) return false;

  const { data: existing } = await supabase
    .from("deals").select("id").eq("url", deal.url).limit(1);
  if (existing?.length > 0) return false; // already in DB

  const { error } = await supabase.from("deals").insert({
    title:       deal.title.slice(0, 250),
    description: (deal.description || "").slice(0, 600),
    url:         deal.url,
    image_url:   deal.image_url || null,
    source:      deal.source,
    category:    deal.category,
    store:       deal.store,
    price:       deal.price || null,
    discount:    deal.discount || null,
    posted_at:   deal.posted_at || new Date().toISOString(),
    is_approved: true,
  });

  if (error) { console.error("    DB error:", error.message); return false; }
  return true;
}

// ─────────────────────────────────────────────────────────────────────────────
// FETCH FROM RSS FEEDS
// ─────────────────────────────────────────────────────────────────────────────
async function fetchRSS() {
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
          posted_at:   item.pubDate ? new Date(item.pubDate).toISOString() : new Date().toISOString(),
        });
        if (ok) { totalSaved++; newCount++; }
      }
      console.log(`  ✓ ${feed.label}: ${result.items.length} fetched, ${newCount} new`);
    } catch (err) {
      console.error(`  ✗ ${feed.label}: ${err.message}`);
    }
  }
  return totalSaved;
}

// ─────────────────────────────────────────────────────────────────────────────
// FETCH FROM REDDIT (JSON API — avoids 403)
// ─────────────────────────────────────────────────────────────────────────────
async function fetchReddit() {
  let totalSaved = 0;
  for (const { sub, category, label } of REDDIT_SUBS) {
    try {
      const res = await fetch(`https://www.reddit.com/r/${sub}/hot.json?limit=25`, {
        headers: {
          "User-Agent": "SaveYourDollar/1.0 deal-aggregator",
          "Accept":     "application/json",
        },
      });
      if (!res.ok) { console.error(`  ✗ ${label}: HTTP ${res.status}`); continue; }

      const json  = await res.json();
      const posts = json?.data?.children || [];
      let newCount = 0;

      for (const { data: p } of posts) {
        if (p.stickied || p.score < 10) continue; // skip pinned & low-quality posts
        const title = (p.title || "").trim();
        const url   = p.url_overridden_by_dest || p.url || `https://reddit.com${p.permalink}`;
        const { price, discount } = extractPrice(title);

        const ok = await saveDeal({
          title, url,
          description: (p.selftext || "").slice(0, 600),
          image_url:   (p.thumbnail?.startsWith("http") ? p.thumbnail : null),
          source:      "reddit",
          category,                          // preset per subreddit — no guessing
          store:       detectStore(title, url),
          price, discount,
          posted_at:   new Date(p.created_utc * 1000).toISOString(),
        });
        if (ok) { totalSaved++; newCount++; }
      }
      console.log(`  ✓ ${label} [${category}]: ${posts.length} fetched, ${newCount} new`);
    } catch (err) {
      console.error(`  ✗ ${label}: ${err.message}`);
    }
  }
  return totalSaved;
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN
// ─────────────────────────────────────────────────────────────────────────────
async function fetchAndSave() {
  console.log(`\n[${new Date().toISOString()}] ── Starting fetch ──`);
  const rssCount    = await fetchRSS();
  const redditCount = await fetchReddit();
  console.log(`\n  ✅ Complete — ${rssCount + redditCount} new deals saved\n`);
}

// Run immediately on start, then every hour
fetchAndSave();
cron.schedule("0 * * * *", fetchAndSave);
