# MonoLite

MonoLite is a **single-file, embeddable document database** for TypeScript/JavaScript, compatible with MongoDB Wire Protocol. A pure TypeScript implementation for Node.js and Bun.

<div align="center">

![TypeScript](https://img.shields.io/badge/TypeScript-5.3+-3178C6?style=flat&logo=typescript)
![Node.js](https://img.shields.io/badge/Node.js-18+-339933?style=flat&logo=node.js)
![MongoDB Compatible](https://img.shields.io/badge/MongoDB-Wire%20Protocol-47A248?style=flat&logo=mongodb)
![License](https://img.shields.io/badge/License-MIT-blue?style=flat)

**[README (EN)](README.md)** · **[README (中文)](README_CN.md)**

</div>

## Project Vision

> **Simple as SQLite, yet think and work the MongoDB way.**

- **Single-File Storage** — One `.monodb` file is the complete database
- **Zero Dependencies** — Only relies on official MongoDB BSON library
- **Async/Await Native** — Built for modern JavaScript with full async support
- **Embedded-First** — Library-first design, embed directly into your Node.js/Bun application
- **MongoDB Driver Compatible** — Use familiar APIs and tools via Wire Protocol

## Why MonoLite? The Pain Points We Solve

### The SQLite Dilemma

SQLite is an excellent embedded database, but when your JavaScript/TypeScript application deals with **document-oriented data**, you'll encounter these frustrations:

| Pain Point | SQLite Reality | MonoLite Solution |
|------------|----------------|---------------------|
| **Rigid Schema** | Must define tables upfront with `CREATE TABLE`, schema changes require migrations | Schema-free — documents can have different fields, evolve naturally |
| **Nested Data** | Requires JSON1 extension or serialization, clunky to query | Native nested documents with dot notation (`address.city`) |
| **Array Operations** | No native array type, must serialize or use junction tables | Native arrays with operators like `$push`, `$pull`, `$elemMatch` |
| **Object-Relational Mismatch** | JavaScript objects ↔ relational tables require ORM mapping | Documents ARE JavaScript objects — zero impedance mismatch |
| **Query Complexity** | Complex JOINs for hierarchical data, verbose SQL | Intuitive query operators (`$gt`, `$in`, `$or`) and aggregation pipelines |
| **Learning Curve** | SQL syntax, different from JavaScript paradigms | MongoDB query language is JavaScript-native |

### When to Choose MonoLite over SQLite

✅ **Choose MonoLite when:**
- Your data is naturally hierarchical or document-shaped (JSON-like)
- Documents have varying structures (optional fields, evolving schemas)
- You need powerful array operations
- You want to work with JavaScript objects directly — no ORM needed
- Your team already knows MongoDB
- You want to prototype with MongoDB compatibility, then scale to real MongoDB later

✅ **Stick with SQLite when:**
- Your data is highly relational with many-to-many relationships
- You need complex multi-table JOINs
- You require strict schema enforcement
- You're working with existing SQL-based tooling (Prisma, Drizzle with SQL)

### MonoLite vs SQLite: Feature Comparison

| Feature | MonoLite | SQLite |
|---------|------------|--------|
| **Data Model** | Document (BSON) | Relational (Tables) |
| **Schema** | Flexible, schema-free | Fixed, requires migrations |
| **Nested Data** | Native support | JSON1 extension |
| **Arrays** | Native with operators | Serialization required |
| **Query Language** | MongoDB Query Language | SQL |
| **JavaScript Objects** | Direct mapping | ORM required |
| **Transactions** | ✅ Multi-document ACID | ✅ ACID |
| **Indexes** | B+Tree (single, compound, unique) | B-Tree (various types) |
| **File Format** | Single `.monodb` file | Single `.db` file |
| **Crash Recovery** | WAL | WAL/Rollback Journal |
| **Maturity** | New | 20+ years battle-tested |

## Quick Start

### Installation

```bash
npm install monolite
# or
yarn add monolite
# or
pnpm add monolite
```

### Basic Usage (Library API)

```typescript
import { Database } from 'monolite';

// Open database
const db = await Database.open('data.monodb');

// Get collection
const users = await db.collection('users');

// Insert documents
await users.insertOne({
  name: 'Alice',
  age: 25,
  email: 'alice@example.com'
});

// Insert multiple documents
await users.insertMany([
  { name: 'Bob', age: 30, tags: ['dev', 'typescript'] },
  { name: 'Carol', age: 28, address: { city: 'Beijing' } }
]);

// Query documents
const results = await users.find({ age: { $gt: 20 } });
for (const doc of results) {
  console.log(doc);
}

// Find one document
const alice = await users.findOne({ name: 'Alice' });
if (alice) {
  console.log('Found:', alice);
}

// Update documents
await users.updateOne(
  { name: 'Alice' },
  { $set: { age: 26 } }
);

// Delete documents
await users.deleteOne({ name: 'Alice' });

// Close database
await db.close();
```

### Wire Protocol Server

```typescript
import { Database, WireServer } from 'monolite';

// Start MongoDB-compatible server
const db = await Database.open('data.monodb');
const server = new WireServer(db, 27017);
await server.start();

// Now connect with mongosh:
// mongosh mongodb://localhost:27017
```

### Using Transactions

```typescript
// Start a transaction
const session = await db.startSession();
await session.startTransaction();

try {
  const users = await db.collection('users');
  const accounts = await db.collection('accounts');

  // Transfer operation
  await users.updateOne(
    { name: 'Alice' },
    { $inc: { balance: -100 } },
    { session }
  );
  await users.updateOne(
    { name: 'Bob' },
    { $inc: { balance: 100 } },
    { session }
  );

  await session.commitTransaction();
} catch (error) {
  await session.abortTransaction();
  throw error;
}
```

### Aggregation Pipeline

```typescript
const orders = await db.collection('orders');

const results = await orders.aggregate([
  { $match: { status: 'completed' } },
  { $group: {
    _id: '$customerId',
    total: { $sum: '$amount' }
  }},
  { $sort: { total: -1 } },
  { $limit: 10 }
]);
```

### Index Management

```typescript
const users = await db.collection('users');

// Create unique index
await users.createIndex(
  { email: 1 },
  { unique: true }
);

// Create compound index
await users.createIndex({ name: 1, age: -1 });

// List indexes
const indexes = await users.listIndexes();

// Drop index
await users.dropIndex('email_1');
```

## Core Features

### Async/Await Native

- **Promise-Based** — All operations return Promises
- **Non-Blocking** — Efficient I/O with Node.js event loop
- **TypeScript First** — Full type definitions included

### Crash Consistency (WAL)

- **Write-Ahead Logging** — All writes are logged to WAL before being written to data files
- **Automatic Crash Recovery** — WAL replay on startup restores to a consistent state
- **Checkpoint Mechanism** — Periodic checkpoints accelerate recovery and control WAL size
- **Atomic Writes** — Guarantees atomicity of individual write operations

### Full Transaction Support

- **Multi-Document Transactions** — Support for transactions spanning multiple collections
- **Transaction API** — startTransaction / commitTransaction / abortTransaction
- **Lock Management** — Document-level and collection-level lock granularity
- **Deadlock Detection** — Wait-graph based deadlock detection with automatic transaction abort
- **Transaction Rollback** — Complete Undo Log support for transaction rollback

### B+Tree Indexes

- **Efficient Lookup** — O(log n) lookup complexity
- **Multiple Index Types** — Single-field, compound, and unique indexes
- **Dot Notation Support** — Support for nested field indexes (e.g., `address.city`)
- **Leaf Node Linked List** — Efficient range queries and sorting

### Resource Limits & Security

| Limit | Value |
|-------|-------|
| Maximum document size | 16 MB |
| Maximum nesting depth | 100 levels |
| Maximum indexes per collection | 64 |
| Maximum batch write | 100,000 documents |
| Maximum field name length | 1,024 characters |

## Feature Support Status

### Supported Core Features

| Category | Supported |
|----------|-----------|
| **CRUD** | insert, find, update, delete, findAndModify, replaceOne, distinct |
| **Query Operators** | $eq, $ne, $gt, $gte, $lt, $lte, $in, $nin, $and, $or, $not, $nor, $exists, $type, $all, $elemMatch, $size, $regex |
| **Update Operators** | $set, $unset, $inc, $min, $max, $mul, $rename, $push, $pop, $pull, $pullAll, $addToSet, $setOnInsert |
| **Aggregation Stages** | $match, $project, $sort, $limit, $skip, $group, $count, $unwind, $addFields, $set, $unset, $lookup, $replaceRoot |
| **$group Accumulators** | $sum, $avg, $min, $max, $count, $push, $addToSet, $first, $last |
| **Indexes** | Single-field, compound, unique indexes, dot notation (nested fields) |
| **Cursors** | getMore, killCursors, batchSize |
| **Commands** | dbStats, collStats, listCollections, listIndexes, serverStatus, validate, explain |
| **Transactions** | startTransaction, commitTransaction, abortTransaction |

### Query Operators Details

| Category | Operators |
|----------|-----------|
| Comparison | `$eq` `$ne` `$gt` `$gte` `$lt` `$lte` `$in` `$nin` |
| Logical | `$and` `$or` `$not` `$nor` |
| Element | `$exists` `$type` |
| Array | `$all` `$elemMatch` `$size` |
| Evaluation | `$regex` |

### Update Operators Details

| Category | Operators |
|----------|-----------|
| Field | `$set` `$unset` `$inc` `$min` `$max` `$mul` `$rename` `$setOnInsert` |
| Array | `$push` `$pop` `$pull` `$pullAll` `$addToSet` |

### Aggregation Pipeline Stages Details

| Stage | Description |
|-------|-------------|
| `$match` | Document filtering (supports all query operators) |
| `$project` | Field projection (include/exclude mode) |
| `$sort` | Sorting (supports compound sorting) |
| `$limit` | Limit result count |
| `$skip` | Skip specified count |
| `$group` | Group aggregation (supports 9 accumulators) |
| `$count` | Document count |
| `$unwind` | Array expansion (supports preserveNullAndEmptyArrays) |
| `$addFields` / `$set` | Add/set fields |
| `$unset` | Remove fields |
| `$lookup` | Collection join (left outer join) |
| `$replaceRoot` | Replace root document |

### Unsupported Features (Non-Goals)

- Replica Sets / Sharding (distributed)
- Authentication & Authorization
- Change Streams
- Geospatial Features
- Full-Text Search
- GridFS

## Storage Engine Architecture

```
┌────────────────────────────────────────────────────────────────┐
│                      Wire Protocol                              │
│              (OP_MSG / OP_QUERY / OP_REPLY)                    │
├────────────────────────────────────────────────────────────────┤
│                      Query Engine                               │
│        ┌─────────────┬─────────────┬─────────────┐             │
│        │   Parser    │  Executor   │  Optimizer  │             │
│        │  (BSON)     │  (Pipeline) │  (Index)    │             │
│        └─────────────┴─────────────┴─────────────┘             │
├────────────────────────────────────────────────────────────────┤
│                   Transaction Manager                           │
│        ┌─────────────┬─────────────┬─────────────┐             │
│        │    Lock     │  Deadlock   │    Undo     │             │
│        │   Manager   │  Detector   │    Log      │             │
│        └─────────────┴─────────────┴─────────────┘             │
├────────────────────────────────────────────────────────────────┤
│                     Storage Engine                              │
│   ┌──────────────┐  ┌──────────────┐  ┌──────────────┐        │
│   │   B+Tree     │  │    Pager     │  │     WAL      │        │
│   │   Index      │  │    Cache     │  │   Recovery   │        │
│   └──────────────┘  └──────────────┘  └──────────────┘        │
├────────────────────────────────────────────────────────────────┤
│                       Single File                               │
│                     (.monodb file)                              │
└────────────────────────────────────────────────────────────────┘
```

## Project Structure

```
MonoLiteTS/
├── package.json              # NPM configuration
├── tsconfig.json             # TypeScript configuration
├── src/
│   ├── index.ts              # Main exports
│   │
│   ├── bson/                 # BSON encoding/decoding (uses official lib)
│   │   ├── types.ts          # Re-exported BSON types
│   │   ├── encoder.ts        # BSON serialization
│   │   ├── decoder.ts        # BSON deserialization
│   │   └── compare.ts        # Value comparison (MongoDB standard)
│   │
│   ├── engine/               # Database engine
│   │   ├── database.ts       # Database core
│   │   ├── collection.ts     # Collection operations (CRUD)
│   │   ├── commands.ts       # Command handlers
│   │   ├── index.ts          # Index management
│   │   ├── aggregate.ts      # Aggregation pipeline
│   │   ├── cursor.ts         # Cursor management
│   │   └── explain.ts        # Query plan explanation
│   │
│   ├── transaction/          # Transaction management
│   │   ├── transaction.ts    # Transaction state
│   │   ├── manager.ts        # Transaction coordination
│   │   ├── lock.ts           # Lock management & deadlock detection
│   │   └── session.ts        # Session management
│   │
│   ├── storage/              # Storage engine
│   │   ├── pager.ts          # Page manager (caching, read/write)
│   │   ├── page.ts           # Page structure
│   │   ├── slotted.ts        # Slotted page for documents
│   │   ├── btree.ts          # B+Tree implementation
│   │   ├── wal.ts            # Write-Ahead Log
│   │   ├── keystring.ts      # Index key encoding
│   │   └── header.ts         # File header structure
│   │
│   ├── protocol/             # MongoDB Wire Protocol
│   │   ├── server.ts         # TCP server
│   │   ├── message.ts        # Message parsing
│   │   ├── opmsg.ts          # OP_MSG handling
│   │   └── opquery.ts        # OP_QUERY handling
│   │
│   └── core/                 # Core utilities
│       ├── errors.ts         # Error types & codes
│       ├── limits.ts         # Resource limits
│       ├── validation.ts     # Document validation
│       └── logger.ts         # Structured logging
│
└── tests/                    # Unit tests
```

## Technical Specifications

| Item | Specification |
|------|---------------|
| Maximum document size | 16 MB |
| Maximum nesting depth | 100 levels |
| Maximum indexes per collection | 64 |
| Maximum batch write | 100,000 documents |
| Page size | 4 KB |
| Default cursor batch size | 101 documents |
| Cursor timeout | 10 minutes |
| Transaction lock timeout | 30 seconds |
| WAL format version | 1 |
| File format version | 1 |
| Wire Protocol version | 13 (MongoDB 5.0) |

## Cross-Language Compatibility

MonoLiteTS is part of the MonoLite family, with identical implementations in:

| Language | Repository | Status |
|----------|------------|--------|
| Go | MonoLite | Reference Implementation |
| Swift | MonoLiteSwift | Actor-based Swift Port |
| TypeScript | MonoLiteTS | Node.js/Bun Implementation |

All three implementations:
- Share the same `.monodb` file format
- Pass identical consistency tests (33/33 tests, 100%)
- Support the same query/update operators
- Compatible with MongoDB Wire Protocol

## Requirements

- Node.js 18+ or Bun
- TypeScript 5.3+ (for development)

## Development

```bash
# Install dependencies
npm install

# Build
npm run build

# Run tests
npm test

# Watch mode
npm run watch
```

## License

MIT License

---

<div align="center">

**[README (EN)](README.md)** · **[README (中文)](README_CN.md)**

</div>
