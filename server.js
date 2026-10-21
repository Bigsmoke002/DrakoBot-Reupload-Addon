const express = require('express');
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const { AttachmentBuilder } = require('discord.js');
const multer = require('multer');
const app = express();
const PORT = 5050; // Main dashboard port

// Set up Express
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.urlencoded({ extended: true }));

// Path to the configuration file
const configFile = path.join(__dirname, 'config.json');

// Standard configuration – including reupload, anonymous upload, Discord settings, and lockdown options
const defaultConfig = {
  reupload: {
    enabled: false,
    types: {
      links: false,
      images: false,
      gifs: false,
      files: false,
      custom: ""
    },
    spamProtection: {
      enabled: true,
      interval: 10
    },
    includeUploaderTag: true,
    maxFileSizeMB: 8
  },
  anonymousUpload: {
    enabled: false,
    manualApproval: true,
    allowedTypes: {
      images: false,
      links: false,
      files: false,
      custom: ""
    },
    maxUploadSizeMB: 10,
    uploadDirectory: "anonymous_uploads",
    postChannels: {
      images: "",
      links: "",
      files: ""
    }
  },
  discord: {
    guildId: ""
  },
  totalLockdown: false,
  partialLockdown: false
};

let config;
if (!fs.existsSync(configFile)) {
  config = defaultConfig;
  fs.writeFileSync(configFile, JSON.stringify(config, null, 2));
  console.log("Configuration file created.");
} else {
  try {
    const data = fs.readFileSync(configFile, 'utf8');
    config = JSON.parse(data);
  } catch (err) {
    console.error('Error reading configuration file, using default values.');
    config = defaultConfig;
    fs.writeFileSync(configFile, JSON.stringify(config, null, 2));
  }
}

function saveConfig() {
  fs.writeFileSync(configFile, JSON.stringify(config, null, 2));
}

// Helper: Load live configuration
function getLiveConfig() {
  try {
    const data = fs.readFileSync(configFile, 'utf8');
    return JSON.parse(data);
  } catch (err) {
    console.error("Error loading live configuration:", err);
    return {};
  }
}

// Log file for reupload and deletion events
const logFilePath = path.join(__dirname, 'reupload_log.json');

// Helper: Log events (REUPLOAD, DELETE, etc.)
function logEvent(action, details) {
  let logs = [];
  try {
    const existing = fs.readFileSync(logFilePath, 'utf8');
    logs = JSON.parse(existing);
  } catch (err) {
    logs = [];
  }
  const entry = {
    timestamp: new Date().toISOString(),
    action: action,
    ...details
  };
  logs.push(entry);
  fs.writeFileSync(logFilePath, JSON.stringify(logs, null, 2));
}

// Spam protection and duplicate processing
const reuploadCooldown = new Map(); // key: userId, value: timestamp
const processedMessages = new Set();  // key: message.id

// Assume the Discord client is available globally (e.g. global.client)
const client = global.client;

// Helper: Check if an attachment is allowed according to reupload settings
function isAllowedAttachment(attachment, allowedTypes) {
  const ext = path.extname(attachment.name).toLowerCase();
  const imageExtensions = ['.png', '.jpg', '.jpeg', '.bmp'];
  // For GIFs: check if extension is ".gif" or URL starts with "https" and ends with ".gif"
  if (allowedTypes.gifs) {
    if (ext === '.gif' || /^https.*\.gif$/i.test(attachment.url)) {
      return true;
    }
  }
  if (imageExtensions.includes(ext)) {
    return !!allowedTypes.images;
  }
  if (allowedTypes.custom) {
    const customTypes = allowedTypes.custom.split(',').map(s => s.trim().toLowerCase());
    if (customTypes.includes(ext)) return true;
  }
  return !!allowedTypes.files;
}

// Optional: Get max upload size from Discord Boost status
async function getGuildMaxUploadSize(liveConfig) {
  if (!liveConfig.discord || !liveConfig.discord.guildId) return null;
  try {
    const guild = await client.guilds.fetch(liveConfig.discord.guildId);
    let sizeMB;
    switch (guild.premiumTier) {
      case 0: sizeMB = 8; break;
      case 1: sizeMB = 50; break;
      case 2: sizeMB = 100; break;
      case 3: sizeMB = 250; break;
      default: sizeMB = 8;
    }
    return sizeMB;
  } catch (e) {
    console.error("Error fetching Guild data:", e);
    return null;
  }
}

// ----------------------
// Dashboard Routes
// ----------------------
app.get('/', async (req, res) => {
  const liveConfig = getLiveConfig();
  let maxUploadSize = await getGuildMaxUploadSize(liveConfig);
  res.render('config', { config: liveConfig, maxUploadSize });
});

app.post('/save-config', (req, res) => {
  const newConfig = {
    reupload: {
      enabled: req.body.enabled === 'on',
      types: {
        links: req.body.links === 'on',
        images: req.body.images === 'on',
        gifs: req.body.gifs === 'on',
        files: req.body.files === 'on',
        custom: req.body.custom || ""
      },
      spamProtection: {
        enabled: req.body.spamProtection === 'on',
        interval: parseInt(req.body.interval) || 10
      },
      includeUploaderTag: req.body.includeUploaderTag === 'on',
      maxFileSizeMB: parseInt(req.body.maxFileSizeMB) || 8
    },
    anonymousUpload: {
      enabled: req.body.anonEnabled === 'on',
      manualApproval: req.body.manualApproval === 'on',
      allowedTypes: {
        images: req.body.images === 'on',
        links: req.body.links === 'on',
        files: req.body.files === 'on',
        custom: req.body.custom || ""
      },
      maxUploadSizeMB: parseInt(req.body.maxUploadSizeMB) || 10,
      uploadDirectory: req.body.uploadDirectory || "anonymous_uploads",
      postChannels: {
        images: req.body.postChannelImages || "",
        links: req.body.postChannelLinks || "",
        files: req.body.postChannelFiles || ""
      }
    },
    discord: {
      guildId: req.body.discordGuildId || ""
    },
    totalLockdown: req.body.totalLockdown === 'on',
    partialLockdown: req.body.partialLockdown === 'on'
  };
  fs.writeFileSync(configFile, JSON.stringify(newConfig, null, 2));
  res.redirect('/');
});

// Route: Logs
app.get('/logs', (req, res) => {
  let logs = [];
  try {
    const data = fs.readFileSync(logFilePath, 'utf8');
    logs = JSON.parse(data);
  } catch (err) {
    logs = [];
  }
  logs.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
  res.render('logs', { logs });
});

// Route: Download Logs
app.get('/download-logs', (req, res) => {
  res.download(logFilePath, "reupload_log.json", (err) => {
    if(err) {
      console.error("Error downloading logs:", err);
      res.status(500).send("Error downloading logs.");
    }
  });
});

// ----------------------
// Pending Uploads Routes (for admin review)
// ----------------------

// Serve pending files statically for preview
app.use('/pendingFiles', express.static(path.join(__dirname, 'pendingUploads')));

// Route: Pending uploads review page
app.get('/pending-uploads', (req, res) => {
  const pendingDir = path.join(__dirname, 'pendingUploads');
  let pendingFiles = [];
  try {
    pendingFiles = fs.readdirSync(pendingDir).filter(f => f !== "pending_links.json");
  } catch (err) {
    pendingFiles = [];
  }
  const pendingLinksFile = path.join(pendingDir, 'pending_links.json');
  let pendingLinks = [];
  try {
    const data = fs.readFileSync(pendingLinksFile, 'utf8');
    pendingLinks = JSON.parse(data);
  } catch (err) {
    pendingLinks = [];
  }
  res.render('pending_uploads', { pendingFiles, pendingLinks });
});

// Route: Approve pending file (move from pendingUploads to approvedUploads, then post to Discord)
app.post('/admin/approve', (req, res) => {
  // Nur den reinen Dateinamen zulassen (verhindert Path Traversal wie ../config.json)
  const filename = req.body.filename ? path.basename(String(req.body.filename)) : '';
  if (!filename || filename === 'pending_links.json') return res.status(400).send("Invalid file.");
  if (!filename) return res.send("No file specified.");
  const pendingDir = path.join(__dirname, 'pendingUploads');
  const approvedDir = path.join(__dirname, 'approvedUploads');
  const oldPath = path.join(pendingDir, filename);
  if (!fs.existsSync(approvedDir)) fs.mkdirSync(approvedDir, { recursive: true });
  const newPath = path.join(approvedDir, filename);
  fs.rename(oldPath, newPath, (err) => {
    if (err) return res.send("Error approving file.");
    // Attempt to post the approved file to Discord:
    const liveConfig = getLiveConfig();
    const anonCfg = liveConfig.anonymousUpload;
    const channelId = anonCfg.postChannels ? anonCfg.postChannels.files : null;
    if (channelId) {
      const channel = global.client.channels.cache.get(channelId);
      if (channel) {
        channel.send({ files: [newPath] })
          .then(() => {
            res.send("File approved and successfully posted to Discord.");
          })
          .catch(err => {
            console.error("Error posting approved file to Discord:", err);
            res.send("File approved but failed to post to Discord.");
          });
      } else {
        res.send("File approved, but no valid Discord channel is configured for files.");
      }
    } else {
      res.send("File approved, but auto-approval for files is not configured.");
    }
  });
});

// Route: Reject pending file (delete it)
app.post('/admin/delete', (req, res) => {
  // Nur den reinen Dateinamen zulassen (verhindert Path Traversal wie ../config.json)
  const filename = req.body.filename ? path.basename(String(req.body.filename)) : '';
  if (!filename || filename === 'pending_links.json') return res.status(400).send("Invalid file.");
  if (!filename) return res.send("No file specified.");
  const pendingDir = path.join(__dirname, 'pendingUploads');
  const filePath = path.join(pendingDir, filename);
  fs.unlink(filePath, (err) => {
    if (err) return res.send("Error deleting file.");
    res.redirect('/pending-uploads');
  });
});

// Route: Approve pending link
app.post('/admin/approve-link', (req, res) => {
  const timestamp = req.body.timestamp;
  const pendingLinksFile = path.join(__dirname, 'pendingUploads', 'pending_links.json');
  let pendingLinks = [];
  try {
    const data = fs.readFileSync(pendingLinksFile, 'utf8');
    pendingLinks = JSON.parse(data);
  } catch (err) {
    pendingLinks = [];
  }
  const index = pendingLinks.findIndex(linkObj => linkObj.timestamp === timestamp);
  if (index !== -1) {
    const approvedLink = pendingLinks.splice(index, 1)[0];
    fs.writeFileSync(pendingLinksFile, JSON.stringify(pendingLinks, null, 2));
    const liveConfig = getLiveConfig();
    const anonCfg = liveConfig.anonymousUpload;
    const channelId = anonCfg.postChannels ? anonCfg.postChannels.links : null;
    if (channelId) {
      const channel = global.client.channels.cache.get(channelId);
      if (channel) {
        channel.send(approvedLink.link)
          .then(() => res.redirect('/pending-uploads'))
          .catch(err => {
            console.error("Error posting approved link to Discord:", err);
            res.send("Error posting link to Discord.");
          });
      } else {
        res.send("No valid Discord channel configured for links.");
      }
    } else {
      res.send("Auto-approval for links is not configured.");
    }
  } else {
    res.send("Link not found.");
  }
});

// Route: Reject pending link (delete it)
app.post('/admin/delete-link', (req, res) => {
  const timestamp = req.body.timestamp;
  const pendingLinksFile = path.join(__dirname, 'pendingUploads', 'pending_links.json');
  let pendingLinks = [];
  try {
    const data = fs.readFileSync(pendingLinksFile, 'utf8');
    pendingLinks = JSON.parse(data);
  } catch (err) {
    pendingLinks = [];
  }
  const newLinks = pendingLinks.filter(linkObj => linkObj.timestamp !== timestamp);
  fs.writeFileSync(pendingLinksFile, JSON.stringify(newLinks, null, 2));
  res.redirect('/pending-uploads');
});

// ----------------------
// Message Event: Reupload & Lockdowns
// ----------------------
client.on('messageCreate', async (message) => {
  if (message.author.bot) return;
  
  const liveConfig = getLiveConfig();
  
  // Total Lockdown: Delete every message
  if (liveConfig.totalLockdown === true) {
    try {
      await message.delete();
      logEvent("DELETE", {
        userId: message.author.id,
        userTag: message.author.tag,
        channelId: message.channel.id,
        guildId: message.guild ? message.guild.id : null,
        reason: "Total Lockdown"
      });
      console.log(`Total Lockdown: Deleted message from ${message.author.tag}`);
    } catch (e) { console.error(e); }
    return;
  }
  
  // Partial Lockdown: Delete messages with links or attachments
  if (liveConfig.partialLockdown === true) {
    const hasAttachment = message.attachments.size > 0;
    const urlRegex = /https?:\/\/[^\s]+/gi;
    const urlsInMsg = message.content.match(urlRegex) || [];
    if (hasAttachment || urlsInMsg.length > 0) {
      try {
        await message.delete();
        logEvent("DELETE", {
          userId: message.author.id,
          userTag: message.author.tag,
          channelId: message.channel.id,
          guildId: message.guild ? message.guild.id : null,
          reason: "Partial Lockdown"
        });
        console.log(`Partial Lockdown: Deleted message from ${message.author.tag} (link/attachment)`);
      } catch (e) { console.error(e); }
      return;
    }
    return; // Allow plain text messages
  }
  
  // Reupload: If reupload is disabled, do nothing.
  if (!liveConfig.reupload || liveConfig.reupload.enabled !== true) {
    console.log("Reupload is disabled.");
    return;
  }
  
  // Check that at least one reupload type is enabled.
  const allowedTypes = liveConfig.reupload.types || {};
  const atLeastOneTypeActive =
    allowedTypes.links || allowedTypes.images || allowedTypes.gifs || allowedTypes.files ||
    (allowedTypes.custom && allowedTypes.custom.trim() !== "");
  if (!atLeastOneTypeActive) {
    console.log("No reupload types enabled. Aborting processing.");
    return;
  }
  
  // Process attachments and links
  const hasAttachments = message.attachments.size > 0;
  const urlRegex2 = /https?:\/\/[^\s]+/gi;
  const urlsInMessage = message.content.match(urlRegex2) || [];
  if (!hasAttachments && urlsInMessage.length === 0) return;
  
  if (processedMessages.has(message.id)) return;
  processedMessages.add(message.id);
  
  if (liveConfig.reupload.spamProtection && liveConfig.reupload.spamProtection.enabled) {
    const cooldownAmount = liveConfig.reupload.spamProtection.interval * 1000;
    const lastUsed = reuploadCooldown.get(message.author.id) || 0;
    if (Date.now() - lastUsed < cooldownAmount) {
      try {
        await message.delete();
        logEvent("DELETE", {
          userId: message.author.id,
          userTag: message.author.tag,
          channelId: message.channel.id,
          guildId: message.guild ? message.guild.id : null,
          reason: "Spam Protection"
        });
        console.log(`Deleted message from ${message.author.tag} due to spam protection.`);
      } catch (e) { console.error(e); }
      return;
    }
    reuploadCooldown.set(message.author.id, Date.now());
  }
  
  // Create a temporary folder for downloads
  const tempFolder = path.join(__dirname, 'tempUploads');
  if (!fs.existsSync(tempFolder)) fs.mkdirSync(tempFolder, { recursive: true });
  
  let filesToUpload = [];
  let linksToUpload = [];
  
  // Process each attachment
  for (const attachment of message.attachments.values()) {
    const ext = path.extname(attachment.name).toLowerCase();
    console.log(`Processing attachment "${attachment.name}" with extension "${ext}"`);
    if (!isAllowedAttachment(attachment, allowedTypes)) {
      console.log(`Attachment ${attachment.name} is not allowed.`);
      continue;
    }
    const maxSizeBytes = (liveConfig.reupload.maxFileSizeMB || 8) * 1024 * 1024;
    if (attachment.size > maxSizeBytes) {
      console.log(`Attachment ${attachment.name} is too large (${attachment.size} > ${maxSizeBytes} bytes).`);
      continue;
    }
    const fileName = `${Date.now()}_${attachment.name}`;
    const filePath = path.join(tempFolder, fileName);
    try {
      const response = await axios({ method: 'GET', url: attachment.url, responseType: 'stream' });
      const writer = fs.createWriteStream(filePath);
      response.data.pipe(writer);
      await new Promise((resolve, reject) => {
        writer.on('finish', resolve);
        writer.on('error', reject);
      });
      filesToUpload.push(filePath);
      console.log(`Downloaded file ${fileName}`);
    } catch (err) {
      console.error(`Error downloading ${attachment.url}:`, err);
    }
  }
  
  // Process links (if allowed)
  if (allowedTypes.links) {
    for (const link of urlsInMessage) {
      linksToUpload.push(link);
      console.log(`Processing link: ${link}`);
    }
  } else {
    console.log("Links are disabled in the configuration.");
  }
  
  // If there is content to reupload, send a new message and delete the original
  if (filesToUpload.length > 0 || linksToUpload.length > 0) {
    try {
      const attachmentsToSend = filesToUpload.map(fp => new AttachmentBuilder(fp));
      const content = linksToUpload.length > 0 ? linksToUpload.join('\n') : undefined;
      const reuploadMessage = await message.channel.send({ content, files: attachmentsToSend });
      console.log(`Reupload: ${filesToUpload.length} files, ${linksToUpload.length} links.`);
      await message.delete();
      console.log(`Deleted original message from ${message.author.tag}.`);
      logEvent("REUPLOAD", {
        userTag: message.author.tag,
        userId: message.author.id,
        channelId: message.channel.id,
        reuploadMessageId: reuploadMessage.id,
        guildId: message.guild ? message.guild.id : null,
        attachmentsCount: filesToUpload.length,
        textLinks: linksToUpload
      });
    } catch (err) {
      console.error("Error during reupload:", err);
    }
  }
  
  // Clean up temporary files after 1 minute
  setTimeout(() => {
    for (const filePath of filesToUpload) {
      fs.unlink(filePath, (err) => {
        if (err) console.error(`Error deleting ${filePath}:`, err);
      });
    }
  }, 60000);
});

// Admin-WebUI hat keinen Login – standardmäßig nur lokal erreichbar
const HOST = process.env.REUPLOAD_ADMIN_HOST || '127.0.0.1';
app.listen(PORT, HOST, () => {
  console.log(`WebUI is running on http://${HOST}:${PORT}`);
});
