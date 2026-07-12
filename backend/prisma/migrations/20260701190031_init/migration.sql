-- CreateTable
CREATE TABLE "McpToken" (
    "id" TEXT NOT NULL,
    "clerkUserId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "jti" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),
    "lastUsedAt" TIMESTAMP(3),

    CONSTRAINT "McpToken_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "McpToken_jti_key" ON "McpToken"("jti");

-- CreateIndex
CREATE INDEX "McpToken_clerkUserId_idx" ON "McpToken"("clerkUserId");
