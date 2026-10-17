// Token claims and issuer responses of Didit Authentication (docs/DESIGN.md
// section 10). Shapes follow service-didit-auth (authentication/services/issuer.py,
// services/tokens.py, services/step_ups.py and views/runtime.py). They are the JSON
// the issuer sends, so fields keep the wire's snake_case, and every type keeps the
// fields and claims this version does not know (the index signatures).

/** A built-in organization role. Open: other values may arrive. */
export type OrganizationRole = "admin" | "member" | "billing" | (string & {});

/** A verification level, lowest to highest. Open: other values may arrive. */
export type VerificationLevel = "liveness" | "liveness_face_match" | "full_id" | (string & {});

/** The sensitive action a step-up protects. Open: other values are sent as given. */
export type StepUpAction = "payout" | "bank" | "contact" | (string & {});

/** The step-up rule that applied. Open: other values may arrive. */
export type StepUpRule = "payout" | "device" | "bank" | "contact" | (string & {});

/** How the person verifies for a step-up. Open: other values may arrive. */
export type StepUpMethod = "liveness" | "selfie" | "full_id" | (string & {});

/**
 * The status of a step-up. Act on the protected action only for `approved`;
 * every other value, including ones this version does not know, means no.
 */
export type StepUpStatus =
  | "pending"
  | "review"
  | "approved"
  | "declined"
  | "expired"
  | "superseded"
  | (string & {});

/** `org`: the person's earliest organization membership, when customer organizations are on. */
export interface OrganizationClaim {
  /** The organization id. */
  id: string;
  /** The person's built-in role in the organization. */
  role?: OrganizationRole | null;
  [field: string]: unknown;
}

/** `act`: the agent acting for the person. Only agent access tokens carry it. */
export interface ActorClaim {
  /** The agent id. */
  sub: string;
  /** The agent's name. */
  agent?: string | null;
  /** What the person allowed the agent to do; never act beyond these. */
  scopes?: string[] | null;
  [field: string]: unknown;
}

/**
 * `verified`: the highest approved verification level and the claims the
 * application selected. Empty when the person has not been verified.
 */
export interface VerifiedClaims {
  level?: VerificationLevel | null;
  over_18?: boolean | null;
  over_21?: boolean | null;
  given_name?: string | null;
  family_name?: string | null;
  /** `YYYY-MM-DD`. */
  birthdate?: string | null;
  /** ISO 3166-1 alpha-2. */
  nationality?: string | null;
  /** ISO 3166-1 alpha-2. */
  country?: string | null;
  document_verified?: boolean | null;
  liveness?: boolean | null;
  [field: string]: unknown;
}

/** The claims access tokens and ID tokens share. */
export interface TokenClaims {
  /** The issuer: always equal to `Authentication.issuer` once verified. */
  iss: string;
  /** The identity id of the person. */
  sub: string;
  /** The application id (a string, or a list that contains it). */
  aud?: string | string[] | null;
  /** The session id (the grant id on an agent token). */
  sid?: string | null;
  /** The token id. */
  jti?: string | null;
  /** Issued at, in seconds since the epoch. */
  iat: number;
  /** Expires at, in seconds since the epoch. Access tokens live at most five minutes. */
  exp: number;
  /** Not before, in seconds since the epoch. Didit does not send it today. */
  nbf?: number | null;
  /** The person's reference across Didit products (verification sessions, monitoring). */
  vendor_data?: string | null;
  /** How the person signed in, for example `["passkey"]`; empty on an agent token. */
  amr?: string[] | null;
  /** The person's earliest organization membership, or `null`. */
  org?: OrganizationClaim | null;
  /** The verified identity level and selected claims; `{}` when not verified. */
  verified?: VerifiedClaims | null;
  /** `null` for a person; the agent on an agent access token. */
  act?: ActorClaim | null;
  [claim: string]: unknown;
}

/** The verified claims of an access token (header `typ: at+jwt`): its JWT payload. */
export interface AccessTokenClaims extends TokenClaims {
  /** The application id. */
  client_id?: string | null;
}

/** The verified claims of an ID token (header `typ: JWT`): its JWT payload. */
export interface IdTokenClaims extends TokenClaims {
  /** When the person signed in, in seconds since the epoch. */
  auth_time?: number | null;
  /** The nonce of the sign-in; absent on an ID token returned by a refresh. */
  nonce?: string | null;
  email?: string | null;
  email_verified?: boolean | null;
  name?: string | null;
  phone_number?: string | null;
}

/** `POST token/`: new tokens. Keep them on your server and never log them. */
export interface TokenResponse {
  /** An ES256 JWT access token (`typ: at+jwt`) that expires within five minutes. */
  access_token: string;
  /** `Bearer`. */
  token_type: string;
  /** Seconds until `access_token` expires. */
  expires_in: number;
  /** Opaque and single use: every refresh returns a new one. */
  refresh_token?: string | null;
  /** An ES256 JWT ID token (`typ: JWT`); verify it with `verifyIdToken`. */
  id_token?: string | null;
  /** The session id: the `sid` claim of the tokens. */
  session_id?: string | null;
  [field: string]: unknown;
}

/** An organization custom role in `AuthenticationSession.organizations`. */
export interface SessionCustomRole {
  key?: string | null;
  permissions?: string[] | null;
  [field: string]: unknown;
}

/** One organization membership in `AuthenticationSession.organizations`. */
export interface SessionOrganization {
  organization_id?: string | null;
  /** The organization name. The issuer sends it with a double underscore. */
  organization__name?: string | null;
  role?: OrganizationRole | null;
  custom_role?: SessionCustomRole | null;
  [field: string]: unknown;
}

/** `GET session/`: the live session behind an access token. */
export interface AuthenticationSession {
  /** The identity id. */
  sub: string;
  /** The session id. */
  sid: string;
  application_id?: string | null;
  vendor_data?: string | null;
  amr?: string[] | null;
  /** Whether the session passed a second factor (always true for a passkey sign-in). */
  mfa_verified?: boolean | null;
  email?: string | null;
  email_verified?: boolean | null;
  phone?: string | null;
  /** The verified claims the person shared at sign-in, or `null`. */
  verified_identity?: Record<string, unknown> | null;
  verified?: VerifiedClaims | null;
  /** ISO 8601 date-time: when the session expires, regardless of activity. */
  expires_at?: string | null;
  post_logout_redirect_uri?: string | null;
  /** The person's organizations when customer organizations are on. */
  organizations?: SessionOrganization[] | null;
  [field: string]: unknown;
}

/**
 * A step-up: the answer of `POST step-up/` when a rule applies (HTTP 201), and of
 * `GET step-up/{id}/`. Send the person to `verification_url`, then read the
 * step-up again with `retrieveStepUp` and act only when `status` is `approved`.
 */
export interface StepUp {
  /** `true` on `POST step-up/`; absent on `GET step-up/{id}/`. */
  required?: true;
  /** The step-up id; keep it to call `retrieveStepUp`. */
  id: string;
  rule?: StepUpRule | null;
  method?: StepUpMethod | null;
  /** Act only on `approved`. */
  status: StepUpStatus;
  /** The verification level reached; `null` until verified. */
  level?: VerificationLevel | null;
  /** The payout amount as a decimal string; `null` for other actions. */
  amount?: string | null;
  currency?: string | null;
  /** ISO 8601 date-time. */
  created_at?: string | null;
  /** ISO 8601 date-time; `null` until decided. */
  completed_at?: string | null;
  /** ISO 8601 date-time: when the step-up expires if the person does not verify. */
  expires_at?: string | null;
  /** `POST step-up/` only: where to send the person to verify. */
  verification_url?: string | null;
  /** `POST step-up/` only: seconds the person has to verify. */
  expires_in?: number | null;
  [field: string]: unknown;
}

/**
 * The answer of `POST step-up/` when no rule applies (HTTP 200): the action may
 * go ahead without a verification.
 */
export interface StepUpNotRequired {
  required: false;
  [field: string]: unknown;
}
