/**
 * Database seed script — populates a local development database with
 * realistic sample data for UI development and manual testing.
 *
 * Run with: pnpm db:seed
 */

import { PrismaClient, Plan, UserRole, Provider, ScanTrigger, ScanStatus, Severity, FindingCategory } from '@prisma/client';

const prisma = new PrismaClient();

async function main(): Promise<void> {
  console.log('🌱 Seeding CodeSheriff development database...');

  // ---------------------------------------------------------------------------
  // Organization
  // ---------------------------------------------------------------------------
  const org = await prisma.organization.upsert({
    where: { slug: 'acme-corp' },
    update: {},
    create: {
      name: 'Acme Corp',
      slug: 'acme-corp',
      plan: Plan.TEAM,
      seats: 25,
      githubInstallationId: '12345678',
    },
  });
  console.log(`  ✓ Organization: ${org.name}`);

  // ---------------------------------------------------------------------------
  // Users
  // ---------------------------------------------------------------------------
  const owner = await prisma.user.upsert({
    where: { clerkId: 'user_seed_owner' },
    update: {},
    create: {
      clerkId: 'user_seed_owner',
      email: 'alice@acme.com',
      name: 'Alice Chen',
      avatarUrl: 'https://api.dicebear.com/8.x/avataaars/svg?seed=alice',
      organizationId: org.id,
      role: UserRole.OWNER,
    },
  });

  const member = await prisma.user.upsert({
    where: { clerkId: 'user_seed_member' },
    update: {},
    create: {
      clerkId: 'user_seed_member',
      email: 'bob@acme.com',
      name: 'Bob Smith',
      avatarUrl: 'https://api.dicebear.com/8.x/avataaars/svg?seed=bob',
      organizationId: org.id,
      role: UserRole.MEMBER,
    },
  });
  console.log(`  ✓ Users: ${owner.name}, ${member.name}`);

  // ---------------------------------------------------------------------------
  // Global rules
  // ---------------------------------------------------------------------------
  const rules = await Promise.all([
    prisma.rule.upsert({
      where: { id: 'rule_global_jwt_client' },
      update: {},
      create: {
        id: 'rule_global_jwt_client',
        organizationId: null,
        name: 'JWT Validated Client-Side Only',
        description: 'JWT token is decoded or verified only in frontend code without server-side validation.',
        semgrepPattern: 'rules:\n  - id: ai-jwt-client-only\n    pattern: jwt.decode($TOKEN)\n    message: JWT decoded client-side without server validation\n    severity: ERROR\n    languages: [javascript, typescript]',
        isEnabled: true,
        severity: Severity.CRITICAL,
        category: FindingCategory.AUTH,
        isAISpecific: true,
      },
    }),
    prisma.rule.upsert({
      where: { id: 'rule_global_hardcoded_role' },
      update: {},
      create: {
        id: 'rule_global_hardcoded_role',
        organizationId: null,
        name: 'Hardcoded Role Check',
        description: "Detects string comparison for admin role, e.g. if (user.role === 'admin').",
        semgrepPattern: "rules:\n  - id: ai-hardcoded-role-check\n    pattern: $X.role === 'admin'\n    message: Hardcoded role check detected\n    severity: ERROR\n    languages: [javascript, typescript]",
        isEnabled: true,
        severity: Severity.HIGH,
        category: FindingCategory.AUTH,
        isAISpecific: true,
      },
    }),
    prisma.rule.upsert({
      where: { id: 'rule_global_sql_concat' },
      update: {},
      create: {
        id: 'rule_global_sql_concat',
        organizationId: null,
        name: 'SQL String Concatenation',
        description: 'SQL query constructed with string concatenation or template literals — SQL injection risk.',
        semgrepPattern: 'rules:\n  - id: ai-sql-concatenation\n    pattern: db.query(`... ${$VAR} ...`)\n    message: SQL built with string interpolation\n    severity: ERROR\n    languages: [javascript, typescript]',
        isEnabled: true,
        severity: Severity.CRITICAL,
        category: FindingCategory.SECURITY,
        isAISpecific: true,
      },
    }),
    prisma.rule.upsert({
      where: { id: 'rule_global_cors_wildcard' },
      update: {},
      create: {
        id: 'rule_global_cors_wildcard',
        organizationId: null,
        name: 'CORS Wildcard Origin',
        description: "CORS configured with origin: '*' — allows any domain to make credentialed requests.",
        semgrepPattern: "rules:\n  - id: ai-cors-wildcard\n    pattern: origin: '*'\n    message: CORS wildcard origin detected\n    severity: WARNING\n    languages: [javascript, typescript]",
        isEnabled: true,
        severity: Severity.HIGH,
        category: FindingCategory.SECURITY,
        isAISpecific: false,
      },
    }),
  ]);
  console.log(`  ✓ Global rules: ${rules.length} created`);

  // ---------------------------------------------------------------------------
  // Repositories
  // ---------------------------------------------------------------------------
  const repo1 = await prisma.repository.upsert({
    where: { id: 'repo_seed_backend' },
    update: {},
    create: {
      id: 'repo_seed_backend',
      organizationId: org.id,
      name: 'backend-api',
      fullName: 'acme-corp/backend-api',
      provider: Provider.GITHUB,
      defaultBranch: 'main',
      isPrivate: true,
      language: 'typescript',
      riskScore: 74,
      lastScannedAt: new Date(),
    },
  });

  const repo2 = await prisma.repository.upsert({
    where: { id: 'repo_seed_frontend' },
    update: {},
    create: {
      id: 'repo_seed_frontend',
      organizationId: org.id,
      name: 'web-app',
      fullName: 'acme-corp/web-app',
      provider: Provider.GITHUB,
      defaultBranch: 'main',
      isPrivate: true,
      language: 'typescript',
      riskScore: 38,
      lastScannedAt: new Date(Date.now() - 2 * 60 * 60 * 1000),
    },
  });
  console.log(`  ✓ Repositories: ${repo1.name}, ${repo2.name}`);

  // ---------------------------------------------------------------------------
  // Scans
  // ---------------------------------------------------------------------------
  const scan1 = await prisma.scan.upsert({
    where: { id: 'scan_seed_001' },
    update: {},
    create: {
      id: 'scan_seed_001',
      repositoryId: repo1.id,
      triggeredBy: ScanTrigger.PR,
      prNumber: 47,
      prTitle: 'feat: add user authentication with JWT',
      branch: 'feature/auth-jwt',
      commitSha: 'a1b2c3d4e5f6789012345678901234567890abcd',
      status: ScanStatus.COMPLETE,
      riskScore: 74,
      findingsCount: 18,
      criticalCount: 2,
      highCount: 5,
      mediumCount: 8,
      lowCount: 3,
      durationMs: 12450,
      startedAt: new Date(Date.now() - 15 * 60 * 1000),
      completedAt: new Date(Date.now() - 15 * 60 * 1000 + 12450),
    },
  });
  console.log(`  ✓ Scan: ${scan1.id} (${scan1.status})`);

  // ---------------------------------------------------------------------------
  // Findings for scan1
  // ---------------------------------------------------------------------------
  const findingSeed = [
    {
      id: 'finding_seed_001',
      title: 'JWT validated client-side only',
      description: 'JWT token is decoded and verified only in the React component without server-side validation. Any user can craft a valid-looking token.',
      explanation: 'The JWT.decode() call on line 42 only decodes the token payload without cryptographic signature verification. An attacker can modify the payload (e.g., escalate role to admin) and the client will trust it.',
      remediation: `// Bad (current code)\nconst payload = jwt.decode(token); // No verification!\n\n// Good — verify on the server\n// pages/api/protected.ts\nimport { verify } from 'jsonwebtoken';\nconst payload = verify(token, process.env.JWT_SECRET);`,
      severity: Severity.CRITICAL,
      category: FindingCategory.AUTH,
      filePath: 'src/auth/client.ts',
      lineStart: 42,
      lineEnd: 44,
      codeSnippet: "const payload = jwt.decode(token);\nif (payload.role === 'admin') {\n  showAdminPanel();\n}",
      isAIPatternSpecific: true,
      ruleId: rules[0]?.id ?? null,
    },
    {
      id: 'finding_seed_002',
      title: "Hardcoded admin role check",
      description: "String comparison used for role-based access control. This is fragile and commonly introduced by AI coding assistants.",
      explanation: "Comparing role as a plain string is insecure and brittle. It bypasses any role enum/constant and is easily typo'd or spoofed if roles are user-controlled.",
      remediation: "// Use constants and server-side middleware\nimport { requireRole } from '@/middleware/auth';\napp.get('/admin', requireRole('ADMIN'), handler);",
      severity: Severity.HIGH,
      category: FindingCategory.AUTH,
      filePath: 'src/middleware/auth.ts',
      lineStart: 18,
      lineEnd: 20,
      codeSnippet: "if (user.role === 'admin') {\n  return next();\n}",
      isAIPatternSpecific: true,
      ruleId: rules[1]?.id ?? null,
    },
    {
      id: 'finding_seed_003',
      title: 'SQL built with string concatenation',
      description: 'User-controlled input is interpolated directly into a SQL query string, enabling SQL injection.',
      explanation: 'Template literals in SQL queries allow attackers to inject arbitrary SQL. Even "safe-looking" variable names like userId do not prevent injection if the value is attacker-controlled.',
      remediation: "// Use parameterized queries\nconst result = await db.query(\n  'SELECT * FROM users WHERE id = $1',\n  [userId]\n);",
      severity: Severity.CRITICAL,
      category: FindingCategory.SECURITY,
      filePath: 'src/db/users.ts',
      lineStart: 31,
      lineEnd: 31,
      codeSnippet: 'const result = await db.query(`SELECT * FROM users WHERE id = ${userId}`);',
      isAIPatternSpecific: true,
      ruleId: rules[2]?.id ?? null,
    },
  ];

  for (const f of findingSeed) {
    await prisma.finding.upsert({
      where: { id: f.id },
      update: {},
      create: {
        ...f,
        scanId: scan1.id,
        repositoryId: repo1.id,
        falsePositive: false,
        suppressed: false,
      },
    });
  }
  console.log(`  ✓ Findings: ${findingSeed.length} created for scan ${scan1.id}`);

  // ---------------------------------------------------------------------------
  // Risk history (last 7 days for the repo)
  // ---------------------------------------------------------------------------
  for (let i = 6; i >= 0; i--) {
    const date = new Date();
    date.setDate(date.getDate() - i);
    date.setHours(0, 0, 0, 0);

    const score = 60 + Math.floor(Math.random() * 20);

    await prisma.riskHistory.upsert({
      where: { repositoryId_date: { repositoryId: repo1.id, date } },
      update: { riskScore: score },
      create: {
        repositoryId: repo1.id,
        date,
        riskScore: score,
        criticalCount: Math.floor(Math.random() * 3),
        highCount: Math.floor(Math.random() * 6),
        mediumCount: Math.floor(Math.random() * 10),
        lowCount: Math.floor(Math.random() * 5),
      },
    });
  }
  console.log(`  ✓ Risk history: 7 days for ${repo1.name}`);

  console.log('\n✅ Seed complete!');
}

main()
  .catch((e) => {
    console.error('❌ Seed failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
