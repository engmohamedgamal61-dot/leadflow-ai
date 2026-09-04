/**
 * Pure mapping of onboarding RPC errors → user-facing text. Kept import-free
 * so it can be unit-tested directly.
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

export function mapOnboardingError(error: RpcError): string {
  switch (error.code) {
    case "23505":
      if (isAlreadyMemberError(error)) return "You already have an organization.";
      return "That organization could not be created. Please try again.";
    case "28000":
      return "Your session has expired. Please sign in again.";
    case "22023":
      return "Please check the organization details and try again.";
    default:
      return "Something went wrong creating your organization. Please try again.";
  }
}
