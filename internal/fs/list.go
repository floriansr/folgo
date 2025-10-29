package fs

import (
	"io/fs"
	"path/filepath"
	"sort"
	"strings"
)

var exts = map[string]bool{
	".jpg": true, ".jpeg": true, ".png": true, ".heic": true, ".tif": true, ".tiff": true,
}

type FileItem struct {
	Path  string `json:"path"`
	Name  string `json:"name"`
	Size  int64  `json:"size"`
	Mtime int64  `json:"mtime"`
}

type Page struct {
	Items []FileItem `json:"items"`
	Page  int        `json:"page"`
	Total int        `json:"total"`
}

func ListImagesPaged(root string, page, pageSize int) (Page, error) {
	var all []FileItem
	err := filepath.WalkDir(root, func(p string, d fs.DirEntry, err error) error {
		if err != nil {
			return nil
		} // skip errors silently for now
		if d.IsDir() {
			return nil
		}
		if !exts[strings.ToLower(filepath.Ext(d.Name()))] {
			return nil
		}
		info, e := d.Info()
		if e != nil {
			return nil
		}
		all = append(all, FileItem{
			Path: p, Name: d.Name(), Size: info.Size(), Mtime: info.ModTime().Unix(),
		})
		return nil
	})
	if err != nil {
		return Page{}, err
	}

	// tri simple par mtime desc puis nom
	sort.Slice(all, func(i, j int) bool {
		if all[i].Mtime == all[j].Mtime {
			return all[i].Name < all[j].Name
		}
		return all[i].Mtime > all[j].Mtime
	})

	total := len(all)
	if page < 1 {
		page = 1
	}
	start := (page - 1) * pageSize
	if start > total {
		start = total
	}
	end := start + pageSize
	if end > total {
		end = total
	}

	return Page{Items: all[start:end], Page: page, Total: total}, nil
}
