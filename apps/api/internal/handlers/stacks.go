package handlers

import (
	"regexp"
	"strings"
)

// A stack is the unit people think in — "the grafana install", "my shop
// workflow" — rather than the dozen objects it is made of. k8n reads it from
// what Kubernetes already records:
//
//   - a Helm release (the annotation Helm puts on everything it installs, or
//     the labels on its own release Secret);
//   - app.kubernetes.io/part-of, which k8n writes on everything it applies
//     and many charts and operators set too;
//   - app.kubernetes.io/instance, the other common convention;
//
// and a Pod or ReplicaSet without any of them belongs to its owner's stack.

const (
	partOfLabel    = "app.kubernetes.io/part-of"
	managedByLabel = "app.kubernetes.io/managed-by"
)

var labelUnsafe = regexp.MustCompile(`[^a-z0-9._-]+`)

// stackLabelValue turns a workflow name into a valid label value.
func stackLabelValue(name string) string {
	v := labelUnsafe.ReplaceAllString(strings.ToLower(strings.TrimSpace(name)), "-")
	v = strings.Trim(v, "-._")
	if len(v) > 63 {
		v = strings.Trim(v[:63], "-._")
	}
	return v
}

// labelStack marks a compiled object as part of a stack.
func labelStack(obj map[string]interface{}, stack string) {
	value := stackLabelValue(stack)
	if value == "" {
		return
	}
	meta, _ := obj["metadata"].(map[string]interface{})
	if meta == nil {
		return
	}
	labels := map[string]interface{}{}
	switch existing := meta["labels"].(type) {
	case map[string]interface{}:
		labels = existing
	case map[string]string:
		for k, v := range existing {
			labels[k] = v
		}
	}
	labels[partOfLabel] = value
	labels[managedByLabel] = "k8n"
	meta["labels"] = labels
}

// stackOf reads one resource's stack from its own labels and annotations.
func stackOf(r Resource) (name, source string) {
	if rel := r.Annotations["meta.helm.sh/release-name"]; rel != "" {
		return rel, "helm"
	}
	if r.Labels["owner"] == "helm" && r.Labels["name"] != "" && strings.HasPrefix(r.Name, "sh.helm.release.") {
		return r.Labels["name"], "helm"
	}
	if v := r.Labels[partOfLabel]; v != "" {
		if r.Labels[managedByLabel] == "k8n" {
			return v, "k8n"
		}
		return v, "label"
	}
	if v := r.Labels["app.kubernetes.io/instance"]; v != "" {
		if r.Labels[managedByLabel] == "Helm" {
			return v, "helm"
		}
		return v, "label"
	}
	return "", ""
}

// assignStacks fills in every resource's stack, inheriting from owners for
// the Pods and ReplicaSets that carry no labels of their own.
func assignStacks(resources []Resource) {
	type stack struct{ name, source string }
	byName := map[string]stack{}
	for i := range resources {
		r := &resources[i]
		r.Stack, r.StackSource = stackOf(*r)
		if r.Stack != "" {
			byName[r.Namespace+"/"+r.Name] = stack{r.Stack, r.StackSource}
		}
	}
	// Two passes: Pod -> ReplicaSet -> Deployment.
	for pass := 0; pass < 2; pass++ {
		for i := range resources {
			r := &resources[i]
			if r.Stack != "" {
				continue
			}
			for _, owner := range r.OwnerReferences {
				if s, ok := byName[r.Namespace+"/"+owner]; ok {
					r.Stack, r.StackSource = s.name, s.source
					byName[r.Namespace+"/"+r.Name] = s
					break
				}
			}
		}
	}
	// One name, one stack: a chart's pods carry its instance label but not
	// Helm's annotation, and must still count as the release's.
	helm := map[string]bool{}
	for _, r := range resources {
		if r.StackSource == "helm" {
			helm[r.Namespace+"/"+r.Stack] = true
		}
	}
	for i := range resources {
		if r := &resources[i]; r.Stack != "" && helm[r.Namespace+"/"+r.Stack] {
			r.StackSource = "helm"
		}
	}
}
