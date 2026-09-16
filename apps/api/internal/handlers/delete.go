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

	if err := dr.Delete(ctx, name, opts); err != nil {
		return err
	}

	// "Deleted" from the API server means "marked for deletion". If a finalizer
	// is holding the object, it stays in the list looking untouched — which is
	// how a LoadBalancer Service on a cluster with no load balancer behaves, and
	// it reads as k8n having ignored the request. Say what really happened.
	if held, holders := stillHeld(ctx, dr, name); held {
		return &PendingDeletionError{Kind: kind, Name: name, Finalizers: holders}
	}
	return nil
}

// PendingDeletionError says the delete was accepted but something is holding
// the object. It is not a failure — the caller reports it as the state it is.
type PendingDeletionError struct {
	Kind       string
	Name       string
	Finalizers []string
}

func (e *PendingDeletionError) Error() string {
	return fmt.Sprintf("%s %q is terminating: %s has not released it",
		e.Kind, e.Name, strings.Join(e.Finalizers, ", "))
}

// Hint is what to actually do about it, which is usually "nothing on this
// cluster ever will".
func (e *PendingDeletionError) Hint() string {
	for _, f := range e.Finalizers {
		if strings.Contains(f, "load-balancer-cleanup") {
			return fmt.Sprintf(
				"This is a LoadBalancer Service on a cluster with no load balancer, so nothing will ever clear it. "+
					"Remove the finalizer by hand: kubectl patch svc %s -p '{\"metadata\":{\"finalizers\":[]}}' --type=merge",
				e.Name)
		}
	}
	return "It disappears when whatever owns that finalizer releases it. Until then the object stays in the list."
}

// stillHeld re-reads the object: gone means gone, present with a deletion
// timestamp means a finalizer has it.
func stillHeld(ctx context.Context, dr dynamic.ResourceInterface, name string) (bool, []string) {
	obj, err := dr.Get(ctx, name, metav1.GetOptions{})
	if err != nil || obj == nil {
		return false, nil
	}
	if obj.GetDeletionTimestamp() == nil {
		return false, nil
	}
	finalizers := obj.GetFinalizers()
	if len(finalizers) == 0 {
		finalizers = []string{"the cluster"}
	}
	return true, finalizers
}
