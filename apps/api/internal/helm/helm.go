// Package helm runs Helm against the cluster k8n is connected to.
//
// Everything here used to build its configuration from cli.New(), which reads
// the ambient KUBECONFIG and its current-context. That meant picking a context
// on the Connect page changed where resources were applied but *not* where
// charts were installed — you could install into a cluster you were not looking
// at. Every action now takes the active client.
package helm

import (
	"fmt"
	"log"
	"os"

	"github.com/user/k8s-graph-controller/backend/internal/k8s"
	"helm.sh/helm/v3/pkg/action"
	"helm.sh/helm/v3/pkg/chart"
	"helm.sh/helm/v3/pkg/chart/loader"
	"helm.sh/helm/v3/pkg/cli"
	"helm.sh/helm/v3/pkg/release"
	"k8s.io/apimachinery/pkg/api/meta"
	"k8s.io/cli-runtime/pkg/genericclioptions"
	"k8s.io/client-go/discovery"
	"k8s.io/client-go/discovery/cached/memory"
	"k8s.io/client-go/rest"
	"k8s.io/client-go/restmapper"
	"k8s.io/client-go/tools/clientcmd"
	clientcmdapi "k8s.io/client-go/tools/clientcmd/api"
	"sigs.k8s.io/yaml"
)

// clientGetter adapts our REST config to what Helm expects, so Helm talks to
// the same API server as the rest of k8n.
type clientGetter struct {
	config    *rest.Config
	namespace string
}

func (g *clientGetter) ToRESTConfig() (*rest.Config, error) { return g.config, nil }

func (g *clientGetter) ToDiscoveryClient() (discovery.CachedDiscoveryInterface, error) {
	dc, err := discovery.NewDiscoveryClientForConfig(g.config)
	if err != nil {
		return nil, err
	}
	return memory.NewMemCacheClient(dc), nil
}

func (g *clientGetter) ToRESTMapper() (meta.RESTMapper, error) {
	dc, err := g.ToDiscoveryClient()
	if err != nil {
		return nil, err
	}
	return restmapper.NewDeferredDiscoveryRESTMapper(dc), nil
}

func (g *clientGetter) ToRawKubeConfigLoader() clientcmd.ClientConfig {
	return clientcmd.NewDefaultClientConfig(
		*clientcmdapi.NewConfig(),
		&clientcmd.ConfigOverrides{Context: clientcmdapi.Context{Namespace: g.namespace}},
	)
}

var _ genericclioptions.RESTClientGetter = (*clientGetter)(nil)

// Options are the inputs shared by install, upgrade and template.
type Options struct {
	Release   string
	Chart     string
	RepoURL   string
	Version   string
	Namespace string
	Values    string
}

func (o Options) namespaceOrDefault() string {
	if o.Namespace == "" {
		return "default"
	}
	return o.Namespace
}

// settings are only used for chart download locations and the HTTP getters —
// never for cluster connection.
func settings() *cli.EnvSettings { return cli.New() }

// config builds a Helm action configuration for a cluster.
func config(client *k8s.Client, namespace string) (*action.Configuration, error) {
	if client == nil || client.Config == nil {
		return nil, fmt.Errorf("no cluster connection")
	}
	cfg := new(action.Configuration)
	getter := &clientGetter{config: client.Config, namespace: namespace}
	if err := cfg.Init(getter, namespace, os.Getenv("HELM_DRIVER"), log.Printf); err != nil {
		return nil, fmt.Errorf("failed to initialise Helm: %w", err)
	}
	return cfg, nil
}

// chartPathOptions points Helm at a chart without touching the user's
// repositories file. Passing the repository URL directly is what `helm install
// --repo` does; the previous code appended four repositories to ~/.config/helm
// on every install, as a side effect the user never asked for.
func chartPathOptions(o Options) action.ChartPathOptions {
	return action.ChartPathOptions{RepoURL: o.RepoURL, Version: o.Version}
}

func parseValues(raw string) (map[string]interface{}, error) {
	values := map[string]interface{}{}
	if raw == "" {
		return values, nil
	}
	if err := yaml.Unmarshal([]byte(raw), &values); err != nil {
		return nil, fmt.Errorf("values are not valid YAML: %w", err)
	}
	return values, nil
}

// locate downloads and loads the chart an install refers to.
func locate(install *action.Install, o Options) (*chart.Chart, error) {
	path, err := install.ChartPathOptions.LocateChart(o.Chart, settings())
	if err != nil {
		return nil, fmt.Errorf("could not find chart %q: %w", o.Chart, err)
	}
	loaded, err := loader.Load(path)
	if err != nil {
		return nil, fmt.Errorf("could not load chart %q: %w", o.Chart, err)
	}
	return loaded, nil
}

// Template renders a chart to YAML without installing anything.
//
// This is what lets a Helm node join the same review-then-apply flow as the
// rest of the graph: previously a chart was installed straight from the canvas
// with no dry run and no way to see what it would create.
func Template(client *k8s.Client, o Options) (string, error) {
	ns := o.namespaceOrDefault()

	// Rendering works without a cluster; it just cannot check API capabilities.
	var cfg *action.Configuration
	var err error
	if client != nil && client.Config != nil {
		cfg, err = config(client, ns)
		if err != nil {
			return "", err
		}
	} else {
		cfg = new(action.Configuration)
	}

	install := action.NewInstall(cfg)
	install.ReleaseName = o.Release
	install.Namespace = ns
	install.DryRun = true
	install.Replace = true
	install.ClientOnly = client == nil || client.Config == nil
	install.ChartPathOptions = chartPathOptions(o)

	chart, err := locate(install, o)
	if err != nil {
		return "", err
	}
	values, err := parseValues(o.Values)
	if err != nil {
		return "", err
	}

	rendered, err := install.Run(chart, values)
	if err != nil {
		return "", fmt.Errorf("could not render chart: %w", err)
	}
	return rendered.Manifest, nil
}

// Install creates a release on the connected cluster.
func Install(client *k8s.Client, o Options) (*release.Release, error) {
	ns := o.namespaceOrDefault()
	cfg, err := config(client, ns)
	if err != nil {
		return nil, err
	}

	install := action.NewInstall(cfg)
	install.ReleaseName = o.Release
	install.Namespace = ns
	install.CreateNamespace = true
	install.ChartPathOptions = chartPathOptions(o)

	chart, err := locate(install, o)
	if err != nil {
		return nil, err
	}
	values, err := parseValues(o.Values)
	if err != nil {
		return nil, err
	}
	return install.Run(chart, values)
}

// Upgrade updates an existing release, honouring the requested chart version.
func Upgrade(client *k8s.Client, o Options) (*release.Release, error) {
	ns := o.namespaceOrDefault()
	cfg, err := config(client, ns)
	if err != nil {
		return nil, err
	}

	upgrade := action.NewUpgrade(cfg)
	upgrade.Namespace = ns
	upgrade.ChartPathOptions = chartPathOptions(o)

	path, err := upgrade.ChartPathOptions.LocateChart(o.Chart, settings())
	if err != nil {
		return nil, fmt.Errorf("could not find chart %q: %w", o.Chart, err)
	}
	chart, err := loader.Load(path)
	if err != nil {
		return nil, fmt.Errorf("could not load chart %q: %w", o.Chart, err)
	}
	values, err := parseValues(o.Values)
	if err != nil {
		return nil, err
	}
	return upgrade.Run(o.Release, chart, values)
}

// Rollback returns a release to an earlier revision.
func Rollback(client *k8s.Client, name, namespace string, revision int) error {
	cfg, err := config(client, orDefault(namespace))
	if err != nil {
		return err
	}
	rollback := action.NewRollback(cfg)
	rollback.Version = revision
	return rollback.Run(name)
}

// Uninstall removes a release.
func Uninstall(client *k8s.Client, name, namespace string) error {
	cfg, err := config(client, orDefault(namespace))
	if err != nil {
		return err
	}
	_, err = action.NewUninstall(cfg).Run(name)
	return err
}

// List returns the releases in a namespace, or in all of them when empty.
func List(client *k8s.Client, namespace string) ([]*release.Release, error) {
	cfg, err := config(client, orDefault(namespace))
	if err != nil {
		return nil, err
	}
	list := action.NewList(cfg)
	list.All = true
	list.AllNamespaces = namespace == ""
	return list.Run()
}

// Get returns one release, including its rendered manifest.
func Get(client *k8s.Client, name, namespace string) (*release.Release, error) {
	cfg, err := config(client, orDefault(namespace))
	if err != nil {
		return nil, err
	}
	return action.NewGet(cfg).Run(name)
}

// History returns every revision of a release, newest first.
func History(client *k8s.Client, name, namespace string) ([]*release.Release, error) {
	cfg, err := config(client, orDefault(namespace))
	if err != nil {
		return nil, err
	}
	history := action.NewHistory(cfg)
	history.Max = 20
	return history.Run(name)
}

func orDefault(namespace string) string {
	if namespace == "" {
		return "default"
	}
	return namespace
}
