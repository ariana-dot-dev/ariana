import { spawn, type ChildProcess } from 'child_process';
import { cpus } from 'os';

const numWorkers = cpus().length;
const workers: ChildProcess[] = [];

console.log(`Starting ${numWorkers} worker processes (${numWorkers} CPU cores detected)...`);

function startWorker(workerId: number) {
  const worker = spawn('bun', ['run', 'index.ts'], {
    cwd: __dirname,
    env: {
      ...process.env,
      WORKER_ID: String(workerId)
    },
    stdio: 'inherit'
  });

  worker.on('exit', (code, signal) => {
    console.log(`Worker ${workerId} exited with code ${code} and signal ${signal}`);

    // Restart the worker if it crashes (unless it was intentionally killed)
    if (signal !== 'SIGTERM' && signal !== 'SIGINT') {
      console.log(`Restarting worker ${workerId}...`);
      setTimeout(() => startWorker(workerId), 1000);
    }
  });

  workers.push(worker);
  return worker;
}

// Start all workers
for (let i = 0; i < numWorkers; i++) {
  startWorker(i);
}

// Handle graceful shutdown
const shutdown = () => {
  console.log('\nShutting down cluster...');

  workers.forEach((worker, i) => {
    console.log(`Sending SIGTERM to worker ${i}`);
    worker.kill('SIGTERM');
  });

  // Force kill after 10 seconds if workers don't exit gracefully
  setTimeout(() => {
    workers.forEach((worker, i) => {
      if (worker.killed === false) {
        console.log(`Force killing worker ${i}`);
        worker.kill('SIGKILL');
      }
    });
    process.exit(0);
  }, 10000);
};

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
process.on('SIGUSR1', shutdown);
process.on('SIGUSR2', shutdown);

console.log(`Cluster started with ${numWorkers} workers (one per CPU core)`);
