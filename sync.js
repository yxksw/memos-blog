const fs = require("fs");
const path = require("path");
const Slimbot = require("slimbot");
const isImageUrl = require("is-image-url");

const BOT_TOKEN = process.env.BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const POSTS_DIR = path.join(__dirname, "posts");
const STATE_FILE = path.join(__dirname, ".sync-state.json");

const slimbot = new Slimbot(BOT_TOKEN);

function parseFrontmatter(content) {
  const frontmatterRegex = /^---\s*\n([\s\S]*?)\n---\s*\n([\s\S]*)$/;
  const match = content.match(frontmatterRegex);

  if (match) {
    return {
      frontmatter: match[1],
      content: match[2].trim(),
    };
  }

  return {
    frontmatter: "",
    content: content.trim(),
  };
}

function loadState() {
  try {
    if (fs.existsSync(STATE_FILE)) {
      const data = fs.readFileSync(STATE_FILE, "utf-8");
      return JSON.parse(data);
    }
  } catch (error) {
    console.error("Error loading state:", error.message);
  }
  return {};
}

function saveState(state) {
  try {
    fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
  } catch (error) {
    console.error("Error saving state:", error.message);
  }
}

function getFileHash(filePath) {
  try {
    const content = fs.readFileSync(filePath, "utf-8");
    const crypto = require("crypto");
    return crypto.createHash("md5").update(content).digest("hex");
  } catch (error) {
    console.error(`Error reading file ${filePath}:`, error.message);
    return null;
  }
}

function getMarkdownFiles() {
  try {
    const files = fs.readdirSync(POSTS_DIR);
    return files
      .filter((file) => file.endsWith(".md"))
      .map((file) => path.join(POSTS_DIR, file));
  } catch (error) {
    console.error("Error reading posts directory:", error.message);
    return [];
  }
}

function escapeHtml(text) {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function markdownToHtml(markdown) {
  let html = markdown;

  html = escapeHtml(html);

  html = html.replace(/^###### (.*$)/gim, "<h6>$1</h6>");
  html = html.replace(/^##### (.*$)/gim, "<h5>$1</h5>");
  html = html.replace(/^#### (.*$)/gim, "<h4>$1</h4>");
  html = html.replace(/^### (.*$)/gim, "<h3>$1</h3>");
  html = html.replace(/^## (.*$)/gim, "<h2>$1</h2>");
  html = html.replace(/^# (.*$)/gim, "<h1>$1</h1>");

  html = html.replace(/\*\*(.*?)\*\*/g, "<b>$1</b>");
  html = html.replace(/\*(.*?)\*/g, "<i>$1</i>");

  html = html.replace(/`(.*?)`/g, "<code>$1</code>");

  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');

  html = html.replace(/^\> (.*$)/gim, "<blockquote>$1</blockquote>");

  html = html.replace(/^\- (.*$)/gim, "<li>$1</li>");
  html = html.replace(/^\d+\. (.*$)/gim, "<li>$1</li>");

  html = html.replace(/\n/g, "<br>");

  return html;
}

async function sendToTelegram(fileName, content) {
  if (!BOT_TOKEN || !TELEGRAM_CHAT_ID) {
    console.log(
      "Telegram bot token or chat ID not set, skipping Telegram notification",
    );
    return false;
  }

  try {
    console.log(`Sending ${fileName} to Telegram...`);

    const { content: markdownContent } = parseFrontmatter(content);

    if (!markdownContent) {
      console.log(`No content to send for ${fileName}`);
      return false;
    }

    const htmlContent = markdownToHtml(markdownContent);

    const config = {
      parse_mode: "HTML",
      disable_web_page_preview: false,
      disable_notification: false,
    };

    await slimbot.sendMessage(TELEGRAM_CHAT_ID, htmlContent, config);

    const imageRegex = /(?:!\[(.*?)\]\((.*?)\))/g;
    const images = markdownContent.match(imageRegex);

    if (images && images.length > 0) {
      console.log(
        `Found ${images.length} images in ${fileName}, sending to Telegram...`,
      );

      for (const image of images) {
        const url = image.slice(image.indexOf("(") + 1, -1);
        if (isImageUrl(url)) {
          await slimbot.sendPhoto(TELEGRAM_CHAT_ID, url);
        }
      }
    }

    console.log(`Successfully sent ${fileName} to Telegram`);
    return true;
  } catch (error) {
    console.error(`Error sending ${fileName} to Telegram:`, error.message);
    return false;
  }
}

async function main() {
  if (!BOT_TOKEN) {
    console.error("ERROR: BOT_TOKEN environment variable is not set.");
    return;
  }

  if (!TELEGRAM_CHAT_ID) {
    console.error("ERROR: TELEGRAM_CHAT_ID environment variable is not set.");
    return;
  }

  try {
    const state = loadState();
    const files = getMarkdownFiles();

    if (files.length === 0) {
      console.log("No markdown files found in posts directory.");
      return;
    }

    console.log(`Found ${files.length} markdown files.`);

    let hasChanges = false;

    for (const filePath of files) {
      const fileName = path.basename(filePath);
      const currentHash = getFileHash(filePath);

      if (!currentHash) {
        continue;
      }

      const previousHash = state[fileName];

      if (previousHash !== currentHash) {
        console.log(`Detected change in ${fileName}`);

        const content = fs.readFileSync(filePath, "utf-8");
        const success = await sendToTelegram(fileName, content);

        if (success) {
          state[fileName] = currentHash;
          hasChanges = true;
        }
      } else {
        console.log(`No changes in ${fileName}`);
      }
    }

    if (hasChanges) {
      saveState(state);
      console.log("State saved successfully.");
    } else {
      console.log("No changes detected.");
    }
  } catch (error) {
    console.error("Error in main execution:", error);
  }
}

main().catch((error) => {
  console.error("Unhandled error in main execution:", error);
});
