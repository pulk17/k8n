package handlers

import (
	"log"
	"os"

	"helm.sh/helm/v3/pkg/action"
	"helm.sh/helm/v3/pkg/cli"
)

// getHelmActionConfig creates and initializes a Helm action.Configuration for the given namespace.
// This eliminates the repeated 5-line init pattern used across all Helm handlers.
func getHelmActionConfig(namespace string) (*action.Configuration, *cli.EnvSettings, error) {
	if namespace == "" {
		namespace = "default"
	}

	settings := cli.New()
	settings.SetNamespace(namespace)

	actionConfig := new(action.Configuration)
	if err := actionConfig.Init(settings.RESTClientGetter(), namespace, os.Getenv("HELM_DRIVER"), log.Printf); err != nil {
		return nil, nil, err
	}

	return actionConfig, settings, nil
}
