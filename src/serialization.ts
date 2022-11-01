import WizData, { hexLE } from "@script-wiz/wiz-data";
import { convert32, numToLE32, numToLE64 } from "./convertion";
import { hash256, sha256, SIGHASH_TYPE } from "./crypto";
import { TxData, TxInput, TxOutput } from "./model";
import { size } from "./splices";
import { tapLeaf } from "./taproot";
import { VM_NETWORK } from "./taproot/model";

// ref https://github.com/bitcoin/bips/blob/master/bip-0143.mediawiki

// Double SHA256 of the serialization of:
// 1. nVersion of the transaction (4-byte little endian)
// 2. hashPrevouts (32-byte hash)
// 3. hashSequence (32-byte hash)
// 4. outpoint (32-byte hash + 4-byte little endian)
// 5. scriptCode of the input (serialized as scripts inside CTxOuts)
// 6. value of the output spent by this input (8-byte little endian)
// 7. nSequence of the input (4-byte little endian)
// 8. hashOutputs (32-byte hash)
// 9. nLocktime of the transaction (4-byte little endian)
// 10. sighash type of the signature (4-byte little endian)
export const segwitSerialization = (data: TxData) => {
  const currentInput = data.inputs[data.currentInputIndex];

  if (currentInput.scriptPubKey === "") throw "scriptPubkey must not be empty in transaction template";

  const scriptCode = WizData.fromHex(currentInput.scriptPubKey);

  if (currentInput.vout === "") throw "Vout must not be empty in transaction template";
  const vout = numToLE32(WizData.fromNumber(Number(currentInput.vout))).hex;

  if (currentInput.amount === "") throw "Amount must not be empty in transaction template";
  const inputAmount = numToLE64(WizData.fromNumber(Number(currentInput.amount) * 100000000)).hex;

  if (data.timelock === "") throw "Timelock must not be empty in transaction template";
  const timelock = numToLE32(WizData.fromNumber(Number(data.timelock))).hex;

  if (data.version === "") throw "Version must not be empty in transaction template";
  const version = numToLE32(WizData.fromNumber(Number(data.version))).hex;

  // 2 (32-byte hash)

  if (currentInput.previousTxId === "") throw "Previous TX ID must not be empty in transaction template";
  const hashPrevouts = calculatePrevouts(data.inputs);

  if (currentInput.sequence === "") throw "Sequence must not be empty in transaction template";
  const nsequence = hexLE(currentInput.sequence);

  // 3 (32-byte hash)
  const hashSequence = hash256(WizData.fromHex(nsequence)).toString();
  if (hashSequence === "") throw "Sequence must not be empty in transaction template";

  // 4. outpoint (32-byte hash + 4-byte little endian)
  const outpoint = hexLE(currentInput.previousTxId) + vout;
  if (outpoint === "") throw "Previous TX ID and Vout must not be empty in transaction template";

  // 5. script code hash
  const scriptCodeSize = size(scriptCode).hex.substring(0, 2);
  if (scriptCodeSize === "") throw "scriptPubkey must not be empty in transaction template";

  // 8 hashOutputs
  const hashOutputs = calculateHashOutputs(data.outputs);

  return version + hashPrevouts + hashSequence + outpoint + scriptCodeSize + scriptCode.hex + inputAmount + nsequence + hashOutputs + timelock + "01000000";
};

const calculateHashOutputs = (outputs: TxOutput[], isSegwit = true) => {
  let hashOutputs = "";

  outputs.forEach((output: TxOutput) => {
    if (output.amount === "" || output.scriptPubKey === "") throw "Amount and scriptPubkey must not be empty in output transaction template";

    hashOutputs += numToLE64(WizData.fromNumber(Number(output.amount) * 100000000)).hex + size(WizData.fromHex(output.scriptPubKey)).hex + output.scriptPubKey;
  });

  return isSegwit ? hash256(WizData.fromHex(hashOutputs)).toString() : sha256(WizData.fromHex(hashOutputs)).toString();
};

const calculatePrevouts = (inputs: TxInput[], isSegwit = true) => {
  let hashInputs = "";

  inputs.forEach((input: TxInput) => {
    if (input.previousTxId === "" || input.vout === "") throw "Previous tx id and vout must not be empty";
    const vout = numToLE32(WizData.fromNumber(Number(input.vout))).hex;

    hashInputs += WizData.fromHex(hexLE(input.previousTxId) + vout).hex;
  });

  return isSegwit ? hash256(WizData.fromHex(hashInputs)).toString() : sha256(WizData.fromHex(hashInputs)).toString();
};

const calculateInputAmounts = (inputs: TxInput[]) => {
  let inputAmounts = "";

  inputs.forEach((input: TxInput) => {
    if (input.amount === "") throw "Input amounts must not be empty";
    inputAmounts += numToLE64(WizData.fromNumber(Number(input.amount) * 100000000)).hex;
  });

  return sha256(WizData.fromHex(inputAmounts)).toString();
};

const calculateInputScriptPubkeys = (inputs: TxInput[]) => {
  let inputScriptPubkeys = "";

  inputs.forEach((input: TxInput) => {
    if (input.scriptPubKey === "") throw "Input script pubkey must not be empty";

    inputScriptPubkeys += size(WizData.fromHex(input.scriptPubKey)).hex + input.scriptPubKey;
  });

  return sha256(WizData.fromHex(inputScriptPubkeys)).toString();
};

const calculateInputSequences = (inputs: TxInput[]) => {
  let inputSequences = "";

  inputs.forEach((input: TxInput) => {
    if (input.sequence === "") throw "Input script sequence must not be empty";

    inputSequences += hexLE(input.sequence);
  });

  return sha256(WizData.fromHex(inputSequences)).toString();
};

export const taprootSerialization = (data: TxData, script: string, network: VM_NETWORK, sighashType: SIGHASH_TYPE, codeSeperator: string) => {
  const concat = "00";

  if (data.version === "") throw "Version must not be empty in transaction template";
  const version = numToLE32(WizData.fromNumber(Number(data.version))).hex;

  if (data.timelock === "") throw "Timelock must not be empty in transaction template";
  const timelock = numToLE32(WizData.fromNumber(Number(data.timelock))).hex;

  const hashPrevouts = calculatePrevouts(data.inputs, false);

  const inputAmountsSha = calculateInputAmounts(data.inputs);

  const inputPubkeySha = calculateInputScriptPubkeys(data.inputs);

  const inputSequencesSha = calculateInputSequences(data.inputs);

  //sighash_single da bu yok
  let outputs;
  let sighashSingleOutput;

  if (sighashType !== SIGHASH_TYPE.SIGHASH_SINGLE) {
    outputs = calculateHashOutputs(data.outputs, false);
  } else {
    sighashSingleOutput = calculateHashOutputs([data.outputs[data.currentInputIndex]], false);
  }

  const spendType = "02";

  const currentIndex = numToLE32(WizData.fromNumber(data.currentInputIndex)).hex;

  const tapleaf = tapLeaf(WizData.fromHex(script), network === VM_NETWORK.BTC ? "c0" : "c4");

  return concat +
    sighashType +
    version +
    timelock +
    hashPrevouts +
    inputAmountsSha +
    inputPubkeySha +
    inputSequencesSha +
    outputs +
    spendType +
    currentIndex +
    sighashSingleOutput +
    tapleaf +
    "00" +
    codeSeperator !==
    ""
    ? convert32(WizData.fromHex(codeSeperator)).hex
    : "ffffffff";
};
