package handlers

import (
	"context"
	"fmt"
	"strings"

	"github.com/user/k8s-graph-controller/backend/internal/k8s"
	"k8s.io/apimachinery/pkg/api/meta"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/runtime/schema"
	"k8s.io/client-go/dynamic"
	"k8s.io/client-go/restmapper"
)

// ErrProtected is returned when a delete targets cluster machinery.
var ErrProtected = fmt.Errorf("resource is part of the cluster's own machinery and cannot be deleted through k8n")

// resolveKind turns a bare kind name ("Deployment", "HorizontalPodAutoscaler",
// a CRD's kind) into the REST mapping for it, the same way kubectl resolves a
// resource argument.
func resolveKind(client *k8s.Client, kind string) (*meta.RESTMapping, error) {
	groups, err := restmapper.GetAPIGroupResources(client.DiscoveryClient)
	if err != nil {
		return nil, fmt.Errorf("failed to discover API resources: %w", err)
	}
	mapper := restmapper.NewDiscoveryRESTMapper(groups)

	// KindsFor resolves a partial reference; the first result is the one from
	// the preferred API version.
	kinds, err := mapper.KindsFor(schema.GroupVersionResource{Resource: strings.ToLower(kind)})
	if err != nil || len(kinds) == 0 {
		return nil, fmt.Errorf("unknown resource kind %q", kind)
	}

	return mapper.RESTMapping(kinds[0].GroupKind(), kinds[0].Version)
}

// DeleteResource removes a resource by kind and name.
//
// It used to switch over a hardcoded list of eleven kinds, so anything the
// canvas could create but that list did not mention — PVCs, HPAs, RBAC, every
// CRD — could be deployed and then never cleaned up. Discovery handles all of
// them.
//
// force means what it means in kubectl: no grace period, background cascade.
// Use it for objects stuck terminating, not as a way past the protection check.
func DeleteResource(ctx context.Context, client *k8s.Client, kind, name, namespace string, force bool) error {
	if client == nil || client.DynamicClient == nil {
		return fmt.Errorf("no cluster connection")
	}
	if IsProtected(name, namespace) {
		return ErrProtected
	}

	mapping, err := resolveKind(client, kind)
	if err != nil {
		return err
	}

	var dr dynamic.ResourceInterface = client.DynamicClient.Resource(mapping.Resource)
	if mapping.Scope.Name() != meta.RESTScopeNameRoot {
		if namespace == "" {
			namespace = "default"
		}
		dr = client.DynamicClient.Resource(mapping.Resource).Namespace(namespace)
	}

	opts := metav1.DeleteOptions{}
	if force {
		grace := int64(0)
		policy := metav1.DeletePropagationBackground
		opts.GracePeriodSeconds = &grace
		opts.PropagationPolicy = &policy
	}

	return dr.Delete(ctx, name, opts)
}
