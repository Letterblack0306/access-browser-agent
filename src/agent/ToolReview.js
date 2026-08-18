'use strict';

/**
 * ToolReview — Cline-style file change previews and status lifecycle.
 *
 * When the agent edits a file, this module:
 *   1. Captures the original file state (sha256 + snapshot)
 *   2. Produces a human-readable diff preview (before/after side by side)
 *   3. Tracks status transitions: proposed → approved → applied → verified
 *   4. Supports reverting a change back to its original state
 */

const crypto = require('node:crypto');
const path = require('node:path');

const REVIEW_STATUS = Object.freeze({
  PROPOSED: 'proposed',   // diff computed, awaiting approval
  APPROVED: 'approved',   // user approved, ready to write
  APPLIED: 'applied',     // written to disk
  REVERTED: 'reverted',   // rolled back to original
  VERIFIED: 'verified',   // confirmed on disk (sha256 matches after write)
  FAILED: 'failed',       // write or verification failed
});

class FileChangeRecord {
  constructor({ filePath, workspaceRoot, originalContent, proposedContent } = {}) {
    if (!filePath) throw new Error('FileChangeRecord requires filePath.');
    this.filePath = path.resolve(String(filePath));
    this.workspaceRoot = workspaceRoot ? path.resolve(String(workspaceRoot)) : null;
    this.relativePath = this.workspaceRoot
      ? path.relative(this.workspaceRoot, this.filePath).replaceAll('\\', '/')
      : this.filePath;
    this.originalContent = String(originalContent ?? '');
    this.proposedContent = String(proposedContent ?? originalContent ?? '');
    this.status = REVIEW_STATUS.PROPOSED;
    this.requestedAt = new Date().toISOString();
    this.approvedAt = null;
    this.appliedAt = null;
    this.revertedAt = null;
    this.receiptId = null;
    this.diff = null;
  }

  set(proposedContent) {
    this.proposedContent = String(proposedContent ?? '');
    this.status = REVIEW_STATUS.PROPOSED;
    this.diff = buildDiff(this.originalContent, this.proposedContent);
    return this.diff;
  }

  approve() {
    this.status = REVIEW_STATUS.APPROVED;
    this.approvedAt = new Date().toISOString();
    return this;
  }

  markApplied(receiptId = null) {
    this.status = REVIEW_STATUS.APPLIED;
    this.appliedAt = new Date().toISOString();
    this.receiptId = receiptId ? String(receiptId) : null;
    return this;
  }

  markVerified() {
    if (this.status === REVIEW_STATUS.APPLIED) this.status = REVIEW_STATUS.VERIFIED;
    return this;
  }

  markReverted() {
    this.status = REVIEW_STATUS.REVERTED;
    this.revertedAt = new Date().toISOString();
    return this;
  }

  markFailed(error = '') {
    this.status = REVIEW_STATUS.FAILED;
    this.error = String(error || '');
    return this;
  }

  hasChanges() {
    return this.originalContent !== this.proposedContent;
  }

  summary() {
    const stats = diffStats(this.originalContent, this.proposedContent);
    const displayPath = this.relativePath || this.filePath;
    return {
      filePath: displayPath,
      status: this.status,
      additions: stats.additions,
      deletions: stats.deletions,
      changes: stats.changes,
      truncated: this.diff?.truncated || false,
      receiptId: this.receiptId || null,
      requestedAt: this.requestedAt,
      approvedAt: this.approvedAt,
      appliedAt: this.appliedAt,
      revertedAt: this.revertedAt,
    };
  }

  serialize() {
    return {
      filePath: this.filePath,
      relativePath: this.relativePath,
      status: this.status,
      originalContent: this.originalContent,
      proposedContent: this.proposedContent,
      diff: this.diff,
      summary: this.summary(),
      requestedAt: this.requestedAt,
      approvedAt: this.approvedAt,
      appliedAt: this.appliedAt,
      revertedAt: this.revertedAt,
      receiptId: this.receiptId,
      error: this.error || null,
    };
  }
}

/**
 * Build a unified diff string between original and proposed content.
 * Returns a compact preview with line numbers and +/- markers.
 */
function buildDiff(original, proposed) {
  const before = String(original ?? '').split(/\r?\n/);
  const after = String(proposed ?? '').split(/\r?\n/);
  const maxLines = 400;
  const truncated = before.length > maxLines || after.length > maxLines;
  const left = truncated ? before.slice(0, maxLines) : before;
  const right = truncated ? after.slice(0, maxLines) : after;
  const lineCount = Math.max(left.length, right.length);
  const lines = [];
  const maxBeforeDigits = String(left.length).length;
  const maxAfterDigits = String(right.length).length;
  for (let index = 0; index < lineCount; index += 1) {
    const beforeLine = left[index];
    const afterLine = right[index];
    const changed = beforeLine !== afterLine;
    const leftLabel = beforeLine === undefined ? '' : String(index + 1).padStart(maxBeforeDigits, ' ');
    const rightLabel = afterLine === undefined ? '' : String(index + 1).padStart(maxAfterDigits, ' ');
    if (changed) {
      if (beforeLine !== undefined) lines.push(`-${leftLabel}| ${beforeLine}`);
      if (afterLine !== undefined) lines.push(`+${rightLabel}| ${afterLine}`);
    } else {
      lines.push(` ${leftLabel}│ ${beforeLine}`);
    }
  }
  if (truncated) lines.push(`… truncated (${before.length} before, ${after.length} after)`);
  return { text: lines.join('\n'), truncated, ...diffStats(original, proposed) };
}

function diffStats(original, proposed) {
  const beforeLines = String(original ?? '').split(/\r?\n/);
  const afterLines = String(proposed ?? '').split(/\r?\n/);
  const lineCount = Math.max(beforeLines.length, afterLines.length);
  let additions = 0;
  let deletions = 0;
  let changes = 0;
  for (let index = 0; index < lineCount; index += 1) {
    const before = beforeLines[index];
    const after = afterLines[index];
    if (before === undefined) { additions += 1; changes += 1; }
    else if (after === undefined) { deletions += 1; changes += 1; }
    else if (before !== after) { additions += 1; deletions += 1; changes += 1; }
  }
  return { additions, deletions, changes, lines: lineCount };
}

function fileSha256(content) {
  return crypto.createHash('sha256').update(String(content ?? ''), 'utf8').digest('hex');
}

/**
 * Replacement-based editing (Cline-style).
 * Applies SEARCH/REPLACE blocks to file content in update order (sequential).
 */
function applyEditBlocks(original, edits, options = {}) {
  let working = String(original ?? '');
  const applied = [];
  const failed = [];
  const maxBlocks = Number(options.maxBlocks) || 50;

  if (!Array.isArray(edits) || !edits.length) {
    throw new Error('applyEditBlocks requires a non-empty edits array.');
  }
  if (edits.length > maxBlocks) {
    throw new Error(`Too many edit blocks (${edits.length} > ${maxBlocks}).`);
  }

  let cursor = 0;
  for (const edit of edits) {
    if (cursor >= maxBlocks) break;
    const search = String(edit.search ?? edit.oldString ?? edit.find ?? '');
    const replace = String(edit.replace ?? edit.newString ?? edit.text ?? '');
    if (!search) {
      failed.push({ index: cursor, error: 'Edit block has an empty search string.' });
      cursor += 1;
      continue;
    }
    const index = working.indexOf(search);
    if (index < 0) {
      failed.push({ index: cursor, error: `Search string not found: ${search.slice(0, 80)}${search.length > 80 ? '…' : ''}` });
      cursor += 1;
      continue;
    }
    working = working.slice(0, index) + replace + working.slice(index + search.length);
    applied.push({ search: search.slice(0, 120), replace: replace.slice(0, 120), at: index });
    cursor += 1;
  }

  return { content: working, applied, failed, changed: working !== original };
}

/**
 * Aligns a change to the original file on disk for verification.
 */
async function verifyAppliedChange(record, readFile) {
  if (typeof readFile !== 'function') {
    record.markFailed('No file reader was provided for verification.');
    return record;
  }
  try {
    const content = await readFile(record.filePath);
    const matches = String(content ?? '') === record.proposedContent;
    if (matches) {
      record.markVerified();
    } else {
      record.markFailed('On-disk content does not match the proposed content.');
    }
    return record;
  } catch (error) {
    record.markFailed(error?.message || 'Could not read file for verification.');
    return record;
  }
}

module.exports = {
  FileChangeRecord,
  REVIEW_STATUS,
  buildDiff,
  diffStats,
  fileSha256,
  applyEditBlocks,
  verifyAppliedChange,
};