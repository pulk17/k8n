package handlers

import (
	"bytes"
	"context"
	"fmt"
	"io"
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/user/k8s-graph-controller/backend/internal/k8s"
	corev1 "k8s.io/api/core/v1"
	"k8s.io/apimachinery/pkg/api/meta"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/runtime"
	"k8s.io/apimachinery/pkg/types"
	"k8s.io/apimachinery/pkg/util/yaml"
	"k8s.io/client-go/dynamic"
	"k8s.io/client-go/restmapper"
)

type ApplyRequest struct {
	YAML string `json:"yaml" binding:"required"`
}

type ErrorItem struct {
	Resource string `json:"resource"`
	Message  string `json:"message"`
}

func parseYAML(yamlString string) ([]*unstructured.Unstructured, error) {
	var objects []*unstructured.Unstructured
	decoder := yaml.NewYAMLOrJSONDecoder(bytes.NewReader([]byte(yamlString)), 4096)
	for {
		ext := runtime.RawExtension{}
		if err := decoder.Decode(&ext); err != nil {
			if err == io.EOF {
				break
			}
			return nil, err
		}
		ext.Raw = bytes.TrimSpace(ext.Raw)
		if len(ext.Raw) == 0 || bytes.Equal(ext.Raw, []byte("null")) {
			continue
		}
		obj := &unstructured.Unstructured{}
		if err := obj.UnmarshalJSON(ext.Raw); err != nil {
			return nil, err
		}
		objects = append(objects, obj)
	}
	return objects, nil
}

func ApplyResources(clientGetter func() *k8s.Client) gin.HandlerFunc {
	return func(c *gin.Context) {
		client := clientGetter()
		if !requireDynamic(c, client) {
			return
		}

		isDryRun := c.Query("dryRun") == "true"

		var req ApplyRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid request body, expected {yaml: string}"})
			return
		}

		applied, errorsList, err := ApplyManifests(c.Request.Context(), client, req.YAML, isDryRun)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}
		if len(errorsList) > 0 {
			c.JSON(http.StatusBadRequest, gin.H{"success": false, "errors": errorsList})
			return
		}

		c.JSON(http.StatusOK, gin.H{"success": true, "applied": applied})
	}
}

// ApplyManifests server-side applies a multi-document manifest, creating any
// missing namespaces first. It returns the resources it handled plus any
// per-resource failures. Shared by the REST handler and the MCP apply tool so
// both enforce the same behaviour.
func ApplyManifests(ctx context.Context, client *k8s.Client, manifest string, isDryRun bool) ([]string, []ErrorItem, error) {
	objects, err := parseYAML(manifest)
	if err != nil {
		return nil, nil, fmt.Errorf("failed to parse YAML: %w", err)
	}
	if len(objects) == 0 {
		return nil, nil, nil
	}

	gr, err := restmapper.GetAPIGroupResources(client.DiscoveryClient)
	if err != nil {
		return nil, nil, fmt.Errorf("failed to discover API resources: %w", err)
	}
	mapper := restmapper.NewDiscoveryRESTMapper(gr)

	// Create the namespaces the manifest targets, so applying a graph into a
	// fresh namespace works in one step.
	namespacesToCreate := make(map[string]bool)
	for _, obj := range objects {
		ns := obj.GetNamespace()
		if ns != "" && ns != "default" && !IsProtected("", ns) {
			namespacesToCreate[ns] = true
		}
	}
	for ns := range namespacesToCreate {
		opts := metav1.CreateOptions{}
		if isDryRun {
			opts.DryRun = []string{metav1.DryRunAll}
		}
		_, err := client.Clientset.CoreV1().Namespaces().Create(ctx, &corev1.Namespace{
			ObjectMeta: metav1.ObjectMeta{Name: ns},
		}, opts)
		if err != nil && !strings.Contains(err.Error(), "already exists") {
			return nil, nil, fmt.Errorf("failed to create namespace %s: %w", ns, err)
		}
	}

	var applied []string
	var errorsList []ErrorItem

	for _, obj := range objects {
		gvk := obj.GroupVersionKind()
		mapping, err := mapper.RESTMapping(gvk.GroupKind(), gvk.Version)
		if err != nil {
			errorsList = append(errorsList, ErrorItem{
				Resource: obj.GetName(),
				Message:  "Unknown resource type " + gvk.String() + ": " + err.Error(),
			})
			continue
		}

		var dr dynamic.ResourceInterface = client.DynamicClient.Resource(mapping.Resource)
		if mapping.Scope.Name() != meta.RESTScopeNameRoot {
			ns := obj.GetNamespace()
			if ns == "" {
				ns = "default"
			}
			dr = client.DynamicClient.Resource(mapping.Resource).Namespace(ns)
		}

		opts := metav1.PatchOptions{FieldManager: "k8n"}
		if isDryRun {
			opts.DryRun = []string{metav1.DryRunAll}
		}

		// The dynamic client has no Apply, so server-side apply goes through
		// Patch with ApplyPatchType.
		data, err := obj.MarshalJSON()
		if err != nil {
			errorsList = append(errorsList, ErrorItem{Resource: obj.GetName(), Message: "Failed to marshal: " + err.Error()})
			continue
		}

		if _, err = dr.Patch(ctx, obj.GetName(), types.ApplyPatchType, data, opts); err != nil {
			errorsList = append(errorsList, ErrorItem{Resource: obj.GetName(), Message: err.Error()})
			continue
		}

		applied = append(applied, fmt.Sprintf("%s/%s", obj.GetKind(), obj.GetName()))
	}

	return applied, errorsList, nil
}
