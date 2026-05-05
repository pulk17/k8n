#!/bin/bash
# ============================================
# k8n AWS Deployment Script
# ============================================
# Builds Docker images, pushes to ECR, and deploys via Terraform
#
# Prerequisites:
#   - AWS CLI configured (aws configure)
#   - Docker running
#   - Terraform installed
#
# Usage:
#   chmod +x deploy/aws/deploy.sh
#   ./deploy/aws/deploy.sh [region] [db_password]

set -e

# Configuration
AWS_REGION="${1:-us-east-1}"
DB_PASSWORD="${2:-$(openssl rand -base64 24)}"
PROJECT_NAME="k8n"

echo ""
echo "============================================"
echo "  k8n AWS Deployment"
echo "============================================"
echo "  Region: $AWS_REGION"
echo ""

# Get AWS Account ID
AWS_ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
ECR_BASE="${AWS_ACCOUNT_ID}.dkr.ecr.${AWS_REGION}.amazonaws.com"

echo "[1/5] Initializing Terraform..."
cd deploy/aws
terraform init -input=false

echo ""
echo "[2/5] Creating ECR repositories..."
terraform apply -target=aws_ecr_repository.api -target=aws_ecr_repository.web \
  -var="aws_region=${AWS_REGION}" \
  -var="db_password=${DB_PASSWORD}" \
  -auto-approve -input=false

echo ""
echo "[3/5] Building and pushing Docker images..."
# Login to ECR
aws ecr get-login-password --region "$AWS_REGION" | docker login --username AWS --password-stdin "$ECR_BASE"

# Build and push API
cd ../../
echo "  Building API image..."
docker build -t "${ECR_BASE}/${PROJECT_NAME}-api:latest" -f apps/api/Dockerfile apps/api/
docker push "${ECR_BASE}/${PROJECT_NAME}-api:latest"

# Build and push Web (needs ALB DNS for API URL)
ALB_DNS=$(cd deploy/aws && terraform output -raw alb_dns_name 2>/dev/null || echo "")
API_URL="http://localhost:8080"
if [ -n "$ALB_DNS" ]; then
  API_URL="http://${ALB_DNS}"
fi

echo "  Building Web image (API_URL: ${API_URL})..."
docker build -t "${ECR_BASE}/${PROJECT_NAME}-web:latest" \
  --build-arg NEXT_PUBLIC_API_URL="${API_URL}" \
  -f apps/web/Dockerfile apps/web/
docker push "${ECR_BASE}/${PROJECT_NAME}-web:latest"

echo ""
echo "[4/5] Deploying full infrastructure..."
cd deploy/aws
terraform apply \
  -var="aws_region=${AWS_REGION}" \
  -var="db_password=${DB_PASSWORD}" \
  -var="api_image=${ECR_BASE}/${PROJECT_NAME}-api:latest" \
  -var="web_image=${ECR_BASE}/${PROJECT_NAME}-web:latest" \
  -auto-approve -input=false

echo ""
echo "[5/5] Deployment complete!"
echo ""
echo "============================================"
echo "  k8n is live!"
echo "============================================"
ALB_DNS=$(terraform output -raw alb_dns_name)
echo ""
echo "  URL: http://${ALB_DNS}"
echo "  API: http://${ALB_DNS}/health"
echo ""
echo "  Note: It may take 2-3 minutes for services to start."
echo "  DB Password: ${DB_PASSWORD}"
echo ""
echo "  To tear down:"
echo "    cd deploy/aws && terraform destroy"
echo ""
