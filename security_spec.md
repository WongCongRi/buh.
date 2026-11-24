# buh. Cloud Sync Security Specification

## 1. Data Invariants
1. **Strict Ownership & Verified Identity**: Every document in `/users/{userId}`, `/users/{userId}/preferences/{prefId}`, and `/users/{userId}/notes/{noteId}` belongs strictly to the authenticated, email-verified user whose `request.auth.uid == userId` and `data.ownerId == request.auth.uid`.
2. **PII Isolation**: No personally identifiable information (email, phone, address, display name) is stored in Firestore.
3. **Master Gate Relational Sync**: Subcollection documents under `/users/{userId}/notes/{noteId}` and `/users/{userId}/preferences/{prefId}` require the parent `/users/{userId}` document to exist and have `ownerId == request.auth.uid` on single-document operations (`get`, `create`, `update`, `delete`).
4. **Immutable Ownership & Creation Time**: `ownerId`, `id`, and `createdAt` can never be altered after document creation.
5. **Temporal Integrity**: `createdAt` on create and `updatedAt` on create/update must strictly equal `request.time`.
6. **Strict Schema & Bounds**: Unknown/shadow keys are rejected via `hasAll` + `hasOnly` (create) and `affectedKeys().hasOnly(...)` (update). All strings, IDs (`^[a-zA-Z0-9_\-]+$`, `<= 128`), and arrays (`folders <= 50`, `collapsedFolders <= 50`, `blocks <= 250`) enforce strict size and type bounds.
7. **Secure List Queries**: `allow list` on `/users/{userId}/notes/{noteId}` evaluates `resource.data.ownerId == request.auth.uid` directly without `get()`/`exists()` calls, forcing authenticated owner-scoped queries.

## 2. The "Dirty Dozen" Attack Payloads
1. **Unauthenticated Read/Write**: Unauthenticated client attempts `get` or `create` on `/users/u1/notes/n-1` -> MUST return `PERMISSION_DENIED`.
2. **Unverified Email Write**: Signed-in user with `email_verified: false` attempts to create `/users/u1/notes/n-1` -> MUST return `PERMISSION_DENIED`.
3. **Cross-User Identity Spoofing (Path vs UID)**: User `u2` attempts to read or create `/users/u1/notes/n-1` -> MUST return `PERMISSION_DENIED`.
4. **OwnerId Spoofing in Payload**: User `u1` attempts to create `/users/u1/notes/n-1` with `{ ownerId: "u2", ... }` -> MUST return `PERMISSION_DENIED`.
5. **Shadow / Ghost Field Injection (Create)**: User `u1` creates a note with extra field `isAdmin: true` -> MUST return `PERMISSION_DENIED`.
6. **Shadow / Ghost Field Injection (Update)**: User `u1` updates a note adding `{ ghostField: "x" }` -> MUST return `PERMISSION_DENIED`.
7. **Immutable Field Mutation**: User `u1` updates a note attempting to change `createdAt` or `ownerId` -> MUST return `PERMISSION_DENIED`.
8. **Client-Forged Timestamp**: User `u1` creates or updates a note with a past/future `Timestamp` instead of `serverTimestamp()` (`request.time`) -> MUST return `PERMISSION_DENIED`.
9. **ID Poisoning / Path Traversal**: User `u1` attempts to create `/users/u1/notes/bad$id..!` or an ID > 128 chars -> MUST return `PERMISSION_DENIED`.
10. **Value Poisoning / Resource Exhaustion**: User `u1` attempts to update `title` to a 5,000-character string or `blocks` to > 250 elements -> MUST return `PERMISSION_DENIED`.
11. **Array Type Poisoning**: User `u1` attempts to save `folders: [12345]` (non-string first element) or `blocks: ["not-a-map"]` -> MUST return `PERMISSION_DENIED`.
12. **Orphaned Subcollection Write / Invalid Preference Key**: User `u1` attempts to write `/users/u1/preferences/arbitrary` (where `prefId != 'notes'`) or write a note when parent `/users/u1` does not exist -> MUST return `PERMISSION_DENIED`.
