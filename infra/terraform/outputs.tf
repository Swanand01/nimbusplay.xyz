output "backend_instance_id" {
  value = aws_instance.backend.id
}

output "backend_public_ip" {
  value = aws_eip.backend.public_ip
}

output "backend_api_url" {
  value = "https://${var.domain}"
}

output "backend_origin_url" {
  description = "Direct origin, reachable only from the instance itself."
  value       = "http://${aws_eip.backend.public_ip}:8080"
}

output "deploy_bucket" {
  value = aws_s3_bucket.deploy.bucket
}

output "gaming_launch_template_id" {
  value = aws_launch_template.gaming_vm.id
}

output "backend_env" {
  description = "AWS/Apollo settings for the backend env file (secrets not included)."
  value       = <<-EOT
    AWS_REGION=${var.region}
    AWS_AVAILABILITY_ZONE=${var.availability_zone}
    AWS_LAUNCH_TEMPLATE_ID=${aws_launch_template.gaming_vm.id}
    APOLLO_API_USE_PRIVATE_IP=true
  EOT
}
