const http = require("http");
const { spawn } = require("child_process");

const PORT = process.env.PORT || 9000;

// ============================================================
// CHANNELS LIST
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

// Map to store active channel state
const activeRelays = new Map();

// ============================================================
// RELAY ENGINE
// ============================================================

function getOrCreateRelay(name, source) {
  if (activeRelays.has(name)) {
    const relay = activeRelays.get(name);
    // Clear idle timeout if a new client connects
    if (relay.idleTimer) {
      clearTimeout(relay.idleTimer);
      relay.idleTimer = null;
    }
    return relay;
  }

  const relay = {
    name,
    source,
    ffmpeg: null,
    clients: new Set(),
    isRestarting: false,
    idleTimer: null
  };

  activeRelays.set(name, relay);
  startFFmpeg(relay);

  return relay;
}

function startFFmpeg(relay) {
  if (relay.ffmpeg && !relay.ffmpeg.killed) {
    return;
  }

  console.log(`[${relay.name}] 🚀 Spawning FFmpeg instance...`);

  const ffmpeg = spawn("ffmpeg", [
    "-hide_banner",
    "-loglevel", "warning",

    // Native frame rate read
    "-re",

    // Advanced HTTP Reconnection flags
    "-reconnect", "1",
    "-reconnect_at_eof", "1",
    "-reconnect_streamed", "1",
    "-reconnect_delay_max", "3",

    // Read/Write Timeout (10 seconds)
    "-rw_timeout", "10000000",

    // Lower analyze duration for faster recovery
    "-probesize", "1000000",
    "-analyzeduration", "1000000",

    // Input Source
    "-i", relay.source,

    // Map streams
    "-map", "0:v:0?",
    "-map", "0:a:0?",

    // Stream Copy Mode
    "-c", "copy",

    // Output MPEG-TS with keyframe headers
    "-f", "mpegts",
    "-mpegts_flags", "resend_headers",

    "pipe:1"
  ], {
    stdio: ["ignore", "pipe", "pipe"]
  });

  relay.ffmpeg = ffmpeg;

  // Stream data broadcast to all active response objects
  ffmpeg.stdout.on("data", (chunk) => {
    for (const client of relay.clients) {
      if (client.writable) {
        client.write(chunk);
      }
    }
  });

  // Logging
  ffmpeg.stderr.on("data", (data) => {
    const msg = data.toString().trim();
    if (msg) console.log(`[${relay.name}] ${msg}`);
  });

  // Handle Exit / Crashes
  ffmpeg.on("exit", (code, signal) => {
    console.log(`[${relay.name}] ⚠️ FFmpeg process stopped (code=${code}, signal=${signal})`);
    relay.ffmpeg = null;

    // Auto-restart if clients are still connected
    if (relay.clients.size > 0 && !relay.isRestarting) {
      relay.isRestarting = true;
      console.log(`[${relay.name}] 🔄 Auto-reconnecting upstream source in 2 seconds...`);
      
      setTimeout(() => {
        relay.isRestarting = false;
        startFFmpeg(relay);
      }, 2000);
    } else if (relay.clients.size === 0) {
      activeRelays.delete(relay.name);
    }
  });

  ffmpeg.on("error", (err) => {
    console.error(`[${relay.name}] ❌ FFmpeg Process Error:`, err.message);
  });
}

function stopRelayIfIdle(relay) {
  // If no active clients, wait 30 seconds before killing FFmpeg to save bandwidth/RAM
  if (relay.clients.size === 0) {
    if (relay.idleTimer) clearTimeout(relay.idleTimer);

    relay.idleTimer = setTimeout(() => {
      if (relay.clients.size === 0) {
        console.log(`[${relay.name}] 💤 No active clients. Stopping relay to conserve resources.`);
        if (relay.ffmpeg) {
          try {
            relay.ffmpeg.kill("SIGKILL");
          } catch {}
        }
        activeRelays.delete(relay.name);
      }
    }, 30000); // 30 seconds idle buffer
  }
}

// ============================================================
// HTTP SERVER
// ============================================================

const server = http.createServer((req, res) => {
  const channel = req.url.split("?")[0].replace(/^\/+/, "");

  if (!CHANNELS[channel]) {
    res.writeHead(404, { "Content-Type": "text/plain" });
    return res.end("Channel not found");
  }

  // Get or initialize stream
  const relay = getOrCreateRelay(channel, CHANNELS[channel]);

  // Headers for persistent MPEG-TS streaming
  res.writeHead(200, {
    "Content-Type": "video/mp2t",
    "Cache-Control": "no-cache, no-store, must-revalidate",
    "Pragma": "no-cache",
    "Connection": "keep-alive",
    "Access-Control-Allow-Origin": "*"
  });

  console.log(`[${channel}] 👤 Client connected (${relay.clients.size + 1} total)`);

  relay.clients.add(res);

  // Handle client disconnection
  const cleanup = () => {
    if (relay.clients.has(res)) {
      relay.clients.delete(res);
      console.log(`[${channel}] 👋 Client disconnected (${relay.clients.size} remaining)`);
      stopRelayIfIdle(relay);
    }
  };

  req.on("close", cleanup);
  req.on("end", cleanup);
  res.on("error", cleanup);
});

// ============================================================
// SERVER START & SHUTDOWN
// ============================================================

server.listen(PORT, "0.0.0.0", () => {
  console.log("");
  console.log("==========================================");
  console.log("       DRAGON STABLE RELAY ENGINE         ");
  console.log("==========================================");
  console.log(`Port: ${PORT}`);
  console.log(`Channels: ${Object.keys(CHANNELS).length}`);
  console.log("Reconnection Strategy: Keep-Alive HTTP Connection");
  console.log("==========================================");
  console.log("");
});

function shutdown() {
  console.log("\n🛑 Graceful shutdown initiated...");

  for (const [name, relay] of activeRelays) {
    console.log(`[${name}] Terminating FFmpeg...`);
    if (relay.ffmpeg) {
      try {
        relay.ffmpeg.kill("SIGKILL");
      } catch {}
    }
  }

  server.close(() => {
    console.log("Server closed successfully.");
    process.exit(0);
  });
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
