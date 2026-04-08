// Run the full analysis pipeline locally against cs-test-nodejs server.js
// to see which detectors find what — independent of Render deploy lag.
import { AnalysisPipeline } from '@codesheriff/analyzer';
import IORedis from 'ioredis';

const code = await (await fetch('https://raw.githubusercontent.com/vishkulkarni2/cs-test-nodejs/main/server.js')).text();

const files = [{
  path: 'server.js',
  content: code,
  language: 'javascript',
  lineCount: code.split('\n').length,
  status: 'modified',
  patch: null,
}];

const redis = new IORedis(process.env.REDIS_URL, { maxRetriesPerRequest: null });

const pipeline = new AnalysisPipeline({
  anthropicApiKey: process.env.ANTHROPIC_API_KEY,
  redis,
});

const result = await pipeline.run({
  scanId: 'local-test-' + Date.now(),
  repositoryId: 'local',
  repoFullName: 'vishkulkarni2/cs-test-nodejs',
  provider: 'GITHUB',
  branch: 'main',
  commitSha: 'local',
  prNumber: null,
  files,
  dependencies: { express: '^4', jsonwebtoken: '^9', mysql2: '^3' },
  features: {
    enableHallucinationDetection: true,
    enableAuthValidation: true,
    enableLogicBugDetection: true,
    enableSecretsScanning: true,
    enableStaticAnalysis: true,
    enableAutoFix: false,
    enableLlmVerifier: false,
    maxFilesPerScan: 50,
    maxLinesPerFile: 1000,
  },
});

console.log('\n=== DETECTOR TIMINGS ===');
console.log(JSON.stringify(result.detectorTimings, null, 2));
console.log('\n=== ERRORS ===');
for (const e of result.errors) console.log(' -', e.detector, e.message.slice(0, 300));
console.log('\n=== FINDINGS (' + result.findings.length + ') ===');
for (const f of result.findings) {
  console.log(` [${f.severity}] ${f.detector} ${f.category} ${f.filePath}:${f.lineStart} :: ${f.title}`);
}
console.log('\nrisk=' + result.riskScore + ' durationMs=' + result.durationMs);

await redis.quit();
process.exit(0);
