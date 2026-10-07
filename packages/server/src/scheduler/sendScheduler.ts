import { isEmailError, type SendResult } from '@fluxmail/core';
import type { DeliveryOperation } from '../service/deliveryCoordinator.js';
import type { FluxmailDb } from '../storage/db.js';
import { logFailure, type Logger } from '../logging.js';
import {
  claimScheduledSend,
  completeClaim,
  failClaim,
  holdPending,
  listActive,
  listClaimable,
  renewClaim,
  retryClaim,
  uncertainClaim,
  type ScheduledSendRow,
} from '../storage/scheduledSends.js';

export interface ScheduledSender {
  send(accountId: string | undefined, input: { draftId: string }): Promise<SendResult>;
  deliverScheduled?(
    accountId: string,
    draftId: string,
    scheduleId: string,
    ownsClaim: () => boolean,
  ): Promise<DeliveryOperation>;
  /** Throws while a lapsed license leaves the instance over the plan quota. */
  enforceQuota(): string | undefined;
}

const POLL_MS = 1_000;
const QUOTA_RECHECK_MS = 15 * 60_000;
const CLAIM_LEASE_MS = 5 * 60_000;
const CLAIM_RENEW_MS = 60_000;
const PERMANENT_CODES = new Set(['not_found', 'invalid_request', 'permission_denied', 'unsupported_capability']);

/** Instance-wide delivery worker, explicitly started by serve or scheduled run. */
export class SendScheduler {
  private timer?: NodeJS.Timeout;
  private running = false;
  private active?: Promise<void>;
  private rerun = false;
  private quotaHoldUntil = 0;

  constructor(
    private readonly db: FluxmailDb,
    private readonly service: ScheduledSender,
    private readonly logger?: Logger,
  ) {}

  start(): void {
    if (this.running) return;
    this.running = true;
    this.wake();
  }

  /** Disable discovery immediately, then wait for the active delivery to record its outcome. */
  async stop(): Promise<void> {
    this.running = false;
    this.rerun = false;
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    await this.active;
  }

  wake(): void {
    if (!this.running) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    if (this.active) {
      this.rerun = true;
      return;
    }
    // Defer tick so active is assigned before any synchronous quota check can wake us.
    this.active = Promise.resolve()
      .then(() => this.tick())
      .finally(() => {
        this.active = undefined;
        if (!this.running) return;
        if (this.rerun) {
          this.rerun = false;
          this.wake();
        } else this.arm();
      });
  }

  /** Only a successful license refresh may shorten a quota hold. */
  licenseRefreshed(): void {
    this.quotaHoldUntil = 0;
    this.wake();
  }

  private async tick(): Promise<void> {
    if (!this.running) return;
    try {
      const now = Date.now();
      if (now < this.quotaHoldUntil) return;
      const due = listClaimable(this.db, now).sort((a, b) => a.sendAt - b.sendAt);
      if (due.length) {
        try {
          this.service.enforceQuota();
          this.quotaHoldUntil = 0;
        } catch (err) {
          this.quotaHoldUntil = now + QUOTA_RECHECK_MS;
          const message = err instanceof Error ? err.message : String(err);
          logFailure(this.logger, 'scheduler.quota_held', err, { details: { pending_count: due.length } });
          for (const row of due) holdPending(this.db, row.id, message);
          return;
        }
      }
      for (const row of due) {
        if (!this.running) break;
        await this.fire(row);
      }
    } catch (err) {
      logFailure(this.logger, 'scheduler.tick_failed', err);
    }
  }

  private async fire(row: ScheduledSendRow): Promise<void> {
    const claim = claimScheduledSend(this.db, row.id, Date.now(), CLAIM_LEASE_MS);
    if (!claim) return;
    let lostOwnership = false;
    const ownsClaim = (): boolean => {
      if (lostOwnership) return false;
      try {
        if (renewClaim(this.db, row.id, claim.token, Date.now(), CLAIM_LEASE_MS)) return true;
      } catch (err) {
        logFailure(this.logger, 'scheduler.claim_renewal_failed', err);
      }
      lostOwnership = true;
      return false;
    };
    const heartbeat = setInterval(ownsClaim, CLAIM_RENEW_MS);
    heartbeat.unref();
    try {
      if (!ownsClaim()) return;
      const operation = this.service.deliverScheduled
        ? await this.service.deliverScheduled(claim.row.accountId, claim.row.draftId, row.id, ownsClaim)
        : {
            status: 'succeeded' as const,
            result: await this.service.send(claim.row.accountId, { draftId: claim.row.draftId }),
          };
      if (lostOwnership && operation.status === 'queued') return;
      if (operation.status === 'succeeded' && operation.result) {
        completeClaim(this.db, row.id, claim.token, operation.result);
      } else if (operation.status === 'failed') {
        failClaim(this.db, row.id, claim.token, operation.error?.code ?? 'Delivery failed.');
      } else {
        uncertainClaim(this.db, row.id, claim.token, 'Delivery outcome is uncertain. Check Sent before sending again.');
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (isEmailError(err) && PERMANENT_CODES.has(err.code)) {
        this.logger?.warn('scheduler.send_failed', message, err, { details: { permanent: true } });
        failClaim(
          this.db,
          row.id,
          claim.token,
          err.code === 'not_found' ? 'Draft no longer exists: it was sent or deleted outside Fluxmail' : message,
        );
      } else {
        const attempt = retryClaim(this.db, row.id, claim.token, message);
        if (attempt !== undefined)
          logFailure(this.logger, 'scheduler.send_retry', err, { details: { attempt, permanent: false } });
      }
    } finally {
      clearInterval(heartbeat);
    }
  }

  private arm(): void {
    if (!this.running) return;
    let delay = POLL_MS;
    try {
      const now = Date.now();
      const pending = listActive(this.db);
      if (pending.length && now >= this.quotaHoldUntil) {
        const next = Math.min(...pending.map((r) => Math.max(r.sendAt, r.nextAttemptAt, r.claimUntil ?? 0)));
        delay = Math.min(POLL_MS, Math.max(next - now, 1));
      }
    } catch (err) {
      logFailure(this.logger, 'scheduler.poll_failed', err);
    }
    this.timer = setTimeout(() => this.wake(), delay);
    this.timer.unref();
  }
}
