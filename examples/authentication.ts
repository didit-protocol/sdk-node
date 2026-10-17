// Verify a Didit Authentication access token in your backend.
//
//   export DIDIT_PUBLISHABLE_KEY=pk_live_...   # or DIDIT_AUTH_ISSUER=https://<slug>.auth.didit.me
//   export DIDIT_APPLICATION_ID=...
//   node examples/authentication.ts <access token>

import { Authentication, TokenVerificationError } from "@didit-protocol/sdk-node";

const token = process.argv[2];
if (!token) throw new Error("Usage: node examples/authentication.ts <access token>");

const clientId = process.env.DIDIT_APPLICATION_ID;
const auth = process.env.DIDIT_PUBLISHABLE_KEY
  ? Authentication.fromPublishableKey(process.env.DIDIT_PUBLISHABLE_KEY, { clientId })
  : new Authentication({ issuer: process.env.DIDIT_AUTH_ISSUER ?? "", clientId });

try {
  const claims = await auth.verifyAccessToken(token);
  console.log("Signed in:", claims.sub, "organization role:", claims.org?.role ?? "none");
  // For instant revocation checks, ask the issuer as well:
  const session = await auth.getSession(token);
  console.log("Session is active:", session);
} catch (error) {
  if (error instanceof TokenVerificationError) console.error("Rejected:", error.reason);
  else throw error;
}
