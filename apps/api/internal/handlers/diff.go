package handlers

import (
	"context"
	"fmt"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/pmezard/go-difflib/difflib"
	"github.com/user/k8s-graph-controller/backend/internal/k8s"
	apierrors "k8s.io/apimachinery/pkg/api/errors"
	"k8s.io/apimachinery/pkg/api/meta"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/types"
	"k8s.io/client-go/restmapper"
	"sigs.k8s.io/yaml"
)

// Change is what applying one object would do to the cluster.
type Change struct {
	Resource string `json:"resource"`
	Action   string `json:"action"` // create | update | unchanged | error
	Diff     string `json:"diff,omitempty"`
	Error    string `json:"error,omitempty"`
}

// DiffManifests compares each object with what the cluster would hold after a
// server-side dry-run apply — defaults filled in, admission run — so the diff
// shows real changes rather than every default the user did not write.
func DiffManifests(ctx context.Context, client *k8s.Client, manifest string) ([]Change, error) {
	objects, err := parseYAML(manifest)
	if err != nil {
		return nil, fmt.Errorf("failed to parse YAML: %w", err)
	}
	gr, err := restmapper.GetAPIGroupResources(client.DiscoveryClient)
	if err != nil {
		return nil, fmt.Errorf("failed to discover API resources: %w", err)
	}
	mapper := restmapper.NewDiscoveryRESTMapper(gr)

	changes := make([]Change, 0, len(objects))
	for _, obj := range objects {
		changes = append(changes, diffOne(ctx, client, mapper, obj))
	}
	return changes, nil
}

func diffOne(ctx context.Context, client *k8s.Client, mapper meta.RESTMapper, obj *unstructured.Unstructured) Change {
	ch := Change{Resource: obj.GetKind() + "/" + obj.GetName()}
	fail := func(err error) Change { ch.Action, ch.Error = "error", err.Error(); return ch }

	dr, err := resourceClient(client, mapper, obj)
	if err != nil {
		return fail(err)
	}
	live, err := dr.Get(ctx, obj.GetName(), metav1.GetOptions{})
	if apierrors.IsNotFound(err) {
		ch.Action = "create"
		return ch
	}
	if err != nil {
		return fail(err)
	}
	data, err := obj.MarshalJSON()
	if err != nil {
		return fail(err)
	}
	force := true // the same as Apply, or the diff would disagree with it
	after, err := dr.Patch(ctx, obj.GetName(), types.ApplyPatchType, data,
		metav1.PatchOptions{FieldManager: "k8n", Force: &force, DryRun: []string{metav1.DryRunAll}})
	if err != nil {
		return fail(err)
	}
	ch.Diff = unifiedDiff(comparable(live), comparable(after))
	ch.Action = "update"
	if ch.Diff == "" {
		ch.Action = "unchanged"
	}
	return ch
}

// comparable is an object as YAML without the fields the server changes on
// every write, which would otherwise make every apply look like an update.
func comparable(obj *unstructured.Unstructured) string {
	o := obj.DeepCopy()
	delete(o.Object, "status")
	for _, f := range []string{"managedFields", "resourceVersion", "uid", "generation", "creationTimestamp"} {
		unstructured.RemoveNestedField(o.Object, "metadata", f)
	}
	unstructured.RemoveNestedField(o.Object, "metadata", "annotations", "kubectl.kubernetes.io/last-applied-configuration")
	unstructured.RemoveNestedField(o.Object, "metadata", "annotations", "deployment.kubernetes.io/revision")
	if len(o.GetAnnotations()) == 0 {
		unstructured.RemoveNestedField(o.Object, "metadata", "annotations")
	}
	out, err := yaml.Marshal(o.Object)
	if err != nil {
		return ""
	}
	return string(out)
}

func unifiedDiff(before, after string) string {
	if before == after {
		return ""
	}
	text, _ := difflib.GetUnifiedDiffString(difflib.UnifiedDiff{
		A: difflib.SplitLines(before), B: difflib.SplitLines(after),
		FromFile: "cluster", ToFile: "after apply", Context: 3,
	})
	return text
}

// DiffHandler serves POST /api/graph/diff with {yaml}.
func DiffHandler(getClient ClientGetter) gin.HandlerFunc {
	return func(c *gin.Context) {
		client := getClient()
		if !requireDynamic(c, client) {
			return
		}
		var req ApplyRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Expected {yaml}"})
			return
		}
		ctx, cancel := context.WithTimeout(c.Request.Context(), 30*time.Second)
		defer cancel()
		changes, err := DiffManifests(ctx, client, req.YAML)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusOK, gin.H{"changes": changes})
	}
}
