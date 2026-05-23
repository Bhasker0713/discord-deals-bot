const Parser = require("rss-parser");
const { createClient } = require("@supabase/supabase-js");
const cron = require("node-cron");

const parser = new Parser({
  headers: { "User-Agent": "Mozilla/5.0 (compatible; SaveYourDollar/1.0)" },
  timeout: 12000,
});

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

// ── Feeds: each tagged with the EXACT category the website uses ────────────
// Category values must match exactly: "home" | "clothing" | "food" | "electronics" | "general"
const FEEDS = [

  // HOME & HARDWARE
  { url: "https://www.dealnews.com/c142/Home-Garden/deals.rss",    source: "dealnews", category: "home" },
  { url: "https://www.reddit.com/r/HomeImprovement/.rss",          source: "reddit",   category: "home" },
  { url: "https://www.reddit.com/r/DIY/.rss",                      source: "reddit",   category: "home" },

  // CLOTHING
  { url: "https://www.dealnews.com/c4/Clothing/deals.rss",         source: "dealnews", category: "clothing" },
  { url: "https://www.reddit.com/r/frugalmalefashion/.rss",        source: "reddit",   category: "clothing" },
  { url: "https://www.reddit.com/r/femalefashionadvice/.rss",      source: "reddit",   category: "clothing" },

  // FOOD & DRINKS
  { url: "https://www.dealnews.com/c39/Food-Drink/deals.rss",      source: "dealnews", category: "food" },
  { url: "https://www.reddit.com/r/FastFood/.rss",                 source: "reddit",   category: "food" },
  { url: "https://www.reddit.com/r/starbucks/.rss",                source: "reddit",   category: "food" },

  // ELECTRONICS
  { url: "https://www.dealnews.com/c7/Electronics/deals.rss",      source: "dealnews", category: "electronics" },
  { url: "https://www.reddit.com/r/buildapcsales/.rss",            source: "reddit",   category: "electronics" },
  { url: "https://www.reddit.com/r/GameDeals/.rss",                source: "reddit",   category: "electronics" },

  // GENERAL (shows under "All deals")
  { url: "https://www.reddit.com/r/deals/.rss",                    source: "reddit",   category: "general" },
  { url: "https://www.reddit.com/r/frugal/.rss",                   source: "reddit",   category: "general" },
  { url: "https://www.dealnews.com/all.rss",                       source: "dealnews", category: "general" },
  { url: "https://bensbargains.net/rss.xml/0",                     source: "bensbargains", category: "general" },
];

// ── Detect store name from title + URL ─────────────────────────────────────
function detectStore(title = "", url = "") {
  const t = (title + " " + url).toLowerCase();
  if (t.includes("home depot") || t.includes("homedepot")) return "Home Depot";
  if (t.includes("menards"))                               return "Menards";
  if (t.includes("lowe"))                                  return "Lowe's";
  if (t.includes("old navy") || t.includes("oldnavy"))     return "Old Navy";
  if (t.includes(" gap ") || t.includes("gap.com"))        return "Gap";
  if (t.includes("kohl"))                                  return "Kohl's";
  if (t.includes("chick-fil-a") || t.includes("chickfila"))return "Chick-fil-A";
  if (t.includes("starbucks"))                             return "Starbucks";
  if (t.includes("mcdonald"))                              return "McDonald's";
  if (t.includes("amazon"))                                return "Amazon";
  if (t.includes("best buy") || t.includes("bestbuy"))     return "Best Buy";
  if (t.includes("target"))                                return "Target";
  if (t.includes("walmart"))                               return "Walmart";
  if (t.includes("costco"))                                return "Costco";
  if (t.includes("ebay"))                                  return "eBay";
  if (t.includes("newegg"))                                return "Newegg";
  return "Other";
}

// ── Extract price and discount from title ──────────────────────────────────
function extractPrice(title = "") {
  const prices   = title.replace(/,/g, "").match(/\$[\d]+(?:\.\d{2})?/g);
  const discount = title.match(/(\d+)%\s*off/i);
  return {
    price:    prices ? prices[prices.length - 1] : null,
    discount: discount ? discount[1] + "% off" : null,
  };
}

// ── Extract first image from RSS item ─────────────────────────────────────
function extractImage(item) {
  if (item.enclosure?.url) return item.enclosure.url;
  if (item["media:content"]?.["$"]?.url) return item["media:content"]["$"].url;
  const m = (item.content || item["content:encoded"] || "").match(/<img[^>]+src="([^"]+)"/i);
  return m ? m[1] : null;
}

// ── Main fetch ─────────────────────────────────────────────────────────────
async function fetchAndSave() {
  console.log(`[${new Date().toISOString()}] Fetching deals...`);
  let saved = 0, skipped = 0, errors = 0;

  for (const feed of FEEDS) {
    try {
      const result = await parser.parseURL(feed.url);
      console.log(`  ✓ ${feed.source} [${feed.category}]: ${result.items.length} items`);

      for (const item of result.items.slice(0, 20)) {
        const url = item.link || item.guid || "";
        if (!url) continue;

        // Skip duplicates
        const { data: existing } = await supabase
          .from("deals").select("id").eq("url", url).limit(1);
        if (existing?.length > 0) { skipped++; continue; }

        const title = (item.title || "").trim().slice(0, 250);
        const { price, discount } = extractPrice(title);

        const { error } = await supabase.from("deals").insert({
          title,
          description: (item.contentSnippet || "").slice(0, 600),
          url,
          image_url:   extractImage(item),
          source:      feed.source,
          category:    feed.category,        // ← pre-tagged, no guessing
          store:       detectStore(title, url),
          price,
          discount,
          posted_at:   item.pubDate ? new Date(item.pubDate).toISOString() : new Date().toISOString(),
          is_approved: true,
        });

        if (error) { console.error("    insert error:", error.message); errors++; }
        else saved++;
      }
    } catch (err) {
      console.error(`  ✗ ${feed.source} [${feed.category}]: ${err.message}`);
      errors++;
    }
  }

  console.log(`  Done — saved:${saved}  skipped:${skipped}  errors:${errors}`);
}

fetchAndSave();
cron.schedule("0 * * * *", fetchAndSave); // every hour
