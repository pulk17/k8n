package k8s

import (
	"fmt"
	"path/filepath"

	"k8s.io/client-go/discovery"
	"k8s.io/client-go/dynamic"
	"k8s.io/client-go/kubernetes"
	"k8s.io/client-go/rest"
	"k8s.io/client-go/tools/clientcmd"
	"k8s.io/client-go/util/homedir"
)

// Client holds the various K8s clients we need
type Client struct {
	Clientset       *kubernetes.Clientset
	DynamicClient   *dynamic.DynamicClient
	DiscoveryClient discovery.DiscoveryInterface
	Config          *rest.Config
	Context         string
}

func getKubeconfigFile() (string, error) {
	if home := homedir.HomeDir(); home != "" {
		return filepath.Join(home, ".kube", "config"), nil
	}
	return "", fmt.Errorf("could not find home directory")
}

// GetContexts returns a list of available contexts from ~/.kube/config
func GetContexts() ([]string, error) {
	kubeconfig, err := getKubeconfigFile()
	if err != nil {
		return nil, err
	}

	config, err := clientcmd.LoadFromFile(kubeconfig)
	if err != nil {
		return nil, fmt.Errorf("failed to load kubeconfig: %w", err)
	}

	var contexts []string
	for name := range config.Contexts {
		contexts = append(contexts, name)
	}
	return contexts, nil
}

// NewClient initializes a new Kubernetes client
// If contextName is empty, it uses the default context or in-cluster config
func NewClient(contextName string) (*Client, error) {
	var config *rest.Config
	var err error

	if contextName == "" {
		// Try In-Cluster Config first
		config, err = rest.InClusterConfig()
	}

	if config == nil || err != nil {
		// Fallback to local kubeconfig
		kubeconfig, err := getKubeconfigFile()
		if err != nil {
			return nil, err
		}

		loadingRules := &clientcmd.ClientConfigLoadingRules{ExplicitPath: kubeconfig}
		configOverrides := &clientcmd.ConfigOverrides{}
		if contextName != "" {
			configOverrides.CurrentContext = contextName
		}

		clientConfig := clientcmd.NewNonInteractiveDeferredLoadingClientConfig(loadingRules, configOverrides)
		config, err = clientConfig.ClientConfig()
		if err != nil {
			return nil, fmt.Errorf("failed to load kubeconfig client config: %w", err)
		}
	}

	clientset, err := kubernetes.NewForConfig(config)
	if err != nil {
		return nil, fmt.Errorf("failed to create clientset: %w", err)
	}

	dynamicClient, err := dynamic.NewForConfig(config)
	if err != nil {
		return nil, fmt.Errorf("failed to create dynamic client: %w", err)
	}

	return &Client{
		Clientset:       clientset,
		DynamicClient:   dynamicClient,
		DiscoveryClient: clientset.Discovery(),
		Config:          config,
		Context:         contextName,
	}, nil
}

// CheckConnection verifies we can talk to the API server
func (c *Client) CheckConnection() (string, error) {
	version, err := c.DiscoveryClient.ServerVersion()
	if err != nil {
		return "", err
	}
	return version.String(), nil
}
