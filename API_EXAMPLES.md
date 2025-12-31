# MonoLite TypeScript API 完整示例

Created by Yanjunhui

本文档提供 MonoLite TypeScript 版本的完整 API 使用示例，便于开发者和大模型理解调用方式。

## 目录

- [数据库操作](#数据库操作)
- [集合操作](#集合操作)
- [文档 CRUD](#文档-crud)
- [查询操作符](#查询操作符)
- [更新操作符](#更新操作符)
- [聚合管道](#聚合管道)
- [索引管理](#索引管理)
- [事务操作](#事务操作)
- [游标操作](#游标操作)
- [数据库命令](#数据库命令)

---

## 数据库操作

### 打开数据库

```typescript
import { Database, ObjectId } from 'monolite-ts';

// 打开或创建数据库
const db = await Database.open({
    filePath: 'data.monodb',
    cacheSize: 1000  // 可选：缓存页数
});

// 使用完毕后关闭
await db.close();
```

### 获取数据库信息

```typescript
// 获取数据库文件路径
const path = db.getFilePath();

// 获取数据库统计信息
const stats = await db.getStats();
console.log(`Collections: ${stats.collections}`);
console.log(`Documents: ${stats.documents}`);
console.log(`Data Size: ${stats.dataSize} bytes`);
console.log(`Storage Size: ${stats.storageSize}`);
console.log(`Indexes: ${stats.indexes}`);

// 刷新数据到磁盘
await db.flush();

// 关闭数据库
await db.close();
```

### 集合管理

```typescript
// 获取集合（不存在则返回 null）
const users = await db.getCollection('users');

// 获取或创建集合（autoCreate = true）
const users = await db.getCollection('users', true);

// 创建新集合
const orders = await db.createCollection('orders');

// 列出所有集合
const collections = db.listCollections();
for (const name of collections) {
    console.log(name);
}

// 删除集合
const dropped = await db.dropCollection('users');
```

---

## 集合操作

### 基本信息

```typescript
const users = await db.getCollection('users', true);

// 获取集合名称
const name = users.name;

// 获取集合信息
const info = users.getInfo();
console.log(`Document count: ${info.documentCount}`);
console.log(`Created at: ${info.createdAt}`);
console.log(`Updated at: ${info.updatedAt}`);
```

---

## 文档 CRUD

### 插入文档

```typescript
const users = await db.getCollection('users', true);

// 插入单个文档
const result = await users.insertOne({
    name: 'Alice',
    age: 25,
    email: 'alice@example.com'
});
console.log('Inserted ID:', result.insertedId);

// 插入多个文档
const manyResult = await users.insertMany([
    {
        name: 'Bob',
        age: 30,
        tags: ['developer', 'typescript']
    },
    {
        name: 'Carol',
        age: 28,
        address: {
            city: 'Beijing',
            country: 'China'
        }
    }
]);
console.log(`Inserted ${manyResult.insertedCount} documents`);
console.log('Inserted IDs:', manyResult.insertedIds);

// 插入带自定义 _id 的文档
const customResult = await users.insertOne({
    _id: 'user_001',
    name: 'David'
});
```

### 查询文档

```typescript
// 查询所有文档
const allDocs = await users.find({});

// 按条件查询
const docs = await users.find({
    filter: { age: { $gt: 20 } }
});

// 查询单个文档
const doc = await users.findOne({ name: 'Alice' });

// 按 _id 查询
const docById = await users.findById(new ObjectId('507f1f77bcf86cd799439011'));
// 或使用字符串 _id
const docByStrId = await users.findById('user_001');

// 带投影查询
const projectedDocs = await users.find({
    filter: { age: { $gte: 25 } },
    projection: { name: 1, age: 1, _id: 0 }
});

// 带排序、跳过和限制
const paginatedDocs = await users.find({
    filter: {},
    sort: { age: -1 },      // 降序
    skip: 10,               // 跳过前 10 条
    limit: 20               // 最多返回 20 条
});
```

### 更新文档

```typescript
// 更新单个文档
const updateResult = await users.updateOne(
    { name: 'Alice' },           // 过滤条件
    { $set: { age: 26 } }        // 更新操作
);
console.log(`Matched: ${updateResult.matchedCount}`);
console.log(`Modified: ${updateResult.modifiedCount}`);

// 更新多个文档
const updateManyResult = await users.updateMany(
    { age: { $lt: 30 } },        // 过滤条件
    { $inc: { age: 1 } }         // 所有年龄 +1
);
console.log(`Modified ${updateManyResult.modifiedCount} documents`);

// Upsert（不存在则插入）
const upsertResult = await users.updateOne(
    { name: 'Eve' },
    { $set: { name: 'Eve', age: 22 } },
    true  // upsert = true
);
if (upsertResult.upsertedId) {
    console.log('Inserted new document:', upsertResult.upsertedId);
}

// 替换整个文档
const replaceResult = await users.replaceOne(
    { name: 'Alice' },
    { name: 'Alice Updated', age: 27, status: 'active' }
);
```

### 删除文档

```typescript
// 删除单个文档
const deleteResult = await users.deleteOne({ name: 'Bob' });
console.log(`Deleted: ${deleteResult.deletedCount}`);

// 删除多个文档
const deleteManyResult = await users.deleteMany({ age: { $lt: 20 } });
console.log(`Deleted ${deleteManyResult.deletedCount} documents`);

// 删除所有文档
const deleteAllResult = await users.deleteMany({});
```

### 统计与去重

```typescript
// 统计文档数量
const totalCount = await users.countDocuments({});
const filteredCount = await users.countDocuments({ age: { $gte: 25 } });

// 获取字段的不重复值
const uniqueAges = await users.distinct('age', {});
const uniqueCities = await users.distinct('address.city', { status: 'active' });
```

---

## 查询操作符

### 比较操作符

```typescript
// $eq - 等于
await users.find({ filter: { age: { $eq: 25 } } });
// 简写形式
await users.find({ filter: { age: 25 } });

// $ne - 不等于
await users.find({ filter: { status: { $ne: 'inactive' } } });

// $gt - 大于
await users.find({ filter: { age: { $gt: 30 } } });

// $gte - 大于等于
await users.find({ filter: { age: { $gte: 18 } } });

// $lt - 小于
await users.find({ filter: { score: { $lt: 60 } } });

// $lte - 小于等于
await users.find({ filter: { price: { $lte: 100 } } });

// $in - 在数组中
await users.find({ filter: { status: { $in: ['active', 'pending'] } } });

// $nin - 不在数组中
await users.find({ filter: { role: { $nin: ['admin', 'superuser'] } } });
```

### 逻辑操作符

```typescript
// $and - 逻辑与
await users.find({
    filter: {
        $and: [
            { age: { $gte: 18 } },
            { age: { $lte: 65 } }
        ]
    }
});

// $or - 逻辑或
await users.find({
    filter: {
        $or: [
            { status: 'active' },
            { role: 'admin' }
        ]
    }
});

// $nor - 逻辑或非
await users.find({
    filter: {
        $nor: [
            { status: 'deleted' },
            { banned: true }
        ]
    }
});

// $not - 逻辑非
await users.find({
    filter: {
        age: { $not: { $lt: 18 } }
    }
});
```

### 元素操作符

```typescript
// $exists - 字段是否存在
await users.find({ filter: { email: { $exists: true } } });
await users.find({ filter: { deletedAt: { $exists: false } } });

// $type - 字段类型检查
await users.find({ filter: { age: { $type: 'int' } } });
await users.find({ filter: { createdAt: { $type: 'date' } } });
```

### 数组操作符

```typescript
// $size - 数组长度
await users.find({ filter: { tags: { $size: 3 } } });

// $all - 包含所有元素
await users.find({
    filter: { tags: { $all: ['javascript', 'typescript'] } }
});

// $elemMatch - 数组元素匹配
await users.find({
    filter: {
        scores: {
            $elemMatch: { $gte: 80, $lte: 100 }
        }
    }
});
```

### 其他操作符

```typescript
// $regex - 正则表达式匹配
await users.find({
    filter: { email: { $regex: /@gmail\.com$/ } }
});
// 或使用字符串
await users.find({
    filter: { name: { $regex: '^A' } }
});

// $mod - 取模运算
await users.find({
    filter: { age: { $mod: [5, 0] } }  // age 能被 5 整除
});
```

---

## 更新操作符

### 字段操作符

```typescript
// $set - 设置字段值
await users.updateOne(
    { _id: userId },
    { $set: { name: 'New Name', 'address.city': 'Shanghai' } }
);

// $unset - 删除字段
await users.updateOne(
    { _id: userId },
    { $unset: { tempField: '' } }
);

// $rename - 重命名字段
await users.updateOne(
    { _id: userId },
    { $rename: { oldName: 'newName' } }
);

// $inc - 增加数值
await users.updateOne(
    { _id: userId },
    { $inc: { age: 1, 'stats.loginCount': 1 } }
);

// $mul - 乘法运算
await users.updateOne(
    { _id: userId },
    { $mul: { price: 1.1 } }  // 价格增加 10%
);

// $min - 设置为较小值
await users.updateOne(
    { _id: userId },
    { $min: { lowScore: 50 } }  // 只有当前值 > 50 时才更新
);

// $max - 设置为较大值
await users.updateOne(
    { _id: userId },
    { $max: { highScore: 100 } }  // 只有当前值 < 100 时才更新
);

// $currentDate - 设置当前日期
await users.updateOne(
    { _id: userId },
    {
        $currentDate: {
            lastModified: true,                    // Date 类型
            lastAccess: { $type: 'timestamp' }     // Timestamp 类型
        }
    }
);
```

### 数组操作符

```typescript
// $push - 添加元素到数组
await users.updateOne(
    { _id: userId },
    { $push: { tags: 'newTag' } }
);

// $push 配合 $each - 添加多个元素
await users.updateOne(
    { _id: userId },
    { $push: { tags: { $each: ['tag1', 'tag2', 'tag3'] } } }
);

// $pull - 从数组中移除元素
await users.updateOne(
    { _id: userId },
    { $pull: { tags: 'oldTag' } }
);

// $pullAll - 移除多个元素
await users.updateOne(
    { _id: userId },
    { $pullAll: { tags: ['tag1', 'tag2'] } }
);

// $addToSet - 添加元素（不重复）
await users.updateOne(
    { _id: userId },
    { $addToSet: { tags: 'uniqueTag' } }
);

// $addToSet 配合 $each
await users.updateOne(
    { _id: userId },
    { $addToSet: { tags: { $each: ['tag1', 'tag2'] } } }
);

// $pop - 移除首个或末尾元素
await users.updateOne(
    { _id: userId },
    { $pop: { tags: 1 } }   // 1: 移除末尾, -1: 移除首个
);
```

---

## 聚合管道

### 基本聚合

```typescript
// 使用 runCommand 执行聚合
const result = await db.runCommand({
    aggregate: 'orders',
    pipeline: [
        { $match: { status: 'completed' } },
        { $group: {
            _id: '$customerId',
            totalAmount: { $sum: '$amount' },
            orderCount: { $sum: 1 }
        }},
        { $sort: { totalAmount: -1 } },
        { $limit: 10 }
    ],
    cursor: {}
});

const docs = result.cursor.firstBatch;
```

### $match 阶段

```typescript
// 过滤文档
const result = await db.runCommand({
    aggregate: 'users',
    pipeline: [
        { $match: { age: { $gte: 18 }, status: 'active' } }
    ],
    cursor: {}
});
```

### $project 阶段

```typescript
// 投影字段
const result = await db.runCommand({
    aggregate: 'users',
    pipeline: [
        { $project: {
            name: 1,
            age: 1,
            email: 1,
            _id: 0
        }}
    ],
    cursor: {}
});
```

### $group 阶段

```typescript
// 分组聚合
const result = await db.runCommand({
    aggregate: 'orders',
    pipeline: [
        { $group: {
            _id: '$category',           // 分组字段
            total: { $sum: '$price' },  // 求和
            count: { $sum: 1 },         // 计数
            avgPrice: { $avg: '$price' }, // 平均值
            minPrice: { $min: '$price' }, // 最小值
            maxPrice: { $max: '$price' }, // 最大值
            items: { $push: '$name' }   // 收集到数组
        }}
    ],
    cursor: {}
});
```

### $sort 阶段

```typescript
// 排序
const result = await db.runCommand({
    aggregate: 'users',
    pipeline: [
        { $sort: { age: -1, name: 1 } }  // age 降序，name 升序
    ],
    cursor: {}
});
```

### $limit 和 $skip 阶段

```typescript
// 分页
const result = await db.runCommand({
    aggregate: 'users',
    pipeline: [
        { $sort: { createdAt: -1 } },
        { $skip: 20 },    // 跳过前 20 条
        { $limit: 10 }    // 返回 10 条
    ],
    cursor: {}
});
```

### $unwind 阶段

```typescript
// 展开数组
const result = await db.runCommand({
    aggregate: 'orders',
    pipeline: [
        { $unwind: '$items' },
        { $group: {
            _id: '$items.productId',
            totalQuantity: { $sum: '$items.quantity' }
        }}
    ],
    cursor: {}
});
```

### $lookup 阶段

```typescript
// 关联查询（类似 SQL JOIN）
const result = await db.runCommand({
    aggregate: 'orders',
    pipeline: [
        { $lookup: {
            from: 'users',           // 要关联的集合
            localField: 'userId',    // 本集合的字段
            foreignField: '_id',     // 外部集合的字段
            as: 'userInfo'           // 输出字段名
        }}
    ],
    cursor: {}
});
```

### $addFields / $set 阶段

```typescript
// 添加新字段
const result = await db.runCommand({
    aggregate: 'users',
    pipeline: [
        { $addFields: {
            fullName: { $concat: ['$firstName', ' ', '$lastName'] },
            isAdult: { $gte: ['$age', 18] }
        }}
    ],
    cursor: {}
});
```

### $count 阶段

```typescript
// 统计数量
const result = await db.runCommand({
    aggregate: 'users',
    pipeline: [
        { $match: { status: 'active' } },
        { $count: 'activeUserCount' }
    ],
    cursor: {}
});
// 结果: [{ activeUserCount: 150 }]
```

### $replaceRoot 阶段

```typescript
// 替换根文档
const result = await db.runCommand({
    aggregate: 'users',
    pipeline: [
        { $replaceRoot: { newRoot: '$profile' } }
    ],
    cursor: {}
});
```

### $unset 阶段

```typescript
// 移除字段
const result = await db.runCommand({
    aggregate: 'users',
    pipeline: [
        { $unset: ['password', 'internalId', 'tempData'] }
    ],
    cursor: {}
});
```

---

## 索引管理

### 创建索引

```typescript
const users = await db.getCollection('users', true);

// 创建单字段索引
const indexName = await users.createIndex(
    { email: 1 },      // 1: 升序, -1: 降序
    {}                 // 选项
);

// 创建唯一索引
const uniqueIndex = await users.createIndex(
    { username: 1 },
    { unique: true }
);

// 创建复合索引
const compoundIndex = await users.createIndex(
    { lastName: 1, firstName: 1 },
    { name: 'name_index' }
);

// 创建带名称的索引
const namedIndex = await users.createIndex(
    { createdAt: -1 },
    { name: 'created_at_desc' }
);
```

### 使用命令创建索引

```typescript
const result = await db.runCommand({
    createIndexes: 'users',
    indexes: [
        {
            key: { email: 1 },
            name: 'email_1',
            unique: true
        },
        {
            key: { status: 1, createdAt: -1 },
            name: 'status_created_compound'
        }
    ]
});
console.log(`Created ${result.numIndexesAfter - result.numIndexesBefore} indexes`);
```

### 列出索引

```typescript
// 使用集合方法
const indexes = users.listIndexes();
for (const idx of indexes) {
    console.log(`Index: ${idx.name}, Key: ${JSON.stringify(idx.key)}`);
}

// 使用命令
const result = await db.runCommand({
    listIndexes: 'users'
});
for (const idx of result.cursor.firstBatch) {
    console.log(`Index: ${idx.name}`);
}
```

### 删除索引

```typescript
// 删除单个索引
await users.dropIndex('email_1');

// 使用命令删除
await db.runCommand({
    dropIndexes: 'users',
    index: 'email_1'
});

// 删除所有索引（保留 _id）
await db.runCommand({
    dropIndexes: 'users',
    index: '*'
});
```

---

## 事务操作

### 基本事务流程

```typescript
// 事务通过命令方式执行
const lsid = { id: new ObjectId() };  // 会话 ID
const txnNumber = BigInt(1);           // 事务编号

// 开始事务
await db.runCommand({
    startTransaction: 1,
    lsid: lsid,
    txnNumber: txnNumber,
    readConcern: { level: 'local' },
    writeConcern: { w: 'majority' }
});

try {
    // 执行事务操作
    await db.runCommand({
        insert: 'accounts',
        documents: [{ userId: 'user1', balance: 100 }],
        lsid: lsid,
        txnNumber: txnNumber
    });

    await db.runCommand({
        update: 'accounts',
        updates: [{
            q: { userId: 'user2' },
            u: { $inc: { balance: -100 } }
        }],
        lsid: lsid,
        txnNumber: txnNumber
    });

    // 提交事务
    await db.runCommand({
        commitTransaction: 1,
        lsid: lsid,
        txnNumber: txnNumber
    });
    console.log('Transaction committed');

} catch (error) {
    // 回滚事务
    await db.runCommand({
        abortTransaction: 1,
        lsid: lsid,
        txnNumber: txnNumber
    });
    console.log('Transaction aborted:', error);
}
```

### 会话管理

```typescript
// 结束会话
await db.runCommand({
    endSessions: [lsid]
});

// 刷新会话（保持会话活跃）
await db.runCommand({
    refreshSessions: [lsid]
});
```

---

## 游标操作

### 使用游标分批获取数据

```typescript
// 初始查询返回游标
const result = await db.runCommand({
    find: 'users',
    filter: { status: 'active' },
    batchSize: 100  // 每批返回 100 条
});

let cursorId = result.cursor.id;
let documents = result.cursor.firstBatch;

// 处理第一批
for (const doc of documents) {
    console.log(doc);
}

// 获取更多数据
while (cursorId !== BigInt(0)) {
    const moreResult = await db.runCommand({
        getMore: cursorId,
        collection: 'users',
        batchSize: 100
    });

    cursorId = moreResult.cursor.id;
    documents = moreResult.cursor.nextBatch;

    for (const doc of documents) {
        console.log(doc);
    }
}
```

### 终止游标

```typescript
// 终止单个游标
await db.runCommand({
    killCursors: 'users',
    cursors: [cursorId]
});

// 结果包含终止状态
// {
//     ok: 1,
//     cursorsKilled: [cursorId],
//     cursorsNotFound: [],
//     cursorsAlive: [],
//     cursorsUnknown: []
// }
```

---

## 数据库命令

### 诊断命令

```typescript
// Ping - 测试连接
const ping = await db.runCommand({ ping: 1 });
// { ok: 1 }

// Hello/isMaster - 获取服务器信息
const hello = await db.runCommand({ hello: 1 });
// {
//     ok: 1,
//     ismaster: true,
//     maxBsonObjectSize: 16777216,
//     maxMessageSizeBytes: 50331648,
//     maxWriteBatchSize: 100000,
//     localTime: Date,
//     minWireVersion: 0,
//     maxWireVersion: 13
// }

// 构建信息
const buildInfo = await db.runCommand({ buildInfo: 1 });

// 服务器状态
const serverStatus = await db.runCommand({ serverStatus: 1 });

// 连接状态
const connStatus = await db.runCommand({ connectionStatus: 1 });
```

### 数据库统计

```typescript
// 数据库统计
const dbStats = await db.runCommand({ dbStats: 1 });
// {
//     ok: 1,
//     db: 'test',
//     collections: 5,
//     objects: 1000,
//     avgObjSize: 256,
//     dataSize: 256000,
//     storageSize: 512000,
//     indexes: 8
// }

// 集合统计
const collStats = await db.runCommand({ collStats: 'users' });
// {
//     ok: 1,
//     ns: 'test.users',
//     count: 500,
//     size: 128000,
//     avgObjSize: 256,
//     storageSize: 256000,
//     nindexes: 3
// }

// 验证集合完整性
const validateResult = await db.runCommand({ validate: 'users' });
// {
//     ok: 1,
//     ns: 'test.users',
//     valid: true,
//     errors: [],
//     warnings: [],
//     nrecords: 500,
//     nIndexes: 3
// }
```

### CRUD 命令

```typescript
// 插入命令
await db.runCommand({
    insert: 'users',
    documents: [
        { name: 'Alice', age: 25 },
        { name: 'Bob', age: 30 }
    ]
});

// 查找命令
const findResult = await db.runCommand({
    find: 'users',
    filter: { age: { $gt: 20 } },
    projection: { name: 1, age: 1 },
    sort: { age: -1 },
    skip: 0,
    limit: 10
});

// 更新命令
await db.runCommand({
    update: 'users',
    updates: [
        {
            q: { name: 'Alice' },
            u: { $set: { age: 26 } },
            multi: false
        }
    ]
});

// 删除命令
await db.runCommand({
    delete: 'users',
    deletes: [
        {
            q: { status: 'inactive' },
            limit: 0  // 0 表示删除所有匹配项
        }
    ]
});

// 计数命令
const countResult = await db.runCommand({
    count: 'users',
    query: { status: 'active' }
});

// 去重命令
const distinctResult = await db.runCommand({
    distinct: 'users',
    key: 'status',
    query: {}
});

// findAndModify 命令
const famResult = await db.runCommand({
    findAndModify: 'users',
    query: { name: 'Alice' },
    update: { $inc: { loginCount: 1 } },
    new: true,  // 返回更新后的文档
    upsert: false
});
```

### 集合管理命令

```typescript
// 创建集合
await db.runCommand({
    create: 'newCollection'
});

// 删除集合
await db.runCommand({
    drop: 'oldCollection'
});

// 列出集合
const listResult = await db.runCommand({
    listCollections: 1
});
for (const coll of listResult.cursor.firstBatch) {
    console.log(`Collection: ${coll.name}, Type: ${coll.type}`);
}
```

### 查询计划分析

```typescript
// 分析查询计划
const explainResult = await db.runCommand({
    explain: {
        find: 'users',
        filter: { age: { $gt: 25 } }
    },
    verbosity: 'executionStats'
});

console.log('Query Plan:', explainResult.queryPlanner);
console.log('Execution Stats:', explainResult.executionStats);
```

---

## 完整示例

### 用户管理系统

```typescript
import { Database, ObjectId } from 'monolite-ts';

async function main() {
    // 打开数据库
    const db = await Database.open({ filePath: 'app.monodb' });

    try {
        // 获取用户集合
        const users = await db.getCollection('users', true);

        // 创建唯一索引
        await users.createIndex({ email: 1 }, { unique: true });
        await users.createIndex({ username: 1 }, { unique: true });

        // 注册新用户
        const newUser = await users.insertOne({
            username: 'johndoe',
            email: 'john@example.com',
            password: 'hashed_password',
            profile: {
                firstName: 'John',
                lastName: 'Doe',
                age: 28
            },
            roles: ['user'],
            createdAt: new Date(),
            lastLogin: null
        });
        console.log('User created:', newUser.insertedId);

        // 用户登录 - 更新最后登录时间
        await users.updateOne(
            { email: 'john@example.com' },
            {
                $set: { lastLogin: new Date() },
                $inc: { loginCount: 1 }
            }
        );

        // 查找活跃用户
        const activeUsers = await users.find({
            filter: {
                lastLogin: { $gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) }
            },
            sort: { lastLogin: -1 },
            limit: 10
        });
        console.log('Active users:', activeUsers.length);

        // 统计用户角色分布
        const roleStats = await db.runCommand({
            aggregate: 'users',
            pipeline: [
                { $unwind: '$roles' },
                { $group: {
                    _id: '$roles',
                    count: { $sum: 1 }
                }},
                { $sort: { count: -1 } }
            ],
            cursor: {}
        });
        console.log('Role distribution:', roleStats.cursor.firstBatch);

    } finally {
        await db.close();
    }
}

main().catch(console.error);
```

### 电商订单处理

```typescript
import { Database, ObjectId } from 'monolite-ts';

async function processOrder() {
    const db = await Database.open({ filePath: 'ecommerce.monodb' });

    try {
        const orders = await db.getCollection('orders', true);
        const products = await db.getCollection('products', true);
        const inventory = await db.getCollection('inventory', true);

        // 创建索引
        await orders.createIndex({ status: 1, createdAt: -1 });
        await orders.createIndex({ customerId: 1 });

        // 创建新订单
        const order = await orders.insertOne({
            customerId: new ObjectId(),
            items: [
                { productId: 'prod_001', name: 'Widget', quantity: 2, price: 29.99 },
                { productId: 'prod_002', name: 'Gadget', quantity: 1, price: 49.99 }
            ],
            status: 'pending',
            totalAmount: 109.97,
            shippingAddress: {
                street: '123 Main St',
                city: 'New York',
                country: 'USA'
            },
            createdAt: new Date()
        });

        // 更新库存
        for (const item of [
            { productId: 'prod_001', quantity: 2 },
            { productId: 'prod_002', quantity: 1 }
        ]) {
            await inventory.updateOne(
                { productId: item.productId },
                { $inc: { stock: -item.quantity } }
            );
        }

        // 更新订单状态
        await orders.updateOne(
            { _id: order.insertedId },
            { $set: { status: 'confirmed', confirmedAt: new Date() } }
        );

        // 查询销售报表
        const salesReport = await db.runCommand({
            aggregate: 'orders',
            pipeline: [
                { $match: { status: 'completed' } },
                { $unwind: '$items' },
                { $group: {
                    _id: '$items.productId',
                    productName: { $first: '$items.name' },
                    totalQuantity: { $sum: '$items.quantity' },
                    totalRevenue: { $sum: { $multiply: ['$items.quantity', '$items.price'] } }
                }},
                { $sort: { totalRevenue: -1 } },
                { $limit: 10 }
            ],
            cursor: {}
        });

        console.log('Top selling products:', salesReport.cursor.firstBatch);

    } finally {
        await db.close();
    }
}

processOrder().catch(console.error);
```

---

## 错误处理

```typescript
import { Database, MonoError } from 'monolite-ts';

async function handleErrors() {
    const db = await Database.open({ filePath: 'test.monodb' });

    try {
        const users = await db.getCollection('users', true);

        // 尝试插入重复文档
        await users.insertOne({ _id: 'user1', name: 'Alice' });
        await users.insertOne({ _id: 'user1', name: 'Bob' });  // 会抛出错误

    } catch (error) {
        if (error instanceof MonoError) {
            console.error('MonoLite Error:');
            console.error('  Code:', error.code);
            console.error('  Message:', error.message);

            // 根据错误码处理
            switch (error.code) {
                case 11000:  // DuplicateKey
                    console.error('  Duplicate key violation');
                    break;
                case 26:     // NamespaceNotFound
                    console.error('  Collection not found');
                    break;
                default:
                    console.error('  Unknown error');
            }
        } else {
            throw error;
        }
    } finally {
        await db.close();
    }
}
```

---

## TypeScript 类型定义

```typescript
// 主要类型
interface DatabaseOptions {
    filePath: string;
    cacheSize?: number;
}

interface DatabaseStats {
    collections: number;
    documents: number;
    dataSize: number;
    storageSize: number;
    indexes: number;
}

interface InsertResult {
    insertedId: any;
    acknowledged: boolean;
}

interface InsertManyResult {
    insertedIds: any[];
    insertedCount: number;
    acknowledged: boolean;
}

interface UpdateResult {
    matchedCount: number;
    modifiedCount: number;
    upsertedId?: any;
    acknowledged: boolean;
}

interface DeleteResult {
    deletedCount: number;
    acknowledged: boolean;
}

interface FindOptions {
    filter?: BSONDocument;
    projection?: BSONDocument;
    sort?: BSONDocument;
    skip?: number;
    limit?: number;
    batchSize?: number;
}

interface CollectionInfo {
    name: string;
    dataPageId: number;
    indexRootPageId: number;
    documentCount: number;
    indexes: IndexMeta[];
    createdAt: Date;
    updatedAt: Date;
}

// BSON 类型
type BSONValue =
    | null
    | boolean
    | number
    | bigint
    | string
    | Date
    | ObjectId
    | Binary
    | BSONDocument
    | BSONValue[];

interface BSONDocument {
    [key: string]: BSONValue;
}
```

---

## 注意事项

1. **异步操作**：所有数据库操作都是异步的，需要使用 `async/await` 或 Promise 处理
2. **资源管理**：使用完毕后务必调用 `db.close()` 关闭数据库
3. **错误处理**：建议使用 try-catch 捕获 `MonoError` 进行错误处理
4. **索引优化**：对于频繁查询的字段，建议创建索引以提高性能
5. **事务使用**：多文档原子操作建议使用事务保证数据一致性
6. **批量操作**：大量数据操作时使用 `insertMany`、`updateMany` 等批量方法
