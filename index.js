const { Client, GatewayIntentBits } = require("discord.js");
const { createClient } = require("@supabase/supabase-js");

// Your credentials (will be set as environment variables)
const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;
const DEALS_CHANNEL_NAME = "deals"; // Change this to your channel name

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

client.once("ready", () => {
  console.log(`Bot is online as ${client.user.tag}`);
});

client.on("messageCreate", async (message) => {
  // Ignore bots and messages outside the deals channel
  if (message.author.bot) return;
  if (message.channel.name !== DEALS_CHANNEL_NAME) return;

  // Get the first image attachment if any
  const imageUrl =
    message.attachments.size > 0
      ? message.attachments.first().url
      : null;

  // Build the link back to the Discord message
  const discordLink = `https://discord.com/channels/${message.guild.id}/${message.channel.id}/${message.id}`;

  // Save to Supabase
  const { error } = await supabase.from("deals").insert({
    title: message.content.split("\n")[0].slice(0, 100), // First line as title
    description: message.content,
    author: message.author.username,
    image_url: imageUrl,
    discord_link: discordLink,
    posted_at: new Date().toISOString(),
    is_hot: false,
  });

  if (error) {
    console.error("Error saving deal:", error.message);
  } else {
    console.log(`Saved deal from ${message.author.username}`);
  }
});

client.login(DISCORD_TOKEN);
