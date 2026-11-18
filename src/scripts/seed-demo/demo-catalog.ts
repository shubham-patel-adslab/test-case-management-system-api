// What the demo contains: its users, three sample projects and the test cases generated for them (PRD Live Demo:
// "demo credentials for admin, test-lead, tester and read-only", "sample test project with pre-populated test
// cases"). Plain data plus one generator; nothing here touches the database.
import type { TestCasePriority, TestCaseType } from '../../features/test-case/test-case.constant.js';
import type { Random } from './demo-random.js';

// A reserved TLD (RFC 2606): demo logins can't belong to a real person, and are told apart from real users and
// from the tests' @tcms-test.example users.
export const DEMO_EMAIL_DOMAIN = 'tcms-demo.example';

export type DemoUserKey = 'admin' | 'lead' | 'tester' | 'tester2' | 'readOnly';

export const DEMO_USERS: readonly { key: DemoUserKey; email: string; firstName: string; lastName: string; roleCode: string }[] = [
    { key: 'admin', email: `admin@${DEMO_EMAIL_DOMAIN}`, firstName: 'Alex', lastName: 'Morgan', roleCode: 'ADMIN' },
    { key: 'lead', email: `lead@${DEMO_EMAIL_DOMAIN}`, firstName: 'Priya', lastName: 'Raman', roleCode: 'TEST_LEAD' },
    { key: 'tester', email: `tester@${DEMO_EMAIL_DOMAIN}`, firstName: 'Sam', lastName: 'Carter', roleCode: 'TESTER' },
    { key: 'tester2', email: `tester2@${DEMO_EMAIL_DOMAIN}`, firstName: 'Mei', lastName: 'Tanaka', roleCode: 'TESTER' },
    { key: 'readOnly', email: `readonly@${DEMO_EMAIL_DOMAIN}`, firstName: 'Jordan', lastName: 'Blake', roleCode: 'READ_ONLY' },
];

type Step = { action: string; expectedResult: string };

type DemoModule = {
    name: string;
    tag: string;
    type: TestCaseType;
    preConditions: string;
    postConditions: string;
    // First and last step of every test case of the module, around the scenario's own step.
    setup: Step;
    verify: Step;
    // 'Name|Action|Expected result'
    scenarios: readonly string[];
};

export type DemoProject = {
    name: string;
    description: string;
    version: string;
    tag: string;
    members: readonly DemoUserKey[];
    // Who records results, with how often (the lead runs fewer than the testers).
    executors: readonly (readonly [DemoUserKey, number])[];
    // Results recorded on an average weekday, besides the weekly regression run.
    dailyResults: number;
    testCaseCount: number;
    // Each scenario is also tested on these (cross-browser, device, API version) until testCaseCount is reached.
    variants: readonly { name: string; tag: string; type: TestCaseType; step: Step }[];
    modules: readonly DemoModule[];
};

export const REGRESSION_SUITE_NAME = 'Regression';
export const SMOKE_SUITE_NAME = 'Smoke';

export const DEMO_PROJECTS: readonly DemoProject[] = [
    {
        name: 'ShopFront Web',
        description: 'Customer-facing online store: search, product pages, cart, checkout, payments and order tracking.',
        version: '3.4.0',
        tag: 'web',
        members: ['lead', 'tester', 'tester2', 'readOnly'],
        executors: [['tester', 5], ['tester2', 4], ['lead', 1]],
        dailyResults: 10,
        testCaseCount: 180,
        variants: [
            { name: 'Safari', tag: 'safari', type: 'UI', step: { action: 'Use the latest Safari on macOS', expectedResult: 'The store loads without layout issues' } },
            { name: 'Firefox', tag: 'firefox', type: 'UI', step: { action: 'Use the latest Firefox', expectedResult: 'The store loads without layout issues' } },
            { name: 'mobile browser', tag: 'mobile-web', type: 'UI', step: { action: 'Use Chrome on a 390 px wide phone screen', expectedResult: 'The mobile layout is shown' } },
        ],
        modules: [
            {
                name: 'Sign-in', tag: 'auth', type: 'FUNCTIONAL',
                preConditions: 'A registered customer account exists.', postConditions: 'Sign out.',
                setup: { action: 'Open the sign-in page', expectedResult: 'The sign-in form is shown' },
                verify: { action: 'Reload the page', expectedResult: 'The session state is unchanged' },
                scenarios: [
                    'Sign in with valid credentials|Enter a valid email and password and submit|The account home page opens',
                    'Reject a wrong password|Enter a valid email with a wrong password|"Invalid email or password" is shown',
                    'Lock the account after 5 failed attempts|Submit a wrong password five times|The account is locked for 15 minutes',
                    'Reset a forgotten password|Request a reset link and set a new password|Only the new password signs in',
                    'Remember me keeps the session|Sign in with "Remember me" and reopen the browser|The customer is still signed in',
                    'Sign out everywhere|Use "Sign out everywhere" in account settings|Other sessions are signed out',
                    'Email is case-insensitive|Sign in with the email in upper case|Sign-in succeeds',
                    'Show password toggle|Click the eye icon in the password field|The password is shown, then hidden again',
                ],
            },
            {
                name: 'Product search', tag: 'search', type: 'FUNCTIONAL',
                preConditions: 'The catalog has at least 50 products.', postConditions: '',
                setup: { action: 'Open the home page', expectedResult: 'The search bar is visible' },
                verify: { action: 'Open the first result', expectedResult: 'The product page matches the result' },
                scenarios: [
                    'Search by product name|Search for "running shoes"|Matching products are listed first',
                    'Search with a typo|Search for "runing shoes"|Results for "running shoes" are suggested',
                    'Filter by price range|Set a price range of 50–100|Only products in the range are shown',
                    'Filter by brand and size|Select one brand and size 42|Only matching products are shown',
                    'Sort by price|Choose "Price: low to high"|Products are ordered by price',
                    'No results|Search for "zzzz"|"No products found" is shown with suggestions',
                    'Paginate results|Go to page 2 of the results|The next 24 products are shown, without duplicates',
                    'Filters kept on Back|Open a product and press Back|The previous filters and page are kept',
                ],
            },
            {
                name: 'Product page', tag: 'product', type: 'UI',
                preConditions: 'The product is in stock.', postConditions: '',
                setup: { action: 'Open a product page', expectedResult: 'Name, price and images load' },
                verify: { action: 'Check the browser console', expectedResult: 'No errors are logged' },
                scenarios: [
                    'Select a size and colour|Choose size M and colour blue|Price and stock update for the variant',
                    'Out-of-stock variant|Choose a variant with no stock|"Add to cart" is disabled and "Notify me" is offered',
                    'Zoom an image|Click the main image|A zoomed view opens and closes again',
                    'Write a review|Submit a 4-star review|The review appears after moderation',
                    'Delivery estimate|Enter a postcode|An estimated delivery date is shown',
                    'Add to wishlist|Click the heart icon|The product appears in the wishlist',
                    'Related products|Scroll to "You may also like"|At least four related products are shown',
                    'Share link|Copy the share link and open it|The same product and variant open',
                ],
            },
            {
                name: 'Cart', tag: 'cart', type: 'FUNCTIONAL',
                preConditions: 'The cart is empty.', postConditions: 'Empty the cart.',
                setup: { action: 'Add a product to the cart', expectedResult: 'The cart badge shows 1' },
                verify: { action: 'Open the cart in a new tab', expectedResult: 'The cart shows the same items and totals' },
                scenarios: [
                    'Update the quantity|Change the quantity to 3|The line total and cart total update',
                    'Remove an item|Remove the only item|The cart is empty and shows "Continue shopping"',
                    'Apply a coupon|Apply coupon SAVE10|A 10% discount line is shown',
                    'Reject an expired coupon|Apply an expired coupon|"Coupon expired" is shown and the totals are unchanged',
                    'Merge the guest cart on sign-in|Add items as a guest, then sign in|The guest items are added to the account cart',
                    'Maximum quantity|Set the quantity to 99|The quantity is capped at the per-order limit',
                    'Price change notice|Change the price in admin and reload the cart|A price-change notice is shown',
                    'Free shipping threshold|Add items above the free-shipping amount|Shipping shows as free',
                ],
            },
            {
                name: 'Checkout', tag: 'checkout', type: 'FUNCTIONAL',
                preConditions: 'The cart has two items.', postConditions: 'Cancel the test order.',
                setup: { action: 'Open the cart and click "Checkout"', expectedResult: 'The checkout form opens' },
                verify: { action: 'Open "My orders"', expectedResult: 'The order is listed as "Placed"' },
                scenarios: [
                    'Guest checkout|Check out as a guest with a valid address|An order confirmation is shown',
                    'Use a saved address|Choose a saved address|The address fields are filled in',
                    'Invalid postcode|Enter an invalid postcode|The postcode field shows an error',
                    'Change the shipping method|Switch to express shipping|The shipping cost and delivery date update',
                    'Order summary totals|Review the order summary|Items, discount, shipping and tax add up to the total',
                    'Gift message|Add a gift message|The message appears on the order details',
                    'Double-click "Place order"|Double-click "Place order"|Exactly one order is created',
                    'Session expires during checkout|Let the session expire, then place the order|Sign-in is asked for and the cart is kept',
                ],
            },
            {
                name: 'Payments', tag: 'payments', type: 'INTEGRATION',
                preConditions: 'The payment provider sandbox is available.', postConditions: '',
                setup: { action: 'Reach the payment step of checkout', expectedResult: 'Card and wallet options are shown' },
                verify: { action: 'Check the payment provider dashboard', expectedResult: 'The transaction matches the order total' },
                scenarios: [
                    'Pay by card|Pay with a valid test card|The payment is authorized',
                    'Declined card|Pay with a card that is declined|"Payment declined" is shown and no order is created',
                    '3-D Secure challenge|Pay with a 3-D Secure test card and pass the challenge|The payment is authorized after the challenge',
                    'Pay with a wallet|Pay with the wallet option|The payment completes without card details',
                    'Refund a payment|Refund the order from admin|The refund appears on the payment',
                    'Currency rounding|Pay an amount with three decimals|The amount charged is rounded to two decimals',
                    'Provider timeout|Simulate a provider timeout|The order stays "Pending payment" and can be retried',
                    'Save a card|Tick "Save this card"|The card is listed in the account, masked',
                ],
            },
            {
                name: 'Orders and returns', tag: 'orders', type: 'FUNCTIONAL',
                preConditions: 'The customer has a delivered order.', postConditions: '',
                setup: { action: 'Open "My orders"', expectedResult: 'Past orders are listed' },
                verify: { action: 'Open the order details', expectedResult: 'Status and history are correct' },
                scenarios: [
                    'Track a shipment|Click "Track" on a shipped order|The carrier tracking page opens',
                    'Cancel before shipping|Cancel an order that has not shipped|The order is cancelled and refunded',
                    'Request a return|Request a return for one item|A return label is issued',
                    'Return window expired|Try to return an item after 30 days|The return option is not offered',
                    'Download the invoice|Click "Invoice"|A PDF invoice with the order lines downloads',
                    'Buy again|Click "Buy again"|The same items are added to the cart',
                    'Confirmation email|Place an order|A confirmation email with the order number arrives',
                    'Partial shipment|Ship one of two items|The order shows "Partially shipped"',
                ],
            },
            {
                name: 'Admin catalog', tag: 'admin', type: 'FUNCTIONAL',
                preConditions: 'An admin account exists.', postConditions: 'Undo the catalog change.',
                setup: { action: 'Sign in to the admin panel', expectedResult: 'The catalog list is shown' },
                verify: { action: 'Open the product on the storefront', expectedResult: 'The storefront shows the change' },
                scenarios: [
                    'Create a product|Create a product with two variants|The product appears in the catalog',
                    'Bulk price update|Raise the prices of a category by 5%|Every price in the category is updated',
                    'Hide a product|Set the product to hidden|The product disappears from search',
                    'Upload product images|Upload three images|The images appear in the gallery, in order',
                    'Import products from CSV|Import a CSV with 20 products|20 products are created; errors are reported per row',
                    'Schedule a sale|Schedule a sale price for tomorrow|The sale price applies only from tomorrow',
                    'Low-stock alert|Reduce stock below the threshold|A low-stock alert is shown',
                    'Price change history|Change a price|The change is in the audit log with the admin\'s name',
                ],
            },
        ],
    },
    {
        name: 'PayWallet Mobile',
        description: 'Mobile wallet app (iOS first): onboarding, transfers, bill payments, cards and notifications.',
        version: '2.1.0',
        tag: 'mobile',
        members: ['lead', 'tester', 'readOnly'],
        executors: [['tester', 4], ['lead', 1]],
        dailyResults: 7,
        testCaseCount: 140,
        variants: [
            { name: 'Android', tag: 'android', type: 'UI', step: { action: 'Use the Android app on Android 15', expectedResult: 'The app opens on the home screen' } },
            { name: 'tablet', tag: 'tablet', type: 'UI', step: { action: 'Use the app on a tablet in landscape', expectedResult: 'The tablet layout is shown' } },
        ],
        modules: [
            {
                name: 'Onboarding', tag: 'onboarding', type: 'FUNCTIONAL',
                preConditions: 'The app is freshly installed.', postConditions: 'Delete the test account.',
                setup: { action: 'Open the app', expectedResult: 'The welcome screen is shown' },
                verify: { action: 'Restart the app', expectedResult: 'The user continues where they left off' },
                scenarios: [
                    'Sign up with a phone number|Enter a phone number and the SMS code|The account is created',
                    'Wrong SMS code|Enter a wrong SMS code three times|A new code must be requested',
                    'Identity check|Upload an ID photo and a selfie|The identity check is submitted',
                    'Rejected ID photo|Upload a blurry ID photo|"Photo unreadable" is shown with tips',
                    'Set a PIN|Choose a 6-digit PIN|The PIN is required on the next launch',
                    'Weak PIN|Choose 123456 as the PIN|The PIN is rejected as too simple',
                    'Accept the terms|Open and accept the terms|Onboarding continues only after accepting',
                    'Resume onboarding|Close the app halfway and reopen it|Onboarding resumes at the same step',
                ],
            },
            {
                name: 'Login and biometrics', tag: 'auth', type: 'FUNCTIONAL',
                preConditions: 'An active wallet account exists.', postConditions: 'Log out.',
                setup: { action: 'Open the app', expectedResult: 'The PIN screen is shown' },
                verify: { action: 'Send the app to the background and back', expectedResult: 'The PIN is asked again after 5 minutes' },
                scenarios: [
                    'Log in with the PIN|Enter the correct PIN|The home screen opens',
                    'Log in with Face ID|Use Face ID|The home screen opens without the PIN',
                    'Biometrics changed|Add a new fingerprint on the device|Biometric login is disabled until the PIN is entered',
                    'Wrong PIN five times|Enter a wrong PIN five times|The account is locked and support is offered',
                    'Forgot PIN|Reset the PIN with the SMS code|The new PIN works',
                    'Session timeout|Leave the app idle for 10 minutes|The user is logged out',
                    'Log in on a new device|Log in on a second phone|The first phone gets a security alert',
                    'Jailbroken device|Open the app on a rooted device|A warning is shown and payments are disabled',
                ],
            },
            {
                name: 'Transfers', tag: 'transfers', type: 'FUNCTIONAL',
                preConditions: 'The wallet balance is at least 500.', postConditions: '',
                setup: { action: 'Open "Send money"', expectedResult: 'Recent contacts are listed' },
                verify: { action: 'Open the transaction history', expectedResult: 'The transfer is listed with the right amount' },
                scenarios: [
                    'Send to a contact|Send 50 to a saved contact|Both balances update',
                    'Insufficient balance|Send more than the balance|"Insufficient balance" is shown',
                    'Daily limit|Send above the daily limit|The transfer is rejected with the limit shown',
                    'Send by QR code|Scan a QR code and confirm|The transfer goes to the QR owner',
                    'Cancel a scheduled transfer|Cancel a transfer scheduled for tomorrow|The transfer is removed',
                    'Repeat a transfer|Use "Repeat" on a past transfer|The form is filled in with the same details',
                    'Transfer note|Add a note to a transfer|The receiver sees the note',
                    'Offline transfer|Send money with no network|The transfer is queued and sent when online',
                ],
            },
            {
                name: 'Bill payments', tag: 'bills', type: 'INTEGRATION',
                preConditions: 'A biller is saved.', postConditions: '',
                setup: { action: 'Open "Pay bills"', expectedResult: 'Saved billers are listed' },
                verify: { action: 'Check the biller\'s sandbox', expectedResult: 'The payment is received' },
                scenarios: [
                    'Pay an electricity bill|Fetch and pay the latest bill|The bill is marked paid',
                    'Add a biller|Add a biller by account number|The biller is saved',
                    'Wrong account number|Add a biller with a wrong number|The biller lookup fails with a clear message',
                    'Autopay|Turn on autopay for a biller|The next bill is paid on the due date',
                    'Bill reminder|Have a bill due in 3 days|A reminder notification arrives',
                    'Biller unavailable|Pay while the biller is down|The payment is retried and the user informed',
                    'Partial payment|Pay half of a bill|The remaining amount is shown',
                    'Receipt|Open a paid bill|A receipt can be shared as PDF',
                ],
            },
            {
                name: 'Cards', tag: 'cards', type: 'FUNCTIONAL',
                preConditions: 'The user has a virtual card.', postConditions: '',
                setup: { action: 'Open "Cards"', expectedResult: 'The card is shown, masked' },
                verify: { action: 'Open the card settings', expectedResult: 'The settings match the change' },
                scenarios: [
                    'Freeze a card|Freeze the card|Payments with the card are declined',
                    'Show card details|Reveal the card number with the PIN|The full number is shown for 30 seconds',
                    'Change the spending limit|Set a monthly limit of 1000|Payments above the limit are declined',
                    'Order a physical card|Order a physical card|The delivery address is confirmed',
                    'Online payments off|Turn off online payments|Online payments are declined',
                    'Replace a lost card|Report the card lost|A new card number is issued',
                    'Add to Apple Pay|Add the card to Apple Pay|The card appears in Wallet',
                    'Card transaction details|Open a card transaction|Merchant, amount and time are shown',
                ],
            },
            {
                name: 'Notifications', tag: 'notifications', type: 'FUNCTIONAL',
                preConditions: 'Notifications are allowed on the device.', postConditions: '',
                setup: { action: 'Open "Notifications" settings', expectedResult: 'All notification types are listed' },
                verify: { action: 'Open the notification', expectedResult: 'The app opens on the related screen' },
                scenarios: [
                    'Money received|Receive a transfer|A push notification shows the amount',
                    'Turn off marketing|Turn off marketing notifications|No marketing notifications arrive',
                    'Security alert cannot be turned off|Try to turn off security alerts|The switch is locked',
                    'Notification inbox|Open the in-app inbox|Past notifications are listed, newest first',
                    'Mark all as read|Use "Mark all as read"|The unread badge disappears',
                    'Large amount alert|Spend above the alert amount|An alert arrives within one minute',
                    'Quiet hours|Set quiet hours from 22:00 to 07:00|Non-urgent notifications wait until 07:00',
                    'Localized text|Switch the phone to Spanish|Notifications arrive in Spanish',
                ],
            },
            {
                name: 'Settings and privacy', tag: 'settings', type: 'UI',
                preConditions: 'The user is logged in.', postConditions: 'Restore the default settings.',
                setup: { action: 'Open "Settings"', expectedResult: 'Profile, security and privacy sections are shown' },
                verify: { action: 'Log out and log in again', expectedResult: 'The setting is kept' },
                scenarios: [
                    'Change the email|Change the email and confirm the link|The new email is shown in the profile',
                    'Download my data|Request a data export|A download link arrives by email',
                    'Delete the account|Delete the account with a zero balance|The account is closed',
                    'Dark mode|Turn on dark mode|Every screen uses the dark theme',
                    'Change the language|Switch the app to French|All texts are in French',
                    'Hide the balance|Turn on "Hide balance"|The balance is masked on the home screen',
                    'Connected devices|Open "Devices" and remove one|The removed device is logged out',
                    'Accessibility text size|Set the largest system text size|Texts scale without overlapping',
                ],
            },
        ],
    },
    {
        name: 'Partner API',
        description: 'REST API for marketplace partners: OAuth, orders, inventory, webhooks and reporting.',
        version: '1.9.2',
        tag: 'api',
        members: ['lead', 'tester2', 'readOnly'],
        executors: [['tester2', 4], ['lead', 1]],
        dailyResults: 4,
        testCaseCount: 80,
        variants: [
            { name: 'API v1', tag: 'v1', type: 'REGRESSION', step: { action: 'Call the v1 endpoint with a v1 client', expectedResult: 'The response uses the v1 format' } },
        ],
        modules: [
            {
                name: 'OAuth', tag: 'oauth', type: 'API',
                preConditions: 'A partner app with client credentials exists.', postConditions: 'Revoke the test tokens.',
                setup: { action: 'Request a token with the client credentials', expectedResult: '200 with an access token' },
                verify: { action: 'Call GET /me with the token', expectedResult: 'The partner is returned' },
                scenarios: [
                    'Client credentials grant|Request a token with valid credentials|A token valid for one hour is returned',
                    'Wrong client secret|Request a token with a wrong secret|401 invalid_client',
                    'Expired token|Call an endpoint with an expired token|401 with a "token expired" error',
                    'Missing scope|Call the orders API without the orders scope|403 insufficient_scope',
                    'Refresh token|Exchange a refresh token|A new access token is returned',
                    'Revoke a token|Revoke the token, then use it|401 for the revoked token',
                    'Token in a query string|Send the token as a query parameter|400: the token is only accepted in the header',
                    'Clock skew|Use a token issued 30 seconds in the future|The token is accepted',
                ],
            },
            {
                name: 'Orders API', tag: 'orders', type: 'API',
                preConditions: 'The partner has 3 open orders.', postConditions: '',
                setup: { action: 'Call GET /orders', expectedResult: '200 with the partner\'s orders' },
                verify: { action: 'Call GET /orders/{id}', expectedResult: 'The order shows the change' },
                scenarios: [
                    'List orders with paging|Call GET /orders?page=2&pageSize=10|The second page with paging metadata',
                    'Filter by status|Call GET /orders?status=SHIPPED|Only shipped orders',
                    'Accept an order|POST /orders/{id}/accept|The order is ACCEPTED',
                    'Accept twice|Accept an already accepted order|409 conflict',
                    'Another partner\'s order|GET an order of another partner|404, not 403',
                    'Ship with tracking|POST /orders/{id}/shipments with a tracking number|The order is SHIPPED with tracking',
                    'Invalid body|POST a shipment without a carrier|400 with the field in the error details',
                    'Idempotency key|Repeat a POST with the same Idempotency-Key|The same result, no duplicate shipment',
                ],
            },
            {
                name: 'Inventory API', tag: 'inventory', type: 'API',
                preConditions: 'The partner has 20 listed products.', postConditions: 'Restore the stock levels.',
                setup: { action: 'Call GET /inventory', expectedResult: '200 with stock per product' },
                verify: { action: 'Check the storefront stock', expectedResult: 'The storefront shows the new stock' },
                scenarios: [
                    'Update stock|PUT /inventory/{sku} with quantity 15|The stock is 15',
                    'Negative stock|PUT a quantity of -1|400 on quantity',
                    'Bulk update|PUT /inventory with 100 items|All 100 are updated in one call',
                    'Unknown SKU|PUT stock for an unknown SKU|404 for that SKU',
                    'Concurrent updates|Send two updates for one SKU at once|The last write wins and both get 200',
                    'Reserved stock|Place an order, then read the stock|Available stock excludes reserved units',
                    'Large payload|PUT 1001 items|413 with the maximum in the message',
                    'Stock history|GET /inventory/{sku}/history|Changes are listed with their source',
                ],
            },
            {
                name: 'Webhooks', tag: 'webhooks', type: 'INTEGRATION',
                preConditions: 'A webhook endpoint is registered.', postConditions: 'Delete the test webhook.',
                setup: { action: 'Open the webhook receiver logs', expectedResult: 'The receiver is reachable' },
                verify: { action: 'Check the delivery log', expectedResult: 'The delivery is logged with its status' },
                scenarios: [
                    'Order created event|Create an order|An order.created event is delivered',
                    'Signature header|Receive an event|The signature header validates with the shared secret',
                    'Retry on failure|Make the receiver return 500|The event is retried with backoff',
                    'Disable after failures|Fail every delivery for 24 hours|The webhook is disabled and the partner emailed',
                    'Event order|Create and ship an order quickly|Events arrive with increasing sequence numbers',
                    'Replay an event|Replay an event from the dashboard|The same event id is delivered again',
                    'Slow receiver|Make the receiver take 15 seconds|The delivery times out after 10 seconds',
                    'Rotate the secret|Rotate the signing secret|Both secrets work for one hour',
                ],
            },
            {
                name: 'Limits and errors', tag: 'errors', type: 'API',
                preConditions: 'A valid access token.', postConditions: '',
                setup: { action: 'Call GET /health', expectedResult: '200' },
                verify: { action: 'Check the API logs', expectedResult: 'The request is logged with its request id' },
                scenarios: [
                    'Rate limit|Send 101 requests in a minute|The 101st gets 429 with Retry-After',
                    'Error envelope|Call an unknown route|404 in the standard error format',
                    'Request id|Send any request|The response has an X-Request-Id header',
                    'Malformed JSON|Send a body that isn\'t valid JSON|400 BAD_REQUEST',
                    'Wrong content type|Send XML to a JSON endpoint|415 unsupported media type',
                    'Maintenance mode|Call the API during maintenance|503 with a Retry-After header',
                    'Deprecation header|Call a deprecated endpoint|A Deprecation header with the sunset date',
                    'No stack traces|Trigger a server error|500 without internal details',
                ],
            },
            {
                name: 'Reporting API', tag: 'reports', type: 'API',
                preConditions: 'The partner has 30 days of orders.', postConditions: '',
                setup: { action: 'Call GET /reports', expectedResult: 'Available reports are listed' },
                verify: { action: 'Compare with the partner dashboard', expectedResult: 'The numbers match' },
                scenarios: [
                    'Sales report|GET /reports/sales?from=…&to=…|Totals per day for the range',
                    'Range too long|Ask for a 400-day range|400 on the date range',
                    'CSV export|GET /reports/sales.csv|A CSV with a header row',
                    'Time zone|Ask for a report in Asia/Kolkata|Days are bounded in that zone',
                    'Async large report|Request a yearly report|202 with a status URL, then the file',
                    'Empty range|Ask for a range without orders|200 with zero totals',
                    'Currency per order|Report on orders in two currencies|Totals per currency',
                    'Cached report|Request the same report twice|The second response is served from cache',
                ],
            },
        ],
    },
];

export type DemoTestCase = {
    moduleName: string;
    title: string;
    description: string;
    priority: TestCasePriority;
    type: TestCaseType;
    preConditions: string;
    postConditions: string;
    tags: string[];
    steps: Step[];
    isSmoke: boolean;
    isRegression: boolean;
};

const LOWER_PRIORITY: Record<TestCasePriority, TestCasePriority> = { CRITICAL: 'HIGH', HIGH: 'MEDIUM', MEDIUM: 'LOW', LOW: 'LOW' };

function parseScenario(scenario: string): { name: string; action: string; expectedResult: string } {
    const [name, action, expectedResult] = scenario.split('|');

    if (!name || !action || !expectedResult) {
        throw new Error(`Malformed demo scenario: ${scenario}`);
    }

    return { name, action, expectedResult };
}

// Every scenario once (the first of each module is a critical smoke test, the second high priority), then the same
// scenarios again on each variant until the project has testCaseCount test cases. Smoke = the critical ones;
// regression = critical and high (the weekly suite run).
export function buildTestCases(project: DemoProject, random: Random): DemoTestCase[] {
    const baseCases = project.modules.flatMap((module) => module.scenarios.map((scenario, index): DemoTestCase => {
        const { name, action, expectedResult } = parseScenario(scenario);
        const priority: TestCasePriority = index === 0
            ? 'CRITICAL'
            : index === 1 ? 'HIGH' : random.weighted([['HIGH', 2], ['MEDIUM', 5], ['LOW', 3]] as const);
        const type: TestCaseType = index === 0
            ? 'SMOKE'
            : random.weighted([[module.type, 6], ['REGRESSION', 2], [project.variants[0]?.type ?? module.type, 1], ['INTEGRATION', 1]] as const);

        return {
            moduleName: module.name,
            title: `${module.name}: ${name}`,
            description: `Checks that ${expectedResult.charAt(0).toLowerCase()}${expectedResult.slice(1)}.`,
            priority,
            type,
            preConditions: module.preConditions,
            postConditions: module.postConditions,
            tags: [project.tag, module.tag],
            steps: [module.setup, { action, expectedResult }, module.verify],
            isSmoke: priority === 'CRITICAL',
            isRegression: priority === 'CRITICAL' || priority === 'HIGH',
        };
    }));

    const variantCases = project.variants.flatMap((variant) => baseCases.map((base): DemoTestCase => ({
        ...base,
        title: `${base.title} (${variant.name})`,
        priority: LOWER_PRIORITY[base.priority],
        type: variant.type,
        tags: [...base.tags, variant.tag],
        steps: [variant.step, ...base.steps],
        isSmoke: false,
        isRegression: false,
    })));

    const testCases = [...baseCases, ...variantCases].slice(0, project.testCaseCount);

    if (testCases.length < project.testCaseCount) {
        throw new Error(`${project.name}: only ${testCases.length} of ${project.testCaseCount} test cases can be built`);
    }

    return testCases;
}
