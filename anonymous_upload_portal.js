const express = require('express');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const app = express();
const PORT = 6060; // Separate port for the anonymous upload portal

// Set up Express
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.urlencoded({ extended: true }));

// Path to the shared configuration file
const configFile = path.join(__dirname, 'config.json');

// Default configuration
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

// Helper: Load configuration from disk (with fallback)
function getConfig() {
  if (!fs.existsSync(configFile)) {
    fs.writeFileSync(configFile, JSON.stringify(defaultConfig, null, 2));
    console.log("Configuration file created.");
    return defaultConfig;
  }
  try {
    const data = fs.readFileSync(configFile, 'utf8');
    return JSON.parse(data);
  } catch (err) {
    console.error("Error loading configuration:", err);
    // In case of error, write and return default config
    fs.writeFileSync(configFile, JSON.stringify(defaultConfig, null, 2));
    return defaultConfig;
  }
}

// Live check middleware: If anonymous uploads are disabled, return 403 for every request.
app.use((req, res, next) => {
  const cfg = getConfig();
  if (!cfg || !cfg.anonymousUpload || cfg.anonymousUpload.enabled !== true) {
    res.status(403).send("Anonymous uploads are disabled.");
  } else {
    next();
  }
});

// Load configuration and extract anonymous upload settings
let config = getConfig();
const anonCfg = config.anonymousUpload;

// Ensure pending and approved folders exist
const pendingDir = path.join(__dirname, 'pendingUploads');
const approvedDir = path.join(__dirname, 'approvedUploads');
if (anonCfg.manualApproval) {
  if (!fs.existsSync(pendingDir)) fs.mkdirSync(pendingDir, { recursive: true });
} else {
  if (!fs.existsSync(approvedDir)) fs.mkdirSync(approvedDir, { recursive: true });
}

// Define Multer storage (used by our dynamic Multer instance)
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const cfg = getConfig();
    const anon = cfg.anonymousUpload;
    if (anon.manualApproval) {
      cb(null, pendingDir);
    } else {
      cb(null, approvedDir);
    }
  },
  filename: (req, file, cb) => {
    cb(null, Date.now() + '_' + file.originalname);
  }
});

// We'll create a dynamic Multer instance per request later.
// Helper: For UI, allow all file types.
function getAcceptedFileTypes(anonCfg) {
  return "*/*";
}

// GET route: Show the anonymous upload form
app.get('/', (req, res) => {
  const cfg = getConfig();
  const anon = (cfg && cfg.anonymousUpload) ? cfg.anonymousUpload : {};
  const acceptedTypes = getAcceptedFileTypes(anon);
  res.render('upload_anonymous', { anonCfg: anon, acceptedTypes });
});

// POST route: Process the anonymous upload
// multer().none() vorab hat jede Datei mit "Unexpected field" abgelehnt – daher ein einziger
// Multer-Durchlauf, der Link-Formulare (ohne Datei) und Datei-Uploads gleichermaßen verarbeitet
app.post('/upload', (req, res, next) => {
  {
    // Create a new Multer instance for file uploads using current config.
    const cfg = getConfig();
    const anon = (cfg && cfg.anonymousUpload) ? cfg.anonymousUpload : {};
    const dynamicUpload = multer({
      storage: storage,
      limits: { fileSize: ((anon.maxUploadSizeMB || 10) * 1024 * 1024) }
    });
    dynamicUpload.single('file')(req, res, function(err) {
      if (err) {
        if (err instanceof multer.MulterError && err.code === "LIMIT_FILE_SIZE") {
          return res.status(400).send("File too large. Maximum allowed size is " + (anon.maxUploadSizeMB || 10) + " MB.");
        }
        return next(err);
      }
      next();
    });
  }
}, (req, res) => {
  const cfg = getConfig();
  const anon = (cfg && cfg.anonymousUpload) ? cfg.anonymousUpload : {};
  const selectedCategory = req.body.uploadCategory; // "link" or "file"
  const disclaimer = req.body.disclaimer === 'on';
  if (!disclaimer) {
    return res.send("You must agree to the legal disclaimer before uploading.");
  }
  
  // Handle Link Upload
  if (selectedCategory === "link") {
    const link = req.body.linkInput;
    if (!link || !link.startsWith("https://")) {
      return res.send("Please provide a valid https link.");
    }
    if (anon.manualApproval) {
      const pendingLinksFile = path.join(pendingDir, 'pending_links.json');
      let pendingLinks = [];
      try {
        const data = fs.readFileSync(pendingLinksFile, 'utf8');
        pendingLinks = JSON.parse(data);
      } catch (err) {
        pendingLinks = [];
      }
      pendingLinks.push({
        timestamp: new Date().toISOString(),
        type: "link",
        link: link,
        category: "links"
      });
      fs.writeFileSync(pendingLinksFile, JSON.stringify(pendingLinks, null, 2));
      res.send("Upload received. An administrator must approve this upload.");
    } else {
      const currentCfg = getConfig();
      const currentAnon = currentCfg.anonymousUpload;
      const channelId = currentAnon.postChannels && currentAnon.postChannels.links;
      if (channelId) {
        const channel = global.client.channels.cache.get(channelId);
        if (channel) {
          channel.send(link)
            .then(() => res.send("Upload successfully auto-approved."))
            .catch(err => {
              console.error("Error posting to Discord:", err);
              res.send("Upload succeeded, but there was an error posting to Discord.");
            });
        } else {
          res.send("Upload succeeded, but no valid Discord channel is configured for links.");
        }
      } else {
        res.send("Upload succeeded, but auto-approval is not configured for links.");
      }
    }
  } else {
    // Handle File Upload (all file types allowed)
    if (!req.file) {
      return res.send("No file uploaded or file size exceeded.");
    }
    if (anon.manualApproval) {
      res.send("Upload received. An administrator must approve this upload.");
      cleanupFolder(pendingDir, 5 * 1024 * 1024 * 1024); // Clean up if folder > 5GB
    } else {
      const currentCfg = getConfig();
      const currentAnon = currentCfg.anonymousUpload;
      const channelId = currentAnon.postChannels && currentAnon.postChannels.files;
      if (channelId) {
        const channel = global.client.channels.cache.get(channelId);
        if (channel) {
          channel.send({ files: [req.file.path] })
            .then(() => {
              cleanupFolder(approvedDir, 5 * 1024 * 1024 * 1024); // Clean up if folder > 5GB
              res.send("Upload successfully auto-approved and posted to Discord.");
            })
            .catch(err => {
              console.error("Error posting to Discord:", err);
              res.send("Upload succeeded, but there was an error posting to Discord.");
            });
        } else {
          res.send("Upload succeeded, but no valid Discord channel is configured for files.");
        }
      } else {
        res.send("Upload succeeded, but auto-approval is not configured for files.");
      }
    }
  }
});

// Helper: Cleanup folder if total size exceeds maxSizeBytes (5GB)
function cleanupFolder(folderPath, maxSizeBytes) {
  try {
    const files = fs.readdirSync(folderPath);
    let fileStats = files.map(file => {
      const filePath = path.join(folderPath, file);
      const stats = fs.statSync(filePath);
      return { file, path: filePath, mtime: stats.mtimeMs, size: stats.size };
    }).filter(item => fs.lstatSync(item.path).isFile());
    
    let totalSize = fileStats.reduce((sum, item) => sum + item.size, 0);
    if (totalSize <= maxSizeBytes) return;
    
    fileStats.sort((a, b) => a.mtime - b.mtime);
    
    for (let i = 0; i < fileStats.length && totalSize > maxSizeBytes; i++) {
      try {
        fs.unlinkSync(fileStats[i].path);
        totalSize -= fileStats[i].size;
        console.log(`Deleted file ${fileStats[i].file} to free up space.`);
      } catch (e) {
        console.error(`Error deleting file ${fileStats[i].file}:`, e);
      }
    }
  } catch (err) {
    console.error("Error during folder cleanup:", err);
  }
}

app.listen(PORT, () => {
  console.log(`Anonymous Upload Portal is running on port ${PORT}`);
});
