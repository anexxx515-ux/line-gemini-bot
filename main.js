// const { app, BrowserWindow, ipcMain } = require("electron");
const path = require("path");
const { spawn } = require("child_process");

let botProcess = null;
let ngrokProcess = null;

function createWindow() {
  const win = new BrowserWindow({
    width: 800,
    height: 600,
    backgroundColor: "#ffffff",
    webPreferences: {
      preload: path.join(__dirname, "preload.js")
    }
  });

  win.loadFile("index.html");
}

ipcMain.handle("start-bot", async () => {
  try {
    if (botProcess) {
      return { success: false, error: "Bot already running" };
    }

    // ▶ start bot
    botProcess = spawn("node", ["index.js"], {
      cwd: path.join(__dirname, ".."),
      shell: true
    });

    botProcess.stdout.on("data", d => console.log("[BOT]", d.toString()));
    botProcess.stderr.on("data", d => console.error("[BOT ERROR]", d.toString()));

    // ▶ start ngrok
    ngrokProcess = spawn("ngrok", ["http", "3000"], {
      shell: true
    });

    ngrokProcess.stdout.on("data", d => console.log("[NGROK]", d.toString()));
    ngrokProcess.stderr.on("data", d => console.error("[NGROK ERROR]", d.toString()));

    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

app.whenReady().then(createWindow);
