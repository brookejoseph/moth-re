import { app, BrowserWindow, ipcMain } from "electron";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { analyzeBinary, loadAnalysis, searchAnalysis, showFunction } from "../lib/analysis.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 840,
    minWidth: 940,
    minHeight: 620,
    title: "Moth RE",
    webPreferences: {
      preload: path.join(__dirname, "preload.mjs"),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  win.loadFile(path.join(__dirname, "renderer.html"));
}

app.whenReady().then(createWindow);

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

ipcMain.handle("moth:analyze", async (_event, binaryPath) => {
  const result = analyzeBinary(binaryPath);
  return {
    index: result.index,
    functions: result.functions.slice(0, 500),
    strings: result.strings.slice(0, 500),
    objc: result.objc
  };
});

ipcMain.handle("moth:load", async (_event, dbPath) => {
  const db = loadAnalysis(dbPath);
  return {
    index: db.index,
    functions: db.functions.slice(0, 500),
    strings: db.strings.slice(0, 500),
    objc: db.objc
  };
});

ipcMain.handle("moth:search", async (_event, dbPath, query, kind) => {
  return searchAnalysis(dbPath, query, { kind, limit: 100 });
});

ipcMain.handle("moth:show", async (_event, dbPath, needle) => {
  return showFunction(dbPath, needle);
});
