// ---------------------------------------------------------------------------
// Terraform owns the ALB rather than letting a Kubernetes Ingress create one.
//
// Two reasons:
//   1. CloudFront needs the ALB hostname at plan time. If the Ingress created
//      the ALB we would need a two-stage apply to wire up the origin.
//   2. It lets us enforce the X-Origin-Verify header in a listener rule, which
//      an Ingress annotation cannot express.
//
// Pods are attached to the target group by the AWS Load Balancer Controller
// via the TargetGroupBinding CR in k8s/targetgroupbinding.yaml.
// ---------------------------------------------------------------------------

// AWS-managed prefix list of CloudFront's origin-facing ranges. Restricting to
// this means the ALB is not reachable from arbitrary internet hosts.
data "aws_ec2_managed_prefix_list" "cloudfront" {
  name = "com.amazonaws.global.cloudfront.origin-facing"
}

resource "aws_security_group" "alb" {
  name        = "${local.name}-alb"
  description = "Public ALB, reachable only from CloudFront edge ranges"
  vpc_id      = module.vpc.vpc_id

  ingress {
    description     = "HTTP from CloudFront edges only"
    from_port       = 80
    to_port         = 80
    protocol        = "tcp"
    prefix_list_ids = [data.aws_ec2_managed_prefix_list.cloudfront.id]
  }

  egress {
    description = "To backend pods"
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = [module.vpc.vpc_cidr_block]
  }

  tags = { Name = "${local.name}-alb" }
}

// The ALB forwards to pod IPs, so the node SG must accept traffic from it.
resource "aws_security_group_rule" "nodes_from_alb" {
  description              = "Backend container port from the ALB"
  type                     = "ingress"
  from_port                = 8080
  to_port                  = 8080
  protocol                 = "tcp"
  security_group_id        = module.eks.node_security_group_id
  source_security_group_id = aws_security_group.alb.id
}

resource "aws_lb" "main" {
  name               = "${local.name}-alb"
  load_balancer_type = "application"
  internal           = false
  subnets            = module.vpc.public_subnets
  security_groups    = [aws_security_group.alb.id]

  idle_timeout               = 300 // WebSockets are long-lived; do not cut them at 60s
  drop_invalid_header_fields = true
  enable_http2               = true

  tags = { Name = "${local.name}-alb" }
}

resource "aws_lb_target_group" "backend" {
  name        = "${local.name}-backend"
  port        = 8080
  protocol    = "HTTP"
  vpc_id      = module.vpc.vpc_id
  target_type = "ip" // required: pods, not nodes

  health_check {
    enabled             = true
    path                = "/actuator/health/readiness"
    port                = "traffic-port"
    protocol            = "HTTP"
    matcher             = "200"
    interval            = 15
    timeout             = 5
    healthy_threshold   = 2
    unhealthy_threshold = 3
  }

  // Give in-flight WebSocket frames a chance to finish on rolling deploys.
  deregistration_delay = 30

  stickiness {
    enabled = false // Redis Pub/Sub relays updates, so any pod can serve any client
    type    = "lb_cookie"
  }

  lifecycle {
    create_before_destroy = true
  }
}

resource "aws_lb_listener" "http" {
  load_balancer_arn = aws_lb.main.arn
  port              = 80
  protocol          = "HTTP"

  // Anything that did not come through CloudFront is refused.
  default_action {
    type = "fixed-response"
    fixed_response {
      content_type = "text/plain"
      message_body = "Direct access denied. Use the CloudFront endpoint."
      status_code  = "403"
    }
  }
}

resource "aws_lb_listener_rule" "from_cloudfront" {
  listener_arn = aws_lb_listener.http.arn
  priority     = 100

  condition {
    http_header {
      http_header_name = "X-Origin-Verify"
      values           = [random_password.origin_verify.result]
    }
  }

  action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.backend.arn
  }
}
