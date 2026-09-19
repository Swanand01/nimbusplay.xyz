# Bruno Flow

Use this collection flow to test the current backend.

## Variables

Collection variable:

```text
BASE_URL=http://127.0.0.1:8080
```

Environment variable populated by login:

```text
token=
```

## Login

```text
POST {{BASE_URL}}/auth/login
```

Headers:

```text
content-type: application/json
```

Body:

```json
{
  "email": "swanandmathekar@gmail.com",
  "password": "<password>"
}
```

Post-response script:

```js
const body = res.getBody();

if (res.getStatus() !== 200) {
  throw new Error(`Login failed: ${res.getStatus()}`);
}

if (!body.token) {
  throw new Error("Login response did not include token");
}

bru.setEnvVar("token", body.token, { persist: true });
bru.setEnvVar("userId", body.userId, { persist: true });
```

## Authenticated Requests

Set Auth to Bearer Token:

```text
{{token}}
```

Requests:

```text
POST {{BASE_URL}}/sessions/start
GET  {{BASE_URL}}/sessions/current
POST {{BASE_URL}}/pairing/pin
GET  {{BASE_URL}}/pairing/clients
POST {{BASE_URL}}/sessions/stop
```

Pairing body:

```json
{
  "pin": "1234",
  "name": "Artemis"
}
```

Replace `1234` with the PIN shown in Artemis.

## Expected Pairing Result

```json
{
  "status": true,
  "apollo": {
    "status": true
  }
}
```

After successful pairing, the backend upgrades the paired Artemis client to full Apollo permissions.
