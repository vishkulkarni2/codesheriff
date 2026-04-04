#!/usr/bin/env node
/**
 * Martian Code Review Benchmark Runner for CodeSheriff
 * 
 * Fetches PR diffs from the benchmark golden comments,
 * runs CodeSheriff's analysis pipeline against each,
 * and outputs results in benchmark_data.json format.
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { randomUUID } from 'crypto';
import { resolve, extname, join } from 'path';

// Import CodeSheriff analyzer
import { AnalysisPipeline } from '@codesheriff/analyzer';

const GOLDEN_DIR = resolve(process.env.HOME, '.openclaw/workspace/code-review-benchmark/offline/golden_comments');
const OUTPUT_DIR = resolve(process.env.HOME, '.openclaw/workspace/code-review-benchmark/offline/results');
const OUTPUT_FILE = join(OUTPUT_DIR, 'benchmark_data.json');
const PROGRESS_FILE = join(OUTPUT_DIR, 'benchmark_progress.json');

const EXT_TO_LANG = {
  '.ts': 'typescript', '.tsx': 'typescript',
  '.js': 'javascript', '.jsx': 'javascript', '.mjs': 'javascript',
  '.py': 'python', '.go': 'go', '.java': 'java',
  '.rb': 'ruby', '.rs': 'rust', '.kt': 'kotlin',
  '.php': 'php', '.cs': 'csharp', '.cpp': 'cpp', '.c': 'c',
  '.sh': 'bash', '.scala': 'scala', '.swift': 'swift',
};

function langFromPath(path) {
  const ext = extname(path);
  return EXT_TO_LANG[ext] || 'unknown';
}

// Simple in-memory Redis mock
class MemoryRedis {
  constructor() { this.store = new Map(); }
  async get(key) { return this.store.get(key) ?? null; }
  async set(key, value, ...args) { this.store.set(key, value); return 'OK'; }
  async del(key) { this.store.delete(key); return 1; }
  async incr(key) { const v = (parseInt(this.store.get(key) ?? '0') + 1); this.store.set(key, String(v)); return v; }
  async expire() { return 1; }
  async ttl() { return -1; }
  async keys() { return []; }
}

async function fetchPRDiff(prUrl) {
  // Parse PR URL: https://github.com/owner/repo/pull/123
  const match = prUrl.match(/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/);
  if (!match) throw new Error(`Invalid PR URL: ${prUrl}`);
  const [, owner, repo, prNum] = match;
  
  // Fetch PR files via GitHub API (unauthenticated, 60 req/hr)
  const apiUrl = `https://api.github.com/repos/${owner}/${repo}/pulls/${prNum}/files?per_page=100`;
  const resp = await fetch(apiUrl, {
    headers: { 'Accept': 'application/vnd.github.v3+json' },
  });
  
  if (resp.status === 403 || resp.status === 429) {
    console.error(`  Rate limited. Waiting 60s...`);
    await new Promise(r => setTimeout(r, 60000));
    return fetchPRDiff(prUrl);
  }
  
  if (!resp.ok) {
    throw new Error(`GitHub API error ${resp.status}: ${await resp.text()}`);
  }
  
  return resp.json();
}

function prFilesToAnalysisFiles(prFiles) {
  const analysisFiles = [];
  for (const f of prFiles) {
    if (f.status === 'removed') continue;
    const lang = langFromPath(f.filename);
    if (lang === 'unknown') continue;
    
    // Use patch as content (diff-based analysis)
    // For better analysis, reconstruct file content from patch
    const content = f.patch || '';
    if (!content || content.length < 10) continue;
    
    // Extract added lines from the patch to simulate file content
    const addedLines = content.split('\n')
      .filter(line => line.startsWith('+') && !line.startsWith('+++'))
      .map(line => line.substring(1));
    
    const fileContent = addedLines.join('\n');
    if (fileContent.trim().length < 10) continue;
    
    analysisFiles.push({
      path: f.filename,
      content: fileContent,
      language: lang,
      lineCount: addedLines.length,
      status: f.status === 'added' ? 'added' : 'modified',
      patch: f.patch,
      additions: f.additions || 0,
      deletions: f.deletions || 0,
    });
  }
  return analysisFiles;
}

function findingToComment(finding) {
  let body = `**CodeSheriff: ${finding.title}** [${finding.severity}]\n\n`;
  body += finding.description + '\n';
  if (finding.metadata?.explanation) {
    body += `\n**Why this matters:** ${finding.metadata.explanation}\n`;
  }
  if (finding.metadata?.impact) {
    body += `\n**Impact:** ${finding.metadata.impact}\n`;
  }
  if (finding.autoFix?.suggestedCode) {
    body += `\n**Suggested fix:**\n\`\`\`\n${finding.autoFix.suggestedCode}\n\`\`\`\n`;
  }
  return {
    path: finding.filePath,
    line: finding.lineStart,
    body: body,
    created_at: new Date().toISOString(),
  };
}

async function main() {
  const apiKey = process.env.ANTHROPIC_API_KEY || '';
  if (!apiKey) {
    console.error('ERROR: ANTHROPIC_API_KEY not set');
    process.exit(1);
  }
  
  console.log('=== CodeSheriff Benchmark Runner ===');
  console.log(`API Key: ${apiKey.substring(0, 10)}...`);
  
  // Load golden comments
  const goldenFiles = ['sentry.json', 'grafana.json', 'cal_dot_com.json', 'discourse.json', 'keycloak.json'];
  const allPRs = [];
  
  for (const file of goldenFiles) {
    const data = JSON.parse(readFileSync(join(GOLDEN_DIR, file), 'utf-8'));
    for (const pr of data) {
      allPRs.push({ ...pr, sourceFile: file });
    }
  }
  console.log(`Loaded ${allPRs.length} PRs from golden comments`);
  
  // Load existing progress
  let output = {};
  let progress = {};
  if (existsSync(OUTPUT_FILE)) {
    output = JSON.parse(readFileSync(OUTPUT_FILE, 'utf-8'));
    console.log(`Loaded ${Object.keys(output).length} existing entries`);
  }
  if (existsSync(PROGRESS_FILE)) {
    progress = JSON.parse(readFileSync(PROGRESS_FILE, 'utf-8'));
  }
  
  mkdirSync(OUTPUT_DIR, { recursive: true });
  
  // Initialize pipeline
  const redis = new MemoryRedis();
  const pipeline = new AnalysisPipeline({ anthropicApiKey: apiKey, redis });
  
  let processed = 0;
  let errors = 0;
  let skipped = 0;
  
  for (const pr of allPRs) {
    const prUrl = pr.url;
    
    // Check if already processed for codesheriff
    if (prUrl in output) {
      const existing = output[prUrl].reviews || [];
      if (existing.some(r => r.tool === 'codesheriff')) {
        console.log(`  [SKIP] Already processed: ${prUrl}`);
        skipped++;
        continue;
      }
    }
    
    // Check progress file
    if (progress[prUrl] === 'done') {
      skipped++;
      continue;
    }
    
    console.log(`\n[${processed + skipped + 1}/${allPRs.length}] Processing: ${prUrl}`);
    
    try {
      // Fetch PR diff files
      console.log('  Fetching diff...');
      const prFiles = await fetchPRDiff(prUrl);
      console.log(`  Got ${prFiles.length} files`);
      
      // Convert to analysis files
      const analysisFiles = prFilesToAnalysisFiles(prFiles);
      console.log(`  ${analysisFiles.length} analyzable files`);
      
      if (analysisFiles.length === 0) {
        console.log('  No analyzable files, creating empty review');
        // Still create an entry with empty review
        if (!(prUrl in output)) {
          output[prUrl] = {
            pr_title: pr.pr_title,
            original_url: prUrl,
            source_repo: pr.sourceFile.replace('.json', ''),
            golden_comments: pr.comments,
            golden_source_file: pr.sourceFile,
            reviews: [],
          };
        }
        output[prUrl].reviews.push({
          tool: 'codesheriff',
          pr_url: prUrl,
          review_comments: [],
        });
        progress[prUrl] = 'done';
        processed++;
        continue;
      }
      
      // Run CodeSheriff pipeline
      console.log('  Running CodeSheriff analysis...');
      const ctx = {
        scanId: randomUUID(),
        repoFullName: prUrl.match(/github\.com\/([^/]+\/[^/]+)/)[1],
        provider: 'github',
        branch: 'HEAD',
        commitSha: 'benchmark',
        prNumber: parseInt(prUrl.match(/pull\/(\d+)/)[1]),
        files: analysisFiles,
        dependencies: {},
        features: {
          enableHallucinationDetection: true,
          enableAuthValidation: true,
          enableLogicBugDetection: true,
          enableSecretsScanning: true,
          enableStaticAnalysis: true,
          maxFilesPerScan: 200,
          maxLinesPerFile: 2000,
        },
      };
      
      const result = await pipeline.run(ctx);
      console.log(`  Found ${result.findings.length} findings (risk: ${result.riskScore}, ${result.durationMs}ms)`);
      
      // Convert findings to review comments
      const reviewComments = result.findings.map(findingToComment);
      
      // Build/update output entry
      if (!(prUrl in output)) {
        output[prUrl] = {
          pr_title: pr.pr_title,
          original_url: prUrl,
          source_repo: pr.sourceFile.replace('.json', ''),
          golden_comments: pr.comments,
          golden_source_file: pr.sourceFile,
          reviews: [],
        };
      }
      
      // Remove any existing codesheriff review
      output[prUrl].reviews = (output[prUrl].reviews || []).filter(r => r.tool !== 'codesheriff');
      
      output[prUrl].reviews.push({
        tool: 'codesheriff',
        pr_url: prUrl,
        review_comments: reviewComments,
      });
      
      progress[prUrl] = 'done';
      processed++;
      
      // Save progress every 5 PRs
      if (processed % 5 === 0) {
        writeFileSync(OUTPUT_FILE, JSON.stringify(output, null, 2));
        writeFileSync(PROGRESS_FILE, JSON.stringify(progress, null, 2));
        console.log(`  [SAVED] Progress: ${processed} processed, ${skipped} skipped, ${errors} errors`);
      }
      
      // Rate limiting: wait between API calls
      await new Promise(r => setTimeout(r, 2000));
      
    } catch (err) {
      console.error(`  ERROR: ${err.message}`);
      errors++;
      
      // For rate limit errors, wait longer
      if (err.message.includes('rate') || err.message.includes('Rate') || err.message.includes('403')) {
        console.log('  Waiting 120s for rate limit...');
        await new Promise(r => setTimeout(r, 120000));
      }
    }
  }
  
  // Final save
  writeFileSync(OUTPUT_FILE, JSON.stringify(output, null, 2));
  writeFileSync(PROGRESS_FILE, JSON.stringify(progress, null, 2));
  
  console.log('\n=== Benchmark Run Complete ===');
  console.log(`Processed: ${processed}`);
  console.log(`Skipped: ${skipped}`);
  console.log(`Errors: ${errors}`);
  console.log(`Output: ${OUTPUT_FILE}`);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
