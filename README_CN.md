# MonoLite

MonoLite 是一个**单文件、可嵌入的文档数据库**，专为 TypeScript/JavaScript 设计，兼容 MongoDB Wire Protocol。纯 TypeScript 实现，支持 Node.js 和 Bun。

<div align="center">

![TypeScript](https://img.shields.io/badge/TypeScript-5.3+-3178C6?style=flat&logo=typescript)
![Node.js](https://img.shields.io/badge/Node.js-18+-339933?style=flat&logo=node.js)
![MongoDB Compatible](https://img.shields.io/badge/MongoDB-Wire%20Protocol-47A248?style=flat&logo=mongodb)
![License](https://img.shields.io/badge/License-MIT-blue?style=flat)

**[README (EN)](README.md)** · **[README (中文)](README_CN.md)**

</div>

## 项目愿景

> **像 SQLite 一样简单，像 MongoDB 一样思考和工作。**

- **单文件存储** — 一个 `.monodb` 文件即为完整数据库
- **零依赖** — 仅依赖官方 MongoDB BSON 库
- **原生 Async/Await** — 为现代 JavaScript 构建，完整异步支持
- **嵌入优先** — 库优先设计，直接嵌入到 Node.js/Bun 应用中
- **MongoDB 驱动兼容** — 通过 Wire Protocol 支持标准 MongoDB 驱动和工具

## 为什么选择 MonoLite？我们解决的痛点

### SQLite 的困境

SQLite 是一个优秀的嵌入式数据库，但当你的 JavaScript/TypeScript 应用处理**文档型数据**时，会遇到这些困扰：

| 痛点 | SQLite 现状 | MonoLite 方案 |
|------|-------------|-----------------|
| **僵化的 Schema** | 必须用 `CREATE TABLE` 预定义表结构，修改需要迁移 | Schema-free — 文档可以有不同字段，自然演进 |
| **嵌套数据** | 需要 JSON1 扩展或序列化，查询笨拙 | 原生嵌套文档，支持点号路径查询（`address.city`） |
| **数组操作** | 无原生数组类型，需序列化或使用关联表 | 原生数组，支持 `$push`、`$pull`、`$elemMatch` 等操作符 |
| **对象-关系阻抗不匹配** | JavaScript 对象 ↔ 关系表需要 ORM 映射 | 文档就是 JavaScript 对象 — 零阻抗不匹配 |
| **查询复杂性** | 层级数据需要复杂 JOIN，SQL 冗长 | 直观的查询操作符（`$gt`、`$in`、`$or`）和聚合管道 |
| **学习曲线** | SQL 语法，与 JavaScript 范式不同 | MongoDB 查询语言是 JavaScript 原生的 |

### 何时选择 MonoLite 而非 SQLite

✅ **选择 MonoLite 当：**
- 你的数据天然是层级或文档形态（类 JSON）
- 文档结构多变（可选字段、演进中的 Schema）
- 你需要强大的数组操作
- 你想直接使用 JavaScript 对象 — 无需 ORM
- 你的团队已经熟悉 MongoDB
- 你想用 MongoDB 兼容的方式原型开发，未来可迁移到真正的 MongoDB

✅ **继续使用 SQLite 当：**
- 你的数据高度关系化，有大量多对多关系
- 你需要复杂的多表 JOIN
- 你需要严格的 Schema 约束
- 你使用现有的 SQL 工具链（Prisma、Drizzle 配合 SQL）

### MonoLite vs SQLite：功能对比

| 特性 | MonoLite | SQLite |
|------|------------|--------|
| **数据模型** | 文档（BSON） | 关系型（表） |
| **Schema** | 灵活，无 Schema 约束 | 固定，需要迁移 |
| **嵌套数据** | 原生支持 | JSON1 扩展 |
| **数组** | 原生支持，丰富操作符 | 需要序列化 |
| **查询语言** | MongoDB 查询语言 | SQL |
| **JavaScript 对象** | 直接映射 | 需要 ORM |
| **事务** | ✅ 多文档 ACID | ✅ ACID |
| **索引** | B+Tree（单字段、复合、唯一） | B-Tree（多种类型） |
| **文件格式** | 单个 `.monodb` 文件 | 单个 `.db` 文件 |
| **崩溃恢复** | WAL | WAL/回滚日志 |
| **成熟度** | 新项目 | 20+ 年久经考验 |

## 快速开始

### 安装

```bash
npm install monolite
# 或
yarn add monolite
# 或
pnpm add monolite
```

### 基本使用（库 API）

```typescript
import { Database } from 'monolite';

// 打开数据库
const db = await Database.open('data.monodb');

// 获取集合
const users = await db.collection('users');

// 插入文档
await users.insertOne({
  name: 'Alice',
  age: 25,
  email: 'alice@example.com'
});

// 批量插入
await users.insertMany([
  { name: 'Bob', age: 30, tags: ['dev', 'typescript'] },
  { name: 'Carol', age: 28, address: { city: 'Beijing' } }
]);

// 查询文档
const results = await users.find({ age: { $gt: 20 } });
for (const doc of results) {
  console.log(doc);
}

// 查找单个文档
const alice = await users.findOne({ name: 'Alice' });
if (alice) {
  console.log('找到:', alice);
}

// 更新文档
await users.updateOne(
  { name: 'Alice' },
  { $set: { age: 26 } }
);

// 删除文档
await users.deleteOne({ name: 'Alice' });

// 关闭数据库
await db.close();
```

### Wire Protocol 服务器

```typescript
import { Database, WireServer } from 'monolite';

// 启动 MongoDB 兼容服务器
const db = await Database.open('data.monodb');
const server = new WireServer(db, 27017);
await server.start();

// 现在可以用 mongosh 连接：
// mongosh mongodb://localhost:27017
```

### 使用事务

```typescript
// 开启事务
const session = await db.startSession();
await session.startTransaction();

try {
  const users = await db.collection('users');
  const accounts = await db.collection('accounts');

  // 转账操作
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

### 聚合管道

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

### 索引管理

```typescript
const users = await db.collection('users');

// 创建唯一索引
await users.createIndex(
  { email: 1 },
  { unique: true }
);

// 创建复合索引
await users.createIndex({ name: 1, age: -1 });

// 列出索引
const indexes = await users.listIndexes();

// 删除索引
await users.dropIndex('email_1');
```

## 核心特性

### 原生 Async/Await

- **基于 Promise** — 所有操作返回 Promise
- **非阻塞** — 高效利用 Node.js 事件循环
- **TypeScript 优先** — 完整的类型定义

### 崩溃一致性（WAL）

- **预写日志** — 所有写操作在写入数据文件前先写入 WAL
- **自动崩溃恢复** — 启动时 WAL 重放，恢复到一致状态
- **检查点机制** — 定期检查点加速恢复并控制 WAL 大小
- **原子写入** — 保证单个写操作的原子性

### 完整事务支持

- **多文档事务** — 支持跨多个集合的事务
- **事务 API** — startTransaction / commitTransaction / abortTransaction
- **锁管理** — 文档级和集合级锁粒度
- **死锁检测** — 基于等待图的死锁检测，自动中止事务
- **事务回滚** — 完整的 Undo Log 支持事务回滚

### B+Tree 索引

- **高效查找** — O(log n) 查找复杂度
- **多种索引类型** — 单字段、复合、唯一索引
- **点号标记支持** — 支持嵌套字段索引（如 `address.city`）
- **叶节点链表** — 高效的范围查询和排序

### 资源限制与安全

| 限制项 | 值 |
|--------|-----|
| 最大文档大小 | 16 MB |
| 最大嵌套深度 | 100 层 |
| 每集合最大索引数 | 64 |
| 最大批量写入 | 100,000 文档 |
| 最大字段名长度 | 1,024 字符 |

## 功能支持状态

### 已支持的核心功能

| 分类 | 支持 |
|------|------|
| **CRUD** | insert, find, update, delete, findAndModify, replaceOne, distinct |
| **查询操作符** | $eq, $ne, $gt, $gte, $lt, $lte, $in, $nin, $and, $or, $not, $nor, $exists, $type, $all, $elemMatch, $size, $regex |
| **更新操作符** | $set, $unset, $inc, $min, $max, $mul, $rename, $push, $pop, $pull, $pullAll, $addToSet, $setOnInsert |
| **聚合阶段** | $match, $project, $sort, $limit, $skip, $group, $count, $unwind, $addFields, $set, $unset, $lookup, $replaceRoot |
| **$group 累加器** | $sum, $avg, $min, $max, $count, $push, $addToSet, $first, $last |
| **索引** | 单字段、复合、唯一索引，点号标记（嵌套字段） |
| **游标** | getMore, killCursors, batchSize |
| **命令** | dbStats, collStats, listCollections, listIndexes, serverStatus, validate, explain |
| **事务** | startTransaction, commitTransaction, abortTransaction |

### 查询操作符详情

| 分类 | 操作符 |
|------|--------|
| 比较 | `$eq` `$ne` `$gt` `$gte` `$lt` `$lte` `$in` `$nin` |
| 逻辑 | `$and` `$or` `$not` `$nor` |
| 元素 | `$exists` `$type` |
| 数组 | `$all` `$elemMatch` `$size` |
| 求值 | `$regex` |

### 更新操作符详情

| 分类 | 操作符 |
|------|--------|
| 字段 | `$set` `$unset` `$inc` `$min` `$max` `$mul` `$rename` `$setOnInsert` |
| 数组 | `$push` `$pop` `$pull` `$pullAll` `$addToSet` |

### 聚合管道阶段详情

| 阶段 | 描述 |
|------|------|
| `$match` | 文档过滤（支持所有查询操作符） |
| `$project` | 字段投影（包含/排除模式） |
| `$sort` | 排序（支持复合排序） |
| `$limit` | 限制结果数量 |
| `$skip` | 跳过指定数量 |
| `$group` | 分组聚合（支持 9 种累加器） |
| `$count` | 文档计数 |
| `$unwind` | 数组展开（支持 preserveNullAndEmptyArrays） |
| `$addFields` / `$set` | 添加/设置字段 |
| `$unset` | 移除字段 |
| `$lookup` | 集合关联（左外连接） |
| `$replaceRoot` | 替换根文档 |

### 不支持的功能（非目标）

- 副本集 / 分片（分布式）
- 认证与授权
- Change Streams
- 地理空间功能
- 全文搜索
- GridFS

## 存储引擎架构

```
┌────────────────────────────────────────────────────────────────┐
│                      Wire Protocol                              │
│              (OP_MSG / OP_QUERY / OP_REPLY)                    │
├────────────────────────────────────────────────────────────────┤
│                        查询引擎                                  │
│        ┌─────────────┬─────────────┬─────────────┐             │
│        │   解析器    │   执行器    │   优化器    │             │
│        │  (BSON)     │  (Pipeline) │  (Index)    │             │
│        └─────────────┴─────────────┴─────────────┘             │
├────────────────────────────────────────────────────────────────┤
│                       事务管理器                                 │
│        ┌─────────────┬─────────────┬─────────────┐             │
│        │    锁       │   死锁      │    Undo     │             │
│        │   管理器    │   检测器    │    Log      │             │
│        └─────────────┴─────────────┴─────────────┘             │
├────────────────────────────────────────────────────────────────┤
│                       存储引擎                                   │
│   ┌──────────────┐  ┌──────────────┐  ┌──────────────┐        │
│   │   B+Tree     │  │    Pager     │  │     WAL      │        │
│   │   索引       │  │    缓存      │  │    恢复      │        │
│   └──────────────┘  └──────────────┘  └──────────────┘        │
├────────────────────────────────────────────────────────────────┤
│                        单文件                                    │
│                    (.monodb 文件)                                │
└────────────────────────────────────────────────────────────────┘
```

## 项目结构

```
MonoLiteTS/
├── package.json              # NPM 配置
├── tsconfig.json             # TypeScript 配置
├── src/
│   ├── index.ts              # 主导出
│   │
│   ├── bson/                 # BSON 编解码（使用官方库）
│   │   ├── types.ts          # 重导出 BSON 类型
│   │   ├── encoder.ts        # BSON 序列化
│   │   ├── decoder.ts        # BSON 反序列化
│   │   └── compare.ts        # 值比较（MongoDB 标准）
│   │
│   ├── engine/               # 数据库引擎
│   │   ├── database.ts       # 数据库核心
│   │   ├── collection.ts     # 集合操作（CRUD）
│   │   ├── commands.ts       # 命令处理器
│   │   ├── index.ts          # 索引管理
│   │   ├── aggregate.ts      # 聚合管道
│   │   ├── cursor.ts         # 游标管理
│   │   └── explain.ts        # 查询计划解释
│   │
│   ├── transaction/          # 事务管理
│   │   ├── transaction.ts    # 事务状态
│   │   ├── manager.ts        # 事务协调
│   │   ├── lock.ts           # 锁管理与死锁检测
│   │   └── session.ts        # 会话管理
│   │
│   ├── storage/              # 存储引擎
│   │   ├── pager.ts          # 页面管理器（缓存、读写）
│   │   ├── page.ts           # 页面结构
│   │   ├── slotted.ts        # 槽页面（存储文档）
│   │   ├── btree.ts          # B+Tree 实现
│   │   ├── wal.ts            # 预写日志
│   │   ├── keystring.ts      # 索引键编码
│   │   └── header.ts         # 文件头结构
│   │
│   ├── protocol/             # MongoDB Wire Protocol
│   │   ├── server.ts         # TCP 服务器
│   │   ├── message.ts        # 消息解析
│   │   ├── opmsg.ts          # OP_MSG 处理
│   │   └── opquery.ts        # OP_QUERY 处理
│   │
│   └── core/                 # 核心工具
│       ├── errors.ts         # 错误类型与错误码
│       ├── limits.ts         # 资源限制
│       ├── validation.ts     # 文档验证
│       └── logger.ts         # 结构化日志
│
└── tests/                    # 单元测试
```

## 技术规格

| 项目 | 规格 |
|------|------|
| 最大文档大小 | 16 MB |
| 最大嵌套深度 | 100 层 |
| 每集合最大索引数 | 64 |
| 最大批量写入 | 100,000 文档 |
| 页面大小 | 4 KB |
| 默认游标批量大小 | 101 文档 |
| 游标超时 | 10 分钟 |
| 事务锁超时 | 30 秒 |
| WAL 格式版本 | 1 |
| 文件格式版本 | 1 |
| Wire Protocol 版本 | 13 (MongoDB 5.0) |

## 跨语言兼容性

MonoLiteTS 是 MonoLite 家族的一部分，拥有以下相同实现：

| 语言 | 仓库 | 状态 |
|------|------|------|
| Go | MonoLite | 参考实现 |
| Swift | MonoLiteSwift | Actor 化 Swift 移植 |
| TypeScript | MonoLiteTS | Node.js/Bun 实现 |

三种实现：
- 共享相同的 `.monodb` 文件格式
- 通过相同的一致性测试（33/33 测试，100%）
- 支持相同的查询/更新操作符
- 兼容 MongoDB Wire Protocol

## 系统要求

- Node.js 18+ 或 Bun
- TypeScript 5.3+（开发时）

## 开发

```bash
# 安装依赖
npm install

# 构建
npm run build

# 运行测试
npm test

# 监听模式
npm run watch
```

## 许可证

MIT License

---

<div align="center">

**[README (EN)](README.md)** · **[README (中文)](README_CN.md)**

</div>
