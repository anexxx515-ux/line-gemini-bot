const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("api", {
  // ======================
  // BOT CONTROL
  // ======================
  startBot: (data) => ipcRenderer.invoke("start-bot", data),
  stopBot: () => ipcRenderer.invoke("stop-bot"),

  // ======================
  // CONFIG
  // ======================
  loadConfig: () => ipcRenderer.invoke("load-config"),
  saveConfig: (data) => ipcRenderer.invoke("save-config", data),

  // ======================
  // ⭐ เปิดหน้า Keyword
  // ======================
  openKeyword: () => ipcRenderer.invoke("open-keyword"),

  // ======================
  // LOG LISTENER
  // ======================
  onLog: (callback) => {
    ipcRenderer.removeAllListeners("log"); // กัน log ซ้ำ
    ipcRenderer.on("log", (_, msg) => {
      callback(msg);
    });
  }
});
