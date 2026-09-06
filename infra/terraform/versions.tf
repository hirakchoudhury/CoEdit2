terraform {
  required_version = ">= 1.6.0"

  required_providers {
    aws    = { source = "hashicorp/aws", version = "~> 5.60" }
    helm   = { source = "hashicorp/helm", version = "~> 2.13" }
    random = { source = "hashicorp/random", version = "~> 3.6" }
    tls    = { source = "hashicorp/tls", version = "~> 4.0" }
  }

  # Remote state. Create the bucket + lock table once, out of band, then
  # uncomment and run `terraform init -migrate-state`.
  # backend "s3" {
  #   bucket         = "coedit-tfstate-<account-id>"
  #   key            = "coedit/terraform.tfstate"
  #   region         = "ap-south-1"
  #   dynamodb_table = "coedit-tf-locks"
  #   encrypt        = true
  # }
}

provider "aws" {
  region = var.region
  default_tags {
    tags = {
      Project   = var.project
      ManagedBy = "terraform"
    }
  }
}

# CloudFront-scoped ACM certificates must live in us-east-1. Only needed if
# you attach a custom domain; harmless otherwise.
provider "aws" {
  alias  = "us_east_1"
  region = "us-east-1"
  default_tags {
    tags = {
      Project   = var.project
      ManagedBy = "terraform"
    }
  }
}

provider "helm" {
  kubernetes {
    host                   = module.eks.cluster_endpoint
    cluster_ca_certificate = base64decode(module.eks.cluster_certificate_authority_data)
    exec {
      api_version = "client.authentication.k8s.io/v1beta1"
      command     = "aws"
      args        = ["eks", "get-token", "--cluster-name", module.eks.cluster_name, "--region", var.region]
    }
  }
}
