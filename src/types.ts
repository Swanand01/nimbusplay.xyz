export type UserRecord = {
  id: string;
  createdAt: string;
  gameVolumeId?: string;
  gameVolumeAz?: string;
  elasticIpAllocationId?: string;
  elasticIp?: string;
  privateIp?: string;
  instanceId?: string;
  apolloUsername?: string;
  apolloPassword?: string;
  apolloCredentialsRotatedAt?: string;
};

export type SessionStatus = 'starting' | 'ready' | 'stopping' | 'stopped' | 'failed';

export type SessionRecord = {
  id: string;
  userId: string;
  provider: 'aws';
  status: SessionStatus;
  instanceId?: string;
  publicIp?: string;
  privateIp?: string;
  artemisHost?: string;
  gameVolumeId?: string;
  error?: string;
  createdAt: string;
  updatedAt: string;
  stoppedAt?: string;
};

export type StateFile = {
  users: Record<string, UserRecord>;
  sessions: Record<string, SessionRecord>;
};
