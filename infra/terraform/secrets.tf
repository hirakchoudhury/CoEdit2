data "aws_caller_identity" "current" {}

resource "random_password" "jwt" {
  length  = 64
  special = false
}

// One secret holds everything the pods need at runtime. The deploy workflow
// reads it and projects it into a Kubernetes Secret, so credentials never sit
// in git and never pass through workflow logs.
//
// Rotating any of these is a `terraform taint` on the relevant random_password
// plus a re-run of the backend deploy workflow. Rotating JWT_SECRET
// invalidates every issued token, so every user is signed out.
resource "aws_secretsmanager_secret" "app" {
  name                    = "${local.name}/app"
  description             = "Runtime credentials for the CoEdit backend"
  recovery_window_in_days = 7
}

resource "aws_secretsmanager_secret_version" "app" {
  secret_id = aws_secretsmanager_secret.app.id
  secret_string = jsonencode({
    POSTGRES_HOST     = aws_db_instance.postgres.address
    POSTGRES_PORT     = tostring(aws_db_instance.postgres.port)
    POSTGRES_DB       = var.db_name
    POSTGRES_USER     = var.db_username
    POSTGRES_PASSWORD = random_password.db.result
    REDIS_HOST        = aws_elasticache_replication_group.redis.primary_endpoint_address
    REDIS_PORT        = "6379"
    REDIS_PASSWORD    = random_password.redis_auth.result
    REDIS_SSL         = "true"
    JWT_SECRET        = random_password.jwt.result
    // The SPA and the API share one CloudFront origin, so CORS never fires in
    // normal operation. Set for completeness and for direct-ALB debugging.
    CORS_ALLOWED_ORIGINS = "https://${aws_cloudfront_distribution.main.domain_name}"
  })
}
