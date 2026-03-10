const base = window.location.pathname.replace(/\/$/, "");
const srcInput   = document.getElementById("srcInput");
const destInput  = document.getElementById("destInput");
const copyBtn    = document.getElementById("copyBtn");
const refreshTreeBtn = document.getElementById("refreshTree");
const syncTeamsCheckbox = document.getElementById("syncTeams");

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

const MAGNIFIER_ZOOM = 5; // facteur de zoom

function attachMagnifier(imgEl, imgSrc) {
  const figure = imgEl.closest("figure");
  if (!figure) return;

  // crée une seule loupe par preview
  let mag = document.getElementById("magnifier");
  if (!mag) {
    mag = document.createElement("div");
    mag.id = "magnifier";
    figure.appendChild(mag);
  } else if (!figure.contains(mag)) {
    figure.appendChild(mag);
  }

  mag.style.display = "none";
  mag.style.backgroundImage = `url("${imgSrc}")`;

  // pour ne pas ré-attacher des listeners à chaque render
  if (imgEl._magnifierAttached) return;
  imgEl._magnifierAttached = true;

  imgEl.addEventListener("mouseenter", () => {
    mag.style.display = "block";
  });

  imgEl.addEventListener("mouseleave", () => {
    mag.style.display = "none";
  });

  imgEl.addEventListener("mousemove", (ev) => {
    const rect = imgEl.getBoundingClientRect();
    const x = ev.clientX - rect.left;
    const y = ev.clientY - rect.top;

    // Position de la loupe au-dessus de l’image
    mag.style.left = `${x}px`;
    mag.style.top = `${y}px`;

    // pourcentage dans l’image
    const px = (x / rect.width) * 100;
    const py = (y / rect.height) * 100;

    // taille du background (zoom)
    const bgW = rect.width * MAGNIFIER_ZOOM;
    const bgH = rect.height * MAGNIFIER_ZOOM;
    mag.style.backgroundSize = `${bgW}px ${bgH}px`;

    // position dans le background
    mag.style.backgroundPosition = `${px}% ${py}%`;
  });
}

function updatePreview(el, current, esc) {
  const imgSrc = `${base}/thumb?path=${encodeURIComponent(current.path)}`;

  el.innerHTML = `
    <figure>
      <img src="${imgSrc}"
           alt="${esc(current.name)}"
           style="opacity:0; transition:opacity .25s ease-in-out;">
      <figcaption>${esc(current.name)}</figcaption>
    </figure>
  `;
  const img = el.querySelector("img");

  // 👉 on attache la loupe ici
  attachMagnifier(img, imgSrc);

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
          src="${base}/thumb?path=${encodeURIComponent(item.path)}&thumb=1"
          alt="${escapeHtml(item.name)}"
          draggable="false"
          loading="lazy"
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
    treeEl.innerHTML = renderTree(tree);

    // Restore click handlers every refresh
    treeEl.querySelectorAll(".target").forEach(span => {
      span.onclick = () => handleTargetClick(span);
    });

    // 👉 gestion des dropdowns
    treeEl.querySelectorAll(".tree-toggle").forEach(btn => {
      // on ignore les "fake" toggles sur les feuilles
      if (btn.classList.contains("tree-toggle--empty")) return;

      btn.onclick = (ev) => {
        ev.stopPropagation();
        const li = btn.closest(".tree-node");
        if (!li) return;

        const isExpanded = li.classList.toggle("expanded");
        li.classList.toggle("collapsed", !isExpanded);

        const children = li.querySelector(":scope > .tree-children");
        if (children) {
          children.hidden = !isExpanded;
        }

        btn.textContent = isExpanded ? "▾" : "▸";
      };
    });

    updateTreeHighlight();
  } catch (err) {
    console.error(err);
    document.getElementById("tree").innerHTML =
      `<p style="color:#b00">Error loading tree: ${err.message}</p>`;
  }
}

function renderNode(node, depth = 0) {
  if (!node) return "";

  const childrenArr = (node.children || []).slice().sort(compareNodesByName);
  const hasChildren = childrenArr.length > 0;

  let colClass = "";
  if (hasChildren) {
    if (childrenArr.length > 120) colClass = "columns-5";
    else if (childrenArr.length > 90) colClass = "columns-4";
    else if (childrenArr.length > 60) colClass = "columns-3";
    else if (childrenArr.length > 30) colClass = "columns-2";
  }

  const isExpanded = depth === 0;
  const isSel = selectedTargets.has(node.path);

  const childrenHtml = hasChildren
    ? `
      <ul class="tree-children ${colClass}" ${isExpanded ? "" : "hidden"}>
        ${childrenArr.map(child => renderNode(child, depth + 1)).join("")}
      </ul>
    `
    : "";

  const toggleHtml = hasChildren
    ? `<button class="tree-toggle">${isExpanded ? "▾" : "▸"}</button>`
    : `<span class="tree-toggle tree-toggle--empty"></span>`;

  return `
    <li class="tree-node ${isExpanded ? "expanded" : "collapsed"}" data-path="${encodeURIComponent(node.path)}">
      <div class="tree-row">
        ${toggleHtml}
        <span class="target ${isSel ? "selected" : ""}"
              data-path="${encodeURIComponent(node.path)}"
              data-name="${escapeHtml(node.name)}">
          ${escapeHtml(node.name)}
        </span>
      </div>
      ${childrenHtml}
    </li>
  `;
}

function compareNodesByName(a, b) {
  const na = a.name;
  const nb = b.name;

  const digitOnly = /^\d+$/;
  const aIsNum = digitOnly.test(na);
  const bIsNum = digitOnly.test(nb);

  // Si les deux sont *uniquement* des chiffres → compare en entier
  if (aIsNum && bIsNum) {
    return Number(na) - Number(nb);
  }

  // Sinon, fallback sur un tri alpha "normal"
  return na.localeCompare(nb, undefined, {
    sensitivity: "base",
  });
}

function renderTree(root) {
  if (!root) return "";
  return `<ul class="tree-root">
    ${renderNode(root, 0)}
  </ul>`;
}

function isTargetVisible(el) {
  let parent = el.parentElement;
  while (parent) {
    if (parent.classList && parent.classList.contains("tree-children") && parent.hidden) {
      return false;
    }
    parent = parent.parentElement;
  }
  return true;
}


/* ---------- Bouton copier & toasts ---------- */
function updateCopyButtonState() {
  const hasSelection = selected.size > 0;
  const hasActive = items.length > 0 && currentIndex >= 0;
  copyBtn.disabled = (selectedTargets.size === 0 || (!hasSelection && !hasActive));
}

function handleTargetClick(span) {
  const path = decodeURIComponent(span.dataset.path);
  const name = (span.dataset.name || span.textContent || "").trim();

  const currentlySelected = selectedTargets.has(path);
  const shouldSelect = !currentlySelected;

  if (syncTeamsCheckbox && syncTeamsCheckbox.checked && name !== "") {
    const allSameName = Array.from(document.querySelectorAll("#tree .target"))
      .filter(el => (el.dataset.name || el.textContent || "").trim() === name)
      .filter(el => isTargetVisible(el));

    allSameName.forEach(el => {
      const p2 = decodeURIComponent(el.dataset.path);
      if (shouldSelect) {
        selectedTargets.add(p2);
      } else {
        selectedTargets.delete(p2);
      }
      el.classList.toggle("selected", shouldSelect);
    });
  } else {
    if (shouldSelect) selectedTargets.add(path);
    else selectedTargets.delete(path);
    span.classList.toggle("selected", shouldSelect);
  }

  updateCopyButtonState();
}

function showToast(kind, text, ms = 4000) {
  const container = document.getElementById("toast-container");
  if (!container) return;

  const el = document.createElement("div");
  el.className = `toast ${kind}`;
  el.textContent = text;
  container.appendChild(el);

  setTimeout(() => {
    el.classList.add("toast--hide");
    setTimeout(() => {
      if (el.parentNode === container) {
        container.removeChild(el);
      }
    }, 250);
  }, ms);
}


copyBtn.onclick = async () => {
  copyBtn.disabled = true;
  copyBtn.textContent = "Copie…";

  const toCopy = new Set(selected);
  if (items.length > 0 && currentIndex >= 0) {
    toCopy.add(items[currentIndex].path);
  }

  let nextIndex = currentIndex;
  if (toCopy.size > 0) {
    let maxIdx = -1;
    for (const p of toCopy) {
      const idx = items.findIndex(it => it.path === p);
      if (idx > maxIdx) maxIdx = idx;
    }
    if (maxIdx >= 0) {
      nextIndex = Math.min(maxIdx + 1, items.length - 1);
    }
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

    const { copied = 0, skipped = 0, errors = 0, details = [] } = await res.json();

    const perTarget = new Map();

    for (const d of details) {
      if (d.status !== "copied") continue;
      const target = d.target || "";
      if (!target) continue;
      perTarget.set(target, (perTarget.get(target) || 0) + 1);
    }

    function humanDestLabel(targetPath) {
      const parts = targetPath.split(/[/\\]+/).filter(Boolean);
      const last = parts.slice(-3);
      return last.join(" > ");
    }

    for (const [target, count] of perTarget.entries()) {
      const label = humanDestLabel(target);
      const plural = count > 1 ? "s" : "";
      showToast(
        "success",
        `✅ ${count} photo${plural} vers ${label}`
      );
    }

    if (errors > 0) {
      showToast(
        "error",
        `❌ Terminé avec erreurs — ${copied} copiées, ${skipped} ignorées, ${errors} erreurs.`
      );
    } else if (skipped > 0 && copied === 0 && perTarget.size === 0) {
      showToast(
        "warn",
        `⚠️ Aucune nouvelle copie — ${skipped} fichier(s) déjà présent(s).`
      );
    }

    clearSelection();

    selectedTargets.clear();
    const treeEl = document.getElementById("tree");
    if (treeEl) {
      treeEl.querySelectorAll(".target.selected").forEach(span => {
        span.classList.remove("selected");
      });
    }
    updateCopyButtonState();

    if (items.length) {
      currentIndex = nextIndex;
      renderPreview();
      scrollThumbIntoView();
    }
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
