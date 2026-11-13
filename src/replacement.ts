export interface ReplacementOperations<TTemporary, TCommitted> {
  createTemporary(): Promise<TTemporary>;
  populate(temporary: TTemporary): Promise<void>;
  swap(temporary: TTemporary): Promise<TCommitted>;
  cleanup(temporary: TTemporary): Promise<void>;
  persist(committed: TCommitted): Promise<void>;
}

export interface ReplacementOutcome<TCommitted> {
  committed: TCommitted;
  cleanupError?: unknown;
}

/**
 * Build the replacement completely before swapping it into place. Failures before
 * the swap retain the old document and trigger best-effort cleanup of the staging
 * document. Persistence only happens after a successful swap.
 */
export async function performSafeReplacement<TTemporary, TCommitted>(
  operations: ReplacementOperations<TTemporary, TCommitted>,
): Promise<ReplacementOutcome<TCommitted>> {
  const temporary = await operations.createTemporary();
  let swapped = false;

  try {
    await operations.populate(temporary);
    const committed = await operations.swap(temporary);
    swapped = true;
    await operations.persist(committed);
    return { committed };
  } catch (error) {
    if (!swapped) {
      try {
        await operations.cleanup(temporary);
      } catch (cleanupError) {
        if (error instanceof Error) {
          (error as Error & { cleanupError?: unknown }).cleanupError = cleanupError;
        }
      }
    }
    throw error;
  }
}
