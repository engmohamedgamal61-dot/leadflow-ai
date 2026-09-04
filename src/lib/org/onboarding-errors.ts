/**
 * Pure mapping of onboarding RPC errors → dictionary codes (never raw Postgres
 * text). Kept import-free so it can be unit-tested directly.
 */
export interface RpcError {
  code?: string;
  message?: string;
}

export function isAlreadyMemberError(error: RpcError): boolean {
  return (
    error.code === "23505" && (error.message ?? "").includes("already belongs")
  );
}

/** Dotted key under the `onboarding.errors.*` dictionary namespace. */
export function mapOnboardingErrorCode(error: RpcError): string {
  switch (error.code) {
    case "23505":
      return isAlreadyMemberError(error)
        ? "onboarding.errors.alreadyMember"
        : "onboarding.errors.createFailed";
    case "28000":
      return "onboarding.errors.sessionExpired";
    case "22023":
      return "onboarding.errors.invalidDetails";
    default:
      return "onboarding.errors.generic";
  }
}
