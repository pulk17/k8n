package handlers

import (
	"fmt"
	"os"
	"strings"
	"testing"

	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
)

// compileImported is what happens when someone pastes a manifest onto the
// canvas and deploys it: compile the imported graph back to objects.
func compileImported(t *testing.T, g Graph) map[string]*unstructured.Unstructured {
	t.Helper()
	docs, _, err := BuildManifests(g)
	if err != nil {
		t.Fatalf("compile: %v", err)
	}
	back, err := parseYAML(strings.Join(docs, separator))
	if err != nil {
		t.Fatalf("parse compiled: %v", err)
	}
	out := map[string]*unstructured.Unstructured{}
	for _, o := range back {
		out[o.GetKind()+"/"+o.GetName()] = o
	}
	return out
}

func importShop(t *testing.T) ([]*unstructured.Unstructured, ImportResponse) {
	t.Helper()
	raw, err := os.ReadFile("testdata/shop.yaml")
	if err != nil {
		t.Fatal(err)
	}
	original, err := parseYAML(string(raw))
	if err != nil {
		t.Fatal(err)
	}
	return original, buildImportGraph(original)
}

// A 26-object shop using every common kind deploys as written: probes, env,
// init containers, network rules and all, not just what the canvas shows.
func TestTheShopSurvivesImportAndCompile(t *testing.T) {
	original, imported := importShop(t)
	got := compileImported(t, importedGraph(imported))
	for _, o := range original {
		back := got[o.GetKind()+"/"+o.GetName()]
		if back == nil {
			t.Errorf("%s %s was lost", o.GetKind(), o.GetName())
			continue
		}
		for _, p := range lostParts(o.Object, back.Object) {
			t.Errorf("%s %s lost %v", o.GetKind(), o.GetName(), p)
		}
	}
}

// What the canvas does show, it must hold itself, or editing it does nothing:
// a quoted shell command stays three arguments, an Ingress keeps both routes.
func TestTheCanvasHoldsWhatItShows(t *testing.T) {
	original, imported := importShop(t)
	fields := map[string]map[string]interface{}{}
	for _, n := range imported.Nodes {
		fields[n.Kind+"/"+n.Name] = n.Fields
	}
	for _, o := range original {
		if spec := podSpecOf(o); spec != nil {
			f := fields[o.GetKind()+"/"+o.GetName()]
			want := spec.Containers[0].Command
			if got := splitArgs(asString(f["command"])); fmt.Sprintf("%q", got) != fmt.Sprintf("%q", want) && len(want) > 0 {
				t.Errorf("%s: command %q reads back as %q", o.GetName(), want, got)
			}
		}
	}
	if f := fields["Ingress/shop"]; f["routes"] != "api=/api\nfrontend=/" || f[preservedKey] != nil {
		t.Errorf("ingress fields = %v, want both routes held by the canvas", f)
	}
}

// Taking redis's storage edge away must take its volume with it, not leave a
// volume named "data" with no source behind.
func TestARemovedEdgeTakesItsKeptPartsWithIt(t *testing.T) {
	_, imported := importShop(t)
	g := importedGraph(imported)
	var edges []GraphEdge
	for _, e := range g.Edges {
		if e.Source != "PersistentVolumeClaim/shop/redis-data" {
			edges = append(edges, e)
		}
	}
	g.Edges = edges
	redis := compileImported(t, g)["Deployment/redis"]
	spec := podSpecOf(redis)
	if len(spec.Volumes) != 0 || len(spec.Containers[0].VolumeMounts) != 0 {
		t.Errorf("volumes %+v, mounts %+v, want none", spec.Volumes, spec.Containers[0].VolumeMounts)
	}
}
