// @description Hardcoded role string check allows privilege escalation by string manipulation
// @expectedRuleIds ai-hardcoded-role-string-admin

import type { Request, Response, NextFunction } from "express";

interface AuthUser {
  id: string;
  role: string;
}

// AI-generated: compares role to literal string 'admin'.
// No enum or constant — easy to confuse with typos or alternative spellings.
export function requireAdmin(req: Request, res: Response, next: NextFunction) {
  const user = req.user as AuthUser | undefined;
  if (user?.role === "admin") {
    return next();
  }
  return res.status(403).json({ error: "Forbidden" });
}

// Additional issue: no check that user is defined at all before role comparison
export function deleteUser(req: Request, res: Response) {
  const requestingUser = req.user as AuthUser;
  if (requestingUser.role === "admin" || requestingUser.id === req.params["targetId"]) {
    // Deletes user — IDOR: any user can delete themselves with their own ID
    res.json({ deleted: req.params["targetId"] });
  }
}
