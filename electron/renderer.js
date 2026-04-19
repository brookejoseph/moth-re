const dropzone = document.querySelector("#dropzone");
const workspace = document.querySelector("#workspace");
const binaryName = document.querySelector("#binaryName");
const analysisPath = document.querySelector("#analysisPath");
const functionList = document.querySelector("#functionList");
const searchBox = document.querySelector("#searchBox");
const kindSelect = document.querySelector("#kindSelect");
const detailPane = document.querySelector("#detailPane");
const tabs = [...document.querySelectorAll(".tab")];

let state = {
  dbPath: null,
  analysis: null,
  selectedFunction: null,
  searchResults: [],
  activeTab: "pseudocode"
};

dropzone.addEventListener("dragover", (event) => {
  event.preventDefault();
  dropzone.classList.add("dragging");
});

dropzone.addEventListener("dragleave", () => {
  dropzone.classList.remove("dragging");
});

dropzone.addEventListener("drop", async (event) => {
  event.preventDefault();
  dropzone.classList.remove("dragging");
  const file = event.dataTransfer.files[0];
  if (!file) return;
  const filePath = window.moth?.pathForFile?.(file) ?? file.path;
  if (!filePath) {
    setBusy("Analysis failed: Electron did not provide a file path for that drop.");
    return;
  }
  await analyze(filePath);
});

searchBox.addEventListener("input", debounce(runSearch, 180));
kindSelect.addEventListener("change", runSearch);

for (const tab of tabs) {
  tab.addEventListener("click", () => {
    state.activeTab = tab.dataset.tab;
    renderTabs();
    renderDetail();
  });
}

async function analyze(binaryPath) {
  setBusy(`Analyzing ${binaryPath}...`);
  try {
    if (!window.moth?.analyze) {
      throw new Error("The Electron preload API is unavailable. Restart the app and try again.");
    }
    state.analysis = await window.moth.analyze(binaryPath);
    state.dbPath = state.analysis.index.outDir;
    state.selectedFunction = state.analysis.functions[0] ?? null;
    state.searchResults = [];
    workspace.classList.remove("hidden");
    setDropReady();
    renderAnalysis();
  } catch (error) {
    setBusy(`Analysis failed:\n${error.message}`);
  }
}

async function runSearch() {
  if (!state.dbPath) return;
  const query = searchBox.value.trim();
  if (!query) {
    state.searchResults = [];
    renderDetail();
    return;
  }

  state.searchResults = await window.moth.search(state.dbPath, query, kindSelect.value);
  state.activeTab = "search";
  renderTabs();
  renderDetail();
}

async function selectFunction(name) {
  const fn = await window.moth.show(state.dbPath, name);
  if (!fn) return;
  state.selectedFunction = fn;
  state.activeTab = "pseudocode";
  renderAnalysis();
}

function renderAnalysis() {
  const index = state.analysis.index;
  binaryName.textContent = (index.inputPath ?? index.binary).split("/").pop();
  analysisPath.textContent = index.bundle
    ? `Executable: ${index.binary}\nAnalysis: ${index.outDir}`
    : index.outDir;
  functionList.innerHTML = "";

  for (const fn of state.analysis.functions) {
    const button = document.createElement("button");
    button.className = "function-row";
    if (state.selectedFunction?.name === fn.name) button.classList.add("active");
    button.innerHTML = `<strong>${escapeHtml(fn.name)}</strong><span>${fn.address ?? "no address"} · ${fn.calls.length} calls · ${fn.sizeLines} lines</span>`;
    button.addEventListener("click", () => selectFunction(fn.name));
    functionList.appendChild(button);
  }

  renderTabs();
  renderDetail();
}

function renderTabs() {
  for (const tab of tabs) {
    tab.classList.toggle("active", tab.dataset.tab === state.activeTab);
  }
}

function renderDetail() {
  const fn = state.selectedFunction;
  if (state.activeTab === "search") {
    detailPane.textContent = formatSearchResults(state.searchResults);
    return;
  }

  if (state.activeTab === "objc") {
    detailPane.textContent = JSON.stringify(state.analysis?.objc ?? {}, null, 2);
    return;
  }

  if (state.activeTab === "strings") {
    detailPane.textContent = (state.analysis?.strings ?? []).map((entry) => entry.value).join("\n");
    return;
  }

  if (!fn) {
    detailPane.textContent = "No function selected.";
    return;
  }

  if (state.activeTab === "assembly") {
    detailPane.textContent = fn.assembly.join("\n");
    return;
  }

  detailPane.textContent = fn.pseudocode ?? summarizeFunction(fn);
}

function formatSearchResults(results) {
  if (!results.length) return "No results.";
  return results.map((result) => {
    if (result.kind === "function") {
      return `[function] ${result.name}\n  score: ${result.score}\n  address: ${result.address ?? "unknown"}\n  calls: ${(result.calls ?? []).join(", ") || "none"}`;
    }
    return `[${result.kind}] score=${result.score}\n  ${result.value ?? result.name ?? result.raw}`;
  }).join("\n\n");
}

function summarizeFunction(fn) {
  return [
    `function ${fn.name}`,
    `address: ${fn.address ?? "unknown"}`,
    `calls: ${fn.calls.join(", ") || "none"}`,
    `branches: ${fn.branches}`
  ].join("\n");
}

function setBusy(message) {
  dropzone.classList.remove("hidden");
  workspace.classList.add("hidden");
  dropzone.querySelector("h2").textContent = message;
  dropzone.querySelector("p:last-child").textContent = "Large binaries can take a little while.";
}

function setDropReady() {
  dropzone.querySelector(".drop-kicker").textContent = "Drop another binary";
  dropzone.querySelector("h2").textContent = "Drag your file into this box";
  dropzone.querySelector("p:last-child").textContent = "Mach-O apps, command-line tools, dylibs, and other native binaries.";
}

function debounce(fn, delay) {
  let timer = null;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delay);
  };
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[char]);
}
