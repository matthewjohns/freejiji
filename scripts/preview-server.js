#!/usr/bin/env node
/**
 * Freejiji Preview Server
 * =======================
 * Serves preview-tool.html locally and exposes a POST /api/generate
 * endpoint that spawns generate-week.js and streams its output back
 * as Server-Sent Events so the browser can show a live log.
 *
 * Usage:
 *   cd scripts && node preview-server.js
 *   # or: npm run server
 *
 * Then open http://localhost:3333 in your browser.
 */

'use strict';

const http   = require('http');
const fs     = require('fs');
const path   = require('path');
const { spawn, exec } = require('child_process');

const PORT      = 3333;
const HTML_FILE = path.join(__dirname, 'preview-tool.html');

// ── Server ──────────────────────────────────────────────────────────────────

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);

  // Basic CORS for local dev
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  // ── GET / → serve preview-tool.html ──
  if (req.method === 'GET' && url.pathname === '/') {
    try {
      // Read fresh on every request so edits take effect on reload
      const html = fs.readFileSync(HTML_FILE, 'utf8');
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(html);
    } catch (err) {
      res.writeHead(500);
      res.end('Could not read preview-tool.html: ' + err.message);
    }
    return;
  }

  // ── POST /api/generate → spawn generate-week.js, stream output via SSE ──
  if (req.method === 'POST' && url.pathname === '/api/generate') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      let options = {};
      try { options = JSON.parse(body); } catch (_) {}

      // Build args
      const args = ['generate-week.js'];
      const offset = parseInt(options.offset, 10) || 0;
      if (offset > 0) args.push(`--offset=${offset}`);
      if (options.force) args.push('--force');

      const cmdStr = `node ${args.join(' ')}`;
      console.log(`\n▶  ${cmdStr}`);

      // SSE response
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no',
      });

      let finished = false;

      // Send a keepalive ping every 2 seconds to prevent client-side/browser idle timeouts
      const keepAliveId = setInterval(() => {
        if (finished) return;
        try {
          res.write(': ping\n\n');
        } catch (_) {}
      }, 2000);

      const send = (data) => {
        if (finished) return;
        try {
          res.write(`data: ${JSON.stringify(data)}\n\n`);
        } catch (_) {}
      };

      // Always show the command as the first log line
      send({ type: 'stdout', text: `$ ${cmdStr}` });
      send({ type: 'stdout', text: '' });

      const proc = spawn('node', args, {
        cwd: __dirname,
        env: { ...process.env },
      });

      // Unified cleanup function to avoid race conditions and double-closing
      const cleanup = () => {
        if (finished) return;
        finished = true;
        clearInterval(keepAliveId);
        if (!proc.killed) {
          try { proc.kill(); } catch (_) {}
        }
      };

      res.on('close', () => {
        cleanup();
      });

      res.on('error', (err) => {
        console.error(`  [socket error] ${err.message}`);
        cleanup();
      });

      let stdoutBuf = '';
      let stderrBuf = '';
      let lineCount = 0;

      const flushBuf = (buf, incoming, isErr) => {
        buf += incoming;
        const lines = buf.split('\n');
        const remaining = lines.pop();
        for (const line of lines) {
          lineCount++;
          console.log(isErr ? `  [stderr] ${line}` : `  ${line}`);
          send({ type: isErr ? 'stderr' : 'stdout', text: line });
        }
        return remaining;
      };

      proc.stdout.on('data', data => {
        stdoutBuf = flushBuf(stdoutBuf, data.toString(), false);
      });
      proc.stderr.on('data', data => {
        stderrBuf = flushBuf(stderrBuf, data.toString(), true);
      });

      proc.on('close', (code) => {
        if (stdoutBuf) { lineCount++; console.log(`  ${stdoutBuf}`); send({ type: 'stdout', text: stdoutBuf }); }
        if (stderrBuf) { lineCount++; console.error(`  [stderr] ${stderrBuf}`); send({ type: 'stderr', text: stderrBuf }); }

        // If the process produced no output at all, send a diagnostic
        if (lineCount === 0 && code !== 0) {
          const hint = `Process exited immediately with code ${code} and no output.\n` +
            `Likely causes:\n` +
            `  • service-account.json is missing from scripts/\n` +
            `  • firebase-admin is not installed (run: cd scripts && npm install)\n` +
            `  • A Node.js require() error (check this terminal for details)`;
          console.error(`\n  ⚠️  No output captured. ${hint}`);
          send({ type: 'stderr', text: hint });
        }

        console.log(`\n  exit code: ${code ?? 1}`);
        send({ type: 'done', code: code ?? 1 });

        if (!finished) {
          try { res.end(); } catch (_) {}
        }
        cleanup();
      });

      proc.on('error', (err) => {
        const msg = `Failed to spawn process: ${err.message}`;
        console.error(`  ❌ ${msg}`);
        send({ type: 'stderr', text: msg });
        send({ type: 'done', code: 1 });
        if (!finished) {
          try { res.end(); } catch (_) {}
        }
        cleanup();
      });
    });
    return;
  }

  res.writeHead(404);
  res.end('Not found');
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`\n❌  Port ${PORT} is already in use.`);
    console.error(`    To free it: kill $(lsof -t -i:${PORT})\n`);
  } else {
    console.error('\n❌  Server error:', err.message);
  }
  process.exit(1);
});

server.listen(PORT, '127.0.0.1', () => {
  const url = `http://localhost:${PORT}`;
  console.log('\n🎨  Freejiji Preview Server');
  console.log(`📡  Listening at ${url}`);
  console.log('    Press Ctrl+C to stop\n');
  const open = process.platform === 'win32' ? 'start' : 'open';
  exec(`${open} "${url}"`);
});
