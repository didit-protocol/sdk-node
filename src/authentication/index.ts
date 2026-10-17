// Didit Authentication for your backend (docs/DESIGN.md section 10).
//
//   const auth = Authentication.fromPublishableKey("pk_live_...", { clientId: APPLICATION_ID });
//   try {
//     const claims = await auth.verifyAccessToken(accessToken);
//   } catch (error) {
//     if (error instanceof TokenVerificationError) ... // error.reason, for example "expired"
//   }
//
// Each application has its own OpenID Connect issuer (https://<slug>.auth.didit.me
// or its custom domain). This module verifies the ES256 tokens it signs, exchanges
// and refreshes codes, checks and revokes sessions and runs step-ups. It never uses
// your Didit API key.

export {
  Authentication,
  type Amount,
  type Audience,
  type AuthenticationOptions,
  type CreateStepUpParams,
  type ExchangeCodeParams,
  type VerifyAccessTokenOptions,
  type VerifyIdTokenOptions,
} from "./client.js";
export {
  parsePublishableKey,
  type PublishableKey,
  type PublishableKeyEnvironment,
} from "./issuer.js";
export { createNonce, createPkce, createState, type PkcePair } from "./pkce.js";
export type {
  AccessTokenClaims,
  ActorClaim,
  AuthenticationSession,
  IdTokenClaims,
  OrganizationClaim,
  OrganizationRole,
  SessionCustomRole,
  SessionOrganization,
  StepUp,
  StepUpAction,
  StepUpMethod,
  StepUpNotRequired,
  StepUpRule,
  StepUpStatus,
  TokenClaims,
  TokenResponse,
  VerificationLevel,
  VerifiedClaims,
} from "./types.js";
export { TokenVerificationError, type TokenVerificationReason } from "../core/errors.js";
