import {
  AllocateAddressCommand,
  AssociateAddressCommand,
  AttachVolumeCommand,
  CreateVolumeCommand,
  DescribeAddressesCommand,
  DescribeInstancesCommand,
  DescribeVolumesCommand,
  EC2Client,
  RunInstancesCommand,
  StartInstancesCommand,
  StopInstancesCommand,
  VolumeType,
  waitUntilInstanceRunning,
  waitUntilInstanceStopped,
  waitUntilVolumeAvailable,
  waitUntilVolumeInUse
} from '@aws-sdk/client-ec2';
import { config } from '../config';
import type { SessionRecord, UserRecord } from '../types';
import type { CloudProvider, StartResult } from './cloud';

export class AwsProvider implements CloudProvider {
  private readonly ec2 = new EC2Client({ region: config.aws.region });

  async ensureGameVolume(user: UserRecord): Promise<{ volumeId: string; availabilityZone: string }> {
    if (user.gameVolumeId && user.gameVolumeAz) {
      await this.waitForVolumeReadyForUser(user.gameVolumeId, user.instanceId);
      return { volumeId: user.gameVolumeId, availabilityZone: user.gameVolumeAz };
    }

    const created = await this.ec2.send(new CreateVolumeCommand({
      AvailabilityZone: config.aws.availabilityZone,
      Size: config.aws.gameVolumeSizeGb,
      VolumeType: config.aws.gameVolumeType as VolumeType,
      TagSpecifications: [
        {
          ResourceType: 'volume',
          Tags: [
            { Key: 'Name', Value: `cloud-gaming-${user.id}-games` },
            { Key: 'Project', Value: 'cloud-gaming' },
            { Key: 'Role', Value: 'user-game-volume' },
            { Key: 'UserId', Value: user.id }
          ]
        }
      ]
    }));

    if (!created.VolumeId) {
      throw new Error('AWS did not return a volume ID');
    }

    await waitUntilVolumeAvailable(
      { client: this.ec2, maxWaitTime: 180 },
      { VolumeIds: [created.VolumeId] }
    );

    return { volumeId: created.VolumeId, availabilityZone: config.aws.availabilityZone };
  }

  async ensureElasticIp(user: UserRecord): Promise<{ allocationId: string; publicIp: string }> {
    if (user.elasticIpAllocationId && user.elasticIp) {
      const existing = await this.ec2.send(new DescribeAddressesCommand({
        AllocationIds: [user.elasticIpAllocationId]
      }));

      const address = existing.Addresses?.[0];
      if (address?.PublicIp) {
        return { allocationId: user.elasticIpAllocationId, publicIp: address.PublicIp };
      }
    }

    const allocated = await this.ec2.send(new AllocateAddressCommand({
      Domain: 'vpc',
      TagSpecifications: [
        {
          ResourceType: 'elastic-ip',
          Tags: [
            { Key: 'Name', Value: `cloud-gaming-${user.id}-eip` },
            { Key: 'Project', Value: 'cloud-gaming' },
            { Key: 'Role', Value: 'user-stable-ip' },
            { Key: 'UserId', Value: user.id }
          ]
        }
      ]
    }));

    if (!allocated.AllocationId || !allocated.PublicIp) {
      throw new Error('AWS did not return an Elastic IP allocation');
    }

    return {
      allocationId: allocated.AllocationId,
      publicIp: allocated.PublicIp
    };
  }

  async startInstance(
    user: UserRecord,
    session: SessionRecord,
    gameVolumeId: string,
    onInstanceCreated?: (instanceId: string) => Promise<void>
  ): Promise<StartResult> {
    if (user.instanceId) {
      return this.startExistingInstance(user, user.instanceId, gameVolumeId);
    }

    const run = await this.ec2.send(new RunInstancesCommand({
      LaunchTemplate: { LaunchTemplateId: config.aws.launchTemplateId, Version: '$Default' },
      MinCount: 1,
      MaxCount: 1,
      TagSpecifications: [
        {
          ResourceType: 'instance',
          Tags: [
            { Key: 'Name', Value: `cloud-gaming-${user.id}` },
            { Key: 'Project', Value: 'cloud-gaming' },
            { Key: 'Role', Value: 'gaming-vm' },
            { Key: 'UserId', Value: user.id },
            { Key: 'SessionId', Value: session.id }
          ]
        }
      ]
    }));

    const instanceId = run.Instances?.[0]?.InstanceId;
    if (!instanceId) {
      throw new Error('AWS did not return an instance ID');
    }

    // Persist immediately so a failure or restart below doesn't orphan a billing VM.
    await onInstanceCreated?.(instanceId);

    await waitUntilInstanceRunning(
      { client: this.ec2, maxWaitTime: 420 },
      { InstanceIds: [instanceId] }
    );

    await this.ec2.send(new AttachVolumeCommand({
      InstanceId: instanceId,
      VolumeId: gameVolumeId,
      Device: config.aws.gameVolumeDevice
    }));

    await waitUntilVolumeInUse(
      { client: this.ec2, maxWaitTime: 180 },
      { VolumeIds: [gameVolumeId] }
    );

    const elasticIp = await this.ensureElasticIp(user);
    await this.ec2.send(new AssociateAddressCommand({
      AllocationId: elasticIp.allocationId,
      InstanceId: instanceId,
      AllowReassociation: true
    }));

    return {
      instanceId,
      publicIp: elasticIp.publicIp,
      privateIp: await this.getInstancePrivateIp(instanceId),
      gameVolumeId,
      elasticIpAllocationId: elasticIp.allocationId
    };
  }

  private async startExistingInstance(user: UserRecord, instanceId: string, gameVolumeId: string): Promise<StartResult> {
    // EC2 rejects StartInstances while the VM is still stopping, which is easy to hit
    // when a user restarts right after stopping.
    const current = await this.describeInstance(instanceId);
    if (current.state === 'stopping') {
      // Windows shutdown on these VMs regularly needs more than five minutes.
      await waitUntilInstanceStopped(
        { client: this.ec2, maxWaitTime: 600 },
        { InstanceIds: [instanceId] }
      );
    }

    await this.ec2.send(new StartInstancesCommand({
      InstanceIds: [instanceId]
    }));

    await waitUntilInstanceRunning(
      { client: this.ec2, maxWaitTime: 420 },
      { InstanceIds: [instanceId] }
    );

    await this.ensureVolumeAttached(instanceId, gameVolumeId);

    const elasticIp = await this.ensureElasticIp(user);
    await this.ec2.send(new AssociateAddressCommand({
      AllocationId: elasticIp.allocationId,
      InstanceId: instanceId,
      AllowReassociation: true
    }));

    return {
      instanceId,
      publicIp: elasticIp.publicIp,
      privateIp: await this.getInstancePrivateIp(instanceId),
      gameVolumeId,
      elasticIpAllocationId: elasticIp.allocationId
    };
  }

  async stopInstance(session: SessionRecord): Promise<void> {
    if (!session.instanceId) {
      return;
    }

    await this.ec2.send(new StopInstancesCommand({
      InstanceIds: [session.instanceId]
    }));
  }

  async describeInstance(instanceId: string): Promise<{ state?: string; publicIp?: string; privateIp?: string }> {
    const result = await this.ec2.send(new DescribeInstancesCommand({
      InstanceIds: [instanceId]
    }));

    const instance = result.Reservations?.[0]?.Instances?.[0];
    return {
      state: instance?.State?.Name,
      publicIp: instance?.PublicIpAddress,
      privateIp: instance?.PrivateIpAddress
    };
  }

  private async getInstancePrivateIp(instanceId: string): Promise<string | undefined> {
    const instance = await this.describeInstance(instanceId);
    return instance.privateIp;
  }

  // A previous launch may have failed before attaching the volume.
  private async ensureVolumeAttached(instanceId: string, volumeId: string): Promise<void> {
    const volume = await this.ec2.send(new DescribeVolumesCommand({
      VolumeIds: [volumeId]
    }));

    if (volume.Volumes?.[0]?.Attachments?.some((attachment) => attachment.InstanceId === instanceId)) {
      return;
    }

    await this.ec2.send(new AttachVolumeCommand({
      InstanceId: instanceId,
      VolumeId: volumeId,
      Device: config.aws.gameVolumeDevice
    }));

    await waitUntilVolumeInUse(
      { client: this.ec2, maxWaitTime: 180 },
      { VolumeIds: [volumeId] }
    );
  }

  private async waitForVolumeReadyForUser(volumeId: string, expectedInstanceId?: string): Promise<void> {
    const volume = await this.ec2.send(new DescribeVolumesCommand({
      VolumeIds: [volumeId]
    }));

    const currentVolume = volume.Volumes?.[0];
    const state = currentVolume?.State;
    if (state === 'available') {
      return;
    }

    if (state === 'in-use') {
      const attachedInstanceId = currentVolume?.Attachments?.[0]?.InstanceId;
      if (expectedInstanceId && attachedInstanceId === expectedInstanceId) {
        return;
      }

      throw new Error(`Game volume ${volumeId} is already attached to ${attachedInstanceId ?? 'another instance'}`);
    }

    await waitUntilVolumeAvailable(
      { client: this.ec2, maxWaitTime: 180 },
      { VolumeIds: [volumeId] }
    );
  }
}
