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
}

// NewClient initializes a new Kubernetes client
// It tries to load in-cluster config first, then falls back to ~/.kube/config
func NewClient() (*Client, error) {
	var config *rest.Config
	var err error

	// 1. Try In-Cluster Config
	config, err = rest.InClusterConfig()
	if err != nil {
		// 2. Fallback to local kubeconfig
		var kubeconfig string
		if home := homedir.HomeDir(); home != "" {
			kubeconfig = filepath.Join(home, ".kube", "config")
		} else {
			return nil, fmt.Errorf("could not find kubeconfig and not running in cluster")
		}

		// Check if we can build from flags
		config, err = clientcmd.BuildConfigFromFlags("", kubeconfig)
		if err != nil {
			return nil, fmt.Errorf("failed to load kubeconfig: %w", err)
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
