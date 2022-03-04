const { TradeType, Schwab } = require('./lib/schwab');
const SchwabSession = require('./lib/session');
const { setLogTransport, formatMessage, logger } = require(`./lib/logging`);

module.exports = { 
    Schwab,
    TradeType,
    SchwabSession,
    Logging: {
        setLogTransport,
        defaults: {
            formatMessage,
            logger
        }
    }
};