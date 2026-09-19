-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "GamingVm" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "region" TEXT NOT NULL,
    "availabilityZone" TEXT,
    "instanceId" TEXT NOT NULL,
    "instanceType" TEXT,
    "amiId" TEXT,
    "securityGroupId" TEXT,
    "subnetId" TEXT,
    "keyName" TEXT,
    "elasticIp" TEXT,
    "elasticIpAllocationId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "GamingVm_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "GameVolume" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "region" TEXT NOT NULL,
    "availabilityZone" TEXT NOT NULL,
    "volumeId" TEXT NOT NULL,
    "sizeGb" INTEGER NOT NULL,
    "volumeType" TEXT NOT NULL,
    "deviceName" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "GameVolume_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "instanceId" TEXT,
    "publicIp" TEXT,
    "artemisHost" TEXT,
    "gameVolumeId" TEXT,
    "error" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "stoppedAt" DATETIME,
    CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "GamingVm_userId_key" ON "GamingVm"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "GamingVm_instanceId_key" ON "GamingVm"("instanceId");

-- CreateIndex
CREATE UNIQUE INDEX "GameVolume_userId_key" ON "GameVolume"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "GameVolume_volumeId_key" ON "GameVolume"("volumeId");

-- CreateIndex
CREATE INDEX "Session_userId_status_createdAt_idx" ON "Session"("userId", "status", "createdAt");
