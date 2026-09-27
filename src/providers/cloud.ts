import type { SessionRecord, UserRecord } from '../types';

export type StartResult = {
  instanceId: string;
  publicIp?: string;
  privateIp?: string;
  gameVolumeId: string;
};

export interface CloudProvider {
  ensureGameVolume(user: UserRecord): Promise<{ volumeId: string; availabilityZone: string }>;
  startInstance(
    user: UserRecord,
    session: SessionRecord,
    gameVolumeId: string,
    onInstanceCreated?: (instanceId: string) => Promise<void>
  ): Promise<StartResult>;
  stopInstance(session: SessionRecord): Promise<void>;
  describeInstance(instanceId: string): Promise<{ state?: string; publicIp?: string; privateIp?: string }>;
}
