output "app_url" {
  description = "Open this. Serves the SPA, the API, and the WebSocket on one origin."
  value       = "https://${aws_cloudfront_distribution.main.domain_name}"
}

output "cloudfront_distribution_id" {
  description = "Needed by the frontend workflow to invalidate the cache."
  value       = aws_cloudfront_distribution.main.id
}

output "frontend_bucket" {
  value = aws_s3_bucket.frontend.id
}

output "ecr_repository_url" {
  value = aws_ecr_repository.backend.repository_url
}

output "eks_cluster_name" {
  value = module.eks.cluster_name
}

output "backend_target_group_arn" {
  description = "Consumed by k8s/targetgroupbinding.yaml."
  value       = aws_lb_target_group.backend.arn
}

output "app_secret_name" {
  description = "Secrets Manager entry the deploy workflow projects into Kubernetes."
  value       = aws_secretsmanager_secret.app.name
}

output "github_actions_role_arn" {
  description = "Set as the AWS_ROLE_ARN repository variable in GitHub."
  value       = aws_iam_role.github_actions.arn
}

output "alb_dns_name" {
  description = "Origin for CloudFront. Returns 403 if hit directly - that is intentional."
  value       = aws_lb.main.dns_name
}

output "rds_endpoint" {
  value     = aws_db_instance.postgres.address
  sensitive = true
}

output "redis_endpoint" {
  value     = aws_elasticache_replication_group.redis.primary_endpoint_address
  sensitive = true
}

// Convenience: everything the GitHub workflows need, in one place.
output "github_repository_variables" {
  description = "Copy these into GitHub repo Settings > Variables."
  value = {
    AWS_REGION       = var.region
    AWS_ROLE_ARN     = aws_iam_role.github_actions.arn
    ECR_REPOSITORY   = aws_ecr_repository.backend.repository_url
    EKS_CLUSTER_NAME = module.eks.cluster_name
    FRONTEND_BUCKET  = aws_s3_bucket.frontend.id
    CLOUDFRONT_ID    = aws_cloudfront_distribution.main.id
    APP_SECRET_NAME  = aws_secretsmanager_secret.app.name
    TARGET_GROUP_ARN = aws_lb_target_group.backend.arn
  }
}
