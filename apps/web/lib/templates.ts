import { Node } from "reactflow";

export type TemplateIcon = "web" | "microservices" | "observability" | "batch";

export interface Template {
  id: string;
  name: string;
  description: string;
  category: string;
  nodes: Omit<Node, 'id'>[];
  // Styling is not stored: makeEdge derives colour and animation from the
  // connection type, so an edge here is only which node joins which.
  edges: { sourceIdx: number; targetIdx: number }[];
  /** Key into TEMPLATE_ICONS; see WorkflowManager. */
  icon: TemplateIcon;
}

export const templates: Template[] = [
  {
    id: "production-web-app",
    name: "Production Web App",
    description: "Full production setup with auto-scaling, ingress, config, and secrets",
    category: "Web",
    icon: "web",
    nodes: [
      {
        type: "k8sNode",
        position: { x: 50, y: 50 },
        data: {
          kind: "ConfigMap",
          name: "app-config",
          namespace: "default",
          status: "Not Deployed",
          configData: "APP_ENV=production\nLOG_LEVEL=info\nAPI_TIMEOUT=30",
        },
      },
      {
        type: "k8sNode",
        position: { x: 50, y: 200 },
        data: {
          kind: "Secret",
          name: "app-secrets",
          namespace: "default",
          status: "Not Deployed",
          secretType: "Opaque",
          secretData: "API_KEY=your-api-key\nDB_PASSWORD=your-db-password",
        },
      },
      {
        type: "k8sNode",
        position: { x: 350, y: 100 },
        data: {
          kind: "Deployment",
          name: "web-app",
          namespace: "default",
          status: "Not Deployed",
          replicas: 3,
          image: "nginx:alpine",
          containerPort: 80,
        },
      },
      {
        type: "k8sNode",
        position: { x: 650, y: 100 },
        data: {
          kind: "Service",
          name: "web-service",
          namespace: "default",
          status: "Not Deployed",
          port: 80,
          targetPort: 80,
          serviceType: "ClusterIP",
        },
      },
      {
        type: "k8sNode",
        position: { x: 950, y: 100 },
        data: {
          kind: "Ingress",
          name: "web-ingress",
          namespace: "default",
          status: "Not Deployed",
          host: "myapp.example.com",
          path: "/",
          tlsEnabled: true,
        },
      },
      {
        type: "k8sNode",
        position: { x: 350, y: 300 },
        data: {
          kind: "HorizontalPodAutoscaler",
          name: "web-app-hpa",
          namespace: "default",
          status: "Not Deployed",
          minReplicas: 3,
          maxReplicas: 10,
          targetCPU: 70,
        },
      },
    ],
    edges: [
      { sourceIdx: 0, targetIdx: 2 },
      { sourceIdx: 1, targetIdx: 2 },
      { sourceIdx: 3, targetIdx: 2 },
      { sourceIdx: 4, targetIdx: 3 },
      { sourceIdx: 5, targetIdx: 2 },
    ],
  },
  {
    id: "microservices-full-stack",
    name: "Microservices Stack",
    description: "Complete microservices with frontend, backend, database, and cache",
    category: "Full Stack",
    icon: "microservices",
    nodes: [
      {
        type: "k8sNode",
        position: { x: 50, y: 50 },
        data: {
          kind: "Deployment",
          name: "frontend",
          namespace: "default",
          status: "Not Deployed",
          replicas: 2,
          image: "nginx:alpine",
          containerPort: 80,
        },
      },
      {
        type: "k8sNode",
        position: { x: 350, y: 50 },
        data: {
          kind: "Service",
          name: "frontend-svc",
          namespace: "default",
          status: "Not Deployed",
          port: 80,
          targetPort: 80,
          serviceType: "LoadBalancer",
        },
      },
      {
        type: "k8sNode",
        position: { x: 50, y: 200 },
        data: {
          kind: "ConfigMap",
          name: "backend-config",
          namespace: "default",
          status: "Not Deployed",
          configData: "DB_HOST=postgres-svc\nREDIS_HOST=redis-svc\nPORT=8080",
        },
      },
      {
        type: "k8sNode",
        position: { x: 350, y: 200 },
        data: {
          kind: "Deployment",
          name: "backend-api",
          namespace: "default",
          status: "Not Deployed",
          replicas: 3,
          image: "hashicorp/http-echo:latest",
          containerPort: 8080,
          command: ["/http-echo"],
          args: ["-listen=:8080", "-text=backend-api running"],
        },
      },
      {
        type: "k8sNode",
        position: { x: 650, y: 200 },
        data: {
          kind: "Service",
          name: "backend-svc",
          namespace: "default",
          status: "Not Deployed",
          port: 8080,
          targetPort: 8080,
          serviceType: "ClusterIP",
        },
      },
      {
        type: "k8sNode",
        position: { x: 350, y: 380 },
        data: {
          kind: "HorizontalPodAutoscaler",
          name: "backend-hpa",
          namespace: "default",
          status: "Not Deployed",
          minReplicas: 3,
          maxReplicas: 15,
          targetCPU: 75,
        },
      },
      {
        type: "k8sNode",
        position: { x: 50, y: 550 },
        data: {
          kind: "Deployment",
          name: "redis-cache",
          namespace: "default",
          status: "Not Deployed",
          replicas: 1,
          image: "redis:7-alpine",
          containerPort: 6379,
        },
      },
      {
        type: "k8sNode",
        position: { x: 350, y: 550 },
        data: {
          kind: "Service",
          name: "redis-svc",
          namespace: "default",
          status: "Not Deployed",
          port: 6379,
          targetPort: 6379,
          serviceType: "ClusterIP",
        },
      },
      {
        type: "k8sNode",
        position: { x: 50, y: 700 },
        data: {
          kind: "Secret",
          name: "postgres-secret",
          namespace: "default",
          status: "Not Deployed",
          secretType: "Opaque",
          secretData: "POSTGRES_PASSWORD=securepassword\nPOSTGRES_USER=appuser",
        },
      },
      {
        type: "k8sNode",
        position: { x: 50, y: 850 },
        data: {
          kind: "PersistentVolumeClaim",
          name: "postgres-pvc",
          namespace: "default",
          status: "Not Deployed",
          storageSize: "20Gi",
          accessMode: "ReadWriteOnce",
          storageClass: "standard",
        },
      },
      {
        type: "k8sNode",
        position: { x: 350, y: 775 },
        data: {
          kind: "StatefulSet",
          name: "postgres-db",
          namespace: "default",
          status: "Not Deployed",
          replicas: 1,
          image: "postgres:15-alpine",
          containerPort: 5432,
          serviceName: "postgres-svc",
          envVars: [
            { name: "POSTGRES_USER", value: "appuser" },
            { name: "POSTGRES_PASSWORD", value: "securepassword" },
            { name: "POSTGRES_DB", value: "appdb" },
          ],
        },
      },
      {
        type: "k8sNode",
        position: { x: 650, y: 775 },
        data: {
          kind: "Service",
          name: "postgres-svc",
          namespace: "default",
          status: "Not Deployed",
          port: 5432,
          targetPort: 5432,
          serviceType: "ClusterIP",
        },
      },
    ],
    edges: [
      { sourceIdx: 1, targetIdx: 0 },
      { sourceIdx: 2, targetIdx: 3 },
      { sourceIdx: 4, targetIdx: 3 },
      { sourceIdx: 5, targetIdx: 3 },
      { sourceIdx: 7, targetIdx: 6 },
      { sourceIdx: 8, targetIdx: 10 },
      { sourceIdx: 9, targetIdx: 10 },
      { sourceIdx: 11, targetIdx: 10 },
    ],
  },
  {
    id: "monitoring-stack",
    name: "Monitoring & Logging",
    description: "Observability stack with Prometheus, Grafana, and Fluentd",
    category: "Monitoring",
    icon: "observability",
    nodes: [
      {
        type: "k8sNode",
        position: { x: 50, y: 50 },
        data: {
          kind: "ConfigMap",
          name: "prometheus-config",
          namespace: "monitoring",
          status: "Not Deployed",
          configData: "global:\n  scrape_interval: 15s\n  evaluation_interval: 15s",
        },
      },
      {
        type: "k8sNode",
        position: { x: 350, y: 50 },
        data: {
          kind: "Deployment",
          name: "prometheus",
          namespace: "monitoring",
          status: "Not Deployed",
          replicas: 1,
          image: "prom/prometheus:v2.45.0",
          containerPort: 9090,
        },
      },
      {
        type: "k8sNode",
        position: { x: 650, y: 50 },
        data: {
          kind: "Service",
          name: "prometheus-svc",
          namespace: "monitoring",
          status: "Not Deployed",
          port: 9090,
          targetPort: 9090,
          serviceType: "ClusterIP",
        },
      },
      {
        type: "k8sNode",
        position: { x: 50, y: 250 },
        data: {
          kind: "ConfigMap",
          name: "grafana-datasources",
          namespace: "monitoring",
          status: "Not Deployed",
          configData: "apiVersion: 1\ndatasources:\n  - name: Prometheus\n    type: prometheus\n    url: http://prometheus-svc:9090\n    access: proxy\n    isDefault: true",
        },
      },
      {
        type: "k8sNode",
        position: { x: 350, y: 250 },
        data: {
          kind: "Deployment",
          name: "grafana",
          namespace: "monitoring",
          status: "Not Deployed",
          replicas: 1,
          image: "grafana/grafana:10.0.0",
          containerPort: 3000,
        },
      },
      {
        type: "k8sNode",
        position: { x: 650, y: 250 },
        data: {
          kind: "Service",
          name: "grafana-svc",
          namespace: "monitoring",
          status: "Not Deployed",
          port: 3000,
          targetPort: 3000,
          serviceType: "LoadBalancer",
        },
      },
      {
        type: "k8sNode",
        position: { x: 50, y: 450 },
        data: {
          kind: "ConfigMap",
          name: "fluentd-config",
          namespace: "monitoring",
          status: "Not Deployed",
          configData: "<source>\n  @type tail\n  path /var/log/containers/*.log\n  pos_file /var/log/fluentd-containers.log.pos\n  tag kubernetes.*\n  read_from_head true\n</source>",
        },
      },
      {
        type: "k8sNode",
        position: { x: 350, y: 450 },
        data: {
          kind: "DaemonSet",
          name: "fluentd-logger",
          namespace: "monitoring",
          status: "Not Deployed",
          image: "fluent/fluentd-kubernetes-daemonset:v1.16-debian-elasticsearch7-1",
          containerPort: 24224,
        },
      },
    ],
    edges: [
      { sourceIdx: 0, targetIdx: 1 },
      { sourceIdx: 2, targetIdx: 1 },
      { sourceIdx: 3, targetIdx: 4 },
      { sourceIdx: 5, targetIdx: 4 },
      { sourceIdx: 6, targetIdx: 7 },
    ],
  },
  {
    id: "batch-processing",
    name: "Batch Processing Pipeline",
    description: "ETL pipeline with scheduled jobs and auto-scaling workers",
    category: "Jobs",
    icon: "batch",
    nodes: [
      {
        type: "k8sNode",
        position: { x: 50, y: 50 },
        data: {
          kind: "Deployment",
          name: "redis-queue",
          namespace: "default",
          status: "Not Deployed",
          replicas: 1,
          image: "redis:7-alpine",
          containerPort: 6379,
        },
      },
      {
        type: "k8sNode",
        position: { x: 350, y: 50 },
        data: {
          kind: "Service",
          name: "redis-queue-svc",
          namespace: "default",
          status: "Not Deployed",
          port: 6379,
          targetPort: 6379,
          serviceType: "ClusterIP",
        },
      },
      {
        type: "k8sNode",
        position: { x: 50, y: 200 },
        data: {
          kind: "ConfigMap",
          name: "job-config",
          namespace: "default",
          status: "Not Deployed",
          configData: "BATCH_SIZE=1000\nRETRY_COUNT=3\nTIMEOUT=300\nREDIS_HOST=redis-queue-svc\nREDIS_PORT=6379",
        },
      },
      {
        type: "k8sNode",
        position: { x: 350, y: 200 },
        data: {
          kind: "CronJob",
          name: "data-ingestion",
          namespace: "default",
          status: "Not Deployed",
          image: "busybox:latest",
          schedule: "*/5 * * * *",
          spec: "schedule: \"*/5 * * * *\"\njobTemplate:\n  spec:\n    template:\n      spec:\n        containers:\n        - name: ingestion\n          image: busybox:latest\n          command: [\"sh\", \"-c\", \"echo 'Ingesting data at' $(date); sleep 10; echo 'Done'\"]\n        restartPolicy: OnFailure",
        },
      },
      {
        type: "k8sNode",
        position: { x: 650, y: 200 },
        data: {
          kind: "Deployment",
          name: "processing-worker",
          namespace: "default",
          status: "Not Deployed",
          replicas: 3,
          image: "busybox:latest",
          containerPort: 8080,
          spec: "replicas: 3\ntemplate:\n  spec:\n    containers:\n    - name: worker\n      image: busybox:latest\n      command: [\"sh\", \"-c\", \"while true; do echo 'Processing job at' $(date); sleep 30; done\"]\n      env:\n      - name: REDIS_HOST\n        valueFrom:\n          configMapKeyRef:\n            name: job-config\n            key: REDIS_HOST",
        },
      },
      {
        type: "k8sNode",
        position: { x: 650, y: 380 },
        data: {
          kind: "HorizontalPodAutoscaler",
          name: "worker-hpa",
          namespace: "default",
          status: "Not Deployed",
          minReplicas: 3,
          maxReplicas: 20,
          targetCPU: 80,
        },
      },
      {
        type: "k8sNode",
        position: { x: 50, y: 380 },
        data: {
          kind: "CronJob",
          name: "cleanup-job",
          namespace: "default",
          status: "Not Deployed",
          image: "busybox:latest",
          schedule: "0 2 * * *",
          spec: "schedule: \"0 2 * * *\"\njobTemplate:\n  spec:\n    template:\n      spec:\n        containers:\n        - name: cleanup\n          image: busybox:latest\n          command: [\"sh\", \"-c\", \"echo 'Cleaning up old data at' $(date); sleep 5; echo 'Cleanup complete'\"]\n        restartPolicy: OnFailure",
        },
      },
    ],
    edges: [
      { sourceIdx: 1, targetIdx: 0 },
      { sourceIdx: 2, targetIdx: 3 },
      { sourceIdx: 2, targetIdx: 4 },
      { sourceIdx: 5, targetIdx: 4 },
      { sourceIdx: 2, targetIdx: 6 },
    ],
  },
];

export function getTemplatesByCategory(category: string): Template[] {
  return templates.filter(t => t.category === category);
}

export function getAllCategories(): string[] {
  return Array.from(new Set(templates.map(t => t.category)));
}
