import { EmailError } from '@fluxmail/core';
import { eq } from 'drizzle-orm';
import { accounts, instanceSettings, licenseLease, members, type FluxmailDb } from '../storage/db.js';
import { licensePublicKeys, verifyLease } from './lease.js';

/** After a lease expires, paid limits are honored this much longer before the plan lapses. */
export const GRACE_PERIOD_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * When a paid lease lowers the caps below current usage (for example, after
 * removing members), email tools keep working this long so the operator can
 * remove the extra mailboxes or members.
 */
export const CAP_REDUCTION_GRACE_MS = 7 * 24 * 60 * 60 * 1000;

/** Epoch milliseconds when this licensed instance first went over its caps. */
const OVER_CAP_SINCE_KEY = 'license_over_cap_since';

export interface Entitlements {
  /** 'personal' when unlicensed, otherwise the plan name from the signed lease. */
  plan: string;
  /** True while a lease grants paid limits (including the grace period). */
  licensed: boolean;
  /** True when the lease has expired but the grace period is still running. */
  inGrace: boolean;
  maxMembers: number;
  maxAccounts: number;
  /** Licensed only: when the lease expires (or expired) and the grace period starts. */
  leaseExpiresAt?: string;
  /** In grace only: when paid limits lapse to the Personal plan unless renewed. */
  graceUntil?: string;
}

export const PERSONAL_TIER: Entitlements = {
  plan: 'personal',
  licensed: false,
  inGrace: false,
  maxMembers: 1,
  maxAccounts: 3,
};

const LEASE_ROW_ID = 'current';

/** Accepts a transaction as well as the root db, like the other storage helpers. */
type DbReader = Pick<FluxmailDb, 'select'>;

export function readLeaseRow(db: DbReader): { token: string; updatedAt: number } | undefined {
  const row = db.select().from(licenseLease).where(eq(licenseLease.id, LEASE_ROW_ID)).get();
  return row ? { token: row.token, updatedAt: row.updatedAt } : undefined;
}

export function saveLeaseToken(db: Pick<FluxmailDb, 'insert'>, token: string): void {
  const updatedAt = Date.now();
  db.insert(licenseLease)
    .values({ id: LEASE_ROW_ID, token, updatedAt })
    .onConflictDoUpdate({ target: licenseLease.id, set: { token, updatedAt } })
    .run();
}

export function clearLease(db: FluxmailDb): void {
  db.transaction((tx) => {
    tx.delete(licenseLease).where(eq(licenseLease.id, LEASE_ROW_ID)).run();
    tx.delete(instanceSettings).where(eq(instanceSettings.key, OVER_CAP_SINCE_KEY)).run();
  });
}

/**
 * Effective entitlements: the plan and caps from the cached lease while it
 * verifies against a pinned license-server key, Personal-plan limits otherwise.
 * An expired lease keeps its paid limits through the grace period, so a
 * renewal hiccup never interrupts a running server. Reads only local state;
 * enforcement never waits on the network.
 */
export function getEntitlements(db: DbReader, now = new Date()): Entitlements {
  const row = readLeaseRow(db);
  if (!row) return PERSONAL_TIER;
  try {
    const lease = verifyLease(row.token, licensePublicKeys(), now, { allowExpired: true });
    const expiresAt = Date.parse(lease.expiresAt);
    const graceUntil = expiresAt + GRACE_PERIOD_MS;
    if (now.getTime() >= graceUntil) return PERSONAL_TIER;
    const inGrace = now.getTime() >= expiresAt;
    return {
      plan: lease.plan,
      licensed: true,
      inGrace,
      maxMembers: lease.maxMembers,
      maxAccounts: lease.maxAccounts,
      leaseExpiresAt: lease.expiresAt,
      ...(inGrace ? { graceUntil: new Date(graceUntil).toISOString() } : {}),
    };
  } catch {
    // Unverifiable lease: degrade to Personal-plan limits, never block.
    return PERSONAL_TIER;
  }
}

function assertLimit(kind: 'mailbox' | 'member', current: number, max: number, ent: Entitlements): void {
  if (current < max) return;
  const noun = `${kind === 'mailbox' ? 'connected mailbox' : 'member'}${max === 1 ? '' : kind === 'mailbox' ? 'es' : 's'}`;
  throw new EmailError(
    'entitlement_exceeded',
    ent.licensed
      ? `Your ${ent.plan} plan allows ${max} ${noun} (currently ${current}). Upgrade your plan to add more.`
      : `The Personal plan allows ${max} ${noun} (currently ${current}). ` +
          'A Fluxmail subscription unlocks more; see the README for details.',
  );
}

export function assertAccountLimit(current: number, entitlements: Entitlements): void {
  assertLimit('mailbox', current, entitlements.maxAccounts, entitlements);
}

export function assertMemberLimit(current: number, entitlements: Entitlements): void {
  assertLimit('member', current, entitlements.maxMembers, entitlements);
}

/** Freeze new mailboxes and members while a paid instance exceeds either cap. */
export function assertCanIncreaseUsage(db: DbReader): void {
  const state = checkLicenseState(db);
  if (!state.entitlements.licensed || !state.overQuota) return;
  throw new EmailError(
    'entitlement_exceeded',
    'This instance exceeds its plan limits. Remove extra mailboxes or members, or upgrade your plan, before adding more.',
  );
}

export interface LicenseState {
  entitlements: Entitlements;
  accountCount: number;
  memberCount: number;
  /** Usage exceeds the entitled caps, after a paid license lapsed or its caps went down. */
  overQuota: boolean;
  /** Over quota and past any cap-reduction grace, so email tools are blocked. */
  blocked: boolean;
  /** While a lowered paid cap is still in grace: when email tools will be blocked. */
  capGraceUntil?: string;
  /** Renewal warning while in grace or after a lapse; undefined when all is well. */
  warning?: string;
}

function usageCounts(db: DbReader): { accountCount: number; memberCount: number } {
  return {
    accountCount: db.select().from(accounts).all().length,
    memberCount: db.select().from(members).all().length,
  };
}

function readOverCapSince(db: DbReader): number | undefined {
  const value = db.select().from(instanceSettings).where(eq(instanceSettings.key, OVER_CAP_SINCE_KEY)).get()?.value;
  const since = Number(value);
  return value && Number.isSafeInteger(since) ? since : undefined;
}

/**
 * Start the cap-reduction grace period when a licensed instance first finds
 * itself over its caps, and clear it once usage fits. Call after the lease
 * changes. A later lease that is still over the caps keeps the original start.
 */
export function recordCapState(db: Pick<FluxmailDb, 'select' | 'insert' | 'delete'>, now = new Date()): void {
  const entitlements = getEntitlements(db, now);
  const { accountCount, memberCount } = usageCounts(db);
  const over =
    entitlements.licensed && (accountCount > entitlements.maxAccounts || memberCount > entitlements.maxMembers);
  if (!over) {
    db.delete(instanceSettings).where(eq(instanceSettings.key, OVER_CAP_SINCE_KEY)).run();
    return;
  }
  if (readOverCapSince(db) !== undefined) return;
  db.insert(instanceSettings)
    .values({ key: OVER_CAP_SINCE_KEY, value: String(now.getTime()) })
    .onConflictDoNothing()
    .run();
}

function plural(count: number, noun: string, plural = `${noun}s`): string {
  return `${count} ${count === 1 ? noun : plural}`;
}

function excessUsage(accountCount: number, memberCount: number, ent: Entitlements): string {
  const extras = [
    accountCount > ent.maxAccounts ? plural(accountCount - ent.maxAccounts, 'mailbox', 'mailboxes') : '',
    memberCount > ent.maxMembers ? plural(memberCount - ent.maxMembers, 'member') : '',
  ].filter(Boolean);
  return extras.join(' and ');
}

/** Entitlements plus current usage, for quota enforcement and renewal warnings. */
export function checkLicenseState(db: DbReader, now = new Date()): LicenseState {
  const entitlements = getEntitlements(db, now);
  const { accountCount, memberCount } = usageCounts(db);
  const overQuota = accountCount > entitlements.maxAccounts || memberCount > entitlements.maxMembers;

  const overCapSince = overQuota && entitlements.licensed ? readOverCapSince(db) : undefined;
  const capGraceEnds = overCapSince === undefined ? undefined : overCapSince + CAP_REDUCTION_GRACE_MS;
  const inCapGrace = capGraceEnds !== undefined && now.getTime() < capGraceEnds;
  const blocked = overQuota && !inCapGrace;

  const warnings: string[] = [];
  if (overQuota && entitlements.licensed) {
    const usage =
      `This instance has ${plural(accountCount, 'mailbox', 'mailboxes')} and ${plural(memberCount, 'member')}, ` +
      `but the ${entitlements.plan} plan allows ${plural(entitlements.maxAccounts, 'mailbox', 'mailboxes')} ` +
      `and ${plural(entitlements.maxMembers, 'member')}.`;
    const fix = `remove ${excessUsage(accountCount, memberCount, entitlements)} or upgrade your plan`;
    warnings.push(
      inCapGrace
        ? `${usage} To keep email tools working, ${fix} by ${new Date(capGraceEnds).toISOString()}.`
        : `${usage} Email tools are blocked until you ${fix}.`,
    );
  }
  if (entitlements.inGrace) {
    warnings.push(
      `The Fluxmail license expired ${entitlements.leaseExpiresAt}; paid limits continue until ` +
        `${entitlements.graceUntil}. Renew before then or this instance drops to the Personal plan.`,
    );
  } else if (!entitlements.licensed && readLeaseRow(db)) {
    warnings.push(
      `The Fluxmail license has lapsed; this instance is on the Personal plan ` +
        `(${entitlements.maxAccounts} mailboxes, ${entitlements.maxMembers} member).` +
        (overQuota
          ? ` Current usage (${accountCount} mailboxes, ${memberCount} members) exceeds that, so email tools are ` +
            'blocked until you renew the license or remove mailboxes/members to fit.'
          : ''),
    );
  }
  const warning = warnings.length ? warnings.join(' ') : undefined;
  return {
    entitlements,
    accountCount,
    memberCount,
    overQuota,
    blocked,
    ...(inCapGrace ? { capGraceUntil: new Date(capGraceEnds).toISOString() } : {}),
    ...(warning ? { warning } : {}),
  };
}

/**
 * Gate for MCP tool calls: throws once the instance is over the entitled caps,
 * after a lapse or once a cap reduction's grace period ends. Returns the
 * current state so callers can surface grace warnings without a second read.
 */
export function assertWithinQuota(db: DbReader, now = new Date()): LicenseState {
  const state = checkLicenseState(db, now);
  if (state.blocked) {
    const { entitlements: ent } = state;
    throw new EmailError(
      'entitlement_exceeded',
      `This instance has ${state.accountCount} connected mailboxes and ${state.memberCount} members, but the ` +
        `${ent.plan} plan allows ${ent.maxAccounts} and ${ent.maxMembers}. ` +
        (ent.licensed ? 'Upgrade the plan' : 'Renew the license ("fluxmail license activate")') +
        ' or remove mailboxes/members ' +
        '("fluxmail accounts remove", "fluxmail members remove") to fit the plan.',
    );
  }
  return state;
}
