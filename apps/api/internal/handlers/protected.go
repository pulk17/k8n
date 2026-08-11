package handlers

import "strings"

// protectedNamespaces are never deleted through k8n.
var protectedNamespaces = []string{
	"kube-system",
	"kube-public",
	"kube-node-lease",
	"local-path-storage",
}

// protectedNames are control-plane and add-on components.
var protectedNames = []string{
	"kubernetes",
	"kube-apiserver",
	"kube-controller-manager",
	"kube-scheduler",
	"kube-proxy",
	"coredns",
	"etcd",
	"local-path-provisioner",
	"metrics-server",
	"kube-root-ca.crt",
}

// IsProtected reports whether a resource is part of the cluster's own
// machinery.
//
// This list used to live only in the frontend, which meant the API and anything
// driving it — including an AI agent — could delete control-plane components
// that the UI refused to touch. Enforcing it server-side makes the rule real.
func IsProtected(name, namespace string) bool {
	for _, ns := range protectedNamespaces {
		if namespace == ns {
			return true
		}
	}
	for _, n := range protectedNames {
		if strings.Contains(name, n) {
			return true
		}
	}
	return false
}
