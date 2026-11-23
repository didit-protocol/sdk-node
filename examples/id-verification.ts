// Standalone ID verification with file uploads.
//
//   export DIDIT_API_KEY=...
//   node examples/id-verification.ts front.jpg [back.jpg]

import Didit, { BadRequestError, fileFromPath } from "@didit-protocol/sdk-node";

const [front, back] = process.argv.slice(2);
if (!front) throw new Error("Usage: node examples/id-verification.ts front.jpg [back.jpg]");

const didit = new Didit();
try {
  const result = await didit.idVerification.verify({
    front_image: await fileFromPath(front),
    ...(back ? { back_image: await fileFromPath(back) } : {}),
    vendor_data: "user-123",
  });
  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  if (error instanceof BadRequestError) console.error("Rejected:", error.message, error.body);
  else throw error;
}
