package fs

import (
	"os"
	"path/filepath"
	"sort"
)

type Node struct {
	Name     string `json:"name"`
	Path     string `json:"path"`
	Children []Node `json:"children"`
}

func BuildTree(root string) (Node, error) {
	rootNode := Node{Name: filepath.Base(root), Path: root}
	children, err := listDirs(root)
	if err != nil {
		return Node{}, err
	}
	rootNode.Children = children
	return rootNode, nil
}

func listDirs(dir string) ([]Node, error) {
	entries, err := filepath.Glob(filepath.Join(dir, "*"))
	if err != nil {
		return nil, err
	}
	var nodes []Node
	for _, e := range entries {
		fi, err := os.Stat(e)
		if err != nil {
			continue
		}

		if fi.IsDir() {
			sub, _ := listDirs(e) // simple recursion (OK for M1)
			nodes = append(nodes, Node{Name: filepath.Base(e), Path: e, Children: sub})
		}
	}
	sort.Slice(nodes, func(i, j int) bool { return nodes[i].Name < nodes[j].Name })
	return nodes, nil
}
