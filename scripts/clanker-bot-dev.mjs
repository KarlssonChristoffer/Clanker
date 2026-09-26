#!/usr/bin/env node
/**
 * Samma flöde som scripts/clanker-bot-dev (bash), men Node så Windows/PowerShell
 * undviker CRLF-problem i bash ("set: pipefail: invalid option").
 */
import { execSync, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const shell = process.platform === 'win32';

function run(cmd, opts = {}) {
  execSync(cmd, { stdio: 'inherit', shell, cwd: root, ...opts });
}

function tryRun(cmd) {
  try {
    execSync(cmd, { stdio: 'pipe', shell, cwd: root });
  } catch {
    /* ignore */
  }
}

async function main() {
  process.chdir(root);

  console.log('clanker-bot-dev: stoppar Docker-bot om den körs (port/token)...');
  tryRun('docker compose --profile discord-bridge stop discord-bot');
  tryRun('docker compose --profile discord-host stop discord-bot-host');

  console.log('clanker-bot-dev: startar clanker-db...');
  run('docker compose --profile db up -d clanker-db');

  console.log('clanker-bot-dev: väntar på PostgreSQL...');
  for (let i = 1; i <= 30; i += 1) {
    try {
      execSync('docker compose exec -T clanker-db pg_isready -q', {
        stdio: 'pipe',
        shell,
        cwd: root,
      });
      console.log(`clanker-bot-dev: PostgreSQL redo (${i}s).`);
      break;
    } catch {
      if (i === 30) {
        console.error('clanker-bot-dev: fel: PostgreSQL svarade inte inom 30 s.');
        process.exit(1);
      }
      await new Promise((r) => setTimeout(r, 1000));
    }
  }

  console.log('clanker-bot-dev: kör DB-migrationer...');
  try {
    const out = execSync('npm run migrate -w discord-hub-api', {
      encoding: 'utf8',
      shell,
      cwd: root,
    });
    for (const line of out.split('\n')) {
      if (line) console.log(`  [migrate] ${line}`);
    }
  } catch (e) {
    const err = e;
    if (err.stdout) process.stdout.write(err.stdout);
    if (err.stderr) process.stderr.write(err.stderr);
    process.exit(err.status ?? 1);
  }
  console.log('clanker-bot-dev: migrationer klara.');

  console.log('');
  console.log('clanker-bot-dev: startar discord-bot (npm / tsx watch). Ctrl+C stoppar boten.');
  console.log('  Tips: DATABASE_URL ska peka på 127.0.0.1 (inte clanker-db) när du kör utan Docker-nät.');
  console.log('');

  const child = spawn('npm', ['run', 'dev', '-w', 'discord-bot'], {
    stdio: 'inherit',
    shell,
    cwd: root,
    env: process.env,
  });

  child.on('exit', (code, signal) => {
    if (signal) process.kill(process.pid, signal);
    process.exit(code ?? 1);
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
