const playwright = require(`playwright`);
const reader = require(`readline-sync`);
const https = require(`https`);

const {formatMessage, logger, withCleanErrors} = require(`./logging`);
const URLs = require(`./urls`);

const USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/61.0.3163.100 Safari/537.36";
const VIEWPORT = { width: 1920, height: 1080 };

const BrowserType = {
    FIREFOX: playwright.firefox,
    WEBKIT: playwright.webkit,
    CHROMIUM: playwright.chromium
};

class SchwabSession {
    constructor(options) {
        if (!options) {
            throw new Error('You must provide an options object to initialize a SchwabSession.');
        }

        this.cookies = undefined;
        this.logger = logger;

        this.username = options.username;
        this.password = options.password;
        this.totpSecret = options.totpSecret;
        this.browserType = options.browserType || BrowserType.FIREFOX;
        this.headless = options.headless !== false;
    }

    async authenticate(options) {
        let loginIfRequired = true;
        let rememberDevice = true;
        let request;
        let apply;

        if (options) {
            loginIfRequired = options.loginIfRequired !== false;
            rememberDevice = options.rememberDevice !== false;
            request = options.request;
            apply = options.apply;
        }

        this.logger.debug(`authenticating request with options: ${JSON.stringify({loginIfRequired, rememberDevice})}`);

        const currentEpochTimestamp = Math.floor(new Date().getTime() / 1000);

        if (loginIfRequired) {
            let loginRequired = false;
            if (this.cookies === undefined) {
                loginRequired = true;
            } else if (currentEpochTimestamp >= this.cookies.expires) {
                this.logger.warning(`current session expired at ${this.cookies.expires}, current time: ${currentEpochTimestamp}, attempting re-authentication`);
                loginRequired = true;
            }

            if (loginRequired) {
                this.logger.info(`login required, attempting login`);
                const loggedIn = await this.login();
                if (!loggedIn) {
                    this.logger.debug(`waiting for SMS code from user`);
                    const code = reader.prompt({
                        prompt: formatMessage('info', 'SMS Code: ')
                    });
                    await this.smsLogin(code, rememberDevice);
                }
            }
        }

        if (this.cookies === undefined) {
            this.logger.error(`not logged in: you must log-in before authenticating a request.`);
            throw new Error('not logged in: you must log-in before authenticating a request.');
        } else if (currentEpochTimestamp >= this.cookies.expires) {
            this.logger.error(`session expired at ${this.cookies.expires}, current time: ${currentEpochTimestamp}: please log-in again.`);
            throw new Error(`session expired at ${this.cookies.expires}, current time: ${currentEpochTimestamp}: please log-in again.`);
        }

        if (apply === undefined) {
            if (!request.headers) {
                request.headers = {};
            }
            request.headers.Cookie = request.headers.Cookie
                ? `${request.headers.Cookie};${this.cookies.getHeaderValue()}`
                : this.cookies.getHeaderValue();
            
            return request;
        }

        return apply(request);
    }

    get(url, authOptions) {
        return new Promise((resolve, reject) => {
            this.logger.debug(`performing HTTP GET request with authentication: ${url}`);
            this.authenticate({
                request: {},
                ...authOptions
            }).then(authenticatedRequest => {
                https.get(url, authenticatedRequest, res => {
                    this.logger.debug(`authenticated HTTP GET request ${url} responded with status code HTTP ${res.statusCode}`);

                    let responseBody = '';
    
                    res.on('data', (chunk) => {
                        responseBody += chunk;
                    });
    
                    res.on('end', () => {
                        let response;
                        try {
                            response = JSON.parse(responseBody);
                            resolve(response, res.statusCode);
                        } catch (e) {
                            this.logger.error(`failed to retrieve`)
                            reject(e);
                        }
                    });
                }).on('error', err => reject(err));
            }).catch(err => reject(err));
        });
    }

    post(url, data, authOptions={}) {
        return new Promise((resolve, reject) => {
            this.logger.debug(`performing HTTP POST request with authentication: ${url}`);
            const encodedData = JSON.stringify(data);

            this.authenticate({
                request: {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Content-Length': encodedData.length
                    }
                },
                ...authOptions
            }).then(authenticatedRequest => {
                const req = https.request(url, authenticatedRequest, res => {
                    this.logger.debug(`authenticated HTTP POST request ${url} responded with status code HTTP ${res.statusCode}`);
                    let responseBody = '';

                    res.on('data', (chunk) => {
                        responseBody += chunk;
                    })

                    res.on('end', () => {
                        let response;
                        try {
                            response = JSON.parse(responseBody);
                            resolve(response, res.statusCode);
                        } catch (e) {
                            reject(e);
                        }
                    })
                });
                
                req.on('error', err => reject(err));

                req.write(encodedData);
                req.end();
            }).catch(err => reject(err));
        });
    }

    async saveCookiesAndCloseBrowser() {
        this.logger.debug('storing cookies');
        await this.context.cookies().then(cookies => {
            this.cookies = {
                expires: cookies.reduce((prev, cur) => {
                    return prev.expires < cur.expires && prev.expires > 0 ? prev : cur;
                }).expires,
                cookies: cookies.map(elem => ({name: elem.name, value: elem.value})),
                getHeaderValue: () => cookies.map(cookie => `${cookie.name}=${cookie.value};`).join(' ')
            };
        });
        
        this.logger.debug('closing resources');
        await this.page.close();
        await this.context.close();
        await this.browser.close();

        this.logger.info(`login successful, expires at ${this.cookies.expires}`);
    }

    async smsLogin(code, rememberDevice = false) {
        return withCleanErrors(async () => {
            this.logger.info(`authenticating 2fa with sms code: ${code}`);
            try {
                this.logger.debug('attempting to fill sms code : input[type="text"]');
                await this.page.click(`input[type="text"]`);
                await this.page.fill(`input[type="text"]`, code);
                if (rememberDevice) {
                    this.logger.debug('checking remember device check box : #checkbox-remember-device');
                    await this.page.click(`#checkbox-remember-device`);
                }
                this.logger.debug('submitting 2fa form : #continueBotton');
                await Promise.all([
                    this.page.waitForNavigation(),
                    this.page.click(`#continueButton`)
                ]);
            } catch (err) {
                this.logger.warning('failed default sms auth, attempting secondary elements');
                this.logger.warning(`${err}`);
                if (rememberDevice) {
                    this.logger.debug('checking remember device check box : input[name="TrustDeviceChecked"]');
                    await this.page.check(`input[name="TrustDeviceChecked"]`);
                }
                this.logger.debug('attempting to fill sms code : [placeholder="Access Code"]');
                await this.page.click(`[placeholder="Access Code"]`, code);
                await this.page.fill(`[placeholder="Access Code"]`, code);
                this.logger.debug('submitting 2fa form : #continueBotton');
                await Promise.all([
                    this.page.waitForNavigation(),
                    this.page.click(`#continueButton`)
                ]);
            }

            const accountListTimeout = 10000;
            this.logger.info(`awaiting 2fa verification`);
            this.logger.debug(`waiting for account list to load with a timeout of ${accountListTimeout}ms : #account-list`);
            const startedAt = Date.now();
            const loggedIn = await Promise.race([
                this.page.waitForSelector(`#account-list`),
                new Promise((resolve, reject) => setTimeout(() => reject(), accountListTimeout))
            ]).then(
                () => {
                    this.logger.debug(`account list element found after ${Date.now() - startedAt}ms, assuming login succeeded.`);
                    return true;
                },
                () => {
                    this.logger.error(`failed to find account list after ${accountListTimeout}ms, assuming login failed.`);
                    return false;
                }
            );

            if (loggedIn) {
                this.logger.info(`2fa sms code accepted, preparing session`);
                await this.saveCookiesAndCloseBrowser();
            }

            return loggedIn;
        });
    }

    async login() {
        return withCleanErrors(async () => {
            this.cookies = undefined;

            this.logger.debug(`initializing ${this.browserType.name()} browser with headless: ${this.headless}`);
            this.browser = await this.browserType.launch({ headless: this.headless });
            this.logger.debug(`initializing new context with user agent: ${USER_AGENT}`);
            this.context = await this.browser.newContext({userAgent: USER_AGENT});
            this.logger.debug(`initializing new page with viewport: ${JSON.stringify(VIEWPORT)}`);
            this.page = await this.context.newPage({viewport: VIEWPORT});

            this.logger.debug(`navigating to : ${URLs.HomePage}`);
            await Promise.all([
                this.page.waitForNavigation(),
                this.page.goto(URLs.HomePage)
            ]);
            await this.page.waitForLoadState(`networkidle`);

            const loginFrame = `schwablmslogin`;

            this.logger.debug(`waiting for login frame : #${loginFrame}`);
            await this.page.waitForSelector(`#${loginFrame}`);

            this.logger.debug('filling username : [placeholder="Login ID"]');
            await this.page.frame({name: loginFrame}).click(`[placeholder="Login ID"]`);
            await this.page.frame({name: loginFrame}).fill(`[placeholder="Login ID"]`, this.username);

            this.logger.debug('filling password : [placeholder="Password"]');
            await this.page.frame({name: loginFrame}).press(`[placeholder="Login ID"]`, "Tab");
            await this.page.frame({name: loginFrame}).fill(`[placeholder="Password"]`, this.password);

            this.logger.debug('submitting form : [placeholder="Password"] PRESS \'Enter\'');
            await Promise.all([
                this.page.waitForNavigation(),
                this.page.frame({name: loginFrame}).press(`[placeholder="Password"]`, "Enter")
            ]);

            if (this.page.url() !== URLs.AccountSummary) {
                this.logger.warning('login failed, potentially blocked by 2fa. attempting 2fa');
                this.logger.debug('selecting SMS 2fa option : [aria-label="Text me a 6 digit security code"] or input[name="DeliveryMethodSelection"]');
                try {
                    await Promise.all([
                        this.page.waitForNavigation(),
                        this.page.click(`[aria-label="Text me a 6 digit security code"]`)
                    ]);
                } catch (_) {
                    await this.page.click(`input[name="DeliveryMethodSelection"]`);
                    await this.page.click(`text=Text Message`);
                    await this.page.click(`input:has-text("Continue")`);
                }

                this.logger.info("authentication state is not available. attempting two factor authentication.");
                this.logger.info("if all went well, you should receive a code through sms soon.");
                return false;
            }

            await this.saveCookiesAndCloseBrowser();
            return true;
        });
    }
}

module.exports = SchwabSession;