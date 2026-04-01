// @description Race condition in non-atomic balance deduction

import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();

// AI-generated: read-modify-write without a transaction or atomic update.
// Two concurrent requests can both read balance=100, both deduct 80,
// both write back 20 — allowing double-spend.
export async function deductBalance(userId: string, amount: number): Promise<boolean> {
  const account = await prisma.account.findUnique({ where: { id: userId } });
  if (!account) return false;

  // BUG: non-atomic — another request can read the same balance concurrently
  if (account.balance < amount) return false;

  await prisma.account.update({
    where: { id: userId },
    data: { balance: account.balance - amount },
  });

  return true;
}

// Second bug: Promise.all with shared mutation
export async function processOrders(orderIds: string[]) {
  let totalRevenue = 0; // shared mutable state

  await Promise.all(
    orderIds.map(async (id) => {
      const order = await prisma.order.findUnique({ where: { id } });
      if (order) {
        // BUG: concurrent writes to totalRevenue — final value is non-deterministic
        totalRevenue += order.amount;
      }
    })
  );

  return totalRevenue;
}
