import algosdk from "algosdk";
import { sendError } from "./protocol.js";
import { encryptValue } from "./encrypt.js";
import { checkAlgod, getSuggestedParams, submitAndWait, ensureFunded } from "./algorand.js";
import type { Identity } from "./identity.js";

export async function permanentSave(key: string, value: string, identity: Identity): Promise<string | null> {
  if (!await checkAlgod()) {
    sendError("Cannot reach algod. Is localnet running? Set ALGOD_URL if using a remote node.");
    return null;
  }

  await ensureFunded(identity.address);
  const encrypted = encryptValue(value, identity);
  const noteData = JSON.stringify({
    key,
    value: encrypted,
    type: "permanent-memory",
    user: identity.address,
    created: new Date().toISOString(),
  });
  const note = new Uint8Array(Buffer.from(noteData));
  const params = await getSuggestedParams();
  const sender = algosdk.Address.fromString(identity.address);

  const txn = algosdk.makePaymentTxnWithSuggestedParamsFromObject({
    sender,
    receiver: sender,
    amount: BigInt(0),
    suggestedParams: params,
    note,
  });

  const signed = txn.signTxn(identity.signingKey);
  const txid = await submitAndWait(signed);
  return txid;
}
