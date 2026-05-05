package handlers

import (
	"database/sql"
	"encoding/json"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	_ "github.com/lib/pq"
)

var db *sql.DB

func InitDB(dsn string) error {
	var err error
	db, err = sql.Open("postgres", dsn)
	if err != nil {
		return err
	}

	// Configure connection pool to prevent exhaustion under load
	db.SetMaxOpenConns(25)
	db.SetMaxIdleConns(5)
	db.SetConnMaxLifetime(5 * time.Minute)

	return db.Ping()
}

func GetDB() *sql.DB {
	return db
}

type SaveGraphRequest struct {
	ID        string      `json:"id,omitempty"`
	Name      string      `json:"name"`
	Namespace string      `json:"namespace"`
	GraphJSON interface{} `json:"graph_json"` // React Flow generic state
}

func SaveGraph() gin.HandlerFunc {
	return func(c *gin.Context) {
		if db == nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Database not initialized"})
			return
		}

		var req SaveGraphRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}

		graphID := req.ID
		if graphID == "" {
			graphID = uuid.New().String()
		}

		graphJsonBytes, err := json.Marshal(req.GraphJSON)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to serialize graph JSON"})
			return
		}

		query := `
			INSERT INTO graphs (id, name, namespace, graph_json, updated_at) 
			VALUES ($1, $2, $3, $4, NOW())
			ON CONFLICT (id) DO UPDATE SET 
				name = EXCLUDED.name, 
				namespace = EXCLUDED.namespace, 
				graph_json = EXCLUDED.graph_json,
				updated_at = NOW()
		`

		_, err = db.Exec(query, graphID, req.Name, req.Namespace, string(graphJsonBytes))
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Database error", "details": err.Error()})
			return
		}

		c.JSON(http.StatusOK, gin.H{"id": graphID, "status": "saved"})
	}
}

func LoadGraph() gin.HandlerFunc {
	return func(c *gin.Context) {
		if db == nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Database not initialized"})
			return
		}

		id := c.Param("id")
		
		var req SaveGraphRequest
		var graphJsonStr string
		err := db.QueryRow("SELECT id, name, namespace, graph_json FROM graphs WHERE id = $1", id).Scan(&req.ID, &req.Name, &req.Namespace, &graphJsonStr)
		if err != nil {
			if err == sql.ErrNoRows {
				c.JSON(http.StatusNotFound, gin.H{"error": "Graph not found"})
				return
			}
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Database error", "details": err.Error()})
			return
		}

		if err := json.Unmarshal([]byte(graphJsonStr), &req.GraphJSON); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to parse stored JSON", "details": err.Error()})
			return
		}

		c.JSON(http.StatusOK, req)
	}
}

func ListGraphs() gin.HandlerFunc {
	return func(c *gin.Context) {
		if db == nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Database not initialized"})
			return
		}

		rows, err := db.Query("SELECT id, name, namespace, created_at, updated_at FROM graphs ORDER BY updated_at DESC")
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Database error", "details": err.Error()})
			return
		}
		defer rows.Close()

		var graphs []map[string]interface{}
		for rows.Next() {
			var id, name, namespace string
			var createdAt, updatedAt interface{}
			if err := rows.Scan(&id, &name, &namespace, &createdAt, &updatedAt); err != nil {
				continue
			}
			graphs = append(graphs, map[string]interface{}{
				"id":         id,
				"name":       name,
				"namespace":  namespace,
				"created_at": createdAt,
				"updated_at": updatedAt,
			})
		}

		if graphs == nil {
			graphs = []map[string]interface{}{}
		}

		c.JSON(http.StatusOK, graphs)
	}
}


func DeleteGraph() gin.HandlerFunc {
	return func(c *gin.Context) {
		if db == nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Database not initialized"})
			return
		}

		graphID := c.Param("id")
		if graphID == "" {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Graph ID is required"})
			return
		}

		_, err := db.Exec("DELETE FROM graphs WHERE id = $1", graphID)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to delete graph", "details": err.Error()})
			return
		}

		c.JSON(http.StatusOK, gin.H{"message": "Graph deleted successfully"})
	}
}
