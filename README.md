# Schwab API

**This is not an official API or even a stable recreation of a Charles Schwab API. Functionality may change with any updates made by Schwab.**

This project was originally ported from the [itsjafer/schwab-api](https://github.com/itsjafer/schwab-api) Python library, but has diverged significantly in it's logic from the original source material. Nevertheless, if you enjoy this project, go give that one some love!

This package enables buying and selling securities programmatically on Charles Schwab. Currently, we use a headless browser to automate logging in in order to get authorization cookies. All other functionality is done through web requests made to Schwab's own API.

## Getting Started

### Installing

Install using npm:

```sh
$ npm i schwab-api
```

### Quickstart

Here's some code that logs in, gets all account holdings, and makes a stock purchase:

```js
// Import Schwab
const { Schwab, TradeType, Logging: { defaults: { logger } } } = require(`./`);

// Initialize a new instance of the Schwab class and initialize it
// with youre credentials.
const schwab = new Schwab({
    username: 'your-username',
    password: 'your-password'
});

// Authentication is performed automatically for each request, meaning
// you do not have to manually log-in each time you use the API. It
// will handle that internally including re-authenticating when a
// session is expired.

// Retrieve the account information.
schwab.getAccountInfo().then(accountInfo => {
    // Print the account information.
    const accountIdsStr = accountInfo.Accounts.map(
        account => account.AccountId
    ).join(', ');
    logger.info(`The following account numbers were found: ${accountIdsStr}`);

    // Perform a trade
    const accountId = accountInfo.Accounts[0].AccountId;
    schwab.trade({
        tradeType: TradeType.Buy,
        ticker: 'AAPL',
        quantity: 1,
        accountId: accountId,
        verifyOnly: true // setting to true will only run verification
                         // and not confirmation.
    }).then(res => {
        // If you're doing a `verifyOnly`, only the `verification` object will
        // have data. If you want the same data for `confirmation`, look at
        // the `confirmation` object instead.
        if (res.verification.successful()) {
            logger.info(`The order verification was successful.`);
            logger.info(`The order verification produced the following messages:`);
            logger.info(`${JSON.stringify(res.verification.messages())}`);    
        } else {
            logger.error(`The order verification was not successful.`);
            logger.error(`The order verification produced the following messages:`);
            logger.error(`${JSON.stringify(res.verification.messages())}`);    
        }
    }).catch(err => {
        logger.error(`The order verification was not successful.`);
        logger.error(`The order verification produced the following error:`);
        logger.error(`${err.stack}`);
    });
}).catch(err => {
    logger.error(`Retrieving account information was not successful.`);
    logger.error(`The attempt to retrieve account information produced the following error:`);
    logger.error(`${err.stack}`);
});
```

