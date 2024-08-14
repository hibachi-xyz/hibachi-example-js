import { BigNumber } from 'bignumber.js';
import * as crypto from 'crypto';
import elliptic from 'elliptic';
import { ethers } from 'ethers';

export type MarketType = {
  contract: {
    displayName: string;
    id: number;
    orderbookGranularities: string[];
    riskFactorForOrders: string;
    riskFactorForPositions: string;
    maintenanceFactorForPositions: string;
    settlementDecimals: number;
    settlementSymbol: string;
    symbol: string;
    underlyingDecimals: number;
    underlyingSymbol: string;
  };
  info: {
    price24hAgo?: string;
    priceLatest?: string;
    markPrice?: string;
    tags: string[];
    spotPrice?: string;
  };
};
export type OrderSide = 'BID' | 'ASK';
export type OrderType = 'LIMIT' | 'MARKET';
const PRICE_MULTIPLIER = new BigNumber(2).pow(32);
export type WithdrawPayload = {
  assetId: number;
  quantity: string;
  maxFees: string;
  withdrawalAddress: string;
  decimal: number;
};
export type OrderPayload = {
  nonce: number;
  contractId: number;
  side: OrderSide;
  price?: number | undefined;
  totalQuantity: number;
  maxFees: number;
};
type TransferPayload = {
  assetId: BigNumber;
  quantity: string;
  maxFees: BigNumber;
  nonce: number;
  dstPubKey: string;
};
function quantityFromReal(quantity: number): BigNumber {
  const underlyingDecimals = 10;
  return new BigNumber(quantity)
    .shiftedBy(underlyingDecimals)
    .integerValue(BigNumber.ROUND_DOWN);
}
function priceFromReal(price: number): BigNumber {
  const decimals = -4;

  return new BigNumber(price)
    .shiftedBy(decimals)
    .multipliedBy(PRICE_MULTIPLIER)
    .integerValue(BigNumber.ROUND_DOWN);
}
function toBytes(value: BigNumber, numBytes: number): Buffer {
  return Buffer.from(
    // 2 hex characters per byte
    value.toString(16).padStart(2 * numBytes, '0'),
    'hex'
  );
}
function quantityWithDecimal(
  decimal: number,
  quantity: number | string
): BigNumber {
  return new BigNumber(quantity)
    .shiftedBy(decimal)
    .integerValue(BigNumber.ROUND_DOWN);
}
function decompressPublicKey(publicKey: string): string {
  const ec = new elliptic.ec('secp256k1');

  const pkey = ec.keyFromPublic(publicKey, 'hex');
  return pkey.getPublic().encode('hex', false).slice(2);
}

function compressPublicKey(publicKey: string): string {
  const ec = new elliptic.ec('secp256k1');

  const pkey = ec.keyFromPublic('04' + publicKey, 'hex');
  return pkey.getPublic().encodeCompressed('hex');
}

function signMessageSha256(
  msgParams: {
    from: string;
    data: Buffer;
  },
  privateKey: string
): elliptic.ec.Signature {
  const ec = new elliptic.ec('secp256k1');
  const accountKeyPair = ec.keyFromPrivate(privateKey);
  if (accountKeyPair.getPublic().encodeCompressed('hex') !== msgParams.from) {
    throw new Error('Public key mismatches.');
  }

  const msgHash = ethers.sha256(msgParams.data).slice(2);
  const signature = accountKeyPair.sign(msgHash, 'hex', {
    canonical: true,
  });

  return signature;
}
function signatureToBytes(signature: elliptic.ec.Signature): Buffer {
  return Buffer.concat([
    signature.r.toArrayLike(Buffer, 'be', 32),
    signature.s.toArrayLike(Buffer, 'be', 32),
  ]);
}
export class DigestSerializer {
  public static serializeOrder(payload: OrderPayload): Buffer {
    const totalQuantity = quantityFromReal(payload.totalQuantity);

    const price = payload.price ? priceFromReal(payload.price) : undefined;
    const maxFees = new BigNumber(0);

    return Buffer.concat([
      toBytes(new BigNumber(payload.nonce), 8),
      toBytes(new BigNumber(payload.contractId), 4),
      toBytes(totalQuantity, 8),
      toBytes(new BigNumber(payload.side === 'ASK' ? 0 : 1), 4),
      ...(price ? [toBytes(price, 8)] : []),
      toBytes(maxFees, 8),
    ]);
  }
  public static serializeOrderId(orderId: string): Buffer {
    return Buffer.concat([toBytes(new BigNumber(orderId), 8)]);
  }

  public static serializeWithdrawPayload(payload: WithdrawPayload): Buffer {
    const realQuantity = quantityWithDecimal(payload.decimal, payload.quantity);
    return Buffer.concat([
      toBytes(new BigNumber(payload.assetId), 4),
      toBytes(realQuantity, 8),
      toBytes(new BigNumber(payload.maxFees), 8),
      Buffer.from(payload.withdrawalAddress, 'hex'),
    ]);
  }

  public static serializeTransferPayload(payload: TransferPayload): Buffer {
    const decompressedPubKey = decompressPublicKey(payload.dstPubKey);
    return Buffer.concat([
      toBytes(new BigNumber(payload.nonce), 8),
      toBytes(payload.assetId, 4),
      toBytes(quantityWithDecimal(6, payload.quantity), 8),
      Buffer.from(decompressedPubKey, 'hex'),
      toBytes(payload.maxFees, 8),
    ]);
  }
}
const nonce = Date.now();
console.log('nonce', nonce);
const orderBuffer = DigestSerializer.serializeOrder({
  nonce,
  contractId: 2,
  side: 'ASK',
  totalQuantity: Number(0.0001),
  maxFees: 0,
  price: Number(100000),
});
console.log('orderBuffer', orderBuffer);
// Generate HMAC signature for exchange managed account
const hmacSignature = crypto
  .createHmac('sha256', '<Private Key>')
  .update(orderBuffer)
  .digest('hex');
console.log('order hmac Signature', hmacSignature);
// Generate ECDSA signature for self-managed account
const accountPubKey = '<public key>';
const privateKey = '<private key>';
let signaturePayload = null;
const ecdsaSignature = signMessageSha256(
  {
    from: compressPublicKey(accountPubKey.substring(2)),
    data: orderBuffer,
  },
  privateKey.substring(2)
);
const signatureBuffer = signatureToBytes(ecdsaSignature);
console.log('ECDSA signatureBuffer', signatureBuffer);
if (ecdsaSignature.recoveryParam || ecdsaSignature.recoveryParam === 0) {
  signaturePayload = signatureBuffer
    .toString('hex')
    .concat(ecdsaSignature.recoveryParam.toString(16).padStart(2, '0'));
}

type ApiOrderRequest = {
  signature?: string;
};

const apiRequest: ApiOrderRequest = {
  ...(signaturePayload && { signature: signaturePayload }),
};

console.log('ECDSA Signature', apiRequest);

// const walletToUse = '';
// const withdrawBuffer = DigestSerializer.serializeWithdrawPayload({
//   assetId: 1,
//   quantity: BigNumber(1).toString(),
//   maxFees: '0',
//   withdrawalAddress: walletToUse.slice(2).toLowerCase(),
//   decimal: 6, // USDT decimal
// });
// console.log(withdrawBuffer);
// const hmacSignature_withdraw = crypto
//   .createHmac('sha256', '<Private Key>')
//   .update(withdrawBuffer)
//   .digest('hex');
// console.log('withdrawSignature', hmacSignature_withdraw);

// const dstPublicKey = 'key from api call /captial/transfer-info';
// const transferBuffer = DigestSerializer.serializeTransferPayload({
//   assetId: new BigNumber(1),
//   quantity: String(1),
//   maxFees: new BigNumber(0), // TODO: change to actual fee
//   nonce: nonce,
//   dstPubKey: dstPublicKey,
// });
// console.log(transferBuffer);
// const hmacSignature_transfer = crypto
//   .createHmac('sha256', '<Private Key>')
//   .update(withdrawBuffer)
//   .digest('hex');
// console.log('transferSignature', hmacSignature_transfer);
