// @description Correct atomic balance deduction with Prisma transaction

import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();

// Correct: uses Prisma's interactive transaction for atomic read-check-write.
// The WHERE clause with the balance check prevents double-spend at the DB level.
export async function deductBalance(userId: string, amount: number): Promise<boolean> {
  try {
    await prisma.$transaction(async (tx) => {
      const updated = await tx.account.updateMany({
        where: {
          id: userId,
          balance: { gte: amount }, // atomic: only updates if balance is sufficient
        },
        data: {
          balance: { decrement: amount },
        },
      });

      if (updated.count === 0) {
        throw new Error("Insufficient balance");
      }
    });
    return true;
  } catch {
    return false;
  }
}

// Correct access control: verified check is NOT inverted
export interface User {
  id: string;
  verified: boolean;
  banned: boolean;
  subscriptionActive: boolean;
}

export function canAccessPremiumContent(user: User): boolean {
  return user.verified && !user.banned && user.subscriptionActive;
}
