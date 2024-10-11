import { BigNumber } from 'bignumber.js';
import * as crypto from 'crypto';
import * as elliptic from 'elliptic';
import { ethers } from 'ethers';
import axios, { AxiosResponse, AxiosError } from 'axios';
import { Signature } from 'ethers';

const FEE_MULTIPLIER = new BigNumber(10).pow(8);
const PRICE_MULTIPLIER = new BigNumber(2).pow(32);
export type OrderSide = 'BID' | 'ASK';
export type OrderType = 'LIMIT' | 'MARKET';

export type OrderPayload = {
    nonce: number;
    contractId: number;
    side: OrderSide;
    price?: string | undefined;
    totalQuantity: string;
    maxFees?: number;
};

export type TransferPayload = {
    assetId: BigNumber;
    quantity: string;
    maxFees: BigNumber;
    nonce: number;
    dstPubKey: string;
  };

export type WithdrawPayload = {
    assetId: number;
    quantity: string;
    maxFees: BigNumber;
    withdrawalAddress: string;
    decimal: number;
  };

export type OrderBody = {
    accountId: number,
    symbol: string,
    side: OrderSide,
    orderType: OrderType,
    quantity: string,
    maxFeesPercent: string,
    price: string,
    nonce: number,
    signature: string,
};

export class HibachiEcdsaSDK {
    accountId: number;
    apiKey: string;
    publicKey: string;
    privateKey: string;
    baseUrl: string;
    lastNonce: number|null;
    lastOrderBody: any;
    lastOrderBuffer: string|null;
    lastSignature: string|null;
    lastResponse: any;
    
    constructor(accountId: number, apiKey: string, publicKey: string, privateKey: string, baseUrl: string) {
        this.accountId = Number(accountId);
        this.apiKey = apiKey;
        this.publicKey = publicKey;
        this.privateKey = privateKey;
        this.baseUrl = baseUrl; 
        this.lastNonce = null;
        this.lastOrderBody = null;
        this.lastOrderBuffer = null;
        this.lastSignature = null;
        this.lastResponse = null;
    }
    
    signMessageSha256(
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

    signatureToBytes(signature: elliptic.ec.Signature): Buffer {
        return Buffer.concat([
          signature.r.toArrayLike(Buffer, 'be', 32),
          signature.s.toArrayLike(Buffer, 'be', 32),
        ]);
      }

    feesPercentWithDecimal(fees: number | string | BigNumber): BigNumber {
        return new BigNumber(fees).multipliedBy(FEE_MULTIPLIER);
    }

    quantityFromReal(quantity: number, underlyingDecimals: number): BigNumber {
        return new BigNumber(quantity)
          .shiftedBy(underlyingDecimals)
          .integerValue(BigNumber.ROUND_DOWN);
      }
    
    priceFromReal(price: number, underlyingDecimals:number): BigNumber {
        const decimals = 6-underlyingDecimals;       
        return new BigNumber(price)
          .shiftedBy(decimals)
          .multipliedBy(PRICE_MULTIPLIER)
          .integerValue(BigNumber.ROUND_DOWN);
      }
    
    toBytes(value: BigNumber, numBytes: number): Buffer {
        return Buffer.from(
          // 2 hex characters per byte
          value.toString(16).padStart(2 * numBytes, '0'),
          'hex'
        );
      }

    quantityWithDecimal(
        decimal: number,
        quantity: number | string
      ): BigNumber {
        return new BigNumber(quantity)
          .shiftedBy(decimal)
          .integerValue(BigNumber.ROUND_DOWN);
    }

    compressPublicKey(publicKey: string): string {
        const ec = new elliptic.ec('secp256k1');
      
        const pkey = ec.keyFromPublic('04' + publicKey, 'hex');
        return pkey.getPublic().encodeCompressed('hex');
      }

    decompressPublicKey(publicKey: string): string {
        const ec = new elliptic.ec('secp256k1');
      
        const pkey = ec.keyFromPublic(publicKey, 'hex');
        return pkey.getPublic().encode('hex', false).slice(2);
      }

    static DigestSerializer = class {

        static serializeOrder(payload: OrderPayload, 
          sdk: HibachiEcdsaSDK, underlyingDecimals: number): Buffer {
          const totalQuantity = sdk.quantityFromReal(Number(payload.totalQuantity), underlyingDecimals);
          const price = payload.price ? sdk.priceFromReal(Number(payload.price), underlyingDecimals) : null;
          const maxFees =
          payload.maxFees !== undefined
            ? new BigNumber(payload.maxFees)
            : new BigNumber(0);
          const realMaxFees = sdk.feesPercentWithDecimal(maxFees);
          return Buffer.concat([
              sdk.toBytes(new BigNumber(payload.nonce), 8),
              sdk.toBytes(new BigNumber(payload.contractId), 4),
              sdk.toBytes(totalQuantity, 8),
              sdk.toBytes(new BigNumber(payload.side === 'ASK' ? 0 : 1), 4),
              ...(price ? [sdk.toBytes(price, 8)] : []),
              sdk.toBytes(realMaxFees, 8),
            ]);
      };

        static serializeOrderId(orderId: string, sdk: HibachiEcdsaSDK): Buffer {
            return Buffer.concat([sdk.toBytes(new BigNumber(orderId), 8)]);
        };    


        static serializeWithdrawPayload(payload: WithdrawPayload, sdk: HibachiEcdsaSDK) {
          const realQuantity = sdk.quantityWithDecimal(payload.decimal, payload.quantity);
          const realMaxFees = sdk.quantityWithDecimal(
              payload.decimal,
              payload.maxFees.toString()
            );
          return Buffer.concat([
              sdk.toBytes(new BigNumber(payload.assetId), 4),
              sdk.toBytes(realQuantity, 8),
              sdk.toBytes(realMaxFees, 8),
              Buffer.from(payload.withdrawalAddress, 'hex'),
            ]);
      };

      static serializeEditPayload(payload: any, sdk: HibachiEcdsaSDK, underlyingDecimals: number) {
        return Buffer.concat([
            sdk.toBytes(new BigNumber(payload.OrderId), 8),
            sdk.toBytes(new BigNumber(payload.nonce), 8),
            sdk.toBytes(sdk.quantityFromReal(payload.updatedQuantity, underlyingDecimals), 8),
            sdk.toBytes(sdk.priceFromReal(payload.updatedPrice, underlyingDecimals), 8)
          ]);
    };

    static serializeTransferPayload(payload: TransferPayload, sdk: HibachiEcdsaSDK): Buffer {
      const decompressedPubKey = sdk.decompressPublicKey(payload.dstPubKey);
      const realMaxFees = sdk.feesPercentWithDecimal(payload.maxFees);
      return Buffer.concat([
        sdk.toBytes(new BigNumber(payload.nonce), 8),
        sdk.toBytes(payload.assetId, 4),
        sdk.toBytes(sdk.quantityWithDecimal(6, payload.quantity), 8),
        Buffer.from(decompressedPubKey, 'hex'),
        sdk.toBytes(realMaxFees, 8),
      ]);
    }
    };

    createOrder(symbol: string, side: OrderSide, orderType: OrderType, quantity: number|string, price: number|string, maxFeesPercent: string, contractId: number, underlyingDecimals: number) {
        const nonce = Date.now();
        this.lastNonce = nonce;

        const orderBody = {
            accountId: this.accountId,
            symbol: symbol,
            side: side,
            orderType: orderType,
            quantity: quantity.toString(),
            maxFeesPercent: maxFeesPercent,
            price: price.toString(),
            nonce: nonce,
            signature: "",
        };

        this.lastOrderBody = orderBody;
        const orderBuffer = HibachiEcdsaSDK.DigestSerializer.serializeOrder({
            nonce: orderBody.nonce,
            contractId: contractId,
            totalQuantity: orderBody.quantity,
            side: orderBody.side,
            price: orderBody.price,
            maxFees: Number(orderBody.maxFeesPercent)
        }, this, underlyingDecimals);

        this.lastOrderBuffer = orderBuffer.toString('hex');

        let signaturePayload = "";
        const ecdsaSignature = this.signMessageSha256(
          {
            from: this.compressPublicKey(this.publicKey.substring(2)),
            data: orderBuffer,
          },
          this.privateKey.substring(2)
        );
        const signatureBuffer = this.signatureToBytes(ecdsaSignature);
        if (ecdsaSignature.recoveryParam || ecdsaSignature.recoveryParam === 0) {
          signaturePayload = signatureBuffer
            .toString('hex')
            .concat(ecdsaSignature.recoveryParam.toString(16).padStart(2, '0'));
        }
        this.lastSignature = signaturePayload;

        // Adding signature to the payload
        orderBody.signature = signaturePayload;

        return orderBody;
    };

    async sendOrder(orderBody: OrderBody) {
        const url = `${this.baseUrl}/trade/order`;
        const headers = {
            'Content-Type': 'application/json',
            'Authorization': this.apiKey,
        };
      
        const response: AxiosResponse<any> = await axios.post(url, orderBody, { headers });
        this.lastResponse = response;
        return response; 
    };

    async getOpenOrders() {
        const url = `${this.baseUrl}/trade/orders?accountId=${Number(this.accountId)}`;
        const headers = {
            'Content-Type': 'application/json',
            'Authorization': this.apiKey,
        };

        const response: AxiosResponse<any> = await axios.get(url, { headers });
        this.lastResponse = response;

        return response.data;
    }


    async getAccountBalance(accountId: number|string) {
        const url = `${this.baseUrl}/trade/account/info?accountId=${this.accountId}`;
        const headers = {
            'Content-Type': 'application/json',
            'Authorization': this.apiKey,
        };
        const response: AxiosResponse<any> = await axios.get(url, { headers });
        this.lastResponse = response;

        return response.data;
    }

    async getSettlementHistory() {
        const url = `${this.baseUrl}/trade/account/settlements_history?accountId=${this.accountId}`;
        const headers = {
            'Content-Type': 'application/json',
            'Authorization': this.apiKey,
        };
        const response: AxiosResponse<any> = await axios.get(url, { headers });
        this.lastResponse = response;

        return response.data;        
    }

    async getOrderHistory() {
        /*
        only returns last 100 trades
        */
        const url = `${this.baseUrl}/trade/account/trades?accountId=${this.accountId}`;
        const headers = {
            'Content-Type': 'application/json',
            'Authorization': this.apiKey,
        };

        const response = await axios.get(url, { headers: headers } );
        this.lastResponse = response;

        return response.data;
    }

    async cxlOrder(orderId: number|string): Promise<any> {
        const nonce = Date.now(); // Use current time in milliseconds as nonce
        this.lastNonce = nonce;

        // Serialize the order ID for signature
        const orderBuffer = HibachiEcdsaSDK.DigestSerializer.serializeOrderId(orderId.toString(), this);

        let signaturePayload = "";
        const ecdsaSignature = this.signMessageSha256(
          {
            from: this.compressPublicKey(this.publicKey.substring(2)),
            data: orderBuffer,
          },
          this.privateKey.substring(2)
        );
        const signatureBuffer = this.signatureToBytes(ecdsaSignature);
        if (ecdsaSignature.recoveryParam || ecdsaSignature.recoveryParam === 0) {
          signaturePayload = signatureBuffer
            .toString('hex')
            .concat(ecdsaSignature.recoveryParam.toString(16).padStart(2, '0'));
        }
        this.lastSignature = signaturePayload;

        // Prepare the API request payload
        const apiRequest = {
            orderId: orderId.toString(),
            accountId: this.accountId,
            nonce: nonce,
            signature: signaturePayload
        };

        // Send the cancel order request
        const url = `${this.baseUrl}/trade/order`;
        const headers = {
            'Content-Type': 'application/json',
            'Authorization': this.apiKey,
        };

        try {
            const response = await axios.delete(url, {
                data: apiRequest,
                headers: headers
            });
            this.lastResponse = response;
            console.log(response.data);
            return response.data;
        } catch (error) {
            console.error('Failed to cancel the order:', error);
            throw error;
        }
    }

    async cxlAllOrders(): Promise<any> {
        const nonce = Date.now();
        this.lastNonce = nonce;

        // Prepare the API request payload for canceling all orders
        const apiRequest: any = {
            accountId: this.accountId,
            nonce: nonce
        };
        this.lastOrderBody = apiRequest;

        // Serialize the nonce (since that's the only part of the payload that needs to be signed)
        const orderBuffer = this.toBytes(BigNumber(nonce), 8);
        this.lastOrderBuffer = orderBuffer.toString('hex');

        let signaturePayload = "";
        const ecdsaSignature = this.signMessageSha256(
          {
            from: this.compressPublicKey(this.publicKey.substring(2)),
            data: orderBuffer,
          },
          this.privateKey.substring(2)
        );
        const signatureBuffer = this.signatureToBytes(ecdsaSignature);
        if (ecdsaSignature.recoveryParam || ecdsaSignature.recoveryParam === 0) {
          signaturePayload = signatureBuffer
            .toString('hex')
            .concat(ecdsaSignature.recoveryParam.toString(16).padStart(2, '0'));
        }
        this.lastSignature = signaturePayload;

        // Add the signature to the payload
        apiRequest.signature = signaturePayload;

        // Send the cancel all orders request
        const url = `${this.baseUrl}/trade/orders`;
        const headers = {
            'Content-Type': 'application/json',
            'Authorization': this.apiKey,
        };

        try {
            const response = await axios.delete(url, {
                data: apiRequest,
                headers: headers
            });
            this.lastResponse = response;
            return response.data;
        } catch (error) {
            console.error('Failed to cancel all orders:', error);
            throw error;
        }
    }

    async editOrder(orderId: number|string, orderPayload: OrderPayload, updatedQuantity: number|string, updatedPrice: number|string, maxFeesPercent: string, contractId:number, underlyingDecimals:number): Promise<any> {
        const nonce = Date.now();
        this.lastNonce = nonce;

        // Prepare the order body with the updated fields
        const orderBodyPre = {
            orderId: orderId.toString(),
            accountId: this.accountId,
            updatedQuantity: updatedQuantity.toString(),
            updatedPrice: updatedPrice.toString(),
            nonce: nonce,
            signature: "",
            maxFeesPercent: maxFeesPercent,
        };

        // Serialize the order for the signature
        const orderBuffer = HibachiEcdsaSDK.DigestSerializer.serializeOrder({
            nonce: nonce,
            contractId: contractId,  // Assuming contractId is fixed as 2, adjust if necessary
            totalQuantity: updatedQuantity.toString(),
            side: orderPayload.side,
            price: updatedPrice.toString(),
            maxFees: Number(maxFeesPercent),
        }, this, underlyingDecimals);

        this.lastOrderBuffer = orderBuffer.toString('hex');

        let signaturePayload = "";
        const ecdsaSignature = this.signMessageSha256(
          {
            from: this.compressPublicKey(this.publicKey.substring(2)),
            data: orderBuffer,
          },
          this.privateKey.substring(2)
        );
        const signatureBuffer = this.signatureToBytes(ecdsaSignature);
        if (ecdsaSignature.recoveryParam || ecdsaSignature.recoveryParam === 0) {
          signaturePayload = signatureBuffer
            .toString('hex')
            .concat(ecdsaSignature.recoveryParam.toString(16).padStart(2, '0'));
        }
        this.lastSignature = signaturePayload;

        // Add the signature to the order body
        orderBodyPre.signature = signaturePayload;

        // Send the edit order request
        const url = `${this.baseUrl}/trade/order`;
        const headers = {
            'Content-Type': 'application/json',
            'Authorization': this.apiKey,
        };

        try {
            const response = await axios.put(url, orderBodyPre, { headers: headers });
            this.lastResponse = response;
            return response.data;
        } catch (error) {
            console.error('Failed to edit the order:', error);
            throw error;
        }
    }

    async withdraw(coin: string, assetId: string|number, quantity: number|string, withdrawAddress: string, decimal: number|string, maxFees: string, network: string = "arbitrum"): Promise<any> {
        const nonce = Date.now();
        const withdrawAddressRemoveFirst = withdrawAddress.slice(2);
        this.lastNonce = nonce;

        const withdrawPayload: WithdrawPayload = {
            assetId: Number(assetId),
            quantity: quantity.toString(),
            maxFees: new BigNumber(maxFees),
            withdrawalAddress: withdrawAddressRemoveFirst,
            decimal: Number(decimal)
        };

        const orderBuffer = HibachiEcdsaSDK.DigestSerializer.serializeWithdrawPayload(withdrawPayload, this);
        this.lastOrderBuffer = orderBuffer.toString('hex');

        let signaturePayload = "";
        const ecdsaSignature = this.signMessageSha256(
          {
            from: this.compressPublicKey(this.publicKey.substring(2)),
            data: orderBuffer,
          },
          this.privateKey.substring(2)
        );
        const signatureBuffer = this.signatureToBytes(ecdsaSignature);
        if (ecdsaSignature.recoveryParam || ecdsaSignature.recoveryParam === 0) {
          signaturePayload = signatureBuffer
            .toString('hex')
            .concat(ecdsaSignature.recoveryParam.toString(16).padStart(2, '0'));
        }
        this.lastSignature = signaturePayload;

        const withdrawRequestBody = {
            accountId: this.accountId,
            coin: coin,
            network: network,
            maxFees: maxFees,
            withdrawAddress: withdrawAddressRemoveFirst,
            quantity: withdrawPayload.quantity,
            signature: signaturePayload
        };
        this.lastOrderBody = withdrawRequestBody;

        const url = `${this.baseUrl}/capital/withdraw`;
        const headers = {
            'Content-Type': 'application/json',
            'Authorization': this.apiKey,
        };
      
        const response: AxiosResponse<any> = await axios.post(url, withdrawRequestBody, { headers });
        this.lastResponse = response;
        return response; 

    }

    async transfer(assetId: number|string, quantity: number|string, coin: string, receivingAddress: string, maxFees: string): Promise<any> {
        const nonce = Date.now();
        this.lastNonce = nonce;

        const receivingAddressFirst = receivingAddress.slice(2);
        const receivingAddressLower = receivingAddress.toLowerCase();
        const urlGetPublicKey = `${this.baseUrl}/capital/transfer-info?receivingAddress=${receivingAddressLower}&accountId=${this.accountId}`;
        const headers = {
            'Content-Type': 'application/json',
            'Authorization': this.apiKey,
        };         
        const keyResponse = await axios.get(urlGetPublicKey, { headers: headers });
        const dstPublicKey = keyResponse.data.publicKey;
        const comPubKey = this.compressPublicKey(dstPublicKey.slice(2));
        const decompressedPubKey = this.decompressPublicKey(comPubKey);


        const transferPayload: TransferPayload = {
            assetId: new BigNumber(assetId),
            quantity: quantity.toString(),
            maxFees: new BigNumber(maxFees),
            nonce: nonce,
            dstPubKey: comPubKey
        };

        const orderBuffer = HibachiEcdsaSDK.DigestSerializer.serializeTransferPayload(transferPayload, this);
        let signaturePayload = "";
        const ecdsaSignature = this.signMessageSha256(
          {
            from: this.compressPublicKey(this.publicKey.substring(2)),
            data: orderBuffer,
          },
          this.privateKey.substring(2)
        );
        const signatureBuffer = this.signatureToBytes(ecdsaSignature);
        if (ecdsaSignature.recoveryParam || ecdsaSignature.recoveryParam === 0) {
          signaturePayload = signatureBuffer
            .toString('hex')
            .concat(ecdsaSignature.recoveryParam.toString(16).padStart(2, '0'));
        }
        this.lastSignature = signaturePayload;

        const transferBody = {
            accountId: this.accountId,
            coin: coin,
            fees: maxFees,
            nonce: transferPayload.nonce,
            quantity: quantity.toString(),
            dstPublicKey: decompressedPubKey,
            signature: signaturePayload
        };
        const url = `${this.baseUrl}/capital/transfer`;

      
        const response: AxiosResponse<any> = await axios.post(url, transferBody, { headers });
        this.lastResponse = response;
        return response; 

    };

   
    async sendBatchOrder(orders: any[]): Promise<any> {
        const serializedOrders: any[] = [];
        let count = 0;

        for (let order of orders) {
            order.nonce = Date.now()+count;
            count = count+1;

            let orderBuffer: Buffer;
            let ecdsaSignature: elliptic.ec.Signature| null = null;
            let signatureBuffer: Buffer;
            let signaturePayload: string = '';


            // Depending on the action, serialize the order accordingly
            switch (order.action) {
                case 'place':
                    orderBuffer = HibachiEcdsaSDK.DigestSerializer.serializeOrder({
                        nonce: order.nonce,
                        contractId: Number(order.contractId),
                        totalQuantity: order.quantity,
                        side: order.side,
                        price: order.price,
                        maxFees: Number(order.maxFeesPercent),
                    }, this, Number(order.underlyingDecimals));

                    ecdsaSignature = this.signMessageSha256(
                        {
                          from: this.compressPublicKey(this.publicKey.substring(2)),
                          data: orderBuffer,
                        },
                        this.privateKey.substring(2)
                      );
                    signatureBuffer = this.signatureToBytes(ecdsaSignature);
                      if (ecdsaSignature.recoveryParam || ecdsaSignature.recoveryParam === 0) {
                        signaturePayload = signatureBuffer
                          .toString('hex')
                          .concat(ecdsaSignature.recoveryParam.toString(16).padStart(2, '0'));
                      }
                    order.signature = signaturePayload;
                    break;
            
                case 'modify':
                    orderBuffer = HibachiEcdsaSDK.DigestSerializer.serializeOrder({
                    nonce: order.nonce,
                    contractId: 2,
                    totalQuantity: order.updatedQuantity,
                    side: order.side,
                    price: order.updatedPrice,
                    maxFees: Number(order.maxFeesPercent),
                    }, this, order.underlyingDecimals);

                    ecdsaSignature = this.signMessageSha256(
                        {
                          from: this.compressPublicKey(this.publicKey.substring(2)),
                          data: orderBuffer,
                        },
                        this.privateKey.substring(2)
                      );
                    signatureBuffer = this.signatureToBytes(ecdsaSignature);
                      if (ecdsaSignature.recoveryParam || ecdsaSignature.recoveryParam === 0) {
                        signaturePayload = signatureBuffer
                          .toString('hex')
                          .concat(ecdsaSignature.recoveryParam.toString(16).padStart(2, '0'));
                      }
                    order.signature = signaturePayload;
                    delete order.side;  // Remove 'side' as it's only needed for buffer
                    break;
            
                case 'cancel':
                    orderBuffer = HibachiEcdsaSDK.DigestSerializer.serializeOrderId(order.orderId, this);
                    ecdsaSignature = this.signMessageSha256(
                        {
                          from: this.compressPublicKey(this.publicKey.substring(2)),
                          data: orderBuffer,
                        },
                        this.privateKey.substring(2)
                      );
                    signatureBuffer = this.signatureToBytes(ecdsaSignature);
                    if (ecdsaSignature.recoveryParam || ecdsaSignature.recoveryParam === 0) {
                      signaturePayload = signatureBuffer
                        .toString('hex')
                        .concat(ecdsaSignature.recoveryParam.toString(16).padStart(2, '0'));
                    }
                  order.signature = signaturePayload;
                    break;
            
                default:
                    throw new Error(`Unknown action type: ${order.action}`);
            }
            
            // Add the order to the list
            serializedOrders.push(order);
        }
            
            // Prepare the batch order request
            const batchOrderRequest = {
                accountId: this.accountId,
                orders: serializedOrders
                };
            this.lastOrderBody = serializedOrders;
            console.log(batchOrderRequest);
            
            // Send the batch order request
            const url = `${this.baseUrl}/trade/orders`;
            const headers = {
                'Content-Type': 'application/json',
                'Authorization': this.apiKey,
            };
            const response = await axios.post(url, batchOrderRequest, { headers });
            this.lastResponse = response;
            return response.data;
    }
}

