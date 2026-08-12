const http = require("http");
const { spawn } = require("child_process");

const PORT = process.env.PORT || 8080;

// ============================================================
// UPDATED CHANNELS LIST
// ============================================================

const CHANNELS = {
  "bein-news": "http://185.191.126.127:8080/live/b0:99:d7:15:88:50/3090914536649669/443146.ts",
  "bein1": "http://185.191.126.127:8080/live/b0:99:d7:15:88:50/3090914536649669/325793.ts",
  "bein2": "http://185.191.126.127:8080/live/b0:99:d7:15:88:50/3090914536649669/325794.ts",
  "bein3": "http://185.191.126.127:8080/live/b0:99:d7:15:88:50/3090914536649669/325795.ts",
  "bein4": "http://185.191.126.127:8080/live/b0:99:d7:15:88:50/3090914536649669/325796.ts",
  "bein5": "http://185.191.126.127:8080/live/b0:99:d7:15:88:50/3090914536649669/325797.ts",
  "bein6": "http://185.191.126.127:8080/live/b0:99:d7:15:88:50/3090914536649669/325798.ts",
  "bein7": "http://185.191.126.127:8080/live/b0:99:d7:15:88:50/3090914536649669/325799.ts",
  "bein8": "http://185.191.126.127:8080/live/b0:99:d7:15:88:50/3090914536649669/325800.ts",
  "bein-movies-1": "http://185.191.126.127:8080/live/b0:99:d7:15:88:50/3090914536649669/319672.ts",
  "bein-movies-2": "http://185.191.126.127:8080/live/b0:99:d7:15:88:50/3090914536649669/319673.ts",
  "al-thamnia-1": "http://185.191.126.127:8080/live/b0:99:d7:15:88:50/3090914536649669/421785.ts",
  "al-thamnia-2": "http://185.191.126.127:8080/live/b0:99:d7:15:88:50/3090914536649669/421786.ts",
  "al-thamnia-3": "http://185.191.126.127:8080/live/b0:99:d7:15:88:50/3090914536649669/429403.ts",
  "mbc2": "http://185.191.126.127:8080/live/b0:99:d7:15:88:50/3090914536649669/45168.ts",
  "mbc3": "http://185.191.126.127:8080/live/b0:99:d7:15:88:50/3090914536649669/45143.ts",
  "mbc4": "http://185.191.126.127:8080/live/b0:99:d7:15:88:50/3090914536649669/45164.ts",
  "mbc5": "http://185.191.126.127:8080/live/b0:99:d7:15:88:50/3090914536649669/92759.ts",
  "al-aoula": "http://185.191.126.127:8080/live/b0:99:d7:15:88:50/3090914536649669/413999.ts",
  "2m-maroc": "http://185.191.126.127:8080/live/b0:99:d7:15:88:50/3090914536649669/414001.ts",
  "arryadia-hd": "http://pro.netmos.ovh:7355/live/UDJPRCRA1L055B/Ep27yiiwbb56mjkl/187244.ts",
  "quran": "http://185.191.126.127:8080/live/b0:99:d7:15:88:50/3090914536649669/413749.ts",
  "national-geographic": "http://185.191.126.127:8080/live/b0:99:d7:15:88:50/3090914536649669/15026.ts"
};

// Map to store active channel state
const activeRelays = new Map();

// ============================================================
// RELAY ENGINE (AUTO RECONNECT & STREAM PERSISTENCE)
// ============================================================

function getOrCreateRelay(name, source) {
  if (activeRelays.has(name)) {
    const relay = activeRelays.get(name);
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

  console.log(`[${relay.name}] 🚀 Starting FFmpeg relay engine...`);

  const ffmpeg = spawn("ffmpeg", [
    "-hide_banner",
    "-loglevel", "warning",

    // Read input at native frame rate
    "-re",

    // Advanced HTTP Reconnection flags
    "-reconnect", "1",
    "-reconnect_at_eof", "1",
    "-reconnect_streamed", "1",
    "-reconnect_delay_max", "3",

    // Timeout duration (10 seconds)
    "-rw_timeout", "10000000",

    // Faster stream probe for minimal startup delay
    "-probesize", "1000000",
    "-analyzeduration", "1000000",

    // Input Source
    "-i", relay.source,

    // Stream Selection
    "-map", "0:v:0?",
    "-map", "0:a:0?",

    // Direct Copy Mode (No re-encoding / Low CPU)
    "-c", "copy",

    // Continuous TS Header broadcasting
    "-f", "mpegts",
    "-mpegts_flags", "resend_headers",

    "pipe:1"
  ], {
    stdio: ["ignore", "pipe", "pipe"]
  });

  relay.ffmpeg = ffmpeg;

  // Broadcast stream chunks to all connected client responses
  ffmpeg.stdout.on("data", (chunk) => {
    for (const client of relay.clients) {
      if (client.writable) {
        client.write(chunk);
      }
    }
  });

  // Log ffmpeg process errors/warnings
  ffmpeg.stderr.on("data", (data) => {
    const msg = data.toString().trim();
    if (msg) console.log(`[${relay.name}] ${msg}`);
  });

  // Automatically handle source failures or process exits
  ffmpeg.on("exit", (code, signal) => {
    console.log(`[${relay.name}] ⚠️ FFmpeg source lost (code=${code}, signal=${signal})`);
    relay.ffmpeg = null;

    // Auto-reconnect if viewers are still listening
    if (relay.clients.size > 0 && !relay.isRestarting) {
      relay.isRestarting = true;
      console.log(`[${relay.name}] 🔄 Reconnecting upstream source in 2 seconds...`);
      
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
  // If no active clients remain, clean up process after 30 seconds
  if (relay.clients.size === 0) {
    if (relay.idleTimer) clearTimeout(relay.idleTimer);

    relay.idleTimer = setTimeout(() => {
      if (relay.clients.size === 0) {
        console.log(`[${relay.name}] 💤 Channel idle. Stopping process.`);
        if (relay.ffmpeg) {
          try {
            relay.ffmpeg.kill("SIGKILL");
          } catch {}
        }
        activeRelays.delete(relay.name);
      }
    }, 30000);
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

  // Get or spawn stream
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

  // Clean up client on disconnect
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
  console.log(`Channels Loaded: ${Object.keys(CHANNELS).length}`);
  console.log("Status: READY");
  console.log("==========================================");
  console.log("");
});

function shutdown() {
  console.log("\n🛑 Graceful shutdown initiated...");

  for (const [name, relay] of activeRelays) {
    if (relay.ffmpeg) {
      try {
        relay.ffmpeg.kill("SIGKILL");
      } catch {}
    }
  }

  server.close(() => {
    console.log("Server stopped successfully.");
    process.exit(0);
  });
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
