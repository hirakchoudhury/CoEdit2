resource "random_password" "redis_auth" {
  length  = 48
  special = false # ElastiCache AUTH tokens allow only a restricted character set
}

resource "aws_security_group" "redis" {
  name        = "${local.name}-redis"
  description = "Redis access from EKS nodes only"
  vpc_id      = module.vpc.vpc_id

  ingress {
    description     = "Redis from EKS nodes"
    from_port       = 6379
    to_port         = 6379
    protocol        = "tcp"
    security_groups = [module.eks.node_security_group_id]
  }

  tags = { Name = "${local.name}-redis" }
}

resource "aws_elasticache_subnet_group" "redis" {
  name       = "${local.name}-redis"
  subnet_ids = module.vpc.database_subnets
}

# The backend relays CRDT updates between pods over Pub/Sub, so every replica
# must talk to the same Redis. Cluster mode stays disabled: Pub/Sub across
# shards needs sharded channels, which Spring Data Redis does not use here.
resource "aws_elasticache_replication_group" "redis" {
  replication_group_id = "${local.name}-redis"
  description          = "CoEdit CRDT update relay"

  engine         = "redis"
  engine_version = var.redis_engine_version
  node_type      = var.redis_node_type
  port           = 6379

  num_cache_clusters         = var.redis_replica_count + 1
  automatic_failover_enabled = var.redis_replica_count > 0
  multi_az_enabled           = var.redis_replica_count > 0

  subnet_group_name  = aws_elasticache_subnet_group.redis.name
  security_group_ids = [aws_security_group.redis.id]

  at_rest_encryption_enabled = true
  transit_encryption_enabled = true
  auth_token                 = random_password.redis_auth.result

  snapshot_retention_limit = 3
  snapshot_window          = "17:00-18:00"
  maintenance_window       = "sun:18:30-sun:19:30"

  apply_immediately = false

  tags = { Name = "${local.name}-redis" }
}
