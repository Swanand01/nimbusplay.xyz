resource "aws_security_group" "backend" {
  name        = "cloud-gaming-backend"
  description = "Cloud gaming backend API"
  vpc_id      = aws_vpc.main.id

  tags = { Name = "cloud-gaming-backend" }
}

# Caddy terminates TLS here: 80 is needed for the Let's Encrypt check and the redirect.
resource "aws_vpc_security_group_ingress_rule" "backend_http" {
  security_group_id = aws_security_group.backend.id
  description       = "HTTP (redirect + ACME challenge)"
  ip_protocol       = "tcp"
  from_port         = 80
  to_port           = 80
  cidr_ipv4         = "0.0.0.0/0"
}

resource "aws_vpc_security_group_ingress_rule" "backend_https" {
  security_group_id = aws_security_group.backend.id
  description       = "HTTPS"
  ip_protocol       = "tcp"
  from_port         = 443
  to_port           = 443
  cidr_ipv4         = "0.0.0.0/0"
}

resource "aws_vpc_security_group_egress_rule" "backend_all" {
  security_group_id = aws_security_group.backend.id
  ip_protocol       = "-1"
  cidr_ipv4         = "0.0.0.0/0"
}

resource "aws_security_group" "gaming_vm" {
  name        = "cloud-gaming-vm"
  description = "Apollo gaming VMs"
  vpc_id      = aws_vpc.main.id

  tags = { Name = "cloud-gaming-vm" }
}

locals {
  # Apollo streaming ports, open to clients. 47990 (Web UI/API) is deliberately absent.
  streaming_tcp_ports = [47984, 47989, 48010]
}

resource "aws_vpc_security_group_ingress_rule" "gaming_stream_tcp" {
  for_each = toset([for port in local.streaming_tcp_ports : tostring(port)])

  security_group_id = aws_security_group.gaming_vm.id
  description       = "Apollo streaming TCP ${each.value}"
  ip_protocol       = "tcp"
  from_port         = tonumber(each.value)
  to_port           = tonumber(each.value)
  cidr_ipv4         = "0.0.0.0/0"
}

resource "aws_vpc_security_group_ingress_rule" "gaming_stream_udp" {
  security_group_id = aws_security_group.gaming_vm.id
  description       = "Apollo streaming UDP"
  ip_protocol       = "udp"
  from_port         = 47998
  to_port           = 48000
  cidr_ipv4         = "0.0.0.0/0"
}

resource "aws_vpc_security_group_ingress_rule" "gaming_apollo_api_from_backend" {
  security_group_id            = aws_security_group.gaming_vm.id
  description                  = "Apollo Web UI/API from backend only"
  ip_protocol                  = "tcp"
  from_port                    = 47990
  to_port                      = 47990
  referenced_security_group_id = aws_security_group.backend.id
}

resource "aws_vpc_security_group_egress_rule" "gaming_all" {
  security_group_id = aws_security_group.gaming_vm.id
  ip_protocol       = "-1"
  cidr_ipv4         = "0.0.0.0/0"
}
