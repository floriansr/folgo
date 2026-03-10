package httpserver

import (
	"encoding/json"
	"errors"
	"fmt"
	"image"
	_ "image/gif"
	"image/jpeg"
	_ "image/png"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"

	"github.com/disintegration/imaging"

	"github.com/floriansr/folgo/internal/fs"
	ui "github.com/floriansr/folgo/internal/ui"
)

/* ---------- App state with persistence ---------- */

type appState struct {
	mu         sync.RWMutex
	SourceDir  string `json:"sourceDir"`
	DestRoot   string `json:"destRoot"`
	ConfigPath string `json:"-"`
}

func (s *appState) load() {
	b, err := os.ReadFile(s.ConfigPath)
	if err != nil {
		return // first run, ignore
	}
	var tmp appState
	if json.Unmarshal(b, &tmp) == nil {
		s.SourceDir, s.DestRoot = tmp.SourceDir, tmp.DestRoot
	}
}

func (s *appState) save() {
	_ = os.MkdirAll(filepath.Dir(s.ConfigPath), 0o755)
	b, _ := json.MarshalIndent(appState{SourceDir: s.SourceDir, DestRoot: s.DestRoot}, "", "  ")
	_ = os.WriteFile(s.ConfigPath, b, 0o644)
}

func (s *appState) set(source, dest string) error {
	if source == "" || dest == "" {
		return errors.New("both source and dest required")
	}
	if st, err := os.Stat(source); err != nil || !st.IsDir() {
		return fmt.Errorf("invalid source dir")
	}
	if st, err := os.Stat(dest); err != nil || !st.IsDir() {
		return fmt.Errorf("invalid dest dir")
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	s.SourceDir, s.DestRoot = source, dest
	s.save()
	return nil
}

/* ---------- Helpers ---------- */

func getenv(k, def string) string {
	if v := os.Getenv(k); v != "" {
		return v
	}
	return def
}

func serveThumbnail(w http.ResponseWriter, absPath string, st os.FileInfo) {
	f, err := os.Open(absPath)
	if err != nil {
		http.Error(w, "cannot open file", http.StatusInternalServerError)
		return
	}
	defer f.Close()

	img, _, err := image.Decode(f)
	if err != nil {
		http.Error(w, "cannot decode image", http.StatusInternalServerError)
		return
	}

	const maxSize = 480 // largeur/hauteur max pour les vignettes

	thumb := imaging.Fit(img, maxSize, maxSize, imaging.Lanczos)

	w.Header().Set("Content-Type", "image/jpeg")
	w.Header().Set("Cache-Control", "public, max-age=86400")

	// qualité 70 → bon compromis poids/qualité
	if err := jpeg.Encode(w, thumb, &jpeg.Options{Quality: 70}); err != nil {
		http.Error(w, "cannot encode thumbnail", http.StatusInternalServerError)
		return
	}
}

/* ---------- HTTP server ---------- */

func New(tokenPath string) *http.ServeMux {
	mux := http.NewServeMux()

	// App state: defaults from env, persisted in ~/.folgo/config.json
	home, _ := os.UserHomeDir()
	state := &appState{
		SourceDir:  getenv("SOURCE_DIR", filepath.Join(home, "Pictures/Source")),
		DestRoot:   getenv("DEST_ROOT_DIR", filepath.Join(home, "Pictures/Export")),
		ConfigPath: filepath.Join(home, ".folgo", "config.json"),
	}
	state.load() // load persisted config if present

	/* ---- Routing ---- */

	// Redirect root to token path
	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, tokenPath, http.StatusFound)
	})

	// Token path without trailing slash -> add slash (pour que FileServer serve /index.html)
	mux.HandleFunc(tokenPath, func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, tokenPath+"/", http.StatusFound)
	})

	// Serve static UI from embedded FS
	fileServer := http.StripPrefix(tokenPath+"/", http.FileServer(http.FS(ui.FS())))
	mux.Handle(tokenPath+"/", fileServer)

	// ----- SETTINGS -----
	mux.HandleFunc(tokenPath+"/settings", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		switch r.Method {
		case http.MethodGet:
			state.mu.RLock()
			out := map[string]string{
				"sourceDir":   state.SourceDir,
				"destRootDir": state.DestRoot,
			}
			state.mu.RUnlock()
			_ = json.NewEncoder(w).Encode(out)
		case http.MethodPost:
			var in struct {
				SourceDir   string `json:"SourceDir"`
				DestRootDir string `json:"DestRootDir"`
			}
			if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
				http.Error(w, "bad json", http.StatusBadRequest)
				return
			}
			if err := state.set(in.SourceDir, in.DestRootDir); err != nil {
				http.Error(w, err.Error(), http.StatusBadRequest)
				return
			}
			_ = json.NewEncoder(w).Encode(map[string]string{"ok": "true"})
		default:
			w.WriteHeader(http.StatusMethodNotAllowed)
		}
	})

	// ----- BROWSE -----
	mux.HandleFunc(tokenPath+"/browse", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		q := r.URL.Query().Get("path")
		start := q
		if start == "" {
			start = home
		}
		entries, err := os.ReadDir(start)
		type Dir struct {
			Name string `json:"name"`
			Path string `json:"path"`
		}
		out := struct {
			Current string `json:"current"`
			Parent  string `json:"parent"`
			Dirs    []Dir  `json:"dirs"`
		}{
			Current: start,
			Parent:  filepath.Dir(start),
			Dirs:    []Dir{},
		}
		if err == nil {
			for _, e := range entries {
				if e.IsDir() && !strings.HasPrefix(e.Name(), ".") {
					p := filepath.Join(start, e.Name())
					out.Dirs = append(out.Dirs, Dir{Name: e.Name(), Path: p})
				}
			}
		}
		_ = json.NewEncoder(w).Encode(out)
	})

	// ----- SOURCE -----
	mux.HandleFunc(tokenPath+"/source", func(w http.ResponseWriter, r *http.Request) {
		page, _ := strconv.Atoi(r.URL.Query().Get("page"))
		if page < 1 {
			page = 1
		}
		state.mu.RLock()
		root := state.SourceDir
		state.mu.RUnlock()
		pg, err := fs.ListImagesPaged(root, page, 500)
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		_ = json.NewEncoder(w).Encode(pg)
	})

	// ----- TREE -----
	mux.HandleFunc(tokenPath+"/tree", func(w http.ResponseWriter, r *http.Request) {
		state.mu.RLock()
		root := state.DestRoot
		state.mu.RUnlock()

		if override := r.URL.Query().Get("root"); override != "" {
			oAbs, _ := filepath.Abs(override)
			rAbs, _ := filepath.Abs(root)
			if strings.HasPrefix(oAbs+string(os.PathSeparator), rAbs+string(os.PathSeparator)) {
				root = oAbs
			} else {
				http.Error(w, "invalid preview root", http.StatusBadRequest)
				return
			}
		}

		tree, err := fs.BuildTree(root)
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		_ = json.NewEncoder(w).Encode(tree)
	})

	// ----- THUMBNAIL / IMAGE PREVIEW -----
	mux.HandleFunc(tokenPath+"/thumb", func(w http.ResponseWriter, r *http.Request) {
		state.mu.RLock()
		root := state.SourceDir
		state.mu.RUnlock()

		p := r.URL.Query().Get("path")
		if p == "" {
			http.Error(w, "missing path", http.StatusBadRequest)
			return
		}

		abs, err := filepath.Abs(p)
		if err != nil {
			http.Error(w, "invalid path", http.StatusBadRequest)
			return
		}
		// Normalize both paths + resolve symlinks
		rootAbs, _ := filepath.Abs(root)
		if rootAbs == "" {
			http.Error(w, "server misconfig", http.StatusInternalServerError)
			return
		}
		abs, _ = filepath.EvalSymlinks(abs)
		rootAbs, _ = filepath.EvalSymlinks(rootAbs)

		sep := string(os.PathSeparator)
		prefix := rootAbs + sep
		if !strings.HasPrefix(abs+sep, prefix) { // +sep handles exact-dir matches safely
			http.Error(w, "access denied", http.StatusForbidden)
			return
		}

		st, err := os.Stat(abs)
		if err != nil || st.IsDir() {
			http.Error(w, "file not found", http.StatusNotFound)
			return
		}

		// 👉 mode thumbnail = version allégée pour la liste
		if r.URL.Query().Get("thumb") == "1" {
			serveThumbnail(w, abs, st)
			return
		}

		// 👉 sinon : comportement original (full image)
		buf := make([]byte, 512)
		f, err := os.Open(abs)
		if err != nil {
			http.Error(w, "cannot open file", http.StatusInternalServerError)
			return
		}
		defer f.Close()
		n, _ := f.Read(buf)
		w.Header().Set("Content-Type", http.DetectContentType(buf[:n]))
		f.Seek(0, 0)
		http.ServeContent(w, r, filepath.Base(abs), st.ModTime(), f)
	})

	// ----- COPY -----
	mux.HandleFunc(tokenPath+"/copy", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		if r.Method != http.MethodPost {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}

		var in struct {
			SourcePaths []string `json:"sourcePaths"`
			TargetDirs  []string `json:"targetDirs"`
		}
		if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
			http.Error(w, "bad json", http.StatusBadRequest)
			return
		}
		if len(in.SourcePaths) == 0 || len(in.TargetDirs) == 0 {
			http.Error(w, "sourcePaths and targetDirs required", http.StatusBadRequest)
			return
		}

		state.mu.RLock()
		srcRoot, dstRoot := state.SourceDir, state.DestRoot
		state.mu.RUnlock()

		abs := func(p string) string {
			a, _ := filepath.Abs(p)
			return a
		}
		inRoot := func(root, p string) bool {
			ar, ap := abs(root), abs(p)
			// s'assure d'être dans root/...
			return strings.HasPrefix(ap, ar+string(os.PathSeparator))
		}

		type Detail struct {
			File   string `json:"file"`
			Target string `json:"target,omitempty"`
			Status string `json:"status"`           // copied | skipped | error
			Reason string `json:"reason,omitempty"` // already_exists, not_a_file, ...
		}

		var copied, skipped, errors int
		details := make([]Detail, 0, len(in.SourcePaths)*len(in.TargetDirs))

		for _, sp := range in.SourcePaths {
			if !inRoot(srcRoot, sp) {
				errors++
				details = append(details, Detail{File: filepath.Base(sp), Status: "error", Reason: "src_out_of_root"})
				continue
			}
			st, err := os.Stat(sp)
			if err != nil || st.IsDir() {
				errors++
				details = append(details, Detail{File: filepath.Base(sp), Status: "error", Reason: "not_a_file"})
				continue
			}

			for _, td := range in.TargetDirs {
				if !inRoot(dstRoot, td) {
					errors++
					details = append(details, Detail{File: filepath.Base(sp), Target: td, Status: "error", Reason: "target_out_of_root"})
					continue
				}
				if fi, err := os.Stat(td); err != nil || !fi.IsDir() {
					errors++
					details = append(details, Detail{File: filepath.Base(sp), Target: td, Status: "error", Reason: "target_not_dir"})
					continue
				}

				dst := filepath.Join(td, filepath.Base(sp))
				if _, err := os.Stat(dst); err == nil {
					skipped++
					details = append(details, Detail{File: filepath.Base(sp), Target: td, Status: "skipped", Reason: "already_exists"})
					continue
				}

				if err := fs.CopyFile(sp, dst); err != nil {
					errors++
					details = append(details, Detail{File: filepath.Base(sp), Target: td, Status: "error", Reason: err.Error()})
				} else {
					copied++
					details = append(details, Detail{File: filepath.Base(sp), Target: td, Status: "copied"})
				}
			}
		}

		_ = json.NewEncoder(w).Encode(map[string]any{
			"copied":  copied,
			"skipped": skipped,
			"errors":  errors,
			"details": details,
		})
	})

	return mux
}
