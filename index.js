const Parser = require("rss-parser");
const { createClient } = require("@supabase/supabase-js");
const cron = require("node-cron");

const parser = new Parser({
  headers: { "User-Agent": "Mozilla/5.0 (compatible; DealsFetcher/1.0)" },
  timeout: 10000,
});

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

// ── All RSS feeds ────────────────────────────────────────────────────────────
const FEEDS = [
  { url: "https://www.reddit.com/r/deals/.rss",               source: "reddit"      },
  { url: "https://www.reddit.com/r/frugal/.rss",              source: "reddit"      },
  { url: "https://www.reddit.com/r/buildapcsales/.rss",       source: "reddit"      },
  { url: "https://www.reddit.com/r/GameDeals/.rss",           source: "reddit"      },
  { url: "https://feeds.feedburner.com/SlickdealsnetUP",      source: "slickdeals"  },
  { url: "https://www.dealnews.com/all.rss",                  source: "dealnews"    },
  { url: "https://bensbargains.net/rss.xml/0",                source: "bensbargains"},
  { url: "https://www.spoofee.com/rss.php",                   source: "spoofee"     },
  { url: "https://www.dealsofamerica.com/arss.xml",           source: "dealsofamerica"},
];

// ── Detect retailer from title / URL ────────────────────────────────────────
function detectStore(title = "", url = "") {
  const text = (title + " " + url).toLowerCase();
  if (text.includes("amazon"))    return "Amazon";
  if (text.includes("walmart"))   return "Walmart";
  if (text.includes("target"))    return "Target";
  if (text.includes("best buy") || text.includes("bestbuy")) return "Best Buy";
  if (text.includes("costco"))    return "Costco";
  if (text.includes("ebay"))      return "eBay";
  if (text.includes("nike"))      return "Nike";
  if (text.includes("adidas"))    return "Adidas";
  if (text.includes("newegg"))    return "Newegg";
  if (text.includes("chewy"))     return "Chewy";
  if (text.includes("home depot") || text.includes("homedepot")) return "Home Depot";
  if (text.includes("lowes") || text.includes("lowe's")) return "Lowe's";
  if (text.includes("kohls") || text.includes("kohl's")) return "Kohl's";
  if (text.includes("nordstrom")) return "Nordstrom";
  return "Other";
}

// ── Detect category from title ───────────────────────────────────────────────
function detectCategory(title = "") {
  const t = title.toLowerCase();
  if (/laptop|phone|tv |television|monitor|headphone|speaker|tablet|ipad|iphone|samsung|gpu|cpu|keyboard|mouse|router/.test(t)) return "Electronics";
  if (/shirt|pants|shoes|jacket|dress|sneaker|hoodie|jeans|boots|clothing|apparel|fashion/.test(t)) return "Fashion";
  if (/pizza|food|restaurant|grocery|meal|coffee|snack|drink|beer|wine/.test(t)) return "Food & Drink";
  if (/game|gaming|xbox|playstation|nintendo|steam|ps5|ps4/.test(t)) return "Gaming";
  if (/hotel|flight|travel|vacation|airbnb|cruise|airline/.test(t)) return "Travel";
  if (/tool|drill|furniture|mattress|kitchen|appliance|garden|vacuum/.test(t)) return "Home";
  if (/book|kindle|audible|movie|music|streaming/.test(t)) return "Entertainment";
  if (/toy|lego|kids|children|baby/.test(t)) return "Toys & Kids";
  return "General";
}

// ── Extract price info from title (e.g. "$49.99" or "50% off") ───────────────
function extractPrice(title = "") {
  const priceMatch = title.match(/\$[\d,]+(?:\.\d{2})?/g);
  const discountMatch = title.match(/(\d+)%\s*off/i);
  return {
    price: priceMatch ? priceMatch[priceMatch.length - 1] : null,
    discount: discountMatch ? discountMatch[1] + "% off" : null,
  };
}

// ── Extract first image from RSS item ────────────────────────────────────────
function extractImage(item) {
  if (item.enclosure?.url) return item.enclosure.url;
  if (item["media:content"]?.["$"]?.url) return item["media:content"]["$"].url;
  const match = (item.content || item["content:encoded"] || "").match(/<img[^>]+src="([^"]+)"/i);
  return match ? match[1] : null;
}

// ── Main fetch loop ──────────────────────────────────────────────────────────
async function fetchAndSave() {
  console.log(`[${new Date().toISOString()}] Starting deal fetch...`);
  let saved = 0, skipped = 0;

  for (const feed of FEEDS) {
    try {
      const result = await parser.parseURL(feed.url);
      console.log(`  ${feed.source}: ${result.items.length} items`);

      for (const item of result.items.slice(0, 25)) {
        const url = item.link || item.guid || "";
        if (!url) continue;

        // Skip duplicates
        const { data: existing } = await supabase
          .from("deals")
          .select("id")
          .eq("url", url)
          .limit(1);
        if (existing?.length > 0) { skipped++; continue; }

        const title = (item.title || "").trim().slice(0, 250);
        const { price, discount } = extractPrice(title);

        await supabase.from("deals").insert({
          title,
          description: (item.contentSnippet || "").slice(0, 800),
          url,
          image_url:   extractImage(item),
          source:      feed.source,
          store:       detectStore(title, url),
          category:    detectCategory(title),
          price,
          discount,
          posted_at:   item.pubDate ? new Date(item.pubDate).toISOString() : new Date().toISOString(),
          is_approved: true,
        });
        saved++;
      }
    } catch (err) {
      console.error(`  Error on ${feed.source}: ${err.message}`);
    }
  }

  console.log(`  Done — ${saved} saved, ${skipped} skipped (duplicates)`);
}

fetchAndSave();
cron.schedule("0 * * * *", fetchAndSave); // Run every hour
