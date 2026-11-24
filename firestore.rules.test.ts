/**
 * Phase 0: Payload-First Security TDD specification for buh. Cloud Sync Firestore Rules.
 *
 * Verifies all 12 "Dirty Dozen" adversarial payloads against the hardened ruleset.
 * Intended to be run against the Firestore Emulator with @firebase/rules-unit-testing.
 */

export interface DirtyDozenCase {
  id: number;
  name: string;
  auth: { uid: string; email_verified: boolean } | null;
  operation: 'get' | 'list' | 'create' | 'update' | 'delete';
  path: string;
  parentExists: boolean;
  payload?: Record<string, unknown>;
  expectedResult: 'PERMISSION_DENIED';
}

export const DIRTY_DOZEN_CASES: DirtyDozenCase[] = [
  {
    id: 1,
    name: 'Unauthenticated read/create on notes',
    auth: null,
    operation: 'get',
    path: '/users/user_a/notes/n-1',
    parentExists: true,
    expectedResult: 'PERMISSION_DENIED',
  },
  {
    id: 2,
    name: 'Unverified email user creates note',
    auth: { uid: 'user_a', email_verified: false },
    operation: 'create',
    path: '/users/user_a/notes/n-1',
    parentExists: true,
    payload: {
      id: 'n-1',
      ownerId: 'user_a',
      title: 'Test',
      folder: 'Work',
      updatedAtLabel: 'Created just now',
      pinned: false,
      markdownEnabled: false,
      blocks: [{ id: 'b-1', type: 'paragraph', text: 'hello' }],
    },
    expectedResult: 'PERMISSION_DENIED',
  },
  {
    id: 3,
    name: 'Cross-user read/write on another user workspace',
    auth: { uid: 'user_b', email_verified: true },
    operation: 'get',
    path: '/users/user_a/notes/n-1',
    parentExists: true,
    expectedResult: 'PERMISSION_DENIED',
  },
  {
    id: 4,
    name: 'OwnerId spoofing inside payload',
    auth: { uid: 'user_a', email_verified: true },
    operation: 'create',
    path: '/users/user_a/notes/n-1',
    parentExists: true,
    payload: {
      id: 'n-1',
      ownerId: 'user_b',
      title: 'Spoofed',
      folder: 'Work',
      updatedAtLabel: 'Created just now',
      pinned: false,
      markdownEnabled: false,
      blocks: [],
    },
    expectedResult: 'PERMISSION_DENIED',
  },
  {
    id: 5,
    name: 'Shadow/ghost field injection on create',
    auth: { uid: 'user_a', email_verified: true },
    operation: 'create',
    path: '/users/user_a/notes/n-1',
    parentExists: true,
    payload: {
      id: 'n-1',
      ownerId: 'user_a',
      title: 'Ghost',
      folder: 'Work',
      updatedAtLabel: 'Created just now',
      pinned: false,
      markdownEnabled: false,
      blocks: [],
      isAdmin: true,
    },
    expectedResult: 'PERMISSION_DENIED',
  },
  {
    id: 6,
    name: 'Shadow/ghost field injection on update',
    auth: { uid: 'user_a', email_verified: true },
    operation: 'update',
    path: '/users/user_a/notes/n-1',
    parentExists: true,
    payload: {
      title: 'Updated',
      ghostField: 'injected',
    },
    expectedResult: 'PERMISSION_DENIED',
  },
  {
    id: 7,
    name: 'Immutable createdAt or ownerId mutation on update',
    auth: { uid: 'user_a', email_verified: true },
    operation: 'update',
    path: '/users/user_a/notes/n-1',
    parentExists: true,
    payload: {
      ownerId: 'user_b',
      createdAt: '2020-01-01T00:00:00.000Z',
    },
    expectedResult: 'PERMISSION_DENIED',
  },
  {
    id: 8,
    name: 'Client-forged timestamp (not request.time)',
    auth: { uid: 'user_a', email_verified: true },
    operation: 'create',
    path: '/users/user_a/notes/n-2',
    parentExists: true,
    payload: {
      id: 'n-2',
      ownerId: 'user_a',
      title: 'Forged time',
      folder: 'Work',
      updatedAtLabel: 'Created just now',
      pinned: false,
      markdownEnabled: false,
      blocks: [],
      createdAt: '1999-01-01T00:00:00.000Z',
      updatedAt: '1999-01-01T00:00:00.000Z',
    },
    expectedResult: 'PERMISSION_DENIED',
  },
  {
    id: 9,
    name: 'ID poisoning with invalid characters or excessive length',
    auth: { uid: 'user_a', email_verified: true },
    operation: 'create',
    path: '/users/user_a/notes/invalid$id..!',
    parentExists: true,
    payload: {
      id: 'invalid$id..!',
      ownerId: 'user_a',
      title: 'Bad ID',
      folder: 'Work',
      updatedAtLabel: 'Created just now',
      pinned: false,
      markdownEnabled: false,
      blocks: [],
    },
    expectedResult: 'PERMISSION_DENIED',
  },
  {
    id: 10,
    name: 'Value poisoning with oversized title (> 300 chars)',
    auth: { uid: 'user_a', email_verified: true },
    operation: 'update',
    path: '/users/user_a/notes/n-1',
    parentExists: true,
    payload: {
      title: 'A'.repeat(5000),
    },
    expectedResult: 'PERMISSION_DENIED',
  },
  {
    id: 11,
    name: 'Array type poisoning on folders preference',
    auth: { uid: 'user_a', email_verified: true },
    operation: 'update',
    path: '/users/user_a/preferences/notes',
    parentExists: true,
    payload: {
      folders: [12345],
    },
    expectedResult: 'PERMISSION_DENIED',
  },
  {
    id: 12,
    name: 'Orphaned subcollection write without parent user doc or invalid prefId',
    auth: { uid: 'user_a', email_verified: true },
    operation: 'create',
    path: '/users/user_a/preferences/arbitrary',
    parentExists: false,
    payload: {
      ownerId: 'user_a',
      folders: ['Work'],
      collapsedFolders: [],
    },
    expectedResult: 'PERMISSION_DENIED',
  },
];
