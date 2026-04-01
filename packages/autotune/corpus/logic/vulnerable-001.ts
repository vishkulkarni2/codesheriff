// @description Inverted auth guard lets unverified users through

interface User {
  id: string;
  email: string;
  verified: boolean;
  banned: boolean;
  subscriptionActive: boolean;
}

// AI-generated: condition is inverted.
// Intent: allow only verified, non-banned, active subscribers.
// Bug: !user.verified means UNVERIFIED users pass the check.
export function canAccessPremiumContent(user: User): boolean {
  if (!user.verified && !user.banned && user.subscriptionActive) {
    return true;
  }
  return false;
}

// Second bug: off-by-one in rate limit check
// Allows exactly LIMIT+1 requests before blocking
export function isRateLimited(requestCount: number, limit: number): boolean {
  return requestCount > limit; // should be >= limit
}

// Third bug: type coercion bypass — userId "0" is falsy in JS
export function isOwner(userId: string | number, resourceOwnerId: string): boolean {
  // BUG: if userId is 0 or "0", this check is bypassed
  if (!userId) return false;
  return String(userId) === resourceOwnerId;
}
