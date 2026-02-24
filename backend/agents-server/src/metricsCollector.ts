import os from 'os';
import fs from 'fs';
import path from 'path';

interface MetricPoint {
  timestamp: number; // Unix timestamp in milliseconds
  cpuPercent: number; // 0-100
  memoryUsedMB: number;
  memoryTotalMB: number;
  memoryPercent: number; // 0-100
}

interface EndpointSpan {
  endpoint: string; // e.g., "POST /prompt"
  startTime: number; // Unix timestamp in milliseconds
  endTime: number; // Unix timestamp in milliseconds
  duration: number; // milliseconds
  statusCode?: number;
}

interface MetricsFile {
  serverStartTime: number;
  metrics: MetricPoint[];
  endpointSpans: EndpointSpan[];
}

class MetricsCollector {
  private metrics: MetricPoint[] = [];
  private endpointSpans: EndpointSpan[] = [];
  private maxPoints = 8640; // 24 hours at 10-second intervals
  private maxSpans = 10000; // Keep up to 10k endpoint spans
  private intervalId: Timer | null = null;
  private lastCpuInfo: { idle: number; total: number } | null = null;
  private metricsFilePath: string = '';
  private metricsDir: string = '';
  private serverStartTime: number;
  private initialized: boolean = false;

  constructor(private collectionIntervalMs: number = 10000) {
    this.serverStartTime = Date.now();
  }

  private initialize() {
    if (this.initialized) return;
    this.initialized = true;

    // Use WORK_DIR/.agents-server as the metrics directory
    // This is the correct location since WORK_DIR is where the agent operates
    const workDir = process.env.WORK_DIR;
    if (!workDir) {
      console.warn('[MetricsCollector] WORK_DIR not set, metrics will not be persisted');
      return;
    }

    this.metricsDir = path.join(workDir, '.agents-server');

    try {
      if (!fs.existsSync(this.metricsDir)) {
        fs.mkdirSync(this.metricsDir, { recursive: true });
      }
      this.metricsFilePath = path.join(this.metricsDir, 'metrics.json');
      this.loadMetrics();
    } catch (error) {
      console.error('[MetricsCollector] Failed to create metrics directory:', error);
      this.metricsFilePath = '';
    }
  }

  private loadMetrics() {
    try {
      if (this.metricsFilePath && fs.existsSync(this.metricsFilePath)) {
        const data = fs.readFileSync(this.metricsFilePath, 'utf8');
        const parsed: MetricsFile = JSON.parse(data);

        // Only keep recent metrics (within the last 24 hours)
        const cutoffTime = Date.now() - (24 * 60 * 60 * 1000);
        this.metrics = parsed.metrics.filter(m => m.timestamp > cutoffTime);
        this.endpointSpans = (parsed.endpointSpans || []).filter(s => s.startTime > cutoffTime);

        console.log(
          `[MetricsCollector] Loaded ${this.metrics.length} metrics and ` +
          `${this.endpointSpans.length} endpoint spans from ${this.metricsFilePath}`
        );
      }
    } catch (error) {
      console.error('[MetricsCollector] Failed to load existing metrics:', error);
      this.metrics = [];
      this.endpointSpans = [];
    }
  }

  private saveMetrics() {
    if (!this.metricsFilePath) {
      return; // Metrics persistence disabled
    }

    try {
      const data: MetricsFile = {
        serverStartTime: this.serverStartTime,
        metrics: this.metrics,
        endpointSpans: this.endpointSpans
      };

      fs.writeFileSync(this.metricsFilePath, JSON.stringify(data, null, 2), 'utf8');
    } catch (error) {
      console.error('[MetricsCollector] Failed to save metrics:', error);
    }
  }

  start() {
    if (this.intervalId) {
      console.log('[MetricsCollector] Already running');
      return;
    }

    // Initialize on start (when WORK_DIR is available)
    this.initialize();

    if (this.metricsFilePath) {
      console.log(`[MetricsCollector] Starting metrics collection (writing to ${this.metricsFilePath})`);
    } else {
      console.log('[MetricsCollector] Starting metrics collection (in-memory only)');
    }

    // Collect initial metric
    this.collectMetric();

    // Set up interval
    this.intervalId = setInterval(() => {
      this.collectMetric();
    }, this.collectionIntervalMs);
  }

  stop() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;

      // Save one last time before stopping
      this.saveMetrics();

      console.log('[MetricsCollector] Stopped metrics collection');
    }
  }

  private getCpuUsage(): number {
    const cpus = os.cpus();

    let idle = 0;
    let total = 0;

    cpus.forEach((cpu) => {
      for (const type in cpu.times) {
        total += cpu.times[type as keyof typeof cpu.times];
      }
      idle += cpu.times.idle;
    });

    if (!this.lastCpuInfo) {
      this.lastCpuInfo = { idle, total };
      return 0; // First measurement, no delta yet
    }

    const idleDiff = idle - this.lastCpuInfo.idle;
    const totalDiff = total - this.lastCpuInfo.total;

    this.lastCpuInfo = { idle, total };

    if (totalDiff === 0) return 0;

    const usage = 100 - (100 * idleDiff / totalDiff);
    return Math.max(0, Math.min(100, usage)); // Clamp between 0-100
  }

  private collectMetric() {
    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    const usedMem = totalMem - freeMem;

    const metric: MetricPoint = {
      timestamp: Date.now(),
      cpuPercent: this.getCpuUsage(),
      memoryUsedMB: Math.round(usedMem / (1024 * 1024)),
      memoryTotalMB: Math.round(totalMem / (1024 * 1024)),
      memoryPercent: Math.round((usedMem / totalMem) * 100)
    };

    this.metrics.push(metric);

    // Keep only the last maxPoints
    if (this.metrics.length > this.maxPoints) {
      this.metrics.shift();
    }

    // Save to file
    this.saveMetrics();

    // Log every 10 minutes (60 points at 10s intervals)
    if (this.metrics.length % 60 === 0) {
      console.log(
        `[MetricsCollector] CPU: ${metric.cpuPercent.toFixed(1)}%, ` +
        `RAM: ${metric.memoryUsedMB}MB/${metric.memoryTotalMB}MB (${metric.memoryPercent}%)`
      );
    }
  }

  trackEndpointCall(endpoint: string, startTime: number, endTime: number, statusCode?: number) {
    const span: EndpointSpan = {
      endpoint,
      startTime,
      endTime,
      duration: endTime - startTime,
      statusCode
    };

    this.endpointSpans.push(span);

    // Keep only the last maxSpans
    if (this.endpointSpans.length > this.maxSpans) {
      this.endpointSpans.shift();
    }

    // Save to file (debounced - will be saved on next metric collection or shutdown)
    // We don't save immediately to avoid too many writes
  }
}

// Singleton instance
const metricsCollector = new MetricsCollector(10000); // Collect every 10 seconds

export { metricsCollector, MetricPoint, EndpointSpan };
