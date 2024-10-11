import { HibachiEcdsaSDK } from './sdk_ecdsa.ts';


// Usage example:

const accountId = 123; //Replace with your own account ID, string or number
const apiKey = "apikey=";  // Replace with your actual API key
const publicKey = "public-key"; // Replace with your actual public key
const privateKey = "private-key";  // Replace with your actual private key
const baseUrl = 'https://api.hibachi.xyz' // Replace with actual base URL

const sdk = new HibachiEcdsaSDK(accountId, apiKey, publicKey, privateKey, baseUrl);

console.log('SDK initialized.');

(async () => {
    //get account balance
    const balance = await sdk.getAccountBalance(accountId);
    console.log('Account balance got. Response:', balance);

    //Create order
    const orderBody = sdk.createOrder('BTC/USDT-P', 'ASK', 'LIMIT', "0.00001", "100004.0", "0.045", 2, 10);
    //Fill acountId: number|string, symbol: string, side: 'ASK' or 'BID', orderType: 'Limit' or 'MARKET', quantity: number|string, 
    //price: number|string, maxFeesPercent: string, contractId: number, underlyingDecimals: number
    console.log('Order created:', orderBody);

    //send the order, you must send the order after you create it
    const response = await sdk.sendOrder(orderBody);
    console.log('Order response:', orderBody);    
    // /*
    // You SHOUDLD NOT create orderBody by yourself, use sdk.createOrder() method to create

    // type OrderBody = {
    // accountId: number,
    // symbol: string,
    // side: OrderSide,
    // orderType: OrderType,
    // quantity: string,
    // maxFees: number,
    // price: string,
    // nonce: number,
    // signature: string,
    // };
    // */
    console.log('Created OrderId', response.data);

    //second order
    const secondOrderbody = sdk.createOrder('BTC/USDT-P', 'ASK', 'LIMIT', "0.00001", "100002.0", "0.045", 2, 10);
    const response2 = await sdk.sendOrder(secondOrderbody);
    console.log("Created OrderId:", response2.data);

    //Get open orders
    const openOrders = await sdk.getOpenOrders();  //Fill acountId: number|string
    console.log('Open Orders:', openOrders);
    console.log('Number of open orders:', openOrders.length);

    //cancel the first order
    const tempOid = openOrders[0]["orderId"];
    const cancelOrders = await sdk.cxlOrder(tempOid);  //Fill acountId: number|string, orderId number|string, orderId can be obtained from sdk.getOpenOrders()
    console.log('Cancel Orders:', cancelOrders);

    // //verify if the order is canceled
    const openOrders2 = await sdk.getOpenOrders();  //Fill acountId: number|string
    console.log('Number of open orders:', openOrders2.length);
    console.log(openOrders2);
    //edit order
    const tempOid2 = openOrders2[0]["orderId"];
    const tempOrder = openOrders2[0];
    const editOrder = await sdk.editOrder(tempOid2, tempOrder, "0.0001", "100003","0.045", 2, 10);
    /* Fill acountId: number|string, orderId number|string, maxFeesPercent: string, contractId, underlyingDecimals:number
    orderPayload: orderPayload (Obtain this by running sdk.getOpenOrders()),
    quantity: number|string, price: number|string
    */
    console.log('Edit Order', editOrder);

    //get settlements
    const settle = await sdk.getSettlementHistory();
    console.log("Settlement history:", settle);

    //Batch cancel all the orders
    const cxlAllOrder = await sdk.cxlAllOrders();
    console.log('Cxl All Order', cxlAllOrder);

    const openOrders3 = await sdk.getOpenOrders();
    console.log('Number of open orders:', openOrders3.length);//should be 0 if all the orders are cancelled

    //withdrawal
    const balance2 = await sdk.getAccountBalance(accountId);  //Fill accountId: number|string
    console.log('Account balance before the withdrawal. Response:', balance2);
    console.log('begin to withdrawal');
    const withdrawResponse = sdk.withdraw('USDT', '1', '1', "withdraw-address", '6', '0.1');
    /* coin: string, e.g. ("USTD"), assetId: string|number, withdrawalAddress: string,
    decimal: number|string, network: string this is default to "arbitrum" you can replace it with your network, maxFees: string*/

    const balance3 = await sdk.getAccountBalance(accountId);  //Fill accountId: number|string
    console.log('Account balance after the withdrawal. Response:', balance3);

    //Transfer crypto to another account
    const transfer = sdk.transfer('1', "1", 'USDT', 'receiving-address', '1');
    /* assetId: string|number, quantity: number|string, coin: string,
    receivingAddress: string, begin with "0x", maxFees: string */
    const balance4 = await sdk.getAccountBalance(accountId);
    console.log('Account balance after the transfer. Response:', balance4);

    //Get order history
    const orderHistory = await sdk.getOrderHistory()
    console.log("Order history", orderHistory);

    //Batch orders
    const orders = [
        {
            action: "place",
            symbol: "ETH/USDT-P",
            orderType: "LIMIT",
            side: "BID",
            quantity: ".0001",
            price: "100010",
            maxFeesPercent: "0.045",
            contractId: 1,
            underlyingDecimals: 9        
        },
         {
             action: "modify",
             symbol: "BTC/USDT-P",
             orderId: "000000000000000000", //replace it with the orderId you want to modify
             orderType: "LIMIT",
             side: "ASK",
             updatedQuantity: "0.0001",
             updatedPrice: "100009.1",
             maxFeesPercent: "0.045",
             contractId: 2,
             underlyingDecimals: 10
         },

        {
            action: "cancel",
            orderId: "000000000000000000",  // replace it with the orderId you want to cancel
        }
    ];

    const batchResponse = await sdk.sendBatchOrder(orders);
    console.log('Batch Order Response:', batchResponse);
})();