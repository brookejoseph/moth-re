import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("moth", {
  analyze: (binaryPath) => ipcRenderer.invoke("moth:analyze", binaryPath),
  load: (dbPath) => ipcRenderer.invoke("moth:load", dbPath),
  search: (dbPath, query, kind) => ipcRenderer.invoke("moth:search", dbPath, query, kind),
  show: (dbPath, needle) => ipcRenderer.invoke("moth:show", dbPath, needle)
});
