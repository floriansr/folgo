package httpserver

import (
	"fmt"
	"net/http"
)

func New(tokenPath string) *http.ServeMux {
	mux := http.NewServeMux()

	// Redirect root to token path
	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, tokenPath, http.StatusFound)
	})

	// Serve static UI (minimal for now)
	mux.HandleFunc(tokenPath, func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		fmt.Fprint(w, indexHTML)
	})

	return mux
}

const indexHTML = `
<!doctype html>
<html>
  <head>
    <meta charset="utf-8">
    <title>Folgo 📂</title>
    <style>
      body { font-family: sans-serif; padding: 2rem; background: #f9fafb; color: #222; }
      h1 { font-size: 1.8rem; margin-bottom: 0.5rem; }
      p { color: #555; }
    </style>
  </head>
  <body>
    <h1>🧭 Welcome to Folgo</h1>
    <p>Your local photo workbench is running successfully.</p>
  </body>
</html>
`
