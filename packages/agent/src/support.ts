import {
  AgentFailure,
  type AmbiguityFindingVerificationInput,
  type AmbiguityFindingVerifier,
  type ClaimSupportInput,
  type ClaimSupportResult,
  type ClaimSupportVerifier,
} from './types.js';

type VerificationResult = ClaimSupportResult;

async function runBoundedVerification<TInput extends { signal: AbortSignal; timeoutMs: number }>(
  verify: (input: TInput) => Promise<VerificationResult>,
  input: Omit<TInput, 'signal' | 'timeoutMs'>,
  timeoutMs: number,
  externalSignal?: AbortSignal,
): Promise<VerificationResult> {
  if (externalSignal?.aborted) {
    throw new AgentFailure('CANCELLED', 'Support verification was cancelled');
  }
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let onAbort: (() => void) | undefined;
  const verifierPromise = Promise.resolve().then(() =>
    verify({ ...input, signal: controller.signal, timeoutMs } as TInput),
  );
  void verifierPromise.catch(() => undefined);
  try {
    const timeoutPromise = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(
          new AgentFailure(
            'SUPPORT_VERIFIER_TIMEOUT',
            'Support verification exceeded its time limit',
          ),
        );
      }, timeoutMs);
    });
    const cancellationPromise = new Promise<never>((_resolve, reject) => {
      onAbort = () => {
        controller.abort();
        reject(new AgentFailure('CANCELLED', 'Support verification was cancelled'));
      };
      externalSignal?.addEventListener('abort', onAbort, { once: true });
    });
    let result: VerificationResult;
    try {
      result = await Promise.race([verifierPromise, timeoutPromise, cancellationPromise]);
    } catch (error) {
      if (
        error instanceof AgentFailure &&
        (error.code === 'SUPPORT_VERIFIER_TIMEOUT' || error.code === 'CANCELLED')
      ) {
        throw error;
      }
      throw new AgentFailure('SUPPORT_VERIFIER_FAILED', 'Support verification failed');
    }
    if (
      !result ||
      !Number.isFinite(result.confidence) ||
      result.confidence < 0 ||
      result.confidence > 1 ||
      !['supported', 'needs_review', 'unsupported'].includes(result.status) ||
      (result.reason !== undefined &&
        (typeof result.reason !== 'string' || result.reason.length > 2_000))
    ) {
      throw new AgentFailure(
        'SUPPORT_VERIFIER_FAILED',
        'Support verification returned invalid output',
      );
    }
    return result;
  } finally {
    if (timer) clearTimeout(timer);
    if (onAbort) externalSignal?.removeEventListener('abort', onAbort);
  }
}

export async function runSupportVerifier(
  verifier: ClaimSupportVerifier,
  input: Omit<ClaimSupportInput, 'signal' | 'timeoutMs'>,
  timeoutMs: number,
  externalSignal?: AbortSignal,
): Promise<ClaimSupportResult> {
  return runBoundedVerification(
    (verificationInput) => verifier.verify(verificationInput),
    input,
    timeoutMs,
    externalSignal,
  );
}

export function runAmbiguityVerifier(
  verifier: AmbiguityFindingVerifier,
  input: Omit<AmbiguityFindingVerificationInput, 'signal' | 'timeoutMs'>,
  timeoutMs: number,
  externalSignal?: AbortSignal,
): Promise<ClaimSupportResult> {
  return runBoundedVerification(
    (verificationInput) => verifier.verify(verificationInput),
    input,
    timeoutMs,
    externalSignal,
  );
}
