const mineflayer = require('mineflayer');
const { Movements, pathfinder, goals } = require('mineflayer-pathfinder');
const { GoalBlock } = goals;
const config = require('./settings.json');
const express = require('express');
const http = require('http');

// ============================================================
// EXPRESS SERVER - Keep Render/Railway alive
// ============================================================
const app = express();
const PORT = process.env.PORT || 5000;

// Bot state tracking for the Live Dashboard
let botState = {
  connected: false,
  lastActivity: Date.now(),
  reconnectAttempts: 0,
  startTime: Date.now(),
  coords: null,
  errors: []
};

// API Endpoint for the Web Dashboard script to poll
app.get('/health', (req, res) => {
  res.json({
    status: botState.connected ? 'connected' : 'disconnected',
    uptime: Math.floor((Date.now() - botState.startTime) / 1000),
    coords: botState.coords,
    attempts: botState.reconnectAttempts
  });
});

// HTML Live Status Dashboard
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
          .connection-bar { height: 4px; background: #334155; width: 100%; margin-top: 20px; border-radius: 2px; overflow: hidden; }
          .connection-fill { height: 100%; width: 100%; background: #2dd4bf; animation: loading 2s infinite linear; }
          @keyframes loading { 0% { transform: translateX(-100%); } 100% { transform: translateX(100%); } }
        </style>
      </head>
      <body>
        <div class="container" id="main-container">
          <h1><span id="live-indicator" class="status-dot pulse" style="color: #ef4444;"></span> ${config.name}</h1>
          <div class="stat-card"><div class="label">Status</div><div class="value" id="status-text">Connecting...</div></div>
          <div class="stat-card"><div class="label">Uptime</div><div class="value" id="uptime-text">0h 0m 0s</div></div>
          <div class="stat-card"><div class="label">Coordinates</div><div class="value" id="coords-text">Waiting...</div></div>
          <div class="stat-card"><div class="label">Server</div><div class="value">${config.server.ip}</div></div>
          <div class="connection-bar"><div class="connection-fill"></div></div>
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
                coordsText.innerText = 'Spawn Lobby';
              }
            } catch (e) {
              document.getElementById('status-text').innerText = 'System Offline';
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
  console.log(`[Express] Web dashboard listening on port ${PORT}`);
});

// ============================================================
// MINEFLAYER MINECRAFT BOT LOGIC
// ============================================================
const botArgs = {
  host: config.server.ip,
  port: parseInt(config.server.port) || 25565,
  username: config.botOptions.username,
  version: false // 'false' forces automatic client version handling to work alongside ViaVersion
};

let bot;

function initBot() {
  console.log(`[Mineflayer] Attempting to connect to ${botArgs.host}:${botArgs.port}...`);
  bot = mineflayer.createBot(botArgs);
  
  // Load Pathfinder plugin components
  bot.loadPlugin(pathfinder);

  bot.on('spawn', () => {
    botState.connected = true;
    botState.reconnectAttempts = 0;
    console.log(`[Mineflayer] ${botArgs.username} successfully entered the game world.`);
    
    // Track coords for dashboard data feed
    setInterval(() => {
      if (bot && bot.entity) {
        botState.coords = bot.entity.position;
      }
    }, 1000);

    // ANTI-AFK GLITCH FIX: Forces jumps to bypass Play Hosting's inactivity server kicks
    setInterval(() => {
      if (bot && bot.setControlState) {
        bot.setControlState('jump', true);
        setTimeout(() => bot.setControlState('jump', false), 400);
      }
    }, 20000);
  });

  // GLITCH FIXER: Intercepts game chat logs to instantly clear AuthMe / FastLogin security
  bot.on('message', (jsonMsg) => {
    const chatLine = jsonMsg.toString().toLowerCase();
    const cleanPassword = config.botOptions.password;

    // Condition 1: Direct register request matches
    if (chatLine.includes('/register') || chatLine.includes('register <password>')) {
      console.log("[Security Interface] Caught AuthMe /register prompt. Transmitting authentication packages...");
      bot.chat(`/register ${cleanPassword} ${cleanPassword}`);
    }

    // Condition 2: Regular login prompt matches
    if (chatLine.includes('/login') || chatLine.includes('login <password>')) {
      console.log("[Security Interface] Caught AuthMe /login prompt. Transmitting authentication packages...");
      bot.chat(`/login ${cleanPassword}`);
    }
  });

  // Keep-Alive Loop: Restarts process instantly if server boots bot out
  bot.on('end', (reason) => {
    botState.connected = false;
    botState.coords = null;
    console.log(`[Mineflayer] Lost connection: ${reason}. Scheduling automatic retry in 15 seconds...`);
    setTimeout(initBot, 15000);
  });

  bot.on('error', (err) => {
    console.error(`[Fatal Network Error] Connection pipeline broke: ${err.message}`);
  });
}

// Initial deployment execution call
initBot();
