// Travel Rule settings, the VASP directory, wallet addresses and wallet screening.
//
//   export DIDIT_API_KEY=...
//   node examples/travel-rule.ts 0xWalletAddress

import Didit from "@didit-protocol/sdk-node";

const didit = new Didit();

const settings = await didit.travelRule.retrieveSettings();
console.log("Travel Rule settings:", settings);

const vasps = await didit.travelRule.listVasps({ limit: 10 });
console.log("VASPs in the directory:", vasps.count);

for await (const address of didit.travelRule.walletAddresses.list()) console.log(address);

const wallet = process.argv[2];
if (wallet) {
  const screening = await didit.walletScreening.screen({ wallet_address: wallet, direction: "inbound" });
  console.log("Wallet screening:", JSON.stringify(screening, null, 2));
}
