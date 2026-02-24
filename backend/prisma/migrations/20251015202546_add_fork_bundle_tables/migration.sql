-- CreateTable
CREATE TABLE "ForkBundleChunk" (
    "id" TEXT NOT NULL,
    "sourceAgentId" TEXT NOT NULL,
    "chunkIndex" INTEGER NOT NULL,
    "chunkData" TEXT NOT NULL,
    "totalChunks" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ForkBundleChunk_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ForkBundleFinalized" (
    "id" TEXT NOT NULL,
    "sourceAgentId" TEXT NOT NULL,
    "bundleBase64" TEXT NOT NULL,
    "patchBase64" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ForkBundleFinalized_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ForkBundleChunk_sourceAgentId_idx" ON "ForkBundleChunk"("sourceAgentId");

-- CreateIndex
CREATE INDEX "ForkBundleChunk_createdAt_idx" ON "ForkBundleChunk"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ForkBundleChunk_sourceAgentId_chunkIndex_key" ON "ForkBundleChunk"("sourceAgentId", "chunkIndex");

-- CreateIndex
CREATE UNIQUE INDEX "ForkBundleFinalized_sourceAgentId_key" ON "ForkBundleFinalized"("sourceAgentId");

-- CreateIndex
CREATE INDEX "ForkBundleFinalized_sourceAgentId_idx" ON "ForkBundleFinalized"("sourceAgentId");

-- CreateIndex
CREATE INDEX "ForkBundleFinalized_createdAt_idx" ON "ForkBundleFinalized"("createdAt");
