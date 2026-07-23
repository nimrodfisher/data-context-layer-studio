import type { CanonicalProject } from '@context-layer/core';

import { AgentFailure } from './types.js';

const FORBIDDEN = new Set(['__proto__', 'prototype', 'constructor']);
const OPTIONAL_PATHS = [
  /^metadata\.description$/,
  /^domain\.audiences\.#\.description$/,
  /^sources\.#\.(?:adapter)$/,
  /^sources\.#\.freshness\.checkedAt$/,
  /^sources\.#\.connection\.(?:endpoint|credentialRef|metadata)$/,
  /^evidence\.#\.excerpt$/,
  /^productContext\.claims\.#\.provenance\.(?:note|updatedAt)$/,
  /^data\.assets\.#\.(?:fullyQualifiedName|description|grain)$/,
  /^data\.assets\.#\.columns\.#\.(?:description|nullable)$/,
  /^data\.profiles\.#\.(?:rowCount|freshnessAt|columns)$/,
  /^data\.profiles\.#\.columns\.#\.(?:nullRate|distinctCount)$/,
  /^data\.metrics\.#\.grain$/,
  /^clarifications\.#\.ownerId$/,
  /^tests\.results\.#\.message$/,
];

function isAllowedOptionalPath(path: readonly (string | number)[]): boolean {
  const normalized = path.map((part) => (typeof part === 'number' ? '#' : part)).join('.');
  return OPTIONAL_PATHS.some((pattern) => pattern.test(normalized));
}

export function canonicalPathIdentity(
  project: CanonicalProject,
  path: readonly (string | number)[],
): Array<string | number> {
  if (path.length === 0 || path.length > 16) {
    throw new AgentFailure('MODEL_OUTPUT_INVALID', 'Model returned an invalid canonical path');
  }
  let current: unknown = project;
  const identity: Array<string | number> = [];
  for (const [position, part] of path.entries()) {
    if (typeof part === 'string' && FORBIDDEN.has(part)) {
      throw new AgentFailure('MODEL_OUTPUT_INVALID', 'Model returned an unsafe canonical path');
    }
    if (Array.isArray(current)) {
      if (
        !Number.isInteger(part) ||
        typeof part !== 'number' ||
        part < 0 ||
        part >= current.length
      ) {
        throw new AgentFailure('MODEL_OUTPUT_INVALID', 'Model path references a missing entity');
      }
      const entry = current[part];
      if (
        entry &&
        typeof entry === 'object' &&
        Object.hasOwn(entry, 'id') &&
        typeof (entry as { id?: unknown }).id === 'string'
      ) {
        identity.push(`id:${(entry as { id: string }).id}`);
      } else {
        identity.push(part);
      }
      current = entry;
      continue;
    }
    if (current === null || typeof current !== 'object' || typeof part !== 'string') {
      throw new AgentFailure('MODEL_OUTPUT_INVALID', 'Model returned an invalid canonical path');
    }
    const descriptor = Reflect.getOwnPropertyDescriptor(current, part);
    if (!descriptor) {
      if (position === path.length - 1 && isAllowedOptionalPath(path)) {
        identity.push(part);
        current = undefined;
        continue;
      }
      throw new AgentFailure('MODEL_OUTPUT_INVALID', 'Model path references a missing field');
    }
    if (!('value' in descriptor)) {
      throw new AgentFailure('MODEL_OUTPUT_INVALID', 'Canonical path contains an accessor');
    }
    identity.push(part);
    current = descriptor.value;
  }
  return identity;
}
