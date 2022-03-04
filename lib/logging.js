let transport;

function _validateLogTransport(l) {
    if (typeof l !== `function` || l.length < 2) {
        throw new Error(`Invalid log transport function. Should be a function containing at least two parameters.`);
    }
}

function setLogTransport(l) {
    _validateLogTransport(l);
    transport = l;
}

function formatMessage(level, message) {
    return `${new Date().toISOString()}  ${level}:  ${message}`;
}

async function withCleanErrors(f) {
    try {
        return await f();
    } catch (err) {
        err.message = err.message.replace(/\n={27}\slogs\s={27}\n.*\n={60}/gm, '');
        err.stack = err.stack.replace(/\n={27}\slogs\s={27}\n.*\n={60}/gm, '');
        throw err;
    }
}

const debug = (message) => log('debug', message);
const info = (message) => log('info', message);
const warning = (message) => log('warning', message);
const error = (message) => log('error', message);

const log = (level, message) => (transport || (
    (l, m) => console.log(formatMessage(l, m))
))(level, message);

module.exports = {
    withCleanErrors,
    setLogTransport,
    formatMessage,
    logger: {
        debug,
        info,
        warning,
        error,
        log
    }
}