package fs

import (
	"io"
	"os"
	"path/filepath"
)

func CopyFile(src, dst string) error {
	if err := os.MkdirAll(filepath.Dir(dst), 0o755); err != nil {
		return err
	}

	in, err := os.Open(src)
	if err != nil {
		return err
	}
	defer in.Close()

	// O_EXCL => échoue si le fichier existe déjà (on gère "skipped" côté handler)
	out, err := os.OpenFile(dst, os.O_CREATE|os.O_WRONLY|os.O_EXCL, 0o644)
	if err != nil {
		return err
	}
	defer func() { _ = out.Close() }()

	if _, err := io.Copy(out, in); err != nil {
		return err
	}

	// optionnel : préserver les timestamps/permissions source (simple)
	if st, err := in.Stat(); err == nil {
		_ = os.Chmod(dst, st.Mode()&0o777)
		_ = os.Chtimes(dst, st.ModTime(), st.ModTime())
	}

	return nil
}
