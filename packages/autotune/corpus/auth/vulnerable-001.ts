// @description JWT decoded client-side without server-side verification
// @expectedRuleIds ai-jwt-client-only-decode,ai-jwt-decode-role-check

import jwt from "jsonwebtoken";

// AI-generated: decodes JWT in the browser/client without verifying signature.
// An attacker can forge the payload and elevate their role to 'admin'.
const token = localStorage.getItem("auth_token") ?? "";
const decoded = jwt.decode(token) as { role: string; userId: string } | null;

if (decoded?.role === "admin") {
  renderAdminDashboard();
}

function renderAdminDashboard() {
  document.getElementById("admin-panel")!.style.display = "block";
}
