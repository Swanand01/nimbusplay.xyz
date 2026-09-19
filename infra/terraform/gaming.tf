# Everything about how a gaming VM is launched lives here. The backend only
# calls RunInstances with this template, then attaches the user's game volume
# and Elastic IP. Changing gaming_ami_id + apply updates the default version;
# existing VMs are unaffected (one VM per user, never replaced).
resource "aws_launch_template" "gaming_vm" {
  name                   = "cloud-gaming-vm"
  image_id               = var.gaming_ami_id
  instance_type          = var.gaming_instance_type
  update_default_version = true

  iam_instance_profile {
    name = aws_iam_instance_profile.gaming_vm.name
  }

  network_interfaces {
    subnet_id                   = aws_subnet.public.id
    security_groups             = [aws_security_group.gaming_vm.id]
    associate_public_ip_address = true
    delete_on_termination       = true
  }

  tag_specifications {
    resource_type = "instance"
    tags = {
      Project   = "cloud-gaming"
      Role      = "gaming-vm"
      ManagedBy = "backend"
    }
  }

  tag_specifications {
    resource_type = "volume"
    tags = {
      Project   = "cloud-gaming"
      Role      = "gaming-vm-root"
      ManagedBy = "backend"
    }
  }
}
