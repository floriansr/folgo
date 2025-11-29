const base = window.location.pathname.replace(/\/$/, "");
const srcInput   = document.getElementById("srcInput");
const destInput  = document.getElementById("destInput");
const copyBtn    = document.getElementById("copyBtn");
const refreshTreeBtn = document.getElementById("refreshTree");

const selectedTargets = new Set();   // selected destination folders
let selected = new Set();            // multi-selected source image paths

let page = 1;
let items = [];
let currentIndex = 0;
let lastClickedIndex = null;         // for Shift-range select

/* ---------- Helpers sélection ---------- */
function clearSelection() {
  selected.clear();
  renderThumbList();       // only class updates (no re-render of markup)
  updateCopyButtonState();
}

/* ---------- Settings ---------- */
async function loadSettings() {
  try {
    const res = await fetch(`${base}/settings`, { cache: 'no-store' });
    if (!res.ok) throw new Error("Failed to fetch settings");
    const s = await res.json();

    srcInput.value  = s.sourceDir   || "";
    destInput.value = s.destRootDir || "";

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
    lastClickedIndex = null;
    clearSelection();

    const thumbs = document.getElementById("thumbList");
    const preview = document.getElementById("preview");
    thumbs.innerHTML = "";
    preview.innerHTML = "<p>Loading…</p>";
    updateCounter();

    const res = await fetch(`${base}/source?page=${page}`, { cache: 'no-store' });
    if (!res.ok) throw new Error("Failed to fetch source list");
    const data = await res.json();

    items = data.items || [];
    updateCounter();
    renderThumbList(true); // initial render (build DOM & listeners)
    renderPreview();
    scrollThumbIntoView();
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

  const doRender = () => {
    updatePreview(el, current, esc);
    updateThumbClasses();
    updateTreeHighlight();
  };

  if (oldImg) {
    oldImg.style.opacity = "0";
    setTimeout(doRender, 150);
  } else {
    doRender();
  }
}

function updatePreview(el, current, esc) {
  el.innerHTML = `
    <figure>
      <img src="${base}/thumb?path=${encodeURIComponent(current.path)}" 
           alt="${esc(current.name)}"
           style="opacity:0; transition:opacity .25s ease-in-out;">
      <figcaption>${esc(current.name)}</figcaption>
    </figure>
  `;
  const img = el.querySelector("img");
  requestAnimationFrame(() => { img.style.opacity = "1"; });
  updateCounter();
}

/* ========== Thumbnails ========== */
function renderThumbList(firstInit = false) {
  const el = document.getElementById("thumbList");

  // Initial DOM + listeners
  if (firstInit) {
    el.innerHTML = items.map((item, i) => `
      <div class="thumb" tabindex="0" data-index="${i}" data-path="${encodeURIComponent(item.path)}">
        <img
          src="${base}/thumb?path=${encodeURIComponent(item.path)}"
          alt="${escapeHtml(item.name)}"
          draggable="false"
        />
      </div>
    `).join("");

    el.querySelectorAll(".thumb").forEach(div => {
      div.onclick = (ev) => handleThumbClick(ev, div);
      div.onkeydown = (ev) => {
        if (ev.key === "Enter" || ev.key === " ") {
          ev.preventDefault();
          handleThumbClick(ev, div);
        }
      };
    });
  }

  // Update classes (active/selected) without rebuilding
  updateThumbClasses();
}

function handleThumbClick(ev, div) {
  const i = Number(div.dataset.index);
  const path = decodeURIComponent(div.dataset.path);

  // Shift = range select
  if (ev.shiftKey && lastClickedIndex != null && i !== lastClickedIndex) {
    const [a, b] = i < lastClickedIndex ? [i, lastClickedIndex] : [lastClickedIndex, i];
    for (let k = a; k <= b; k++) selected.add(items[k].path);
    currentIndex = i;
  } else if (ev.ctrlKey || ev.metaKey) {
    toggleSelection(path);
    currentIndex = i;
  } else {
    // single select: clear selection, make current
    selected.clear();
    currentIndex = i;
  }

  lastClickedIndex = i;
  renderPreview();
  updateThumbClasses();
  scrollThumbIntoView();
}

function toggleSelection(path) {
  if (selected.has(path)) selected.delete(path);
  else selected.add(path);

  updateThumbClasses();
  updateCopyButtonState();
}

function setActiveIndex(i) {
  currentIndex = i;
  renderPreview();
  updateThumbClasses();
  scrollThumbIntoView();
}

function updateThumbClasses() {
  const thumbs = document.querySelectorAll("#thumbList .thumb");
  thumbs.forEach((div, i) => {
    const path = decodeURIComponent(div.dataset.path);
    div.classList.toggle("active", i === currentIndex);
    div.classList.toggle("selected", selected.has(path));
  });
  updateCopyButtonState();
}

/* ========== Tree highlight ========== */
function updateTreeHighlight() {
  const treeEl = document.getElementById("tree");
  if (!treeEl) return;
  console.log("🚀 ~ updateTreeHighlight ~ treeEl:", treeEl)

  // Avoid console errors when tree is empty or being swapped
  try {
    // Debug logs only when present
    if (treeEl) {
      // No-op logs removed or guarded; keep a tiny guard for manual debugging
      // console.debug('tree length:', treeEl.innerHTML.length);
    }
  } catch { /* ignore */ }

  treeEl.querySelectorAll(".highlight-active").forEach(el => {
    el.classList.remove("highlight-active");
  });

  const current = items[currentIndex];
  if (!current || !current.name) return;
  const activeName = current.name.trim();
  const base = activeName.replace(/\.[^.]+$/, ""); // drop extension
  const matches = Array.from(treeEl.querySelectorAll(".target"))
    .filter(el => el.textContent.trim() === base);
  matches.forEach(match => {
    let li = match.closest("li");
    while (li) {
      li.classList.add("highlight-active");
      li = li.parentElement?.closest("li");
    }
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
    updateThumbClasses();
    scrollThumbIntoView();
  } else if (e.key === "ArrowDown") {
    e.preventDefault();
    currentIndex = (currentIndex + 1) % items.length;
    renderPreview();
    updateThumbClasses();
    scrollThumbIntoView();
  }
});

/* ✅ Center active thumb when needed */
function scrollThumbIntoView() {
  const active = document.querySelector("#thumbList .thumb.active");
  const list = document.getElementById("thumbList");
  if (!active || !list) return;

  const rect = active.getBoundingClientRect();
  const listRect = list.getBoundingClientRect();

  const outOfView = rect.top < listRect.top || rect.bottom > listRect.bottom;
  if (outOfView) active.scrollIntoView({ block: "center", behavior: "smooth" });
}

/* ========== Destination tree ========== */
async function loadTree(rootOverride) {
  try {
    const url = new URL(`${base}/tree`, window.location.origin);
    if (rootOverride) url.searchParams.set("root", rootOverride);

    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) throw new Error("Failed to fetch tree");
    const tree = await res.json();

    const treeEl = document.getElementById("tree");
    treeEl.innerHTML = renderNode(tree);

    // Restore click handlers every refresh
    treeEl.querySelectorAll('.target').forEach(span => {
      span.onclick = () => {
        const p = decodeURIComponent(span.dataset.path);
        if (selectedTargets.has(p)) selectedTargets.delete(p);
        else selectedTargets.add(p);
        span.classList.toggle('selected');
        updateCopyButtonState();
      };
    });

    updateTreeHighlight();
  } catch (err) {
    console.error(err);
    document.getElementById("tree").innerHTML =
      `<p style="color:#b00">Error loading tree: ${err.message}</p>`;
  }
}

function renderNode(n) {
  if (!n) return "";
  const children = (n.children || []).map(renderNode).join("");
  const isSel = selectedTargets.has(n.path);
  return `
    <ul>
      <li>
        <span class="target ${isSel ? 'selected' : ''}"
              data-path="${encodeURIComponent(n.path)}">${escapeHtml(n.name)}</span>
        ${children}
      </li>
    </ul>
  `;
}

/* ---------- Bouton copier & toasts ---------- */
function updateCopyButtonState() {
  const hasSelection = selected.size > 0;
  const hasActive = items.length > 0 && currentIndex >= 0;
  copyBtn.disabled = (selectedTargets.size === 0 || (!hasSelection && !hasActive));
}

function showToast(kind, text, ms=4000){
  const el = document.getElementById('toast');
  el.className = `toast ${kind}`;
  el.textContent = text;
  el.hidden = false;
  clearTimeout(el._t); el._t = setTimeout(()=> el.hidden = true, ms);
}

copyBtn.onclick = async () => {
  copyBtn.disabled = true;
  copyBtn.textContent = "Copie…";

  const toCopy = new Set(selected);
  if (items.length > 0 && currentIndex >= 0) {
    toCopy.add(items[currentIndex].path);
  }

  const payload = {
    sourcePaths: Array.from(toCopy),
    targetDirs: Array.from(selectedTargets),
  };
  try {
    const res = await fetch(`${base}/copy`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      showToast('error', '❌ Copie échouée (requête invalide ou refus d’accès).');
      return;
    }

    const {copied=0, skipped=0, errors=0} = await res.json();
    if (errors > 0) {
      showToast('error',  `❌ Terminé avec erreurs — ${copied} copiés, ${skipped} ignorés, ${errors} erreurs.`);
    } else if (skipped > 0) {
      showToast('warn',   `⚠️ Partiel — ${copied} copiés, ${skipped} ignorés (déjà présents).`);
    } else {
      showToast('success',`✅ Copie terminée — ${copied} copiés.`);
    }

    clearSelection();

    if (items.length) {
      currentIndex = (currentIndex + 1) % items.length;
      renderPreview();
      scrollThumbIntoView();
    }

    await loadTree();

  } catch (e) {
    console.error(e);
    showToast('error', '❌ Copie échouée (erreur réseau).');
  } finally {
    copyBtn.textContent = "Copier";
    updateCopyButtonState();
  }
};

/* ========== Folder Browser Modal ========== */
const modal      = document.getElementById("folderModal");
const modalPath  = document.getElementById("modalPath");
const dirList    = document.getElementById("dirList");
const upDir      = document.getElementById("upDir");
const closeModal = document.getElementById("closeModal");
const chooseDir  = document.getElementById("chooseDir");

let browseTarget = null;
let currentBrowsePath = null;

const browseSrc  = document.getElementById("browseSrc");
const browseDest = document.getElementById("browseDest");

browseSrc.onclick  = () => openFolderBrowser("source");
browseDest.onclick = () => openFolderBrowser("dest");

async function openFolderBrowser(target) {
  browseTarget = target;

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

  if (browseTarget === "dest") {
    if (previewTimer) clearTimeout(previewTimer);
    previewTimer = setTimeout(() => loadTree(currentBrowsePath), 120);
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
    await loadPage();
  } else {
    await loadTree();
  }

  modal.hidden = true;
};

/* ========== Helpers & init ========== */
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
  );
}

/* ========== Bootstrap ========== */
refreshTreeBtn.onclick = () => loadTree();

loadSettings();
loadPage();
loadTree();
updateCopyButtonState();
