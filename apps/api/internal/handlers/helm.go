package handlers

import (
	"encoding/json"
	"net/http"

	"github.com/gin-gonic/gin"
)

type HubSearchResponse struct {
	Packages []struct {
		Name        string `json:"name"`
		Description string `json:"description"`
		Repository  struct {
			Name string `json:"name"`
			Url  string `json:"url"`
		} `json:"repository"`
	} `json:"packages"`
}

// SearchHelmCharts queries Artifact Hub for helm charts
func SearchHelmCharts() gin.HandlerFunc {
	return func(c *gin.Context) {
		query := c.Query("q")
		if query == "" {
			query = "nginx" // Default for testing
		}

		// Query artifact hub
		req, err := http.NewRequest("GET", "https://artifacthub.io/api/v1/packages/search?kind=0&ts_query_web="+query, nil)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to construct request", "details": err.Error()})
			return
		}
		
		req.Header.Set("Accept", "application/json")
		
		client := &http.Client{}
		resp, err := client.Do(req)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to search artifact hub", "details": err.Error()})
			return
		}
		defer resp.Body.Close()

		var hubResp HubSearchResponse
		if err := json.NewDecoder(resp.Body).Decode(&hubResp); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to decode artifact hub response", "details": err.Error()})
			return
		}
		
		c.JSON(http.StatusOK, hubResp.Packages)
	}
}
