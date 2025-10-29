package httpserver

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"

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
		pg, err := fs.ListImagesPaged(root, page, 100)
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

		// Permettre la preview d'un autre root: /tree?root=/path/to/preview
		if override := r.URL.Query().Get("root"); override != "" {
			// (Optionnel: sécuriser/normaliser le chemin ici)
			if st, err := os.Stat(override); err == nil && st.IsDir() {
				root = override
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

		// Query param ?path=...
		path := r.URL.Query().Get("path")
		if path == "" {
			http.Error(w, "missing path", http.StatusBadRequest)
			return
		}

		// Clean and resolve the absolute path
		abs, err := filepath.Abs(path)
		if err != nil {
			http.Error(w, "invalid path", http.StatusBadRequest)
			return
		}

		// Security: ensure the file is inside SourceDir
		if !strings.HasPrefix(abs, root) {
			http.Error(w, "access denied", http.StatusForbidden)
			return
		}

		// Ensure it exists and is a regular file
		st, err := os.Stat(abs)
		if err != nil || st.IsDir() {
			http.Error(w, "file not found", http.StatusNotFound)
			return
		}

		// Guess MIME type (e.g., image/jpeg)
		buf := make([]byte, 512)
		f, err := os.Open(abs)
		if err != nil {
			http.Error(w, "cannot open file", http.StatusInternalServerError)
			return
		}
		defer f.Close()
		n, _ := f.Read(buf)
		mime := http.DetectContentType(buf[:n])
		w.Header().Set("Content-Type", mime)

		// Stream file contents to response
		f.Seek(0, 0)
		http.ServeContent(w, r, filepath.Base(abs), st.ModTime(), f)
	})

	return mux
}
