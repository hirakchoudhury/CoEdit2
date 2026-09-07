variable "project" {
  description = "Name prefix for every resource."
  type        = string
  default     = "coedit"
}

variable "region" {
  description = "AWS region to deploy into."
  type        = string
  default     = "ap-south-1"
}

variable "vpc_cidr" {
  type    = string
  default = "10.20.0.0/16"
}

variable "az_count" {
  description = "Number of availability zones. RDS and ElastiCache subnet groups need at least 2."
  type        = number
  default     = 2
}

variable "single_nat_gateway" {
  description = "One NAT gateway instead of one per AZ. Saves roughly $35/month; a single AZ failure takes out egress."
  type        = bool
  default     = true
}

# ---------- EKS ----------
variable "kubernetes_version" {
  type    = string
  default = "1.30"
}

variable "node_instance_types" {
  type    = list(string)
  default = ["t3.medium"]
}

variable "node_min_size" {
  type    = number
  default = 2
}

variable "node_max_size" {
  type    = number
  default = 4
}

variable "node_desired_size" {
  type    = number
  default = 2
}

# ---------- RDS ----------
variable "db_instance_class" {
  type    = string
  default = "db.t4g.micro"
}

variable "db_allocated_storage" {
  type    = number
  default = 20
}

variable "db_engine_version" {
  type    = string
  default = "16.4"
}

variable "db_name" {
  type    = string
  default = "collab_editor"
}

variable "db_username" {
  type    = string
  default = "postgres"
}

variable "db_multi_az" {
  description = "Standby in a second AZ. Roughly doubles RDS cost."
  type        = bool
  default     = false
}

variable "db_backup_retention_days" {
  type    = number
  default = 7
}

variable "db_deletion_protection" {
  type    = bool
  default = true
}

# ---------- ElastiCache ----------
variable "redis_node_type" {
  type    = string
  default = "cache.t4g.micro"
}

variable "redis_engine_version" {
  type    = string
  default = "7.1"
}

variable "redis_replica_count" {
  description = "Replicas per shard. 1 gives you automatic failover."
  type        = number
  default     = 1
}

# ---------- GitHub OIDC ----------
variable "github_repository" {
  description = "owner/repo allowed to assume the CI role, e.g. hirakchoudhury/CoEdit2."
  type        = string
}

variable "github_deploy_ref" {
  description = "Git ref allowed to deploy. Keep this narrow; plan-only jobs use pull_request."
  type        = string
  default     = "refs/heads/main"
}

# ---------- App ----------
variable "backend_replicas" {
  type    = number
  default = 2
}
