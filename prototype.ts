import { BigNumber } from 'bignumber.js';
import * as crypto from 'crypto';
import elliptic from 'elliptic';
import { ethers } from 'ethers';
import axios, { AxiosResponse, AxiosError } from 'axios';
import { Signature } from 'ethers';


const PRICE_MULTIPLIER = new BigNumber(2).pow(32);
export type OrderSide = 'BID' | 'ASK';
export type OrderType = 'LIMIT' | 'MARKET';

export type OrderPayload = {
    nonce: number;
    contractId: number;
    side: OrderSide;
    price?: string | undefined;
    totalQuantity: string;
    maxFees: number;
  };

export type WithdrawPayload = {
    assetId: number;
    quantity: string;
    maxFees: string;
    withdrawalAddress: string;
    decimal: number;
  };

export type OrderBody = {
    accountId: number,
    symbol: string,
    side: OrderSide,
    orderType: OrderType,
    quantity: string,
    maxFees: number,
    price: string,
    nonce: number,
    signature: string,
};

export class HibachiSDK {
    apiKey: string;
    hmacKey: Buffer;
    baseUrl: string;
    lastNonce: number|null;
    lastOrderBody: any;
    lastOrderBuffer: string|null;
    lastSignature: string|null;
    lastResponse: any;
    
    constructor(apiKey: string, hmacKey: Buffer) {
        this.apiKey = apiKey;
        this.hmacKey = hmacKey;
        this.baseUrl = 'https://api-staging.hibachi.xyz'; // Replace with actual base URL
        this.lastNonce = null;
        this.lastOrderBody = null;
        this.lastOrderBuffer = null;
        this.lastSignature = null;
        this.lastResponse = null;
    }
    
    quantityFromReal(quantity: number): BigNumber {
        const underlyingDecimals = 10;
        return new BigNumber(quantity)
          .shiftedBy(underlyingDecimals)
          .integerValue(BigNumber.ROUND_DOWN);
      }
    
    priceFromReal(price: number): BigNumber {
        const decimals = -4;      
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

    decompressPublicKey(publicKey: string): string {
        const ec = new elliptic.ec('secp256k1');
      
        const pkey = ec.keyFromPublic(publicKey, 'hex');
        return pkey.getPublic().encode('hex', false).slice(2);
    }

    static DigestSerializer = class {
        
        static serializeOrder(payload: OrderPayload, 
            sdk: HibachiSDK): Buffer {
            const totalQuantity = sdk.quantityFromReal(Number(payload.totalQuantity));
            const price = payload.price ? sdk.priceFromReal(Number(payload.price)) : null;
            const maxFees = sdk.quantityFromReal(payload.maxFees);
            return Buffer.concat([
                sdk.toBytes(new BigNumber(payload.nonce), 8),
                sdk.toBytes(new BigNumber(payload.contractId), 4),
                sdk.toBytes(totalQuantity, 8),
                sdk.toBytes(new BigNumber(payload.side === 'ASK' ? 0 : 1), 4),
                ...(price ? [sdk.toBytes(price, 8)] : []),
                sdk.toBytes(maxFees, 8),
              ]);
        };

        static serializeOrderId(orderId: string, sdk: HibachiSDK): Buffer {
            return Buffer.concat([sdk.toBytes(new BigNumber(orderId), 8)]);
        };    


        static serializeWithdrawPayload(payload: WithdrawPayload, sdk: HibachiSDK) {
            const realQuantity = sdk.quantityWithDecimal(payload.decimal, payload.quantity);
            return Buffer.concat([
              sdk.toBytes(new BigNumber(payload.assetId), 4),
              sdk.toBytes(realQuantity, 8),
              sdk.toBytes(new BigNumber(payload.maxFees), 8),
              Buffer.from(payload.withdrawalAddress, 'hex'),
            ]);
        };

        static serializeEditPayload(payload: any, sdk: HibachiSDK) {
            return Buffer.concat([
                sdk.toBytes(new BigNumber(payload.OrderId), 8),
                sdk.toBytes(new BigNumber(payload.nonce), 8),
                sdk.toBytes(sdk.quantityFromReal(payload.updatedQuantity), 8),
                sdk.toBytes(sdk.priceFromReal(payload.updatedPrice), 8)
              ]);
        };
    };

    createOrder(accountId: number|string, symbol: string, side: OrderSide, orderType: OrderType, quantity: number|string, price: number|string, maxFees = 0.0) {
        const nonce = Date.now();
        this.lastNonce = nonce;

        const orderBody = {
            accountId: Number(accountId),
            symbol: symbol,
            side: side,
            orderType: orderType,
            quantity: quantity.toString(),
            maxFees: maxFees,
            price: price.toString(),
            nonce: nonce,
            signature: "",
        };

        this.lastOrderBody = orderBody;
        const orderBuffer = HibachiSDK.DigestSerializer.serializeOrder({
            nonce: orderBody.nonce,
            contractId: 2, // Assuming contractId is fixed as 2, adjust if necessary
            totalQuantity: orderBody.quantity,
            side: orderBody.side,
            price: orderBody.price,
            maxFees: orderBody.maxFees
        }, this);
        this.lastOrderBuffer = orderBuffer.toString('hex');

        // HMAC signature
        const hmacSignature = crypto.createHmac('sha256', this.hmacKey)
            .update(orderBuffer)
            .digest('hex');
        this.lastSignature = hmacSignature;

        // Adding signature to the payload
        orderBody.signature = hmacSignature;

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

    async getOpenOrders(accountId: number|string) {
        const url = `${this.baseUrl}/trade/orders?accountId=${Number(accountId)}`;
        const headers = {
            'Content-Type': 'application/json',
            'Authorization': this.apiKey,
        };

        const response: AxiosResponse<any> = await axios.get(url, { headers });
        this.lastResponse = response;

        return response.data;
    }

    async getAccountBalance(accountId: number|string) {
        const url = `${this.baseUrl}/trade/account/info?accountId=${Number(accountId)}`;
        const headers = {
            'Content-Type': 'application/json',
            'Authorization': this.apiKey,
        };
        const response: AxiosResponse<any> = await axios.get(url, { headers });
        this.lastResponse = response;

        return response.data;
    }

    async getSettlementHistory(accountId: number|string) {
        const url = `${this.baseUrl}/trade/account/settlements_history?accountId=${Number(accountId)}`;
        const headers = {
            'Content-Type': 'application/json',
            'Authorization': this.apiKey,
        };
        const response: AxiosResponse<any> = await axios.get(url, { headers });
        this.lastResponse = response;

        return response.data;        
    }

    async getOrderHistory(accountId: number|string) {
        /*
        only returns last 100 trades
        */
        const url = `${this.baseUrl}/trade/account/trades?accountId=${Number(accountId)}`;
        const headers = {
            'Content-Type': 'application/json',
            'Authorization': this.apiKey,
        };

        const response = await axios.get(url, { headers: headers } );
        this.lastResponse = response;

        return response.data;
    }

    async cxlOrder(accountId: number|string, orderId: number|string): Promise<any> {
        const nonce = Date.now(); // Use current time in milliseconds as nonce
        this.lastNonce = nonce;

        // Serialize the order ID for signature
        const orderBuffer = HibachiSDK.DigestSerializer.serializeOrderId(orderId.toString(), this);

        // Generate HMAC signature
        const hmacSignature = crypto.createHmac('sha256', this.hmacKey)
            .update(orderBuffer)
            .digest('hex');
        this.lastSignature = hmacSignature;

        // Prepare the API request payload
        const apiRequest = {
            orderId: orderId.toString(),
            accountId: Number(accountId),
            nonce: nonce,
            signature: hmacSignature
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

    async cxlAllOrders(accountId: number|string): Promise<any> {
        const nonce = Date.now();
        this.lastNonce = nonce;

        // Prepare the API request payload for canceling all orders
        const apiRequest: any = {
            accountId: Number(accountId),
            nonce: nonce
        };
        this.lastOrderBody = apiRequest;

        // Serialize the nonce (since that's the only part of the payload that needs to be signed)
        const orderBuffer = this.toBytes(BigNumber(nonce), 8);
        this.lastOrderBuffer = orderBuffer.toString('hex');

        // Generate HMAC signature
        const hmacSignature = crypto.createHmac('sha256', this.hmacKey)
            .update(orderBuffer)
            .digest('hex');
        this.lastSignature = hmacSignature;

        // Add the signature to the payload
        apiRequest.signature = hmacSignature;

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

    async editOrder(accountId: number|string, orderId: number|string, orderPayload: OrderPayload, updatedQuantity: number|string, updatedPrice: number|string): Promise<any> {
        const nonce = Date.now();
        this.lastNonce = nonce;

        // Prepare the order body with the updated fields
        const orderBodyPre = {
            orderId: orderId.toString(),
            accountId: Number(accountId),
            updatedQuantity: updatedQuantity.toString(),
            updatedPrice: updatedPrice.toString(),
            nonce: nonce,
            signature: ""
        };

        // Serialize the order for the signature
        const orderBuffer = HibachiSDK.DigestSerializer.serializeOrder({
            nonce: nonce,
            contractId: 2,  // Assuming contractId is fixed as 2, adjust if necessary
            totalQuantity: updatedQuantity.toString(),
            side: orderPayload.side,
            price: updatedPrice.toString(),
            maxFees: 0.0
        }, this);

        this.lastOrderBuffer = orderBuffer.toString('hex');
        console.log(orderBuffer);

        // HMAC signature
        const hmacSignature = crypto.createHmac('sha256', this.hmacKey)
            .update(orderBuffer)
            .digest('hex');
        this.lastSignature = hmacSignature;

        // Add the signature to the order body
        orderBodyPre.signature = hmacSignature;

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

    async sendBatchOrder(accountId: number, orders: any[]): Promise<any> {
        // Prepare the list to hold serialized orders
        let serializedOrders: any[] = [];

        for (const order of orders) {
            // Generate a unique nonce for each order if not provided
            if (!order.nonce) {
                order.nonce = Date.now();
            }

            let orderBuffer: Buffer;

            // Depending on the action, serialize the order accordingly
            if (order.action === 'place') {
                orderBuffer = HibachiSDK.DigestSerializer.serializeOrder({
                    nonce: order.nonce,
                    contractId: 2, // Assuming contractId is fixed as 2, adjust if necessary
                    totalQuantity: order.quantity,
                    side: order.side,
                    price: order.price,
                    maxFees: 0.0
                }, this);
            } else if (order.action === 'modify') {
                orderBuffer = HibachiSDK.DigestSerializer.serializeEditPayload(order, this);
            } else if (order.action === 'cancel') {
                orderBuffer = HibachiSDK.DigestSerializer.serializeOrderId(order.orderId, this);
            } else {
                throw new Error(`Unknown action type: ${order.action}`);
            }

            // Generate the HMAC signature for the order
            const hmacSignature = crypto.createHmac('sha256', this.hmacKey)
                .update(orderBuffer)
                .digest('hex');
            order.signature = hmacSignature;

            // Add the order to the list
            serializedOrders.push(order);
        }

        // Prepare the batch order request
        const batchOrderRequest = {
            accountId: accountId,
            orders: serializedOrders
        };
        this.lastOrderBody = batchOrderRequest;

        // Send the batch order request
        const url = `${this.baseUrl}/trade/orders`;
        const headers = {
            'Content-Type': 'application/json',
            'Authorization': this.apiKey,
        };

        
        const response = await axios.post(url, batchOrderRequest, { headers: headers });
        this.lastResponse = response;
        return response.data;        
    }
}