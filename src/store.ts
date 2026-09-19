import { randomUUID } from 'node:crypto';
import { config } from './config';
import { prisma } from './db';
import type { SessionRecord, UserRecord } from './types';

type UserWithRelations = NonNullable<Awaited<ReturnType<typeof findUserWithRelations>>>;

async function findUserWithRelations(userId: string) {
  return prisma.user.findUnique({
    where: { id: userId },
    include: {
      vm: true,
      volume: true
    }
  });
}

function userToRecord(user: UserWithRelations): UserRecord {
  return {
    id: user.id,
    createdAt: user.createdAt.toISOString(),
    instanceId: user.vm?.instanceId,
    elasticIp: user.vm?.elasticIp ?? undefined,
    privateIp: user.vm?.privateIp ?? undefined,
    elasticIpAllocationId: user.vm?.elasticIpAllocationId ?? undefined,
    apolloUsername: user.vm?.apolloUsername ?? undefined,
    apolloPassword: user.vm?.apolloPassword ?? undefined,
    apolloCredentialsRotatedAt: user.vm?.apolloCredentialsRotatedAt?.toISOString(),
    gameVolumeId: user.volume?.volumeId,
    gameVolumeAz: user.volume?.availabilityZone
  };
}

function sessionToRecord(session: {
  id: string;
  userId: string;
  provider: string;
  status: string;
  instanceId: string | null;
  publicIp: string | null;
  privateIp: string | null;
  artemisHost: string | null;
  gameVolumeId: string | null;
  error: string | null;
  createdAt: Date;
  updatedAt: Date;
  stoppedAt: Date | null;
}): SessionRecord {
  return {
    id: session.id,
    userId: session.userId,
    provider: session.provider as SessionRecord['provider'],
    status: session.status as SessionRecord['status'],
    instanceId: session.instanceId ?? undefined,
    publicIp: session.publicIp ?? undefined,
    privateIp: session.privateIp ?? undefined,
    artemisHost: session.artemisHost ?? undefined,
    gameVolumeId: session.gameVolumeId ?? undefined,
    error: session.error ?? undefined,
    createdAt: session.createdAt.toISOString(),
    updatedAt: session.updatedAt.toISOString(),
    stoppedAt: session.stoppedAt?.toISOString()
  };
}

export class Store {
  async load(): Promise<void> {
    await prisma.$connect();
  }

  async ensureUser(userId: string): Promise<UserRecord> {
    const user = await prisma.user.upsert({
      where: { id: userId },
      create: { id: userId },
      update: {},
      include: {
        vm: true,
        volume: true
      }
    });

    return userToRecord(user);
  }

  async getUser(userId: string): Promise<UserRecord | undefined> {
    const user = await findUserWithRelations(userId);
    return user ? userToRecord(user) : undefined;
  }

  async updateUser(user: UserRecord): Promise<void> {
    await prisma.user.upsert({
      where: { id: user.id },
      create: {
        id: user.id,
        createdAt: user.createdAt ? new Date(user.createdAt) : undefined
      },
      update: {}
    });

    if (user.instanceId || user.elasticIp || user.elasticIpAllocationId) {
      await prisma.gamingVm.upsert({
        where: { userId: user.id },
        create: {
          userId: user.id,
          provider: 'aws',
          region: config.aws.region,
          availabilityZone: user.gameVolumeAz ?? config.aws.availabilityZone,
          instanceId: user.instanceId ?? `pending-${user.id}`,
          elasticIp: user.elasticIp,
          privateIp: user.privateIp,
          elasticIpAllocationId: user.elasticIpAllocationId,
          apolloUsername: user.apolloUsername,
          apolloPassword: user.apolloPassword,
          apolloCredentialsRotatedAt: user.apolloCredentialsRotatedAt ? new Date(user.apolloCredentialsRotatedAt) : undefined
        },
        update: {
          availabilityZone: user.gameVolumeAz ?? config.aws.availabilityZone,
          instanceId: user.instanceId,
          elasticIp: user.elasticIp,
          privateIp: user.privateIp,
          elasticIpAllocationId: user.elasticIpAllocationId,
          apolloUsername: user.apolloUsername,
          apolloPassword: user.apolloPassword,
          apolloCredentialsRotatedAt: user.apolloCredentialsRotatedAt ? new Date(user.apolloCredentialsRotatedAt) : undefined
        }
      });
    }

    if (user.gameVolumeId && user.gameVolumeAz) {
      await prisma.gameVolume.upsert({
        where: { userId: user.id },
        create: {
          userId: user.id,
          provider: 'aws',
          region: config.aws.region,
          availabilityZone: user.gameVolumeAz,
          volumeId: user.gameVolumeId,
          sizeGb: config.aws.gameVolumeSizeGb,
          volumeType: config.aws.gameVolumeType,
          deviceName: config.aws.gameVolumeDevice
        },
        update: {
          availabilityZone: user.gameVolumeAz,
          volumeId: user.gameVolumeId,
          sizeGb: config.aws.gameVolumeSizeGb,
          volumeType: config.aws.gameVolumeType,
          deviceName: config.aws.gameVolumeDevice
        }
      });
    }
  }

  async getCurrentSession(userId: string): Promise<SessionRecord | undefined> {
    const session = await prisma.session.findFirst({
      where: {
        userId,
        status: { in: ['starting', 'ready', 'stopping'] }
      },
      orderBy: { createdAt: 'desc' }
    });

    return session ? sessionToRecord(session) : undefined;
  }

  async getSession(sessionId: string): Promise<SessionRecord | undefined> {
    const session = await prisma.session.findUnique({
      where: { id: sessionId }
    });

    return session ? sessionToRecord(session) : undefined;
  }

  async createSession(userId: string): Promise<SessionRecord> {
    await this.ensureUser(userId);

    const session = await prisma.session.create({
      data: {
        id: randomUUID(),
        userId,
        provider: 'aws',
        status: 'starting'
      }
    });

    return sessionToRecord(session);
  }

  async updateSession(session: SessionRecord): Promise<void> {
    await prisma.session.update({
      where: { id: session.id },
      data: {
        status: session.status,
        instanceId: session.instanceId,
        publicIp: session.publicIp,
        privateIp: session.privateIp,
        artemisHost: session.artemisHost,
        gameVolumeId: session.gameVolumeId,
        error: session.error,
        stoppedAt: session.stoppedAt ? new Date(session.stoppedAt) : undefined
      }
    });
  }
}
