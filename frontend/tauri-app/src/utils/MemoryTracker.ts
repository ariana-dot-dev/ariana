/**
 * Central Memory Tracker Utility
 * 
 * Provides comprehensive memory tracking for the terminal system
 * to help identify memory leaks and performance degradation issues.
 */

export class MemoryTracker {
	private static instance: MemoryTracker | null = null;
	private static trackingStarted = false;
	private intervalId: number | null = null;
	private startTime = Date.now();
	private lastLogTime = Date.now();
	
	// Metrics storage
	private metrics = {
		jsHeapSizes: [] as number[],
		eventListenerCounts: [] as number[],
		connectionCounts: [] as number[],
		screenStateCounts: [] as number[],
		renderTimes: [] as number[]
	};

	private constructor() {}

	static getInstance(): MemoryTracker {
		if (!MemoryTracker.instance) {
			MemoryTracker.instance = new MemoryTracker();
		}
		return MemoryTracker.instance;
	}

	/**
	 * Start comprehensive memory tracking
	 */
	static startTracking(): void {
		if (MemoryTracker.trackingStarted) {
			console.log('[MemoryTrack] Memory tracking already started');
			return;
		}

		const tracker = MemoryTracker.getInstance();
		tracker.start();
		MemoryTracker.trackingStarted = true;
		console.log('[MemoryTrack] Started comprehensive memory tracking');
	}

	/**
	 * Stop memory tracking
	 */
	static stopTracking(): void {
		if (!MemoryTracker.trackingStarted) return;

		const tracker = MemoryTracker.getInstance();
		tracker.stop();
		MemoryTracker.trackingStarted = false;
		console.log('[MemoryTrack] Stopped memory tracking');
	}

	private start(): void {
		// Log initial state
		this.logSystemState();

		// Set up periodic logging
		this.intervalId = window.setInterval(() => {
			this.logSystemState();
			this.analyzeMemoryTrends();
		}, 30000); // Every 30 seconds

		// Log performance API usage if available
		if ('performance' in window && 'memory' in performance) {
			console.log('[MemoryTrack] Performance memory API available');
		} else {
			console.warn('[MemoryTrack] Performance memory API not available - limited memory tracking');
		}
	}

	private stop(): void {
		if (this.intervalId) {
			clearInterval(this.intervalId);
			this.intervalId = null;
		}
		this.logFinalReport();
	}

	private logSystemState(): void {
		const now = Date.now();
		const uptimeMinutes = (now - this.startTime) / (1000 * 60);
		
		console.group(`[MemoryTrack] System State @ ${uptimeMinutes.toFixed(1)}min uptime`);

		// JavaScript heap size (if available)
		if ('performance' in window && 'memory' in (performance as any)) {
			const memory = (performance as any).memory;
			const heapUsedMB = memory.usedJSHeapSize / (1024 * 1024);
			const heapTotalMB = memory.totalJSHeapSize / (1024 * 1024);
			const heapLimitMB = memory.jsHeapSizeLimit / (1024 * 1024);

			console.log(`JS Heap: ${heapUsedMB.toFixed(1)}MB used / ${heapTotalMB.toFixed(1)}MB total (limit: ${heapLimitMB.toFixed(1)}MB)`);
			this.metrics.jsHeapSizes.push(heapUsedMB);

			// Warning thresholds
			if (heapUsedMB > heapLimitMB * 0.8) {
				console.warn(`⚠️ JS Heap approaching limit: ${(heapUsedMB / heapLimitMB * 100).toFixed(1)}%`);
			}
		}

		// Get DOM node count
		const nodeCount = document.querySelectorAll('*').length;
		console.log(`DOM Nodes: ${nodeCount}`);

		// Check for common memory leak indicators
		this.checkMemoryLeakIndicators();

		console.groupEnd();
		this.lastLogTime = now;
	}

	private checkMemoryLeakIndicators(): void {
		// Check for growing collections that should be bounded
		const warnings: string[] = [];

		// Event listeners (check global event target counts if possible)
		try {
			// This is a rough heuristic - not perfect but can indicate issues
			const eventTargets = document.querySelectorAll('[data-event-listeners]').length;
			if (eventTargets > 100) {
				warnings.push(`High event listener count detected: ${eventTargets}`);
			}
		} catch (e) {
			// Ignore - this is a heuristic check
		}

		// Check for detached DOM nodes (rough heuristic)
		const hiddenElements = document.querySelectorAll('[style*="display: none"]').length;
		if (hiddenElements > 500) {
			warnings.push(`Many hidden elements detected: ${hiddenElements} (possible detached nodes)`);
		}

		// Check for large data attributes (another heuristic)
		const dataElements = document.querySelectorAll('[data-terminal-id], [data-element-id]').length;
		if (dataElements > 50) {
			warnings.push(`Many data-tagged elements: ${dataElements}`);
		}

		// Log warnings
		warnings.forEach(warning => {
			console.warn(`[MemoryTrack] Potential leak indicator: ${warning}`);
		});

		// Performance timing warnings
		if ('performance' in window) {
			const navigation = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming;
			if (navigation && navigation.loadEventEnd - (navigation as any).navigationStart > 10000) {
				console.warn(`[MemoryTrack] Slow page load detected: ${navigation.loadEventEnd - (navigation as any).navigationStart}ms`);
			}
		}
	}

	private analyzeMemoryTrends(): void {
		const recentMetrics = this.metrics.jsHeapSizes.slice(-100); // Last 10k measurements
		if (recentMetrics.length < 3) return;

		// Check for consistent growth trend
		let growthCount = 0;
		for (let i = 1; i < recentMetrics.length; i++) {
			if (recentMetrics[i] > recentMetrics[i - 1]) {
				growthCount++;
			}
		}

		const growthRatio = growthCount / (recentMetrics.length - 1);
		if (growthRatio > 0.7 && growthCount > 50) { // 70% of measurements showing growth
			const firstMeasurement = recentMetrics[0];
			const lastMeasurement = recentMetrics[recentMetrics.length - 1];
			const growthMB = lastMeasurement - firstMeasurement;
			const growthPercent = (growthMB / firstMeasurement) * 100;

			console.warn(`[MemoryTrack] 🚨 MEMORY LEAK SUSPECTED: Consistent growth trend detected`);
			console.warn(`[MemoryTrack] Growth: +${growthMB.toFixed(1)}MB (${growthPercent.toFixed(1)}%) over last ${recentMetrics.length} measurements`);
			console.warn(`[MemoryTrack] Consider investigating: Event listeners, Terminal connections, Screen states`);
		}
	}

	private logFinalReport(): void {
		const uptimeMinutes = (Date.now() - this.startTime) / (1000 * 60);
		
		console.group(`[MemoryTrack] Final Report - ${uptimeMinutes.toFixed(1)}min session`);

		if (this.metrics.jsHeapSizes.length > 1) {
			const initialHeap = this.metrics.jsHeapSizes[0];
			const finalHeap = this.metrics.jsHeapSizes[this.metrics.jsHeapSizes.length - 1];
			const totalGrowth = finalHeap - initialHeap;
			const maxHeap = Math.max(...this.metrics.jsHeapSizes);

			console.log(`Heap Growth: ${initialHeap.toFixed(1)}MB → ${finalHeap.toFixed(1)}MB (+${totalGrowth.toFixed(1)}MB)`);
			console.log(`Peak Heap: ${maxHeap.toFixed(1)}MB`);

			if (totalGrowth > 50) {
				console.warn(`⚠️ Significant memory growth detected: +${totalGrowth.toFixed(1)}MB`);
			}
		}

		console.groupEnd();
	}

	/**
	 * Log a custom memory event
	 */
	static logEvent(category: string, message: string, data?: any): void {
		const timestamp = new Date().toLocaleTimeString();
		console.log(`[MemoryTrack:${category}] ${timestamp} - ${message}`, data || '');
	}

	/**
	 * Track render performance
	 */
	static trackRender(componentName: string, renderTime: number): void {
		if (renderTime > 10) {
			console.warn(`[PerfTrack] Slow ${componentName} render: ${renderTime.toFixed(2)}ms`);
		}
		
		const tracker = MemoryTracker.getInstance();
		tracker.metrics.renderTimes.push(renderTime);
	}

	/**
	 * Force garbage collection if available (development only)
	 */
	static forceGC(): void {
		if ('gc' in window) {
			console.log('[MemoryTrack] Forcing garbage collection...');
			(window as any).gc();
		} else {
			console.warn('[MemoryTrack] Garbage collection not available (requires --enable-precise-memory-info flag)');
		}
	}

	/**
	 * Get current memory usage summary
	 */
	static getMemorySummary(): any {
		const summary: any = {
			timestamp: new Date().toISOString(),
			nodeCount: document.querySelectorAll('*').length,
		};

		if ('performance' in window && 'memory' in (performance as any)) {
			const memory = (performance as any).memory;
			summary.heapUsedMB = (memory.usedJSHeapSize / (1024 * 1024)).toFixed(1);
			summary.heapTotalMB = (memory.totalJSHeapSize / (1024 * 1024)).toFixed(1);
			summary.heapLimitMB = (memory.jsHeapSizeLimit / (1024 * 1024)).toFixed(1);
		}

		return summary;
	}
}

// Export convenience functions
export const startMemoryTracking = MemoryTracker.startTracking;
export const stopMemoryTracking = MemoryTracker.stopTracking;
export const logMemoryEvent = MemoryTracker.logEvent;
export const trackRenderPerformance = MemoryTracker.trackRender;
export const forceGarbageCollection = MemoryTracker.forceGC;
export const getMemorySummary = MemoryTracker.getMemorySummary;