import 'dotenv/config';

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function numberFromEnv(name: string, fallback: number): number {
  const value = process.env[name];
  if (!value) {
    return fallback;
  }

  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`Invalid numeric environment variable ${name}: ${value}`);
  }

  return parsed;
}

export const config = {
  port: numberFromEnv('PORT', 8080),
  host: process.env.HOST ?? '127.0.0.1',
  auth: {
    tokenSecret: required('AUTH_TOKEN_SECRET'),
    tokenTtlSeconds: numberFromEnv('AUTH_TOKEN_TTL_SECONDS', 60 * 60 * 24 * 7),
    cookieSecure: process.env.COOKIE_SECURE === 'true'
  },
  apollo: {
    apiPort: numberFromEnv('APOLLO_API_PORT', 47990),
    apiUsername: process.env.APOLLO_API_USERNAME || undefined,
    apiPassword: process.env.APOLLO_API_PASSWORD || undefined,
    rejectUnauthorized: process.env.APOLLO_API_REJECT_UNAUTHORIZED === 'true',
    usePrivateIp: process.env.APOLLO_API_USE_PRIVATE_IP === 'true'
  },
  aws: {
    region: required('AWS_REGION'),
    // AMI, instance type, subnet, security group and instance profile come from this
    // launch template (infra/terraform/gaming.tf).
    launchTemplateId: required('AWS_LAUNCH_TEMPLATE_ID'),
    // Must match the launch template's subnet AZ: game volumes are AZ-bound.
    availabilityZone: required('AWS_AVAILABILITY_ZONE'),
    gameVolumeSizeGb: numberFromEnv('GAME_VOLUME_SIZE_GB', 140),
    gameVolumeType: process.env.GAME_VOLUME_TYPE ?? 'gp3',
    gameVolumeDevice: process.env.GAME_VOLUME_DEVICE ?? '/dev/sdf'
  }
};
