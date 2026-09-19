package k8s

import (
	"fmt"

	"k8s.io/client-go/discovery"
	"k8s.io/client-go/dynamic"
	"k8s.io/client-go/kubernetes"
	"k8s.io/client-go/rest"
	"k8s.io/client-go/tools/clientcmd"
)

// Client holds the various K8s clients we need
type Client struct {
	Clientset       *kubernetes.Clientset
	DynamicClient   *dynamic.DynamicClient
	DiscoveryClient discovery.DiscoveryInterface
	Config          *rest.Config
	Context         string
}

// loadingRules is how kubectl itself finds a kubeconfig: $KUBECONFIG when it is
// set — including several paths joined by the platform's list separator, merged
// in order — and ~/.kube/config otherwise.
//
// This used to be hard-coded to ~/.kube/config, so anyone who keeps their
// clusters elsewhere (which is normal with more than one) opened k8n to no
// contexts at all and no explanation.
func loadingRules() *clientcmd.ClientConfigLoadingRules {
	return clientcmd.NewDefaultClientConfigLoadingRules()
}

// GetContexts returns the contexts from the kubeconfig in force.
func GetContexts() ([]string, error) {
	config, err := loadingRules().Load()
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
		// Fallback to the local kubeconfig, found the way kubectl finds it.
		configOverrides := &clientcmd.ConfigOverrides{}
		if contextName != "" {
			configOverrides.CurrentContext = contextName
		}

		clientConfig := clientcmd.NewNonInteractiveDeferredLoadingClientConfig(loadingRules(), configOverrides)
		config, err = clientConfig.ClientConfig()
		if err != nil {
			return nil, fmt.Errorf("failed to load kubeconfig client config: %w", err)
		}
		// The default context still has a name, and the UI shows it so nobody
		// applies to the wrong cluster without seeing which one it is.
		if contextName == "" {
			if raw, err := clientConfig.RawConfig(); err == nil {
				contextName = raw.CurrentContext
			}
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
