# Security notes

WiseShelf is designed so provider credentials remain on the backend. Do not embed `OPENROUTER_API_KEY` or `TYPESAFE_API_KEY` in extension files.

For any backend reachable outside the local machine:

- set a strong `APP_SHARED_SECRET`;
- serve it over HTTPS;
- restrict `ALLOWED_ORIGINS` to known web origins where applicable;
- keep the container/runtime patched;
- rotate provider keys if a deployment secret is exposed.

The extension deliberately records checkout as `pending`, not `bought`; the user must confirm a successful purchase before it changes confirmed-spend totals.
