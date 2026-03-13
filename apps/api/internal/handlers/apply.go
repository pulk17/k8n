package handlers

import (
	"bytes"
	"context"
	"io"
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/user/k8s-graph-controller/backend/internal/k8s"
	"k8s.io/apimachinery/pkg/api/meta"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/runtime"
	"k8s.io/apimachinery/pkg/types"
	"k8s.io/apimachinery/pkg/util/yaml"
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
		if client == nil || client.DynamicClient == nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "K8s client not initialized"})
			return
		}

		isDryRun := c.Query("dryRun") == "true"

		var req ApplyRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid body body, expected {yaml: string}"})
			return
		}

		objects, err := parseYAML(req.YAML)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Failed to parse YAML", "details": err.Error()})
			return
		}

		gr, err := restmapper.GetAPIGroupResources(client.DiscoveryClient)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to discover API resources", "details": err.Error()})
			return
		}
		mapper := restmapper.NewDiscoveryRESTMapper(gr)

		var errorsList []ErrorItem
		for _, obj := range objects {
			gvk := obj.GroupVersionKind()
			mapping, err := mapper.RESTMapping(gvk.GroupKind(), gvk.Version)
			if err != nil {
				errorsList = append(errorsList, ErrorItem{Resource: obj.GetName(), Message: "Unknown resource type: " + err.Error()})
				continue
			}

			var dr dynamicResourceInterface
			if mapping.Scope.Name() == meta.RESTScopeNameRoot {
				dr = client.DynamicClient.Resource(mapping.Resource)
			} else {
				ns := obj.GetNamespace()
				if ns == "" {
					ns = "default"
				}
				dr = client.DynamicClient.Resource(mapping.Resource).Namespace(ns)
			}

			opts := metav1.PatchOptions{
				FieldManager: "k8n",
			}
			if isDryRun {
				opts.DryRun = []string{metav1.DryRunAll}
			}

			// In server-side apply, we must send Apply, but client-go dynamic client only has Patch
			// so we use Patch with ApplyPatchType
			data, err := obj.MarshalJSON()
			if err != nil {
				errorsList = append(errorsList, ErrorItem{Resource: obj.GetName(), Message: "Failed to marshal: " + err.Error()})
				continue
			}

			_, err = dr.Patch(context.Background(), obj.GetName(), types.ApplyPatchType, data, opts)
			if err != nil {
				errorsList = append(errorsList, ErrorItem{Resource: obj.GetName(), Message: err.Error()})
			}
		}

		if len(errorsList) > 0 {
			c.JSON(http.StatusBadRequest, gin.H{"success": false, "errors": errorsList})
			return
		}

		c.JSON(http.StatusOK, gin.H{"success": true})
	}
}

// dynamicResourceInterface is a subset of dynamic.ResourceInterface to simplify testing/mocking if needed
type dynamicResourceInterface interface {
	Patch(ctx context.Context, name string, pt types.PatchType, data []byte, options metav1.PatchOptions, subresources ...string) (*unstructured.Unstructured, error)
}
