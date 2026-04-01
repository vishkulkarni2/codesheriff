// @description AI invented a nonexistent npm package and method signatures

// BUG: 'secure-hash' is not a real npm package.
// AI hallucinated both the package and its API.
import { secureHash, verifyHash } from "secure-hash";

// Also hallucinated: prisma.$encryptField does not exist in Prisma Client
import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();

export async function createUser(email: string, password: string) {
  // secureHash is hallucinated — will throw at import time
  const hashedPassword = secureHash(password, { algorithm: "argon2id", rounds: 10 });

  return prisma.user.create({
    data: {
      email,
      // BUG: prisma.$encryptField does not exist
      password: (prisma as unknown as Record<string, (s: string) => string>)
        .$encryptField(hashedPassword),
    },
  });
}

export async function loginUser(email: string, password: string) {
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) return null;

  // verifyHash is hallucinated
  return verifyHash(password, user.password) ? user : null;
}
