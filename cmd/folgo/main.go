package main

import (
	"fmt"
	"log"
	"math/rand"
	"net/http"

	"github.com/floriansr/folgo/internal/httpserver"
)

func main() {
	port := 8787
	token := fmt.Sprintf("/workbench-%d", rand.Intn(10000))

	mux := httpserver.New(token)
	addr := fmt.Sprintf("127.0.0.1:%d", port)

	log.Printf("🚀 Folgo running at http://%s%s", addr, token)
	log.Fatal(http.ListenAndServe(addr, mux))
}
