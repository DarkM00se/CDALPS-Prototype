# Centralised Data Access and Leakage Prevention System (CDALPS)

CDALPS is a small project for the CIT1142 Emerging Trends assignment. It looks at what happens when employees download customer data from a CRM into spreadsheets. Once that data leaves the system, it becomes easier to copy, forward or share with the wrong person.

The idea is to give the organisation's IT department a place to manage export rules, review requests and keep track of decisions. Staff, managers and IT administrators have different permissions, so signing in does not automatically give everyone the same access.

The application uses Node.js, Express and a simple HTML, CSS and JavaScript frontend. There are eight demo customers stored in customers.json. I kept it lightweight by leaving out a database and external services. The Figma file documents the interface and the reasons behind its layout.

## Running the project

You need Node.js 20 or newer with npm. Open a terminal in this project folder and run:

```sh
npm install
npm start
```

Then open http://127.0.0.1:3000 in your browser. Keep the terminal running while you use the app.

The terminal shows passwords for three demo accounts:

- `staff`
- `manager`
- `admin` (the IT administrator)

Select an account on the sign-in page and copy its password from the terminal. Passwords are generated again each time the server starts. Restarting clears login sessions and approval requests. Policies and audit history are saved in JSON files and remain after a restart. Press Ctrl+C to stop the server.

To switch roles, sign out and sign in with another account. For the approval example, you can keep the manager signed in and use a private browser window for the IT administrator. Two tabs in the same browser profile share the same login.

You only need an internet connection to install the dependencies. After that, the project runs locally. The server listens on the local computer only.

### If npm does not work on Windows

On the machine used for this project, the normal npm launcher was broken. If you have the same issue and npm is installed at this path, use:

```powershell
node 'C:\Program Files\nodejs\node_modules\npm\bin\npm-cli.js' install
node server.js
```

### Optional settings

Set `PORT` before starting if you need a different port. You can also set `DEMO_STAFF_PASSWORD`, `DEMO_MANAGER_PASSWORD` and `DEMO_ADMIN_PASSWORD` to keep the same demo passwords between restarts. Each password must be 12–256 characters long. These are environment variables; the app does not read `.env` files.

## What each account can do

| Account | Access |
| --- | --- |
| Staff | View customers with email addresses masked. Exports are blocked unless IT enables them. Staff exports still have masked emails. |
| Manager | View standard customer emails and request exports. Sensitive emails are masked in the customer view. |
| IT administrator | Change policies, approve or reject requests, and view audit logs. This account cannot export customers. |

There is one account per role in this demo. A real organisation would need separate accounts for individual employees.

## Export rules

The default policy allows managers to download up to three standard customer records for internal reporting. Requests for four to six records need IT approval. More than six records are blocked.

Sensitive records, IDs 7 and 8, are blocked from export. Partner exports and staff exports are also blocked by default. IT can change these settings. If partner exports are enabled, they always need approval, even for one record.

The server checks the role, number of records, classification and destination before deciding whether approval is needed. A blocked request cannot be released just by approving it. Changing a role or classification in a browser request does not change what the server knows about the account or customer.

Every request needs a business purpose and a selected destination. The destination describes the intended use of the data; the app does not verify a recipient or send anything to them. An allowed export downloads a CSV to the user's computer.

Approvals last for ten minutes and can be used for one download. Saving a policy change invalidates pending and approved requests, so users must submit them again under the new rules.

## Trying it out

Start with the default policy and enter a purpose such as monthly customer reporting.

1. Sign in as staff and try exporting customers 1 and 2. The request should be denied.
2. Sign in as manager and export customers 1 and 2 for internal reporting. A CSV should download.
3. Select customers 1–4. The request should stay pending without releasing a CSV.
4. Sign in as IT administrator and approve it. Return to the manager account, press Refresh and download the approved CSV. That approval cannot be used again.
5. Submit another request and reject it as IT administrator. The manager should not be able to download it.
6. Try exporting customer 7, seven customers at once, or selecting the partner destination. Each should be blocked under the default policy.
7. Check the audit trail as IT administrator. It should show the export requests, decisions, reviews and downloads.
8. Approve a request, then save a policy change before the manager downloads it. The old approval should become invalid.

You can also enable staff exports and check that their CSV still masks email addresses. Enabling partner requests should send them for approval. If you turn off sensitive-data blocking, a manager can export the fictional sensitive emails; this shows how much the outcome depends on the rules IT sets.

Requests expire after ten minutes. Login sessions expire thirty minutes after sign-in, and signing out ends the session immediately.

### Automated tests

```sh
npm test
```

If you are using the Windows workaround:

```powershell
node --test test/system.test.js
```

The tests check login, role restrictions, masked data, export decisions, approvals, policy changes, audit events and logout. They also check invalid requests, attempts to change roles through request data, and attempts to download another account's approved request. The ten-minute request expiry and thirty-minute session expiry can be checked manually.

## Security and limits

Passwords are stored as salted scrypt hashes in memory. Login uses a random session ID in an HttpOnly, SameSite cookie. Requests that change data need a session-specific request token. The server also validates input and limits login attempts to ten per local IP per minute, including successful attempts.

The app uses local HTTP for simple setup. A deployed version would need HTTPS, secure cookies, stronger identity management and a reviewed authentication system. The generated passwords are visible in the terminal for demonstration purposes, so use demo credentials rather than real account passwords.

Customer classifications are set in customers.json. The app does not scan documents or automatically detect sensitive information. The latest 500 audit events are saved in audit-logs.json. There is space for up to 100 live requests and 100 sessions. The logs are useful for the demonstration, but anyone with access to the project files can edit or delete them. They are not protected against tampering.

The controls apply to exports made through this application. They cannot stop exports from another CRM, screenshots, photographs or copying data already visible on screen. Once a CSV has been downloaded, the app cannot control where it goes. Repeated small exports can also get around the per-request row limit because there is no total export quota.

## How this relates to a wider organisation

This project represents one controlled route for accessing and exporting CRM data. In an organisation using several SaaS applications, IT would need to apply the policy through the security settings and integrations each provider supports.

Connecting an API alone would not prevent an employee from using the provider's own export button. The organisation would also need suitable access permissions, provider export restrictions, monitoring and staff training. CDALPS demonstrates the shared policy and approval idea; it does not implement those external connections.

The [Express security documentation](https://expressjs.com/en/advanced/best-practice-security/) explains the security practices used as a reference for this project.

## Project structure

```text
centralised-data-security/
├── server.js
├── users.json
├── customers.json
├── policies.json
├── audit-logs.json
├── lib/
│   ├── store.js
│   ├── auth.js
│   ├── policy.js
│   └── routes.js
├── public/
│   ├── index.html
│   ├── style.css
│   ├── app.js
│   ├── api.js
│   ├── views.js
│   └── zcas-logo.png
├── test/
│   └── system.test.js
├── package.json
└── package-lock.json
```

`server.js` starts the app and connects the other parts. The JSON files separate the demo data from the code:

- `users.json` defines the three usernames and roles. It does not contain passwords; those are generated and hashed at startup.
- `customers.json` contains the customer records and their classifications. Your edited names, emails and companies have been kept.
- `policies.json` contains the current export settings and policy version. Saving a policy in the IT screen updates this file.
- `audit-logs.json` contains the audit history. The server updates it as events happen and retains the latest 500 entries.

The server reads these files at startup. To edit them manually, stop the server first, use valid JSON, then restart. Invalid data produces a startup error rather than silently restoring defaults. The files stay outside `public/`, so the browser cannot download them directly.

`lib/store.js` handles file reads and writes. `lib/auth.js` handles passwords, sessions and role checks. `lib/policy.js` holds the export decision rules and CSV formatting. `lib/routes.js` connects those functions to the API endpoints.

On the frontend, `app.js` handles user actions, `api.js` handles requests to the server, and `views.js` draws the tables and forms. Keeping those jobs separate makes each file easier to read. The HTML still contains the page text and the CSS still controls its appearance.

Sessions and approval requests stay in memory. A restart signs everyone out and clears approvals, but keeps the saved policy and audit history. To return to the original demonstration policy, stop the app and set `policies.json` to:

```json
{
  "staffExport": false,
  "maxRows": 6,
  "approvalThreshold": 3,
  "blockSensitive": true,
  "allowPartner": false,
  "version": 1
}
```

If you want to clear the audit history, stop the app and replace the contents of `audit-logs.json` with `[]`. This deletes the saved demonstration history.

The tests use separate temporary JSON files, so running them does not change your policy or audit history. These files are a simple storage option for one local server process, not a database. Run only one instance against this folder; multiple processes could overwrite each other's changes. Each update is written to a temporary file before replacing the original, but policies and logs are not a single transaction. File permission or disk errors can cause a request to fail.

There is no frontend build step or database to configure. The run commands are still `npm install`, `npm start` and `npm test`.
