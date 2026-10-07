const mineflayer = require('mineflayer');
const { pathfinder } = require('mineflayer-pathfinder');
const config = require('./settings.json');
const express = require('express');

// ============================================================
// EXPRESS HEALTH CHECK SERVER
// ============================================================
const app = express();
const PORT = process.env.PORT || 5000;

let botState = {
  connected: false,
  startTime: Date.now(),
  coords: null
};

app.get('/health', (req, res) => {
  res.json({
    status: botState.connected ? 'connected' : 'disconnected',
    uptime: Math.floor((Date.now() - botState.startTime) / 1000),
    coords: botState.coords
  });
});

app.get('/', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html>
      <head>
        <title>${config.name} Status</title>
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <style>
          body { font-family: 'Segoe UI', sans-serif; background: #0f172a; color: #f8fafc; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0; overflow: hidden; }
          .container { background: #1e293b; padding: 40px; border-radius: 20px; box-shadow: 0 0 50px rgba(45, 212, 191, 0.2); text-align: center; width: 400px; border: 1px solid #334155; }
          h1 { margin-bottom: 30px; font-size: 24px; color: #ccfbf1; display: flex; align-items: center; justify-content: center; gap: 10px; }
          .stat-card { background: #0f172a; padding: 15px; margin: 15px 0; border-radius: 12px; border-left: 5px solid #2dd4bf; text-align: left; box-shadow: 5px 5px 15px rgba(0, 0, 0, 0.3); }
          .label { font-size: 12px; color: #94a3b8; text-transform: uppercase; letter-spacing: 1px; }
          .value { font-size: 18px; font-weight: bold; color: #2dd4bf; margin-top: 5px; }
          .status-dot { height: 12px; width: 12px; border-radius: 50%; display: inline-block; margin-right: 8px; background-color: currentColor; }
          .pulse { animation: pulse 2s infinite; }
          @keyframes pulse { 0% { opacity: 1; } 50% { opacity: 0.5; } 100% { opacity: 1; } }
        </style>
      </head>
      <body>
        <div class="container">
          <h1><span id="live-indicator" class="status-dot pulse" style="color: #ef4444;"></span> ${config.name}</h1>
          <div class="stat-card"><div class="label">Status</div><div class="value" id="status-text">Connecting...</div></div>
          <div class="stat-card"><div class="label">Uptime</div><div class="value" id="uptime-text">0h 0m 0s</div></div>
          <div class="stat-card"><div class="label">Coordinates</div><div class="value" id="coords-text">Waiting...</div></div>
          <div class="stat-card"><div class="label">Server</div><div class="value">${config.server.ip}</div></div>
        </div>
        <script>
          const formatUptime = (seconds) => {
            const h = Math.floor(seconds / 3600);
            const m = Math.floor((seconds % 3600) / 60);
            const s = seconds % 60;
            return \`\${h}h \${m}m \${s}s\`;
          };
          const updateStats = async () => {
            try {
              const res = await fetch('/health');
              const data = await res.json();
              const statusText = document.getElementById('status-text');
              const uptimeText = document.getElementById('uptime-text');
              const coordsText = document.getElementById('coords-text');
              const liveDot = document.getElementById('live-indicator');
              if (data.status === 'connected') {
                statusText.innerHTML = 'Online & Running';
                statusText.style.color = '#2dd4bf';
                liveDot.style.color = '#4ade80';
              } else {
                statusText.innerHTML = 'Reconnecting...';
                statusText.style.color = '#f87171';
                liveDot.style.color = '#f87171';
              }
              uptimeText.innerText = formatUptime(data.uptime);
              if (data.coords) {
                coordsText.innerText = \`X: \${Math.floor(data.coords.x)}, Y: \${Math.floor(data.coords.y)}, Z: \${Math.floor(data.coords.z)}\`;
              } else {
                coordsText.innerText = 'Syncing...';
              }
            } catch (e) {
              document.getElementById('status-text').innerText = 'Offline';
            }
          };
          setInterval(updateStats, 1000);
          updateStats();
        </script>
      </body>
    </html>
  `);
});

app.listen(PORT, () => {
  console.log(`[Dashboard Node] Listening on port ${PORT}`);
});

// ============================================================
// CORE MINECRAFT CLIENT ENGINE
// ============================================================
const botArgs = {
  host: config.server.ip,
  port: parseInt(config.server.port) || 25565,
  username: config["bot-account"].username,
  version: config.server.version || "1.21.1"
};

let bot;

function startMinecraftBot() {
  console.log(`[Engine] Opening pipeline to ${botArgs.host}:${botArgs.port}`);
  bot = mineflayer.createBot(botArgs);

  bot.loadPlugin(pathfinder);

  bot.on('spawn', () => {
    botState.connected = true;
    console.log(`[Engine] Spawn complete. Managing session profile: ${botArgs.username}`);

    // Update spatial coords for the live data feed
    setInterval(() => {
      if (bot && bot.entity) {
        botState.coords = bot.entity.position;
      }
    }, 1000);

    // Structural loop mapping for Movement parameters
    if (config.movement && config.movement.enabled && config.movement["random-jump"]?.enabled) {
      setInterval(() => {
        if (bot && bot.setControlState) {
          bot.setControlState('jump', true);
          setTimeout(() => bot.setControlState('jump', false), 400);
        }
      }, config.movement["random-jump"].interval || 10000);
    }
  });

  // GLITCH EXTERMINATOR: Explicit system parsing for AuthMe chat protocols
  bot.on('message', (jsonMsg) => {
    const chatFeed = jsonMsg.toString().toLowerCase();
    
    if (config.utils && config.utils["auto-auth"] && config.utils["auto-auth"].enabled) {
      const passcode = config.utils["auto-auth"].password;

      if (chatFeed.includes('/register') || chatFeed.includes('register <password>')) {
        console.log("[Authentication Script] Processing Register hook context...");
        bot.chat(`/register ${passcode} ${passcode}`);
      }

      if (chatFeed.includes('/login') || chatFeed.includes('login <password>')) {
        console.log("[Authentication Script] Processing Login hook context...");
        bot.chat(`/login ${passcode}`);
      }
    }
  });

  // Safe failover handler
  bot.on('end', (reason) => {
    botState.connected = false;
    botState.coords = null;
    const retryDelay = config.utils["auto-reconnect-delay"] || 2000;
    console.log(`[Connection Interrupted] Reason: ${reason}. Triggering re-initialization routine in ${retryDelay}ms...`);
    
    if (config.utils && config.utils["auto-reconnect"]) {
      setTimeout(startMinecraftBot, retryDelay);
    }
  });

  bot.on('error', (err) => {
    console.error(`[Pipeline Error] Runtime exception observed: ${err.message}`);
  });
}

startMinecraftBot();
