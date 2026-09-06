# CoEdit on AWS

Terraform + Kubernetes manifests + GitHub Actions for running CoEdit in
`ap-south-1`.

## Architecture

```
                    ┌──────────────────────────────┐
   browser ───────► │   CloudFront distribution    │   one origin for everything
                    │                              │
                    │  /*        → S3 (SPA)        │
                    │  /api/*    → ALB             │
                    │  /ws*      → ALB (WebSocket) │
                    └──────┬───────────────┬───────┘
                           │               │
                  ┌────────▼──────┐   ┌────▼──────────────────┐
                  │ S3 (private)  │   │ ALB (public subnets)  │
                  │ OAC only      │   │ SG: CloudFront ranges │
                  └───────────────┘   │ rule: X-Origin-Verify │
                                      └────┬──────────────────┘
                                           │ TargetGroupBinding
                                  ┌────────▼─────────┐
                                  │ EKS (private)    │
                                  │ backend pods x2  │
                                  └───┬──────────┬───┘
                                      │          │
                          ┌───────────▼──┐   ┌───▼──────────────┐
                          │ RDS Postgres │   │ ElastiCache Redis│
                          │ (db subnets) │   │ (db subnets)     │
                          └──────────────┘   └──────────────────┘
```

**Why one CloudFront distribution.** The SPA derives its WebSocket URL from
`window.location.host` and calls the API with relative paths. Serving both from
one origin means that code works unchanged and CORS never enters the picture.
A separate `api.` subdomain would require a code change and an ACM certificate.

**Why Terraform owns the ALB.** CloudFront needs the ALB hostname at plan time.
If a Kubernetes `Ingress` created the ALB, that hostname would not exist until
after the cluster was up, forcing a two-stage apply. Terraform creates the ALB
and target group; the AWS Load Balancer Controller attaches pod IPs to it via
the `TargetGroupBinding` CR. That also allows enforcing `X-Origin-Verify` in a
listener rule, which an Ingress annotation cannot express.

**Redis is single-shard on purpose.** The backend relays CRDT updates between
pods with Pub/Sub. Cluster mode would split channels across shards, and the
publisher uses ordinary (not sharded) channels, so replicas would miss updates.

## First-time setup

1. **Remote state.** Create an S3 bucket and DynamoDB lock table, then
   uncomment the `backend "s3"` block in `versions.tf` and run
   `terraform init -migrate-state`. Skipping this leaves state on one laptop.

2. **Apply.**

   ```bash
   cd infra/terraform
   cp terraform.tfvars.example terraform.tfvars   # set github_repository
   terraform init
   terraform apply
   ```

   Expect roughly 20 minutes; EKS and RDS dominate.

3. **Wire up GitHub.** `terraform output github_repository_variables` prints
   every value. Add them under **Settings → Variables → Actions** (these are
   variables, not secrets — none is sensitive):

   | Variable | Source |
   |---|---|
   | `AWS_REGION` | `ap-south-1` |
   | `AWS_ROLE_ARN` | `github_actions_role_arn` |
   | `ECR_REPOSITORY` | `ecr_repository_url` |
   | `EKS_CLUSTER_NAME` | `eks_cluster_name` |
   | `FRONTEND_BUCKET` | `frontend_bucket` |
   | `CLOUDFRONT_ID` | `cloudfront_distribution_id` |
   | `APP_SECRET_NAME` | `app_secret_name` |
   | `TARGET_GROUP_ARN` | `backend_target_group_arn` |

   For the Terraform workflow, also set `TF_ROLE_ARN` to a role with broader
   permissions. The CI role deliberately cannot manage infrastructure.

4. **Create the `production` environment** (Settings → Environments) and add
   required reviewers. Both deploy workflows and `terraform apply` are gated on
   it; without reviewers the gate is decorative.

5. **Deploy.** Push to `main`, or run the workflows manually. Backend and
   frontend deploy independently based on changed paths.

6. Open `terraform output app_url`.

## Credentials

Terraform generates the database password, Redis auth token, and JWT secret as
`random_password` and writes them to one Secrets Manager entry. The backend
deploy workflow reads that entry and projects it into the `coedit-app`
Kubernetes Secret. Nothing sensitive is committed, and no value is echoed into
a workflow log.

Rotation is `terraform taint random_password.<name>`, apply, then re-run the
backend deploy. Rotating `JWT_SECRET` invalidates every issued token, signing
all users out.

## Known trade-offs

**CloudFront → ALB is plaintext.** Without a custom domain the ALB has no ACM
certificate, so that hop is HTTP. It is mitigated — the ALB security group only
accepts AWS's CloudFront origin-facing prefix list, and the listener rejects
anything lacking the `X-Origin-Verify` header — but the hop itself is not
encrypted. To close it: register a domain, issue an ACM cert for the ALB, and
switch `origin_protocol_policy` to `https-only`.

**Public EKS API endpoint.** Enabled so GitHub-hosted runners can reach it.
Restrict `cluster_endpoint_public_access_cidrs` or move to self-hosted runners
if that matters to you.

**Snapshot writes are unbatched.** Each pod uploads a full document snapshot
every 50 updates or 60 seconds. With many active documents this is the first
thing that will pressure RDS.

## Cost

Roughly **$230–290/month** at the defaults, in `ap-south-1`:

| Item | Approx/month |
|---|---|
| EKS control plane | $73 |
| 2 × t3.medium nodes | $60 |
| NAT gateway (single) | $35 + data |
| RDS db.t4g.micro | $15 |
| ElastiCache 2 × t4g.micro | $25 |
| ALB | $20 + LCU |
| CloudFront + S3 | usage |

To cut it down: `node_desired_size = 1`, `redis_replica_count = 0`, and
`db_deletion_protection = false` so you can tear it down. EKS's $73 is fixed —
if that is the dominant cost for a pet project, ECS Fargate or App Runner would
be cheaper, though you asked for EKS specifically.

`terraform destroy` will not remove the database while
`db_deletion_protection = true`; set it false and apply before destroying.
