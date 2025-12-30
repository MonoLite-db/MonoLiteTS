// Created by Yanjunhui

import { BSONDocument, BSONValue, compareBSON } from '../bson';
import { MonoError, ErrorCodes } from '../core';

/**
 * Pipeline stage interface
 */
export interface PipelineStage {
    execute(docs: BSONDocument[]): BSONDocument[];
    name(): string;
}

/**
 * Database interface for $lookup
 */
interface DatabaseLike {
    getCollection(name: string): CollectionLike | null;
}

interface CollectionLike {
    find(filter: BSONDocument | null): BSONDocument[];
}

/**
 * Aggregation Pipeline
 */
export class Pipeline {
    private stages: PipelineStage[];
    private db: DatabaseLike | null;

    constructor(stages: PipelineStage[], db: DatabaseLike | null = null) {
        this.stages = stages;
        this.db = db;
    }

    /**
     * Create pipeline from stage documents
     */
    static create(stagesDocs: BSONDocument[], db: DatabaseLike | null = null): Pipeline {
        const stages: PipelineStage[] = [];

        for (const stageDoc of stagesDocs) {
            const keys = Object.keys(stageDoc);
            if (keys.length !== 1) {
                throw MonoError.fromCode(ErrorCodes.FailedToParse, 'invalid pipeline stage: each stage must have exactly one field');
            }

            const stageName = keys[0];
            const stageSpec = stageDoc[stageName];

            const stage = createStage(stageName, stageSpec, db);
            stages.push(stage);
        }

        return new Pipeline(stages, db);
    }

    /**
     * Execute pipeline on documents
     */
    execute(docs: BSONDocument[]): BSONDocument[] {
        let result = docs;

        for (const stage of this.stages) {
            result = stage.execute(result);
        }

        return result;
    }
}

/**
 * Create a pipeline stage
 */
function createStage(name: string, spec: unknown, db: DatabaseLike | null): PipelineStage {
    switch (name) {
        case '$match':
            return new MatchStage(spec as BSONDocument);
        case '$project':
            return new ProjectStage(spec as BSONDocument);
        case '$sort':
            return new SortStage(spec as BSONDocument);
        case '$limit':
            return new LimitStage(toInt64(spec));
        case '$skip':
            return new SkipStage(toInt64(spec));
        case '$group':
            return new GroupStage(spec as BSONDocument);
        case '$count':
            return new CountStage(spec as string);
        case '$unwind':
            return new UnwindStage(spec);
        case '$addFields':
        case '$set':
            return new AddFieldsStage(spec as BSONDocument);
        case '$unset':
            return new UnsetStage(spec);
        case '$replaceRoot':
            return new ReplaceRootStage(spec as BSONDocument);
        case '$lookup':
            return new LookupStage(spec as BSONDocument, db);
        default:
            throw MonoError.fromCode(ErrorCodes.CommandNotFound, `unsupported pipeline stage: ${name}`);
    }
}

/**
 * $match stage
 */
class MatchStage implements PipelineStage {
    private filter: BSONDocument;

    constructor(filter: BSONDocument) {
        this.filter = filter;
    }

    name(): string {
        return '$match';
    }

    execute(docs: BSONDocument[]): BSONDocument[] {
        if (Object.keys(this.filter).length === 0) {
            return docs;
        }

        return docs.filter((doc) => matchDocument(doc, this.filter));
    }
}

/**
 * $project stage
 */
class ProjectStage implements PipelineStage {
    private projection: BSONDocument;

    constructor(projection: BSONDocument) {
        this.projection = projection;
    }

    name(): string {
        return '$project';
    }

    execute(docs: BSONDocument[]): BSONDocument[] {
        return docs.map((doc) => applyProjection(doc, this.projection));
    }
}

/**
 * $sort stage
 */
class SortStage implements PipelineStage {
    private sortSpec: BSONDocument;

    constructor(sortSpec: BSONDocument) {
        this.sortSpec = sortSpec;
    }

    name(): string {
        return '$sort';
    }

    execute(docs: BSONDocument[]): BSONDocument[] {
        return sortDocuments(docs, this.sortSpec);
    }
}

/**
 * $limit stage
 */
class LimitStage implements PipelineStage {
    private limit: number;

    constructor(limit: number) {
        this.limit = limit;
    }

    name(): string {
        return '$limit';
    }

    execute(docs: BSONDocument[]): BSONDocument[] {
        if (this.limit <= 0 || docs.length <= this.limit) {
            return docs;
        }
        return docs.slice(0, this.limit);
    }
}

/**
 * $skip stage
 */
class SkipStage implements PipelineStage {
    private skip: number;

    constructor(skip: number) {
        this.skip = skip;
    }

    name(): string {
        return '$skip';
    }

    execute(docs: BSONDocument[]): BSONDocument[] {
        if (this.skip <= 0) {
            return docs;
        }
        if (docs.length <= this.skip) {
            return [];
        }
        return docs.slice(this.skip);
    }
}

/**
 * Group state
 */
interface GroupState {
    id: BSONValue;
    values: Map<string, BSONValue[]>;
}

/**
 * $group stage
 */
class GroupStage implements PipelineStage {
    private idExpr: unknown;
    private accumulators: BSONDocument;

    constructor(spec: BSONDocument) {
        this.idExpr = spec._id;
        this.accumulators = {};
        for (const key of Object.keys(spec)) {
            if (key !== '_id') {
                this.accumulators[key] = spec[key];
            }
        }
    }

    name(): string {
        return '$group';
    }

    execute(docs: BSONDocument[]): BSONDocument[] {
        const groups = new Map<string, GroupState>();
        const groupOrder: string[] = [];

        for (const doc of docs) {
            const groupKey = this.computeGroupKey(doc);
            const keyStr = JSON.stringify(groupKey);

            if (!groups.has(keyStr)) {
                groups.set(keyStr, {
                    id: groupKey,
                    values: new Map(),
                });
                groupOrder.push(keyStr);
            }

            const state = groups.get(keyStr)!;

            // Collect values for each accumulator
            for (const fieldName of Object.keys(this.accumulators)) {
                const accSpec = this.accumulators[fieldName] as BSONDocument;
                const accOp = Object.keys(accSpec)[0];
                const accExpr = accSpec[accOp];

                const key = `${fieldName}_${accOp}`;
                const val = this.evaluateExpression(accExpr, doc);

                if (!state.values.has(key)) {
                    state.values.set(key, []);
                }
                state.values.get(key)!.push(val);
            }
        }

        // Compute final results
        const result: BSONDocument[] = [];

        for (const keyStr of groupOrder) {
            const state = groups.get(keyStr)!;
            const doc: BSONDocument = { _id: state.id };

            for (const fieldName of Object.keys(this.accumulators)) {
                const accSpec = this.accumulators[fieldName] as BSONDocument;
                const accOp = Object.keys(accSpec)[0];
                const key = `${fieldName}_${accOp}`;
                const values = state.values.get(key) || [];

                let finalVal: unknown;
                switch (accOp) {
                    case '$sum':
                        finalVal = this.computeSum(values);
                        break;
                    case '$avg':
                        finalVal = this.computeAvg(values);
                        break;
                    case '$min':
                        finalVal = this.computeMin(values);
                        break;
                    case '$max':
                        finalVal = this.computeMax(values);
                        break;
                    case '$first':
                        finalVal = values.length > 0 ? values[0] : null;
                        break;
                    case '$last':
                        finalVal = values.length > 0 ? values[values.length - 1] : null;
                        break;
                    case '$count':
                        finalVal = values.length;
                        break;
                    case '$push':
                        finalVal = values;
                        break;
                    case '$addToSet':
                        finalVal = this.computeAddToSet(values);
                        break;
                    default:
                        throw MonoError.fromCode(ErrorCodes.CommandNotFound, `unsupported accumulator: ${accOp}`);
                }

                doc[fieldName] = finalVal as BSONValue;
            }

            result.push(doc);
        }

        return result;
    }

    private computeGroupKey(doc: BSONDocument): BSONValue {
        if (this.idExpr === null) {
            return null;
        }

        // Field reference "$field"
        if (typeof this.idExpr === 'string') {
            if (this.idExpr.startsWith('$')) {
                return getDocField(doc, this.idExpr.slice(1)) as BSONValue;
            }
            return this.idExpr;
        }

        // Composite key document
        if (typeof this.idExpr === 'object' && this.idExpr !== null && !Array.isArray(this.idExpr)) {
            const idDoc = this.idExpr as BSONDocument;
            const result: BSONDocument = {};
            for (const key of Object.keys(idDoc)) {
                const val = idDoc[key];
                if (typeof val === 'string' && val.startsWith('$')) {
                    result[key] = getDocField(doc, val.slice(1)) as BSONValue;
                } else {
                    result[key] = val;
                }
            }
            return result;
        }

        return this.idExpr as BSONValue;
    }

    private evaluateExpression(expr: unknown, doc: BSONDocument): BSONValue {
        if (typeof expr === 'string' && expr.startsWith('$')) {
            return getDocField(doc, expr.slice(1)) as BSONValue;
        }
        return expr as BSONValue;
    }

    private computeSum(values: BSONValue[]): number {
        let sum = 0;
        for (const v of values) {
            sum += toFloat64(v as unknown);
        }
        return sum;
    }

    private computeAvg(values: BSONValue[]): number {
        if (values.length === 0) {
            return 0;
        }
        return this.computeSum(values) / values.length;
    }

    private computeMin(values: BSONValue[]): BSONValue {
        if (values.length === 0) {
            return null;
        }
        let min = values[0];
        for (let i = 1; i < values.length; i++) {
            if (compareBSON(values[i], min) < 0) {
                min = values[i];
            }
        }
        return min;
    }

    private computeMax(values: BSONValue[]): BSONValue {
        if (values.length === 0) {
            return null;
        }
        let max = values[0];
        for (let i = 1; i < values.length; i++) {
            if (compareBSON(values[i], max) > 0) {
                max = values[i];
            }
        }
        return max;
    }

    private computeAddToSet(values: BSONValue[]): BSONValue[] {
        const seen = new Set<string>();
        const result: BSONValue[] = [];
        for (const v of values) {
            const key = JSON.stringify(v);
            if (!seen.has(key)) {
                seen.add(key);
                result.push(v);
            }
        }
        return result;
    }
}

/**
 * $count stage
 */
class CountStage implements PipelineStage {
    private field: string;

    constructor(field: string) {
        this.field = field;
    }

    name(): string {
        return '$count';
    }

    execute(docs: BSONDocument[]): BSONDocument[] {
        return [{ [this.field]: docs.length }];
    }
}

/**
 * $unwind stage
 */
class UnwindStage implements PipelineStage {
    private path: string;
    private preserveNullAndEmptyArrays: boolean = false;

    constructor(spec: unknown) {
        if (typeof spec === 'string') {
            if (!spec.startsWith('$')) {
                throw MonoError.fromCode(ErrorCodes.FailedToParse, '$unwind path must start with $');
            }
            this.path = spec.slice(1);
        } else if (typeof spec === 'object' && spec !== null) {
            const specDoc = spec as BSONDocument;
            if (typeof specDoc.path === 'string' && specDoc.path.startsWith('$')) {
                this.path = specDoc.path.slice(1);
            } else {
                throw MonoError.fromCode(ErrorCodes.FailedToParse, '$unwind requires a path');
            }
            if (typeof specDoc.preserveNullAndEmptyArrays === 'boolean') {
                this.preserveNullAndEmptyArrays = specDoc.preserveNullAndEmptyArrays;
            }
        } else {
            throw MonoError.fromCode(ErrorCodes.FailedToParse, '$unwind requires a string or document');
        }
    }

    name(): string {
        return '$unwind';
    }

    execute(docs: BSONDocument[]): BSONDocument[] {
        const result: BSONDocument[] = [];

        for (const doc of docs) {
            const fieldVal = getDocField(doc, this.path);

            if (!Array.isArray(fieldVal)) {
                if (this.preserveNullAndEmptyArrays) {
                    result.push(doc);
                }
                continue;
            }

            if (fieldVal.length === 0) {
                if (this.preserveNullAndEmptyArrays) {
                    result.push(doc);
                }
                continue;
            }

            for (const elem of fieldVal) {
                const newDoc: BSONDocument = {};
                for (const key of Object.keys(doc)) {
                    if (key === this.path) {
                        newDoc[key] = elem;
                    } else {
                        newDoc[key] = doc[key];
                    }
                }
                result.push(newDoc);
            }
        }

        return result;
    }
}

/**
 * $addFields stage
 */
class AddFieldsStage implements PipelineStage {
    private fields: BSONDocument;

    constructor(fields: BSONDocument) {
        this.fields = fields;
    }

    name(): string {
        return '$addFields';
    }

    execute(docs: BSONDocument[]): BSONDocument[] {
        return docs.map((doc) => {
            const newDoc: BSONDocument = { ...doc };

            for (const fieldName of Object.keys(this.fields)) {
                const expr = this.fields[fieldName];
                const val = this.evaluateExpression(expr, doc);
                newDoc[fieldName] = val as BSONValue;
            }

            return newDoc;
        });
    }

    private evaluateExpression(expr: unknown, doc: BSONDocument): BSONValue {
        if (typeof expr === 'string' && expr.startsWith('$')) {
            return getDocField(doc, expr.slice(1)) as BSONValue;
        }
        return expr as BSONValue;
    }
}

/**
 * $unset stage
 */
class UnsetStage implements PipelineStage {
    private fields: string[];

    constructor(spec: unknown) {
        if (typeof spec === 'string') {
            this.fields = [spec];
        } else if (Array.isArray(spec)) {
            this.fields = spec.filter((s): s is string => typeof s === 'string');
        } else {
            throw MonoError.fromCode(ErrorCodes.FailedToParse, '$unset requires a string or array of strings');
        }
    }

    name(): string {
        return '$unset';
    }

    execute(docs: BSONDocument[]): BSONDocument[] {
        return docs.map((doc) => {
            const newDoc: BSONDocument = {};
            for (const key of Object.keys(doc)) {
                if (!this.fields.includes(key)) {
                    newDoc[key] = doc[key];
                }
            }
            return newDoc;
        });
    }
}

/**
 * $replaceRoot stage
 */
class ReplaceRootStage implements PipelineStage {
    private newRoot: unknown;

    constructor(spec: BSONDocument) {
        this.newRoot = spec.newRoot;
        if (this.newRoot === undefined) {
            throw MonoError.fromCode(ErrorCodes.FailedToParse, '$replaceRoot requires newRoot field');
        }
    }

    name(): string {
        return '$replaceRoot';
    }

    execute(docs: BSONDocument[]): BSONDocument[] {
        const result: BSONDocument[] = [];

        for (const doc of docs) {
            const newDoc = this.evaluateNewRoot(doc);
            if (newDoc !== null) {
                result.push(newDoc);
            }
        }

        return result;
    }

    private evaluateNewRoot(doc: BSONDocument): BSONDocument | null {
        if (typeof this.newRoot === 'string') {
            if (this.newRoot.startsWith('$')) {
                const val = getDocField(doc, this.newRoot.slice(1));
                if (typeof val === 'object' && val !== null && !Array.isArray(val)) {
                    return val as BSONDocument;
                }
            }
            return null;
        }

        if (typeof this.newRoot === 'object' && this.newRoot !== null && !Array.isArray(this.newRoot)) {
            const rootDoc = this.newRoot as BSONDocument;
            const result: BSONDocument = {};
            for (const key of Object.keys(rootDoc)) {
                result[key] = this.evaluateExpr(rootDoc[key], doc) as BSONValue;
            }
            return result;
        }

        return null;
    }

    private evaluateExpr(expr: unknown, doc: BSONDocument): BSONValue {
        if (typeof expr === 'string' && expr.startsWith('$')) {
            return getDocField(doc, expr.slice(1)) as BSONValue;
        }
        return expr as BSONValue;
    }
}

/**
 * $lookup stage
 */
class LookupStage implements PipelineStage {
    private from: string;
    private localField: string;
    private foreignField: string;
    private as: string;
    private db: DatabaseLike | null;

    constructor(spec: BSONDocument, db: DatabaseLike | null) {
        this.from = spec.from as string || '';
        this.localField = spec.localField as string || '';
        this.foreignField = spec.foreignField as string || '';
        this.as = spec.as as string || '';
        this.db = db;

        if (!this.from || !this.as) {
            throw MonoError.fromCode(ErrorCodes.FailedToParse, "$lookup requires 'from' and 'as' fields");
        }
    }

    name(): string {
        return '$lookup';
    }

    execute(docs: BSONDocument[]): BSONDocument[] {
        if (!this.db) {
            throw MonoError.fromCode(ErrorCodes.InternalError, '$lookup requires database context');
        }

        const foreignColl = this.db.getCollection(this.from);

        // If collection doesn't exist, return empty arrays
        if (!foreignColl) {
            return docs.map((doc) => ({
                ...doc,
                [this.as]: [],
            }));
        }

        const foreignDocs = foreignColl.find(null);

        return docs.map((doc) => {
            const localVal = getDocField(doc, this.localField);

            const matches: BSONDocument[] = [];
            for (const foreignDoc of foreignDocs) {
                const foreignVal = getDocField(foreignDoc, this.foreignField);
                if (valuesEqual(localVal, foreignVal)) {
                    matches.push(foreignDoc);
                }
            }

            return {
                ...doc,
                [this.as]: matches,
            };
        });
    }
}

// Helper functions

/**
 * Get field from document (supports dot notation)
 */
function getDocField(doc: BSONDocument, path: string): unknown {
    const parts = path.split('.');
    let current: unknown = doc;

    for (const part of parts) {
        if (current === null || current === undefined) {
            return undefined;
        }
        if (typeof current === 'object' && !Array.isArray(current)) {
            current = (current as BSONDocument)[part];
        } else {
            return undefined;
        }
    }

    return current;
}

/**
 * Convert to int64
 */
function toInt64(v: unknown): number {
    if (typeof v === 'number') {
        return Math.floor(v);
    }
    if (typeof v === 'bigint') {
        return Number(v);
    }
    throw MonoError.fromCode(ErrorCodes.FailedToParse, 'cannot convert to integer');
}

/**
 * Convert to float64
 */
function toFloat64(v: unknown): number {
    if (typeof v === 'number') {
        return v;
    }
    if (typeof v === 'bigint') {
        return Number(v);
    }
    return 0;
}

/**
 * Check if values are equal
 */
function valuesEqual(a: BSONValue | unknown, b: BSONValue | unknown): boolean {
    return compareBSON(a as BSONValue, b as BSONValue) === 0;
}

/**
 * Match document against filter
 */
function matchDocument(doc: BSONDocument, filter: BSONDocument): boolean {
    for (const key of Object.keys(filter)) {
        const filterVal = filter[key];
        const docVal = getDocField(doc, key);

        if (!matchValue(docVal, filterVal)) {
            return false;
        }
    }
    return true;
}

/**
 * Match value against filter value
 */
function matchValue(docVal: unknown, filterVal: unknown): boolean {
    // Handle operator expressions
    if (typeof filterVal === 'object' && filterVal !== null && !Array.isArray(filterVal)) {
        const filterDoc = filterVal as BSONDocument;
        const keys = Object.keys(filterDoc);

        if (keys.length > 0 && keys[0].startsWith('$')) {
            return matchOperators(docVal, filterDoc);
        }
    }

    // Direct equality
    return valuesEqual(docVal, filterVal);
}

/**
 * Match operators
 */
function matchOperators(docVal: unknown, operators: BSONDocument): boolean {
    for (const op of Object.keys(operators)) {
        const opVal = operators[op];

        switch (op) {
            case '$eq':
                if (!valuesEqual(docVal, opVal)) return false;
                break;
            case '$ne':
                if (valuesEqual(docVal, opVal)) return false;
                break;
            case '$gt':
                if (compareBSON(docVal as BSONValue, opVal as BSONValue) <= 0) return false;
                break;
            case '$gte':
                if (compareBSON(docVal as BSONValue, opVal as BSONValue) < 0) return false;
                break;
            case '$lt':
                if (compareBSON(docVal as BSONValue, opVal as BSONValue) >= 0) return false;
                break;
            case '$lte':
                if (compareBSON(docVal as BSONValue, opVal as BSONValue) > 0) return false;
                break;
            case '$in':
                if (!Array.isArray(opVal)) return false;
                if (!opVal.some((v) => valuesEqual(docVal, v))) return false;
                break;
            case '$nin':
                if (!Array.isArray(opVal)) return false;
                if (opVal.some((v) => valuesEqual(docVal, v))) return false;
                break;
            case '$exists':
                const exists = docVal !== undefined;
                if (opVal !== exists) return false;
                break;
            case '$regex':
                if (typeof docVal !== 'string') return false;
                const regex = new RegExp(opVal as string);
                if (!regex.test(docVal)) return false;
                break;
            default:
                // Unknown operator, ignore
                break;
        }
    }
    return true;
}

/**
 * Apply projection to document
 */
function applyProjection(doc: BSONDocument, projection: BSONDocument): BSONDocument {
    const result: BSONDocument = {};
    const keys = Object.keys(projection);

    // Check if it's inclusion or exclusion
    let hasInclusion = false;
    let hasExclusion = false;

    for (const key of keys) {
        if (key === '_id') continue;
        const val = projection[key];
        if (val === 1 || val === true) {
            hasInclusion = true;
        } else if (val === 0 || val === false) {
            hasExclusion = true;
        }
    }

    if (hasInclusion) {
        // Inclusion mode
        if (projection._id !== 0 && projection._id !== false) {
            if (doc._id !== undefined) {
                result._id = doc._id;
            }
        }
        for (const key of keys) {
            if (key === '_id') continue;
            const val = projection[key];
            if (val === 1 || val === true) {
                const docVal = getDocField(doc, key);
                if (docVal !== undefined) {
                    result[key] = docVal as BSONValue;
                }
            }
        }
    } else if (hasExclusion) {
        // Exclusion mode
        for (const key of Object.keys(doc)) {
            if (projection[key] === 0 || projection[key] === false) {
                continue;
            }
            result[key] = doc[key];
        }
    } else {
        // Expression projection
        for (const key of Object.keys(doc)) {
            result[key] = doc[key];
        }
    }

    return result;
}

/**
 * Sort documents by fields
 */
function sortDocuments(docs: BSONDocument[], sortSpec: BSONDocument): BSONDocument[] {
    const result = [...docs];

    result.sort((a, b) => {
        for (const key of Object.keys(sortSpec)) {
            const dir = sortSpec[key] as number;
            const valA = getDocField(a, key);
            const valB = getDocField(b, key);

            const cmp = compareBSON(valA as BSONValue, valB as BSONValue);
            if (cmp !== 0) {
                return dir < 0 ? -cmp : cmp;
            }
        }
        return 0;
    });

    return result;
}

/**
 * Aggregate result structure
 */
export interface AggregateResult {
    cursor: {
        id: bigint;
        ns: string;
        firstBatch: BSONDocument[];
    };
    ok: number;
}

/**
 * Create aggregate result
 */
export function createAggregateResult(ns: string, docs: BSONDocument[]): AggregateResult {
    return {
        cursor: {
            id: 0n,
            ns,
            firstBatch: docs,
        },
        ok: 1,
    };
}
