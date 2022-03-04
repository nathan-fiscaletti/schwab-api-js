const SchwabSession = require(`./session`);
const urls = require(`./urls`);

const TradeType = {
    Buy: {
        id: 1,
        toString: () => 'Buy'
    },
    Sell: {
        id: 2,
        toString: () => 'Sell'
    }
};

const RequiredProperties = {
    trade: ['tradeType', 'ticker', 'quantity', 'accountId'],
    verify: ['tradeType', 'ticker', 'quantity', 'accountId'],
    confirm: ['tradeType', 'quantity', 'accountId'],
    verifyResult: ['Id', 'IssueId', 'NetAmount', 'QuoteAmount', 'IssueShortDescription', 'IssueSymbol']
};

function _validateProperties(props, requiredProperties) {
    return new Promise((resolve, reject) => {
        const providedProperties = Object.keys(props);
        try {
            for (const requiredProperty of requiredProperties) {
                if (! providedProperties.includes(requiredProperty)) {
                    new Error(`Required property '${requiredProperty} missing in object.`);
                }
            }
            resolve(props);
        } catch (err) { reject(err); }
    })
}

class Schwab extends SchwabSession {
    constructor(options) {
        super(options);
    }

    getAccountInfo(authOptions={}) {
        return new Promise(
            (resolve, reject) => {
                this.logger.info(`retrieving account information`)
                this.get(urls.PositionsData, authOptions)
                    .then((res, _) => {
                        this.logger.info(`account information retrieved successfully`)
                        resolve(res)
                    })
                    .catch(err => {
                        this.logger.info(`failed to retrieve account information: ${err}`);
                        reject(err);
                    });
            }
        );
    }

    verify(props, requestProperties={}, authOptions={}) {
        // Validate properties
        try { 
            _validateProperties(props, RequiredProperties.verify);
        } catch (err) {
            return Promise.reject(err);
        }

        // Extract properties
        const { tradeType, ticker, quantity, accountId } = props;
        
        // Validate trade type
        if (! Object.values(TradeType).includes(tradeType)) {
            return Promise.reject(
                new Error(`Invalid trade type '${tradeType}', please use either TradeType.Buy or TradeType.Sell`)
            );
        }

        const verification = {
            type: tradeType.toString(),
            ticker,
            quantity,
            accountId
        };

        // Create & return the order verification promise.
        return new Promise((resolve, reject) => {
            this.logger.info(`attempting trade verification: ${JSON.stringify(verification)}`)

            this.post(
                urls.OrderVerification,
                {
                    IsMinQty: false,
                    CustomerId: accountId,
                    BuySellCode: tradeType.id,
                    Quantity: quantity,
                    IsReinvestDividends: false,
                    SecurityId: ticker,
                    TimeInForce:'1',
                    OrderType: 1,
                    CblMethod: 'FIFO',
                    CblDefault: 'FIFO',
                    CostBasis: 'FIFO',
                    ...requestProperties
                },
                authOptions
            )
                .then((res, statusCode) => {
                    const verificationSuccess = statusCode === 200 && res.ReturnCode === 0;

                    if (verificationSuccess) {
                        this.logger.info(`trade verification successful: ${JSON.stringify(verification)}`);
                    } else {
                        this.logger.info(`trade verification failed: ${JSON.stringify(verification)}`);
                    }

                    resolve({
                        successful: () => verificationSuccess,
                        messages: () => res.Messages.map((messageData) => messageData.Message),
                        result: () => res,
                    });
                }).catch(err => reject(err));
        });
    }

    confirm(props, verifyResult, requestProperties={}, authOptions={}) {
         // Validate properties
         try { 
            _validateProperties(props, RequiredProperties.trade);
        } catch (err) {
            return Promise.reject(err);
        }

        // Extract properties
        const { tradeType, quantity, accountId } = props;
        
        // Validate trade type
        if (! Object.values(TradeType).includes(tradeType)) {
            return Promise.reject(
                new Error(`Invalid trade type '${tradeType}', please use either TradeType.Buy or TradeType.Sell`)
            );
        }

        // Validate verify result
        try {
            _validateProperties(verifyResult, RequiredProperties.verifyResult);
        } catch (err) {
            return Promise.reject(err);
        }

        const confirmation = {
            id: verifyResult.Id,
            type: tradeType.toString(),
            quantity,
            accountId
        };

        return new Promise((resolve, reject) => {
            this.logger.info(`attempting trade confirmation: ${JSON.stringify(confirmation)}`)

            this.post(
                urls.OrderConfirmation,
                {
                    AccountId: accountId,
                    ActionType: tradeType.toString(),
                    ActionTypeText: tradeType.toString(),
                    BuyAction: tradeType.id == TradeType.Buy.id,
                    CostBasis: 'FIFO',
                    CostBasisMethod: 'FIFO',
                    IsMarketHours: true,
                    ItemIssueId: verifyResult.IssueId,
                    NetAmount: verifyResult.NetAmount,
                    OrderId: verifyResult.Id,
                    OrderType: 'Market',
                    Principal: verifyResult.QuoteAmount,
                    Quantity: quantity,
                    ShortDescription: verifyResult.IssueShortDescription.replace(' ', '+'),
                    Symbol: verifyResult.IssueSymbol,
                    Timing: "Day Only",
                    ...requestProperties
                },
                authOptions
            )
                .then((res, statusCode) => {
                    const confirmationSuccess = statusCode === 200 && res.ReturnCode === 0;

                    if (confirmationSuccess) {
                        this.logger.info(`trade confirmation successful: ${JSON.stringify(confirmation)}`);
                    } else {
                        this.logger.info(`trade confirmation failed: ${JSON.stringify(confirmation)}`);
                    }

                    resolve({
                        successful: () => confirmationSuccess,
                        messages: () => res.Messages.map((messageData) => messageData.Message),
                        result: () => res,
                    });

                    resolve(result);
                }).catch(err => reject(err));
        });
    }

    trade(props, authOptions={}) {
        try {
            _validateProperties(props, RequiredProperties.trade);
        } catch (err) {
            return Promise.reject(err);
        }

        const dryRun = props.dryRun === true;

        return new Promise((resolve, reject) => {
            this.logger.info(`performing trade: ${JSON.stringify()}`);
            const response = {
                verification: {},
                confirmation: {}
            };
            this.verify(props, {}, authOptions)
                .then(verificationResult => {
                    response.verification = verificationResult;
                    if (dryRun || !verificationResult.successful()) {
                        resolve(response);
                        return;
                    }

                    this.confirm(props, verificationResult, {}, authOptions)
                        .then(confirmationResult => {
                            response.confirmation = confirmationResult;
                            resolve(response);
                        })
                        .catch(reject);
                }).catch(reject);
        });
    }
}

module.exports = {
    TradeType,
    Schwab
};



