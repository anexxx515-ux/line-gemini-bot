window.addEventListener("DOMContentLoaded", async () => {
  console.log("Renderer loaded");

  const lineTokenInput = document.getElementById("lineToken");
  const geminiKeyInput = document.getElementById("geminiKey");
  const logBox = document.getElementById("log");

  // =========================
  // โหลด config
  // =========================
  const config = await window.api.loadConfig();
  lineTokenInput.value = config.lineToken || "";
  geminiKeyInput.value = config.geminiKey || "";

  // =========================
  // Save Token
  // =========================
  window.saveConfig = async () => {
    await window.api.saveConfig({
      lineToken: lineTokenInput.value,
      geminiKey: geminiKeyInput.value,
    });
    logBox.value += "Token saved\n";
  };

  // =========================
  // Start Bot
  // =========================
  window.startBot = async () => {
    const res = await window.api.startBot({
      lineToken: lineTokenInput.value,
      geminiKey: geminiKeyInput.value,
    });

    if (!res.success) {
      alert(res.error);
    }
  };

  // =========================
  // Stop Bot
  // =========================
  window.stopBot = async () => {
    await window.api.stopBot();
  };

  // =========================
  // ⭐ เปิดหน้าจัดการ Keyword
  // =========================
  window.openKeyword = async () => {
    await window.api.openKeyword();
  };

  // =========================
  // รับ Log จาก main
  // =========================
  window.api.onLog((msg) => {
    logBox.value += msg;
    logBox.scrollTop = logBox.scrollHeight;
  });
});
