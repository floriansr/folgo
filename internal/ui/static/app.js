const base = window.location.pathname.replace(/\/$/, "");
const srcInput   = document.getElementById("srcInput");
const destInput  = document.getElementById("destInput");

let page = 1;
let items = [];
let currentIndex = 0;

async function loadSettings() {
  try {
    const res = await fetch(`${base}/settings`, { cache: 'no-store' });
    if (!res.ok) throw new Error("Failed to fetch settings");
    const s = await res.json();

    srcInput.value  = s.sourceDir   || "";
    destInput.value = s.destRootDir || "";

    // inputs browse-only
    srcInput.readOnly  = true;
    destInput.readOnly = true;
  } catch (e) {
    console.warn("Settings not available yet:", e.message);
  }
}

/* ========== Source loading ========== */
async function loadPage() {
  try {
    items = [];
    currentIndex = 0;
    document.getElementById("thumbList").innerHTML = "";
    document.getElementById("preview").innerHTML = "<p>Loading…</p>";
    updateCounter();

    const res = await fetch(`${base}/source?page=${page}`, { cache: 'no-store' });
    if (!res.ok) throw new Error("Failed to fetch source list");
    const data = await res.json();

    items = data.items || [];
    updateCounter();
    renderThumbList();
    renderPreview();
  } catch (err) {
    console.error(err);
    document.getElementById("preview").innerHTML =
      `<p style="color:#b00">Error loading source: ${err.message}</p>`;
  }
}


/* ========== Preview rendering ========== */
function renderPreview() {
  const el = document.getElementById("preview");
  if (!items.length) {
    el.innerHTML = "<p>No images found in source folder.</p>";
    return;
  }

  const current = items[currentIndex];
  const esc = (s) => s.replace(/[&<>"']/g, c => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
  ));

  const oldImg = el.querySelector("img");
  if (oldImg) {
    oldImg.style.opacity = "0";
    setTimeout(() => {
      updatePreview(el, current, esc);
    }, 150);
  } else {
    updatePreview(el, current, esc);
  }
}

function updatePreview(el, current, esc) {
  el.innerHTML = `
    <figure>
      <img src="${base}/thumb?path=${encodeURIComponent(current.path)}" 
           alt="${esc(current.name)}"
           style="opacity:0; transition:opacity .3s ease-in-out;">
      <figcaption>${esc(current.name)}</figcaption>
    </figure>
  `;
  const img = el.querySelector("img");
  requestAnimationFrame(() => { img.style.opacity = "1"; });
  updateCounter();
}

/* ========== Thumbnails ========== */
function renderThumbList() {
  const el = document.getElementById("thumbList");
  el.innerHTML = items.map((item, i) => `
    <img src="${base}/thumb?path=${encodeURIComponent(item.path)}"
         data-index="${i}"
         alt="${item.name}"
         class="${i === currentIndex ? 'active' : ''}">
  `).join("");

  el.querySelectorAll("img").forEach(img => {
    img.onclick = () => {
      currentIndex = Number(img.dataset.index);
      renderPreview();
      renderThumbList();
    };
  });
}

/* ========== Counter ========== */
function updateCounter() {
  const counter = document.getElementById("pageInfo");
  if (items.length)
    counter.textContent = `📷 Image ${currentIndex + 1} / ${items.length}`;
  else
    counter.textContent = "📷 No images";
}

/* ========== Keyboard navigation ========== */
document.addEventListener("keydown", (e) => {
  if (!items.length) return;
  if (e.key === "ArrowUp") {
    e.preventDefault();
    currentIndex = (currentIndex - 1 + items.length) % items.length;
    renderPreview();
    renderThumbList();
    scrollThumbIntoView();
  } else if (e.key === "ArrowDown") {
    e.preventDefault();
    currentIndex = (currentIndex + 1) % items.length;
    renderPreview();
    renderThumbList();
    scrollThumbIntoView();
  }
});

function scrollThumbIntoView() {
  const active = document.querySelector("#thumbList img.active");
  if (active) active.scrollIntoView({ block: "nearest", behavior: "smooth" });
}

/* ========== Destination tree ========== */
async function loadTree() {
  try {
    const res = await fetch(`${base}/tree`);
    if (!res.ok) throw new Error("Failed to fetch tree");
    const tree = await res.json();
    document.getElementById("tree").innerHTML = renderNode(tree);
  } catch (err) {
    console.error(err);
    document.getElementById("tree").innerHTML =
      `<p style="color:#b00">Error loading tree: ${err.message}</p>`;
  }
}
function renderNode(n) {
  if (!n) return "";
  const children = (n.children || []).map(renderNode).join("");
  return `<ul><li><strong>${escapeHtml(n.name)}</strong>${children}</li></ul>`;
}

/* ========== Folder Browser Modal ========== */
const modal      = document.getElementById("folderModal");
const modalPath  = document.getElementById("modalPath");
const dirList    = document.getElementById("dirList");
const upDir      = document.getElementById("upDir");
const closeModal = document.getElementById("closeModal");
const chooseDir  = document.getElementById("chooseDir");

let browseTarget = null;       // "source" | "dest"
let currentBrowsePath = null;  // current path in modal

const browseSrc  = document.getElementById("browseSrc");
const browseDest = document.getElementById("browseDest");

browseSrc.onclick  = () => openFolderBrowser("source");
browseDest.onclick = () => openFolderBrowser("dest");

async function openFolderBrowser(target) {
  browseTarget = target;

  // point de départ = valeur input si présente, sinon home (géré côté serveur)
  const startPath = (target === "source")
    ? (srcInput.value.trim()  || null)
    : (destInput.value.trim() || null);

  await navigateFolder(startPath);
  modal.hidden = false;
}
let previewTimer = null;

async function navigateFolder(path = null) {
  const url = new URL(`${base}/browse`, window.location.origin);
  if (path) url.searchParams.set("path", path);

  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) { alert("Cannot browse filesystem from server"); return; }

  const data = await res.json();
  currentBrowsePath = data.current;
  modalPath.textContent = data.current;

  dirList.innerHTML = (data.dirs || [])
    .map(d => `<li data-path="${encodeURIComponent(d.path)}">${escapeHtml(d.name)}</li>`)
    .join("");

  Array.from(dirList.querySelectorAll("li")).forEach(li => {
    li.onclick = () => navigateFolder(decodeURIComponent(li.dataset.path));
  });
  upDir.onclick = () => navigateFolder(data.parent);

  // Live preview du tree pour DEST (debounced)
  if (browseTarget === "dest") {
    if (previewTimer) clearTimeout(previewTimer);
    previewTimer = setTimeout(() => loadTreePreview(currentBrowsePath), 120);
  }
}

async function loadTreePreview(rootPath) {
  const treeEl = document.getElementById("tree");
  treeEl.classList.add("updating");
  try {
    const url = new URL(`${base}/tree`, window.location.origin);
    url.searchParams.set("root", rootPath);
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) throw new Error("Failed to fetch tree preview");
    const tree = await res.json();
    treeEl.innerHTML = renderNode(tree);
  } catch (err) {
    console.error(err);
  } finally {
    setTimeout(() => treeEl.classList.remove("updating"), 100);
  }
}

[srcInput, destInput].forEach(el => {
  el.addEventListener('click', e => e.preventDefault());
});

closeModal.onclick = () => { modal.hidden = true; };
chooseDir.onclick = async () => {
  if (!currentBrowsePath) return;

  if (browseTarget === "source") {
    srcInput.value = currentBrowsePath;
  } else {
    destInput.value = currentBrowsePath;
  }

  await fetch(`${base}/settings`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      SourceDir: srcInput.value.trim(),
      DestRootDir: destInput.value.trim(),
    }),
  });

  if (browseTarget === "source") {
    page = 1; currentIndex = 0;
    await loadPage();   // va recharger la nouvelle source
  } else {
    await loadTree();   // tree final depuis DestRoot
  }

  modal.hidden = true;
};

/* ========== Helpers & init ========== */
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
  );
}

loadSettings();
loadPage();
loadTree();
