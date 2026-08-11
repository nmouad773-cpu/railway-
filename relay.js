const http = require("http");
const { spawn } = require("child_process");

const PORT = process.env.PORT || 8080;

// ============================================================
// CHANNELS CONFIGURATION
// ============================================================

const CHANNELS = {
  "bein-news": "http://pro.netmos.ovh:7355/live/UDJPRCRA1L055B/Ep27yiiwbb56mjkl/166015.ts",
  "bein1": "http://pro.netmos.ovh:7355/live/UDJPRCRA1L055B/Ep27yiiwbb56mjkl/233874.ts",
  "bein2": "http://pro.netmos.ovh:7355/live/UDJPRCRA1L055B/Ep27yiiwbb56mjkl/233875.ts",
  "bein3": "http://pro.netmos.ovh:7355/live/UDJPRCRA1L055B/Ep27yiiwbb56mjkl/233876.ts",
  "bein4": "http://pro.netmos.ovh:7355/live/UDJPRCRA1L055B/Ep27yiiwbb56mjkl/233877.ts",
  "bein5": "http://pro.netmos.ovh:7355/live/UDJPRCRA1L055B/Ep27yiiwbb56mjkl/233878.ts",
  "bein6": "http://pro.netmos.ovh:7355/live/UDJPRCRA1L055B/Ep27yiiwbb56mjkl/233879.ts",
  "bein7": "http://pro.netmos.ovh:7355/live/UDJPRCRA1L055B/Ep27yiiwbb56mjkl/233880.ts",
  "bein8": "http://pro.netmos.ovh:7355/live/UDJPRCRA1L055B/Ep27yiiwbb56mjkl/233881.ts",
  "bein-movies-1": "http://pro.netmos.ovh:7355/live/UDJPRCRA1L055B/Ep27yiiwbb56mjkl/10148.ts",
  "bein-movies-2": "http://pro.netmos.ovh:7355/live/UDJPRCRA1L055B/Ep27yiiwbb56mjkl/10150.ts",
  "al-thamnia-1": "http://pro.netmos.ovh:7355/live/UDJPRCRA1L055B/Ep27yiiwbb56mjkl/181611.ts",
  "al-thamnia-2": "http://pro.netmos.ovh:7355/live/UDJPRCRA1L055B/Ep27yiiwbb56mjkl/181612.ts",
  "al-thamnia-3": "http://pro.netmos.ovh:7355/live/UDJPRCRA1L055B/Ep27yiiwbb56mjkl/181684.ts",
  "mbc2": "http://pro.netmos.ovh:7355/live/UDJPRCRA1L055B/Ep27yiiwbb56mjkl/723.ts",
  "mbc3": "http://pro.netmos.ovh:7355/live/UDJPRCRA1L055B/Ep27yiiwbb56mjkl/41070.ts",
  "mbc4": "http://pro.netmos.ovh:7355/live/UDJPRCRA1L055B/Ep27yiiwbb56mjkl/719.ts",
  "mbc5": "http://pro.netmos.ovh:7355/live/UDJPRCRA1L055B/Ep27yiiwbb56mjkl/220110.ts",
  "al-aoula": "http://pro.netmos.ovh:7355/live/UDJPRCRA1L055B/Ep27yiiwbb56mjkl/1102.ts",
  "2m-maroc": "http://pro.netmos.ovh:7355/live/UDJPRCRA1L055B/Ep27yiiwbb56mjkl/166512.ts",
  "arryadia-hd": "http://pro.netmos.ovh:7355/live/UDJPRCRA1L055B/Ep27yiiwbb56mjkl/187244.ts",
  "quran": "http://pro.netmos.ovh:7355/live/UDJPRCRA1L055B/Ep27yiiwbb56mjkl/66506.ts",
  "national-geographic": "http://pro.netmos.ovh:7355/live/UDJPRCRA1L055B/Ep27yiiwbb56mjkl/736.ts"
};

// Map to store active channel relay instances
const activeRelays = new Map();

// ============================================================
// RELAY ENGINE
// ============================================================

function getOrCreateRelay(name, source) {
  let relay = activeRelays.get(name);

  if (relay && relay.ffmpeg && !relay.ffmpeg.killed) {
    if (relay.idleTimer) {
      clearTimeout(relay.idleTimer);
      relay.idleTimer = null;
    }
    return relay;
  }

  console.log(`[${name}] 🚀 Starting FFmpeg engine for IPTV source...`);

  const ffmpegArgs = [
    "-hide_banner",
    "-loglevel", "warning",

    // User-Agent to bypass IPTV server blocking
    "-user_agent", "VLC/3.0.18",

    // Input Flags for Stream Stability & Robust Probing
    "-fflags", "+genpts+discardcorrupt+nobuffer",
    "-probesize", "5000000",        // 5 MB
    "-analyzeduration", "5000000",  // 5 seconds
    "-reconnect", "1",
    "-reconnect_streamed", "1",
    "-reconnect_at_eof", "1",
    "-reconnect_delay_max", "5",
    "-rw_timeout", "15000000",      // 15s timeout

    "-i", source,

    // Stream Selection
    "-map", "0:v:0?",
    "-map", "0:a:0?",

    // Direct Copy Mode
    "-c", "copy",

    // Output MPEG-TS stream to stdout
    "-f", "mpegts",
    "-mpegts_flags", "+initial_discontinuity",
    "pipe:1"
  ];

  const ffmpeg = spawn("ffmpeg", ffmpegArgs, {
    stdio: ["ignore", "pipe", "pipe"]
  });

  relay = {
    ffmpeg,
    clients: new Set(),
    idleTimer: null
  };

  activeRelays.set(name, relay);

  // Broadcast FFmpeg data to all connected HTTP clients
  ffmpeg.stdout.on("data", (chunk) => {
    for (const clientRes of relay.clients) {
      if (!clientRes.writableEnded) {
        clientRes.write(chunk, (err) => {
          if (err) {
            relay.clients.delete(clientRes);
          }
        });
      }
    }
  });

  // Log FFmpeg errors/warnings
  ffmpeg.stderr.on("data", (data) => {
    const msg = data.toString().trim();
    if (msg) {
      console.log(`[${name}] [FFmpeg Log] ${msg}`);
    }
  });

  // Handle FFmpeg Process Exit
  ffmpeg.on("exit", (code, signal) => {
    console.log(`[${name}] ⚠️ FFmpeg exited with code=${code}, signal=${signal}`);
    
    // Close remaining client connections cleanly
    for (const clientRes of relay.clients) {
      try {
        if (!clientRes.writableEnded) clientRes.end();
      } catch {}
    }
    relay.clients.clear();
    activeRelays.delete(name);
  });

  ffmpeg.on("error", (err) => {
    console.log(`[${name}] ❌ FFmpeg Process Error: ${err.message}`);
  });

  return relay;
}

function scheduleIdleCleanup(name) {
  const relay = activeRelays.get(name);
  if (!relay) return;

  if (relay.clients.size === 0) {
    console.log(`[${name}] ⏳ No active clients. Scheduling cleanup in 15 seconds...`);
    
    relay.idleTimer = setTimeout(() => {
      if (relay.clients.size === 0 && relay.ffmpeg && !relay.ffmpeg.killed) {
        console.log(`[${name}] 🛑 Stopping idle FFmpeg process to save server resources.`);
        relay.ffmpeg.kill("SIGTERM");
        activeRelays.delete(name);
      }
    }, 15000);
  }
}

// ============================================================
// HTTP SERVER
// ============================================================

const server = http.createServer((req, res) => {
  const channelName = req.url.split("?")[0].replace(/^\/+/, "");

  // Health Check Endpoint for Railway
  if (channelName === "" || channelName === "health") {
    res.writeHead(200, { "Content-Type": "text/plain" });
    return res.end("Dragon Live Relay Active");
  }

  // Handle 404
  if (!CHANNELS[channelName]) {
    res.writeHead(404, { "Content-Type": "text/plain" });
    return res.end("Channel not found");
  }

  // Handle HEAD requests (curl -I / Health Check) instantly without spawning FFmpeg
  if (req.method === "HEAD") {
    res.writeHead(200, {
      "Content-Type": "video/mp2t",
      "Cache-Control": "no-cache, no-store, must-revalidate",
      "Access-Control-Allow-Origin": "*"
    });
    return res.end();
  }

  // Get or Create FFmpeg Relay Instance
  const relay = getOrCreateRelay(channelName, CHANNELS[channelName]);

  // Set HTTP Headers for MPEG-TS Live Streaming
  res.writeHead(200, {
    "Content-Type": "video/mp2t",
    "Cache-Control": "no-cache, no-store, must-revalidate",
    "Pragma": "no-cache",
    "Connection": "keep-alive",
    "Access-Control-Allow-Origin": "*"
  });

  console.log(`[${channelName}] 👤 Client connected. Total clients: ${relay.clients.size + 1}`);
  relay.clients.add(res);

  // Client Disconnect Event
  req.on("close", () => {
    relay.clients.delete(res);
    console.log(`[${channelName}] 👋 Client disconnected. Remaining: ${relay.clients.size}`);
    
    // Check if process should be stopped after idle
    scheduleIdleCleanup(channelName);
  });

  res.on("error", () => {
    relay.clients.delete(res);
    scheduleIdleCleanup(channelName);
  });
});

// ============================================================
// SERVER START
// ============================================================

server.listen(PORT, "0.0.0.0", () => {
  console.log("");
  console.log("==========================================");
  console.log("           DRAGON LIVE RELAY v2.0         ");
  console.log("==========================================");
  console.log(`Port: ${PORT}`);
  console.log(`Channels Configured: ${Object.keys(CHANNELS).length}`);
  console.log("Mode: Direct Stream Copy (No Encoding)");
  console.log("Broadcaster: Safe Fan-Out Engine");
  console.log("==========================================");
  console.log("");
});

// Graceful Shutdown
function shutdown() {
  console.log("\n🛑 Stopping server & killing active streams...");
  for (const [name, relay] of activeRelays) {
    try {
      if (relay.ffmpeg && !relay.ffmpeg.killed) {
        relay.ffmpeg.kill("SIGTERM");
      }
    } catch {}
  }
  server.close(() => {
    console.log("Server shut down cleanly.");
    process.exit(0);
  });
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
