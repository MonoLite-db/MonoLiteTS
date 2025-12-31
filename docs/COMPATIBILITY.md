# MonoLite TypeScript - MongoDB Compatibility

Created by Yanjunhui

This document describes **MonoLite TypeScript** API compatibility with MongoDB semantics.

- **中文版本**：[`docs/COMPATIBILITY_CN.md`](COMPATIBILITY_CN.md)
- **Back to README**：[`README.md`](../README.md)

---

## Overview

MonoLite TypeScript is an **embedded document database library** that provides MongoDB-compatible APIs for Node.js and TypeScript applications. It is designed for:

- Native TypeScript integration with full type safety
- Async/await API pattern
- Single-file storage with BSON format
- Local/embedded scenarios without network overhead

**Note**: MonoLite TypeScript is a library, not a server. It does not implement MongoDB Wire Protocol. For protocol-level compatibility, see the Go version.

---

## API Compatibility

MonoLite TypeScript provides MongoDB-style APIs through its `Database` and `Collection` classes.

### Database Operations

| Operation | Status | TypeScript API |
|-----------|--------|----------------|
| Open database | ✅ | `Database.open(options)` |
| Close database | ✅ | `database.close()` |
| Flush to disk | ✅ | `database.flush()` |
| Get collection | ✅ | `database.getCollection(name, autoCreate?)` |
| Create collection | ✅ | `database.createCollection(name)` |
| Drop collection | ✅ | `database.dropCollection(name)` |
| List collections | ✅ | `database.listCollections()` |
| Database stats | ✅ | `database.getStats()` |
| Run command | ✅ | `database.runCommand(cmd)` |

### Collection Operations

| Operation | Status | TypeScript API |
|-----------|--------|----------------|
| Insert one | ✅ | `collection.insertOne(doc)` |
| Insert many | ✅ | `collection.insertMany(docs)` |
| Find | ✅ | `collection.find(options)` |
| Find one | ✅ | `collection.findOne(filter, projection?)` |
| Find by ID | ✅ | `collection.findById(id)` |
| Update one | ✅ | `collection.updateOne(filter, update, upsert?)` |
| Update many | ✅ | `collection.updateMany(filter, update)` |
| Delete one | ✅ | `collection.deleteOne(filter)` |
| Delete many | ✅ | `collection.deleteMany(filter)` |
| Replace one | ✅ | `collection.replaceOne(filter, replacement)` |
| Count documents | ✅ | `collection.countDocuments(filter?)` |
| Distinct | ✅ | `collection.distinct(field, filter?)` |
| Create index | ✅ | `collection.createIndex(keys, options?)` |
| Drop index | ✅ | `collection.dropIndex(name)` |
| List indexes | ✅ | `collection.listIndexes()` |

---

## Query Filter Operators

Filters are specified using `BSONDocument` with MongoDB-style operators.

### Comparison Operators

| Operator | Status | Example |
|----------|--------|---------|
| `$eq` | ✅ | `{ age: { $eq: 25 } }` |
| `$ne` | ✅ | `{ status: { $ne: 'inactive' } }` |
| `$gt` | ✅ | `{ age: { $gt: 18 } }` |
| `$gte` | ✅ | `{ age: { $gte: 21 } }` |
| `$lt` | ✅ | `{ price: { $lt: 100 } }` |
| `$lte` | ✅ | `{ score: { $lte: 60 } }` |
| `$in` | ✅ | `{ status: { $in: ['active', 'pending'] } }` |
| `$nin` | ✅ | `{ role: { $nin: ['admin', 'root'] } }` |

### Logical Operators

| Operator | Status | Example |
|----------|--------|---------|
| `$and` | ✅ | `{ $and: [{ age: { $gte: 18 } }, { status: 'active' }] }` |
| `$or` | ✅ | `{ $or: [{ status: 'active' }, { premium: true }] }` |
| `$not` | ✅ | `{ age: { $not: { $lt: 18 } } }` |
| `$nor` | ✅ | `{ $nor: [{ deleted: true }, { banned: true }] }` |

### Element Operators

| Operator | Status | Example |
|----------|--------|---------|
| `$exists` | ✅ | `{ email: { $exists: true } }` |
| `$type` | ✅ | `{ age: { $type: 'int' } }` |

### Array Operators

| Operator | Status | Example |
|----------|--------|---------|
| `$all` | ✅ | `{ tags: { $all: ['js', 'ts'] } }` |
| `$size` | ✅ | `{ items: { $size: 3 } }` |
| `$elemMatch` | ✅ | `{ scores: { $elemMatch: { $gte: 80 } } }` |

### Other Operators

| Operator | Status | Example |
|----------|--------|---------|
| `$regex` | ✅ | `{ email: { $regex: /@gmail\.com$/ } }` |
| `$mod` | ✅ | `{ num: { $mod: [5, 0] } }` |

---

## Update Operators

### Field Operators

| Operator | Status | Example |
|----------|--------|---------|
| `$set` | ✅ | `{ $set: { name: 'Alice', age: 26 } }` |
| `$unset` | ✅ | `{ $unset: { tempField: '' } }` |
| `$inc` | ✅ | `{ $inc: { count: 1, score: 10 } }` |
| `$mul` | ✅ | `{ $mul: { price: 1.1 } }` |
| `$min` | ✅ | `{ $min: { lowScore: 50 } }` |
| `$max` | ✅ | `{ $max: { highScore: 100 } }` |
| `$rename` | ✅ | `{ $rename: { oldName: 'newName' } }` |
| `$currentDate` | ✅ | `{ $currentDate: { lastModified: true } }` |
| `$setOnInsert` | ✅ | `{ $setOnInsert: { createdAt: new Date() } }` |

### Array Operators

| Operator | Status | Example |
|----------|--------|---------|
| `$push` | ✅ | `{ $push: { tags: 'newTag' } }` |
| `$push` + `$each` | ✅ | `{ $push: { tags: { $each: ['a', 'b'] } } }` |
| `$pop` | ✅ | `{ $pop: { items: 1 } }` |
| `$pull` | ✅ | `{ $pull: { tags: 'oldTag' } }` |
| `$pullAll` | ✅ | `{ $pullAll: { tags: ['a', 'b'] } }` |
| `$addToSet` | ✅ | `{ $addToSet: { tags: 'unique' } }` |
| `$addToSet` + `$each` | ✅ | `{ $addToSet: { tags: { $each: ['a', 'b'] } } }` |

---

## Indexes

| Feature | Status | Notes |
|---------|--------|-------|
| B+Tree index | ✅ | Default index structure |
| Single field index | ✅ | `{ email: 1 }` |
| Compound index | ✅ | `{ lastName: 1, firstName: 1 }` |
| Unique index | ✅ | `options: { unique: true }` |
| Descending index | ✅ | `{ createdAt: -1 }` |
| Sparse index | ❌ | Not implemented |
| TTL index | ❌ | Not implemented |
| Text index | ❌ | Not implemented |
| Geospatial index | ❌ | Not implemented |

---

## Aggregation Pipeline

MonoLite TypeScript supports aggregation through `database.runCommand()`.

### Supported Stages

| Stage | Status | Description |
|-------|--------|-------------|
| `$match` | ✅ | Filter documents |
| `$project` | ✅ | Reshape documents |
| `$sort` | ✅ | Sort documents |
| `$limit` | ✅ | Limit results |
| `$skip` | ✅ | Skip documents |
| `$group` | ✅ | Group and aggregate |
| `$count` | ✅ | Count documents |
| `$unwind` | ✅ | Deconstruct array |
| `$addFields` / `$set` | ✅ | Add new fields |
| `$unset` | ✅ | Remove fields |
| `$replaceRoot` | ✅ | Replace root document |
| `$lookup` | ✅ | Left outer join |

### Group Accumulators

| Accumulator | Status |
|-------------|--------|
| `$sum` | ✅ |
| `$avg` | ✅ |
| `$min` | ✅ |
| `$max` | ✅ |
| `$first` | ✅ |
| `$last` | ✅ |
| `$push` | ✅ |
| `$addToSet` | ✅ |

### Not Implemented

| Stage | Status |
|-------|--------|
| `$out` | ❌ |
| `$merge` | ❌ |
| `$facet` | ❌ |
| `$bucket` | ❌ |
| `$graphLookup` | ❌ |
| `$geoNear` | ❌ |

---

## Transactions

MonoLite TypeScript supports single-node transactions through commands:

| Feature | Status | Notes |
|---------|--------|-------|
| Start transaction | ✅ | `runCommand({ startTransaction: 1, ... })` |
| Commit transaction | ✅ | `runCommand({ commitTransaction: 1, ... })` |
| Abort transaction | ✅ | `runCommand({ abortTransaction: 1, ... })` |
| Session management | ✅ | `endSessions`, `refreshSessions` |
| Lock manager | ✅ | Read/write locks |
| Deadlock detection | ✅ | Wait graph analysis |
| Rollback on abort | ✅ | Undo log support |

Limitations:
- Single-node only (no distributed transactions)
- No causal consistency

---

## Database Commands

MonoLite TypeScript supports the following commands via `runCommand()`:

### Diagnostic Commands

| Command | Status |
|---------|--------|
| `ping` | ✅ |
| `hello` / `isMaster` | ✅ |
| `buildInfo` | ✅ |
| `serverStatus` | ✅ |
| `connectionStatus` | ✅ |

### CRUD Commands

| Command | Status |
|---------|--------|
| `insert` | ✅ |
| `find` | ✅ |
| `update` | ✅ |
| `delete` | ✅ |
| `count` | ✅ |
| `distinct` | ✅ |
| `findAndModify` | ✅ |
| `aggregate` | ✅ |

### Collection Commands

| Command | Status |
|---------|--------|
| `create` | ✅ |
| `drop` | ✅ |
| `listCollections` | ✅ |
| `createIndexes` | ✅ |
| `listIndexes` | ✅ |
| `dropIndexes` | ✅ |

### Statistics Commands

| Command | Status |
|---------|--------|
| `dbStats` | ✅ |
| `collStats` | ✅ |
| `validate` | ✅ |
| `explain` | ✅ |

### Cursor Commands

| Command | Status |
|---------|--------|
| `getMore` | ✅ |
| `killCursors` | ✅ |

### Transaction Commands

| Command | Status |
|---------|--------|
| `startTransaction` | ✅ |
| `commitTransaction` | ✅ |
| `abortTransaction` | ✅ |
| `endSessions` | ✅ |
| `refreshSessions` | ✅ |

---

## BSON Types

| Type | Status | TypeScript Type |
|------|--------|-----------------|
| Double | ✅ | `number` |
| String | ✅ | `string` |
| Document | ✅ | `BSONDocument` |
| Array | ✅ | `BSONValue[]` |
| Binary | ✅ | `Binary` |
| ObjectId | ✅ | `ObjectId` |
| Boolean | ✅ | `boolean` |
| Date | ✅ | `Date` |
| Null | ✅ | `null` |
| Int32 | ✅ | `number` |
| Int64 | ✅ | `bigint` |
| Timestamp | ✅ | `Timestamp` |
| Decimal128 | ❌ | Not supported |
| MinKey/MaxKey | ❌ | Not supported |
| JavaScript | ❌ | Not supported |

---

## Concurrency Model

MonoLite TypeScript uses **async/await** with internal mutex for thread safety:

```typescript
// All operations return Promises
const db = await Database.open({ filePath: 'data.monodb' });
const users = await db.getCollection('users', true);
const result = await users.insertOne({ name: 'Alice' });
await db.close();
```

Features:
- **Non-blocking**: All I/O operations are async
- **Type-safe**: Full TypeScript type definitions
- **Atomic writes**: Internal write queue ensures consistency

---

## Feature Comparison with MongoDB

| Feature | MongoDB | MonoLite TypeScript |
|---------|---------|---------------------|
| Network server | ✅ | ❌ (embedded) |
| Replica sets | ✅ | ❌ |
| Sharding | ✅ | ❌ |
| Authentication | ✅ | ❌ |
| Wire protocol | ✅ | ❌ |
| Single-file storage | ❌ | ✅ |
| Zero configuration | ❌ | ✅ |
| Full TypeScript types | ❌ | ✅ |
| Browser support | ❌ | 🚧 |

---

## Platform Support

| Platform | Status |
|----------|--------|
| Node.js 18+ | ✅ |
| Node.js 20+ | ✅ |
| Bun | 🚧 |
| Deno | 🚧 |
| Browser | ❌ |

---

## Reporting Issues

When reporting compatibility issues, include:

- Node.js/TypeScript version
- Code snippet that reproduces the issue
- Expected behavior (MongoDB) vs actual behavior (MonoLite)
- Stack trace if applicable
