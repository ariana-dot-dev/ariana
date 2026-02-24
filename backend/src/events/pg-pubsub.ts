import pg from 'pg';
import { eventBus, type EventBusEvents } from './emitter';
import { getLogger } from '@/utils/logger';

const logger = getLogger(['ws', 'pg-pubsub']);

const PG_CHANNEL = 'ws_events';

/**
 * PostgreSQL LISTEN/NOTIFY bridge for cross-worker event delivery.
 *
 * Each worker creates one instance. It opens ONE dedicated pg connection
 * for LISTEN (must stay open). NOTIFY goes through the same connection
 * to avoid doubling raw connections per worker.
 *
 * emitEvent() → pg_notify() → all workers receive → local EventBus dispatch
 */
class PgPubSub {
  private client: pg.Client | null = null;
  private reconnecting = false;
  private connectionString: string | null = null;

  async start(): Promise<void> {
    this.connectionString = process.env.DATABASE_URL || null;
    if (!this.connectionString) {
      logger.error`DATABASE_URL not set, PgPubSub cannot start`;
      return;
    }

    await this.connect();
    logger.info`PgPubSub started on channel ${PG_CHANNEL}`;
  }

  private async connect(): Promise<void> {
    if (!this.connectionString) return;

    this.client = new pg.Client({ connectionString: this.connectionString });
    await this.client.connect();
    await this.client.query(`LISTEN ${PG_CHANNEL}`);

    this.client.on('notification', this.onNotification);

    this.client.on('error', (err) => {
      logger.error`PgPubSub connection error: ${err}`;
      this.scheduleReconnect();
    });

    this.client.on('end', () => {
      logger.warn`PgPubSub connection ended`;
      this.scheduleReconnect();
    });
  }

  private onNotification = (msg: pg.Notification): void => {
    if (msg.channel !== PG_CHANNEL || !msg.payload) return;
    try {
      const { event, data } = JSON.parse(msg.payload);
      // Dispatch to local EventBus (triggers WS channel handlers on THIS worker)
      eventBus.emit(event, data);
    } catch (err) {
      logger.error`Failed to parse PG notification: ${err}`;
    }
  };

  async notify<K extends keyof EventBusEvents>(event: K, data: EventBusEvents[K]): Promise<void> {
    if (!this.client) {
      logger.error`PgPubSub not connected, cannot notify`;
      return;
    }
    try {
      const payload = JSON.stringify({ event, data });
      await this.client.query(`SELECT pg_notify($1, $2)`, [PG_CHANNEL, payload]);
    } catch (err) {
      logger.error`PgPubSub notify failed: ${err}`;
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnecting) return;
    this.reconnecting = true;

    // Detach old client fully
    this.destroyClient();

    this.reconnectLoop().finally(() => {
      this.reconnecting = false;
    });
  }

  private destroyClient(): void {
    if (!this.client) return;
    // Remove all listeners to prevent duplicate handlers
    this.client.removeAllListeners();
    try { this.client.end(); } catch {}
    this.client = null;
  }

  private async reconnectLoop(): Promise<void> {
    let delay = 1000;
    while (true) {
      await new Promise(r => setTimeout(r, delay));
      try {
        await this.connect();
        logger.info`PgPubSub connection re-established`;
        return;
      } catch (err) {
        // Clean up the failed attempt
        this.destroyClient();
        logger.error`PgPubSub reconnect failed, retrying in ${delay}ms: ${err}`;
        delay = Math.min(delay * 2, 30000);
      }
    }
  }

  async stop(): Promise<void> {
    this.destroyClient();
  }
}

export const pgPubSub = new PgPubSub();
