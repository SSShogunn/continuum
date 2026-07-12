-- CreateTable
CREATE TABLE "OAuthClient" (
    "id" TEXT NOT NULL,
    "clientSecret" TEXT NOT NULL,
    "redirectUris" TEXT[],
    "name" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OAuthClient_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OAuthCode" (
    "code" TEXT NOT NULL,
    "clerkUserId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "redirectUri" TEXT NOT NULL,
    "codeChallenge" TEXT,
    "codeChallengeMethod" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OAuthCode_pkey" PRIMARY KEY ("code")
);
