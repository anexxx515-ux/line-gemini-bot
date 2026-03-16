const { app, BrowserWindow, ipcMain } = require("electron");
const path = require("path");
const { spawn, execSync } = require("child_process");
const fs = require("fs");

let mainWindow;
let keywordWindow = null;   // ⭐ ใช้หน้าต่างใหม่แทน BrowserView
let botProcess = null;
let ngrokProcess = null;

const configPath = path.join(__dirname, "config.json");

function loadConfig() {
  if (!fs.existsSync(configPath)) {
    fs.writeFileSync(
      configPath,
      JSON.stringify({ lineToken: "", geminiKey: "" }, null, 2)
    );
  }
  return JSON.parse(fs.readFileSync(configPath));
}

function saveConfig(data) {
  fs.writeFileSync(configPath, JSON.stringify(data, null, 2));
}

function sendLog(msg) {
  if (mainWindow) {
    mainWindow.webContents.send("log", msg);
  }
}

function killNgrokAll() {
  try {
    execSync("taskkill /F /IM ngrok.exe >nul 2>&1");
  } catch {}
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 900,
    height: 650,
    backgroundColor: "#ffffff",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
    },
  });

  mainWindow.loadFile("index.html");

  mainWindow.webContents.on("did-finish-load", () => {
    sendLog("UI Ready...\n");
  });
}

//
// ⭐ เปิดหน้าจัดการ Keyword (หน้าต่างใหม่)
//
function openKeywordWindow() {
  if (keywordWindow && !keywordWindow.isDestroyed()) {
    keywordWindow.focus();
    return;
  }

  keywordWindow = new BrowserWindow({
    width: 1000,
    height: 720,
    title: "Keyword Manager",
    autoHideMenuBar: true,   // ⭐ ซ่อนเมนูด้านบน (สวยขึ้น)
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
    },
  });

  const url = "http://localhost:3000/admin.html";

  // ⭐ รอโหลด ถ้า server ยังไม่มา → retry
  function loadWithRetry() {
    keywordWindow.loadURL(url).catch(() => {
      setTimeout(loadWithRetry, 1000);
    });
  }

  loadWithRetry();

  keywordWindow.on("closed", () => {
    keywordWindow = null;
  });
}

//
// ======================
// APP READY
// ======================
//
app.whenReady().then(() => {
  createWindow();
  setTimeout(() => {
    sendLog("App started...\n");
  }, 500);
});

//
// ======================
// CLOSE APP → KILL ALL
// ======================
//
app.on("before-quit", () => {
  try {
    killNgrokAll();
  } catch {}

  if (botProcess) {
    try {
      botProcess.kill("SIGINT");
    } catch {}
    botProcess = null;
  }
});

//
// ======================
// CONFIG
// ======================
//
ipcMain.handle("load-config", () => loadConfig());

ipcMain.handle("save-config", (_, data) => {
  saveConfig(data);
  return true;
});

//
// ======================
// ⭐ OPEN KEYWORD WINDOW
// ======================
//
ipcMain.handle("open-keyword", () => {
  openKeywordWindow();
});

//
// ======================
// START BOT
// ======================
//
ipcMain.handle("start-bot", async (_, tokens) => {
  try {
    if (botProcess) {
      return { success: false, error: "Bot already running" };
    }

    saveConfig(tokens);

    sendLog("Starting Bot...\n");

    botProcess = spawn("node", ["index.js"], {
      cwd: path.join(__dirname, ".."),
      stdio: "pipe",
      env: {
        ...process.env,
        LINE_ACCESS_TOKEN: tokens.lineToken,
        GEMINI_API_KEY: tokens.geminiKey,
      },
    });

    botProcess.stdout.on("data", (data) => {
      sendLog("[BOT] " + data.toString());
    });

    botProcess.stderr.on("data", (data) => {
      sendLog("[BOT ERROR] " + data.toString());
    });

    botProcess.on("close", () => {
      sendLog("Bot stopped\n");
      botProcess = null;
    });

    setTimeout(() => {
      sendLog("Starting ngrok...\n");

      killNgrokAll();

      const ngrokPath = path.join(__dirname, "ngrok.exe");

      ngrokProcess = spawn(ngrokPath, ["http", "3000"]);

      ngrokProcess.stdout.on("data", (data) => {
        sendLog("[NGROK] " + data.toString());
      });

      ngrokProcess.stderr.on("data", (data) => {
        sendLog("[NGROK ERROR] " + data.toString());
      });
    }, 2500);

    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

//
// ======================
// STOP BOT
// ======================
//
ipcMain.handle("stop-bot", () => {
  sendLog("Stopping bot...\n");

  if (botProcess) {
    try {
      botProcess.kill("SIGINT");
    } catch {}
    botProcess = null;
    sendLog("Bot stopped\n");
  }

  try {
    killNgrokAll();
    sendLog("Ngrok stopped\n");
  } catch {}

  ngrokProcess = null;

  return true;
});
