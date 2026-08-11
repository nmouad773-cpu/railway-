const http = require("http");
const { spawn } = require("child_process");

const PORT = process.env.PORT || 8080;

// ============================================================
// CHANNELS
// ============================================================

const CHANNELS = {
  "bein-news":
    "http://pro.netmos.ovh:7355/live/UDJPRCRA1L055B/Ep27yiiwbb56mjkl/166015.ts",

  "bein1":
    "http://pro.netmos.ovh:7355/live/UDJPRCRA1L055B/Ep27yiiwbb56mjkl/233874.ts",

  "bein2":
    "http://pro.netmos.ovh:7355/live/UDJPRCRA1L055B/Ep27yiiwbb56mjkl/233875.ts",

  "bein3":
    "http://pro.netmos.ovh:7355/live/UDJPRCRA1L055B/Ep27yiiwbb56mjkl/233876.ts",

  "bein4":
    "http://pro.netmos.ovh:7355/live/UDJPRCRA1L055B/Ep27yiiwbb56mjkl/233877.ts",

  "bein5":
    "http://pro.netmos.ovh:7355/live/UDJPRCRA1L055B/Ep27yiiwbb56mjkl/233878.ts",

  "bein6":
    "http://pro.netmos.ovh:7355/live/UDJPRCRA1L055B/Ep27yiiwbb56mjkl/233879.ts",

  "bein7":
    "http://pro.netmos.ovh:7355/live/UDJPRCRA1L055B/Ep27yiiwbb56mjkl/233880.ts",

  "bein8":
    "http://pro.netmos.ovh:7355/live/UDJPRCRA1L055B/Ep27yiiwbb56mjkl/233881.ts",

  "bein-movies-1":
    "http://pro.netmos.ovh:7355/live/UDJPRCRA1L055B/Ep27yiiwbb56mjkl/10148.ts",

  "bein-movies-2":
    "http://pro.netmos.ovh:7355/live/UDJPRCRA1L055B/Ep27yiiwbb56mjkl/10150.ts",

  "al-thamnia-1":
    "http://pro.netmos.ovh:7355/live/UDJPRCRA1L055B/Ep27yiiwbb56mjkl/181611.ts",

  "al-thamnia-2":
    "http://pro.netmos.ovh:7355/live/UDJPRCRA1L055B/Ep27yiiwbb56mjkl/181612.ts",

  "al-thamnia-3":
    "http://pro.netmos.ovh:7355/live/UDJPRCRA1L055B/Ep27yiiwbb56mjkl/181684.ts",

  "mbc2":
    "http://pro.netmos.ovh:7355/live/UDJPRCRA1L055B/Ep27yiiwbb56mjkl/723.ts",

  "mbc3":
    "http://pro.netmos.ovh:7355/live/UDJPRCRA1L055B/Ep27yiiwbb56mjkl/41070.ts",

  "mbc4":
    "http://pro.netmos.ovh:7355/live/UDJPRCRA1L055B/Ep27yiiwbb56mjkl/719.ts",

  "mbc5":
    "http://pro.netmos.ovh:7355/live/UDJPRCRA1L055B/Ep27yiiwbb56mjkl/220110.ts",

  "al-aoula":
    "http://pro.netmos.ovh:7355/live/UDJPRCRA1L055B/Ep27yiiwbb56mjkl/1102.ts",

  "2m-maroc":
    "http://pro.netmos.ovh:7355/live/UDJPRCRA1L055B/Ep27yiiwbb56mjkl/166512.ts",

  "arryadia-hd":
    "http://pro.netmos.ovh:7355/live/UDJPRCRA1L055B/Ep27yiiwbb56mjkl/187244.ts",

  "quran":
    "http://pro.netmos.ovh:7355/live/UDJPRCRA1L055B/Ep27yiiwbb56mjkl/66506.ts",

  "national-geographic":
    "http://pro.netmos.ovh:7355/live/UDJPRCRA1L055B/Ep27yiiwbb56mjkl/736.ts"
};

// ============================================================
// ACTIVE FFMPEG PROCESSES
// ============================================================

const active = new Map();

function startRelay(name, source) {
  if (active.has(name)) {
    const existing = active.get(name);

    if (existing && existing.ffmpeg && !existing.ffmpeg.killed) {
      return existing;
    }

    active.delete(name);
  }

  console.log(`[${name}] 🚀 Starting relay`);

  const ffmpeg = spawn("ffmpeg", [
    "-hide_banner",
    "-loglevel", "warning",

    // Live source
    "-re",

    // Reconnection
    "-reconnect", "1",
    "-reconnect_streamed", "1",
    "-reconnect_delay_max", "5",

    // Timeout
    "-rw_timeout", "30000000",

    // Input
    "-i", source,

    // Select first video/audio
    "-map", "0:v:0",
    "-map", "0:a:0?",

    // No re-encoding
    "-c", "copy",

    // MPEG-TS output
    "-f", "mpegts",

    "pipe:1"
  ], {
    stdio: ["ignore", "pipe", "pipe"]
  });

  const clients = new Set();

  const relay = {
    ffmpeg,
    clients
  };

  active.set(name, relay);

  // ==========================================================
  // FFMPEG LOGS
  // ==========================================================

  ffmpeg.stderr.on("data", data => {
    const msg = data.toString().trim();

    if (msg) {
      console.log(`[${name}] ${msg}`);
    }
  });

  // ==========================================================
  // FFMPEG EXIT
  // ==========================================================

  ffmpeg.on("exit", (code, signal) => {
    console.log(
      `[${name}] ⚠️ FFmpeg stopped: code=${code}, signal=${signal}`
    );

    active.delete(name);

    // Close connected clients
    for (const client of clients) {
      try {
        client.end();
      } catch {}
    }

    clients.clear();

    // Auto restart after 3 seconds
    setTimeout(() => {
      console.log(`[${name}] 🔄 Restarting relay...`);
      startRelay(name, source);
    }, 3000);
  });

  ffmpeg.on("error", err => {
    console.log(`[${name}] ❌ FFmpeg error: ${err.message}`);
  });

  return relay;
}

// ============================================================
// HTTP SERVER
// ============================================================

const server = http.createServer((req, res) => {

  const channel = req.url
    .split("?")[0]
    .replace(/^\/+/, "");

  // ----------------------------------------------------------
  // Channel not found
  // ----------------------------------------------------------

  if (!CHANNELS[channel]) {
    res.writeHead(404, {
      "Content-Type": "text/plain"
    });

    return res.end("Channel not found");
  }

  // ----------------------------------------------------------
  // Start / get relay
  // ----------------------------------------------------------

  const relay = startRelay(
    channel,
    CHANNELS[channel]
  );

  const ffmpeg = relay.ffmpeg;

  // ----------------------------------------------------------
  // Response headers
  // ----------------------------------------------------------

  res.writeHead(200, {
    "Content-Type": "video/mp2t",
    "Cache-Control": "no-cache, no-store, must-revalidate",
    "Pragma": "no-cache",
    "Connection": "keep-alive",
    "Transfer-Encoding": "chunked",
    "Access-Control-Allow-Origin": "*"
  });

  console.log(
    `[${channel}] 👤 Client connected`
  );

  // Add client
  relay.clients.add(res);

  // Pipe FFmpeg output
  ffmpeg.stdout.pipe(res);

  // ----------------------------------------------------------
  // Client disconnect
  // ----------------------------------------------------------

  req.on("close", () => {

    try {
      ffmpeg.stdout.unpipe(res);
    } catch {}

    relay.clients.delete(res);

    console.log(
      `[${channel}] 👋 Client disconnected`
    );

    /*
     * IMPORTANT:
     * FFmpeg stays running even when the client disconnects.
     * This keeps the channel alive and avoids restarting
     * the source every time a client reconnects.
     */
  });

  res.on("error", () => {
    try {
      ffmpeg.stdout.unpipe(res);
    } catch {}

    relay.clients.delete(res);
  });
});

// ============================================================
// SERVER START
// ============================================================

server.listen(PORT, "0.0.0.0", () => {

  console.log("");
  console.log("==========================================");
  console.log("           DRAGON LIVE RELAY");
  console.log("==========================================");
  console.log(`Port: ${PORT}`);
  console.log(`Channels: ${Object.keys(CHANNELS).length}`);
  console.log("Mode: COPY / NO ENCODING");
  console.log("Auto reconnect: ENABLED");
  console.log("Auto restart: ENABLED");
  console.log("==========================================");
  console.log("");
});

// ============================================================
// GRACEFUL SHUTDOWN
// ============================================================

function shutdown() {

  console.log("");
  console.log("🛑 Shutting down...");

  for (const [name, relay] of active) {

    console.log(`[${name}] Stopping FFmpeg...`);

    try {
      relay.ffmpeg.kill("SIGTERM");
    } catch {}
  }

  server.close(() => {
    console.log("Server stopped.");
    process.exit(0);
  });
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
